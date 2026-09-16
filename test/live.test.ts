import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ColumnStore } from '../src/core/column-store.js';
import { append, createColumn, fullSlice, refreshGap } from '../src/core/columns.js';
import { alignSeries } from '../src/core/align.js';
import { lowerBound, upperBound } from '../src/core/filter.js';
import { Ingestor, MAX_SERIES } from '../src/core/ingest.js';
import { appendAscending } from '../src/core/order.js';
import { DEFAULT_RETENTION, trimDataset } from '../src/core/retention.js';
import type { DatasetId, NormalisedEvent } from '../src/core/types.js';
import type { SourceSink, SourceWarning } from '../src/sources/data-source.js';
import { AppStore } from '../src/state/actions.js';
import { INITIAL_STATE, followWindow, type AppState, type Dataset } from '../src/state/app-state.js';
import { ApiClient } from '../src/sources/live/api-client.js';
 import { parseCsvText } from '../src/sources/file/csv-source.js';
 import { readFixture } from './helpers/fixtures.js';
import {
	checkDecisionsResponse,
	checkDevicesResponse,
	checkHealthResponse,
	checkWorkersResponse,
	type ApiDevice,
	type DevicesResponse,
	type HealthResponse,
	type WorkersResponse,
} from '../src/sources/live/api-types.js';
import { canonicalHash } from '../src/sources/live/canonical.js';
import {
	createDedupeState,
	normaliseDecisions,
	normaliseDevices,
	normaliseHealth,
	normaliseWorkers,
	type TimeBase,
} from '../src/sources/live/live-normalise.js';
import { LiveFeed } from '../src/sources/live/live-feed.js';
import { LiveSource } from '../src/sources/live/live-source.js';
import { EndpointPoller, type PollOutcome, type PollerDeps } from '../src/sources/live/poller.js';

// Only the sample names the privacy rule permits: p1_meter, shelly_plug, pseudo_sensor,
// AutoToggle. Nothing here may resemble a real site.
function device(name: string, data: unknown, overrides: Partial<ApiDevice> = {}): ApiDevice {
	return {
		name,
		class: 'P1',
		connector: 'replay',
		protocol: 'mqtt',
		readable: true,
		writable: false,
		connected: true,
		data_ready: true,
		capabilities: ['EnergyMeter'],
		metrics: null,
		total_energy_kwh: null,
		data,
		...overrides,
	};
}

function devices(simulationTime: string | null, list: readonly ApiDevice[]): DevicesResponse {
	return { count: list.length, simulation_time: simulationTime, devices: list };
}

const WALL_CLOCK: TimeBase = { resolved: true, simulated: false, lastStepTime: null, naiveZone: 'local' };
const SIMULATED: TimeBase = {
	resolved: true,
	simulated: true,
	lastStepTime: '2013-09-27T00:03:00+02:00',
	naiveZone: 'local',
};
const UNRESOLVED: TimeBase = { resolved: false, simulated: false, lastStepTime: null, naiveZone: 'local' };

describe('canonicalHash', () => {
	it('ignores object key order, which does not survive the Python boundary', () => {
		// _jsonable stringifies every dict key, and V8 then hoists integer-like keys ahead of
		// the rest regardless of what Python emitted. Insertion order is not a signal.
		expect(canonicalHash({ a: 1, b: 2 })).toBe(canonicalHash({ b: 2, a: 1 }));
		expect(canonicalHash({ 1: 'x', b: 'y' })).toBe(canonicalHash({ b: 'y', 1: 'x' }));
	});

	it('respects array order, because the flattener addresses by position', () => {
		// `data.3.obis.class` names an index, so a reordered OBIS list genuinely is a
		// different reading and must not hash equal.
		expect(canonicalHash([1, 2])).not.toBe(canonicalHash([2, 1]));
	});

	it('cannot be confused by a key/value boundary', () => {
		// Length-prefixing is what stops {"a": "1"} colliding with {"a1": ""}.
		expect(canonicalHash({ a: '1' })).not.toBe(canonicalHash({ a1: '' }));
	});

	it('separates a number from its string form, which the API can emit for either', () => {
		expect(canonicalHash({ v: 1 })).not.toBe(canonicalHash({ v: '1' }));
	});

	it('separates null from absent and from false', () => {
		expect(canonicalHash({ v: null })).not.toBe(canonicalHash({}));
		expect(canonicalHash({ v: null })).not.toBe(canonicalHash({ v: false }));
	});
});

describe('dedupe — what makes a live feed not garbage', () => {
	it('emits nothing for an identical snapshot', () => {
		// Polling a fifteen-minute meter every two seconds would otherwise manufacture 450
		// identical readings: a dense chart of nothing.
		const state = createDedupeState();
		const snapshot = devices(null, [device('p1_meter', { power: 120 })]);

		expect(normaliseDevices(snapshot, WALL_CLOCK, state, 1000, 2000).records).toHaveLength(1);
		expect(normaliseDevices(snapshot, WALL_CLOCK, state, 3000, 2000).records).toHaveLength(0);
		expect(normaliseDevices(snapshot, WALL_CLOCK, state, 5000, 2000).records).toHaveLength(0);
	});

	it('emits when a payload actually changes', () => {
		const state = createDedupeState();
		normaliseDevices(devices(null, [device('p1_meter', { power: 120 })]), WALL_CLOCK, state, 1000, 2000);
		const next = normaliseDevices(devices(null, [device('p1_meter', { power: 121 })]), WALL_CLOCK, state, 3000, 2000);
		expect(next.records).toHaveLength(1);
	});

	it('emits an unchanged payload when the EMS advanced a step', () => {
		// The case that decides the whole rule. Under a replay `simulation_time` advances
		// every step, so an identical payload at a new step is a genuine re-publication —
		// without this a device holding 0 W for a hundred steps becomes ONE point and the
		// chart draws nothing.
		const state = createDedupeState();
		const payload = [device('shelly_plug', { power: '0' })];
		expect(normaliseDevices(devices('2013-09-27T00:00:00+02:00', payload), SIMULATED, state, 1, 2000).records).toHaveLength(1);
		expect(normaliseDevices(devices('2013-09-27T00:15:00+02:00', payload), SIMULATED, state, 2, 2000).records).toHaveLength(1);
		// Same step, same payload: still a duplicate.
		expect(normaliseDevices(devices('2013-09-27T00:15:00+02:00', payload), SIMULATED, state, 3, 2000).records).toHaveLength(0);
	});

	it('notices a connectivity flip, which is telemetry', () => {
		const state = createDedupeState();
		const data = { power: 1 };
		normaliseDevices(devices(null, [device('p1_meter', data)]), WALL_CLOCK, state, 1, 2000);
		const flipped = normaliseDevices(
			devices(null, [device('p1_meter', data, { connected: false })]),
			WALL_CLOCK,
			state,
			2,
			2000,
		);
		expect(flipped.records).toHaveLength(1);
	});

	it('ignores a configuration change, which is not telemetry', () => {
		// A connector rename is a status-page fact. Treating it as a measurement would put a
		// spurious sample on every chart the moment somebody edits config.json.
		const state = createDedupeState();
		const data = { power: 1 };
		normaliseDevices(devices(null, [device('p1_meter', data)]), WALL_CLOCK, state, 1, 2000);
		const renamed = normaliseDevices(
			devices(null, [device('p1_meter', data, { connector: 'mqtt-2', protocol: 'lora' })]),
			WALL_CLOCK,
			state,
			2,
			2000,
		);
		expect(renamed.records).toHaveLength(0);
	});

	it('reports a stall once, not once per duplicate', () => {
		const state = createDedupeState();
		const snapshot = devices(null, [device('p1_meter', { power: 1 })]);
		let stalls = 0;
		for (let i = 0; i < 200; i++) {
			if (normaliseDevices(snapshot, WALL_CLOCK, state, i, 2000).stalled) stalls++;
		}
		// 450 warnings in an unbounded array the load report renders would be noise; one
		// diagnosis is the point.
		expect(stalls).toBe(1);
	});

	it('re-arms the stall detector once something moves', () => {
		const state = createDedupeState();
		const still = devices(null, [device('p1_meter', { power: 1 })]);
		for (let i = 0; i < 100; i++) normaliseDevices(still, WALL_CLOCK, state, i, 2000);
		normaliseDevices(devices(null, [device('p1_meter', { power: 2 })]), WALL_CLOCK, state, 101, 2000);

		let stalled = false;
		for (let i = 0; i < 100; i++) {
			if (normaliseDevices(devices(null, [device('p1_meter', { power: 2 })]), WALL_CLOCK, state, i, 2000).stalled) {
				stalled = true;
			}
		}
		expect(stalled).toBe(true);
	});
});

