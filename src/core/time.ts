import type { NaiveZone } from './types.js';

/**
 * The one module allowed to touch `Date` directly. ESLint points everything else here.
 *
 * `Date.parse` and `new Date(string)` are how this app would quietly get every timestamp
 * wrong, and the EMS's output hits all three failure modes:
 *
 *  1. `new Date("2024-01-15")` is parsed as **UTC** while `new Date("2024-01-15T00:00:00")`
 *     is parsed as **local**. Both round-trip from `datetime.fromisoformat` in Python, and
 *     they land an hour or more apart here.
 *  2. The EMS writes microseconds — `2026-04-05T13:06:39.284157`. The ES grammar allows
 *     exactly three fraction digits, so six falls to the engine's implementation-defined
 *     fallback parser. V8 truncates; that is not a contract.
 *  3. Date-string parsing is the hottest single operation in a 100k-row load. A regex plus
 *     `Date.UTC` is several times faster.
 *
 * See `docs/storage-format.md` in the EMS repository for why the column holds two
 * different time domains in the first place.
 */

// Fraction is captured as digits and scaled, so 1..9 of them all work.
const ISO =
	/^(\d{4,6})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?\s*(Z|z|[+-]\d{2}:?\d{2})?$/;

export interface ParsedStamp {
	/** Epoch milliseconds as a float, or NaN when the value could not be read. */
	readonly t: number;
	/** True when the string carried no offset, so `naiveZone` was applied. */
	readonly naive: boolean;
}

export const INVALID: ParsedStamp = { t: NaN, naive: false };

/**
 * The widest instant this app will accept as a real reading: 1970-01-01 to 2200-01-01, UTC.
 *
 * The grammar above admits 4-6 digit years and range-checks only month..second, so
 * `"9999-12-31T23:59:59"` yields a perfectly finite instant a quarter of a million years out.
 * Nothing downstream is suspicious of one: a dataset's `tMax` is a running maximum, and
 * retention measures its window *backwards* from `tMax` — so a single such stamp puts the
 * cutoff past every real sample and deletes the whole collected history.
 *
 * **Absolute and fixed, never relative to the wall clock.** A "not too old" cutoff is the bug
 * this module is arranged around: under a replay the data is 2013 and everything would be too
 * old. So the bound is chosen so no legitimate reading of any age can approach it — the Unix
 * epoch predates any EMS that could have written one, and no deployment reaches the year 2200.
 * A 2013 backtest, a decades-old archive and a live feed all sit far inside it; only a value
 * that is not a reading at all falls out.
 */
export const MIN_INSTANT = Date.UTC(1970, 0, 1);
export const MAX_INSTANT = Date.UTC(2200, 0, 1);

/** False for NaN, for a non-finite value, and for anything outside the bound above. */
export function isPlausibleInstant(t: number): boolean {
	return t >= MIN_INSTANT && t <= MAX_INSTANT;
}

/**
 * Every exit from `parseStamp` goes through here, so no path can skip the bound.
 *
 * An implausible instant is reported as **unreadable**, not clamped to the boundary: a
 * clamped stamp is a silently wrong reading, and callers already have a correct answer for a
 * timestamp they cannot read — skip the row and say so.
 */
function bounded(t: number, naive: boolean): ParsedStamp {
	return isPlausibleInstant(t) ? { t, naive } : INVALID;
}

/**
 * Parse an ISO-8601 timestamp as the EMS writes it.
 *
 * The sub-millisecond part is **kept**, as the fraction of a float. That is not
 * pedantry: the wall-clock rows at the head of a real run share a millisecond
 * (`13:06:39.284157` / `.285508`), and truncating collides them so that the order of the
 * devices within that instant becomes whatever the sort does.
 *
 * Precision, stated honestly rather than assumed: an epoch around 1.7e12 ms sits at a
 * float64 ulp of 2⁻¹² ms, so the representation resolves to roughly **0.25 µs**. Two
 * stamps a microsecond apart are therefore distinct, and the value itself carries a
 * rounding error of a few tens of nanoseconds. Nanosecond-precision input — which the EMS
 * does not produce, but `datetime.isoformat` permits — is accepted and rounded, not
 * rejected. `time.test.ts` pins both facts.
 */
