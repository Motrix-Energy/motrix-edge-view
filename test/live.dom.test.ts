import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import '../src/components/motrix-app.js';
import type { MotrixApp } from '../src/components/motrix-app.js';

/**
 * A live dataset end to end, through the real store, the real feed and the real ingestor.
 *
 * The stub advances a simulation clock, so this exercises the path that actually matters:
 * a replay, where an unchanged payload at a new step is a genuine sample and a wall-clock
 * stamp would be thirteen years wrong.
 */
describe('live datasets', () => {
	let app: MotrixApp;
	let step = 0;
	let power = 100;
	/**
	 * A valid, empty decision page.
	 *
	 * The stub must model the endpoint even where a test does not care about it: answering
	 * `/decisions` with a health body — which the catch-all branch used to do — makes the boot
	 * probe and every poll see a malformed response, and puts a second UNKNOWN_SHAPE warning
	 * into tests that are measuring the first one.
	 */
	const EMPTY_DECISIONS = {
		count: 0,
		total: 0,
		retained: 0,
		capacity: 1000,
		oldest_seq: null,
		missed: 0,
		next_cursor: 0,
		has_more: false,
		epoch: 'test-epoch',
		simulation_time: null,
		decisions: [],
	};
	let decisionsBody: unknown = EMPTY_DECISIONS;

	beforeEach(async () => {
		step = 0;
		power = 100;
		decisionsBody = EMPTY_DECISIONS;
		globalThis.sessionStorage.clear();

		globalThis.fetch = (async (url: string) => {
			const body =
				url.endsWith('/devices')
					? {
							count: 1,
							simulation_time: `2013-09-27T00:${String(step).padStart(2, '0')}:00+02:00`,
							devices: [
								{
									name: 'p1_meter',
									class: 'P1',
									connector: 'replay',
									protocol: 'mqtt',
									readable: true,
									writable: false,
									connected: true,
									data_ready: true,
									capabilities: ['EnergyMeter'],
									metrics: null,
									total_energy_kwh: 12.5,
									data: { power: { value: power, unit: 'W' } },
								},
							],
						}
					: url.includes('/decisions')
						? decisionsBody
						: url.endsWith('/workers')
						? { count: 0, workers: [] }
						: {
								status: 'ok',
								uptime_seconds: 1,
								clock: {
									simulated: true,
									generation: step,
									step_time: `2013-09-27T00:${String(step).padStart(2, '0')}:00+02:00`,
									pending: [],
								},
								workers: { total: 1, running: 1, finished: 0, down: 0, lost: 0, crashed: 0, restarts: 0 },
								devices: { total: 1, connected: 1, data_ready: 1 },
							};
			return new Response(JSON.stringify(body), { status: 200 });
		}) as unknown as typeof fetch;

		app = document.createElement('motrix-app');
		document.body.append(app);
		await app.updateComplete;
		await settle();
	});

	afterEach(() => {
		for (const dataset of app.store.get().datasets) app.store.removeDataset(dataset.id);
		app.remove();
	});

	async function settle(ms = 40): Promise<void> {
		await new Promise((resolve) => setTimeout(resolve, ms));
		await app.updateComplete;
	}

	async function until(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (!predicate()) {
			if (Date.now() > deadline) throw new Error('timed out');
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}

	it('creates an unbounded dataset that streams', async () => {
		const id = app.store.addLive({ intervalMs: 20 });
		await until(() => app.store.get().datasets[0]!.events.length > 0);

		const dataset = app.store.get().datasets.find((d) => d.id === id)!;
		expect(dataset.sourceKind).toBe('live');
		// The single discriminator the rest of the app keys off. Retention and follow mode
		// both read it; neither concept appears in the DataSource interface.
		expect(dataset.finite).toBe(false);
		expect(dataset.status.phase).toBe('streaming');
	});

	it('stamps samples with the EMS clock, not this machine 13 years later', async () => {
		app.store.addLive({ intervalMs: 20 });
		await until(() => app.store.get().datasets[0]!.events.length > 0);
		const event = app.store.get().datasets[0]!.events[0]!;
		expect(new Date(event.t).getUTCFullYear()).toBe(2013);
	});

	it('keeps a sample per step even while the payload never changes', async () => {
		// The dedupe rule's hard case: without the simulation_time clause a device holding a
		// constant value would produce one point for the whole run and the chart would be
		// empty.
		app.store.addLive({ intervalMs: 20 });
		const advance = setInterval(() => step++, 25);
		try {
			await until(() => app.store.get().datasets[0]!.events.length >= 4, 3000);
		} finally {
			clearInterval(advance);
		}
		expect(app.store.get().datasets[0]!.events.length).toBeGreaterThanOrEqual(4);
	});

	it('suppresses repeats when the EMS clock is standing still', async () => {
		app.store.addLive({ intervalMs: 10 });
		await until(() => app.store.get().datasets[0]!.events.length > 0);
		const first = app.store.get().datasets[0]!.events.length;
		await settle(200);
		// ~20 polls, nothing moving: a snapshot endpoint would otherwise manufacture 20
		// identical readings.
		expect(app.store.get().datasets[0]!.events.length).toBe(first);
	});

	it('builds chartable columns with a usable gap threshold', async () => {
		app.store.addLive({ intervalMs: 20 });
		const advance = setInterval(() => {
			step++;
			power += 5;
		}, 25);
		try {
			await until(() => (app.store.get().datasets[0]!.columns.get('reading', 'p1_meter', 'data.power.value')?.n ?? 0) >= 3, 3000);
		} finally {
			clearInterval(advance);
		}

		const column = app.store.get().datasets[0]!.columns.get('reading', 'p1_meter', 'data.power.value')!;
		expect(column.n).toBeGreaterThanOrEqual(3);
		// Zero here means every multi-series chart renders blank: alignSeries only holds a
		// value across a foreign timestamp when gapMs > 0, and nothing calls seal() on a
		// live column.
		expect(column.gapMs).toBeGreaterThan(0);
		expect(column.unit).toBe('W');
	});

	it('exposes total_energy_kwh, which exists nowhere in the CSV', async () => {
		app.store.addLive({ intervalMs: 20 });
		await until(() => app.store.get().datasets[0]!.columns.size > 0);
		expect(app.store.get().datasets[0]!.columns.get('reading', 'p1_meter', 'total_energy_kwh')).toBeDefined();
	});

	it('stops polling when the dataset is removed', async () => {
		const id = app.store.addLive({ intervalMs: 10 });
		await until(() => app.store.get().datasets[0]!.events.length > 0);

		let after = 0;
		const original = globalThis.fetch;
		globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
			after++;
			return original(...args);
		}) as typeof fetch;

		app.store.removeDataset(id);
		await settle(150);
		// close() unsubscribes, and the feed stops the poller once its last subscriber goes.
		expect(after).toBe(0);
	});

	it('shares one request between two consumers of the same endpoint', async () => {
		let requests = 0;
		const original = globalThis.fetch;
		globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
			if (String(args[0]).endsWith('/devices')) requests++;
			return original(...args);
		}) as typeof fetch;

		// /health costs the EMS a deep copy of every device to return twenty integers, so
		// two subscribers at the same cadence must not mean two requests.
		const stop = app.store.liveFeed.subscribe('devices', 30, () => {});
		app.store.addLive({ intervalMs: 30 });
		await settle(200);
		stop();

		// ~6 polls in 200ms at 30ms; two independent pollers would roughly double that.
		expect(requests).toBeLessThan(12);
	});
});