describe('live time base', () => {
	it('stamps with the EMS clock under a replay, not the wall clock', () => {
		// A wall-clock stamp would fling a 2013 backtest thirteen years from its own data.
		const state = createDedupeState();
		const { records } = normaliseDevices(
			devices('2013-09-27T00:03:00+02:00', [device('p1_meter', { power: 1 })]),
			SIMULATED,
			state,
			Date.parse('2026-08-09T10:00:00Z'),
			2000,
		);
		expect(new Date(records[0]!.t).getUTCFullYear()).toBe(2013);
	});

	it('falls back to the client clock when the EMS runs on wall time', () => {
		const state = createDedupeState();
		const { records } = normaliseDevices(devices(null, [device('p1_meter', { power: 1 })]), WALL_CLOCK, state, 1_700_000_000_000, 2000);
		expect(records[0]!.t).toBe(1_700_000_000_000);
		expect(records[0]!.naive).toBe(false);
	});

	it('records both clocks on the event, so a history endpoint can replace one later', () => {
		const state = createDedupeState();
		const { records } = normaliseDevices(
			devices('2013-09-27T00:03:00+02:00', [device('p1_meter', { power: 1 })]),
			SIMULATED,
			state,
			42,
			2000,
		);
		const payload = JSON.parse(records[0]!.raw) as { '@t': { simulation: string; client: number } };
		expect(payload['@t']).toEqual({ simulation: '2013-09-27T00:03:00+02:00', client: 42 });
	});
});

describe('health and worker streams', () => {
	function health(overrides: Partial<HealthResponse> = {}): HealthResponse {
		return {
			status: 'ok',
			uptime_seconds: 12.5,
			clock: { simulated: false, generation: 3, step_time: null, pending: [] },
			workers: { total: 2, running: 2, finished: 0, down: 0, lost: 0, crashed: 0, restarts: 0 },
			devices: { total: 1, connected: 1, data_ready: 1 },
			...overrides,
		};
	}

	it('ignores uptime, which changes on every single poll', () => {
		// Hashing uptime_seconds would defeat health dedupe completely. It stays in the
		// payload because it is useful; it is just not a change signal.
		const state = createDedupeState();
		expect(normaliseHealth(health(), WALL_CLOCK, state, 1)).toHaveLength(1);
		expect(normaliseHealth(health({ uptime_seconds: 14.5 }), WALL_CLOCK, state, 2)).toHaveLength(0);
	});

	it('emits when the replay clock advances a generation', () => {
		const state = createDedupeState();
		normaliseHealth(health(), WALL_CLOCK, state, 1);
		const next = normaliseHealth(
			health({ clock: { simulated: true, generation: 4, step_time: null, pending: [] } }),
			WALL_CLOCK,
			state,
			2,
		);
		expect(next).toHaveLength(1);
	});

	it('holds worker events back until the clock mode is known', () => {
		// /workers carries no clock of its own, so before the first /health response there is
		// nothing safe to stamp it with. Guessing the client clock would put a 2026 event in
		// a 2013 replay and give the dataset a thirteen-year span — which is what happened,
		// in a real browser, before this guard existed.
		const state = createDedupeState();
		const response: WorkersResponse = {
			count: 1,
			workers: [
				{
					name: 'AutoToggle',
					axis: 'algorithm',
					class: 'AutoToggle',
					state: 'running',
					restarts: 0,
					crashes: 0,
					max_restarts: 3,
					restart_enabled: true,
					stopping: false,
				},
			],
		};
		expect(normaliseWorkers(response, UNRESOLVED, state, 1)).toHaveLength(0);
		expect(normaliseWorkers(response, SIMULATED, state, 2)).toHaveLength(1);
	});

	it('emits a worker only when its state moves', () => {
		const state = createDedupeState();
		const workers = (restarts: number): WorkersResponse => ({
			count: 1,
			workers: [
				{
					name: 'AutoToggle',
					axis: 'algorithm',
					class: 'AutoToggle',
					state: 'running',
					restarts,
					crashes: 0,
					max_restarts: 3,
					restart_enabled: true,
					stopping: false,
				},
			],
		});
		expect(normaliseWorkers(workers(0), WALL_CLOCK, state, 1)).toHaveLength(1);
		expect(normaliseWorkers(workers(0), WALL_CLOCK, state, 2)).toHaveLength(0);
		expect(normaliseWorkers(workers(1), WALL_CLOCK, state, 3)).toHaveLength(1);
	});
});

/**
 * What the guards check, which used to be the containers and nothing in them.
 *
 * `isDevicesResponse` asked whether `devices` was an array; the normaliser then read
 * `device.connected` off every element and the status page mapped over
 * `device.capabilities`. One `null` in that array was a TypeError with nowhere to land.
 */
describe('response guards', () => {
	it('drops an element it cannot walk instead of throwing over it', () => {
		const checked = checkDevicesResponse(JSON.parse('{"count":1,"simulation_time":null,"devices":[null]}'));
		expect(checked).not.toBeNull();
		expect(checked!.value.devices).toHaveLength(0);
		expect(checked!.defects, 'a silent drop is the failure mode one level along').toBe(1);
		expect(() => normaliseDevices(checked!.value, WALL_CLOCK, createDedupeState(), 1, 2000)).not.toThrow();
	});

	it('keeps a device that has merely lost a list, with the list empty', () => {
		// `capabilities` is decoration — the status page renders it as chips — while `name` is
		// identity. Losing the chips must not cost the telemetry.
		const checked = checkDevicesResponse(JSON.parse('{"devices":[{"name":"m"}]}'));
		expect(checked!.value.devices).toHaveLength(1);
		expect(checked!.value.devices[0]!.capabilities).toEqual([]);
		expect(checked!.defects).toBe(1);
		expect(() => normaliseDevices(checked!.value, WALL_CLOCK, createDedupeState(), 1, 2000)).not.toThrow();
	});

	it('keeps the elements it can walk beside the ones it cannot', () => {
		// The whole reason this drops rather than rejects: one unusable device must not cost
		// the other forty-nine.
		const checked = checkDevicesResponse({
			count: 3,
			simulation_time: null,
			devices: [null, device('p1_meter', { power: 1 }), 'not a device'],
		});
		expect(checked!.value.devices.map((entry) => entry.name)).toEqual(['p1_meter']);
		expect(checked!.defects).toBe(2);
	});

	it('finds nothing wrong with a response that is entirely right', () => {
		// The counter is what raises the warning, so a false positive here would put a
		// permanent "unrecognised payload" line in the load report of a healthy EMS.
		const checked = checkDevicesResponse(devices('2013-09-27T00:03:00+02:00', [device('p1_meter', { power: 1 })]));
		expect(checked!.defects).toBe(0);
	});

	it('still refuses a response with no list at all', () => {
		expect(checkDevicesResponse({ count: 0, devices: {} })).toBeNull();
		expect(checkDevicesResponse(null)).toBeNull();
		expect(checkWorkersResponse({ count: 0 })).toBeNull();
		expect(checkHealthResponse({ status: 'ok' })).toBeNull();
	});

	it('drops a worker with no name, which is the key its dedupe is filed under', () => {
		const checked = checkWorkersResponse({ count: 2, workers: [null, { name: 'AutoToggle', state: 'running' }] });
		expect(checked!.value.workers).toHaveLength(1);
		expect(checked!.defects).toBe(1);
		expect(() => normaliseWorkers(checked!.value, WALL_CLOCK, createDedupeState(), 1)).not.toThrow();
	});

	it('gives the clock an empty pending list rather than losing the whole time base', () => {
		// `clock` passed the old guard for being a record, and the status page then read
		// `clock.pending.length` inside render(). Rejecting the response outright would be its
		// own bug: the clock is how a replay dataset gets a 2013 axis instead of a 2026 one.
		const checked = checkHealthResponse(JSON.parse('{"status":"ok","clock":{},"workers":{},"devices":{}}'));
		expect(checked!.value.clock.pending).toEqual([]);
		expect(checked!.defects).toBe(1);
	});

	it('drops the entries of a pending list that are not names', () => {
		const checked = checkHealthResponse({ status: 'ok', clock: { pending: ['AutoToggle', 7, null] }, workers: {}, devices: {} });
		expect(checked!.value.clock.pending).toEqual(['AutoToggle']);
		expect(checked!.defects).toBe(2);
	});

	it('keeps fields it has never heard of, which is the half that was always right', () => {
		// A viewer that refuses a response for carrying a field a newer EMS added is worse
		// than one that ignores it — and the raw event payload keeps that field.
		const checked = checkDevicesResponse({ devices: [{ name: 'p1_meter', capabilities: [], future: 7 }], future: 'x' });
		expect((checked!.value as unknown as Record<string, unknown>).future).toBe('x');
		expect((checked!.value.devices[0] as unknown as Record<string, unknown>).future).toBe(7);
		expect(checked!.defects).toBe(0);
	});
});

