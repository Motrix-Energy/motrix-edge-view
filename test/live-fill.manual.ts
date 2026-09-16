/**
 * Manual integration check: does a live chart actually fill against a running EMS?
 *
 * Not part of `npm test`: the repo's projects match `test/**\/*.test.ts`, and this ends
 * `.manual.ts` so they cannot see it. It needs an EMS answering on 127.0.0.1:8000 and runs
 * for three minutes, which is not something a normal test run should wait for. Ask for it:
 *
 *     npx vitest run --config vitest.manual.config.ts
 *
 * It drives the *same* modules the live source drives — the two response validators,
 * normaliseDevices / normaliseDecisions, Ingestor, ColumnStore, appendAscending,
 * trimDataset — over real HTTP, so what it proves about the fill is what the chart shows.
 *
 * It covers a gap a unit test cannot reach and a browser could not hold open: two separate
 * bugs made the live chart look permanently empty, and both needed *minutes of a real feed*
 * to show themselves. Retention measured its age window in data time, so a replay clock
 * running thousands of times faster than the wall clock cut the dataset to a single event on
 * every batch; and the follow window was a duration, so every size offered was narrower than
 * the gap between two consecutive samples. See RetentionPolicy.minEvents and AppState.follow.
 */
import { describe, expect, it } from 'vitest';

import { ColumnStore } from '../src/core/column-store.js';
import { Ingestor } from '../src/core/ingest.js';
import { appendAscending } from '../src/core/order.js';
import { DEFAULT_RETENTION, trimDataset } from '../src/core/retention.js';
import type { NormalisedEvent } from '../src/core/types.js';
import { checkDecisionsResponse, checkDevicesResponse } from '../src/sources/live/api-types.js';
import {
	createDedupeState,
	normaliseDecisions,
	normaliseDevices,
	type TimeBase,
} from '../src/sources/live/live-normalise.js';

const BASE = 'http://127.0.0.1:8000';
const POLL_MS = 2000;
const RUN_MS = 180_000;

const SIMULATED: TimeBase = { resolved: true, simulated: true, lastStepTime: null, naiveZone: 'local' };

async function json(path: string): Promise<unknown> {
	const response = await fetch(BASE + path);
	return response.json();
}

describe('live fill against a running EMS', () => {
	it('accumulates enough samples to satisfy the follow window', async () => {
		const events: NormalisedEvent[] = [];
		const columns = new ColumnStore();
		const pending: NormalisedEvent[] = [];
		const ingestor = new Ingestor({
			onSample: (kind, actor, path, t, value, unit) => columns.sample(kind, actor, path, t, value, unit),
			onEvent: (event) => pending.push(event),
		});
		const dedupe = createDedupeState();
		let row = 0;
		let cursor = -1;
		let tMax = -Infinity;
		let dropped = 0;

		const started = Date.now();
		let polls = 0;
		let rejected = 0;
		while (Date.now() - started < RUN_MS) {
			const receivedAt = Date.now();

			// Through the same validators LiveSource uses, so a malformed payload is rejected
			// here exactly as it would be in the app rather than trusted because it is ours.
			const devicesBody = checkDevicesResponse(await json('/devices'));
			const decisionsBody = checkDecisionsResponse(await json(`/decisions?after=${cursor}&limit=500`));
			if (devicesBody === null || decisionsBody === null) {
				rejected++;
				await new Promise((resolve) => setTimeout(resolve, POLL_MS));
				continue;
			}
			cursor = decisionsBody.value.next_cursor ?? cursor;
			const devices = normaliseDevices(devicesBody.value, SIMULATED, dedupe, receivedAt, POLL_MS);
			const decisions = normaliseDecisions(decisionsBody.value, SIMULATED, receivedAt);

			pending.length = 0;
			for (const record of [...devices.records, ...decisions.records]) {
				ingestor.addAt(record.kind, record.actor, record.target, record.t, record.naive, record.raw, ++row);
			}
			if (pending.length > 0) {
				appendAscending(events, pending.splice(0));
				for (const event of events) if (!(tMax >= event.t)) tMax = event.t;
				columns.refreshGaps();
				dropped += trimDataset(events, columns, tMax, DEFAULT_RETENTION).eventsDropped;
			}
			polls++;
			await new Promise((resolve) => setTimeout(resolve, POLL_MS));
		}

		const span = (k: number) => {
			if (events.length < 2) return null;
			const oldest = events[Math.max(0, events.length - k)]!.t;
			const newest = events[events.length - 1]!.t;
			return oldest < newest ? Math.round((newest - oldest) / 60_000) : null;
		};

		// The busiest series rather than a named one: which field a given site actually
		// charts is a property of its config, and this harness runs against any of them.
		const busiest = [...columns.values()].reduce<number>((best, column) => Math.max(best, column.n), 0);
		console.log(
			`\n  polls=${polls}  rejectedPayloads=${rejected}  events=${events.length}  droppedByRetention=${dropped}` +
				`\n  distinct instants=${new Set(events.map((event) => event.t)).size}` +
				`\n  columns=${[...columns.values()].length}  busiest column samples=${busiest}` +
				`\n  window span (simulated minutes): 50=${span(50)}  200=${span(200)}  1000=${span(1000)}\n`,
		);

		expect(events.length, 'a three-minute live run must fill past the default 200-sample window').toBeGreaterThan(200);
		expect(span(200), 'the 200-sample window must have real width').toBeGreaterThan(0);
		expect(span(50)!, 'a smaller window must be strictly narrower than a larger one').toBeLessThan(span(1000)!);
	});
});
