import { describe, expect, it } from 'vitest';

import { parseCsvText } from '../src/sources/file/csv-source.js';
import { detectShape, looksLikeControlLog, looksLikeJsonReplay } from '../src/sources/file/csv-schema.js';
import { actorKey } from '../src/core/ingest.js';
import { readFixture } from './helpers/fixtures.js';

const READINGS = 'auto_toggle/expected/device_data.csv';
const DECISIONS = 'auto_toggle/expected/algorithm_decisions.csv';
const REPLAY_NAIVE = 'auto_toggle/replay.naive.csv';
const REPLAY_OFFSET = 'auto_toggle/replay.offset.csv';

const codes = (result: ReturnType<typeof parseCsvText>) => result.warnings.map((w) => w.code);

describe('detectShape', () => {
	it('recognises the three EMS shapes', () => {
		expect(detectShape(['timestamp', 'device_name', 'data_json'])?.id).toBe('readings');
		expect(detectShape(['timestamp', 'algorithm', 'device', 'command'])?.id).toBe('decisions');
		expect(detectShape(['timestamp', 'device_name', 'topic', 'payload'])?.id).toBe('replay');
	});

	it('recognises a replay with no topic column — the EMS reads it with row.get()', () => {
		expect(detectShape(['timestamp', 'device_name', 'payload'])?.id).toBe('replay');
	});

	it('never confuses a replay with a readings file', () => {
		// A replay has no data_json and a readings file has no payload, so the set-based sniff
		// separates them with no ordering rule to remember.
		expect(detectShape(['timestamp', 'device_name', 'data_json', 'topic'])?.id).toBe('readings');
	});

	it('matches by set, so an appended column still loads', () => {
		// A MINOR format bump appends; the viewer must not break on one.
		expect(detectShape(['timestamp', 'device_name', 'data_json', 'quality'])?.id).toBe('readings');
	});

	it('tolerates a BOM on the first column name', () => {
		expect(detectShape(['\uFEFFtimestamp', 'device_name', 'data_json'])?.id).toBe('readings');
	});

	it('returns null for anything else', () => {
		expect(detectShape(['a', 'b'])).toBeNull();
		expect(detectShape([])).toBeNull();
	});
});

describe('looksLikeControlLog', () => {
	it('recognises the pseudo connector debug log', () => {
		expect(looksLikeControlLog('2024-01-15T10:00:00,shelly_plug,off')).toBe(true);
	});

	it('does not mistake a real CSV header for one', () => {
		expect(looksLikeControlLog('timestamp,device_name,data_json')).toBe(false);
	});
});

describe('looksLikeJsonReplay', () => {
	it('recognises the pseudo connector’s other input format', () => {
		expect(looksLikeJsonReplay('[{"timestamp":"2024-01-15T10:00:00","device_name":"d"}]')).toBe(true);
		expect(looksLikeJsonReplay('\n  [')).toBe(true);
	});

	it('does not mistake a CSV or a config for one', () => {
		expect(looksLikeJsonReplay('timestamp,device_name,payload')).toBe(false);
		expect(looksLikeJsonReplay('{"devices":[]}')).toBe(false);
	});
});

