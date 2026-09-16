import { NO_FILTER, type TimelineFilter } from '../core/filter.js';
import { ColumnStore } from '../core/column-store.js';
import { splitActorKey } from '../core/ingest.js';
import type { FieldStats } from '../core/numeric.js';
import type { SeenActors, TopologyDoc } from '../core/topology.js';
import type { DatasetId, EventKind, NaiveZone, NormalisedEvent } from '../core/types.js';
import type { SourceStatus, SourceWarning } from '../sources/data-source.js';
import type { MessageKey, Params } from '../i18n/catalogue.js';
import type { Locale } from '../i18n/locale.js';

/**
 * One loaded dataset.
 *
 * The state model is a **list** of these, never a "current source" switch. A switch is the
 * degenerate case of a list holding one item, and the distinction is nearly free now and
 * expensive later: every chart, the timeline merge and the filters would each bake in "the
 * current source" if allowed to, and unpicking that is a rewrite of the state model.
 *
 * It is also what delivers the two things this app exists for — comparing an algorithm's
 * output against another run side by side, and the record → export → reload loop against a
 * still-running live subscription.
 */
export interface Dataset {
	readonly id: DatasetId;
	/** User-editable label. Defaults to the file name. */
	tag: string;
	readonly colour: string;
	readonly sourceKind: 'file' | 'live';
	/** False for a live subscription: the flag retention and follow mode key off. */
	readonly finite: boolean;
	readonly descriptorLabel: string;

	/**
	 * Sorted ascending by `(t, seq)`. **Mutated in place** as batches arrive — never put
	 * this behind a structural equality check.
	 *
	 * The order is a precondition, not a description: appended through `appendAscending`,
	 * which repairs a batch that arrives late rather than leaving the binary searches in
	 * `merge.ts`, `filter.ts` and `retention.ts` to run over unsorted data.
	 */
	events: NormalisedEvent[];
	/**
	 * `actorKey` -> path -> stats, handed over by the source once ingest completes.
	 * Read-only here: the store never edits a catalogue, it replaces the whole map.
	 */
	fields: ReadonlyMap<string, ReadonlyMap<string, FieldStats>>;
	/** Chartable series, keyed by ColumnStore.seriesKey. Mutable, held by reference. */
	columns: ColumnStore;

	/** Bumped whenever `events` or `fields` change, so selectors have something to compare. */
	revision: number;

	status: SourceStatus;
	warnings: SourceWarning[];
	/** How this dataset's naive timestamps are being read. */
	naiveZone: NaiveZone;
	naiveCount: number;
	/**
	 * How many events of each kind this dataset currently holds.
	 *
	 * Maintained as batches arrive and decremented when retention drops them, for the same
	 * reason `naiveCount` is: the alternative is a walk of every event of every dataset on
	 * every render, which is exactly what `core/merge.ts`'s index exists to avoid. The
	 * timeline's kind facet and the chip's reading count both read it.
	 *
	 * `fields` cannot stand in for it. That map is keyed by `actorKey`, so it does carry the
	 * set of kinds — a decision whose command is the bare string `on` still gets an entry,
	 * with one unchartable empty path. What it cannot give is *how many*, which is what the
	 * chip shows, and one tally serving both beats a cheap answer for one and a scan for the
	 * other.
	 */
	kindCounts: Map<EventKind, number>;
	/**
	 * How many events retention has discarded.
	 *
	 * Shown on the chip. Silent data loss is the one thing this app must not do, and a live
	 * dataset that quietly forgets its first hour is exactly that if nothing says so.
	 */
	droppedByRetention: number;
	tMin: number;
	tMax: number;
}

/**
 * One loaded `config.json`, describing what the EMS was *told* to run.
 *
 * A list, parallel to `datasets`, and deliberately **not** attached to one: a config describes
 * a run, and a run is at least two CSVs, so hanging it off `device_data.csv` would leave the
 * algorithm half dangling. Two sites means two overlays, matched against the union of what is
 * loaded.
 *
 * Unlike `Dataset` this is immutable and replaced wholesale. It is hundreds of entries, not
 * 100k events, so it must **not** copy the mutate-in-place/`revision` machinery around it —
 * that exists to keep large arrays out of the reactive graph, and there is no large array here.
 */
export interface Topology {
	readonly id: string;
	readonly label: string;
	/** Null when the document was refused. `warnings` then carries the reason. */
	readonly doc: TopologyDoc | null;
	readonly warnings: readonly SourceWarning[];
}

/**
 * Which of the three top-level views is showing.
 *
 * Home welcomes and routes; Workspace is the charts and the timeline over N loaded
 * datasets; Live status is the REST API's snapshot state, which has no time axis and never
 * reaches storage. A **live feed is not a view** — it is one more dataset in the Workspace,
 * because the state model is a dataset list and never a current-source switch.
 */
export type View = 'home' | 'workspace' | 'live';

export const VIEWS: readonly View[] = ['home', 'workspace', 'live'];

export function isView(value: unknown): value is View {
	return typeof value === 'string' && (VIEWS as readonly string[]).includes(value);
}

