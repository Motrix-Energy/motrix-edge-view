import { describe, expect, it } from 'vitest';

import { alignSeries, assertAligned } from '../src/core/align.js';
import { assignScales, type SeriesRange } from '../src/core/axes.js';
import { buildChartData, type SeriesSpec } from '../src/core/chart-data.js';
import { append, createColumn, fullSlice, refreshGap, seal, sliceRange, trim, trimBefore } from '../src/core/columns.js';
import { lttb, targetPoints } from '../src/core/lttb.js';

function column(samples: readonly (readonly [number, number])[], unit: string | null = null) {
	const c = createColumn('k', unit);
	for (const [t, v] of samples) append(c, t, v);
	seal(c);
	return c;
}

describe('columns', () => {
	it('grows by doubling and keeps every sample', () => {
		const c = createColumn('k');
		for (let i = 0; i < 500; i++) append(c, i, i * 2);
		expect(c.n).toBe(500);
		expect(c.t.length).toBeGreaterThanOrEqual(500);
		expect(c.v[499]).toBe(998);
	});

	it('tracks min and max, ignoring non-finite samples', () => {
		const c = column([
			[0, 5],
			[1, NaN],
			[2, -3],
		]);
		expect(c.min).toBe(-3);
		expect(c.max).toBe(5);
	});

	it('sorts on seal, because EMS file order is write order not event order', () => {
		const c = column([
			[30, 3],
			[10, 1],
			[20, 2],
		]);
		expect([...c.t.subarray(0, c.n)]).toEqual([10, 20, 30]);
		expect([...c.v.subarray(0, c.n)]).toEqual([1, 2, 3]);
	});

	it('repairs a live column whose clock stepped backwards', () => {
		// A looping replay wraps its clock: the connector reaches the end of the file and
		// starts again ten days earlier. The live path never calls seal(), so before this was
		// repaired the column kept arrival order and the chart drew a line straight back
		// across itself to the origin — while the timeline beside it, repaired by
		// appendAscending, was perfectly ordered.
		const c = createColumn('k');
		for (const [t, v] of [
			[10, 1],
			[20, 2],
			[30, 3],
			[10, 4], // the wrap
			[20, 5],
		] as const) {
			append(c, t, v);
		}
		expect(c.unsorted).toBe(true);

		refreshGap(c);

		expect(c.unsorted).toBe(false);
		expect([...c.t.subarray(0, c.n)]).toEqual([10, 10, 20, 20, 30]);
		// Ascending is the property uPlot and sliceRange's binary search both depend on.
		for (let i = 1; i < c.n; i++) expect(c.t[i]!).toBeGreaterThanOrEqual(c.t[i - 1]!);
	});

	it('leaves an in-order live column alone', () => {
		// The flag is what keeps the per-poll cost O(1) rather than an O(n) isSorted scan over
		// a column that grows without bound.
		const c = createColumn('k');
		for (let i = 0; i < 10; i++) append(c, i * 10, i);
		expect(c.unsorted).toBe(false);
		refreshGap(c);
		expect([...c.t.subarray(0, c.n)]).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
	});

	it('derives the gap threshold from the median, not the mean', () => {
		// One long outage must not widen the threshold enough to bridge later gaps.
		const c = column([
			[0, 1],
			[1000, 1],
			[2000, 1],
			[3000, 1],
			[60_000, 1],
		]);
		expect(c.gapMs).toBe(3000); // median 1000 × 3
	});

	it('slices as a view, not a copy', () => {
		const c = column([
			[0, 1],
			[10, 2],
			[20, 3],
			[30, 4],
		]);
		const slice = sliceRange(c, 10, 20);
		expect([...slice.t]).toEqual([10, 20]);
		expect(slice.t.buffer).toBe(c.t.buffer); // zero-copy
	});

	it('slices inclusively at both ends, and copes with empty ranges', () => {
		const c = column([
			[0, 1],
			[10, 2],
		]);
		expect(sliceRange(c, 0, 10).length).toBe(2);
		expect(sliceRange(c, -100, -1).length).toBe(0);
		expect(sliceRange(c, 100, 200).length).toBe(0);
		expect(fullSlice(c).length).toBe(2);
	});

	it('trims the oldest samples and stays contiguous', () => {
		const c = column([
			[0, 1],
			[10, 2],
			[20, 3],
			[30, 4],
		]);
		expect(trim(c, 2)).toBe(2);
		expect(c.n).toBe(2);
		expect([...fullSlice(c).t]).toEqual([20, 30]);
		// Still sliceable afterwards, which a ring buffer would have made a two-segment read.
		expect(sliceRange(c, 20, 20).length).toBe(1);
	});

	it('trims by age', () => {
		const c = column([
			[0, 1],
			[10, 2],
			[20, 3],
		]);
		expect(trimBefore(c, 10)).toBe(1);
		expect([...fullSlice(c).t]).toEqual([10, 20]);
	});
});

