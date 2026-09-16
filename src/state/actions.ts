import { createContext } from '@lit/context';

import type { TimelineFilter } from '../core/filter.js';
import type { DatasetId, NaiveZone } from '../core/types.js';
import type { DataSource, SourceSink, SourceStatus, SourceWarning } from '../sources/data-source.js';
import { ColumnStore } from '../core/column-store.js';
import { appendAscending } from '../core/order.js';
import type { MessageKey, Params } from '../i18n/catalogue.js';
import { detectLocale, storeLocale, type Locale } from '../i18n/locale.js';
import { setActiveLocale } from '../i18n/translator.js';
import { detailText } from '../i18n/warnings.js';
import { CsvFileSource } from '../sources/file/csv-source.js';
import { readText } from '../sources/file/read-text.js';
import {
	looksLikeConfigJson,
	MAX_CONFIG_BYTES,
	parseTopology,
	type TopologyParse,
} from '../core/topology.js';
import { DEFAULT_RETENTION, trimDataset, type RetentionPolicy } from '../core/retention.js';
import { ApiClient, basicCredential } from '../sources/live/api-client.js';
import { checkDecisionsResponse } from '../sources/live/api-types.js';
import { LiveFeed } from '../sources/live/live-feed.js';
import { LiveSource } from '../sources/live/live-source.js';
import {
	INITIAL_STATE,
	nextColour,
	type AppState,
	type Dataset,
	type Toast,
	type Topology,
	type View,
} from './app-state.js';
import { readCredential, writeCredential } from './credential.js';
import { Store } from './store.js';

export const storeContext = createContext<AppStore>(Symbol('motrix-store'));

let nextId = 0;
let nextToastId = 0;

/**
 * The store plus the actions that write to it.
 *
 * Actions are ordinary methods rather than dispatched objects: they are greppable, they
 * type-check their arguments, and there is no reducer indirection to read through when
 * something changes unexpectedly.
 */
export class AppStore extends Store<AppState> {
	private readonly sources = new Map<DatasetId, DataSource>();

	/** The one place a credential is attached. Shared by the probe, the live source and the status page. */
	readonly api = new ApiClient();

	/**
	 * One scheduler for the whole app.
	 *
	 * Owned here rather than by LiveSource because the status page must poll with zero live
	 * datasets loaded, and because two consumers of /devices should cost one request.
	 */
	readonly liveFeed = new LiveFeed(this.api);

	private retention: RetentionPolicy = DEFAULT_RETENTION;

	/**
	 * Ordering repairs, per dataset: the running total and where its warning sits.
	 *
	 * A WeakMap keyed by the `Dataset` rather than a field on it — this is bookkeeping for one
	 * warning, it has no business in the state components read, and a removed dataset takes
	 * its entry with it.
	 */
	private readonly repairs = new WeakMap<Dataset, { total: number; index: number }>();

	/** Basic auth carries no identity back, so the user name is only what was typed. */
	private signedInUser: string | null = null;

	constructor() {
		super(INITIAL_STATE);
		// One funnel for every 401 in the app, wherever it happens.
		this.api.onUnauthorized = () => this.credentialExpired();
		// Detection is explicit here rather than a side effect inside INITIAL_STATE, which
		// stays a pure constant. It deliberately does NOT persist: writing the detected
		// locale on first boot would freeze it forever and stop the app following the
		// browser. Only setLocale() — an actual user choice — writes.
		const locale = detectLocale();
		setActiveLocale(locale);
		this.set((state) => ({ ...state, locale }));
	}

	setLocale(locale: Locale): void {
		// ORDER IS LOAD-BEARING. The module-level translator must already hold the new
		// catalogue before set() notifies, or every subscriber re-renders reading the
		// previous one and the whole UI paints one language behind the picker.
		setActiveLocale(locale);
		storeLocale(locale);
		this.set((state) => ({ ...state, locale }));
	}

	// --- datasets ---------------------------------------------------------------------