export function parseStamp(value: string, naiveZone: NaiveZone = 'local'): ParsedStamp {
	// The annotation is erased at runtime and the live path hands this whatever the EMS put
	// in `simulation_time` / `clock.step_time` — declared `string | null`, checked by nothing.
	// A number there used to throw on `.trim()`, and that throw escaped normalise -> fanOut
	// -> tick with no catch anywhere: the feed stopped ingesting while the dataset chip still
	// read "streaming, 0 failures". INVALID is what every caller already handles.
	if (typeof value !== 'string') return INVALID;

	const match = ISO.exec(value.trim());
	if (match === null) return INVALID;

	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const hour = Number(match[4] ?? '0');
	const minute = Number(match[5] ?? '0');
	const second = Number(match[6] ?? '0');
	const fraction = match[7];
	const offset = match[8];

	if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 24 || minute > 59 || second > 60) {
		return INVALID;
	}

	// Digits -> nanoseconds -> float milliseconds. "284157" => 284.157
	const subMs = fraction === undefined ? 0 : Number(fraction.padEnd(9, '0').slice(0, 9)) / 1e6;

	if (offset !== undefined) {
		const minutes = offset === 'Z' || offset === 'z' ? 0 : offsetMinutes(offset);
		const utc = Date.UTC(year, month - 1, day, hour, minute, second) - minutes * 60_000;
		return bounded(utc + subMs, false);
	}

	if (naiveZone === 'utc') {
		return bounded(Date.UTC(year, month - 1, day, hour, minute, second) + subMs, true);
	}
	if (typeof naiveZone === 'number') {
		return bounded(Date.UTC(year, month - 1, day, hour, minute, second) - naiveZone * 60_000 + subMs, true);
	}

	// Local. The *constructor*, never the string parser: it is unambiguous, and it applies
	// the zone's rules for this date — including the DST discontinuities that a naive
	// stamp is genuinely ambiguous across (a repeated hour maps to one of its two
	// instants; a skipped hour shifts forward). Callers surface that; see isMonotonic().
	const local = new Date(year, month - 1, day, hour, minute, second, 0);
	if (year < 100) local.setFullYear(year); // 0..99 would otherwise mean 1900..1999
	return bounded(local.getTime() + subMs, true);
}

function offsetMinutes(offset: string): number {
	const sign = offset[0] === '-' ? -1 : 1;
	const digits = offset.slice(1).replace(':', '');
	return sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
}

// --- formatting -----------------------------------------------------------------------

const pad = (n: number, width = 2) => String(Math.floor(n)).padStart(width, '0');

/**
 * Format an instant at a precision that suits the range being looked at.
 *
 * The prototype always showed `HH:MM:SS`, which over a ten-day span made every timeline
 * row ambiguous. The visible span decides instead.
 */
export function formatSpanAware(t: number, spanMs: number): string {
	const d = new Date(t);
	const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
	if (spanMs < 2 * 60_000) return `${time}.${pad(d.getMilliseconds(), 3)}`;
	if (spanMs < 24 * 3_600_000) return time;
	if (spanMs < 365 * 24 * 3_600_000) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
}

/**
 * Format an axis tick: `formatSpanAware` minus the precision an axis cannot spend.
 *
 * The timeline wants a full stamp on every row, because a row is one event and that stamp
 * is what you grep the CSV for. An axis tick is only a position, and across a multi-day
 * span `MM-DD HH:MM:SS` is fourteen characters — wide enough that uPlot has to either
 * overlap the labels into an unreadable ribbon or drop most of them. Seconds are the first
 * thing to go once the visible span is measured in days, and a tick landing exactly on
 * midnight says more as a bare date than as `09-28 00:00`.
 *
 * Below a day this defers, so a zoomed-in axis keeps the full precision it can now use.
 */
export function formatAxisTick(t: number, spanMs: number): string {
	if (spanMs < 24 * 3_600_000) return formatSpanAware(t, spanMs);
	const d = new Date(t);
	const date = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	const midnight = d.getHours() === 0 && d.getMinutes() === 0;
	const stamp = midnight ? date : `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
	return spanMs < 365 * 24 * 3_600_000 ? stamp : `${d.getFullYear()}-${stamp}`;
}

/**
 * The next local midnight strictly after `t`.
 *
 * Here rather than in the timeline because this module is the one place allowed to touch
 * `Date` — ESLint enforces that, and it caught this on the way in. The timeline used to
 * detect a day change by formatting every row and comparing strings, which is one `Date`
 * plus three padded strings per event, per render; against this it is one comparison per
 * event and one `Date` per day actually on screen.
 *
 * `setHours(24, …)` rather than adding 86 400 000: calendar arithmetic applies the zone's
 * own rules, so a 23- or 25-hour DST day still lands on the right instant. On a
 * spring-forward day where local midnight does not exist the runtime resolves it forward,
 * which keeps the result monotone — the only property the caller needs.
 */
export function startOfNextDay(t: number): number {
	const d = new Date(t);
	d.setHours(24, 0, 0, 0);
	return d.getTime();
}

/** `YYYY-MM-DD`, for the timeline's day separators. */
export function formatDay(t: number): string {
	const d = new Date(t);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Full ISO-8601 in local time, with the offset. For tooltips and the expanded row. */
export function formatFull(t: number): string {
	const d = new Date(t);
	const offset = -d.getTimezoneOffset();
	const sign = offset < 0 ? '-' : '+';
	const abs = Math.abs(offset);
	return (
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
		`T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
		`${sign}${pad(abs / 60)}:${pad(abs % 60)}`
	);
}

