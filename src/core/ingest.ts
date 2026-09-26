import { flatten } from './flatten.js';
import { truncate } from './format.js';
import { parseJsonLenient } from './json.js';
import { coerceNumeric, type FieldStats } from './numeric.js';
import { countInversions, isPlausibleInstant, parseStamp } from './time.js';
import type { EventKind, NaiveZone, NormalisedEvent } from './types.js';
import type { SourceWarning } from '../sources/data-source.js';

const DEFAULT_PREVIEW_BUDGET = 120;

/**
 * Fields are discovered per (kind, actor), so two devices with a path of the same name stay
 * separate.
 *
 * NUL as the separator, not a space or a colon: an EMS actor name is operator-chosen free
 * text, and the project's own configs contain spaces (`"P1 meter"`) while nothing forbids a
 * slash — the REST API routes `/devices/{name:path}` for that exact reason. Any printable
 * separator would eventually split a key in the wrong place.
 */
export function actorKey(kind: EventKind, actor: string): string {
	return `${kind}\0${actor}`;
}

export function splitActorKey(key: string): { kind: EventKind; actor: string } {
	const at = key.indexOf('\0');
	return { kind: key.slice(0, at) as EventKind, actor: key.slice(at + 1) };
}

/**
 * How many distinct series one dataset may mint: `(kind, actor, path)` entries in the field
 * catalogue below, and columns in the `ColumnStore` built from the same walk.
 *
 * **A backstop against a hostile or broken peer, not a product limit.** All three parts of
 * the key come from the source — `actor` is a device name and `path` is a flattened key from
 * a payload whose values the API types as `unknown` — and neither map was ever pruned, so a
 * peer that renames its payload keys each poll bought a permanent column per key, at the ~1 KB
 * `createColumn` allocates before a single sample lands, until the tab was OOM-killed and took
 * every other loaded dataset with it.
 *
 * 50 000 sits far above anything a real site produces. The widest payload this project has is
 * a P1 telegram — about seven flattened leaves per OBIS line, so ~220 fields for a full
 * DSMR-5 meter — and the largest site the code contemplates anywhere is the 200-device EMS in
 * `core/retention.ts`. A real one of those is a handful of meters and a few hundred plugs at
 * ~10 fields each, which lands in the low thousands; even the absurd version, 200 devices all
 * emitting full telegrams, is ~44 000 and still inside. What the number does bound is the
 * unbounded case: ~50 MB of empty columns rather than however many the peer feels like
 * sending.
 */
export const MAX_SERIES = 50_000;

export interface IngestOptions {
	readonly naiveZone?: NaiveZone;
	readonly previewBudget?: number;
	readonly onWarning?: (warning: SourceWarning) => void;
	/**
	 * Called for every numeric leaf, in ingest order. This is where the column store hooks
	 * in — flattening happens once, and both field discovery and the columnar build read
	 * from the same walk rather than each doing their own pass.
	 */
	readonly onSample?: (
		kind: EventKind,
		actor: string,
		path: string,
		t: number,
		value: number,
		unit?: string,
	) => void;
	/**
	 * Called for every event the ingestor accepts, in ingest order.
	 *
	 * How a caller learns its own batch boundary. The alternative — remembering
	 * `events.length` before a run of `add`/`addAt` calls and slicing from there afterwards —
	 * identifies a batch by an index into a shared, growing array, which is only valid for as
	 * long as nothing ever removes from that array's front. Handing the records out as they
	 * are made costs nothing and does not build in that constraint.
	 */
	readonly onEvent?: (event: NormalisedEvent) => void;
	/**
	 * Keep every accepted event in `events`. Default true; **false for an unbounded source.**
	 *
	 * A file is finite and its whole log is the result — `parseCsvText` returns `events`, and
	 * `finish()` reads it to count inversions and find a stray era. A live feed is neither: it
	 * runs for as long as the tab is open, its consumer already receives every event through
	 * `onEvent`, and the store owns the one copy that retention trims. Retaining a second copy
	 * here bounds nothing and frees nothing — each event holds the full `raw` snapshot the EMS
	 * sent, so the log grows with the feed for the lifetime of the dataset.
	 *
	 * `rows`, `tMin`, `tMax`, `skipped` and `naive` are counted as records arrive and stay
	 * correct either way. `inversions` and `strayEra` are derived from the retained log and are
	 * therefore empty when it is not kept — which is right rather than merely tolerable: both
	 * are whole-dataset verdicts a stream cannot reach, and the live path reports order from
	 * the store's own `appendAscending` repair instead (see `core/columns.ts`).
	 */
	readonly retainEvents?: boolean;
	/** Distinct series this dataset may discover. Defaults to `MAX_SERIES`; see it for why. */
	readonly maxSeries?: number;
}

