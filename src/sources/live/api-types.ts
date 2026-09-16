/**
 * The EMS REST API's response shapes, transcribed from `services/rest_api.py`.
 *
 * Hand-written rather than generated: the service declares `response_model=None` on every
 * route, so there is no OpenAPI schema for the payloads — the contract is a hand-maintained
 * field allowlist on the Python side, frozen by a test there. These types are the matching
 * half, and every field below was read off that allowlist.
 */

export interface HealthClock {
	readonly simulated: boolean;
	/** Monotonic step counter. Never rewound by `clock.reset()`. */
	readonly generation: number;
	/** ISO-8601, **naive local**. Null under a wall-clock run. */
	readonly step_time: string | null;
	/** Participants that have not yet acked the current step — the wedged-replay diagnosis. */
	readonly pending: readonly string[];
}

export interface HealthResponse {
	/** 503 iff `down`. `degraded` deliberately stays 200 — see the service's own comment. */
	readonly status: 'ok' | 'degraded' | 'down';
	/** Service uptime, not process uptime. One decimal. */
	readonly uptime_seconds: number;
	readonly clock: HealthClock;
	readonly workers: {
		readonly total: number;
		readonly running: number;
		readonly finished: number;
		readonly down: number;
		readonly lost: number;
		readonly crashed: number;
		readonly restarts: number;
	};
	readonly devices: { readonly total: number; readonly connected: number; readonly data_ready: number };
}

/** Exactly the twelve keys `_device_payload` emits. */
export interface ApiDevice {
	readonly name: string;
	/** The Python class name, NOT the config kind: `kind: "p1"` arrives as `"P1"`. */
	readonly class: string;
	readonly connector: string | null;
	/** The *emulated* protocol — a replay with `emulates: "mqtt"` reports mqtt. */
	readonly protocol: string | null;
	readonly readable: boolean;
	readonly writable: boolean;
	readonly connected: boolean;
	readonly data_ready: boolean;
	/** Discovered dynamically from `api/capabilities.py`. Never hardcode today's three. */
	readonly capabilities: readonly string[];
	/** Null when the device implements no MetricSource, or when the call threw. */
	readonly metrics: Record<string, unknown> | null;
	readonly total_energy_kwh: number | null;
	/**
	 * Whatever the device's parser produced. No schema, by design.
	 *
	 * Non-finite floats arrive as the **strings** `"nan"` / `"inf"` / `"-inf"`; every dict
	 * key is stringified, so an integer key `1` becomes `"1"`; sets become arrays in
	 * arbitrary order; and anything past depth 10 becomes `str(value)`.
	 */
	readonly data: unknown;
}

export interface DevicesResponse {
	readonly count: number;
	/**
	 * ISO-8601 naive local, or null under a wall-clock run.
	 *
	 * This is the **step** clock. `device_data.csv` stamps readings with the **event**
	 * clock, and the API exposes no accessor for that one — so a live feed and a CSV of the
	 * same replay line up at step granularity, not sample for sample.
	 */
	readonly simulation_time: string | null;
	/** Sorted by name, explicitly stable across requests. */
	readonly devices: readonly ApiDevice[];
}

export type WorkerAxis = 'connector' | 'algorithm' | 'service' | 'unknown';
export type WorkerState = 'running' | 'finished' | 'down' | 'lost';

export interface ApiWorker {
	readonly name: string;
	readonly axis: WorkerAxis;
	readonly class: string;
	readonly state: WorkerState;
	readonly restarts: number;
	readonly crashes: number;
	readonly max_restarts: number;
	readonly restart_enabled: boolean;
	/** Null when the worker is not Stoppable — distinct from false. */
	readonly stopping: boolean | null;

	// --- axis-conditional. Always optional; test with `in`, never `!== undefined`. ---
	/** connector only: device names. */
	readonly devices?: readonly string[];
	readonly delay_seconds?: number;
	readonly required_devices?: readonly string[];
	readonly wait_for_devices_timeout?: number;
	readonly runs?: number;
	/** ISO or null — **wall clock**, not the sim clock. Never used as an event instant. */
	readonly last_run?: string | null;
	readonly last_run_seconds?: number | null;
	readonly step_participant?: boolean;
}