	/** Load a dropped or picked CSV file as a new dataset. */
	addFile(file: File, naiveZone: NaiveZone = 'local'): DatasetId {
		const id = `ds-${++nextId}`;
		const source = new CsvFileSource(id, file, { naiveZone });
		this.registerDataset(
			{
				id,
				tag: file.name,
				colour: nextColour(this.get().datasets),
				sourceKind: 'file',
				finite: true,
				descriptorLabel: file.name,
				events: [],
				fields: new Map(),
				columns: new ColumnStore(),
				revision: 0,
				status: { phase: 'idle' },
				warnings: [],
				naiveZone,
				naiveCount: 0,
				kindCounts: new Map(),
				droppedByRetention: 0,
				tMin: NaN,
				tMax: NaN,
			},
			source,
		);
		return id;
	}

	/**
	 * Load already-parsed text. Used by the "try it now" sample and by tests.
	 *
	 * Goes through the same ingest path as a real file, so the sample cannot drift into
	 * being a special case that works when the real thing does not.
	 */
	addText(name: string, text: string, naiveZone: NaiveZone = 'local'): DatasetId {
		const file = new File([text], name, { type: 'text/csv' });
		return this.addFile(file, naiveZone);
	}

	/**
	 * Route a dropped file to the CSV path or the config path, **by content, not extension**.
	 *
	 * The classification lives here rather than in the drop zone because deciding needs the
	 * file's first bytes, and "what a dropped file becomes" is already this store's job — the
	 * zone stays a dumb emitter and its event contract does not change. A `.json` file holding
	 * CSV therefore loads as CSV, and a config saved under any other name still loads.
	 *
	 * Only the head is read, as a Blob view rather than a copy. A `{`-leading file over
	 * `MAX_CONFIG_BYTES` is refused unread: it is the one path with no chunking and no
	 * progress reporting behind it.
	 */
	async addDropped(file: File, naiveZone: NaiveZone = 'local'): Promise<void> {
		const head = await readText(file.slice(0, 4096));
		if (!looksLikeConfigJson(head)) {
			this.addFile(file, naiveZone);
			return;
		}
		if (file.size > MAX_CONFIG_BYTES) {
			this.registerTopology(file.name, {
				doc: null,
				warnings: [{ code: 'CONFIG_SHAPE', row: null, detail: 'configTooLarge', sample: null }],
			});
			return;
		}
		this.addConfigText(file.name, await readText(file));
	}

	/**
	 * Load a `config.json` as a topology overlay.
	 *
	 * A refused document still becomes a `Topology` record, for the same reason a refused CSV
	 * still gets a chip with a load report: the refusal needs somewhere to land, and a toast
	 * alone loses the reason the moment it is dismissed.
	 */
	addConfigText(label: string, text: string): string {
		const parsed = parseTopology(text);
		const id = this.registerTopology(label, parsed);
		if (parsed.doc !== null) {
			this.toast('toast.configLoaded', { n: parsed.doc.entries.length, name: label });
		}
		return id;
	}

	private registerTopology(label: string, parsed: TopologyParse): string {
		const id = `cfg-${++nextId}`;
		const topology: Topology = { id, label, doc: parsed.doc, warnings: parsed.warnings };
		// Deliberately no navigation, unlike registerDataset: a config on its own has nothing to
		// plot, and Home is where the panel already lives — so a user who drops one first sees
		// the declared topology with nothing matched against it yet, which is useful by itself.
		this.set((state) => ({ ...state, topologies: [...state.topologies, topology] }));
		return id;
	}

	removeTopology(id: string): void {
		this.set((state) => ({ ...state, topologies: state.topologies.filter((entry) => entry.id !== id) }));
	}

