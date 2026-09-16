import type { ColumnSlice } from './columns.js';

/**
 * Largest-Triangle-Three-Buckets downsampling.
 *
 * Chosen over stride sampling because it preserves *shape*: a one-sample spike inside a
 * bucket wins the triangle-area contest against its flat neighbours and survives, where
 * every-Nth sampling drops it silently. On EMS data that spike is a load switching on.
 *
 * The identity fast path returns the **same** subarray objects, not copies — so the common
 * case of a zoomed-in view with fewer points than pixels costs nothing at all.
 */
export function lttb(slice: ColumnSlice, target: number): ColumnSlice {
	const n = slice.length;
	if (target >= n || target < 3 || n < 3) return slice;

	const t = new Float64Array(target);
	const v = new Float64Array(target);

	// First and last are always kept: the visible series must start and end where the data
	// does, or zooming appears to crop it.
	t[0] = slice.t[0]!;
	v[0] = slice.v[0]!;
	t[target - 1] = slice.t[n - 1]!;
	v[target - 1] = slice.v[n - 1]!;

	const every = (n - 2) / (target - 2);
	let a = 0; // the previously selected point

	for (let i = 0; i < target - 2; i++) {
		// Average of the *next* bucket, which is the third triangle vertex.
		const nextStart = Math.floor((i + 1) * every) + 1;
		const nextEnd = Math.min(Math.floor((i + 2) * every) + 1, n);
		let avgT = 0;
		let avgV = 0;
		let count = 0;
		for (let j = nextStart; j < nextEnd; j++) {
			const value = slice.v[j]!;
			// A NaN sample must not poison its bucket's average and take the whole bucket
			// with it; it is still eligible for selection below on its own merits.
			if (!Number.isFinite(value)) continue;
			avgT += slice.t[j]!;
			avgV += value;
			count++;
		}
		if (count > 0) {
			avgT /= count;
			avgV /= count;
		} else {
			avgT = slice.t[Math.min(nextStart, n - 1)]!;
			avgV = slice.v[a]!;
		}

		const rangeStart = Math.floor(i * every) + 1;
		const rangeEnd = Math.min(Math.floor((i + 1) * every) + 1, n);
		const aT = slice.t[a]!;
		const aV = slice.v[a]!;

		let bestArea = -1;
		let best = rangeStart;
		for (let j = rangeStart; j < rangeEnd; j++) {
			const value = slice.v[j]!;
			// A non-finite sample has no area; keep it only if nothing else is available, so
			// a gap marker inside a dense bucket does not erase a real reading.
			const area = Number.isFinite(value)
				? Math.abs((aT - avgT) * (value - aV) - (aT - slice.t[j]!) * (avgV - aV))
				: -0.5;
			if (area > bestArea) {
				bestArea = area;
				best = j;
			}
		}

		t[i + 1] = slice.t[best]!;
		v[i + 1] = slice.v[best]!;
		a = best;
	}

	return { t, v, length: target };
}

/**
 * How many points are worth drawing into a given width.
 *
 * Depends **only on pixels** — never on zoom state. That is the whole of the prototype's
 * inverted guard: it downsampled only while *not* zoomed, so zooming in never refined and
 * toggling a field while zoomed pushed the full array at the renderer.
 */
export function targetPoints(plotWidthPx: number, devicePixelRatio = 1): number {
	const ideal = Math.ceil(plotWidthPx * devicePixelRatio * 1.5);
	return Math.min(4000, Math.max(500, ideal));
}
