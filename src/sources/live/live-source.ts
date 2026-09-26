import { ColumnStore } from '../../core/column-store.js';
import { truncate } from '../../core/format.js';
import { Ingestor } from '../../core/ingest.js';
import { nowMs } from '../../core/time.js';
import type { DatasetId, NaiveZone, NormalisedEvent } from '../../core/types.js';
import type { DataSource, SourceDescriptor, SourceSink, SourceWarning } from '../data-source.js';
import {
	checkDecisionsResponse,
	checkDevicesResponse,
	checkHealthResponse,
	checkWorkersResponse,
} from './api-types.js';
import type { LiveFeed } from './live-feed.js';
import {
	createDedupeState,
	normaliseDecisions,
	normaliseDevices,
	normaliseHealth,
	normaliseWorkers,
	type LiveRecord,
	type TimeBase,
} from './live-normalise.js';
import type { PollOutcome } from './poller.js';

/**
 * Statuses that mean "this EMS does not have that route", as opposed to "that route failed".
 *
 * 404 is what FastAPI answers for an unregistered path; 405 and 501 are what a proxy or a
 * partial implementation in front of one may answer instead. Anything else is a fault and goes
 * down the normal warning path.
 */
const MISSING_ROUTE = new Set([404, 405, 501]);

export interface LiveSourceOptions {
	readonly devicesIntervalMs: number;
	readonly naiveZone: NaiveZone;
}

/**
 * The EMS's live state, as one more dataset beside the loaded backtests.
 *
 * Not a mode. The state model is a dataset **list**, so a live feed sits next to a 2013
 * replay on the same chart and the same timeline, and the only thing downstream that knows
 * the difference is `finite: false`.
 *
 * Decisions depend on the EMS's version. One that serves `GET /decisions` streams them here
 * beside the readings, cursored by sequence number; one that does not answers 404 and this
 * degrades to exactly its previous behaviour — readings and worker health, no diamonds — with
 * no warning and no failure count, because a missing route on an older build is not a fault.
 * The UI says which of the two is happening rather than leaving somebody to wonder.
 */
export class LiveSource implements DataSource {
	readonly kind = 'live' as const;
	readonly finite = false;

	private sink: SourceSink | null = null;
	private readonly unsubscribes: Array<() => void> = [];
	/** Endpoints whose most recent response was not the documented shape. See `noteShape`. */
	private readonly badShape = new Set<string>();
	/** Set while an unreadable EMS clock is being reported, so it is said once. See `noteClock`. */
	private clockWarned = false;
	private readonly dedupe = createDedupeState();
	private readonly columns = new ColumnStore();
	private readonly ingestor: Ingestor;
	/**
	 * The events the ingestor accepted during the `emit()` currently running.
	 *
	 * A batch is what this call produced, not a range of the ingestor's log: identifying it as
	 * `events.slice(lengthBeforeTheCall)` is an index into a shared, growing array, and it
	 * silently emits the wrong records the moment anything removes from that array's front.
	 * Drained on every `emit()`, so it holds nothing between calls.
	 */
	private readonly pending: NormalisedEvent[] = [];
	private base: TimeBase;
	private row = 0;
	private closed = false;

	constructor(
		readonly id: DatasetId,
		private readonly feed: LiveFeed,
		private readonly options: LiveSourceOptions,
	) {
		this.base = { resolved: false, simulated: false, lastStepTime: null, naiveZone: options.naiveZone };
		this.ingestor = new Ingestor({
			naiveZone: options.naiveZone,
			onWarning: (warning) => this.sink?.onWarning(warning),
			onSample: (kind, actor, path, t, value, unit) => this.columns.sample(kind, actor, path, t, value, unit),
			onEvent: (event) => this.pending.push(event),
			// The store keeps the events, and retention trims them there. A second copy here
			// would be trimmed by nothing: `trimDataset` splices the dataset's array, so every
			// event this feed ever produced — each holding the full `raw` snapshot, whose size
			// the EMS decides — would stay reachable from this source for as long as the dataset
			// is loaded, while the UI counted them as dropped. The ColumnStore below is shared
			// with the store on purpose and IS trimmed; this log was the copy that never was.
			retainEvents: false,
		});
	}

	get descriptor(): SourceDescriptor {
		return { type: 'live', baseUrl: '/api', intervalMs: this.options.devicesIntervalMs };
	}