export interface IngestSummary {
	readonly rows: number;
	readonly skipped: number;
	readonly naive: number;
	readonly inversions: number;
	readonly tMin: number;
	readonly tMax: number;
	/** Timestamp clusters far from the bulk; see `detectStrayEra`. */
	readonly strayEra: { readonly count: number; readonly tMin: number; readonly tMax: number } | null;
}

/**
 * Turns rows into events and discovers what is chartable, in **one pass**.
 *
 * Shared by the file and live sources: both call `add()` per record and read the same
 * catalogue afterwards, which is what stops the two paths from growing separate ideas of
 * what a field is.
 */
export class Ingestor {
	/** Every accepted event, and empty throughout when `retainEvents` is false. */
	readonly events: NormalisedEvent[] = [];
	/** `actorKey` -> path -> stats. */
	readonly fields = new Map<string, Map<string, FieldStats>>();

	private readonly naiveZone: NaiveZone;
	private readonly previewBudget: number;
	private readonly onWarning: (warning: SourceWarning) => void;
	private readonly onSample: IngestOptions['onSample'];
	private readonly onEvent: IngestOptions['onEvent'];
	private readonly retainEvents: boolean;
	private readonly maxSeries: number;

	private seq = 0;
	private skipped = 0;
	private naiveCount = 0;
	private tMin = Infinity;
	private tMax = -Infinity;
	/** Entries across every actor's path map, kept as a counter so the cap is O(1) per leaf. */
	private seriesCount = 0;
	private seriesCapped = false;

	constructor(options: IngestOptions = {}) {
		this.naiveZone = options.naiveZone ?? 'local';
		this.previewBudget = options.previewBudget ?? DEFAULT_PREVIEW_BUDGET;
		this.onWarning = options.onWarning ?? (() => {});
		this.onSample = options.onSample;
		this.onEvent = options.onEvent;
		this.retainEvents = options.retainEvents ?? true;
		this.maxSeries = options.maxSeries ?? MAX_SERIES;
	}

	/**
	 * Add one record. Returns false when the row was unusable and skipped.
	 *
	 * A row is skipped only when its **timestamp** is unreadable — without one it cannot be
	 * placed on any axis. An unparseable payload is kept: the row still happened, the
	 * timeline should still show it, and hiding it would misrepresent the run.
	 */
	add(
		kind: EventKind,
		actor: string,
		target: string | null,
		timestampCell: string | null | undefined,
		payloadCell: string | null | undefined,
		row: number,
		pathPrefix = '',
	): boolean {
		if (timestampCell === null || timestampCell === undefined || timestampCell === '') {
			this.skipped++;
			this.onWarning({ code: 'BAD_TIMESTAMP', row, detail: 'emptyTimestamp', sample: null });
			return false;
		}

		const stamp = parseStamp(timestampCell, this.naiveZone);
		if (Number.isNaN(stamp.t)) {
			this.skipped++;
			this.onWarning({
				code: 'BAD_TIMESTAMP',
				row,
				detail: 'unparseableTimestamp',
				sample: truncate(timestampCell, 60),
			});
			return false;
		}

		return this.addAt(kind, actor, target, stamp.t, stamp.naive, payloadCell ?? '', row, pathPrefix);
	}