describe('EndpointPoller', () => {
	let deps: PollerDeps;
	let hidden = false;

	beforeEach(() => {
		hidden = false;
		vi.useFakeTimers();
		deps = {
			setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
			clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
			now: () => Date.now(),
			isHidden: () => hidden,
		};
	});

	function client(reply: () => Response): { api: ApiClient; calls: () => number } {
		let calls = 0;
		const fake = (async () => {
			calls++;
			return reply();
		}) as unknown as typeof fetch;
		return { api: new ApiClient(fake), calls: () => calls };
	}

	const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });

	it('polls at the requested cadence', async () => {
		const { api, calls } = client(ok);
		const poller = new EndpointPoller(api, '/devices', 2000, () => {}, deps);
		poller.start();
		await vi.advanceTimersByTimeAsync(0);
		expect(calls()).toBe(1);
		await vi.advanceTimersByTimeAsync(6100);
		expect(calls()).toBe(4);
		poller.stop();
	});

	it('never has more than one request in flight, however slow the EMS is', async () => {
		// The reason this is a chained setTimeout and not setInterval: with setInterval a
		// response slower than the interval stacks requests until something falls over.
		let inFlight = 0;
		let maxInFlight = 0;
		const slow = (async () => {
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await new Promise((resolve) => globalThis.setTimeout(resolve, 5000));
			inFlight--;
			return ok();
		}) as unknown as typeof fetch;

		const poller = new EndpointPoller(new ApiClient(slow), '/devices', 1000, () => {}, deps);
		poller.start();
		await vi.advanceTimersByTimeAsync(30_000);
		expect(maxInFlight).toBe(1);
		poller.stop();
	});

	it('widens its retries and resets on success', async () => {
		let fail = true;
		const { api } = client(() => (fail ? new Response('', { status: 500 }) : ok()));
		const failures: number[] = [];
		const poller = new EndpointPoller(api, '/devices', 1000, (o) => failures.push(o.consecutiveFailures), deps);
		poller.start();
		await vi.advanceTimersByTimeAsync(40_000);
		expect(Math.max(...failures)).toBeGreaterThan(2);

		fail = false;
		await vi.advanceTimersByTimeAsync(40_000);
		expect(failures.at(-1)).toBe(0);
		poller.stop();
	});

	it('never backs off to faster than the interval the user chose', async () => {
		// max(interval, backoff): backing a 60s poller off *to 1s* is hammering.
		const { api, calls } = client(() => new Response('', { status: 500 }));
		const poller = new EndpointPoller(api, '/devices', 60_000, () => {}, deps);
		poller.start();
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(59_000);
		expect(calls()).toBe(1);
		poller.stop();
	});

	it('stops entirely while the tab is hidden, and resumes immediately', async () => {
		const { api, calls } = client(ok);
		const poller = new EndpointPoller(api, '/devices', 1000, () => {}, deps);
		poller.start();
		await vi.advanceTimersByTimeAsync(0);
		expect(calls()).toBe(1);

		hidden = true;
		poller.pause();
		await vi.advanceTimersByTimeAsync(20_000);
		// Continuing would be a lie about the sample rate: browsers throttle background
		// timers to ~1/minute, so the series would silently thin out thirtyfold.
		expect(calls()).toBe(1);

		hidden = false;
		poller.resume();
		await vi.advanceTimersByTimeAsync(1);
		expect(calls()).toBe(2);
		poller.stop();
	});

	it('stops for good once stopped', async () => {
		const { api, calls } = client(ok);
		const poller = new EndpointPoller(api, '/devices', 500, () => {}, deps);
		poller.start();
		await vi.advanceTimersByTimeAsync(0);
		poller.stop();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(calls()).toBe(1);
	});
});

describe('live gap thresholds', () => {
	it('a live chart is blank without refreshGap — the regression this guards', () => {
		// alignSeries only HOLDS a value across a timestamp when gapMs > 0, and gapMs is set
		// by seal(), which only the file source calls. Two live series that never sample at
		// the same instant therefore render as isolated points with nulls between them —
		// and a chart card auto-selects two series and draws no markers. Blank.
		const a = createColumn('a');
		const b = createColumn('b');
		for (let i = 0; i < 10; i++) {
			append(a, i * 1000, i);
			append(b, i * 1000 + 500, i * 2);
		}

		const unsealed = alignSeries([
			{ slice: fullSlice(a), gapMs: a.gapMs, offsetMs: 0 },
			{ slice: fullSlice(b), gapMs: b.gapMs, offsetMs: 0 },
		]);
		const holesBefore = unsealed[1]!.filter((value) => value === null).length;
		expect(holesBefore, 'every foreign timestamp is a hole while gapMs is 0').toBeGreaterThan(5);

		refreshGap(a);
		refreshGap(b);
		const refreshed = alignSeries([
			{ slice: fullSlice(a), gapMs: a.gapMs, offsetMs: 0 },
			{ slice: fullSlice(b), gapMs: b.gapMs, offsetMs: 0 },
		]);
		expect(refreshed[1]!.filter((value) => value === null).length).toBeLessThan(holesBefore);
	});

	it('tracks a cadence change instead of staying anchored to an old one', () => {
		// A median over the recent window, not all time: raising the poll interval should
		// move the gap threshold within a minute.
		const column = createColumn('c');
		for (let i = 0; i < 200; i++) append(column, i * 1000, i);
		refreshGap(column);
		const fast = column.gapMs;
		for (let i = 0; i < 100; i++) append(column, 200_000 + i * 15_000, i);
		refreshGap(column);
		expect(column.gapMs).toBeGreaterThan(fast * 5);
	});

	it('keeps a live column ascending when the replay clock wraps', () => {
		// A `loop: true` replay reaches the end of its file and starts again ten days earlier
		// — a `loop: true` replay config ships exactly that. The live path never calls seal(),
		// and it
		// used to leave the column in arrival order, on the reasoning that the store's
		// appendAscending already reports NON_MONOTONIC. But that repair applies to
		// dataset.events, which is what the *timeline* reads; the chart reads this column.
		// The two disagreed, and uPlot — which needs ascending x for its cursor and zoom
		// binary searches, not merely for looks — drew a line straight back across the whole
		// plot to the origin. "Les lignes reculent dans le temps."
		const columns = new ColumnStore();
		const lap = (base: number) => {
			for (let i = 0; i < 20; i++) columns.sample('reading', 'pv_meter', 'parsed.value', base + i * 1000, i);
		};

		lap(0);
		columns.refreshGaps();
		lap(0); // the wrap: the same simulated instants, a second time round
		columns.refreshGaps(); // what LiveSource.emit() calls on every batch

		const column = columns.get('reading', 'pv_meter', 'parsed.value')!;
		expect(column.n).toBe(40);
		expect(column.unsorted, 'the repair clears the flag it acted on').toBe(false);
		for (let i = 1; i < column.n; i++) {
			expect(column.t[i]!, `sample ${i} must not precede ${i - 1}`).toBeGreaterThanOrEqual(column.t[i - 1]!);
		}
	});
});