	/**
	 * Subscribe to a running EMS as one more dataset.
	 *
	 * Deliberately the same shape as `addFile`: the two go through `registerDataset`, and
	 * everything downstream distinguishes them by `finite` alone.
	 */
	addLive(options: { intervalMs?: number; naiveZone?: NaiveZone } = {}): DatasetId {
		const id = `ds-${++nextId}`;
		const intervalMs = options.intervalMs ?? 2000;
		const naiveZone = options.naiveZone ?? 'local';
		const source = new LiveSource(id, this.liveFeed, { devicesIntervalMs: intervalMs, naiveZone });
		this.registerDataset(
			{
				id,
				// Says what it is at a glance, everywhere the tag appears: the EMS did not
				// record this series at this rate — the viewer sampled it.
				tag: `live @ ${Math.round(intervalMs / 1000)}s`,
				colour: nextColour(this.get().datasets),
				sourceKind: 'live',
				finite: false,
				descriptorLabel: `/api · ${Math.round(intervalMs / 1000)}s`,
				events: [],
				fields: new Map(),
				columns: new ColumnStore(),
				revision: 0,
				status: { phase: 'idle' },
				warnings: [],
				naiveZone,
				naiveCount: 0,
				kindCounts: new Map(),
				droppedByRetention: 0,
				tMin: NaN,
				tMax: NaN,
			},
			source,
		);
		return id;
	}

	private registerDataset(dataset: Dataset, source: DataSource): void {
		this.set((state) => ({
			...state,
			datasets: [...state.datasets, dataset],
			// Dropping a file *is* the navigation intent — nobody's goal is "load a file", it
			// is "look at this run". Only on the empty -> non-empty edge, though: adding a
			// second file while deliberately reading Home must not yank the user out of it.
			// Done here rather than at render time, because a navigation side effect inside
			// render() is a footgun, and this is one set() instead of two notifications.
			view: state.datasets.length === 0 && state.view === 'home' ? 'workspace' : state.view,
		}));
		this.sources.set(dataset.id, source);
		source.start(this.sinkFor(dataset.id));
	}

	private sinkFor(id: DatasetId): SourceSink {
		return {
			onBatch: (events) => {
				let dropped = 0;
				this.mutate(id, (dataset) => {
					// Push rather than concat: the array is held by reference on purpose, and
					// a 100k-element copy per batch is exactly what the revision counter and
					// the "big data outside the reactive graph" rule exist to avoid. That is
					// still what an ordered batch costs here — but the push cannot be blind.
					// `events` is documented ascending by (t, seq) and the merge, the window
					// filter and retention all binary-search it, while a live feed takes its
					// instants from the EMS's own clock: a /workers poll carrying a borrowed,
					// staler step time than an interleaved /devices poll inverts the order with
					// nothing hostile happening. A file source has already sorted, so this is
					// its fast path and nothing more.
					const repaired = appendAscending(dataset.events, events);
					if (repaired > 0) this.noteRepair(dataset, repaired);
					for (const event of events) {
						if (event.naive) dataset.naiveCount++;
						dataset.kindCounts.set(event.kind, (dataset.kindCounts.get(event.kind) ?? 0) + 1);
						if (!(dataset.tMin <= event.t)) dataset.tMin = event.t;
						if (!(dataset.tMax >= event.t)) dataset.tMax = event.t;
					}

					// Retention, in exactly one place, behind exactly one guard.
					if (dataset.finite) return;
					const trimmed = trimDataset(dataset.events, dataset.columns, dataset.tMax, this.retention);
					if (trimmed.eventsDropped === 0) return;
					// tMin MUST be reassigned. The NaN-safe idiom above only ever moves it
					// *down*, so after a trim it would point at a deleted sample — and
					// `datasetOffset` would anchor t₀ to data that no longer exists while
					// `overallSpan` lied about the loaded range.
					dataset.tMin = trimmed.tMin;
					// tMax MUST be reassigned for the mirror-image reason, and it is the worse
					// failure: the idiom above only ever moves it *up*, and it is what the
					// cutoff on the line above is measured back from. Left pointing at a
					// deleted sample it keeps the cutoff ahead of every batch that arrives
					// afterwards, and `followWindow` derives the viewport from it as well.
					dataset.tMax = trimmed.tMax;
					// Same reasoning as tMin/tMax: a tally that only counts upward would keep
					// offering a filter for a kind that has entirely aged out of the window.
					for (const [kind, gone] of trimmed.droppedByKind) {
						const left = (dataset.kindCounts.get(kind) ?? 0) - gone;
						if (left > 0) dataset.kindCounts.set(kind, left);
						else dataset.kindCounts.delete(kind);
					}
					dataset.droppedByRetention += trimmed.eventsDropped;
					dropped += trimmed.eventsDropped;
				});
				// `selectedRow` is a position into the *merged* index, which spans datasets —
				// so a trim silently turns a selection into a different row, and shifting it
				// is not possible. Clearing is the only honest option.
				if (dropped > 0 && this.get().selectedRow !== null) this.selectRow(null);
			},
			onFields: (fields, columns) =>
				this.mutate(id, (dataset) => {
					dataset.fields = fields;
					dataset.columns = columns;
				}),
			onWarning: (warning: SourceWarning) => this.mutate(id, (dataset) => void dataset.warnings.push(warning)),
			onStatus: (status: SourceStatus) => {
				this.mutate(id, (dataset) => void (dataset.status = status));
				if (status.phase !== 'error') return;
				// The sentence differs by source: "could not load" is wrong for a poller that
				// was streaming happily until the EMS went away.
				const live = this.get().datasets.find((dataset) => dataset.id === id)?.sourceKind === 'live';
				const message =
					status.detail === undefined ? status.message : detailText(status.detail, status.params);
				this.toast(live ? 'toast.liveFailed' : 'toast.loadFailed', { message }, 'error');
			},
		};
	}

