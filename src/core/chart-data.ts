import { alignSeries, type AlignedData, type AlignInput } from './align.js';
import { fullSlice, sliceRange, type FieldColumn } from './columns.js';
import { lttb, targetPoints } from './lttb.js';
import { assignScales, type ScaleId } from './axes.js';

/**
 * One series a chart is drawing: a column, plus where it came from and how to shift it.
 */
export interface SeriesSpec {
	readonly key: string;
	readonly label: string;
	readonly colour: string;
	readonly column: FieldColumn;
	readonly offsetMs: number;
	/** Decisions hold their value between commands; readings interpolate. */
	readonly stepped: boolean;
}

export interface ChartRequest {
	readonly series: readonly SeriesSpec[];
	/** Visible x range in epoch ms, or null for everything. */
	readonly viewport: readonly [number, number] | null;
	readonly plotWidthPx: number;
	readonly devicePixelRatio: number;
}

export interface ChartData {
	readonly data: AlignedData;
	readonly scales: ReadonlyMap<string, ScaleId>;
	/** Real samples in view, before downsampling — what the refinement test asserts on. */
	readonly sampledFrom: number;
	readonly drawn: number;
}

/**
 * **The pure seam.** `(spec, viewport) -> AlignedData`, with no DOM and no uPlot.
 *
 * This function is the reason the chart pipeline is testable at all: jsdom has no canvas,
 * so uPlot itself can never be unit-tested, and narrowing uPlot's job to "render the array
 * we hand you" moves every decision that can be wrong into somewhere a test can reach.
 *
 * The order is load-bearing, and it is the fix for the prototype's inverted downsampling:
 *
 *   1. **slice** to the viewport (zero-copy views),
 *   2. **downsample** what is left, to a target derived from *pixels only*,
 *   3. **align** onto a shared x, holding within a cadence and breaking beyond it.
 *
 * Because the slice happens before the downsample, zooming in mechanically yields more real
 * samples per pixel. Refinement is automatic and unconditional — where the prototype
 * downsampled only while *not* zoomed, so zooming never refined and toggling a field while
 * zoomed pushed the whole array at the renderer.
 */
export function buildChartData(request: ChartRequest): ChartData {
	if (request.series.length === 0) return { data: [[]], scales: new Map(), sampledFrom: 0, drawn: 0 };

	const target = targetPoints(request.plotWidthPx, request.devicePixelRatio);
	const inputs: AlignInput[] = [];
	let sampledFrom = 0;
	let drawn = 0;

	for (const series of request.series) {
		const raw =
			request.viewport === null
				? fullSlice(series.column)
				: // Un-shift the viewport into the column's own time base, so t₀ alignment does
					// not need a second copy of the data.
					sliceRange(series.column, request.viewport[0] - series.offsetMs, request.viewport[1] - series.offsetMs);
		sampledFrom += raw.length;
		const reduced = lttb(raw, target);
		drawn += reduced.length;
		inputs.push({ slice: reduced, gapMs: series.column.gapMs, offsetMs: series.offsetMs });
	}

	return {
		data: alignSeries(inputs),
		// Keyed by the **series** key, not the column's. The same column can appear in two
		// charts under different series ids, and the chart looks its scale up by series —
		// so using the column's key silently returned undefined for every lookup.
		scales: assignScales(
			request.series.map((series) => ({
				key: series.key,
				unit: series.column.unit,
				min: series.column.min,
				max: series.column.max,
			})),
		),
		sampledFrom,
		drawn,
	};
}