describe('retention', () => {
	function events(count: number, step = 1000, from = 0): NormalisedEvent[] {
		return Array.from({ length: count }, (_, i) => ({
			t: from + i * step,
			seq: i,
			kind: 'reading' as const,
			source: 'p1_meter',
			target: null,
			raw: '{}',
			preview: '{}',
			naive: false,
		}));
	}

	it('keeps history when the replay clock outruns the age window', () => {
		// The age bound is a duration in DATA time. At `speed: 0` the EMS clock advances about
		// 9 000× real time, so consecutive polls land over five hours apart on that clock —
		// wider than the whole 60-minute window. lowerBound(cutoff) then pointed at the last
		// element and retention deleted everything but one event on every batch, so the live
		// chart was permanently a single point and no follow window could rescue it.
		const step = 5 * 3_600_000;
		const list = events(500, step, Date.parse('2013-09-27T00:00:00Z'));
		const before = list.length;

		const result = trimDataset(list, new ColumnStore(), list.at(-1)!.t, DEFAULT_RETENTION);

		expect(result.eventsDropped, 'nothing has aged out under the floor yet').toBe(0);
		expect(list.length, 'a fast replay must keep its history').toBe(before);
	});

	it('resumes ageing out once the dataset is past the floor', () => {
		// The floor is a floor, not an off switch: above it the age bound works as before.
		const list = events(8000, 60_000, Date.parse('2013-09-27T00:00:00Z'));
		const result = trimDataset(list, new ColumnStore(), list.at(-1)!.t, DEFAULT_RETENTION);

		expect(result.eventsDropped, 'everything past the floor goes').toBe(3000);
		expect(list.length).toBe(5000);
	});

	it('still lets maxEvents bind, which is the memory guarantee', () => {
		// The floor protects the age bound only. The count bound is what actually bounds
		// memory, and it must still trim.
		const list = events(6000, 1000, Date.parse('2013-09-27T00:00:00Z'));
		trimDataset(list, new ColumnStore(), list.at(-1)!.t, { windowMs: 60 * 60_000, maxEvents: 1000, minEvents: 5000 });
		expect(list.length).toBeLessThanOrEqual(1000);
	});

	it('measures the window from the data, not the wall clock', () => {
		// THE bug this file exists to prevent. Under a replay tMax is 2013 simulation time,
		// and a wall-clock cutoff would delete the entire dataset on the very first batch.
		const replay = events(100, 60_000, Date.parse('2013-09-27T00:00:00Z'));
		const columns = new ColumnStore();
		const tMax = replay.at(-1)!.t;
		const result = trimDataset(replay, columns, tMax, DEFAULT_RETENTION);
		expect(replay.length, 'a 2013 replay must survive retention in 2026').toBeGreaterThan(50);
		expect(result.eventsDropped).toBeLessThan(50);
	});

	it('drops by age once the window is exceeded', () => {
		const list = events(500, 60_000);
		const tMax = list.at(-1)!.t;
		const result = trimDataset(list, new ColumnStore(), tMax, { windowMs: 60 * 60_000, maxEvents: 1_000_000, minEvents: 0 });
		expect(result.eventsDropped).toBeGreaterThan(0);
		expect(list[0]!.t).toBeGreaterThanOrEqual(tMax - 60 * 60_000);
	});

	it('drops by count when time alone would bound nothing', () => {
		// A 200-device EMS at 2s makes ~360k events an hour, so the count is the real memory
		// guarantee and the window is the one a user reasons about.
		const list = events(3000, 1);
		const result = trimDataset(list, new ColumnStore(), list.at(-1)!.t, { windowMs: 86_400_000, maxEvents: 1000, minEvents: 0 });
		expect(result.eventsDropped).toBeGreaterThan(0);
		expect(list.length).toBeLessThanOrEqual(1000);
	});

	it('reports the surviving tMin, which never moves up on its own', () => {
		const list = events(500, 60_000);
		const result = trimDataset(list, new ColumnStore(), list.at(-1)!.t, { windowMs: 60 * 60_000, maxEvents: 1_000_000, minEvents: 0 });
		expect(result.tMin).toBe(list[0]!.t);
	});

	it('leaves a dataset inside both bounds completely alone', () => {
		const list = events(10, 1000);
		expect(trimDataset(list, new ColumnStore(), list.at(-1)!.t, DEFAULT_RETENTION).eventsDropped).toBe(0);
		expect(list).toHaveLength(10);
	});

	it('reports the surviving tMax, which never moves down on its own', () => {
		// The mirror of tMin, and the more dangerous of the two. The store's running maximum
		// only ever moves *up*, and the cutoff is measured backwards from it — so a tMax left
		// pointing at a deleted sample keeps the cutoff ahead of every batch that lands
		// afterwards and the dataset never recovers.
		const list = events(500, 60_000);
		const result = trimDataset(list, new ColumnStore(), list.at(-1)!.t, { windowMs: 60 * 60_000, maxEvents: 1_000_000, minEvents: 0 });
		expect(result.eventsDropped).toBeGreaterThan(0);
		expect(result.tMax).toBe(list.at(-1)!.t);
	});

	it('reports NaN on both ends when a trim leaves nothing at all', () => {
		// The store re-establishes both from the next batch, which is only possible because
		// neither end still points into the deleted range.
		const list = events(5, 1000);
		const result = trimDataset(list, new ColumnStore(), list.at(-1)!.t + 7 * 86_400_000, { windowMs: 60_000, maxEvents: 10, minEvents: 0 });
		expect(list).toHaveLength(0);
		expect(result.tMin).toBeNaN();
		expect(result.tMax).toBeNaN();
	});

	it('trims the columns alongside the events', () => {
		const columns = new ColumnStore();
		for (let i = 0; i < 500; i++) columns.sample('reading', 'p1_meter', 'power', i * 60_000, i);
		const list = events(500, 60_000);
		trimDataset(list, columns, list.at(-1)!.t, { windowMs: 60 * 60_000, maxEvents: 1_000_000, minEvents: 0 });
		const column = columns.get('reading', 'p1_meter', 'power')!;
		expect(column.n).toBeLessThan(500);
		expect(column.t[0]!).toBeGreaterThanOrEqual(list[0]!.t - 60_000);
	});

	it('evicts a column the trim emptied instead of keeping its buffers forever', () => {
		// `trimBefore` lowers n but keeps both buffers at their high-water capacity, and nothing
		// else ever deleted a column — so a series that had fallen entirely out of the window
		// stayed resident for as long as the dataset was loaded.
		const columns = new ColumnStore();
		for (let i = 0; i < 500; i++) columns.sample('reading', 'p1_meter', 'power', i * 60_000, i);
		// A device that reported once, long before the window, and never again.
		columns.sample('reading', 'shelly_plug', 'power', 0, 7);
		expect(columns.size).toBe(2);

		const list = events(500, 60_000);
		trimDataset(list, columns, list.at(-1)!.t, { windowMs: 60 * 60_000, maxEvents: 1_000_000, minEvents: 0 });

		expect(columns.get('reading', 'shelly_plug', 'power'), 'emptied by the trim, so gone').toBeUndefined();
		expect(columns.get('reading', 'p1_meter', 'power')!.n, 'a live series is untouched').toBeGreaterThan(0);
		expect(columns.size).toBe(1);
	});
});

/**
 * One remote timestamp must not be able to delete the collected history.
 *
 * `tMax` is a running maximum over instants the EMS supplies, and retention measures its
 * window *backwards* from `tMax` — so any instant the viewer accepts far ahead of the data
 * puts the cutoff past every real sample. `followWindow` reads the same `tMax`, so the same
 * value blanks every chart card, including those drawn from trusted CSV files.
 */
describe('an implausible EMS clock cannot delete the dataset', () => {
	const WALL_NOW = Date.parse('2026-08-09T10:00:00Z');
	const REPLAY_START = Date.parse('2013-09-27T00:00:00Z');

	/** Runs one poll through the chain the store runs: normalise -> ingest -> retention. */
	function replay(): {
		poll: (simTime: string, power: number, receivedAt: number) => string | null;
		events: () => number;
		tMax: () => number;
		power: () => number;
	} {
		const dedupe = createDedupeState();
		const columns = new ColumnStore();
		const ingestor = new Ingestor({
			onSample: (kind, actor, path, t, value, unit) => columns.sample(kind, actor, path, t, value, unit),
		});
		let row = 0;
		let tMax = -Infinity;

		return {
			poll(simTime, power, receivedAt) {
				const { records, unreadableClock } = normaliseDevices(
					devices(simTime, [device('p1_meter', { power })]),
					SIMULATED,
					dedupe,
					receivedAt,
					2000,
				);
				const before = ingestor.events.length;
				for (const record of records) {
					ingestor.addAt(record.kind, record.actor, record.target, record.t, record.naive, record.raw, ++row);
				}
				// The store's own idiom, over the events that were accepted.
				for (const event of ingestor.events.slice(before)) if (!(tMax >= event.t)) tMax = event.t;
				const trimmed = trimDataset(ingestor.events, columns, tMax, DEFAULT_RETENTION);
				if (trimmed.eventsDropped > 0) tMax = trimmed.tMax;
				return unreadableClock;
			},
			events: () => ingestor.events.length,
			tMax: () => tMax,
			power: () => columns.get('reading', 'p1_meter', 'data.power')?.n ?? 0,
		};
	}

	function collect(feed: ReturnType<typeof replay>, minutes: number, from = 0): void {
		for (let i = from; i < from + minutes; i++) {
			feed.poll(new Date(REPLAY_START + i * 60_000).toISOString(), 100 + i, WALL_NOW + i * 2000);
		}
	}

	it('refuses a year-9999 snapshot instead of stamping the dataset with it', () => {
		const dedupe = createDedupeState();
		const poll = normaliseDevices(
			devices('9999-12-31T23:59:59', [device('p1_meter', { power: 1 })]),
			SIMULATED,
			dedupe,
			WALL_NOW,
			2000,
		);
		expect(poll.records).toHaveLength(0);
		expect(poll.unreadableClock, 'the source needs it to raise the warning').toBe('9999-12-31T23:59:59');
	});

	it('does not substitute the client clock, which is thirteen years from the data', () => {
		// Bounding the parse alone would not save anything if the snapshot then fell back to
		// wall-clock now: that instant IS plausible, it would still be the newest in the
		// dataset, and it would still be the tMax retention measures backwards from.
		const feed = replay();
		collect(feed, 30);
		expect(feed.events()).toBe(30);

		feed.poll('9999-12-31T23:59:59', 999, WALL_NOW + 60_000);

		expect(feed.events(), 'the poisoned poll must not delete the history').toBe(30);
		expect(new Date(feed.tMax()).getUTCFullYear(), 'tMax must stay on the replay clock').toBe(2013);
		expect(feed.power(), 'trimBefore must not have emptied the column').toBe(30);
	});

	it('keeps ingesting the replay after a poisoned poll, batch after batch', () => {
		// The persistent half of the bug: a tMax that stayed in the future deleted every
		// well-formed batch that arrived afterwards, on arrival, forever.
		const feed = replay();
		collect(feed, 30);
		feed.poll('9999-12-31T23:59:59', 999, WALL_NOW + 60_000);
		collect(feed, 10, 30);

		expect(feed.events()).toBe(40);
		expect(feed.power()).toBe(40);
	});

	it('lets a legitimate 2013 replay run for hours, retaining by its own clock', () => {
		// THE regression that matters most: the bound is absolute, never "recent". Ninety
		// minutes of 2013 data collected in 2026 must be measured against 2013, not now.
		const feed = replay();
		collect(feed, 90);

		expect(feed.events(), 'the window must survive').toBeGreaterThan(55);
		expect(new Date(feed.tMax()).getUTCFullYear()).toBe(2013);

		// This used to also assert `< 90` — that the age bound had trimmed something at this
		// scale. It no longer does, and deliberately: `minEvents` now floors the age bound so
		// a replay whose clock outruns the window cannot be cut down to a single point (see
		// RetentionPolicy.minEvents). Ninety events is far below that floor, so nothing ages
		// out, which costs nothing — retention exists to bound unbounded growth, and the two
		// tests below show both of its bounds still biting once there is growth to bound.
		expect(feed.events()).toBe(90);
	});


	it('refuses an implausible instant handed straight to the ingestor', () => {
		// addAt is the live path's entry point and takes a float with no string left to
		// re-read. It is also where tMin/tMax are formed, so the bound has to hold here too.
		const warnings: SourceWarning[] = [];
		const ingestor = new Ingestor({ onWarning: (warning) => warnings.push(warning) });

		expect(ingestor.addAt('reading', 'p1_meter', null, 2.5e14, false, '{}', 1)).toBe(false);
		expect(ingestor.addAt('reading', 'p1_meter', null, Number.NaN, false, '{}', 2)).toBe(false);
		expect(ingestor.events).toHaveLength(0);
		expect(warnings.map((warning) => warning.code)).toEqual(['BAD_TIMESTAMP', 'BAD_TIMESTAMP']);
		expect(warnings[0]!.detail).toBe('unparseableTimestamp');

		expect(ingestor.addAt('reading', 'p1_meter', null, REPLAY_START, false, '{}', 3)).toBe(true);
		expect(ingestor.finish().tMax).toBe(REPLAY_START);
	});
});