	start(sink: SourceSink): void {
		if (this.sink !== null || this.closed) return;
		this.sink = sink;
		sink.onStatus({ phase: 'streaming', lastPollAt: nowMs(), consecutiveFailures: 0 });

		// `/health` is floored at the devices interval, and `/workers` at ten seconds, for one
		// reason: /health calls get_devices() on the EMS — a deep copy of every device under a
		// lock — to return twenty integers. There is no cheap liveness endpoint, so every
		// avoidable request is real work the EMS does not have to do.
		const devices = this.options.devicesIntervalMs;
		this.unsubscribes.push(
			this.feed.subscribe('devices', devices, (outcome) => this.onDevices(outcome)),
			this.feed.subscribe('health', Math.max(devices, 5000), (outcome) => this.onHealth(outcome)),
			this.feed.subscribe('workers', Math.max(devices, 10_000), (outcome) => this.onWorkers(outcome)),
			// Floored at 2s rather than 10s like /workers: /decisions is a cursored read over an
			// in-memory deque, not a deep copy of every device, so it is the cheapest of the four.
			this.feed.subscribe('decisions', Math.max(devices, 2000), (outcome) => this.onDecisions(outcome)),
		);
	}

	close(): void {
		this.closed = true;
		for (const unsubscribe of this.unsubscribes) unsubscribe();
		this.unsubscribes.length = 0;
		this.sink = null;
	}

	private onDevices(outcome: PollOutcome<unknown>): void {
		if (this.closed || this.sink === null) return;
		this.reportStatus(outcome);
		if (outcome.result.kind !== 'ok') return this.reportFailure(outcome, '/devices');

		const checked = checkDevicesResponse(outcome.result.value);
		this.noteShape('/devices', checked === null || checked.defects > 0);
		if (checked === null) return;

		const { records, stalled, stallSeconds, unreadableClock } = normaliseDevices(
			checked.value,
			this.base,
			this.dedupe,
			outcome.receivedAt,
			this.options.devicesIntervalMs,
		);
		this.noteClock(unreadableClock);
		if (stalled) {
			this.sink.onWarning({
				code: 'DUPLICATE_SNAPSHOT',
				row: null,
				detail: 'duplicateSnapshot',
				params: { seconds: stallSeconds, interval: Math.round(this.options.devicesIntervalMs / 1000) },
				sample: null,
			});
		}
		this.emit(records);
	}

	private onHealth(outcome: PollOutcome<unknown>): void {
		if (this.closed || this.sink === null) return;
		if (outcome.result.kind !== 'ok') return;

		const checked = checkHealthResponse(outcome.result.value);
		this.noteShape('/health', checked === null || checked.defects > 0);
		if (checked === null) return;

		const health = checked.value;
		// The clock decides the whole dataset's time base: under a replay a wall-clock stamp
		// would fling a 2013 backtest thirteen years from its own data.
		this.base = {
			resolved: true,
			simulated: health.clock.simulated,
			lastStepTime: health.clock.step_time ?? this.base.lastStepTime,
			naiveZone: this.options.naiveZone,
		};
		this.emit(normaliseHealth(health, this.base, this.dedupe, outcome.receivedAt));
	}

	private onWorkers(outcome: PollOutcome<unknown>): void {
		if (this.closed || this.sink === null) return;
		if (outcome.result.kind !== 'ok') return;

		const checked = checkWorkersResponse(outcome.result.value);
		this.noteShape('/workers', checked === null || checked.defects > 0);
		if (checked === null) return;
		this.emit(normaliseWorkers(checked.value, this.base, this.dedupe, outcome.receivedAt));
	}

	/**
	 * Decisions, from an EMS new enough to serve them.
	 *
	 * Deliberately does **not** call `reportStatus`: the chip's "streaming / retrying (n)" is
	 * about `/devices`, and a flapping decisions endpoint must not make a healthy reading feed
	 * look broken.
	 */
	private onDecisions(outcome: PollOutcome<unknown>): void {
		if (this.closed || this.sink === null) return;

		if (outcome.result.kind === 'http' && MISSING_ROUTE.has(outcome.result.status)) {
			// Not a failure. This is an EMS that predates the endpoint, and the honest response
			// is to stop asking and let the UI keep saying decisions are file-only.
			this.feed.markDecisionsUnavailable();
			return;
		}
		if (outcome.result.kind !== 'ok') return this.reportFailure(outcome, '/decisions');

		const checked = checkDecisionsResponse(outcome.result.value);
		this.noteShape('/decisions', checked === null || checked.defects > 0);
		if (checked === null) return;

		if (this.feed.takeDecisionsReset()) {
			this.sink.onWarning({ code: 'DECISIONS_RESET', row: null, detail: 'decisionsReset', sample: null });
		}
		if (checked.value.missed > 0) {
			// The EMS states the loss rather than leaving it to be inferred, so the viewer can
			// too — the same rule storage-format.md §7 applies to gaps in the CSV.
			this.sink.onWarning({
				code: 'DECISIONS_RESET',
				row: null,
				detail: 'decisionsGap',
				params: { n: checked.value.missed },
				sample: null,
			});
		}

		const { records, unreadable } = normaliseDecisions(checked.value, this.base, outcome.receivedAt);
		if (unreadable > 0) this.noteClock(checked.value.decisions[0]?.timestamp ?? null);
		this.emit(records);
	}