	/**
	 * Add one record whose instant is already known.
	 *
	 * The live path needs this because its samples are float epochs with sub-millisecond
	 * precision, and there is no string to parse. Formatting one back into ISO and handing it
	 * to `add()` would truncate to three fraction digits and destroy the ordering that all of
	 * `core/time.ts` exists to preserve — several devices in the same poll routinely share a
	 * millisecond.
	 *
	 * `add()` delegates here, so both paths produce byte-identical events for the same input.
	 */
	addAt(
		kind: EventKind,
		actor: string,
		target: string | null,
		t: number,
		naive: boolean,
		raw: string,
		row: number,
		/**
		 * Prepended to every path this record discovers.
		 *
		 * The replay input uses it to qualify paths by topic, and decisions — file and live
		 * alike — to qualify them by target device; see `CsvShape.targetQualifiesPath`. Applied in
		 * the flatten *visitor* rather than seeded into the walk, so `core/flatten.ts` and its
		 * documented path grammar are untouched by this feature.
		 */
		pathPrefix = '',
	): boolean {
		// The bound belongs here as well as inside parseStamp, because this entry point takes
		// an instant as a float with no string left to re-read — and the two lines below are
		// where tMin/tMax are formed, which is what retention measures its window backwards
		// from. An implausible instant that got this far would delete the dataset.
		if (!isPlausibleInstant(t)) {
			this.skipped++;
			this.onWarning({
				code: 'BAD_TIMESTAMP',
				row,
				detail: 'unparseableTimestamp',
				sample: Number.isFinite(t) ? String(t) : null,
			});
			return false;
		}

		if (naive) this.naiveCount++;
		if (t < this.tMin) this.tMin = t;
		if (t > this.tMax) this.tMax = t;

		const event: NormalisedEvent = {
			t,
			seq: this.seq++,
			kind,
			source: actor,
			target,
			raw,
			preview: truncate(raw, this.previewBudget),
			naive,
		};
		if (this.retainEvents) this.events.push(event);
		this.onEvent?.(event);

		this.discover(kind, actor, raw, t, row, pathPrefix);
		return true;
	}

	private discover(kind: EventKind, actor: string, raw: string, t: number, row: number, prefix: string): void {
		if (raw === '') return;

		// `parent.key` joining, matching flatten.ts's own grammar. An empty path under a prefix
		// becomes the bare prefix, so a device publishing a scalar on a topic gets one series
		// named after that topic rather than an entry ending in a stray dot.
		const qualify = (path: string) => (prefix === '' ? path : path === '' ? prefix : `${prefix}.${path}`);

		const parsed = parseJsonLenient(raw);
		if (!parsed.ok) {
			// Not fatal, and not even unusual: `command` is an opaque string and AutoToggle
			// emits the bare word `on`. Record it as a one-field event so the value is still
			// filterable and visible, and warn only for a payload that *looks* structured.
			if (raw.startsWith('{') || raw.startsWith('[')) {
				this.onWarning({ code: 'BAD_JSON', row, detail: 'badJson', sample: truncate(raw, 80) });
			}
			this.tally(kind, actor, qualify(''), raw, undefined, t);
			return;
		}

		const paths = this.pathsFor(actorKey(kind, actor));
		if (paths === null) return;

		flatten(parsed.value, (path, value, unit) => {
			this.tallyInto(paths, kind, actor, qualify(path), value, unit, t);
		});
	}

	private tally(kind: EventKind, actor: string, path: string, value: unknown, unit: string | undefined, t: number): void {
		const paths = this.pathsFor(actorKey(kind, actor));
		if (paths === null) return;
		this.tallyInto(paths, kind, actor, path, value, unit, t);
	}

	/**
	 * One actor's path map, or null when the actor is new and the dataset is at its cap.
	 *
	 * The cap has to be tested here as well as in `tallyInto`, because the *outer* map is keyed
	 * by device name and a name is as source-chosen as a path is: refusing only the paths would
	 * still leave a peer minting one empty `Map` per invented device, without bound.
	 */
	private pathsFor(key: string): Map<string, FieldStats> | null {
		const existing = this.fields.get(key);
		if (existing !== undefined) return existing;
		if (this.seriesCount >= this.maxSeries) {
			this.noteSeriesCap();
			return null;
		}
		const paths = new Map<string, FieldStats>();
		this.fields.set(key, paths);
		return paths;
	}