describe('follow mode', () => {
	function state(overrides: Partial<AppState> = {}): AppState {
		return { ...INITIAL_STATE, ...overrides };
	}

	/**
	 * `step` is the gap between consecutive samples *in data time*, and it defaults to five
	 * hours — the replay scale that broke the old duration-based window, where two polls two
	 * real seconds apart land hours apart on the EMS clock.
	 */
	function live(tMax: number, count = 10, step = 5 * 3_600_000): Dataset {
		const events: NormalisedEvent[] = Array.from({ length: count }, (_, i) => ({
			t: tMax - (count - 1 - i) * step,
			seq: i,
			kind: 'reading' as const,
			source: 'pv_meter',
			target: null,
			raw: '{}',
			preview: '{}',
			naive: false,
		}));
		return {
			id: 'ds-1',
			tag: 'live',
			colour: '#fff',
			sourceKind: 'live',
			finite: false,
			descriptorLabel: '/api',
			events,
			fields: new Map(),
			columns: new ColumnStore(),
			revision: 0,
			status: { phase: 'idle' },
			warnings: [],
			naiveZone: 'local',
			naiveCount: 0,
			kindCounts: new Map(),
			droppedByRetention: 0,
			tMin: 0,
			tMax,
		};
	}

	it('tracks the newest sample, not the wall clock', () => {
		// max(tMax), deliberately not max(tMax, lastPollAt): lastPollAt is wall clock, so
		// under a replay it would fling the viewport thirteen years past the data on the
		// very first tick.
		const replayEnd = Date.parse('2013-09-27T02:00:00Z');
		const step = 5 * 3_600_000;
		const window = followWindow(state({ datasets: [live(replayEnd, 10, step)], follow: { on: true, samples: 4 } }));
		expect(window).toEqual([replayEnd - 3 * step, replayEnd]);
	});

	it('counts samples, not minutes, so a replay clock cannot empty the window', () => {
		// THE bug this rework exists to fix. At `speed: 0` the EMS clock runs about 9 000×
		// real time, so two polls two seconds apart land over five hours apart in data time.
		// Every duration the UI used to offer — 1, 5, 15, 60 minutes — was narrower than that
		// single gap, so `[newest - windowMs, newest]` contained exactly one sample whichever
		// you picked, and the control looked dead. A count spans the same number of points at
		// any replay speed.
		const replayEnd = Date.parse('2013-09-27T02:00:00Z');
		const step = 5 * 3_600_000;
		const dataset = live(replayEnd, 50, step);

		const window = followWindow(state({ datasets: [dataset], follow: { on: true, samples: 20 } }))!;
		expect(window).not.toBeNull();
		const inside = dataset.events.filter((event) => event.t >= window[0] && event.t <= window[1]);
		expect(inside, 'a 20-sample window must actually contain 20 samples').toHaveLength(20);

		// The old behaviour, for contrast: a 60-minute window over the same data.
		const anHour = dataset.events.filter((event) => event.t >= replayEnd - 3_600_000 && event.t <= replayEnd);
		expect(anHour, 'which is why a duration could not work here').toHaveLength(1);
	});

	it('holds the previous scale rather than collapsing to zero width', () => {
		// Under `speed: 0` every event in one timestep shares an instant, so a window narrower
		// than a step has no width. uPlot cannot draw that, and a null leaves the scale alone.
		const flat = live(1000, 5, 0);
		expect(followWindow(state({ datasets: [flat], follow: { on: true, samples: 3 } }))).toBeNull();
	});

	it('follows nothing when every dataset is finite', () => {
		const file = { ...live(1000), finite: true, sourceKind: 'file' as const };
		expect(followWindow(state({ datasets: [file] }))).toBeNull();
	});

	it('follows nothing once it is switched off', () => {
		expect(followWindow(state({ datasets: [live(1000)], follow: { on: false, samples: 200 } }))).toBeNull();
	});

	it('drops out on a user zoom and survives its own update', () => {
		// The drop-out lives in the store rather than a component, so every human path — the
		// chart drag, "Reset zoom", "Clear zoom" — gets it from the default argument with
		// nothing to remember at the call site.
		const store = new AppStore();
		expect(store.get().follow.on).toBe(true);

		store.setViewport([0, 100], 'follow');
		expect(store.get().follow.on, 'the follow updater must not switch itself off').toBe(true);

		store.setViewport([0, 50]);
		expect(store.get().follow.on).toBe(false);
	});

	it('does not re-arm itself when the window changes back', () => {
		const store = new AppStore();
		store.setViewport([0, 50]);
		expect(store.get().follow.on).toBe(false);
		store.setViewport(null, 'follow');
		// Silently resuming is precisely the fighting the drop-out exists to prevent.
		expect(store.get().follow.on).toBe(false);
	});
});

/**
 * The ascending-(t, seq) invariant on the append path.
 *
 * `mergeDatasets`, the window filter and `trimDataset` all binary-search `dataset.events`,
 * and a binary search over unsorted data returns an arbitrary index — so a single late
 * instant drops events that genuinely fall inside the user's zoom window and makes retention
 * splice the wrong records, with nothing on screen saying the view is incomplete.
 *
 * A file sorts before it emits. A live feed cannot, and it takes nothing hostile: /workers
 * is stamped with a borrowed step time that an interleaved /devices poll has already moved
 * past, and a replay that loops goes backwards outright.
 */