describe('parseCsvText — the replay input, naive stamps', () => {
	const result = parseCsvText(readFixture(REPLAY_NAIVE));

	it('identifies the shape and reads every logical row', () => {
		expect(result.shape?.id).toBe('replay');
		// 12 timesteps × 3 devices. The file has far more physical lines: a P1 telegram carries
		// raw CRLF inside its quoted field.
		expect(result.events).toHaveLength(36);
		expect(result.summary.skipped).toBe(0);
	});

	it('marks them as inputs, not readings', () => {
		// The distinction the feature exists for: this is what was published, not what was
		// stored, and the two must never share an actor key.
		expect(new Set(result.events.map((event) => event.kind))).toEqual(new Set(['input']));
	});

	it('carries the topic as the event target', () => {
		const p1 = result.events.find((event) => event.source === 'p1_meter');
		expect(p1?.target).toBe('p1/data');
	});

	it('does not strip the payload — a P1 telegram keeps its terminating CRLF', () => {
		// pseudo.py deliberately does not trim it either: trimming corrupts anything
		// whitespace-delimited, and the telegram stops parsing on the EMS side too.
		const p1 = result.events.find((event) => event.source === 'p1_meter');
		expect(p1?.raw).toContain('\r\n');
		expect(p1?.raw.endsWith('\r\n')).toBe(true);
	});

	it('reports the naive stamps', () => {
		expect(codes(result)).toContain('NAIVE_TIMESTAMPS');
		expect(result.events.every((event) => event.naive)).toBe(true);
	});

	it('qualifies each series by topic, so one device’s topics do not collide', () => {
		const paths = result.fields.get(actorKey('input', 'shelly_plug'))!;
		const power = paths.get('shellies/plug-s/relay/0/power');
		const relay = paths.get('shellies/plug-s/relay/0');
		expect(power?.numeric).toBeGreaterThan(0);
		// Without the prefix these two share a path, and the majority vote calls the mixture
		// chartable — a series interleaving 118.4 with the word `off`.
		expect(relay?.numeric).toBe(0);
	});

	it('keeps a P1 telegram off the charts without calling it broken JSON', () => {
		const paths = result.fields.get(actorKey('input', 'p1_meter'))!;
		expect(paths.get('p1/data')?.numeric).toBe(0);
		// A telegram does not start with { or [, so it is not a malformed payload — it is a
		// timeline row, and warning about it would be noise on every replay ever loaded.
		expect(codes(result)).not.toContain('BAD_JSON');
	});

	it('flattens a JSON payload underneath its topic', () => {
		const paths = result.fields.get(actorKey('input', 'pseudo_sensor'))!;
		expect([...paths.keys()].some((path) => path.endsWith('.value'))).toBe(true);
	});
});

describe('parseCsvText — the replay input, offset-aware stamps', () => {
	const result = parseCsvText(readFixture(REPLAY_OFFSET));

	it('reads every row and keeps every offset', () => {
		expect(result.events).toHaveLength(18);
		expect(result.events.every((event) => !event.naive)).toBe(true);
		expect(codes(result)).not.toContain('NAIVE_TIMESTAMPS');
	});

	it('is strictly ascending across the DST discontinuity', () => {
		for (let i = 1; i < result.events.length; i++) {
			expect(result.events[i]!.t).toBeGreaterThanOrEqual(result.events[i - 1]!.t);
		}
	});

	it('reads the spring-forward as the real elapsed time, not the local one', () => {
		// 01:30+01:00 → 03:00+02:00 is 90 minutes on a wall clock and 30 real ones.
		const at = (iso: string) => Date.parse(iso);
		expect(at('2024-03-31T03:00:00+02:00') - at('2024-03-31T01:30:00+01:00')).toBe(1_800_000);
		const span = result.events[result.events.length - 1]!.t - result.events[0]!.t;
		expect(span).toBeGreaterThan(0);
	});
});

describe('parseCsvText — a JSON replay is declined by name', () => {
	const result = parseCsvText('[{"timestamp":"2024-01-15T10:00:00","device_name":"d","payload":"1"}]');

	it('says what it is instead of reporting unrecognised columns', () => {
		expect(result.shape).toBeNull();
		expect(result.warnings.map((warning) => warning.detail)).toEqual(['jsonReplay']);
	});
});

