/**
 * The numeric-string rule, stated once.
 *
 * This regex is a **deliberate second implementation** of the one in the EMS's
 * `storage/influxdb.py`, and `docs/storage-format.md` publishes it normatively for exactly
 * that reason. Two implementations of one rule is acceptable; two that drift silently is
 * not.
 *
 * It is far stricter than `Number()`, which is the whole point:
 *
 *   Number("")          === 0          -> a missing value becomes a zero reading
 *   Number("0x10")      === 16         -> a device id becomes a number
 *   Number("Infinity")  === Infinity   -> passes a naive !isNaN() check
 *   Number(" 12 ")      === 12         -> we strip first, deliberately, so this one agrees
 *
 * A port written as `!isNaN(Number(v))` drifts from the EMS on day one.
 *
 * The integer branch is written `\d+(?:\.\d*)?` rather than `\d+\.?\d*`. Those accept the
 * **same set of strings** — with the dot absent the second form's `\d*` can only match
 * digits `\d+` could already have taken — but the second is ambiguous: N digits can be
 * split between `\d+` and `\d*` in N ways, and the anchored `$` makes the engine try every
 * split before failing. A run of digits ending in one non-numeric character therefore cost
 * O(N²), on the main thread, where the CSV parser deliberately runs. Naming one owner for
 * each digit makes the same failure linear.
 *
 * The accepted language is unchanged, so this stays in step with `storage/influxdb.py`
 * with no cross-repository coordination: "12", "12.", "12.34", ".5", "1e9" all still parse,
 * and everything that was rejected is still rejected.
 */
const NUMERIC = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * The REST API encodes non-finite floats as these strings rather than emitting bare JSON
 * tokens. They are numeric in kind — the field is a number series — but have no value, so
 * they become NaN and render as a break in the line rather than as a zero.
 */
const NON_FINITE = new Map<string, number>([
	['nan', NaN],
	['inf', Infinity],
	['-inf', -Infinity],
	['infinity', Infinity],
	['-infinity', -Infinity],
]);

/**
 * Coerce a flattened leaf to a chart value.
 *
 * Returns `undefined` when the value is not numeric in kind at all, and `NaN` when it is
 * numeric in kind but has no finite value. A caller must distinguish the two: the first
 * means "this field is not a series", the second means "this sample is a gap".
 */
export function coerceNumeric(value: unknown): number | undefined {
	// Before the number check: `typeof true === 'boolean'` here, but a relay's on/off state
	// must not silently become a 0/1 series. The user can opt a boolean field in explicitly.
	if (typeof value === 'boolean') return undefined;

	if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;

	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (trimmed === '') return undefined;
		const nonFinite = NON_FINITE.get(trimmed.toLowerCase());
		if (nonFinite !== undefined) return NaN;
		// ShellyPlug stores {"power": "118.4"}, which is useless as a string.
		if (NUMERIC.test(trimmed)) return Number(trimmed);
		return undefined;
	}

	return undefined;
}

/** Per-path tally, accumulated in the single ingest pass. */
export interface FieldStats {
	/** Rows in which the path appeared at all. */
	observed: number;
	/** Of those, how many were numeric in kind. */
	numeric: number;
	/** A sibling `unit` value, if the payload volunteered one. First one wins. */
	unit?: string;
}

/**
 * Whether a path is worth offering as a chartable series.
 *
 * A majority vote over the rows in which the path *appeared*, not over all rows — so a
 * field present in three rows out of fifty thousand, all numeric, still qualifies. That is
 * what makes "a field appears and disappears across time" work, which the EMS's own P1
 * device does on every telegram that drops a register.
 */
export function isChartable(stats: FieldStats): boolean {
	return stats.numeric > 0 && stats.numeric / stats.observed >= 0.5;
}