describe('a live batch cannot leave the event array unsorted', () => {
	function event(t: number, seq: number): NormalisedEvent {
		return { t, seq, kind: 'reading', source: 'p1_meter', target: null, raw: '{}', preview: '{}', naive: false };
	}

	function ascending(events: readonly NormalisedEvent[]): boolean {
		for (let i = 1; i < events.length; i++) {
			const previous = events[i - 1]!;
			const current = events[i]!;
			if (current.t < previous.t || (current.t === previous.t && current.seq < previous.seq)) return false;
		}
		return true;
	}

	it('pushes an ordered batch onto the same array, untouched', () => {
		// The overwhelmingly common case, and the one the cost rule is about: no repair, no
		// sort, and above all no fresh copy of the event array — it is held by reference by
		// the store, the merge and the timeline.
		const events = [event(1000, 0), event(2000, 1)];
		const identity = events;

		expect(appendAscending(events, [event(3000, 2), event(4000, 3)])).toBe(0);

		expect(events).toBe(identity);
		expect(events.map((entry) => entry.t)).toEqual([1000, 2000, 3000, 4000]);
	});

	it('leaves ties alone, which an EMS timestep produces by the dozen', () => {
		// Every device of one step shares an instant; seq is the tiebreak and already
		// ascending, so this must not count as an inversion or churn the tail.
		const events = [event(1000, 0)];
		expect(appendAscending(events, [event(2000, 1), event(2000, 2), event(2000, 3)])).toBe(0);
		expect(events.map((entry) => entry.seq)).toEqual([0, 1, 2, 3]);
	});

	it('repairs a batch that starts before the array ends', () => {
		const events = [event(1000, 0), event(2000, 1), event(3000, 2)];

		expect(appendAscending(events, [event(2500, 3), event(4000, 4)])).toBe(1);

		expect(events.map((entry) => entry.t)).toEqual([1000, 2000, 2500, 3000, 4000]);
		expect(ascending(events)).toBe(true);
	});

	it('repairs a batch that is unordered within itself', () => {
		// /workers borrowing a staler step time than the /devices poll beside it lands both
		// records in one batch, in arrival order.
		const events = [event(1000, 0)];

		expect(appendAscending(events, [event(3000, 1), event(2000, 2)])).toBe(1);

		expect(events.map((entry) => entry.t)).toEqual([1000, 2000, 3000]);
	});

	it('gives a lowerBound window over the repaired array the events it should return', () => {
		// The failure the repair exists to prevent, stated as the consumer sees it. Over the
		// unrepaired array — [1000, 4000, 2000, 3000] — lowerBound(2000) answers index 1 and
		// the zoom window silently opens on 4000.
		const events: NormalisedEvent[] = [];
		appendAscending(events, [event(1000, 0), event(4000, 1)]);
		appendAscending(events, [event(2000, 2), event(3000, 3)]);

		const window = events.slice(lowerBound(events, 2000), upperBound(events, 3000));
		expect(window.map((entry) => entry.t)).toEqual([2000, 3000]);
	});

	it('leaves retention trimming the oldest records, not arbitrary ones', () => {
		// trimDataset splices `lowerBound(events, cutoff)` off the front, so an unsorted array
		// costs it the wrong records at both ends.
		const events: NormalisedEvent[] = [];
		for (let i = 0; i < 200; i++) appendAscending(events, [event(i * 60_000, i)]);
		appendAscending(events, [event(30 * 60_000, 200)]);

		const tMax = events.at(-1)!.t;
		const result = trimDataset(events, new ColumnStore(), tMax, { windowMs: 60 * 60_000, maxEvents: 1_000_000, minEvents: 0 });
		expect(result.eventsDropped).toBeGreaterThan(0);
		expect(events[0]!.t).toBeGreaterThanOrEqual(tMax - 60 * 60_000);
		expect(ascending(events)).toBe(true);
	});

	/**
	 * The store's own sink, which is where a batch actually lands.
	 *
	 * Reached through the private `sinkFor` deliberately: there is no public seam for handing
	 * the store a source, and the alternative — racing two real pollers until their stamps
	 * interleave — would be a timing test for a pure ordering rule.
	 */
	function sinkOf(store: AppStore, id: DatasetId): SourceSink {
		return (store as unknown as { sinkFor(id: DatasetId): SourceSink }).sinkFor(id);
	}

	function liveStore(): { store: AppStore; id: DatasetId } {
		// A long interval and a stubbed fetch: this exercises the append path, not the poller,
		// and nothing here should reach the network.
		vi.stubGlobal('fetch', async () => new Response('{}', { status: 200 }));
		const store = new AppStore();
		return { store, id: store.addLive({ intervalMs: 60_000 }) };
	}

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('keeps a live dataset ascending and says so, once, with a running total', () => {
		const { store, id } = liveStore();
		try {
			const sink = sinkOf(store, id);
			sink.onBatch([event(3000, 1), event(4000, 2)]);
			sink.onBatch([event(2000, 3)]);
			sink.onBatch([event(1000, 4)]);

			const dataset = store.get().datasets.find((entry) => entry.id === id)!;
			expect(dataset.events.map((entry) => entry.t)).toEqual([1000, 2000, 3000, 4000]);
			expect(dataset.tMin).toBe(1000);
			expect(dataset.tMax).toBe(4000);

			const raised = dataset.warnings.filter((warning) => warning.code === 'NON_MONOTONIC');
			// One line, not one per event: `warnings` is unbounded and the load report renders
			// it, so an EMS whose clock keeps stepping backwards must not be able to fill it.
			expect(raised).toHaveLength(1);
			expect(raised[0]!.detail).toBe('nonMonotonic');
			expect(raised[0]!.params?.n).toBe(2);
		} finally {
			store.removeDataset(id);
		}
	});

	it('says nothing at all while the feed stays in order', () => {
		// A false positive here would put a permanent warning in the load report of a healthy
		// EMS, which is how a real diagnosis stops being read.
		const { store, id } = liveStore();
		try {
			const sink = sinkOf(store, id);
			sink.onBatch([event(1000, 1), event(2000, 2)]);
			sink.onBatch([event(2000, 3), event(3000, 4)]);

			const dataset = store.get().datasets.find((entry) => entry.id === id)!;
			expect(dataset.events.map((entry) => entry.t)).toEqual([1000, 2000, 2000, 3000]);
			expect(dataset.warnings.filter((warning) => warning.code === 'NON_MONOTONIC')).toHaveLength(0);
		} finally {
			store.removeDataset(id);
		}
	});
});

describe('LiveFeed visibility', () => {
	function deps(hidden: () => boolean): PollerDeps {
		return {
			setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
			clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
			now: () => Date.now(),
			isHidden: hidden,
		};
	}

	it('knows it is paused when the app boots in a hidden tab', () => {
		// A tab that is ALREADY hidden never fires visibilitychange, so a feed that learned
		// its state only from the event would sit there not polling and not saying why. That
		// is what a viewer opened in a background tab does, and it looked like a dead page.
		const feed = new LiveFeed(new ApiClient(), deps(() => true));
		try {
			expect(feed.pausedForMs()).not.toBeNull();
		} finally {
			feed.close();
		}
	});

	it('reports no pause when it boots visible', () => {
		const feed = new LiveFeed(new ApiClient(), deps(() => false));
		try {
			expect(feed.pausedForMs()).toBeNull();
		} finally {
			feed.close();
		}
	});
});

/**
 * A subscriber that throws — the second half of the same failure.
 *
 * The feed shares one response between the status page and every live dataset, which is the
 * point of it; that also means their failure modes were shared. A throw out of one subscriber
 * skipped every later one, escaped `tick` as an unhandled rejection, and left `finally` to
 * re-arm at full cadence with the failure counter still at zero.
 */
describe('LiveFeed fan-out', () => {
	let feed: LiveFeed | undefined;

	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		feed?.close();
		feed = undefined;
		vi.useRealTimers();
	});

	function stubbedFeed(): LiveFeed {
		const reply = (async () =>
			new Response(JSON.stringify({ count: 0, simulation_time: null, devices: [] }), {
				status: 200,
			})) as unknown as typeof fetch;
		return new LiveFeed(new ApiClient(reply), {
			setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
			clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
			now: () => Date.now(),
			isHidden: () => false,
		});
	}

	it('does not starve the subscribers after it', async () => {
		feed = stubbedFeed();
		const seen: Array<PollOutcome<unknown>> = [];
		feed.subscribe('devices', 1000, ({ result }) => {
			if (result.kind === 'ok') throw new TypeError('cannot read properties of null');
		});
		feed.subscribe('devices', 1000, (outcome) => seen.push(outcome));

		await vi.advanceTimersByTimeAsync(10);
		expect(seen[0]?.result.kind, 'a live dataset must not stop ingesting because a page threw').toBe('ok');
	});

	it('reaches the poller as a failure instead of an unhandled rejection', async () => {
		// Swallowing it in the feed would be worse than the crash: the chip would go on
		// reading "streaming, 0 failures" over a feed that had stopped ingesting.
		feed = stubbedFeed();
		const seen: Array<PollOutcome<unknown>> = [];
		feed.subscribe('devices', 1000, (outcome) => {
			seen.push(outcome);
			if (outcome.result.kind === 'ok') throw new TypeError('cannot read properties of null');
		});

		await vi.advanceTimersByTimeAsync(10);
		expect(seen.at(-1)!.result.kind, 'the same path an HTTP failure takes').toBe('malformed');
		expect(seen.at(-1)!.consecutiveFailures).toBe(1);

		// And it keeps polling — a poller must not die of a consumer's bug either.
		await vi.advanceTimersByTimeAsync(10_000);
		expect(seen.at(-1)!.consecutiveFailures).toBeGreaterThan(1);
	});
});

/**
 * What a batch IS, and what the source still holds after making one.
 *
 * Two halves of one seam, and the order they are written in is the order they had to be
 * fixed in. `emit()` used to name its batch by an index — `events.slice(lengthBeforeThisPoll)`
 * into the ingestor's own log — which is correct only for as long as nothing ever removes
 * from that log's front. That is precisely what stopped the log from being bounded, and the
 * rest of this file could not see it: every other assertion here checks the samples and the
 * instants that came out, never where one batch ends and the next begins, so an index off by
 * a trim would have duplicated or truncated a batch with the suite still green.
 *
 * The second half is the leak itself. `trimDataset` splices the STORE's array; a copy kept
 * here is trimmed by nothing, so every event a feed ever produced — each holding the full
 * `raw` snapshot, whose size the EMS decides — stayed reachable for the lifetime of the
 * dataset while the UI counted it as dropped by retention.
 */
