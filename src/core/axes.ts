/**
 * Assign series to y-scales.
 *
 * The prototype put every trace on one shared y-axis, so charting a temperature (~20) beside
 * a power (~6000) made the temperature a flat line at the bottom — the single most visible
 * thing wrong with it.
 *
 * A schema-less payload gives almost nothing to work with, so there are exactly two signals:
 *
 *  1. a **unit**, when the device volunteers one. P1 emits `{"value": 123.4, "unit": "kWh"}`,
 *     and matching units are conclusive — same scale, different units, different scale.
 *  2. **magnitude**, otherwise. Series whose ranges overlap within an order of magnitude
 *     share a scale.
 *
 * Capped at three scales, because a chart with more axes than series is not a chart.
 */
export interface SeriesRange {
	readonly key: string;
	readonly unit: string | null;
	readonly min: number;
	readonly max: number;
}

/** Scale ids uPlot will use: 'y', 'y2', 'y3'. */
export type ScaleId = 'y' | 'y2' | 'y3';

const SCALES: readonly ScaleId[] = ['y', 'y2', 'y3'];

export function assignScales(ranges: readonly SeriesRange[]): Map<string, ScaleId> {
	const assignment = new Map<string, ScaleId>();
	if (ranges.length === 0) return assignment;

	interface Group {
		readonly unit: string | null;
		magnitude: number;
		readonly keys: string[];
	}
	const groups: Group[] = [];

	for (const range of ranges) {
		const magnitude = magnitudeOf(range);
		const existing = groups.find((group) =>
			range.unit !== null || group.unit !== null
				? group.unit === range.unit
				: Math.abs(group.magnitude - magnitude) < 1,
		);
		if (existing === undefined) {
			groups.push({ unit: range.unit, magnitude, keys: [range.key] });
		} else {
			existing.keys.push(range.key);
			// Running mean, so one outlier does not drag the group's identity.
			existing.magnitude = (existing.magnitude * (existing.keys.length - 1) + magnitude) / existing.keys.length;
		}
	}

	// Beyond three, fold the smallest groups into their nearest neighbour by magnitude
	// rather than silently dropping them off the chart.
	while (groups.length > SCALES.length) {
		groups.sort((a, b) => a.keys.length - b.keys.length);
		const orphan = groups.shift()!;
		let nearest = groups[0]!;
		for (const group of groups) {
			if (Math.abs(group.magnitude - orphan.magnitude) < Math.abs(nearest.magnitude - orphan.magnitude)) {
				nearest = group;
			}
		}
		nearest.keys.push(...orphan.keys);
	}

	// Largest group first, so the busiest series own the primary axis.
	groups.sort((a, b) => b.keys.length - a.keys.length);
	groups.forEach((group, index) => {
		for (const key of group.keys) assignment.set(key, SCALES[index]!);
	});
	return assignment;
}

function magnitudeOf(range: SeriesRange): number {
	const scale = Math.max(Math.abs(range.min), Math.abs(range.max));
	if (!Number.isFinite(scale) || scale === 0) return 0;
	return Math.log10(scale);
}
