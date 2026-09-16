import { medianDelta } from './time.js';

/**
 * One field's samples, as two parallel typed arrays.
 *
 * Built **once**, during the single ingest walk. Toggling a field checkbox then costs two
 * binary searches and a zero-copy `subarray` — where the prototype rescanned every row of
 * every dataset for every checked field on every redraw, an F×N cost per click.
 *
 * `NaN` in `v` means "a sample arrived and its value was not finite" — the API's `"nan"`
 * encoding, or a real NaN. That is different from an absent sample, which is simply not in
 * the array. Charts render the first as a break and the second as a gap, and they are not
 * the same claim about the data.
 */
export interface FieldColumn {
	readonly key: string;
	/** Epoch milliseconds, ascending. Capacity is `t.length`; `n` is the fill count. */
	t: Float64Array;
	v: Float64Array;
	n: number;
	/** Median Δt × 3, computed by `seal()`. Wider than this is a real gap, not a cadence. */
	gapMs: number;
	unit: string | null;
	min: number;
	max: number;
	/**
	 * Set by `append` the moment a sample lands older than the one before it.
	 *
	 * A flag rather than a scan, because the live path has to answer "is this still in
	 * order?" on every poll, and `isSorted` is O(n) over a column that grows without bound —
	 * so asking it directly would make each poll cost more than the one before. Only an
	 * append can break the order, and an append knows it in O(1).
	 */
	unsorted: boolean;
}

const INITIAL_CAPACITY = 64;
/** How many median steps count as "still the same series" rather than a gap. */
const GAP_FACTOR = 3;

export function createColumn(key: string, unit: string | null = null): FieldColumn {
	return {
		key,
		t: new Float64Array(INITIAL_CAPACITY),
		v: new Float64Array(INITIAL_CAPACITY),
		n: 0,
		gapMs: 0,
		unit,
		min: Infinity,
		max: -Infinity,
		unsorted: false,
	};
}

/** Append one sample. Grows by doubling; the arrays stay contiguous, so reads stay cheap. */
export function append(column: FieldColumn, t: number, v: number): void {
	if (column.n === column.t.length) {
		const capacity = column.t.length * 2;
		const times = new Float64Array(capacity);
		const values = new Float64Array(capacity);
		times.set(column.t);
		values.set(column.v);
		column.t = times;
		column.v = values;
	}
	if (column.n > 0 && t < column.t[column.n - 1]!) column.unsorted = true;
	column.t[column.n] = t;
	column.v[column.n] = v;
	column.n++;
	if (Number.isFinite(v)) {
		if (v < column.min) column.min = v;
		if (v > column.max) column.max = v;
	}
}

/**
 * Finish a column: sort if needed, then derive the gap threshold.
 *
 * Sorting is conditional because EMS rows are *usually* in time order and a sort of a
 * hundred thousand samples is not free — but "usually" is not "always": several connector
 * threads append under one lock, so file order is write order.
 */
export function seal(column: FieldColumn): void {
	if (!isSorted(column)) sortColumn(column);
	column.gapMs = medianDelta(column.t, column.n) * GAP_FACTOR;
}

/**
 * Recompute `gapMs` from the recent cadence, without sorting. **Live columns only.**
 *
 * Not an optimisation — a live chart is blank without it. `alignSeries` holds a value across
 * a timestamp only when `gapMs > 0`, and `gapMs` is set by `seal()`, which only the file
 * source calls. So an unsealed live column turns every x where a series has no exact sample
 * into `null`, and since a chart card auto-selects *two* series and draws no point markers,
 * two series that never sample at the same instant render literally nothing.
 *
 * A median over the last `window` samples is also more honest for a live feed than seal()'s
 * all-time median: raising the poll interval from 2s to 15s should move the gap threshold
 * within a minute, not leave it anchored to an hour of 2s samples.
 *
 * Live samples arrive in order per column *nearly* always, so the sort is conditional on the
 * `unsorted` flag rather than unconditional — but it does happen. This used to report the
 * disorder without repairing it, on the reasoning that the store's append path already
 * raises NON_MONOTONIC when `appendAscending` reorders a batch. The flaw is that the repair
 * and the report covered different things: `appendAscending` fixes `dataset.events`, which
 * is what the *timeline* reads, while the chart reads this column. A looping replay wraps
 * its clock back ten days, and the chart drew a line straight back across itself to the
 * origin while the timeline beside it was perfectly ordered.
 *
 * So the column is repaired too, and the two surfaces agree again. The report is unchanged:
 * it still comes from the events path, which sees the same inversions — repairing here would
 * otherwise raise a second warning for one fact.
 */
export function refreshGap(column: FieldColumn, window = 64): void {
	if (column.unsorted) {
		sortColumn(column);
		column.unsorted = false;
	}
	if (column.n < 2) return;
	const from = Math.max(0, column.n - window);
	column.gapMs = medianDelta(column.t.subarray(from, column.n)) * GAP_FACTOR;
}

function isSorted(column: FieldColumn): boolean {
	for (let i = 1; i < column.n; i++) if (column.t[i]! < column.t[i - 1]!) return false;
	return true;
}

function sortColumn(column: FieldColumn): void {
	column.unsorted = false;
	const order = Array.from({ length: column.n }, (_, i) => i);
	order.sort((a, b) => column.t[a]! - column.t[b]!);
	const times = new Float64Array(column.n);
	const values = new Float64Array(column.n);
	for (let i = 0; i < column.n; i++) {
		times[i] = column.t[order[i]!]!;
		values[i] = column.v[order[i]!]!;
	}
	column.t.set(times);
	column.v.set(values);
}

export interface ColumnSlice {
	readonly t: Float64Array;
	readonly v: Float64Array;
	readonly length: number;
}

/**
 * The samples inside `[from, to]`, as **views** rather than copies.
 *
 * `subarray` shares the underlying buffer, so zooming does not allocate — which is what
 * makes "slice, then downsample" affordable on every frame.
 */
export function sliceRange(column: FieldColumn, from: number, to: number): ColumnSlice {
	const start = lowerBoundTime(column, from);
	const end = upperBoundTime(column, to);
	return { t: column.t.subarray(start, end), v: column.v.subarray(start, end), length: end - start };
}

/** Everything, as a view. */
export function fullSlice(column: FieldColumn): ColumnSlice {
	return { t: column.t.subarray(0, column.n), v: column.v.subarray(0, column.n), length: column.n };
}

function lowerBoundTime(column: FieldColumn, t: number): number {
	let low = 0;
	let high = column.n;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (column.t[mid]! < t) low = mid + 1;
		else high = mid;
	}
	return low;
}

function upperBoundTime(column: FieldColumn, t: number): number {
	let low = 0;
	let high = column.n;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (column.t[mid]! <= t) low = mid + 1;
		else high = mid;
	}
	return low;
}

/**
 * Drop the oldest samples from an unbounded (live) column.
 *
 * Compaction rather than a ring buffer. A ring wraps, which would force every reader —
 * every chart redraw — to handle two segments, to save a memmove that happens once per
 * quarter of capacity. `copyWithin` keeps every read path a contiguous `subarray`.
 */
export function trim(column: FieldColumn, keep: number): number {
	if (column.n <= keep) return 0;
	const drop = column.n - keep;
	column.t.copyWithin(0, drop, column.n);
	column.v.copyWithin(0, drop, column.n);
	column.n = keep;
	return drop;
}

/** Drop everything older than `cutoff`. */
export function trimBefore(column: FieldColumn, cutoff: number): number {
	const from = lowerBoundTime(column, cutoff);
	if (from === 0) return 0;
	return trim(column, column.n - from);
}