describe('a live batch, and what the source keeps of it', () => {
	const REPLAY_START = Date.parse('2013-09-27T00:00:00Z');
	const WALL_NOW = Date.parse('2026-08-09T10:00:00Z');
	const STEP_MS = 60_000;

	function harness(): {
		poll: (step: number, names: readonly string[]) => void;
		batches: NormalisedEvent[][];
		retained: () => number;
		close: () => void;
	} {
		let notify: ((outcome: PollOutcome<unknown>) => void) | null = null;
		// Only the two members LiveSource actually uses. A real LiveFeed would drag a poller, a
		// clock and a fetch into a question that is about batching, not about transport.
		const feed = {
			subscribe: (endpoint: string, _intervalMs: number, fn: (outcome: PollOutcome<unknown>) => void) => {
				if (endpoint === 'devices') notify = fn;
				return () => {};
			},
			pausedForMs: () => null,
		} as unknown as LiveFeed;

		const source = new LiveSource('live-batch', feed, { devicesIntervalMs: 2000, naiveZone: 'local' });
		const batches: NormalisedEvent[][] = [];
		source.start({
			onBatch: (events) => void batches.push(events),
			onFields: () => {},
			onWarning: () => {},
			onStatus: () => {},
		});

		return {
			poll(step, names) {
				notify!({
					result: {
						kind: 'ok',
						status: 200,
						// A new simulation instant and a new reading per step, so dedupe passes
						// every device through and the poll count is the batch count.
						value: devices(
							new Date(REPLAY_START + step * STEP_MS).toISOString(),
							names.map((name) => device(name, { power: step })),
						),
					},
					receivedAt: WALL_NOW + step * 2000,
					consecutiveFailures: 0,
				});
			},
			batches,
			// The source's own retained log, reached through the private field the way `sinkOf`
			// above reaches the store's sink: there is no public seam for "what is this source
			// still holding", and that is exactly the property under test.
			retained: () => (source as unknown as { ingestor: Ingestor }).ingestor.events.length,
			close: () => source.close(),
		};
	}

	it('emits exactly the records of each poll, once each, in order', () => {
		const feed = harness();
		try {
			for (let step = 1; step <= 5; step++) feed.poll(step, ['p1_meter', 'shelly_plug', 'pseudo_sensor']);

			expect(feed.batches, 'one poll, one batch').toHaveLength(5);
			feed.batches.forEach((batch, i) => {
				// Truncation and duplication are both visible here: a batch short of its poll's
				// devices, or carrying an earlier poll's, fails on this line.
				expect(batch.map((event) => event.source)).toEqual(['p1_meter', 'shelly_plug', 'pseudo_sensor']);
				expect(new Set(batch.map((event) => event.t)).size, 'one poll is one instant').toBe(1);
				expect(batch[0]!.t).toBe(REPLAY_START + (i + 1) * STEP_MS);
			});

			// And stated over the whole run: fifteen records made, fifteen delivered, each
			// exactly once, carrying the seq the ingestor assigned it, ascending and unbroken.
			const delivered = feed.batches.flat();
			expect(delivered).toHaveLength(15);
			expect(delivered.map((event) => event.seq)).toEqual([...Array.from({ length: 15 }, (_, i) => i)]);
			expect(new Set(delivered).size, 'no event object may be handed over twice').toBe(15);
			expect(new Set(feed.batches).size, 'and each batch is an array the source does not keep').toBe(5);
		} finally {
			feed.close();
		}
	});

	it('does not accumulate the events it has already handed over', () => {
		const feed = harness();
		try {
			for (let step = 1; step <= 100; step++) feed.poll(step, ['p1_meter', 'shelly_plug']);
			const early = feed.retained();
			for (let step = 101; step <= 400; step++) feed.poll(step, ['p1_meter', 'shelly_plug']);

			expect(feed.batches.flat(), 'the store is still given every record').toHaveLength(800);
			expect(feed.retained(), 'three hundred more polls must not enlarge what the source holds').toBe(early);
			// Absolute, not just flat: retention has no reach into this source, so anything kept
			// here is kept until the dataset is closed, however long the tab stays open.
			expect(feed.retained()).toBe(0);
		} finally {
			feed.close();
		}
	});

	it('leaves the finite path keeping its whole log, which its summary is read from', () => {
		// The other half of the same option, asserted so that "stop retaining" cannot quietly
		// become the default: a file IS its log — `parseCsvText` returns it, and `finish()`
		// counts inversions and finds a stray era by reading it.
		const ingestor = new Ingestor();
		expect(ingestor.addAt('reading', 'p1_meter', null, REPLAY_START + 2 * STEP_MS, false, '{"power": 2}', 1)).toBe(true);
		expect(ingestor.addAt('reading', 'p1_meter', null, REPLAY_START + STEP_MS, false, '{"power": 1}', 2)).toBe(true);

		expect(ingestor.events).toHaveLength(2);
		const summary = ingestor.finish();
		expect(summary.rows).toBe(2);
		expect(summary.inversions, 'read off the retained log, and the file path reports it').toBe(1);
		expect(summary.tMin).toBe(REPLAY_START + STEP_MS);
		expect(summary.tMax).toBe(REPLAY_START + 2 * STEP_MS);
	});
});

/**
 * A peer must not be able to mint series until the tab dies.
 *
 * `Ingestor.tallyInto` and `ColumnStore.sample` both key on `(kind, actor, path)`, where the
 * actor is a device name and the path is a flattened payload key — all of it chosen by the
 * source, none of it inspected. Neither map was ever pruned and `createColumn` allocates two
 * Float64Array(64) up front, so a feed renaming its keys each poll bought a permanent ~1 KB
 * column per name until the tab was OOM-killed, taking every other loaded dataset with it.
 */