describe('lttb', () => {
	const ramp = (n: number) => {
		const t = new Float64Array(n);
		const v = new Float64Array(n);
		for (let i = 0; i < n; i++) {
			t[i] = i;
			v[i] = i;
		}
		return { t, v, length: n };
	};

	it('returns the same objects when there is nothing to reduce', () => {
		const slice = ramp(100);
		const result = lttb(slice, 500);
		expect(result.t).toBe(slice.t); // identity, not a copy
		expect(result.v).toBe(slice.v);
	});

	it('reduces to the target count', () => {
		expect(lttb(ramp(10_000), 500).length).toBe(500);
	});

	it('keeps the first and last sample, so zooming does not appear to crop', () => {
		const result = lttb(ramp(10_000), 500);
		expect(result.t[0]).toBe(0);
		expect(result.t[result.length - 1]).toBe(9999);
	});

	it('keeps x monotonic', () => {
		const result = lttb(ramp(10_000), 500);
		for (let i = 1; i < result.length; i++) expect(result.t[i]!).toBeGreaterThan(result.t[i - 1]!);
	});

	it('preserves a lone spike — the property that justifies LTTB over stride sampling', () => {
		const n = 5000;
		const t = new Float64Array(n);
		const v = new Float64Array(n);
		for (let i = 0; i < n; i++) {
			t[i] = i;
			v[i] = 1;
		}
		v[2501] = 1000; // a load switching on, one sample wide
		const result = lttb({ t, v, length: n }, 300);
		expect(Math.max(...result.v)).toBe(1000);
	});

	it('does not let a NaN poison its bucket', () => {
		const n = 1000;
		const t = new Float64Array(n);
		const v = new Float64Array(n);
		for (let i = 0; i < n; i++) {
			t[i] = i;
			v[i] = Math.sin(i / 50) * 10;
		}
		v[500] = NaN;
		const result = lttb({ t, v, length: n }, 100);
		const finite = [...result.v].filter((value) => Number.isFinite(value));
		expect(finite.length).toBeGreaterThan(90); // the NaN cost at most its own slot
	});

	it('scales the target with width and never with zoom state', () => {
		expect(targetPoints(800, 1)).toBe(1200);
		expect(targetPoints(1600, 2)).toBe(4000); // clamped
		expect(targetPoints(10, 1)).toBe(500); // floored
	});
});

