import type { ColumnStore } from './column-store.js';
import { trimBefore } from './columns.js';
import { lowerBound } from './filter.js';
import type { EventKind, NormalisedEvent } from './types.js';

/**
 * How much of an unbounded source to keep.
 *
 * **Both bounds, not one.** Time is what a user reasons about — "the last hour" is a
 * sentence somebody says. Count is the memory guarantee: a 200-device EMS polled every two
 * seconds produces around 360 000 events an hour, so a time bound alone bounds nothing on a
 * large site. Whichever binds first wins. The time window is a UI knob; the count is a
 * safety net and is deliberately not exposed.
 */
export interface RetentionPolicy {
	readonly windowMs: number;
	readonly maxEvents: number;
	/**
	 * The floor the **age** bound may never trim below.
	 *
	 * `windowMs` is a duration in *data* time, and data time is not wall time. A replay at
	 * `speed: 0` advances its clock as fast as the algorithms allow, which on a real backtest
	 * is thousands of times real time — so two polls two seconds apart
	 * land more than five simulated *hours* apart. An hour-long window then contains exactly
	 * one sample, `byAge` drops everything else, and the live chart is permanently a single
	 * point that no follow window can rescue. Not hypothetical: that is what any
	 * `speed: 0` replay does out of the box.
	 *
	 * So the age bound keeps at least this many events, however old they look. `maxEvents`
	 * remains the memory guarantee and still binds first on a busy real-time site; this only
	 * stops the *time* bound from emptying a dataset whose clock is running fast.
	 */
	readonly minEvents: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = { windowMs: 60 * 60_000, maxEvents: 200_000, minEvents: 5_000 };

export interface TrimResult {
	readonly eventsDropped: number;
	/**
	 * How many of each kind went, so a caller keeping a running tally can stay exact.
	 *
	 * A tally that only ever counts upward is the cheaper thing to write and the wrong thing
	 * to show: a kind that has fallen entirely out of the window would stay in the timeline's
	 * facet list forever, offering a filter that selects nothing.
	 */
	readonly droppedByKind: ReadonlyMap<EventKind, number>;
	readonly cutoff: number;
	/** The new oldest instant, or NaN when nothing is left. */
	readonly tMin: number;
	/**
	 * The new newest instant, or NaN when nothing is left.
	 *
	 * Reported for the same reason `tMin` is, and it is the more dangerous of the two to get
	 * wrong. The caller's running maximum only ever moves *up*, so a `tMax` left pointing at a
	 * deleted sample keeps the cutoff ahead of everything that arrives afterwards: every later
	 * batch is deleted the moment it lands, and the dataset never recovers on its own.
	 */
	readonly tMax: number;
}

const NOTHING: TrimResult = {
	eventsDropped: 0,
	droppedByKind: new Map(),
	cutoff: -Infinity,
	tMin: NaN,
	tMax: NaN,
};

/**
 * Drop what has aged out of an unbounded dataset.
 *
 * **`newest` is the dataset's own `tMax`, never the wall clock.** Under a replay `tMax` is
 * 2013 simulation time, and a wall-clock cutoff would put every sample thirteen years past
 * its expiry and delete the entire dataset on the first batch. This is the single most
 * likely bug in this file, so it is the first thing the signature says.
 *
 * Hysteresis on both bounds, so steady state trims in chunks rather than one element per
 * batch — a `copyWithin` per sample would cost more than the samples do.
 */
export function trimDataset(
	events: NormalisedEvent[],
	columns: ColumnStore,
	newest: number,
	policy: RetentionPolicy,
): TrimResult {
	if (events.length === 0 || !Number.isFinite(newest)) return NOTHING;

	const overCount = events.length > policy.maxEvents * 1.05;
	const cutoff = newest - policy.windowMs;
	const overAge = events[0]!.t < cutoff - 60_000;
	if (!overCount && !overAge) return NOTHING;

	// Whichever bound is tighter decides where the survivors begin — but the age bound is
	// floored at `minEvents` first, because a duration measured in data time says nothing
	// about how many samples it contains when the clock is running thousands of times fast.
	const byAge = Math.min(lowerBound(events, cutoff), Math.max(0, events.length - policy.minEvents));
	const byCount = Math.max(0, events.length - policy.maxEvents);
	const drop = Math.max(byAge, byCount);
	if (drop <= 0) return NOTHING;

	// Counted before the splice, while the departing events are still addressable. O(drop),
	// which is amortised O(1) per event over the dataset's life.
	const droppedByKind = new Map<EventKind, number>();
	for (let i = 0; i < drop; i++) {
		const kind = events[i]!.kind;
		droppedByKind.set(kind, (droppedByKind.get(kind) ?? 0) + 1);
	}

	events.splice(0, drop);
	const survivorsFrom = events[0]?.t ?? cutoff;
	for (const column of columns.values()) trimBefore(column, survivorsFrom);
	// A column the trim emptied is pure resident cost: `trimBefore` lowers `n` but keeps the
	// buffers at their high-water capacity, and nothing else ever deleted one. Evicting here is
	// what ties a long-lived live dataset's column count to what is actually in the window,
	// rather than to every path the source has ever named.
	columns.evictEmpty();

	// Both ends read off the survivors, and both rely on the ascending order `lowerBound`
	// above already requires of this array.
	return { eventsDropped: drop, droppedByKind, cutoff, tMin: events[0]?.t ?? NaN, tMax: events.at(-1)?.t ?? NaN };
}