/**
 * What the boot probe found behind `/api`.
 *
 * Three states rather than a boolean, because "still checking" and "nothing there" render
 * very differently on Home and in the navbar, and a boolean forces one of them to be a lie
 * for the first ~1.5 seconds.
 */
export type LiveProbe = 'pending' | 'reachable' | 'unreachable';

/**
 * Whether the EMS behind `/api` serves a decision history.
 *
 * A property of the EMS's *version*, not of this viewer, so three states rather than a boolean:
 * `unknown` covers both "no EMS at all" and "the probe could not tell", and the UI must not
 * promise decisions in either case. Three sentences in the UI switch on this — none of them is
 * deleted when the answer is `absent`, because against an older EMS the old sentence is still
 * exactly true.
 */
export type LiveDecisions = 'unknown' | 'available' | 'absent';

/**
 * Whether we may *read* the EMS the probe found.
 *
 * Orthogonal to `liveProbe`, on purpose. A 401 means both are true in a way no single value
 * can express: the EMS is right there, answering, and we are locked out. Collapsing them
 * would show "file mode" to somebody whose EMS is running perfectly well and send them
 * hunting a network fault that does not exist.
 *
 * `liveProbe !== 'reachable'` implies phase `unknown`. The reverse does not hold: an EMS
 * with no gate in front of it is reachable and needs no sign-in at all.
 */
export type AuthState =
	| { readonly phase: 'unknown' }
	/** Reachable and ungated — there is nothing to sign in to. */
	| { readonly phase: 'none' }
	| {
			readonly phase: 'required';
			/**
			 * Four failures that read completely differently to a person. Showing "wrong
			 * password" for "the EMS is down" is how people end up retyping a correct
			 * password twenty times.
			 */
			readonly reason: 'initial' | 'rejected' | 'unreachable' | 'expired';
			readonly checking: boolean;
	  }
	| { readonly phase: 'authenticated'; readonly user: string };

export interface AppState {
	/** Insertion order is display order. */
	readonly datasets: readonly Dataset[];
	/** Loaded `config.json` documents. Empty in every session that never drops one. */
	readonly topologies: readonly Topology[];
	readonly filter: TimelineFilter;
	/** Authoritative viewport, in **epoch milliseconds** — never a re-parsed date string. */
	readonly viewport: readonly [number, number] | null;
	/** Absolute wall clock, or every dataset normalised to its own start. */
	readonly alignment: 'absolute' | 't0';
	/** Merged-timeline row the user last selected, for the chart-click handshake. */
	readonly selectedRow: number | null;
	readonly view: View;
	readonly locale: Locale;
	/** Whether the EMS REST API answered the boot probe. */
	readonly liveProbe: LiveProbe;
	/** Whether that EMS is new enough to serve `GET /decisions`. */
	readonly liveDecisions: LiveDecisions;
	readonly auth: AuthState;
	/**
	 * The sliding window a live feed keeps in view, counted in **samples, not minutes**.
	 *
	 * A separate number from the retention window, and deliberately so: "show me the last
	 * stretch" must not also mean "throw away the hour behind it".
	 *
	 * It used to be a duration, and a duration cannot work here. The window is measured in
	 * *data* time, and under a replay data time is not wall time — `speed: 0` advances the
	 * clock thousands of times faster than real time, so two polls two
	 * seconds apart land over five simulated hours apart. Every duration the UI offered
	 * (1, 5, 15, 60 minutes) was then narrower than the gap between two consecutive samples,
	 * so the window held one point or none and the feature did nothing at all. A count is
	 * the same size at any replay speed, and the axis labels still say what it spans.
	 */
	readonly follow: { readonly on: boolean; readonly samples: number };
	/** Set once the user dismisses the sign-in panel, so it stops reopening at them. */
	readonly loginDismissed: boolean;
	readonly toasts: readonly Toast[];
}

/**
 * A message key and its parameters — **not** a rendered sentence.
 *
 * Storing the finished English string would mean a toast raised before the user switched
 * language stayed in the old one forever, which is the visible half of a bug whose invisible
 * half is that nothing downstream could ever re-render it.
 */
export interface Toast {
	readonly id: number;
	readonly key: MessageKey;
	readonly params?: Params;
	readonly tone: 'info' | 'warning' | 'error';
}

export const INITIAL_STATE: AppState = {
	datasets: [],
	topologies: [],
	filter: NO_FILTER,
	viewport: null,
	alignment: 'absolute',
	selectedRow: null,
	view: 'home',
	// A pure constant, like NO_FILTER. Detection is an explicit act in AppStore's
	// constructor rather than a module-scope side effect in here.
	locale: 'en',
	liveProbe: 'pending',
	liveDecisions: 'unknown',
	auth: { phase: 'unknown' },
	follow: { on: true, samples: 200 },
	loginDismissed: false,
	toasts: [],
};