/**
 * One malformed element, and what it used to cost.
 *
 * The guards checked the containers only, so `{"devices":[null]}` reached the normaliser and
 * threw. The throw had nowhere to land — no catch in the fan-out, none in the poll callback —
 * so ingestion stopped while the dataset chip went on reading "streaming, 0 failures". The
 * feed has to survive the bad element and say that it saw one.
 */
describe('live datasets against a payload the viewer cannot fully walk', () => {
	let app: MotrixApp;
	let devicesBody: unknown = null;
	let devicesRequests = 0;

	beforeEach(async () => {
		devicesRequests = 0;
		globalThis.sessionStorage.clear();

		globalThis.fetch = (async (url: string) => {
			let body: unknown;
			if (url.endsWith('/devices')) {
				devicesRequests++;
				body = devicesBody;
			} else if (url.includes('/decisions')) {
				// Modelled even though these tests are about /devices: a health body here would
				// raise a second UNKNOWN_SHAPE and drown the one being measured.
				body = {
					count: 0,
					total: 0,
					retained: 0,
					capacity: 1000,
					oldest_seq: null,
					missed: 0,
					next_cursor: 0,
					has_more: false,
					epoch: 'test-epoch',
					simulation_time: null,
					decisions: [],
				};
			} else if (url.endsWith('/workers')) {
				body = { count: 0, workers: [] };
			} else {
				body = {
					status: 'ok',
					uptime_seconds: 1,
					clock: { simulated: true, generation: 1, step_time: '2013-09-27T00:01:00+02:00', pending: [] },
					workers: { total: 1, running: 1, finished: 0, down: 0, lost: 0, crashed: 0, restarts: 0 },
					devices: { total: 1, connected: 1, data_ready: 1 },
				};
			}
			return new Response(JSON.stringify(body), { status: 200 });
		}) as unknown as typeof fetch;

		app = document.createElement('motrix-app');
		document.body.append(app);
		await app.updateComplete;
	});

	afterEach(() => {
		for (const dataset of app.store.get().datasets) app.store.removeDataset(dataset.id);
		app.remove();
	});

	async function until(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (!predicate()) {
			if (Date.now() > deadline) throw new Error('timed out');
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}

	it('warns and keeps polling when an element is not a device at all', async () => {
		devicesBody = JSON.parse('{"count":1,"simulation_time":"2013-09-27T00:01:00+02:00","devices":[null]}');
		app.store.addLive({ intervalMs: 20 });

		await until(() => app.store.get().datasets[0]!.warnings.length > 0);
		const dataset = app.store.get().datasets[0]!;
		expect(dataset.warnings.some((w) => w.code === 'UNKNOWN_SHAPE')).toBe(true);
		expect(dataset.status.phase).toBe('streaming');

		const before = devicesRequests;
		await new Promise((resolve) => setTimeout(resolve, 150));
		expect(devicesRequests, 'the feed must survive the bad element, not stop on it').toBeGreaterThan(before);
	});

	it('keeps a device that only lost its capability list, and still says so', async () => {
		devicesBody = JSON.parse(
			'{"count":1,"simulation_time":"2013-09-27T00:01:00+02:00","devices":[{"name":"p1_meter","data":{"power":120}}]}',
		);
		app.store.addLive({ intervalMs: 20 });

		// The telemetry survives the missing list — `capabilities` is chips on a status page,
		// `name` is the actor every sample is filed under.
		await until(() => app.store.get().datasets[0]!.events.some((event) => event.source === 'p1_meter'));
		const dataset = app.store.get().datasets[0]!;
		// Repaired, but never silently: a shape this viewer does not recognise is exactly what
		// the load report is for.
		expect(dataset.warnings.some((w) => w.code === 'UNKNOWN_SHAPE')).toBe(true);
	});

	it('says it once per streak rather than once per poll', async () => {
		// `warnings` is an unbounded array the load report renders in full, and a wrong-shaped
		// EMS answers every 10ms here.
		devicesBody = JSON.parse('{"count":1,"simulation_time":null,"devices":[null]}');
		app.store.addLive({ intervalMs: 10 });

		await until(() => app.store.get().datasets[0]!.warnings.length > 0);
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(app.store.get().datasets[0]!.warnings.filter((w) => w.code === 'UNKNOWN_SHAPE')).toHaveLength(1);
	});
});

/**
 * The status page, which is a view of data that has no time axis at all.
 *
 * Kept honest by construction: everything it renders comes off the API's own allowlist, and
 * the two things it cannot know — decision history, and when a device last reported — are
 * stated rather than approximated.
 */
describe('live status page', () => {
	let app: MotrixApp;

	beforeEach(async () => {
		globalThis.sessionStorage.clear();
		globalThis.fetch = (async (url: string) => {
			const body = url.endsWith('/devices')
				? {
						count: 1,
						simulation_time: '2013-09-27T00:03:00+02:00',
						devices: [
							{
								name: 'shelly_plug',
								class: 'ShellyPlug',
								connector: 'replay',
								protocol: 'mqtt',
								readable: true,
								writable: true,
								connected: true,
								data_ready: true,
								capabilities: ['Switch'],
								metrics: null,
								total_energy_kwh: 3.25,
								data: { power: '120.5' },
							},
						],
					}
				: url.endsWith('/workers')
					? {
							count: 1,
							workers: [
								{
									name: 'AutoToggle',
									axis: 'algorithm',
									class: 'AutoToggle',
									state: 'running',
									restarts: 1,
									crashes: 1,
									max_restarts: 3,
									restart_enabled: true,
									stopping: false,
									runs: 42,
									last_run: '2026-08-09T10:00:00',
								},
							],
						}
					: {
							status: 'degraded',
							uptime_seconds: 3661,
							clock: {
								simulated: true,
								generation: 17,
								step_time: '2013-09-27T00:03:00+02:00',
								pending: ['AutoToggle'],
							},
							workers: { total: 1, running: 1, finished: 0, down: 0, lost: 0, crashed: 1, restarts: 1 },
							devices: { total: 1, connected: 1, data_ready: 1 },
						};
			return new Response(JSON.stringify(body), { status: 200 });
		}) as unknown as typeof fetch;

		app = document.createElement('motrix-app');
		document.body.append(app);
		await app.updateComplete;
	});

	afterEach(() => app.remove());

	function page(): (Element & { renderRoot: ParentNode & { textContent: string | null } }) | null {
		return app.renderRoot.querySelector('motrix-live-status') as never;
	}

	async function open(): Promise<string> {
		app.store.setView('live');
		await app.updateComplete;
		const deadline = Date.now() + 4000;
		for (;;) {
			const element = page();
			await (element as unknown as { updateComplete?: Promise<unknown> } | null)?.updateComplete;
			const text = element?.renderRoot.textContent ?? '';
			if (text.includes('Uptime')) return text;
			if (Date.now() > deadline) throw new Error(`timed out; saw: ${text.slice(0, 200)}`);
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}

	it('renders health, the clock, devices and workers from the live API', async () => {
		const text = await open();

		// degraded answers 200 on the EMS side, so this page is the only place a worker that
		// crashed and recovered is visible without reading /workers by hand.
		expect(text).toContain('crashed and recovered');
		expect(text).toContain('1h 1m');
		expect(text).toContain('shelly_plug');
		expect(text).toContain('Switch');
		expect(text).toContain('AutoToggle');
		expect(text).toContain('3.25');
	});

	it('names who a wedged step is waiting on', async () => {
		const text = await open();
		// clock.pending is the whole diagnosis for a replay that stopped advancing.
		expect(text).toContain('still waiting on');
	});

	it('says plainly what it cannot show', async () => {
		const text = await open();
		expect(text).toContain('algorithm_decisions.csv');
		expect(text).toContain('never when it last reported');
	});

	it('stops polling when the page is left', async () => {
		await open();
		let after = 0;
		const original = globalThis.fetch;
		globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
			after++;
			return original(...args);
		}) as typeof fetch;

		app.store.setView('home');
		await app.updateComplete;
		await new Promise((resolve) => setTimeout(resolve, 120));
		// The feed refcounts; leaving unsubscribes and the last unsubscribe stops the poller.
		expect(after).toBe(0);
	});
});