describe('alignSeries', () => {
	it('unions two cadences and holds within the gap threshold', () => {
		const fast = column([
			[0, 1],
			[10, 2],
			[20, 3],
		]);
		const slow = column([
			[0, 100],
			[20, 200],
		]);
		const [xs, a, b] = alignSeries([
			{ slice: fullSlice(fast), gapMs: fast.gapMs, offsetMs: 0 },
			{ slice: fullSlice(slow), gapMs: slow.gapMs, offsetMs: 0 },
		]);
		expect(xs).toEqual([0, 10, 20]);
		expect(a).toEqual([1, 2, 3]);
		expect(b).toEqual([100, 100, 200]); // held across its own sampling interval
	});

	it('breaks the line across a real gap rather than bridging it', () => {
		const sparse = column([
			[0, 1],
			[10, 2],
			[20, 3],
			[10_000, 4], // long outage
		]);
		const dense = column([
			[0, 0],
			[10, 0],
			[20, 0],
			[5000, 0],
			[10_000, 0],
		]);
		const [xs, values] = alignSeries([
			{ slice: fullSlice(sparse), gapMs: sparse.gapMs, offsetMs: 0 },
			{ slice: fullSlice(dense), gapMs: dense.gapMs, offsetMs: 0 },
		]);
		const at5000 = xs.indexOf(5000);
		expect(values![at5000]).toBeNull(); // the EMS received nothing here
	});

	it('emits null before a series starts', () => {
		const early = column([
			[0, 1],
			[10, 1],
		]);
		const late = column([
			[10, 5],
			[20, 5],
		]);
		const [, , lateValues] = alignSeries([
			{ slice: fullSlice(early), gapMs: early.gapMs, offsetMs: 0 },
			{ slice: fullSlice(late), gapMs: late.gapMs, offsetMs: 0 },
		]);
		expect(lateValues![0]).toBeNull();
	});

	it('applies a t₀ offset so two eras share one axis', () => {
		const a = column([
			[0, 1],
			[100, 2],
		]);
		const b = column([
			[1_000_000, 10],
			[1_000_100, 20],
		]);
		const [xs] = alignSeries([
			{ slice: fullSlice(a), gapMs: a.gapMs, offsetMs: 0 },
			{ slice: fullSlice(b), gapMs: b.gapMs, offsetMs: -1_000_000 },
		]);
		expect(xs).toEqual([0, 100]); // perfectly superimposed, which is the point
	});

	it('produces no duplicate x for identical timestamps', () => {
		const a = column([[5, 1]]);
		const b = column([[5, 2]]);
		const [xs] = alignSeries([
			{ slice: fullSlice(a), gapMs: 0, offsetMs: 0 },
			{ slice: fullSlice(b), gapMs: 0, offsetMs: 0 },
		]);
		expect(xs).toEqual([5]);
	});

	it('handles a single series and no series', () => {
		const a = column([
			[0, 1],
			[1, 2],
		]);
		expect(alignSeries([{ slice: fullSlice(a), gapMs: 0, offsetMs: 0 }])).toEqual([
			[0, 1],
			[1, 2],
		]);
		expect(alignSeries([])).toEqual([[]]);
	});

	it('passes its own invariant check', () => {
		const a = column([
			[0, 1],
			[10, 2],
		]);
		const b = column([
			[5, 3],
			[15, 4],
		]);
		assertAligned(
			alignSeries([
				{ slice: fullSlice(a), gapMs: a.gapMs, offsetMs: 0 },
				{ slice: fullSlice(b), gapMs: b.gapMs, offsetMs: 0 },
			]),
		);
	});
});

describe('assignScales', () => {
	const range = (key: string, min: number, max: number, unit: string | null = null): SeriesRange => ({
		key,
		unit,
		min,
		max,
	});

	it('puts a temperature and a power on different scales', () => {
		// The prototype's worst visible defect: on one axis the temperature is a flat line.
		const scales = assignScales([range('temp', 18, 22), range('power', 4000, 6000)]);
		expect(scales.get('temp')).not.toBe(scales.get('power'));
	});

	it('keeps series of similar magnitude together', () => {
		const scales = assignScales([range('a', 10, 20), range('b', 15, 25)]);
		expect(scales.get('a')).toBe(scales.get('b'));
	});

	it('lets a matching unit override magnitude', () => {
		// P1 volunteers units; two kWh registers belong together however far apart they read.
		const scales = assignScales([range('a', 0.5, 1, 'kWh'), range('b', 4000, 6000, 'kWh')]);
		expect(scales.get('a')).toBe(scales.get('b'));
	});

	it('separates differing units of similar magnitude', () => {
		const scales = assignScales([range('a', 10, 20, 'kWh'), range('b', 10, 20, 'V')]);
		expect(scales.get('a')).not.toBe(scales.get('b'));
	});

	it('never exceeds three scales, folding extras into the nearest', () => {
		const scales = assignScales([
			range('a', 1, 2),
			range('b', 100, 200),
			range('c', 10_000, 20_000),
			range('d', 1e6, 2e6),
			range('e', 1e8, 2e8),
		]);
		expect(new Set(scales.values()).size).toBeLessThanOrEqual(3);
		expect(scales.size).toBe(5); // and nothing was dropped off the chart
	});

	it('handles no series', () => {
		expect(assignScales([]).size).toBe(0);
	});
});

