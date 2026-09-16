import { lowerBound } from './filter.js';
import type { NormalisedEvent } from './types.js';

/**
 * Append a batch to a dataset's event array, keeping it ascending by `(t, seq)`.
 *
 * The invariant is load-bearing, not decoration: `mergeDatasets`, the window filter and
 * `trimDataset` all reach into this array with `lowerBound`/`upperBound`, and a binary
 * search over unsorted data returns an *arbitrary* index. One late instant is therefore
 * enough to drop events that genuinely fall inside the user's zoom window and to make
 * retention splice the wrong records — silently, with nothing on screen saying the view is
 * incomplete.
 *
 * A file source sorts before it emits, so it can promise order. A live feed cannot: its
 * instants come from the EMS's own clock, and `/workers` is stamped with a borrowed step
 * time that an interleaved `/devices` poll has already moved past. Nothing hostile has to
 * happen for the order to invert, which is why this repairs rather than rejects.
 *
 * Cost, which is the reason this is not `events.push(...batch)` followed by a sort:
 *
 *  - **Ordered batch — every ordinary poll.** One comparison per new event and a plain
 *    push. No allocation, no copy of the array, and the array keeps its identity: the big
 *    data stays outside the reactive graph exactly as before.
 *  - **Late batch.** Only the tail from the first index a late instant can affect is
 *    re-sorted, so the work is bounded by how far back the feed stepped, not by the length
 *    of the dataset.
 *
 * Returns how many events arrived out of order — `0` when nothing needed repairing, which
 * is what the caller uses to decide whether the user has to be told.
 */
export function appendAscending(events: NormalisedEvent[], batch: readonly NormalisedEvent[]): number {
	if (batch.length === 0) return 0;

	// Compared against the array's last instant *and* the batch's own running maximum, so a
	// batch that is unordered within itself is caught as well as one that starts too early.
	let previous = events.length === 0 ? -Infinity : events[events.length - 1]!.t;
	let earliest = Infinity;
	let inversions = 0;
	for (const event of batch) {
		if (event.t < previous) {
			inversions++;
			if (event.t < earliest) earliest = event.t;
		} else {
			previous = event.t;
		}
	}

	if (inversions === 0) {
		for (const event of batch) events.push(event);
		return 0;
	}

	// BEFORE the append, which is the only moment a binary search over this array is sound.
	// Everything below `from` is strictly older than every late instant, so re-sorting from
	// there leaves the whole array ascending.
	const from = lowerBound(events, earliest);
	for (const event of batch) events.push(event);

	// In place, never a reassignment: `dataset.events` is held by reference by the store, the
	// merge and the timeline. Only the tail is allocated.
	const tail = events.slice(from);
	tail.sort((a, b) => a.t - b.t || a.seq - b.seq);
	for (let i = 0; i < tail.length; i++) events[from + i] = tail[i]!;
	return inversions;
}
