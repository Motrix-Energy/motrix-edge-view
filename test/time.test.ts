import { describe, expect, it } from 'vitest';

import {
	countInversions,
	formatDuration,
	formatElapsed,
	formatSpanAware,
	medianDelta,
	parseStamp,
} from '../src/core/time.js';

// test/setup.ts pins TZ=Europe/Brussels. Half of this file is meaningless in UTC.
const BRUSSELS_WINTER = 60; // +01:00
const BRUSSELS_SUMMER = 120; // +02:00

/** What Date.UTC would give for a local Brussels wall-clock time. */
function utc(y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0): number {
	return Date.UTC(y, mo - 1, d, h, mi, s, ms);
}

describe('parseStamp — offset-aware input', () => {
	it('honours a positive offset', () => {
		expect(parseStamp('2024-03-31T03:30:00+02:00').t).toBe(utc(2024, 3, 31, 1, 30));
	});

	it('honours a negative offset', () => {
		expect(parseStamp('2024-01-15T05:00:00-05:00').t).toBe(utc(2024, 1, 15, 10, 0));
	});

	it('accepts the compact ±HHMM form', () => {
		expect(parseStamp('2024-01-15T05:00:00-0500').t).toBe(utc(2024, 1, 15, 10, 0));
	});

	it('accepts Z', () => {
		expect(parseStamp('2024-01-15T10:00:00Z').t).toBe(utc(2024, 1, 15, 10, 0));
	});

	it('reports an offset-aware stamp as not naive', () => {
		expect(parseStamp('2024-01-15T10:00:00+01:00').naive).toBe(false);
	});

	it('is independent of the reader timezone', () => {
		// The whole reason offsets matter: this value means one instant everywhere.
		expect(parseStamp('2013-09-27T00:03:00+02:00').t).toBe(utc(2013, 9, 26, 22, 3));
	});
});

describe('parseStamp — naive input', () => {
	it('interprets a naive stamp as local by default', () => {
		// 2024-01-15 is winter in Brussels: +01:00.
		expect(parseStamp('2024-01-15T10:00:00').t).toBe(utc(2024, 1, 15, 10 - BRUSSELS_WINTER / 60, 0));
	});

	it('reports it as naive', () => {
		expect(parseStamp('2024-01-15T10:00:00').naive).toBe(true);
	});

	it('applies a summer offset for a summer date', () => {
		expect(parseStamp('2024-07-15T10:00:00').t).toBe(utc(2024, 7, 15, 10 - BRUSSELS_SUMMER / 60, 0));
	});

	it('can be told to read naive stamps as UTC instead', () => {
		expect(parseStamp('2024-01-15T10:00:00', 'utc').t).toBe(utc(2024, 1, 15, 10, 0));
	});

	it('can be told a fixed offset in minutes', () => {
		expect(parseStamp('2024-01-15T10:00:00', -300).t).toBe(utc(2024, 1, 15, 15, 0));
	});

	it('date-only input is local, NOT UTC', () => {
		// The single nastiest trap in the platform: new Date("2024-01-15") is UTC while
		// new Date("2024-01-15T00:00:00") is local. Both come out of Python identically.
		expect(parseStamp('2024-01-15').t).toBe(parseStamp('2024-01-15T00:00:00').t);
	});
});

