import { parseStamp } from '../../core/time.js';
import type { EventKind, NaiveZone } from '../../core/types.js';
import type { ApiDevice, DecisionsResponse, DevicesResponse, HealthResponse, WorkersResponse } from './api-types.js';
import { canonicalHash } from './canonical.js';

/**
 * Snapshots in, records out. Pure, and the heart of the live source.
 *
 * A "record" is everything the ingestor needs and nothing about transport, so this file has
 * no idea polling exists.
 */
export interface LiveRecord {
	readonly kind: EventKind;
	readonly actor: string;
	readonly target: string | null;
	readonly t: number;
	readonly naive: boolean;
	readonly raw: string;
}

/** What each stream remembers between polls, so a repeat is recognisable as one. */
export interface DedupeState {
	readonly deviceHashes: Map<string, string>;
	readonly workerHashes: Map<string, string>;
	healthHash: string | null;
	lastSimTime: string | null;
	/** Consecutive `/devices` polls in which literally nothing moved. */
	unchangedPolls: number;
	/** Set while a stall is being reported, so it is reported once and not 450 times. */
	stallReported: boolean;
}

export function createDedupeState(): DedupeState {
	return {
		deviceHashes: new Map(),
		workerHashes: new Map(),
		healthHash: null,
		lastSimTime: null,
		unchangedPolls: 0,
		stallReported: false,
	};
}

export interface TimeBase {
	/**
	 * False until the first `/health` response lands.
	 *
	 * Until then we do not know *which clock the EMS is on*, and a stream that carries no
	 * timestamp of its own has nothing safe to be stamped with. Guessing the client clock
	 * puts a 2026 worker event in a 2013 replay and gives the dataset a thirteen-year span.
	 */
	readonly resolved: boolean;
	/** True once `/health` reports a simulated clock; decides which clock stamps events. */
	readonly simulated: boolean;
	/** Last `clock.step_time` seen, for streams that carry no clock of their own. */
	readonly lastStepTime: string | null;
	readonly naiveZone: NaiveZone;
}

/** The EMS clock string a snapshot would be stamped with, or null when it offered none. */
function clockCandidate(simTime: string | null, base: TimeBase): string | null {
	return simTime ?? (base.simulated ? base.lastStepTime : null);
}

/**
 * Resolve an instant for one snapshot, or null when there is none to be had.
 *
 * Under a replay the EMS's own clock is the only sane axis — a wall-clock stamp would put a
 * 2013 backtest thirteen years from its own data. In wall-clock mode `simulation_time` is
 * null and the client's receive time is all there is, which is honest as long as the UI says
 * the viewer did the sampling.
 *
 * But when the EMS *did* offer a clock and it could not be read — malformed, or an instant so
 * implausible that `parseStamp` refuses it — the client clock is **not** a substitute for it.
 * Under a replay it lands thirteen years past the data, and being the newest instant in the
 * dataset it becomes `tMax`, which retention measures its window backwards from: one such
 * snapshot deletes the entire collected history. The snapshot is dropped instead, exactly as
 * a CSV row with an unreadable timestamp is dropped, and the caller reports it.
 */
function instantFor(simTime: string | null, base: TimeBase, receivedAt: number): { t: number; naive: boolean } | null {
	const candidate = clockCandidate(simTime, base);
	if (candidate === null) return { t: receivedAt, naive: false };
	const stamp = parseStamp(candidate, base.naiveZone);
	return Number.isNaN(stamp.t) ? null : { t: stamp.t, naive: stamp.naive };
}

/**
 * The five telemetry keys, and only those.
 *
 * `class` / `connector` / `protocol` / `readable` / `writable` / `capabilities` are
 * *configuration*: they change when somebody edits `config.json`, not when a meter reads.
 * Hashing them would make a restart look like a measurement. That exclusion is exactly why
 * they get first-class treatment on the status page and appear nowhere in the time series.
 *
 * `connected` and `data_ready` *are* hashed, so a connectivity flip emits an event — and
 * since the numeric coercion deliberately refuses booleans, it lands as a timeline row
 * rather than a fabricated 0/1 series.
 */
function deviceTelemetry(device: ApiDevice): unknown {
	return {
		connected: device.connected,
		data_ready: device.data_ready,
		metrics: device.metrics,
		total_energy_kwh: device.total_energy_kwh,
		data: device.data,
	};
}