	/**
	 * Say, once, that this dataset has stopped accepting new fields.
	 *
	 * Once per ingestor and never re-armed, unlike the live source's per-streak warnings: there
	 * is nothing to recover from — the catalogue is full for the rest of the dataset's life —
	 * and `warnings` is itself an unbounded array the load report renders, so warning per
	 * refused key would move the same leak into a different array.
	 */
	private noteSeriesCap(): void {
		if (this.seriesCapped) return;
		this.seriesCapped = true;
		this.onWarning({
			code: 'TOO_MANY_SERIES',
			row: null,
			detail: 'seriesCap',
			params: { n: this.maxSeries },
			sample: null,
		});
	}

	private tallyInto(
		paths: Map<string, FieldStats>,
		kind: EventKind,
		actor: string,
		path: string,
		value: unknown,
		unit: string | undefined,
		t: number,
	): void {
		let stats = paths.get(path);
		if (stats === undefined) {
			// The cap is on *minting*: a path already in the catalogue keeps being tallied and
			// keeps feeding its column, and only a path this dataset has never seen is turned
			// away. The whole sample is dropped rather than tallied without a column, so the
			// catalogue never lists a field the charts cannot draw.
			if (this.seriesCount >= this.maxSeries) {
				this.noteSeriesCap();
				return;
			}
			stats = { observed: 0, numeric: 0 };
			paths.set(path, stats);
			this.seriesCount++;
		}
		stats.observed++;
		if (unit !== undefined && stats.unit === undefined) stats.unit = unit;

		const numeric = coerceNumeric(value);
		if (numeric === undefined) return;
		stats.numeric++;
		this.onSample?.(kind, actor, path, t, numeric, unit);
	}

	finish(): IngestSummary {
		const times = this.events.map((event) => event.t);
		// Counted from what was accepted, not from the length of the log: `seq` is incremented
		// once per accepted event and nothing else moves it, so this is the same number the
		// array's length gives on a retaining ingestor — and stays the truth on one that keeps
		// no log rather than silently reporting an empty dataset.
		return {
			rows: this.seq,
			skipped: this.skipped,
			naive: this.naiveCount,
			inversions: countInversions(times),
			tMin: this.seq > 0 ? this.tMin : NaN,
			tMax: this.seq > 0 ? this.tMax : NaN,
			strayEra: detectStrayEra(times),
		};
	}
}

const STRAY_ERA_GAP_MS = 30 * 86_400_000;
const STRAY_ERA_MAX_SHARE = 0.01;

/**
 * Find a tiny cluster of timestamps sitting far from the bulk of the data.
 *
 * Not hypothetical: a replay run writes wall-clock rows before its first timestep and after
 * the clock resets, so a real `device_data.csv` can open with four rows in 2026 and
 * continue with five thousand in 2013. Charted naively that is one series with two dense
 * clusters thirteen years apart and nothing visible in between.
 *
 * Reported, never dropped. A backtest legitimately *can* straddle a boundary, and silently
 * discarding data is the one thing a debugging tool must not do — so the user is told, and
 * offered the exclusion as a choice.
 */
export function detectStrayEra(
	times: readonly number[],
): { count: number; tMin: number; tMax: number } | null {
	if (times.length < 20) return null;

	const sorted = [...times].sort((a, b) => a - b);
	const maxStray = Math.max(1, Math.floor(sorted.length * STRAY_ERA_MAX_SHARE));

	// A stray cluster can only be at one end; anything in the middle is just a gap.
	for (let count = 1; count <= maxStray; count++) {
		if (sorted[count]! - sorted[count - 1]! > STRAY_ERA_GAP_MS) {
			return { count, tMin: sorted[0]!, tMax: sorted[count - 1]! };
		}
		const tailIndex = sorted.length - count;
		if (sorted[tailIndex]! - sorted[tailIndex - 1]! > STRAY_ERA_GAP_MS) {
			return { count, tMin: sorted[tailIndex]!, tMax: sorted[sorted.length - 1]! };
		}
	}
	return null;
}