describe('parseStamp — the fractional second', () => {
	it('keeps microseconds as a float', () => {
		const a = parseStamp('2026-04-05T13:06:39.284157', 'utc').t;
		const b = parseStamp('2026-04-05T13:06:39.285508', 'utc').t;
		expect(b - a).toBeCloseTo(1.351, 3); // sub-microsecond; see the resolution test below
	});

	it('does not collide two stamps inside one millisecond', () => {
		// The real reason the fraction is kept: four wall-clock rows at the head of an EMS
		// run share a millisecond, and truncating makes their order arbitrary.
		const a = parseStamp('2026-04-05T13:06:39.284157', 'utc').t;
		const b = parseStamp('2026-04-05T13:06:39.284999', 'utc').t;
		expect(a).not.toBe(b);
		expect(a).toBeLessThan(b);
	});

	it.each([
		['.5', 500],
		['.28', 280],
		['.284', 284],
		['.284157', 284.157],
		['.284157123', 284.157123],
	])('scales %s to %d ms, to better than a microsecond', (fraction, ms) => {
		// Tolerance 5e-4 ms = 0.5 µs, which is the honest limit: at an epoch of ~1.7e12 ms
		// a float64 ulp is 2⁻¹² ms ≈ 0.25 µs, so the *value* carries tens of nanoseconds of
		// rounding. Demanding 1e-6 here fails against the platform, not against the code.
		const base = parseStamp('2024-01-15T10:00:00', 'utc').t;
		expect(parseStamp(`2024-01-15T10:00:00${fraction}`, 'utc').t - base).toBeCloseTo(ms, 3);
	});

	it('resolves microseconds but not nanoseconds, and says so', () => {
		const base = '2024-01-15T10:00:00';
		const a = parseStamp(`${base}.000001`, 'utc').t; // 1 µs
		const b = parseStamp(`${base}.000002`, 'utc').t; // 2 µs
		expect(a).not.toBe(b); // microseconds survive

		const c = parseStamp(`${base}.000000001`, 'utc').t; // 1 ns
		expect(c).toBe(parseStamp(base, 'utc').t); // nanoseconds do not
	});

	it('accepts a comma as the decimal separator', () => {
		expect(parseStamp('2024-01-15T10:00:00,5', 'utc').t).toBe(utc(2024, 1, 15, 10, 0, 0, 500));
	});
});

describe('parseStamp — DST, which is why the suite pins a timezone', () => {
	it('a naive stamp before the spring transition uses the winter offset', () => {
		expect(parseStamp('2024-03-31T01:30:00').t).toBe(utc(2024, 3, 31, 0, 30));
	});

	it('a naive stamp after it uses the summer offset', () => {
		expect(parseStamp('2024-03-31T03:30:00').t).toBe(utc(2024, 3, 31, 1, 30));
	});

	it('the skipped hour resolves to *an* instant rather than NaN', () => {
		// 02:30 local does not exist on this date. The platform shifts it forward; what
		// matters is that it is a usable number and the ambiguity is reported elsewhere.
		const t = parseStamp('2024-03-31T02:30:00').t;
		expect(Number.isFinite(t)).toBe(true);
	});

	it('the repeated hour in autumn resolves to one of its two instants', () => {
		const t = parseStamp('2024-10-27T02:30:00').t;
		expect(Number.isFinite(t)).toBe(true);
		// Either 00:30Z (summer offset) or 01:30Z (winter offset) — both are defensible,
		// and a naive stamp genuinely cannot distinguish them.
		expect([utc(2024, 10, 27, 0, 30), utc(2024, 10, 27, 1, 30)]).toContain(t);
	});

	it('an offset-aware stamp across the same transition is never ambiguous', () => {
		expect(parseStamp('2024-10-27T02:30:00+02:00').t).toBe(utc(2024, 10, 27, 0, 30));
		expect(parseStamp('2024-10-27T02:30:00+01:00').t).toBe(utc(2024, 10, 27, 1, 30));
	});
});

describe('parseStamp — rejection', () => {
	it.each([
		'',
		'   ',
		'not-a-timestamp',
		'2024-13-01T00:00:00', // month 13
		'2024-01-32T00:00:00', // day 32
		'2024-01-15T25:00:00', // hour 25
		'15/01/2024',
		'2024-01-15T10:00:00+',
		'1705312800', // a bare epoch is not ISO, and guessing would be worse
	])('rejects %j', (value) => {
		expect(parseStamp(value).t).toBeNaN();
	});

	it('accepts a space instead of T, which hand-edited files contain', () => {
		expect(parseStamp('2024-01-15 10:00:00', 'utc').t).toBe(utc(2024, 1, 15, 10));
	});

	it('tolerates surrounding whitespace', () => {
		expect(parseStamp('  2024-01-15T10:00:00Z  ').t).toBe(utc(2024, 1, 15, 10));
	});
});