export interface WorkersResponse {
	readonly count: number;
	/** NOT sorted — supervisor insertion order, which is startup order. Preserve it. */
	readonly workers: readonly ApiWorker[];
}

// --- Runtime guards --------------------------------------------------------------------
//
// Liberal about the fields nobody reads. Strict about every field somebody does.
//
// The first half of that stays true: a future EMS may add fields, and a viewer that refuses a
// response for carrying one it does not know about is worse than one that ignores it. The
// second half is what was missing. These guards used to check the *containers* only — is
// `devices` an array, is `clock` an object — while the render path walked
// `device.capabilities` and `clock.pending`, and the normaliser read `device.connected` on
// every element. `{"devices":[null]}` passed, and so did a `clock` object with no `pending`
// key at all; the TypeError they threw had nowhere to land — out of the subscriber, out of the
// poll callback, ingestion dead while the dataset chip still read "streaming, 0 failures".
//
// So each of these now checks what is actually dereferenced, and where an element fails it is
// **dropped and the rest kept**: one unusable device must not cost the other forty-nine. What
// was thrown away is counted rather than swallowed — the caller turns a non-zero count into
// the malformed-shape warning, because a device that quietly vanished from a chart is exactly
// the kind of thing the load report exists to say out loud.

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A response that is safe to walk, and what had to be discarded to make it one.
 *
 * `defects` counts elements dropped and unwalkable lists replaced — never a field nobody
 * reads. Zero means the payload was exactly the shape this file documents.
 */
export interface Checked<T> {
	readonly value: T;
	readonly defects: number;
}

/**
 * A list of names — `clock.pending`, a device's `capabilities` — reduced to the strings in it.
 *
 * A missing or non-array list is one defect and becomes empty rather than costing the whole
 * response: the clock still resolves the dataset's time base without its pending list, and a
 * device is still telemetry without its capability chips.
 */
function names(value: unknown): { readonly list: readonly string[]; readonly defects: number } {
	if (!Array.isArray(value)) return { list: [], defects: 1 };
	const entries: readonly unknown[] = value;
	const list = entries.filter((entry): entry is string => typeof entry === 'string');
	return { list, defects: entries.length - list.length };
}

export function checkHealthResponse(value: unknown): Checked<HealthResponse> | null {
	if (!isRecord(value) || typeof value.status !== 'string') return null;
	const clock = value.clock;
	if (!isRecord(clock)) return null;
	if (!isRecord(value.workers) || !isRecord(value.devices)) return null;

	// `clock.pending` is the wedged-replay diagnosis, and the status page maps over it.
	const pending = names(clock.pending);
	return {
		// Spread rather than rebuilt, so a field a newer EMS added survives into the raw event
		// payload. Only what is walked is repaired.
		value: { ...value, clock: { ...clock, pending: pending.list } } as unknown as HealthResponse,
		defects: pending.defects,
	};
}

export function checkDevicesResponse(value: unknown): Checked<DevicesResponse> | null {
	if (!isRecord(value)) return null;
	const list = value.devices;
	if (!Array.isArray(list)) return null;
	const entries: readonly unknown[] = list;

	const devices: ApiDevice[] = [];
	let defects = 0;
	for (const entry of entries) {
		// `name` is identity, not decoration: it keys the dedupe table and names the actor
		// every sample is filed under. An element without one has nothing to be.
		if (!isRecord(entry) || typeof entry.name !== 'string') {
			defects++;
			continue;
		}
		const capabilities = names(entry.capabilities);
		defects += capabilities.defects;
		devices.push({ ...entry, capabilities: capabilities.list } as unknown as ApiDevice);
	}
	return { value: { ...value, devices } as unknown as DevicesResponse, defects };
}

/**
 * One row of `algorithm_decisions.csv`, as `GET /decisions` serves it.
 *
 * The field names are the CSV's on purpose. `live-normalise.ts` has to produce events
 * byte-identical to the ones `csv-source.ts` produces from the same decision, or the same run
 * read two ways lands on the timeline as two different things.
 */