describe('parseCsvText — the golden readings fixture', () => {
	const result = parseCsvText(readFixture(READINGS));

	it('identifies the shape', () => {
		expect(result.shape?.id).toBe('readings');
	});

	it('reads every row', () => {
		expect(result.events).toHaveLength(54);
		expect(result.summary.skipped).toBe(0);
	});

	it('survives CRLF terminators and quoted fields containing raw CRLFs', () => {
		// P1 telegrams are CRLF-delimited inside a single quoted CSV field, so a logical
		// row spans many physical lines. Splitting on newlines would shred this file.
		const raw = readFixture(READINGS);
		expect(raw).toContain('\r\n');
		const p1 = result.events.filter((e) => e.source === 'p1_meter');
		expect(p1).toHaveLength(18);
		expect(p1[0]!.raw).toContain('model_id');
	});

	it('finds all three devices', () => {
		expect(new Set(result.events.map((e) => e.source))).toEqual(
			new Set(['p1_meter', 'shelly_plug', 'pseudo_sensor']),
		);
	});

	it('reads both timestamp shapes and flags the naive ones', () => {
		expect(result.events.filter((e) => e.naive)).toHaveLength(36);
		expect(result.events.filter((e) => !e.naive)).toHaveLength(18);
		expect(codes(result)).toContain('NAIVE_TIMESTAMPS');
	});

	it('notices that the file straddles two eras rather than charting it as one span', () => {
		// 2024-01 naive rows then 2024-03 aware rows is only ~11 weeks, so this fixture is
		// deliberately *not* a stray-era case: the warning must not cry wolf.
		expect(codes(result)).not.toContain('STRAY_ERA');
	});

	it('discovers the chartable fields per device, not globally', () => {
		expect(result.fields.has(actorKey('reading', 'p1_meter'))).toBe(true);
		expect(result.fields.has(actorKey('reading', 'shelly_plug'))).toBe(true);
		// Two devices with a path of the same name stay separate.
		expect(result.fields.get(actorKey('reading', 'shelly_plug'))!.has('power')).toBe(true);
		expect(result.fields.get(actorKey('reading', 'p1_meter'))!.has('power')).toBe(false);
	});

	it("coerces ShellyPlug's string-typed power into a numeric field", () => {
		const stats = result.fields.get(actorKey('reading', 'shelly_plug'))!.get('power')!;
		expect(stats.numeric).toBeGreaterThan(0);
	});

	it('reaches inside the double-encoded pseudo payload', () => {
		const paths = result.fields.get(actorKey('reading', 'pseudo_sensor'))!;
		expect(paths.has('parsed.value')).toBe(true);
		expect(paths.has('payload.value')).toBe(true); // the JSON-in-a-string, descended
	});

	it('captures the unit P1 volunteers, which is the only automatic axis signal', () => {
		const paths = result.fields.get(actorKey('reading', 'p1_meter'))!;
		const withUnit = [...paths.entries()].find(([, stats]) => stats.unit === 'kWh');
		expect(withUnit).toBeDefined();
	});

	it('keeps a field that disappears halfway through the run', () => {
		// P1 stops emitting its gas register after six timesteps. It is still a series.
		const paths = result.fields.get(actorKey('reading', 'p1_meter'))!;
		const gas = [...paths.keys()].filter((p) => p.includes('data.4'));
		expect(gas.length).toBeGreaterThan(0);
	});

	it('builds a preview without materialising the whole payload', () => {
		const p1 = result.events.find((e) => e.source === 'p1_meter')!;
		expect(p1.raw.length).toBeGreaterThan(200);
		expect(p1.preview.length).toBeLessThanOrEqual(121);
		expect(p1.preview.endsWith('…')).toBe(true);
	});
});

describe('parseCsvText — the golden decisions fixture', () => {
	const result = parseCsvText(readFixture(DECISIONS));

	it('identifies the shape and reads every row', () => {
		expect(result.shape?.id).toBe('decisions');
		expect(result.events).toHaveLength(18);
	});

	it('carries the target device', () => {
		expect(result.events[0]!.source).toBe('AutoToggle');
		expect(result.events[0]!.target).toBe('shelly_plug');
	});

	it('accepts a bare non-JSON command without warning about it', () => {
		// AutoToggle emits `on`/`off`. Code that assumes JSON.parse(command) breaks on the
		// project's own public example, and a warning per row would be pure noise.
		expect(result.events.map((e) => e.raw)).toContain('on');
		expect(codes(result)).not.toContain('BAD_JSON');
	});

	it('records the off -> on transition in order', () => {
		const commands = result.events.map((e) => e.raw);
		expect(commands.indexOf('off')).toBeLessThan(commands.indexOf('on'));
	});
});

