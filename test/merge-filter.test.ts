import { describe, expect, it } from 'vitest';

import { NO_FILTER, lowerBound, upperBound, type TimelineFilter } from '../src/core/filter.js';
import { closestRow, mergeDatasets, type MergeInput } from '../src/core/merge.js';
import type { EventKind, NormalisedEvent } from '../src/core/types.js';

let seq = 0;
function event(t: number, kind: EventKind, source: string, target: string | null = null, raw = ''): NormalisedEvent {
	return { t, seq: seq++, kind, source, target, raw, preview: raw, naive: false };
}

function dataset(id: string, events: NormalisedEvent[], offsetMs = 0): MergeInput {
	return { id, events: [...events].sort((a, b) => a.t - b.t), offsetMs };
}

const filter = (overrides: Partial<TimelineFilter>): TimelineFilter => ({ ...NO_FILTER, ...overrides });

/** Read the merged index back as `${datasetId}:${t}` for legible assertions. */
function rows(index: ReturnType<typeof mergeDatasets>, inputs: MergeInput[]): string[] {
	const out: string[] = [];
	for (let i = 0; i < index.length; i++) {
		const input = inputs[index.datasetOrdinal[i]!]!;
		out.push(`${input.id}:${input.events[index.localIndex[i]!]!.t + input.offsetMs}`);
	}
	return out;
}

describe('lowerBound / upperBound', () => {
	const events = [event(10, 'reading', 'a'), event(20, 'reading', 'a'), event(20, 'reading', 'a'), event(30, 'reading', 'a')];

	it('finds the first index at or after a time', () => {
		expect(lowerBound(events, 5)).toBe(0);
		expect(lowerBound(events, 20)).toBe(1);
		expect(lowerBound(events, 25)).toBe(3);
		expect(lowerBound(events, 99)).toBe(4);
	});

	it('finds the first index strictly after a time', () => {
		expect(upperBound(events, 20)).toBe(3);
		expect(upperBound(events, 30)).toBe(4);
	});

	it('handles an empty array', () => {
		expect(lowerBound([], 1)).toBe(0);
		expect(upperBound([], 1)).toBe(0);
	});
});

describe('mergeDatasets', () => {
	it('interleaves two datasets in time order', () => {
		const a = dataset('a', [event(10, 'reading', 'dev'), event(30, 'reading', 'dev')]);
		const b = dataset('b', [event(20, 'reading', 'dev')]);
		expect(rows(mergeDatasets([a, b], NO_FILTER), [a, b])).toEqual(['a:10', 'b:20', 'a:30']);
	});

	it('is stable at equal timestamps — an EMS timestep writes many rows at one instant', () => {
		const a = dataset('a', [event(10, 'reading', 'x')]);
		const b = dataset('b', [event(10, 'reading', 'y')]);
		expect(rows(mergeDatasets([a, b], NO_FILTER), [a, b])).toEqual(['a:10', 'b:10']);
	});

	it('handles an empty dataset and no datasets at all', () => {
		const a = dataset('a', []);
		expect(mergeDatasets([a], NO_FILTER).length).toBe(0);
		expect(mergeDatasets([], NO_FILTER).length).toBe(0);
	});

	it('applies a t₀ offset without copying any events', () => {
		const a = dataset('a', [event(0, 'reading', 'dev'), event(100, 'reading', 'dev')]);
		const b = dataset('b', [event(1_000_000, 'reading', 'dev')], -1_000_000 + 50);
		expect(rows(mergeDatasets([a, b], NO_FILTER), [a, b])).toEqual(['a:0', 'b:50', 'a:100']);
	});
});

