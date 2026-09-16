import { lowerBound, matches, normaliseText, upperBound, type TimelineFilter } from './filter.js';
import type { DatasetId, NormalisedEvent } from './types.js';

/**
 * One row of the merged timeline: which dataset it came from and where in that dataset.
 *
 * Two parallel `Uint32Array`s rather than an array of objects. At 100k events across six
 * datasets that is 800 KB of indices instead of several megabytes of short-lived objects,
 * and the virtualizer only ever needs the length plus random access.
 */
export interface MergedIndex {
	readonly datasetOrdinal: Uint32Array;
	readonly localIndex: Uint32Array;
	readonly length: number;
}

export interface MergeInput {
	readonly id: DatasetId;
	readonly events: readonly NormalisedEvent[];
	/** Render-time shift for t₀-normalised alignment. Zero in absolute mode. */
	readonly offsetMs: number;
}

const EMPTY: MergedIndex = { datasetOrdinal: new Uint32Array(0), localIndex: new Uint32Array(0), length: 0 };

/**
 * Merge N per-dataset event lists into one chronological index, applying the filter.
 *
 * A linear min-scan rather than a heap: k is the number of loaded datasets, realistically
 * six or fewer, and at that size the scan wins on both constant factor and readability.
 *
 * The time window is applied by binary-searching each dataset's slice bounds *before* the
 * merge, so zooming costs O(k log n) rather than a full pass per dataset per frame.
 */
export function mergeDatasets(inputs: readonly MergeInput[], filter: TimelineFilter): MergedIndex {
	if (inputs.length === 0) return EMPTY;

	const lowerText = normaliseText(filter);
	const cursor = new Uint32Array(inputs.length);
	const end = new Uint32Array(inputs.length);
	let total = 0;

	for (let d = 0; d < inputs.length; d++) {
		const input = inputs[d]!;
		if (filter.datasets !== null && !filter.datasets.has(input.id)) {
			cursor[d] = 0;
			end[d] = 0;
			continue;
		}
		if (filter.window === null) {
			cursor[d] = 0;
			end[d] = input.events.length;
		} else {
			// Un-shift the window into the dataset's own time base, so t₀ alignment does not
			// need a second copy of every event.
			const from = filter.window[0] - input.offsetMs;
			const to = filter.window[1] - input.offsetMs;
			cursor[d] = lowerBound(input.events, from);
			end[d] = upperBound(input.events, to);
		}
		total += end[d]! - cursor[d]!;
	}

	// Upper bound on the output; trimmed once the real count is known.
	const datasetOrdinal = new Uint32Array(total);
	const localIndex = new Uint32Array(total);
	let written = 0;

	for (;;) {
		let best = -1;
		let bestT = Infinity;
		for (let d = 0; d < inputs.length; d++) {
			if (cursor[d]! >= end[d]!) continue;
			const t = inputs[d]!.events[cursor[d]!]!.t + inputs[d]!.offsetMs;
			// Strictly less than: ties keep dataset order, which keeps the merge stable and
			// makes an EMS timestep (many rows at one instant) read in a predictable order.
			if (t < bestT) {
				bestT = t;
				best = d;
			}
		}
		if (best === -1) break;

		const input = inputs[best]!;
		const index = cursor[best]!;
		cursor[best] = index + 1;

		if (matches(input.events[index]!, input.id, filter, lowerText)) {
			datasetOrdinal[written] = best;
			localIndex[written] = index;
			written++;
		}
	}

	return {
		datasetOrdinal: datasetOrdinal.subarray(0, written),
		localIndex: localIndex.subarray(0, written),
		length: written,
	};
}

/**
 * Index of the merged row closest to `t`.
 *
 * Used when a chart click has to scroll the timeline to the moment that was clicked.
 * Linear over the merged index would be fine at 10k and painful at 500k, so it binary
 * searches — which the merged index supports because it is built in time order.
 */
export function closestRow(index: MergedIndex, inputs: readonly MergeInput[], t: number): number {
	if (index.length === 0) return -1;
	const timeAt = (row: number) => {
		const input = inputs[index.datasetOrdinal[row]!]!;
		return input.events[index.localIndex[row]!]!.t + input.offsetMs;
	};

	let low = 0;
	let high = index.length - 1;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (timeAt(mid) < t) low = mid + 1;
		else high = mid;
	}
	if (low > 0 && Math.abs(timeAt(low - 1) - t) <= Math.abs(timeAt(low) - t)) return low - 1;
	return low;
}