	private emit(records: readonly LiveRecord[]): void {
		if (this.sink === null) return;

		if (records.length === 0) return;

		this.pending.length = 0;
		for (const record of records) {
			this.ingestor.addAt(record.kind, record.actor, record.target, record.t, record.naive, record.raw, ++this.row, record.pathPrefix);
		}
		if (this.pending.length === 0) return;
		// A fresh array, and `pending` left empty by the same call: the store takes ownership of
		// a batch (see `SourceSink.onBatch`), so the source must hand over an array it does not
		// keep a reference to.
		const batch = this.pending.splice(0);

		// MANDATORY, not an optimisation. gapMs is otherwise 0 for every live column, and
		// alignSeries then turns every x where a series has no exact sample into null — so a
		// two-series chart, which is what a card auto-selects, draws nothing at all.
		this.columns.refreshGaps();
		this.sink.onFields(this.ingestor.fields, this.columns);
		this.sink.onBatch(batch);
	}

	private reportStatus(outcome: PollOutcome<unknown>): void {
		this.sink?.onStatus({
			phase: 'streaming',
			lastPollAt: outcome.receivedAt,
			consecutiveFailures: outcome.consecutiveFailures,
		});
	}

	/**
	 * Failures are warnings, not errors, and the source keeps polling.
	 *
	 * An unreachable EMS is the normal condition of a laptop that closed its lid — the poller
	 * backs off and recovers on its own, and tearing the dataset down would throw away every
	 * sample already collected. A 401 is the exception the ApiClient already funnels to the
	 * sign-in panel, so it is not re-reported here.
	 */
	private reportFailure(outcome: PollOutcome<unknown>, endpoint: string): void {
		if (outcome.result.kind === 'unauthorized') return;
		// One warning per failure *streak*, not per attempt: an EMS down overnight would
		// otherwise fill the load report with thousands of identical lines.
		if (outcome.consecutiveFailures !== 1) return;
		const status = outcome.result.kind === 'http' ? String(outcome.result.status) : outcome.result.kind;
		const warning: SourceWarning = {
			code: 'HTTP',
			row: null,
			detail: 'httpError',
			params: { status, endpoint },
			sample: null,
		};
		this.sink?.onWarning(warning);
	}

	/**
	 * Say, once per streak, that the EMS clock could not be read.
	 *
	 * Those snapshots are dropped rather than stamped with the client's clock — see
	 * `instantFor` — so without this a feed would go quiet with nothing on screen explaining
	 * why. Once per *streak* for the reason `reportFailure` gives: `warnings` is an unbounded
	 * array the load report renders, and an EMS repeating a bad clock every two seconds would
	 * otherwise fill it with thousands of identical lines. One readable clock re-arms it.
	 */
	private noteClock(stamp: string | null): void {
		if (stamp === null) {
			this.clockWarned = false;
			return;
		}
		if (this.clockWarned) return;
		this.clockWarned = true;
		this.sink?.onWarning({
			code: 'BAD_TIMESTAMP',
			row: null,
			detail: 'unparseableTimestamp',
			sample: truncate(stamp, 60),
		});
	}

	/**
	 * Say, once per streak, that an endpoint answered a shape we could not fully use.
	 *
	 * The same warning covers both cases on purpose: a payload that was wholly
	 * unrecognisable and one where some elements had to be dropped are the same diagnosis —
	 * the EMS said something this viewer does not understand — and the second is now
	 * reachable because the guards drop bad elements instead of throwing over them. Without
	 * it a device silently missing from every chart would have nothing on screen explaining
	 * why.
	 *
	 * Once per *streak*, for the reason `reportFailure` gives: `warnings` is an unbounded
	 * array the load report renders, and an EMS answering the wrong shape every two seconds
	 * would otherwise fill it with thousands of identical lines. One clean response re-arms
	 * it.
	 */
	private noteShape(endpoint: string, malformed: boolean): void {
		if (!malformed) {
			this.badShape.delete(endpoint);
			return;
		}
		if (this.badShape.has(endpoint)) return;
		this.badShape.add(endpoint);
		this.sink?.onWarning({
			code: 'UNKNOWN_SHAPE',
			row: null,
			detail: 'httpError',
			params: { status: 'unrecognised payload', endpoint },
			sample: null,
		});
	}
}
