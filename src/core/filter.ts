import type { DatasetId, EventKind, NormalisedEvent } from './types.js';

/**
 * The timeline filter.
 *
 * **Facets AND together; selections within a facet OR.** That is the fix for the
 * prototype's most confusing behaviour: its device and algorithm filters each narrowed
 * only their *own* event type, so picking a device left every algorithm decision visible
 * and vice versa. Users read that as a bug, and it is not reconstructible here — devices
 * and algorithms share one `actors` facet, with the kind shown as a badge.
 *
 * `null` means "no constraint", which is different from an empty set (which would match
 * nothing). Both are reachable in the UI, so both have to mean something.
 */
export interface TimelineFilter {
	readonly datasets: ReadonlySet<DatasetId> | null;
	readonly kinds: ReadonlySet<EventKind> | null;
	readonly actors: ReadonlySet<string> | null;
	readonly targets: ReadonlySet<string> | null;
	readonly text: string | null;
	/** Epoch ms, inclusive. Driven by chart zoom, never by a re-parsed date string. */
	readonly window: readonly [number, number] | null;
}

export const NO_FILTER: TimelineFilter = {
	datasets: null,
	kinds: null,
	actors: null,
	targets: null,
	text: null,
	window: null,
};

/**
 * Whether one event survives the filter.
 *
 * The window is checked by the caller via a binary-search slice rather than here — an O(n)
 * scan per zoom frame was the prototype's second-worst hotspot — so `window` is present in
 * the type for completeness and deliberately not evaluated in this function.
 */
export function matches(event: NormalisedEvent, dataset: DatasetId, filter: TimelineFilter, lowerText: string | null): boolean {
	if (filter.datasets !== null && !filter.datasets.has(dataset)) return false;
	if (filter.kinds !== null && !filter.kinds.has(event.kind)) return false;
	if (filter.actors !== null && !filter.actors.has(event.source)) return false;
	if (filter.targets !== null && (event.target === null || !filter.targets.has(event.target))) return false;
	if (lowerText !== null && lowerText !== '') {
		if (
			!event.source.toLowerCase().includes(lowerText) &&
			!(event.target ?? '').toLowerCase().includes(lowerText) &&
			!event.raw.toLowerCase().includes(lowerText)
		) {
			return false;
		}
	}
	return true;
}

/** Lower-case the text once per rebuild rather than once per event. */
export function normaliseText(filter: TimelineFilter): string | null {
	return filter.text === null ? null : filter.text.trim().toLowerCase();
}

/**
 * First index whose time is >= `t`, in an array sorted ascending by time.
 *
 * The window filter is two of these and a slice — O(log n) — where the prototype ran up to
 * three full `Array.filter` passes on every zoom event.
 */
export function lowerBound(events: readonly NormalisedEvent[], t: number): number {
	let low = 0;
	let high = events.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (events[mid]!.t < t) low = mid + 1;
		else high = mid;
	}
	return low;
}

/** First index whose time is > `t`. */
export function upperBound(events: readonly NormalisedEvent[], t: number): number {
	let low = 0;
	let high = events.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (events[mid]!.t <= t) low = mid + 1;
		else high = mid;
	}
	return low;
}