describe('buildChartData', () => {
	function spec(key: string, samples: readonly (readonly [number, number])[], offsetMs = 0): SeriesSpec {
		return { key, label: key, colour: '#fff', column: column(samples), offsetMs, stepped: false };
	}

	const dense = (n: number) => Array.from({ length: n }, (_, i) => [i * 1000, Math.sin(i / 10) * 50] as const);

	it('returns a valid empty chart for no series — a new chart must not render blank-then-crash', () => {
		const result = buildChartData({ series: [], viewport: null, plotWidthPx: 800, devicePixelRatio: 1 });
		expect(result.data).toEqual([[]]);
	});

	it('produces data on the very first call, with no separate initial path to forget', () => {
		// The prototype created charts with an empty trace array and only populated them on
		// the *next* interaction, so a chart added after loading rendered blank.
		const result = buildChartData({
			series: [spec('a', dense(100))],
			viewport: null,
			plotWidthPx: 800,
			devicePixelRatio: 1,
		});
		expect(result.data[0]!.length).toBeGreaterThan(0);
		expect(result.drawn).toBe(100);
	});

	it('downsamples a dense series to the pixel budget', () => {
		const result = buildChartData({
			series: [spec('a', dense(50_000))],
			viewport: null,
			plotWidthPx: 800,
			devicePixelRatio: 1,
		});
		expect(result.drawn).toBe(targetPoints(800, 1));
		expect(result.sampledFrom).toBe(50_000);
	});

	it('REFINES on zoom: a narrower viewport draws more real samples per pixel', () => {
		// The named regression for the prototype's inverted guard, stated as a property.
		const series = [spec('a', dense(50_000))];
		const full = buildChartData({ series, viewport: null, plotWidthPx: 800, devicePixelRatio: 1 });
		const zoomed = buildChartData({
			series,
			viewport: [0, 5_000_000], // ~10% of the span
			plotWidthPx: 800,
			devicePixelRatio: 1,
		});

		// Same number of points drawn (both hit the budget)...
		expect(zoomed.drawn).toBe(full.drawn);
		// ...but drawn from a tenth of the data, so each one is far closer to a real sample.
		expect(zoomed.sampledFrom).toBeLessThan(full.sampledFrom / 5);
		const fullRatio = full.drawn / full.sampledFrom;
		const zoomedRatio = zoomed.drawn / zoomed.sampledFrom;
		expect(zoomedRatio).toBeGreaterThan(fullRatio);
	});

	it('does not downsample when the view already fits', () => {
		const result = buildChartData({
			series: [spec('a', dense(50_000))],
			viewport: [0, 100_000], // 100 samples
			plotWidthPx: 800,
			devicePixelRatio: 1,
		});
		expect(result.drawn).toBe(result.sampledFrom);
	});

	it('assigns scales across the series it was given', () => {
		const result = buildChartData({
			series: [
				spec(
					'temp',
					Array.from({ length: 50 }, (_, i) => [i * 1000, 20] as const),
				),
				spec(
					'power',
					Array.from({ length: 50 }, (_, i) => [i * 1000, 6000] as const),
				),
			],
			viewport: null,
			plotWidthPx: 800,
			devicePixelRatio: 1,
		});
		expect(result.scales.get('temp')).not.toBe(result.scales.get('power'));
	});

	it('applies the viewport in each series own time base', () => {
		const shifted = spec(
			'b',
			Array.from({ length: 100 }, (_, i) => [1_000_000 + i * 1000, i] as const),
			-1_000_000,
		);
		const result = buildChartData({
			series: [shifted],
			viewport: [0, 10_000], // in *rendered* coordinates
			plotWidthPx: 800,
			devicePixelRatio: 1,
		});
		expect(result.sampledFrom).toBe(11);
	});

	it('always emits a structurally valid frame', () => {
		const result = buildChartData({
			series: [spec('a', dense(5000)), spec('b', dense(3000))],
			viewport: null,
			plotWidthPx: 800,
			devicePixelRatio: 1,
		});
		assertAligned(result.data);
	});
});
