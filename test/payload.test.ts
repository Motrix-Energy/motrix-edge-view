import { describe, expect, it } from 'vitest';

import { flatten, flattenToRecord } from '../src/core/flatten.js';
import { looksLikeJsonObject, parseJsonLenient } from '../src/core/json.js';
import { coerceNumeric, isChartable } from '../src/core/numeric.js';

describe('parseJsonLenient', () => {
	it('parses ordinary JSON without repairing anything', () => {
		expect(parseJsonLenient('{"power": 12.5}')).toEqual({ value: { power: 12.5 }, ok: true, repaired: false });
	});

	it('repairs bare NaN, Infinity and -Infinity', () => {
		const result = parseJsonLenient('{"a": NaN, "b": Infinity, "c": -Infinity, "d": 1.5}');
		expect(result.ok).toBe(true);
		expect(result.repaired).toBe(true);
		// The same encoding the EMS REST API uses, so both surfaces agree.
		expect(result.value).toEqual({ a: 'nan', b: 'inf', c: '-inf', d: 1.5 });
	});

	it('leaves the literal text NaN alone when it is inside a string', () => {
		// The reason this is a scanner and not a regex. A device really can report this.
		const result = parseJsonLenient('{"status": "NaN sensor fault", "n": NaN}');
		expect(result.value).toEqual({ status: 'NaN sensor fault', n: 'nan' });
	});

	it('leaves an escaped quote inside a string from confusing the scan', () => {
		const result = parseJsonLenient('{"note": "he said \\"Infinity\\" once", "n": Infinity}');
		expect(result.value).toEqual({ note: 'he said "Infinity" once', n: 'inf' });
	});

	it('returns the raw string when the payload is not JSON at all', () => {
		expect(parseJsonLenient('not json at all')).toEqual({
			value: 'not json at all',
			ok: false,
			repaired: false,
		});
	});

	it('returns the raw string when the payload is truncated', () => {
		const result = parseJsonLenient('{"power": 12.5');
		expect(result.ok).toBe(false);
		expect(result.value).toBe('{"power": 12.5');
	});

	it('does not claim to have repaired something it could not fix', () => {
		// Contains NaN, so the repair path runs — but the result is still broken.
		const result = parseJsonLenient('{"a": NaN, ');
		expect(result.ok).toBe(false);
		expect(result.repaired).toBe(false);
	});

	it('handles the empty payload', () => {
		expect(parseJsonLenient('').ok).toBe(false);
	});

	it('parses null, which the EMS writes for a device that parsed nothing', () => {
		expect(parseJsonLenient('null')).toEqual({ value: null, ok: true, repaired: false });
	});
});

describe('looksLikeJsonObject', () => {
	it.each([
		['{"a":1}', true],
		['  [1,2]', true],
		['"just a string"', false],
		['42', false],
		['on', false],
		['', false],
	])('%j -> %s', (value, expected) => {
		expect(looksLikeJsonObject(value)).toBe(expected);
	});
});

describe('flatten', () => {
	it('joins object keys with a dot', () => {
		expect(flattenToRecord({ a: { b: { c: 1 } } })).toEqual({ 'a.b.c': 1 });
	});

	it('indexes arrays with a dot, matching the EMS Python — not brackets', () => {
		// docs/storage-format.md publishes this grammar; brackets are reserved for the
		// discriminator form in a stable-discriminator scheme precisely because this never emits them.
		expect(flattenToRecord({ a: [10, 20] })).toEqual({ 'a.0': 10, 'a.1': 20 });
	});

	it('honours a custom separator', () => {
		expect(flattenToRecord({ a: { b: 1 } }, { separator: '_' })).toEqual({ a_b: 1 });
	});

	it('records null rather than dropping the path', () => {
		// The EMS drops nulls on the InfluxDB path because Influx has no null field type.
		// A viewer must keep them: "reported, and empty" is not "never reported".
		expect(flattenToRecord({ parsed: null })).toEqual({ parsed: null });
	});

	it('marks an empty object and an empty array rather than vanishing', () => {
		expect(flattenToRecord({ a: {}, b: [] })).toEqual({ a: '{}', b: '[]' });
	});

	it('stringifies past the depth limit instead of recursing forever', () => {
		const deep = { a: { b: { c: { d: { e: { f: { g: { h: { i: { j: { k: { l: 42 } } } } } } } } } } } };
		const flat = flattenToRecord(deep);
		const keys = Object.keys(flat);
		expect(keys).toHaveLength(1);
		expect(keys[0]!.split('.').length).toBeLessThanOrEqual(10);
		expect(typeof Object.values(flat)[0]).toBe('string');
	});

	it('repairs a double-encoded payload the same way it repairs the outer one', () => {
		// `Ingestor.discover` parses the outer payload with parseJsonLenient, so a run written
		// with allow_nan=True has its bare NaN repaired at depth 0. The inner parse used the
		// strict JSON.parse, so the pseudo device's `payload` — a JSON *string*, the whole
		// reason this branch exists — stayed one opaque leaf instead.
		const data = { payload: '{"value": NaN, "humidity": 48.0}' };
		expect(flattenToRecord(data)).toEqual({ 'payload.value': 'nan', 'payload.humidity': 48.0 });
	});

	it('descends into a double-encoded payload', () => {
		// The pseudo device: `payload` is a JSON *string*, `parsed` is the decoded object.
		// Charting `payload` must not come up empty.
		const data = {
			topic: 'sensors/zone/temperature',
			payload: '{"value": 15.2, "humidity": 48.0}',
			parsed: { value: 15.2, humidity: 48.0 },
		};
		expect(flattenToRecord(data)).toEqual({
			topic: 'sensors/zone/temperature',
			'payload.value': 15.2,
			'payload.humidity': 48.0,
			'parsed.value': 15.2,
			'parsed.humidity': 48.0,
		});
	});

	it('leaves a JSON-looking string alone when descending is off', () => {
		const data = { payload: '{"value": 15.2}' };
		expect(flattenToRecord(data, { descendEncoded: false })).toEqual({ payload: '{"value": 15.2}' });
	});

	it('records a string that only looks like JSON as the string it is', () => {
		expect(flattenToRecord({ note: '{not actually json' })).toEqual({ note: '{not actually json' });
	});

	it('attaches a sibling unit to its value rather than emitting a second field', () => {
		// P1 emits {"value": 123.4, "unit": "kWh"} — one measurement, not two fields.
		const units: Record<string, string | undefined> = {};
		const values: Record<string, unknown> = {};
		flatten({ reading: { value: 123.4, unit: 'kWh' } }, (path, value, unit) => {
			values[path] = value;
			units[path] = unit;
		});
		expect(values['reading.value']).toBe(123.4);
		expect(units['reading.value']).toBe('kWh');
	});

	it('flattens a real P1 payload into positional OBIS paths', () => {
		const p1 = {
			model_id: 'ISK',
			data: [{ obis: { medium: 1, channel: 0, class: 1, instance: 8, attribute: 1 }, data: [{ value: 480.0, unit: 'kWh' }] }],
			crc16: 47822,
		};
		const flat = flattenToRecord(p1);
		expect(flat['data.0.obis.medium']).toBe(1);
		expect(flat['data.0.data.0.value']).toBe(480.0);
		expect(flat['crc16']).toBe(47822);
	});

	it('flattens a ShellyPlug payload, string-typed numbers intact', () => {
		expect(flattenToRecord({ power: '118.4', status: true })).toEqual({ power: '118.4', status: true });
	});
});