/**
 * Wall-clock now, in epoch milliseconds.
 *
 * Here rather than at each call site because this module is the one place allowed to touch
 * `Date` — and because a live source needs a client clock it can substitute in tests.
 */
export function nowMs(): number {
	return Date.now();
}

/** Unit suffixes for `formatDuration`. French wants `j/h/min`, German `T/Std./Min.`. */
export interface DurationUnits {
	readonly d: string;
	readonly h: string;
	readonly m: string;
	readonly s: string;
}

const EN_UNITS: DurationUnits = { d: 'd', h: 'h', m: 'm', s: 's' };

/**
 * `10d 23h 30m` — a span, for the summary bar.
 *
 * The units are injected rather than looked up, so `core/` keeps its rule of depending on
 * nothing above it. The default keeps every existing caller and `time.test.ts` unchanged.
 *
 * Deliberately not `Intl.DurationFormat`: too new to rely on for a single-file artefact
 * whose whole point is running on whatever browser happens to be on a site laptop.
 */
export function formatDuration(ms: number, units: DurationUnits = EN_UNITS): string {
	if (!Number.isFinite(ms) || ms < 0) return '—';
	const seconds = Math.floor(ms / 1000);
	const days = Math.floor(seconds / 86_400);
	const hours = Math.floor((seconds % 86_400) / 3_600);
	const minutes = Math.floor((seconds % 3_600) / 60);
	if (days > 0) return `${days}${units.d} ${hours}${units.h} ${minutes}${units.m}`;
	if (hours > 0) return `${hours}${units.h} ${minutes}${units.m}`;
	if (minutes > 0) return `${minutes}${units.m} ${seconds % 60}${units.s}`;
	return `${seconds}${units.s}`;
}

/**
 * `3d 04:12:00` — elapsed since a dataset's t₀.
 *
 * This is the x-axis label in t₀-normalised mode, which is what makes a 2013 backtest and
 * a live feed comparable at all: they share no wall-clock range, so absolute time cannot
 * put them on one chart.
 */
export function formatElapsed(ms: number): string {
	const sign = ms < 0 ? '-' : '';
	const total = Math.abs(ms);
	const days = Math.floor(total / 86_400_000);
	const rest = total % 86_400_000;
	const time = `${pad(rest / 3_600_000)}:${pad((rest % 3_600_000) / 60_000)}:${pad((rest % 60_000) / 1000)}`;
	return days > 0 ? `${sign}${days}d ${time}` : `${sign}${time}`;
}

// --- cadence and ordering -------------------------------------------------------------

/**
 * Median gap between consecutive samples, used to decide what counts as a real gap.
 *
 * The median rather than the mean because one long outage would otherwise widen the
 * threshold enough to bridge every subsequent gap — the opposite of what it is for.
 */
export function medianDelta(times: ArrayLike<number>, count = times.length): number {
	if (count < 2) return 0;
	const deltas: number[] = [];
	for (let i = 1; i < count; i++) deltas.push(times[i]! - times[i - 1]!);
	deltas.sort((a, b) => a - b);
	const mid = deltas.length >> 1;
	return deltas.length % 2 === 1 ? deltas[mid]! : (deltas[mid - 1]! + deltas[mid]!) / 2;
}

/**
 * How many times a sequence steps backwards.
 *
 * Non-monotonic rows are *normal* in EMS output — several connector threads append under
 * one lock, so file order is write order — and they are also the visible symptom of a DST
 * fold in naive stamps. Either way the fix is the same (sort), but the count is worth
 * reporting rather than silently repairing.
 */
export function countInversions(times: ArrayLike<number>, count = times.length): number {
	let inversions = 0;
	for (let i = 1; i < count; i++) if (times[i]! < times[i - 1]!) inversions++;
	return inversions;
}
