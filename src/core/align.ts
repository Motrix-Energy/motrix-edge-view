import type { ColumnSlice } from './columns.js';

/**
 * uPlot wants one shared x array with every series the same length, so N independent
 * series have to be aligned onto their union of timestamps.
 *
 * The interesting decision is what to put where a series has no sample. Two different
 * things can be true, and conflating them is a lie about the data:
 *
 *   - the series simply samples on a **different cadence** (a meter every 15 minutes, a
 *     plug every 30 seconds), or a decision **holds** its value until the next one — a
 *     heat-pump setpoint really is 21°C between commands;
 *   - the EMS **received nothing**, because the device was silent or its payload was
 *     rejected. The EMS writes no row at all in that case, deliberately, so that a stalled
 *     meter reads as missing data rather than as a flat line.
 *
 * So: hold the previous value while the neighbouring samples are within `gapMs`, and emit
 * `null` — which uPlot draws as a real break — beyond it. Neither `spanGaps: true` nor
 * `spanGaps: false` can express that on its own.
 */
export interface AlignInput {
	readonly slice: ColumnSlice;
	readonly gapMs: number;
	/** Render-time shift for t₀-normalised alignment. */
	readonly offsetMs: number;
}

/** uPlot's AlignedData shape: `[xs, ...series]`, series values nullable. */
export type AlignedData = [number[], ...(number | null)[][]];

export function alignSeries(inputs: readonly AlignInput[]): AlignedData {
	if (inputs.length === 0) return [[]];

	// Union of every timestamp, in order. A k-way merge over already-sorted inputs.
	const cursors = new Uint32Array(inputs.length);
	const xs: number[] = [];
	for (;;) {
		let next = Infinity;
		for (let i = 0; i < inputs.length; i++) {
			const cursor = cursors[i]!;
			if (cursor >= inputs[i]!.slice.length) continue;
			const t = inputs[i]!.slice.t[cursor]! + inputs[i]!.offsetMs;
			if (t < next) next = t;
		}
		if (next === Infinity) break;
		xs.push(next);
		for (let i = 0; i < inputs.length; i++) {
			const cursor = cursors[i]!;
			if (cursor >= inputs[i]!.slice.length) continue;
			if (inputs[i]!.slice.t[cursor]! + inputs[i]!.offsetMs === next) cursors[i] = cursor + 1;
		}
	}

	const series: (number | null)[][] = inputs.map(() => new Array<number | null>(xs.length).fill(null));

	for (let i = 0; i < inputs.length; i++) {
		const { slice, gapMs, offsetMs } = inputs[i]!;
		const out = series[i]!;
		let cursor = 0;
		let heldValue: number | null = null;
		let heldTime = -Infinity;

		for (let x = 0; x < xs.length; x++) {
			const target = xs[x]!;

			// Consume every sample at or before this x.
			while (cursor < slice.length && slice.t[cursor]! + offsetMs <= target) {
				heldValue = slice.v[cursor]!;
				heldTime = slice.t[cursor]! + offsetMs;
				cursor++;
			}

			if (heldTime === target) {
				out[x] = heldValue;
				continue;
			}
			if (heldValue === null) continue; // before this series started

			const nextTime = cursor < slice.length ? slice.t[cursor]! + offsetMs : Infinity;
			// Held only when both neighbours are close enough. A one-sided check would
			// extend the last sample of a series forever across the end of the chart.
			const withinBefore = target - heldTime <= gapMs;
			const withinAfter = nextTime - target <= gapMs;
			if (gapMs > 0 && withinBefore && withinAfter) out[x] = heldValue;
		}
	}

	return [xs, ...series];
}

/**
 * Dev-only invariant check.
 *
 * The align → downsample → render pipeline fails in a way that *looks right*: a bridged
 * gap, a shifted series, an axis autoscaled to a NaN. Cheap structural assertions catch the
 * mechanical half of that before it reaches a chart.
 */
export function assertAligned(data: AlignedData): void {
	const [xs, ...series] = data;
	for (let i = 1; i < xs.length; i++) {
		if (!(xs[i]! > xs[i - 1]!)) throw new Error(`x is not strictly increasing at ${i}`);
	}
	for (const values of series) {
		if (values.length !== xs.length) throw new Error('a series has a different length from x');
		for (const value of values) {
			if (value !== null && typeof value !== 'number') throw new Error('a series holds a non-number');
		}
	}
}