export interface NormaliseResult {
	readonly records: readonly LiveRecord[];
	/** True when this poll found the whole EMS unchanged for long enough to be worth saying. */
	readonly stalled: boolean;
	readonly stallSeconds: number;
	/** The EMS clock string this poll could not be stamped with, or null when it read fine. */
	readonly unreadableClock: string | null;
}

export function normaliseDevices(
	response: DevicesResponse,
	base: TimeBase,
	state: DedupeState,
	receivedAt: number,
	intervalMs: number,
): NormaliseResult {
	const instant = instantFor(response.simulation_time, base, receivedAt);
	if (instant === null) {
		// Nothing in `state` is touched, so the snapshot is not remembered as seen: the next
		// poll carrying a readable clock republishes it rather than losing it to dedupe.
		return {
			records: [],
			stalled: false,
			stallSeconds: 0,
			unreadableClock: clockCandidate(response.simulation_time, base),
		};
	}
	const { t, naive } = instant;
	const simAdvanced = response.simulation_time !== null && response.simulation_time !== state.lastSimTime;
	const records: LiveRecord[] = [];

	for (const device of response.devices) {
		const hash = canonicalHash(deviceTelemetry(device));
		const previous = state.deviceHashes.get(device.name);

		// The whole rule, and it falls straight out of what the API does and does not offer.
		//
		// `simulation_time` is the single signal for "is this repeated snapshot a NEW
		// observation, or the same one seen twice". Under a replay it advances every step, so
		// an identical payload at a new step is a genuine re-publication and must be emitted —
		// without this a device holding 0 W for a hundred steps becomes one point and the
		// chart draws nothing. In wall-clock mode it is null, so the rule degenerates to
		// payload-only, which is the 450-duplicates case, correctly suppressed.
		//
		// It is deliberately NOT part of the hash: hashing it would defeat dedupe entirely
		// under a replay, which is the case that needs it most.
		if (previous !== hash || simAdvanced) {
			records.push({
				kind: 'reading',
				actor: device.name,
				target: null,
				t,
				naive,
				raw: JSON.stringify(devicePayload(device, response.simulation_time, receivedAt)),
			});
			state.deviceHashes.set(device.name, hash);
		}
	}

	const changed = records.length > 0;
	state.lastSimTime = response.simulation_time;
	state.unchangedPolls = changed ? 0 : state.unchangedPolls + 1;
	if (changed) state.stallReported = false;

	// A stall detector, not a per-duplicate warning: 450 entries in the load report would be
	// noise, and this is the only thing that can tell a user staring at a flat chart that the
	// viewer is working and the site is not.
	const threshold = Math.max(30, Math.ceil(60_000 / Math.max(1, intervalMs)));
	const stalled = !state.stallReported && state.unchangedPolls >= threshold;
	if (stalled) state.stallReported = true;

	return {
		records,
		stalled,
		stallSeconds: Math.round((state.unchangedPolls * intervalMs) / 1000),
		unreadableClock: null,
	};
}

/**
 * What lands in the timeline row and in the field catalogue.
 *
 * The API's twelve-key envelope is flattened away except for the parts that exist nowhere
 * else. `data` keeps its own key so live field paths read `data.…` — which does **not** match
 * the CSV's paths, where `data_json` is the root. The alternative is dropping
 * `total_energy_kwh` and `metrics`, which the CSV has no equivalent for at all, so the
 * mismatch is the lesser loss. Both clocks are recorded so a future history endpoint can
 * replace the client one without touching the store.
 */
function devicePayload(device: ApiDevice, simulationTime: string | null, receivedAt: number): unknown {
	return {
		'@t': { simulation: simulationTime, client: receivedAt },
		connected: device.connected,
		data_ready: device.data_ready,
		...(device.total_energy_kwh === null ? {} : { total_energy_kwh: device.total_energy_kwh }),
		...(device.metrics === null ? {} : { metrics: device.metrics }),
		data: device.data,
	};
}