	/**
	 * Tell the user a batch had to be put back into time order.
	 *
	 * **One line in the load report per dataset, carrying a running total**, rather than one
	 * per repaired event: `warnings` is an unbounded array the report renders, and an EMS
	 * whose clock keeps stepping backwards — a replay that loops, two endpoints stamped from
	 * different steps — would otherwise fill it thousands of lines deep. It is the same
	 * throttle `LiveSource` applies to a bad clock, tightened to one line because the count is
	 * the whole message.
	 *
	 * `nonMonotonic` is reused rather than invented: the file path already raises exactly this
	 * fact from `Ingestor.finish()`, the sentence is written in all four catalogues, and it is
	 * already a counted (plural) message.
	 */
	private noteRepair(dataset: Dataset, repaired: number): void {
		const state = this.repairs.get(dataset) ?? { total: 0, index: -1 };
		state.total += repaired;
		const warning: SourceWarning = {
			code: 'NON_MONOTONIC',
			row: null,
			detail: 'nonMonotonic',
			params: { n: state.total },
			sample: null,
		};
		// Replaced in place on every later repair. Warnings are only ever appended, so the
		// remembered index stays valid for the life of the dataset.
		if (state.index === -1) {
			state.index = dataset.warnings.length;
			dataset.warnings.push(warning);
		} else {
			dataset.warnings[state.index] = warning;
		}
		this.repairs.set(dataset, state);
	}

	removeDataset(id: DatasetId): void {
		this.sources.get(id)?.close();
		this.sources.delete(id);
		this.set((state) => ({ ...state, datasets: state.datasets.filter((dataset) => dataset.id !== id) }));
	}

	retagDataset(id: DatasetId, tag: string): void {
		this.mutate(id, (dataset) => void (dataset.tag = tag));
	}

	/** Mutate a dataset in place and bump its revision, then republish the list. */
	private mutate(id: DatasetId, change: (dataset: Dataset) => void): void {
		this.set((state) => {
			const index = state.datasets.findIndex((dataset) => dataset.id === id);
			if (index === -1) return state as AppState;
			const dataset = state.datasets[index]!;
			change(dataset);
			dataset.revision++;
			// New array identity so list selectors fire; the Dataset objects are shared.
			return { ...state, datasets: [...state.datasets] };
		});
	}