describe('mergeDatasets — the filter intersection invariant', () => {
	// The named regression for the prototype's most confusing behaviour: its device and
	// algorithm filters each narrowed only their own event type, so selecting a device left
	// every decision visible. Facets must AND.
	const events = [
		event(10, 'reading', 'p1_meter'),
		event(11, 'reading', 'shelly_plug'),
		event(12, 'decision', 'AutoToggle', 'shelly_plug'),
		event(13, 'decision', 'OtherAlgo', 'p1_meter'),
	];
	const a = dataset('a', events);

	it('selecting one actor hides every other event, of every kind', () => {
		const index = mergeDatasets([a], filter({ actors: new Set(['p1_meter']) }));
		expect(rows(index, [a])).toEqual(['a:10']);
	});

	it('actors and kinds intersect rather than union', () => {
		const index = mergeDatasets([a], filter({ actors: new Set(['AutoToggle']), kinds: new Set(['decision']) }));
		expect(rows(index, [a])).toEqual(['a:12']);
	});

	it('an actor of the wrong kind yields nothing, not everything of the other kind', () => {
		const index = mergeDatasets([a], filter({ actors: new Set(['p1_meter']), kinds: new Set(['decision']) }));
		expect(index.length).toBe(0);
	});

	it('selections within one facet OR', () => {
		const index = mergeDatasets([a], filter({ actors: new Set(['p1_meter', 'shelly_plug']) }));
		expect(rows(index, [a])).toEqual(['a:10', 'a:11']);
	});

	it('an empty set matches nothing, which is different from null', () => {
		expect(mergeDatasets([a], filter({ actors: new Set() })).length).toBe(0);
		expect(mergeDatasets([a], filter({ actors: null })).length).toBe(4);
	});

	it('filters by target device', () => {
		const index = mergeDatasets([a], filter({ targets: new Set(['shelly_plug']) }));
		expect(rows(index, [a])).toEqual(['a:12']);
	});

	it('filters by dataset', () => {
		const b = dataset('b', [event(15, 'reading', 'p1_meter')]);
		const index = mergeDatasets([a, b], filter({ datasets: new Set(['b']) }));
		expect(rows(index, [a, b])).toEqual(['b:15']);
	});
});

describe('mergeDatasets — the time window', () => {
	const a = dataset('a', [event(10, 'reading', 'd'), event(20, 'reading', 'd'), event(30, 'reading', 'd')]);

	it('is inclusive at both ends', () => {
		expect(rows(mergeDatasets([a], filter({ window: [10, 20] })), [a])).toEqual(['a:10', 'a:20']);
	});

	it('excludes everything outside', () => {
		expect(mergeDatasets([a], filter({ window: [100, 200] })).length).toBe(0);
	});

	it('is applied in the dataset time base, so a t₀ offset does not shift it wrongly', () => {
		const b = dataset('b', [event(1000, 'reading', 'd')], -900);
		// b's event renders at 100; a window of [90, 110] must catch it.
		expect(rows(mergeDatasets([b], filter({ window: [90, 110] })), [b])).toEqual(['b:100']);
	});
});

describe('mergeDatasets — text search', () => {
	const a = dataset('a', [
		event(10, 'reading', 'p1_meter', null, '{"power": 12.5}'),
		event(20, 'decision', 'AutoToggle', 'shelly_plug', 'on'),
	]);

	it('searches the payload', () => {
		expect(rows(mergeDatasets([a], filter({ text: 'power' })), [a])).toEqual(['a:10']);
	});

	it('searches the actor and the target', () => {
		expect(rows(mergeDatasets([a], filter({ text: 'shelly' })), [a])).toEqual(['a:20']);
		expect(rows(mergeDatasets([a], filter({ text: 'autotoggle' })), [a])).toEqual(['a:20']);
	});

	it('is case-insensitive and ignores surrounding space', () => {
		expect(rows(mergeDatasets([a], filter({ text: '  POWER ' })), [a])).toEqual(['a:10']);
	});

	it('treats empty text as no constraint', () => {
		expect(mergeDatasets([a], filter({ text: '   ' })).length).toBe(2);
	});
});

describe('closestRow', () => {
	const a = dataset('a', [event(0, 'reading', 'd'), event(100, 'reading', 'd'), event(200, 'reading', 'd')]);
	const index = mergeDatasets([a], NO_FILTER);

	it('finds the nearest row on either side', () => {
		expect(closestRow(index, [a], 0)).toBe(0);
		expect(closestRow(index, [a], 40)).toBe(0);
		expect(closestRow(index, [a], 60)).toBe(1);
		expect(closestRow(index, [a], 1000)).toBe(2);
		expect(closestRow(index, [a], -1000)).toBe(0);
	});

	it('returns -1 for an empty index', () => {
		expect(closestRow(mergeDatasets([], NO_FILTER), [], 0)).toBe(-1);
	});
});