export function normaliseHealth(
	response: HealthResponse,
	base: TimeBase,
	state: DedupeState,
	receivedAt: number,
): readonly LiveRecord[] {
	// Resolved before the hash is remembered, so a snapshot dropped for an unreadable clock is
	// not recorded as already seen — the next readable poll still emits it.
	const instant = instantFor(response.clock.step_time, base, receivedAt);
	if (instant === null) return [];

	// `uptime_seconds` is excluded from the hash by construction: it changes on every single
	// poll, so hashing it would defeat dedupe completely. It stays in the payload, where it
	// is useful — it is just not a change signal. `clock.generation` IS hashed, so under a
	// replay health emits once per step.
	const hash = canonicalHash({ status: response.status, clock: response.clock, workers: response.workers, devices: response.devices });
	if (hash === state.healthHash) return [];
	state.healthHash = hash;

	const { t, naive } = instant;
	return [
		{
			kind: 'health',
			actor: '(ems)',
			target: null,
			t,
			naive,
			raw: JSON.stringify({ '@t': { simulation: response.clock.step_time, client: receivedAt }, ...response }),
		},
	];
}

export function normaliseWorkers(
	response: WorkersResponse,
	base: TimeBase,
	state: DedupeState,
	receivedAt: number,
): readonly LiveRecord[] {
	// `/workers` carries NO clock at all, so it has to borrow the one `/health` reports.
	// Until that first health response lands we do not know whether the EMS is on wall time
	// or replaying 2013 — and guessing wrong is not a rounding error, it is a thirteen-year
	// span that wrecks every chart axis in the dataset. `/workers` polls at 10s and `/health`
	// at 5s, so this drops at most one round of worker state, and only at startup.
	if (!base.resolved) return [];
	const instant = instantFor(null, base, receivedAt);
	// Same rule as above: a borrowed clock that cannot be read is not replaced by the client's.
	if (instant === null) return [];
	const { t, naive } = instant;
	const records: LiveRecord[] = [];

	for (const worker of response.workers) {
		const { name, axis, class: className, max_restarts, restart_enabled, ...rest } = worker;
		void axis;
		void className;
		void max_restarts;
		void restart_enabled;
		const hash = canonicalHash(rest);
		if (state.workerHashes.get(name) === hash) continue;
		state.workerHashes.set(name, hash);
		records.push({
			kind: 'worker',
			actor: name,
			target: null,
			t,
			naive,
			// No special case for algorithms: `runs` and `last_run_seconds` genuinely move on
			// every tick, so an algorithm worker emits about once per poll and a connector
			// almost never. That asymmetry is the truth, and dedupe produces it for free.
			raw: JSON.stringify({ '@t': { simulation: base.lastStepTime, client: receivedAt, source: 'inferred' }, ...worker }),
		});
	}
	return records;
}

/**
 * `GET /decisions` in, decision records out.
 *
 * **No `DedupeState` parameter, and that absence is the design.** `canonicalHash` exists
 * because `/devices` is a *snapshot* endpoint with no history: without dedupe every poll would
 * re-record an unchanged device forever. `/decisions` is the opposite shape — an append-only
 * log with a cursor, where every element has already been filtered by `?after=` and each one
 * is a distinct event that really happened. Content-hash dedupe would actively destroy it:
 * `AutoToggle → shelly_plug → on` at two consecutive steps is two decisions with identical
 * content, and the project's own golden fixture is six `off` followed by twelve `on`.
 *
 * `parseStamp`, not `instantFor`: a decision carries its own recorded stamp, so none of the
 * borrowed-clock machinery applies. That also makes it the one live stream that never drops a
 * record for an unreadable EMS clock.
 */
export function normaliseDecisions(
	response: DecisionsResponse,
	base: TimeBase,
	receivedAt: number,
): { readonly records: readonly LiveRecord[]; readonly unreadable: number } {
	void receivedAt;
	const records: LiveRecord[] = [];
	let unreadable = 0;

	for (const decision of response.decisions) {
		const stamp = parseStamp(decision.timestamp, base.naiveZone);
		if (Number.isNaN(stamp.t)) {
			unreadable++;
			continue;
		}
		records.push({
			kind: 'decision',
			actor: decision.algorithm,
			target: decision.device,
			t: stamp.t,
			naive: stamp.naive,
			// The command **verbatim**, with no `@t` envelope. `csv-source.ts` passes exactly
			// this string as the payload cell, and that identity is the whole of what "live and
			// file decisions merge" means — wrap it and the two paths produce different events
			// for the same decision.
			raw: decision.command,
		});
	}

	// `seq` order is *write* order, not event order, so one batch can hold an inversion the
	// moment two connector threads appended around a step boundary. Sorting ≤ limit elements
	// here removes every intra-batch one; `appendAscending` still repairs across batches.
	records.sort((a, b) => a.t - b.t);
	return { records, unreadable };
}