	// --- filter and viewport ------------------------------------------------------------

	setFilter(patch: Partial<TimelineFilter>): void {
		this.set((state) => ({ ...state, filter: { ...state.filter, ...patch } }));
	}

	clearFilter(): void {
		this.set((state) => ({
			...state,
			filter: { datasets: null, kinds: null, actors: null, targets: null, text: null, window: null },
		}));
	}

	/**
	 * Epoch milliseconds, always. The prototype stored chart-library date strings here.
	 *
	 * Any **user** viewport change turns follow mode off, and it happens here rather than in
	 * a component so there is nothing to remember at the call sites: the chart drag, "Reset
	 * zoom" and "Clear zoom" all already call this and all get the 'user' default. Only the
	 * follow updater passes 'follow', and only it keeps follow on.
	 */
	setViewport(window: readonly [number, number] | null, source: 'user' | 'follow' = 'user'): void {
		this.set((state) => ({
			...state,
			viewport: window,
			filter: { ...state.filter, window },
			follow: source === 'user' ? { ...state.follow, on: false } : state.follow,
		}));
	}

	setFollow(patch: Partial<AppState['follow']>): void {
		this.set((state) => ({ ...state, follow: { ...state.follow, ...patch } }));
	}

	setAlignment(alignment: AppState['alignment']): void {
		this.set((state) => ({ ...state, alignment }));
	}

	selectRow(row: number | null): void {
		this.set((state) => ({ ...state, selectedRow: row }));
	}

	// --- navigation ---------------------------------------------------------------------------

	setView(view: View): void {
		this.set((state) => (state.view === view ? state : { ...state, view }));
	}

	// --- the boot probe and auth --------------------------------------------------------------

	/**
	 * One request, `GET /api/health`, carrying whatever credential storage had.
	 *
	 * | result                                   | liveProbe     | auth          |
	 * |------------------------------------------|---------------|---------------|
	 * | network error / timeout (`file://`, none)| unreachable   | unknown       |
	 * | 200 or 503, no credential sent           | reachable     | none          |
	 * | 200 or 503, credential sent              | reachable     | authenticated |
	 * | **401**                                  | **reachable** | **required**  |
	 * | 502/504 — nginx up, no rest_api service  | unreachable   | unknown       |
	 * | anything else                            | unreachable   | unknown       |
	 *
	 * 502 is silent by design and already documented as intended: it means the viewer is
	 * served but the EMS declares no `rest_api` service. So is 500 — a broken gate is not
	 * the browser's problem to shout about, and the container refuses to start rather than
	 * starting degraded, so its log already says so.
	 *
	 * 1500 ms, deliberately shorter than a sign-in attempt: this runs unbidden at boot and
	 * must be invisible when it fails, which is the normal case for a double-clicked file.
	 */
	async probeLive(): Promise<void> {
		const stored = readCredential();
		this.api.setCredential(stored);
		const result = await this.api.get<unknown>('/health', { timeoutMs: 1500 });

		// A sign-in the user started before this resolved must not be clobbered by a late
		// probe, so only write while nothing else has claimed the phase.
		if (this.get().auth.phase !== 'unknown') return;

		if (result.kind === 'unauthorized') {
			// The stored credential is demonstrably stale — discard rather than retry it.
			this.api.setCredential(null);
			writeCredential(null);
			this.set((state) => ({
				...state,
				liveProbe: 'reachable',
				auth: { phase: 'required', reason: 'initial', checking: false },
			}));
			return;
		}
		if (result.kind === 'ok') {
			this.set((state) => ({
				...state,
				liveProbe: 'reachable',
				auth: stored === null ? { phase: 'none' } : { phase: 'authenticated', user: this.signedInUser ?? '' },
			}));
			await this.probeDecisions();
			return;
		}
		this.set((state) => ({ ...state, liveProbe: 'unreachable', auth: { phase: 'unknown' } }));
	}