describe('parseCsvText — the adversarial fixture', () => {
	const result = parseCsvText(readFixture('edge_cases/device_data.csv'));

	it('keeps every row it can place on a timeline', () => {
		// 18 rows, minus the two with an unusable timestamp and the one with no device name.
		expect(result.events.length).toBe(15);
		expect(result.summary.skipped).toBe(2);
	});

	it('reports the unusable timestamps by row number', () => {
		const bad = result.warnings.filter((w) => w.code === 'BAD_TIMESTAMP');
		expect(bad).toHaveLength(2);
		expect(bad.every((w) => typeof w.row === 'number')).toBe(true);
	});

	it('keeps a row whose payload is broken — the row still happened', () => {
		const truncated = result.events.find((e) => e.source === 'truncated_json');
		expect(truncated).toBeDefined();
		expect(truncated!.raw).toBe('{"power": 12.5');
	});

	it('warns about a payload that looks structured and is not', () => {
		const badJson = result.warnings.filter((w) => w.code === 'BAD_JSON');
		expect(badJson.length).toBeGreaterThan(0);
		expect(badJson.some((w) => w.sample?.includes('12.5'))).toBe(true);
	});

	it('repairs bare NaN rather than losing the whole payload', () => {
		const paths = result.fields.get(actorKey('reading', 'nonfinite'))!;
		expect(paths.has('power')).toBe(true);
		expect(paths.has('ok')).toBe(false); // that row has no `ok` key; sanity on the lookup
	});

	it('reads a non-ASCII device name as UTF-8', () => {
		expect(result.events.some((e) => e.source === 'Compteur électrique')).toBe(true);
	});

	it('keeps a device name containing a comma and quotes intact', () => {
		expect(result.events.some((e) => e.source === 'comma, and "quote" device')).toBe(true);
	});

	it('reports the out-of-order row without silently reordering the file', () => {
		expect(codes(result)).toContain('NON_MONOTONIC');
	});

	it('surfaces PapaParse errors for the ragged rows, which the prototype discarded', () => {
		expect(codes(result)).toContain('PAPAPARSE');
	});
});

describe('parseCsvText — degenerate files', () => {
	it('handles an empty file', () => {
		const result = parseCsvText(readFixture('edge_cases/device_data.empty.csv'));
		expect(result.events).toHaveLength(0);
		expect(result.shape).toBeNull();
	});

	it('handles a headers-only file as a valid, empty dataset', () => {
		const result = parseCsvText(readFixture('edge_cases/device_data.headers_only.csv'));
		expect(result.shape?.id).toBe('readings');
		expect(result.events).toHaveLength(0);
	});

	it('reads a file that has been through Excel and gained a BOM', () => {
		const result = parseCsvText(readFixture('edge_cases/device_data.bom.csv'));
		expect(result.shape?.id).toBe('readings');
		expect(result.events).toHaveLength(1);
		expect(result.events[0]!.source).toBe('bom_device');
	});

	it('does not silently lose rows to an unterminated quote — it loses one, visibly', () => {
		const result = parseCsvText(readFixture('edge_cases/device_data.unterminated_quote.csv'));
		// The second row is swallowed into the first field; that is CSV, not a bug here.
		// What matters is that the file still loads and the damage is one row, not silence.
		expect(result.shape?.id).toBe('readings');
		expect(result.events).toHaveLength(1);
	});

	it('refuses the control log and explains why', () => {
		const result = parseCsvText(readFixture('auto_toggle/expected/control.log'));
		expect(result.events).toHaveLength(0);
		const warning = result.warnings.find((w) => w.code === 'UNKNOWN_SHAPE');
		// Pins the identity, not a phrase. `detail` used to be a rendered English sentence,
		// so this read `toContain('debug log')` — an assertion that broke on a reword and
		// said nothing about which of UNKNOWN_SHAPE's two cases had fired.
		expect(warning?.detail).toBe('controlLog');
	});

	it('refuses a CSV that is not an EMS file', () => {
		const result = parseCsvText('a,b,c\r\n1,2,3\r\n');
		expect(result.shape).toBeNull();
		expect(codes(result)).toContain('UNKNOWN_SHAPE');
	});
});

describe('parseCsvText — the naive-zone override', () => {
	it('shifts every naive stamp when told to read them as UTC', () => {
		const local = parseCsvText(readFixture(READINGS));
		const utc = parseCsvText(readFixture(READINGS), { naiveZone: 'utc' });
		const naiveLocal = local.events.find((e) => e.naive)!;
		const naiveUtc = utc.events.find((e) => e.naive)!;
		expect(naiveUtc.t).not.toBe(naiveLocal.t);
	});

	it('leaves offset-aware stamps untouched by the override', () => {
		const local = parseCsvText(readFixture(READINGS));
		const utc = parseCsvText(readFixture(READINGS), { naiveZone: 'utc' });
		const awareLocal = local.events.filter((e) => !e.naive).map((e) => e.t);
		const awareUtc = utc.events.filter((e) => !e.naive).map((e) => e.t);
		expect(awareUtc).toEqual(awareLocal);
	});
});