describe('series cardinality is bounded', () => {
	const CAP = 50;
	const T0 = Date.parse('2013-09-27T00:00:00Z');

	/** The ingest half of a dataset: one walk feeding both the catalogue and the columns. */
	function dataset(cap?: number): {
		ingestor: Ingestor;
		columns: ColumnStore;
		warnings: SourceWarning[];
		fieldCount: () => number;
		capped: () => SourceWarning[];
	} {
		const warnings: SourceWarning[] = [];
		const columns = new ColumnStore(cap);
		const ingestor = new Ingestor({
			...(cap === undefined ? {} : { maxSeries: cap }),
			onWarning: (warning) => warnings.push(warning),
			onSample: (kind, actor, path, t, value, unit) => columns.sample(kind, actor, path, t, value, unit),
		});
		return {
			ingestor,
			columns,
			warnings,
			fieldCount: () => {
				let total = 0;
				for (const paths of ingestor.fields.values()) total += paths.size;
				return total;
			},
			capped: () => warnings.filter((warning) => warning.code === 'TOO_MANY_SERIES'),
		};
	}

	/** A P1-shaped telegram: ~7 flattened leaves per OBIS line, six of them numeric. */
	function telegram(lines: number, base: number): string {
		return JSON.stringify({
			model_id: 'ISK',
			device_id: 'SIM-0001',
			data: Array.from({ length: lines }, (_, i) => ({
				obis: { medium: 1, channel: 0, class: 1, instance: 8, attribute: i },
				data: [{ value: base + i, unit: 'kWh' }],
			})),
			crc16: 'AEE1',
		});
	}

	it('stops minting columns at the cap, and says so exactly once', () => {
		const feed = dataset(CAP);
		// The attack: ten fresh key names on every poll, forever.
		for (let poll = 0; poll < 40; poll++) {
			const payload = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${poll}_${i}`, poll + i]));
			feed.ingestor.addAt('reading', 'p1_meter', null, T0 + poll * 2000, false, JSON.stringify(payload), poll + 1);
		}

		expect(feed.fieldCount(), 'the catalogue stops at the cap').toBe(CAP);
		expect(feed.columns.size, 'and so does the column store').toBe(CAP);
		// The refused samples never reach the store: every column has a catalogue entry, so the
		// catalogue is never the smaller of the two and its cap is the one that trips. The
		// store's own cap is the backstop for any other caller, asserted separately below.
		expect(feed.columns.refusedSamples).toBe(0);

		const capped = feed.capped();
		expect(capped, 'the user is told, once, rather than silently starved').toHaveLength(1);
		expect(capped[0]!.detail).toBe('seriesCap');
		expect(capped[0]!.params).toEqual({ n: CAP });
	});

	it('refuses to mint a column past the cap for a caller of its own', () => {
		// The store is shared with the app state and is public API in its own right, so it holds
		// the bound itself rather than trusting whoever is walking the payload.
		const columns = new ColumnStore(CAP);
		for (let i = 0; i < CAP + 25; i++) columns.sample('reading', 'p1_meter', `path_${i}`, T0 + i, i);

		expect(columns.size).toBe(CAP);
		expect(columns.refusedSamples).toBe(25);
		// And the ones it did mint still take every later sample.
		columns.sample('reading', 'p1_meter', 'path_0', T0 + 1000, 99);
		expect(columns.get('reading', 'p1_meter', 'path_0')!.n).toBe(2);
	});

	it('bounds the device catalogue too, not just the paths under one device', () => {
		// The outer map is keyed by actor, and a device name is as source-chosen as a path is:
		// refusing only the paths would still mint an empty Map per invented device.
		const feed = dataset(CAP);
		for (let i = 0; i < 500; i++) {
			feed.ingestor.addAt('reading', `p1_meter_${i}`, null, T0 + i * 2000, false, '{"power": 1}', i + 1);
		}

		expect(feed.ingestor.fields.size).toBeLessThanOrEqual(CAP);
		expect(feed.fieldCount()).toBeLessThanOrEqual(CAP);
		expect(feed.columns.size).toBeLessThanOrEqual(CAP);
		expect(feed.capped()).toHaveLength(1);
	});

	it('keeps feeding the series that were already there', () => {
		// The cap is on minting, not on appending. A hostile key space must not starve the
		// device the user is actually watching.
		const feed = dataset(CAP);
		for (let poll = 0; poll < 60; poll++) {
			const payload = JSON.stringify({ power: 100 + poll, [`junk_${poll}`]: poll });
			feed.ingestor.addAt('reading', 'p1_meter', null, T0 + poll * 2000, false, payload, poll + 1);
		}

		const power = feed.columns.get('reading', 'p1_meter', 'power')!;
		expect(power.n, 'every poll, including the ones after the cap was reached').toBe(60);
		expect(power.v[59]).toBe(159);
		expect(feed.columns.size).toBe(CAP);
	});

	it('leaves a realistically wide payload alone', () => {
		// Three devices each emitting a full 40-line telegram — wider than anything in the
		// fixtures — against the real cap, which no site is meant to reach.
		const feed = dataset();
		let row = 0;
		for (let poll = 0; poll < 5; poll++) {
			for (const name of ['p1_meter', 'shelly_plug', 'pseudo_sensor']) {
				feed.ingestor.addAt('reading', name, null, T0 + poll * 2000, false, telegram(40, poll), ++row);
			}
		}

		expect(feed.fieldCount(), 'a wide payload really is wide').toBeGreaterThan(800);
		expect(feed.fieldCount(), 'and still an order of magnitude below the cap').toBeLessThan(MAX_SERIES / 10);
		expect(feed.columns.size).toBe(3 * 40 * 6);
		expect(feed.columns.refusedSamples).toBe(0);
		expect(feed.capped(), 'nothing to warn a real site about').toHaveLength(0);
		expect(feed.columns.get('reading', 'p1_meter', 'data.39.data.0.value')!.n).toBe(5);
	});
});

// --- decisions over the live API ----------------------------------------------------------

describe('checkDecisionsResponse', () => {
	const page = (overrides: Record<string, unknown> = {}) => ({
		count: 1,
		total: 1,
		retained: 1,
		capacity: 1000,
		oldest_seq: 1,
		missed: 0,
		next_cursor: 1,
		has_more: false,
		epoch: 'e1',
		simulation_time: null,
		decisions: [{ seq: 1, timestamp: '2024-01-15T10:00:00', algorithm: 'AutoToggle', device: 'shelly_plug', command: 'on' }],
		...overrides,
	});

	it('accepts a clean page with no defects', () => {
		// A false positive here puts a permanent warning in a healthy EMS's load report.
		const checked = checkDecisionsResponse(page());
		expect(checked?.defects).toBe(0);
		expect(checked?.value.decisions).toHaveLength(1);
	});

	it('rejects a body with no decisions list', () => {
		expect(checkDecisionsResponse({ count: 0 })).toBeNull();
		expect(checkDecisionsResponse(null)).toBeNull();
		// A health body, which is what a catch-all proxy answers for every path.
		expect(checkDecisionsResponse({ status: 'ok', clock: {}, workers: {}, devices: {} })).toBeNull();
	});

	it('drops an element missing its identity and keeps the rest', () => {
		const checked = checkDecisionsResponse(
			page({ decisions: [null, { seq: 2, timestamp: '2024-01-15T10:00:00', algorithm: 'A', device: 'd', command: 'on' }] }),
		);
		expect(checked?.value.decisions).toHaveLength(1);
		expect(checked?.defects).toBe(1);
	});

	it('drops an element whose command is not a string', () => {
		const checked = checkDecisionsResponse(
			page({ decisions: [{ seq: 1, timestamp: '2024-01-15T10:00:00', algorithm: 'A', device: 'd', command: 42 }] }),
		);
		expect(checked?.value.decisions).toHaveLength(0);
		expect(checked?.defects).toBe(1);
	});

	it('repairs a missing next_cursor with max(seq) rather than rejecting the page', () => {
		// It is the one dereferenced field whose absence would stall the cursor forever.
		const checked = checkDecisionsResponse(page({ next_cursor: undefined }));
		expect(checked?.value.next_cursor).toBe(1);
		expect(checked?.defects).toBe(1);
	});
});

describe('normaliseDecisions', () => {
	const base: TimeBase = { resolved: true, simulated: true, lastStepTime: null, naiveZone: 'local' };
	const page = (decisions: unknown[]) =>
		checkDecisionsResponse({
			count: decisions.length,
			total: decisions.length,
			retained: decisions.length,
			capacity: 1000,
			oldest_seq: 1,
			missed: 0,
			next_cursor: decisions.length,
			has_more: false,
			epoch: 'e1',
			simulation_time: null,
			decisions,
		})!.value;

	const decision = (seq: number, command: string, timestamp = '2024-01-15T10:00:00') => ({
		seq,
		timestamp,
		algorithm: 'AutoToggle',
		device: 'shelly_plug',
		command,
	});

	it('maps the CSV vocabulary onto the event vocabulary', () => {
		const { records } = normaliseDecisions(page([decision(1, 'on')]), base, 0);
		expect(records).toHaveLength(1);
		expect(records[0]!.kind).toBe('decision');
		expect(records[0]!.actor).toBe('AutoToggle');
		expect(records[0]!.target).toBe('shelly_plug');
	});

	it('carries the command verbatim, with no envelope', () => {
		// `csv-source.ts` passes exactly this string as the payload cell. Wrapping it would make
		// a live decision and its own CSV row two different events.
		const { records } = normaliseDecisions(page([decision(1, 'on'), decision(2, '{"setpoint": 21.5}')]), base, 0);
		expect(records.map((record) => record.raw)).toEqual(['on', '{"setpoint": 21.5}']);
	});

	it('keeps two byte-identical decisions at different seqs', () => {
		// THE anti-dedupe pin. /devices is a snapshot and needs content hashing; /decisions is
		// an append-only log where repeats are real. The golden fixture is six `off` then
		// twelve `on` — hashing would collapse it to two events.
		const { records } = normaliseDecisions(
			page([decision(1, 'on', '2024-01-15T10:00:00'), decision(2, 'on', '2024-01-15T10:15:00')]),
			base,
			0,
		);
		expect(records).toHaveLength(2);
	});

	it('reads naive and offset-aware stamps for what they are', () => {
		const { records } = normaliseDecisions(
			page([decision(1, 'on', '2024-01-15T10:00:00'), decision(2, 'on', '2024-03-31T03:00:00+02:00')]),
			base,
			0,
		);
		expect(records.map((record) => record.naive)).toEqual([true, false]);
	});

	it('drops and counts a record whose stamp cannot be read', () => {
		const { records, unreadable } = normaliseDecisions(
			page([decision(1, 'on', 'not a timestamp'), decision(2, 'on')]),
			base,
			0,
		);
		expect(records).toHaveLength(1);
		expect(unreadable).toBe(1);
	});

	it('sorts the batch by instant, because seq order is write order', () => {
		const { records } = normaliseDecisions(
			page([decision(1, 'on', '2024-01-15T10:15:00'), decision(2, 'off', '2024-01-15T10:00:00')]),
			base,
			0,
		);
		expect(records.map((record) => record.raw)).toEqual(['off', 'on']);
	});

	it('produces the same events as the file path does for the same decisions', () => {
		// What "live and file decisions merge" actually means, pinned against the real fixture
		// bytes rather than against a hand-written expectation.
		const fromFile = parseCsvText(readFixture('auto_toggle/expected/algorithm_decisions.csv'));
		const rows = fromFile.events;

		const live = normaliseDecisions(
			page(
				rows.map((event, index) => ({
					seq: index + 1,
					// The API serves the same recorded stamp the CSV holds.
					timestamp: new Date(event.t).toISOString().replace('Z', ''),
					algorithm: event.source,
					device: event.target,
					command: event.raw,
				})),
			),
			{ resolved: true, simulated: true, lastStepTime: null, naiveZone: 'utc' },
			0,
		);

		const ingestor = new Ingestor({ naiveZone: 'utc' });
		let row = 0;
		for (const record of live.records) {
			ingestor.addAt(record.kind, record.actor, record.target, record.t, record.naive, record.raw, ++row);
		}

		const shape = (event: NormalisedEvent) => ({
			kind: event.kind,
			source: event.source,
			target: event.target,
			raw: event.raw,
			preview: event.preview,
		});
		expect(ingestor.events.map(shape)).toEqual(rows.map(shape));
	});
});