	/**
	 * One request that answers two questions: does this EMS serve decisions, and where is its
	 * sequence now.
	 *
	 * `limit=0` is a seek-to-head probe — it delivers nothing and reports the current head as
	 * `next_cursor` — so seeding costs one cheap request and a live dataset connected later
	 * starts from the present instead of replaying the EMS's whole buffer into a chart whose
	 * retention window would immediately delete most of it.
	 *
	 * A non-404 failure leaves the state `unknown` rather than `absent`: the route may exist and
	 * be momentarily unwell, and the first real poll will settle it.
	 */
	private async probeDecisions(): Promise<void> {
		const result = await this.api.get<unknown>('/decisions?after=-1&limit=0', { timeoutMs: 1500 });
		if (result.kind === 'ok') {
			// A 200 is not enough. A proxy that answers every path, or an EMS whose /decisions
			// is something else entirely, would otherwise have the UI promise decisions that
			// never arrive. The shape guard is the actual capability check.
			const checked = checkDecisionsResponse(result.value);
			if (checked === null) return;
			this.liveFeed.seedDecisionsCursor(checked.value.next_cursor);
			this.set((state) => ({ ...state, liveDecisions: 'available' }));
			return;
		}
		if (result.kind === 'http' && [404, 405, 501].includes(result.status)) {
			this.liveFeed.markDecisionsUnavailable();
			this.set((state) => ({ ...state, liveDecisions: 'absent' }));
		}
	}

	/**
	 * Try a credential against the gate before storing it.
	 *
	 * ~5000 ms rather than the probe's 1500: this is a deliberate act with a spinner in
	 * front of it, and failing it fast only makes people click twice.
	 */
	async signIn(user: string, password: string): Promise<void> {
		const credential = basicCredential(user, password);
		this.set((state) => ({ ...state, auth: { phase: 'required', reason: 'initial', checking: true } }));

		const result = await this.api.get<unknown>('/health', { credential, timeoutMs: 5000 });
		if (result.kind === 'ok') {
			this.signedInUser = user;
			this.api.setCredential(credential);
			writeCredential(credential);
			this.set((state) => ({
				...state,
				liveProbe: 'reachable',
				auth: { phase: 'authenticated', user },
			}));
			return;
		}

		const reason = result.kind === 'unauthorized' ? 'rejected' : 'unreachable';
		this.set((state) => ({ ...state, auth: { phase: 'required', reason, checking: false } }));
	}

	signOut(): void {
		this.signedInUser = null;
		this.api.setCredential(null);
		writeCredential(null);
		this.set((state) => ({
			...state,
			loginDismissed: false,
			auth: { phase: 'required', reason: 'initial', checking: false },
		}));
	}

	/** Reached from `ApiClient.onUnauthorized` — the gate stopped accepting us mid-session. */
	private credentialExpired(): void {
		if (this.get().auth.phase !== 'authenticated') return;
		this.signedInUser = null;
		this.api.setCredential(null);
		writeCredential(null);
		this.set((state) => ({
			...state,
			loginDismissed: false,
			auth: { phase: 'required', reason: 'expired', checking: false },
		}));
	}

	dismissLogin(): void {
		this.set((state) => ({ ...state, loginDismissed: true }));
	}

	reopenLogin(): void {
		this.set((state) => ({ ...state, loginDismissed: false }));
	}

	// --- toasts ---------------------------------------------------------------------------

	toast(key: MessageKey, params?: Params, tone: Toast['tone'] = 'info'): void {
		const toast: Toast = { id: ++nextToastId, key, params, tone };
		this.set((state) => ({ ...state, toasts: [...state.toasts, toast] }));
	}

	dismissToast(id: number): void {
		this.set((state) => ({ ...state, toasts: state.toasts.filter((toast) => toast.id !== id) }));
	}
}

