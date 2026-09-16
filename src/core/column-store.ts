import { append, createColumn, refreshGap, seal, type FieldColumn } from './columns.js';
import { MAX_SERIES, actorKey } from './ingest.js';
import type { EventKind } from './types.js';

/**
 * Every chartable series in a dataset, built during the **same** walk that discovers the
 * fields.
 *
 * The alternative — discover fields first, then scan the rows again to build each selected
 * series — is what the prototype did per redraw, at F×N per checkbox click. Flattening a
 * payload is the expensive part; doing it once and feeding both consumers is the whole
 * design.
 */
export class ColumnStore {
	/** `${actorKey}\0${path}` -> column. */
	private readonly columns = new Map<string, FieldColumn>();
	private refused = 0;

	/**
	 * `maxSeries` is the same per-dataset bound the ingestor applies to its catalogue, and is a
	 * parameter only so a test can reach the cap without minting fifty thousand keys.
	 *
	 * In practice the ingestor's cap trips first — every column has a catalogue entry, so the
	 * catalogue is never the smaller of the two — which is where the user-visible warning comes
	 * from. This one is the backstop for any other caller of `sample`, and it stays silent
	 * because a store has no warning channel and inventing one would duplicate that message.
	 */
	constructor(private readonly maxSeries: number = MAX_SERIES) {}

	static seriesKey(kind: EventKind, actor: string, path: string): string {
		return `${actorKey(kind, actor)}\0${path}`;
	}

	sample(kind: EventKind, actor: string, path: string, t: number, value: number, unit?: string): void {
		const key = ColumnStore.seriesKey(kind, actor, path);
		let column = this.columns.get(key);
		if (column === undefined) {
			// Refuse to mint, never to append: every series already here keeps taking samples.
			// `createColumn` allocates two Float64Array(64) — about 1 KB — before a single sample
			// lands, so an unbounded key space is unbounded resident memory whatever the values.
			if (this.columns.size >= this.maxSeries) {
				this.refused++;
				return;
			}
			column = createColumn(key, unit ?? null);
			this.columns.set(key, column);
		} else if (column.unit === null && unit !== undefined) {
			column.unit = unit;
		}
		append(column, t, value);
	}

	/** Samples dropped because minting their column would have passed the cap. */
	get refusedSamples(): number {
		return this.refused;
	}

	/**
	 * Delete the columns a trim has emptied. Retention calls this after `trimBefore`.
	 *
	 * `trimBefore` lowers `n` but leaves both buffers at their high-water capacity, and nothing
	 * else ever removed a column — so a series that has fallen entirely out of the window stayed
	 * resident for as long as the dataset was loaded, and held a slot against the cap. No reader
	 * can tell the difference: a chart card already skips a missing column and an `n === 0` one
	 * identically, and the field catalogue is untouched, so the picker still offers the field
	 * and a fresh column appears the moment the actor emits it again.
	 */
	evictEmpty(): number {
		let evicted = 0;
		for (const [key, column] of this.columns) {
			if (column.n > 0) continue;
			this.columns.delete(key);
			evicted++;
		}
		return evicted;
	}

	get(kind: EventKind, actor: string, path: string): FieldColumn | undefined {
		return this.columns.get(ColumnStore.seriesKey(kind, actor, path));
	}

	get size(): number {
		return this.columns.size;
	}

	/** Every column, for retention and for the live gap refresh. */
	values(): IterableIterator<FieldColumn> {
		return this.columns.values();
	}

	/** Sort and derive gap thresholds once ingest is finished. Finite sources only. */
	seal(): void {
		for (const column of this.columns.values()) seal(column);
	}

	/**
	 * The live counterpart of `seal()`: refresh gap thresholds from the recent cadence.
	 *
	 * Called once per batch. At 50 devices × ~10 paths × a 64-sample window that is ~32k
	 * comparisons per poll — free, and mandatory: see `refreshGap`.
	 */
	refreshGaps(window = 64): void {
		for (const column of this.columns.values()) refreshGap(column, window);
	}
}