/**
 * Every actor name the loaded datasets have actually produced, by kind.
 *
 * Read from each dataset's `fields` catalogue, which holds one entry per `(kind, actor)` — not
 * from `events`, which is the walk of every row that `merge.ts`'s index and `kindCounts` exist
 * to avoid. The union across datasets is deliberate: two CSVs from one run are two datasets,
 * and a device is not "silent" because it appears in only one of them.
 */
export function seenActors(state: AppState): SeenActors {
	const readings = new Set<string>();
	const decisions = new Set<string>();
	const workers = new Set<string>();
	for (const dataset of state.datasets) {
		for (const key of dataset.fields.keys()) {
			const { kind, actor } = splitActorKey(key);
			if (kind === 'reading') readings.add(actor);
			else if (kind === 'decision') decisions.add(actor);
			else if (kind === 'worker') workers.add(actor);
		}
	}
	return { readings, decisions, workers };
}

/** Whether a live EMS is within reach. `pending` reads as "not yet", never as "no". */
export function isLiveAvailable(state: AppState): boolean {
	return state.liveProbe === 'reachable';
}

/**
 * Dataset colours, in assignment order.
 *
 * Distinguishable at a glance and legible on the dark background. Assigned by *dataset*,
 * not by series, so "everything in this colour came from that file" holds across the chip,
 * the chart legend and the timeline dot.
 *
 * Deliberately the same list, in the same order, as `SERIES_COLOURS` in
 * `charts/motrix-chart-card.ts` — the two axes are independent, but they paint onto the same
 * surface and so answer to the same validation. They used to hold these eight colours in
 * two different orders, which was drift rather than design.
 */
export const DATASET_COLOURS = [
	'#00AC94',
	'#C98500',
	'#0C84FA',
	'#49AC0D',
	'#DD499B',
	'#965CE5',
	'#EE5129',
	'#0098B1',
] as const;

export function nextColour(existing: readonly Dataset[]): string {
	return DATASET_COLOURS[existing.length % DATASET_COLOURS.length]!;
}

/** Total events across every dataset, for the summary bar. */
export function totalEvents(state: AppState): number {
	let total = 0;
	for (const dataset of state.datasets) total += dataset.events.length;
	return total;
}

/** Span covered by every loaded dataset, in absolute time. */
export function overallSpan(state: AppState): readonly [number, number] | null {
	let min = Infinity;
	let max = -Infinity;
	for (const dataset of state.datasets) {
		if (Number.isFinite(dataset.tMin)) min = Math.min(min, dataset.tMin);
		if (Number.isFinite(dataset.tMax)) max = Math.max(max, dataset.tMax);
	}
	return Number.isFinite(min) && Number.isFinite(max) ? [min, max] : null;
}

/**
 * The render-time shift for one dataset.
 *
 * Columns and events always hold **raw absolute epochs**; alignment is applied where the
 * data is already being copied, which makes it free and makes toggling lossless. In `t0`
 * mode every dataset is shifted so its own first sample lands on the anchor — the first
 * loaded dataset's start — which is what lets a 2013 backtest and a live feed share one
 * chart at all, since they have no wall-clock range in common.
 */
/**
 * The window follow mode wants, or null when there is nothing to follow.
 *
 * The right edge is `max(tMax)` over the **unbounded** datasets — deliberately not
 * `max(tMax, lastPollAt)`. `lastPollAt` is wall clock, so under a replay it would fling the
 * viewport thirteen years past the data on the very first tick. The consequence, which is
 * correct rather than a limitation: in a quiet wall-clock EMS the window stops advancing at
 * the last real sample. There is nothing newer to show, and the chip already says how long
 * ago the last poll was, so "the viewer is stuck" and "nothing changed" stay distinguishable.
 *
 * The left edge is the instant of the *n-th newest event* rather than `right - duration`,
 * which is what makes this work at any replay speed: see `AppState.follow`. `events` is
 * sorted ascending by contract, so counting back from the end is an index, not a search.
 */
export function followWindow(state: AppState): readonly [number, number] | null {
	if (!state.follow.on) return null;
	let leader: Dataset | null = null;
	for (const dataset of state.datasets) {
		if (dataset.finite || !Number.isFinite(dataset.tMax)) continue;
		if (leader === null || dataset.tMax > leader.tMax) leader = dataset;
	}
	if (leader === null || leader.events.length === 0) return null;

	const events = leader.events;
	const newest = events[events.length - 1]!.t;
	const oldest = events[Math.max(0, events.length - state.follow.samples)]!.t;
	// A zero-width scale is not a view, and uPlot cannot draw one. Under `speed: 0` every
	// event in a timestep shares an instant, so this is reachable whenever the window is
	// narrower than one step. Holding the previous scale is the honest answer.
	return oldest < newest ? [oldest, newest] : null;
}

export function datasetOffset(state: AppState, dataset: Dataset): number {
	if (state.alignment === 'absolute') return 0;
	const anchor = state.datasets.find((candidate) => Number.isFinite(candidate.tMin));
	if (anchor === undefined || !Number.isFinite(dataset.tMin)) return 0;
	return anchor.tMin - dataset.tMin;
}