/**
 * The status page against an EMS answering enum values it has never heard of.
 *
 * `status` and a worker's `state` are strings on the wire — the runtime guards check only
 * that, deliberately. They used to be interpolated straight into a catalogue key, so an
 * unrecognised value looked up `undefined` and threw a TypeError inside Lit's render: the
 * element committed no DOM at all, and every 5s poll did it again. The page has to stay on
 * screen, and it has to say what the EMS actually sent.
 */
describe('live status page with unrecognised enum values', () => {
	let app: MotrixApp;
	// A state that is also markup, to pin that the raw value is text and never parsed.
	const HOSTILE_STATE = '<img src=x onerror="boom()">';

	beforeEach(async () => {
		globalThis.sessionStorage.clear();
		globalThis.fetch = (async (url: string) => {
			const body = url.endsWith('/devices')
				? { count: 0, simulation_time: null, devices: [] }
				: url.endsWith('/workers')
					? {
							count: 1,
							workers: [
								{
									name: 'AutoToggle',
									axis: 'algorithm',
									class: 'AutoToggle',
									state: HOSTILE_STATE,
									restarts: 0,
									crashes: 0,
									max_restarts: 3,
									restart_enabled: true,
									stopping: false,
								},
							],
						}
					: {
							status: 'pwned',
							uptime_seconds: 3661,
							clock: { simulated: false, generation: 0, step_time: null, pending: [] },
							workers: { total: 1, running: 0, finished: 0, down: 0, lost: 0, crashed: 0, restarts: 0 },
							devices: { total: 0, connected: 0, data_ready: 0 },
						};
			return new Response(JSON.stringify(body), { status: 200 });
		}) as unknown as typeof fetch;

		app = document.createElement('motrix-app');
		document.body.append(app);
		await app.updateComplete;
	});

	afterEach(() => app.remove());

	function page(): (Element & { renderRoot: ParentNode & { textContent: string | null } }) | null {
		return app.renderRoot.querySelector('motrix-live-status') as never;
	}

	async function open(): Promise<string> {
		app.store.setView('live');
		await app.updateComplete;
		const deadline = Date.now() + 4000;
		for (;;) {
			const element = page();
			await (element as unknown as { updateComplete?: Promise<unknown> } | null)?.updateComplete;
			const text = element?.renderRoot.textContent ?? '';
			// Uptime only appears once the health section has committed — which is exactly what
			// a render that threw never does.
			if (text.includes('Uptime')) return text;
			if (Date.now() > deadline) throw new Error(`timed out; saw: ${text.slice(0, 200)}`);
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}

	it('still renders the page, with the fallback label and the raw value', async () => {
		const text = await open();

		expect(text).toContain('does not know');
		expect(text).toContain('pwned');
		expect(text).toContain('unknown');
		expect(text).toContain(HOSTILE_STATE);
		// The rest of the page is unaffected: this is a fallback label, not a failed render.
		expect(text).toContain('1h 1m');
	});

	it('renders the raw value as text rather than as markup', async () => {
		await open();
		expect(page()!.renderRoot.querySelector('img')).toBeNull();
	});
});

/**
 * The status page against a payload it cannot fully walk.
 *
 * Same failure as an unrecognised enum value and a different cause: the page maps over
 * `clock.pending` and `device.capabilities`, and the guards checked neither. A render that
 * throws commits no DOM at all — this poll and every one after it — so the page has to be
 * handed a response whose lists are lists.
 */
describe('live status page with an unwalkable payload', () => {
	let app: MotrixApp;

	beforeEach(async () => {
		globalThis.sessionStorage.clear();
		globalThis.fetch = (async (url: string) => {
			const body = url.endsWith('/devices')
				? {
						count: 2,
						simulation_time: null,
						// One element that is not a device at all, and one real device that is
						// missing the capability list the page renders as chips.
						devices: [
							null,
							{
								name: 'shelly_plug',
								class: 'ShellyPlug',
								connector: 'replay',
								protocol: 'mqtt',
								readable: true,
								writable: true,
								connected: true,
								data_ready: true,
								metrics: null,
								total_energy_kwh: 3.25,
								data: {},
							},
						],
					}
				: url.endsWith('/workers')
					? { count: 1, workers: [null] }
					: {
							status: 'ok',
							uptime_seconds: 3661,
							// No `pending` key at all. A record was all the old guard asked for.
							clock: { simulated: true, generation: 17, step_time: '2013-09-27T00:03:00+02:00' },
							workers: { total: 1, running: 1, finished: 0, down: 0, lost: 0, crashed: 0, restarts: 0 },
							devices: { total: 1, connected: 1, data_ready: 1 },
						};
			return new Response(JSON.stringify(body), { status: 200 });
		}) as unknown as typeof fetch;

		app = document.createElement('motrix-app');
		document.body.append(app);
		await app.updateComplete;
	});

	afterEach(() => app.remove());

	function page(): (Element & { renderRoot: ParentNode & { textContent: string | null } }) | null {
		return app.renderRoot.querySelector('motrix-live-status') as never;
	}

	async function open(): Promise<string> {
		app.store.setView('live');
		await app.updateComplete;
		const deadline = Date.now() + 4000;
		for (;;) {
			const element = page();
			await (element as unknown as { updateComplete?: Promise<unknown> } | null)?.updateComplete;
			const text = element?.renderRoot.textContent ?? '';
			// "Uptime" only appears once a render has committed — which is exactly what a
			// render that threw never does.
			if (text.includes('Uptime')) return text;
			if (Date.now() > deadline) throw new Error(`timed out; saw: ${text.slice(0, 200)}`);
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}

	it('renders everything it can walk and throws over none of it', async () => {
		const text = await open();
		expect(text).toContain('1h 1m');
		// The nameless element is gone; the device beside it, chips or no chips, is not.
		expect(text).toContain('shelly_plug');
		expect(text).toContain('3.25');
	});
});

/**
 * Follow mode survives the chart's own initialisation.
 *
 * uPlot fires setScale for its OWN auto-range — on the first paint, and again whenever the
 * series set changes. Reading that as a user zoom switched follow off before the first
 * frame reached the screen, which meant following never worked at all in a real browser
 * while every unit test passed.
 */
describe('follow mode against a chart', () => {
	let app: MotrixApp;

	beforeEach(async () => {
		globalThis.sessionStorage.clear();
		let step = 0;
		globalThis.fetch = (async (url: string) => {
			step++;
			const body = url.endsWith('/devices')
				? {
						count: 1,
						simulation_time: `2013-09-27T00:${String(step % 60).padStart(2, '0')}:00+02:00`,
						devices: [
							{
								name: 'p1_meter',
								class: 'P1',
								connector: 'replay',
								protocol: 'mqtt',
								readable: true,
								writable: false,
								connected: true,
								data_ready: true,
								capabilities: ['EnergyMeter'],
								metrics: null,
								total_energy_kwh: 10 + step,
								data: { power: { value: 100 + step, unit: 'W' } },
							},
						],
					}
				: url.endsWith('/workers')
					? { count: 0, workers: [] }
					: {
							status: 'ok',
							uptime_seconds: 1,
							clock: { simulated: true, generation: step, step_time: '2013-09-27T00:00:00+02:00', pending: [] },
							workers: { total: 1, running: 1, finished: 0, down: 0, lost: 0, crashed: 0, restarts: 0 },
							devices: { total: 1, connected: 1, data_ready: 1 },
						};
			return new Response(JSON.stringify(body), { status: 200 });
		}) as unknown as typeof fetch;

		app = document.createElement('motrix-app');
		document.body.append(app);
		await app.updateComplete;
	});

	afterEach(() => {
		for (const dataset of app.store.get().datasets) app.store.removeDataset(dataset.id);
		app.remove();
	});

	it('stays on while charts render themselves', async () => {
		expect(app.store.get().follow.on).toBe(true);
		app.store.addLive({ intervalMs: 20 });

		const deadline = Date.now() + 4000;
		while (app.store.get().datasets[0]!.events.length < 4) {
			if (Date.now() > deadline) throw new Error('timed out');
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		await app.updateComplete;
		await new Promise((resolve) => setTimeout(resolve, 200));
		await app.updateComplete;

		// The whole point: charts have mounted, taken data and set their own scales by now.
		expect(app.store.get().follow.on, 'chart initialisation must not read as a user zoom').toBe(true);
	});
});

/**
 * Decisions over the live API, and the degradation when the EMS does not serve them.
 *
 * The 404 path is the load-bearing half: this viewer must keep working, unchanged and
 * uncomplaining, against an EMS built before `GET /decisions` existed.
 */
describe('live decisions', () => {
	let app: MotrixApp;
	let decisionsStatus = 200;
	let decisionsRequests = 0;
	let seq = 0;

	const EMPTY = {
		count: 0,
		total: 0,
		retained: 0,
		capacity: 1000,
		oldest_seq: null,
		missed: 0,
		next_cursor: 0,
		has_more: false,
		epoch: 'e1',
		simulation_time: null,
		decisions: [],
	};

	async function until(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (!predicate()) {
			if (Date.now() > deadline) throw new Error('timed out');
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}

	beforeEach(async () => {
		decisionsStatus = 200;
		decisionsRequests = 0;
		seq = 0;
		globalThis.sessionStorage.clear();

		globalThis.fetch = (async (url: string) => {
			if (url.includes('/decisions')) {
				decisionsRequests++;
				if (decisionsStatus !== 200) {
					return new Response('not found', { status: decisionsStatus });
				}
				// `limit=0` is the seek-to-head probe: it must deliver nothing.
				if (url.includes('limit=0')) return new Response(JSON.stringify(EMPTY), { status: 200 });
				// Two decisions per page, carrying the SAME command. That is the case content
				// hashing would destroy: byte-identical decisions at different sequence numbers
				// are two real events, and the project's own fixture is full of them.
				const first = ++seq;
				const second = ++seq;
				const command = first % 4 === 1 ? 'off' : 'on';
				return new Response(
					JSON.stringify({
						...EMPTY,
						count: 2,
						total: seq,
						retained: seq,
						oldest_seq: 1,
						next_cursor: seq,
						decisions: [first, second].map((n) => ({
							seq: n,
							timestamp: `2013-09-27T00:${String(n).padStart(2, '0')}:00+02:00`,
							algorithm: 'AutoToggle',
							device: 'shelly_plug',
							command,
						})),
					}),
					{ status: 200 },
				);
			}
			const body = url.endsWith('/devices')
				? { count: 0, simulation_time: '2013-09-27T00:01:00+02:00', devices: [] }
				: url.endsWith('/workers')
					? { count: 0, workers: [] }
					: {
							status: 'ok',
							uptime_seconds: 1,
							clock: { simulated: true, generation: 1, step_time: '2013-09-27T00:01:00+02:00', pending: [] },
							workers: { total: 1, running: 1, finished: 0, down: 0, lost: 0, crashed: 0, restarts: 0 },
							devices: { total: 0, connected: 0, data_ready: 0 },
						};
			return new Response(JSON.stringify(body), { status: 200 });
		}) as unknown as typeof fetch;

		app = document.createElement('motrix-app');
		document.body.append(app);
		await app.updateComplete;
		await until(() => app.store.get().liveProbe !== 'pending');
	});

	afterEach(() => {
		for (const dataset of app.store.get().datasets) app.store.removeDataset(dataset.id);
		app.store.liveFeed.close();
		app.remove();
	});

	it('detects the capability at boot with one seek-to-head request', async () => {
		expect(app.store.get().liveDecisions).toBe('available');
		expect(decisionsRequests).toBe(1);
	});

	it('carries decisions on a live dataset, beside the readings', async () => {
		app.store.addLive({ intervalMs: 20 });
		await until(() => (app.store.get().datasets[0]?.kindCounts.get('decision') ?? 0) >= 2);

		const dataset = app.store.get().datasets[0]!;
		const decisions = dataset.events.filter((event) => event.kind === 'decision');
		expect(decisions[0]!.source).toBe('AutoToggle');
		expect(decisions[0]!.target).toBe('shelly_plug');
		expect(decisions.map((event) => event.raw)).toContain('off');
	});

	it('does not dedupe two identical commands', async () => {
		// The same guarantee live.test.ts pins on the pure function, through the real feed.
		app.store.addLive({ intervalMs: 20 });
		await until(() => (app.store.get().datasets[0]?.kindCounts.get('decision') ?? 0) >= 2);
		const raws = app.store.get().datasets[0]!.events.filter((e) => e.kind === 'decision').map((e) => e.raw);
		expect(raws).toEqual(['off', 'off']);
	});

	describe('against an EMS that does not have the route', () => {
		beforeEach(async () => {
			decisionsStatus = 404;
			decisionsRequests = 0;
			app.remove();
			app = document.createElement('motrix-app');
			document.body.append(app);
			await app.updateComplete;
			await until(() => app.store.get().liveProbe !== 'pending');
		});

		it('reports the capability as absent', () => {
			expect(app.store.get().liveDecisions).toBe('absent');
		});

		it('keeps readings streaming, with nothing said about decisions', async () => {
			app.store.addLive({ intervalMs: 20 });
			await until(() => app.store.get().datasets[0]?.status.phase === 'streaming');
			await new Promise((resolve) => setTimeout(resolve, 150));

			const dataset = app.store.get().datasets[0]!;
			expect(dataset.status.phase).toBe('streaming');
			// A missing route on an older EMS is not a fault, so it must not warn, must not
			// count as a failure, and must not show up in the load report.
			expect(dataset.warnings.filter((w) => w.code === 'HTTP' || w.code === 'DECISIONS_RESET')).toHaveLength(0);
		});

		it('asks exactly once for the whole session, even with two live datasets', async () => {
			const before = decisionsRequests;
			app.store.addLive({ intervalMs: 20 });
			app.store.addLive({ intervalMs: 20 });
			await new Promise((resolve) => setTimeout(resolve, 200));
			expect(decisionsRequests).toBe(before);
		});
	});
});