describe('coerceNumeric', () => {
	it('accepts finite numbers', () => {
		expect(coerceNumeric(12.5)).toBe(12.5);
		expect(coerceNumeric(0)).toBe(0);
		expect(coerceNumeric(-3)).toBe(-3);
	});

	it('accepts numeric strings — ShellyPlug stores its power as one', () => {
		expect(coerceNumeric('118.4')).toBe(118.4);
		expect(coerceNumeric('  -3  ')).toBe(-3);
		expect(coerceNumeric('1.5e3')).toBe(1500);
		expect(coerceNumeric('.5')).toBe(0.5);
		expect(coerceNumeric('+2')).toBe(2);
	});

	it('refuses the strings Number() would silently accept', () => {
		expect(coerceNumeric('')).toBeUndefined();
		expect(coerceNumeric('   ')).toBeUndefined();
		expect(coerceNumeric('0x10')).toBeUndefined();
		expect(coerceNumeric('1_0')).toBeUndefined();
		expect(coerceNumeric('12px')).toBeUndefined();
		expect(coerceNumeric('on')).toBeUndefined();
	});

	it('treats booleans as not numeric, so a relay state is not a 0/1 line', () => {
		expect(coerceNumeric(true)).toBeUndefined();
		expect(coerceNumeric(false)).toBeUndefined();
	});

	// The pattern was de-ambiguated to stop a long digit run costing O(N^2) to reject.
	// The accepted language must not move with it: this side is a second implementation of
	// the EMS's storage/influxdb.py rule, and a narrower TypeScript side is exactly the
	// silent cross-language drift the two implementations exist to prevent.
	it('accepts a trailing dot, as the EMS rule does', () => {
		expect(coerceNumeric('12.')).toBe(12);
		expect(coerceNumeric('-0.')).toBe(-0);
		expect(coerceNumeric('12.e3')).toBe(12000);
	});

	it('rejects a long digit run with a trailing non-digit without pathological cost', () => {
		const hostile = `${'1'.repeat(200_000)}!`;
		const started = performance.now();
		expect(coerceNumeric(hostile)).toBeUndefined();
		// Quadratic backtracking on this input ran to ~1e10 steps. Linear is milliseconds;
		// the bound is loose enough not to flake on a loaded CI box.
		expect(performance.now() - started).toBeLessThan(1000);
	});

	it('treats the API non-finite encodings as numeric-but-gapped', () => {
		// "numeric in kind, no value" — the field is a series, this sample is a break.
		expect(coerceNumeric('nan')).toBeNaN();
		expect(coerceNumeric('inf')).toBeNaN();
		expect(coerceNumeric('-inf')).toBeNaN();
		expect(coerceNumeric('Infinity')).toBeNaN();
	});

	it('treats a real non-finite number the same way', () => {
		expect(coerceNumeric(NaN)).toBeNaN();
		expect(coerceNumeric(Infinity)).toBeNaN();
	});

	it('rejects everything else', () => {
		expect(coerceNumeric(null)).toBeUndefined();
		expect(coerceNumeric(undefined)).toBeUndefined();
		expect(coerceNumeric({})).toBeUndefined();
		expect(coerceNumeric([1])).toBeUndefined();
	});
});

describe('isChartable', () => {
	it('needs a majority of the rows in which the path appeared', () => {
		expect(isChartable({ observed: 10, numeric: 6 })).toBe(true);
		expect(isChartable({ observed: 10, numeric: 5 })).toBe(true);
		expect(isChartable({ observed: 10, numeric: 4 })).toBe(false);
	});

	it('accepts a field that appears rarely but is always numeric', () => {
		// P1 drops its gas register halfway through a run; it is still a series.
		expect(isChartable({ observed: 3, numeric: 3 })).toBe(true);
	});

	it('rejects a field that is never numeric', () => {
		expect(isChartable({ observed: 5000, numeric: 0 })).toBe(false);
	});
});