export interface ApiDecision {
	/**
	 * Server-assigned, strictly increasing within `epoch`, never reused.
	 *
	 * Identity: an element without one is dropped, the same rule a device without a `name`
	 * takes. It is also the cursor — deliberately not a timestamp, because
	 * `docs/storage-format.md` §4 makes timestamps non-monotonic and duplicates legal, and
	 * under `speed=0` every decision in a timestep shares one instant.
	 */
	readonly seq: number;
	/** ISO-8601, and may be naive — the same two time domains the CSV carries. */
	readonly timestamp: string;
	readonly algorithm: string;
	readonly device: string;
	/**
	 * **Opaque.** `AutoToggle` emits the bare words `on`/`off`. Never `JSON.parse` this, and
	 * the EMS must never pre-parse it either: a parsed command would make a live decision and
	 * its own CSV row two different events.
	 */
	readonly command: string;
}

export interface DecisionsResponse {
	readonly count: number;
	/** Recorded since the EMS process started — the highest `seq` ever assigned. */
	readonly total: number;
	readonly retained: number;
	readonly capacity: number;
	/** Lowest `seq` still held, or null when the log is empty. */
	readonly oldest_seq: number | null;
	/** Records evicted between the cursor we sent and what is still held. */
	readonly missed: number;
	/** Pass back verbatim as `?after=`. Server-assigned, never our own `max(seq)`. */
	readonly next_cursor: number;
	/** The limit truncated this response — poll again now, do not wait out the interval. */
	readonly has_more: boolean;
	/** Identity of this process's sequence. A change means the EMS restarted. */
	readonly epoch: string;
	readonly simulation_time: string | null;
	readonly decisions: readonly ApiDecision[];
}

/**
 * Liberal about fields nobody reads, strict about every field that is dereferenced.
 *
 * `next_cursor` is **repaired** rather than rejected when it is missing or not a number: it is
 * the one field whose absence would otherwise stall the cursor forever, and `max(seq)` is a
 * correct fallback. Everything else follows the established rule — drop the bad element, count
 * the defect, keep the response.
 */
export function checkDecisionsResponse(value: unknown): Checked<DecisionsResponse> | null {
	if (!isRecord(value)) return null;
	const list = value.decisions;
	if (!Array.isArray(list)) return null;
	const entries: readonly unknown[] = list;

	const decisions: ApiDecision[] = [];
	let defects = 0;
	for (const entry of entries) {
		if (
			!isRecord(entry) ||
			typeof entry.seq !== 'number' ||
			!Number.isFinite(entry.seq) ||
			typeof entry.timestamp !== 'string' ||
			typeof entry.algorithm !== 'string' ||
			typeof entry.device !== 'string' ||
			typeof entry.command !== 'string'
		) {
			defects++;
			continue;
		}
		decisions.push(entry as unknown as ApiDecision);
	}

	let cursor = value.next_cursor;
	if (typeof cursor !== 'number' || !Number.isFinite(cursor)) {
		cursor = decisions.reduce((highest, decision) => Math.max(highest, decision.seq), 0);
		defects++;
	}

	return {
		value: { ...value, decisions, next_cursor: cursor } as unknown as DecisionsResponse,
		defects,
	};
}

export function checkWorkersResponse(value: unknown): Checked<WorkersResponse> | null {
	if (!isRecord(value)) return null;
	const list = value.workers;
	if (!Array.isArray(list)) return null;
	const entries: readonly unknown[] = list;

	const workers: ApiWorker[] = [];
	let defects = 0;
	for (const entry of entries) {
		// Same rule as a device, for the same reason: `name` keys the dedupe table and is the
		// actor of every worker event. Nothing else here is walked, so nothing else is asked.
		if (!isRecord(entry) || typeof entry.name !== 'string') {
			defects++;
			continue;
		}
		workers.push(entry as unknown as ApiWorker);
	}
	return { value: { ...value, workers } as unknown as WorkersResponse, defects };
}