describe('parseStamp — implausible instants', () => {
	// The grammar admits 4-6 digit years and range-checks only month..second, so these parse
	// to perfectly finite instants. A dataset's tMax is a running maximum and retention
	// measures its window backwards from tMax, so one of them deletes a whole live history.
	it.each([
		'9999-12-31T23:59:59',
		'9999-12-31T23:59:59+02:00',
		'999999-12-31T23:59:59Z',
		'0001-01-01T00:00:00',
		'1899-12-31T23:59:59Z',
	])('refuses %j rather than returning a usable instant', (value) => {
		expect(parseStamp(value).t).toBeNaN();
		expect(parseStamp(value, 'utc').t).toBeNaN();
	});

	it('refuses rather than clamping, so no wrong reading is invented', () => {
		// A clamped stamp would be charted, exported and believed. NaN is the answer every
		// caller already handles: skip the row and say so.
		expect(parseStamp('9999-12-31T23:59:59', 'utc')).toEqual({ t: NaN, naive: false });
	});

	// THE regression. The bound is absolute, never "recent": a 2013 backtest is exactly what
	// this viewer is for, and a wall-clock-relative cutoff would reject all of it.
	it.each([
		'2013-09-27T00:03:00+02:00',
		'2013-09-27T00:03:00',
		'1970-06-01T12:00:00Z',
		'1985-04-12T23:20:50Z',
		'2199-12-31T23:59:59Z',
	])('keeps %j, which is old or distant but not implausible', (value) => {
		expect(Number.isNaN(parseStamp(value).t)).toBe(false);
	});

	it('keeps a 2013 replay stamp exactly where it was', () => {
		expect(parseStamp('2013-09-27T00:03:00+02:00').t).toBe(utc(2013, 9, 26, 22, 3));
	});
});

describe('formatSpanAware', () => {
	const t = parseStamp('2024-01-15T14:03:07.250').t;

	it('shows milliseconds under two minutes', () => {
		expect(formatSpanAware(t, 60_000)).toBe('14:03:07.250');
	});

	it('shows clock time under a day', () => {
		expect(formatSpanAware(t, 3_600_000)).toBe('14:03:07');
	});

	it('adds the date over a multi-day span — the prototype never did', () => {
		expect(formatSpanAware(t, 10 * 86_400_000)).toBe('01-15 14:03:07');
	});

	it('adds the year over a multi-year span, which the EMS really produces', () => {
		// A single device_data.csv can hold 2013 replay rows and 2026 wall-clock rows.
		expect(formatSpanAware(t, 5 * 365 * 86_400_000)).toBe('2024-01-15 14:03:07');
	});
});

describe('formatDuration and formatElapsed', () => {
	it('formats a multi-day span', () => {
		expect(formatDuration(10 * 86_400_000 + 23 * 3_600_000 + 30 * 60_000)).toBe('10d 23h 30m');
	});

	it('degrades through hours, minutes and seconds', () => {
		expect(formatDuration(3 * 3_600_000 + 4 * 60_000)).toBe('3h 4m');
		expect(formatDuration(4 * 60_000 + 5000)).toBe('4m 5s');
		expect(formatDuration(5000)).toBe('5s');
	});

	it('refuses to invent a value for a nonsense span', () => {
		expect(formatDuration(NaN)).toBe('—');
	});

	it('formats elapsed time for the t₀-normalised axis', () => {
		expect(formatElapsed(3 * 86_400_000 + 4 * 3_600_000 + 12 * 60_000)).toBe('3d 04:12:00');
		expect(formatElapsed(90_000)).toBe('00:01:30');
		expect(formatElapsed(-90_000)).toBe('-00:01:30');
	});
});

describe('medianDelta', () => {
	it('is the median, so one outage does not widen the gap threshold', () => {
		// Mean would be ~2000; median stays at the real cadence.
		expect(medianDelta([0, 1000, 2000, 3000, 12_000])).toBe(1000);
	});

	it('returns 0 for fewer than two samples', () => {
		expect(medianDelta([])).toBe(0);
		expect(medianDelta([42])).toBe(0);
	});

	it('respects an explicit count, so a partially filled buffer works', () => {
		expect(medianDelta([0, 1000, 2000, 999_999], 3)).toBe(1000);
	});
});

describe('countInversions', () => {
	it('counts backward steps without reordering anything', () => {
		expect(countInversions([1, 2, 3])).toBe(0);
		expect(countInversions([1, 3, 2, 4])).toBe(1);
		expect(countInversions([3, 2, 1])).toBe(2);
	});

	it('treats equal stamps as ordered — an EMS timestep writes many rows at one instant', () => {
		expect(countInversions([1, 1, 1])).toBe(0);
	});
});
