import { describe, expect, it } from 'vitest';

import {
	CONFIG_FORMAT_MAJOR,
	MAX_TOPOLOGY_ENTRIES,
	looksLikeConfigJson,
	matchTopology,
	parseConfigVersion,
	parseTopology,
	type SeenActors,
	type TopologyDoc,
} from '../src/core/topology.js';
import { readFixture } from './helpers/fixtures.js';

function seen(partial: Partial<SeenActors> = {}): SeenActors {
	return {
		readings: partial.readings ?? new Set(),
		decisions: partial.decisions ?? new Set(),
		workers: partial.workers ?? new Set(),
	};
}

function doc(text: string): TopologyDoc {
	const parsed = parseTopology(text);
	if (parsed.doc === null) throw new Error(`refused: ${parsed.warnings.map((w) => w.detail).join(', ')}`);
	return parsed.doc;
}

describe('looksLikeConfigJson', () => {
	it('accepts an object, with or without leading whitespace', () => {
		expect(looksLikeConfigJson('{"devices":[]}')).toBe(true);
		expect(looksLikeConfigJson('\n\t  {"devices":[]}')).toBe(true);
	});

	it('rejects CSV, so a .json-named CSV still loads as CSV', () => {
		expect(looksLikeConfigJson('timestamp,device_name,data_json\r\n')).toBe(false);
	});

	it('rejects a bare array', () => {
		expect(looksLikeConfigJson('[{"name":"x"}]')).toBe(false);
	});
});

describe('parseTopology, against the EMS’s own worked example', () => {
	const text = readFixture('auto_toggle/config.json');

	it('reads every declared entry', () => {
		const entries = doc(text).entries;
		const byRole = (role: string) => entries.filter((entry) => entry.role === role).map((entry) => entry.name);
		expect(byRole('connector')).toEqual(['replay']);
		expect(byRole('device')).toEqual(['p1_meter', 'shelly_plug', 'pseudo_sensor']);
		expect(byRole('algorithm')).toEqual(['AutoToggle']);
		expect(byRole('storage')).toEqual(['csv']);
	});

	it('reports the kind, not the class, for a device', () => {
		const p1 = doc(text).entries.find((entry) => entry.name === 'p1_meter');
		expect(p1?.type).toBe('p1');
	});

	it('resolves a device’s protocol through `emulates`, exactly as the EMS does', () => {
		// config.py resolves emulates ?? protocol, and /api/devices reports the resolved value.
		// The connector's own protocol is `pseudo`; its devices must read `mqtt` in both modes,
		// or file mode and live mode describe the same device with two different words.
		const devices = doc(text).entries.filter((entry) => entry.role === 'device');
		expect(devices.map((entry) => entry.connector)).toEqual(['replay', 'replay', 'replay']);
		expect(devices.map((entry) => entry.protocol)).toEqual(['mqtt', 'mqtt', 'mqtt']);
	});

	it('reads the algorithm’s typed options and nothing else', () => {
		const algorithm = doc(text).entries.find((entry) => entry.role === 'algorithm');
		expect(algorithm?.delaySeconds).toBe(900);
		expect(algorithm?.requiredDevices).toEqual(['p1_meter', 'shelly_plug']);
	});

	it('loads without warnings', () => {
		expect(parseTopology(text).warnings).toEqual([]);
	});

	it('reads the version, and pins this viewer to the major the EMS ships', () => {
		// This is the pin. A failure here means the EMS moved its config format: read
		// `config.schema.json` and `config/version.py` there, check that the twelve named
		// paths this module reads are still where they were, then move CONFIG_FORMAT_MAJOR.
		// Same instruction-carrying role as test/fixtures.test.ts's storage-format assertion,
		// and weaker in the same way — this file is vendored, not checksummed, so nothing
		// forces the re-vendor that would bring a bump here. Nothing gates on it, which is
		// what makes that acceptable.
		expect(doc(text).version).toBe('1.0.0');
		expect(parseConfigVersion(doc(text).version)?.major).toBe(CONFIG_FORMAT_MAJOR);
		expect(doc(text).env).toBe('dev');
	});
});

describe('the privacy allowlist', () => {
	// Fake, non-routable values only: `.invalid` is reserved by RFC 2606 and this repository is
	// public. The point of the test is that none of these strings can reach a rendered object.
	const SECRETS = [
		'mqtt.example.invalid',
		'ops-service-account',
		'REDACT-ME-IF-YOU-SEE-THIS',
		'/etc/ssl/private/ca.pem',
		'secret/topic/#',
		'shellies/plug-s/relay/0/command',
		'/var/lib/ems/storage',
		'0.0.0.0',
		'41.9',
	];

	const hostile = JSON.stringify({
		version: '1.0.0',
		env: 'prod',
		logger_level: 'debug',
		runtime: { max_restarts: 5 },
		connectors: [
			{
				name: 'broker',
				protocol: 'mqtt',
				options: {
					host: 'mqtt.example.invalid',
					port: 8883,
					username: 'ops-service-account',
					password: 'REDACT-ME-IF-YOU-SEE-THIS',
					ca_certs: '/etc/ssl/private/ca.pem',
					emulates: 'mqtt',
				},
			},
		],
		devices: [
			{
				name: 'p1_meter',
				kind: 'p1',
				options: {
					connector_options: { name: 'broker' },
					listener_options: { subscription: 'secret/topic/#', pattern: 'p1/.*' },
					controller_options: { topic: 'shellies/plug-s/relay/0/command' },
				},
			},
		],
		algorithms: [
			{
				name: 'Private',
				class: 'private_mpc',
				options: { delay_seconds: 300, tank_setpoint_c: '41.9', zone_map: { a: 1 } },
			},
		],
		storage: [{ name: 'csv', class: 'csv_file', options: { output_dir: '/var/lib/ems/storage' } }],
		services: [{ name: 'api', class: 'rest_api', options: { host: '0.0.0.0', port: 8000 } }],
	});

	it('never lets a credential, endpoint, topic or path into the parsed document', () => {
		// DO NOT DELETE. The parser constructs entries from named reads with no spread and no
		// denylist, so this is the assertion that an EMS option added next year is excluded by
		// default rather than by somebody remembering to exclude it.
		const serialised = JSON.stringify(doc(hostile));
		for (const secret of SECRETS) expect(serialised).not.toContain(secret);
	});

	it('still reads the twelve allowlisted paths from the same document', () => {
		const parsed = doc(hostile);
		expect(parsed.entries.find((entry) => entry.name === 'p1_meter')?.protocol).toBe('mqtt');
		expect(parsed.entries.find((entry) => entry.name === 'Private')?.delaySeconds).toBe(300);
		expect(parsed.entries.map((entry) => entry.name)).toContain('api');
	});

	it('does not carry an untyped algorithm option through', () => {
		// `algorithms[].options` is additionalProperties:true in the EMS schema — it is where a
		// private algorithm's parameters live.
		expect(JSON.stringify(doc(hostile))).not.toContain('tank_setpoint_c');
		expect(JSON.stringify(doc(hostile))).not.toContain('zone_map');
	});

	it('leaves an unresolved ${VAR} template verbatim and never resolves it', () => {
		const text = JSON.stringify({
			connectors: [{ name: '${EMS_CONNECTOR:-replay}', protocol: 'pseudo' }],
		});
		expect(doc(text).entries[0]?.name).toBe('${EMS_CONNECTOR:-replay}');
	});
});

describe('refusals', () => {
	const refusal = (text: string) => parseTopology(text);

	it('refuses invalid JSON', () => {
		const parsed = refusal('{"devices": [');
		expect(parsed.doc).toBeNull();
		expect(parsed.warnings[0]?.detail).toBe('configInvalidJson');
	});

	it('refuses a bare array', () => {
		expect(refusal('[1,2,3]').warnings[0]?.detail).toBe('configUnknownShape');
	});

	it('refuses an empty object', () => {
		expect(refusal('{}').warnings[0]?.detail).toBe('configUnknownShape');
	});

	it('refuses a package.json', () => {
		const text = JSON.stringify({ name: 'motrix-edge-view', version: '0.1.0', dependencies: { lit: '3.3.3' } });
		expect(refusal(text).warnings[0]?.detail).toBe('configUnknownShape');
	});

	it('refuses a tsconfig.json', () => {
		const text = JSON.stringify({ compilerOptions: { strict: true }, include: ['src'] });
		expect(refusal(text).warnings[0]?.detail).toBe('configUnknownShape');
	});

	it('refuses a document past the byte bound', () => {
		const text = `{"devices":[{"name":"x","kind":"p1","$pad":"${'x'.repeat(3 * 1024 * 1024)}"}]}`;
		expect(refusal(text).warnings[0]?.detail).toBe('configTooLarge');
	});

	it('every warning carries the CONFIG_SHAPE code', () => {
		expect(refusal('{"devices": [').warnings[0]?.code).toBe('CONFIG_SHAPE');
	});
});

describe('tolerated defects', () => {
	it('loads a config declaring only devices — every section is optional in the EMS schema', () => {
		const text = JSON.stringify({ devices: [{ name: 'p1_meter', kind: 'p1' }] });
		expect(doc(text).entries).toHaveLength(1);
	});

	it('keeps the first of two entries sharing a name, as the EMS does', () => {
		const text = JSON.stringify({
			devices: [
				{ name: 'p1_meter', kind: 'p1' },
				{ name: 'p1_meter', kind: 'shelly_plug' },
			],
		});
		const parsed = parseTopology(text);
		expect(parsed.doc?.entries.map((entry) => entry.type)).toEqual(['p1']);
		expect(parsed.warnings[0]?.detail).toBe('configDuplicateName');
	});

	it('keeps a device whose connector is undeclared, with a null protocol', () => {
		const text = JSON.stringify({
			devices: [{ name: 'p1_meter', kind: 'p1', options: { connector_options: { name: 'ghost' } } }],
		});
		const parsed = parseTopology(text);
		expect(parsed.doc?.entries[0]?.connector).toBe('ghost');
		expect(parsed.doc?.entries[0]?.protocol).toBeNull();
		expect(parsed.warnings[0]?.detail).toBe('configDanglingRef');
	});

	it('reports a required_devices entry that names no declared device', () => {
		const text = JSON.stringify({
			devices: [{ name: 'p1_meter', kind: 'p1' }],
			algorithms: [{ name: 'A', class: 'auto_toggle', options: { required_devices: ['p1_meter', 'ghost'] } }],
		});
		const details = parseTopology(text).warnings.map((warning) => warning.detail);
		expect(details).toEqual(['configDanglingRef']);
	});

	it('survives hostile names without corrupting the index', () => {
		const text = JSON.stringify({
			devices: [
				{ name: '__proto__', kind: 'p1' },
				{ name: 'constructor', kind: 'p1' },
				{ name: 'toString', kind: 'p1' },
			],
		});
		expect(doc(text).entries.map((entry) => entry.name)).toEqual(['__proto__', 'constructor', 'toString']);
		expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
	});

	it('truncates an absurd document and says so', () => {
		const devices = Array.from({ length: MAX_TOPOLOGY_ENTRIES + 500 }, (_unused, index) => ({
			name: `d${index}`,
			kind: 'p1',
		}));
		const parsed = parseTopology(JSON.stringify({ devices }));
		expect(parsed.doc?.entries).toHaveLength(MAX_TOPOLOGY_ENTRIES);
		expect(parsed.warnings.map((warning) => warning.detail)).toContain('configTruncated');
	});

	it('ignores an entry missing its name or its type', () => {
		const text = JSON.stringify({
			devices: [{ name: 'ok', kind: 'p1' }, { kind: 'p1' }, { name: 'no-kind' }],
		});
		expect(doc(text).entries.map((entry) => entry.name)).toEqual(['ok']);
	});

	it('drops an env value the EMS schema does not allow', () => {
		expect(doc(JSON.stringify({ env: 'staging', devices: [{ name: 'd', kind: 'p1' }] })).env).toBeNull();
		expect(doc(JSON.stringify({ env: 'prod', devices: [{ name: 'd', kind: 'p1' }] })).env).toBe('prod');
	});
});

describe('matchTopology', () => {
	const text = JSON.stringify({
		connectors: [{ name: 'replay', protocol: 'pseudo' }],
		devices: [
			{ name: 'p1_meter', kind: 'p1', options: { connector_options: { name: 'replay' } } },
			{ name: 'ghost_meter', kind: 'p1', options: { connector_options: { name: 'replay' } } },
		],
		algorithms: [{ name: 'AutoToggle', class: 'auto_toggle' }],
		storage: [{ name: 'csv', class: 'csv_file' }],
		services: [{ name: 'api', class: 'rest_api' }],
	});

	it('marks a device with no rows as silent, which the CSVs alone cannot say', () => {
		const match = matchTopology(doc(text), seen({ readings: new Set(['p1_meter']) }));
		const status = (name: string) => match.rows.find((row) => row.entry.name === name)?.status;
		expect(status('p1_meter')).toBe('matched');
		expect(status('ghost_meter')).toBe('silent');
		// The connector and the algorithm are silent here too — nothing seeded a worker or a
		// decision — so the count spans every role that can be silent, not just devices.
		expect(match.silentCount).toBe(match.rows.filter((row) => row.status === 'silent').length);
		expect(match.rows.filter((row) => row.status === 'silent').map((row) => row.entry.name)).toEqual([
			'replay',
			'ghost_meter',
			'AutoToggle',
		]);
	});

	it('accepts either a decision or a worker as evidence for an algorithm', () => {
		expect(
			matchTopology(doc(text), seen({ decisions: new Set(['AutoToggle']) })).rows.find(
				(row) => row.entry.role === 'algorithm',
			)?.status,
		).toBe('matched');
		expect(
			matchTopology(doc(text), seen({ workers: new Set(['AutoToggle']) })).rows.find(
				(row) => row.entry.role === 'algorithm',
			)?.status,
		).toBe('matched');
	});

	it('never calls a storage backend or a service silent', () => {
		// Neither ever appears as an actor in either CSV, so "no data" would be a lie about a
		// component that is working perfectly.
		const match = matchTopology(doc(text), seen());
		for (const role of ['storage', 'service']) {
			expect(match.rows.find((row) => row.entry.role === role)?.status).toBe('notApplicable');
		}
	});

	it('lists a name that is in the data but not in the configuration', () => {
		const match = matchTopology(doc(text), seen({ readings: new Set(['p1_meter', 'surprise_plug']) }));
		expect(match.undeclared).toEqual(['surprise_plug']);
	});

	it('matches byte-exactly, so a trailing space produces two honest rows', () => {
		// Names are operator-chosen free text and the only join key. One confidently wrong join
		// is worse than two rows that each say something true.
		const match = matchTopology(doc(text), seen({ readings: new Set(['p1_meter ']) }));
		expect(match.rows.find((row) => row.entry.name === 'p1_meter')?.status).toBe('silent');
		expect(match.undeclared).toContain('p1_meter ');
	});
});

describe('parseConfigVersion', () => {
	it('reads exactly the grammar config.schema.json allows', () => {
		expect(parseConfigVersion('1.0.0')).toEqual({ major: 1, minor: 0, patch: 0 });
		expect(parseConfigVersion('10.20.30')).toEqual({ major: 10, minor: 20, patch: 30 });
		// Leading zeros: the EMS pattern accepts them, so refusing here would mean silence
		// about a file the EMS reads perfectly.
		expect(parseConfigVersion('01.02.03')).toEqual({ major: 1, minor: 2, patch: 3 });
	});

	it('refuses anything the EMS schema would have refused, rather than guessing a major', () => {
		for (const value of [
			'v1.0.0',
			'1.0',
			'1.0.0.0',
			'1.0.0-rc1',
			'1.0.0+build',
			' 1.0.0',
			'1.0.0 ',
			'',
			'${CONFIG_VERSION}',
			null,
			undefined,
			2,
			{},
		]) {
			expect(parseConfigVersion(value), String(value)).toBeNull();
		}
	});

	it('reads only ASCII digits, matching config.schema.json and the Python parser', () => {
		// JSON Schema regexes are ECMA-262, so the EMS schema's \d is [0-9] and this must be
		// too. config/version.py spells [0-9] out because Python's \d is Unicode-aware — left
		// as \d it would read this as major 2 and log an error about a file this says nothing
		// about, which is exactly the divergence both parsers claim cannot happen.
		expect(parseConfigVersion('٢.٠.٠')).toBeNull();
		expect(parseConfigVersion('２.0.0')).toBeNull();
	});

	it('refuses a component too long to be a number, matching the Python parser bound', () => {
		// config/version.py bounds each component to nine digits because int() raises above
		// sys.get_int_max_str_digits(). Carrying the same bound is what keeps the two
		// implementations agreeing on every input rather than only on realistic ones.
		expect(parseConfigVersion(`${'1'.repeat(4400)}.0.0`)).toBeNull();
	});
});

describe('the declared configuration version', () => {
	const config = (version: unknown) =>
		JSON.stringify({ version, devices: [{ name: 'p1_meter', kind: 'p1' }] });

	it('says nothing about a configuration on this viewer’s major', () => {
		// A minor is additive by the EMS's bump rule, so it cannot move a path read here —
		// this guards the off-by-one where the comparison reaches past the major.
		for (const version of ['1.0.0', '1.4.2', '1.0.9']) {
			expect(parseTopology(config(version)).warnings, version).toEqual([]);
		}
	});

	it('notes a major it was not written for, and reads every entry anyway', () => {
		const text = JSON.stringify({
			version: '2.0.0',
			connectors: [{ name: 'replay', protocol: 'pseudo', options: { emulates: 'mqtt' } }],
			devices: [{ name: 'p1_meter', kind: 'p1', options: { connector_options: { name: 'replay' } } }],
		});
		const parsed = parseTopology(text);
		expect(parsed.warnings.map((warning) => warning.detail)).toEqual(['configVersionDrift']);
		// The half that matters: annotated, never refused.
		expect(parsed.doc).not.toBeNull();
		expect(parsed.doc?.version).toBe('2.0.0');
		expect(parsed.doc?.entries).toHaveLength(2);
		expect(parsed.doc?.entries.find((entry) => entry.role === 'device')?.protocol).toBe('mqtt');
	});

	it('notes a major behind this viewer as readily as one ahead', () => {
		// The rule is inequality, not "older than". A 0.x document is as unreadable a promise
		// as a 2.x one, and the EMS treats both as an error too.
		expect(parseTopology(config('0.9.0')).warnings.map((w) => w.detail)).toEqual(['configVersionDrift']);
	});

	it('carries both versions as params and no sample', () => {
		const warning = parseTopology(config('2.0.0')).warnings[0]!;
		expect(warning.code).toBe('CONFIG_SHAPE');
		expect(warning.params).toEqual({ declared: '2.0.0', supported: String(CONFIG_FORMAT_MAJOR) });
		// `sample` is documented as "the offending cell"; a version is neither a cell nor an
		// operator-chosen name, and the string is already in params.
		expect(warning.sample).toBeNull();
		expect(warning.row).toBeNull();
	});

	it('says nothing about a version it could not read, because it did not read one', () => {
		// The panel prints the string verbatim either way, so the display is the
		// disambiguation. A second sentence would be the viewer talking about a field it
		// declined to read — and `${...}` is a legal, intended template in this file.
		for (const version of ['${CONFIG_VERSION}', 'v2.0.0', '2.0', '2.0.0-rc1', '2.0.0+build', 2.0, '', null]) {
			expect(parseTopology(config(version)).warnings, String(version)).toEqual([]);
		}
		expect(parseTopology(JSON.stringify({ devices: [{ name: 'p1_meter', kind: 'p1' }] })).warnings).toEqual([]);
	});

	it('round-trips the declared string verbatim whatever the verdict', () => {
		expect(parseTopology(config('2.0.0')).doc?.version).toBe('2.0.0');
		expect(parseTopology(config('v2.0.0')).doc?.version).toBe('v2.0.0');
		expect(parseTopology(config(2.0)).doc?.version).toBeNull();
		expect(parseTopology(config('')).doc?.version).toBeNull();
	});

	it('puts the note first, so it frames the warnings under it', () => {
		// A reader who meets the frame last has already blamed the configuration for what may
		// be a format change.
		const text = JSON.stringify({
			version: '2.0.0',
			devices: [{ name: 'p1_meter', kind: 'p1', options: { connector_options: { name: 'ghost' } } }],
		});
		expect(parseTopology(text).warnings.map((warning) => warning.detail)).toEqual([
			'configVersionDrift',
			'configDanglingRef',
		]);
	});

	it('does not note the version of a document it refuses', () => {
		// A file this cannot describe at all gets one reason, not two.
		const parsed = parseTopology(JSON.stringify({ version: '2.0.0', name: 'a package.json' }));
		expect(parsed.doc).toBeNull();
		expect(parsed.warnings.map((warning) => warning.detail)).toEqual(['configUnknownShape']);
	});

	it('adds no field to the document by comparing the version', () => {
		// The comparison is a decision, not data: the returned surface must stay exactly
		// where it was.
		expect(Object.keys(parseTopology(config('2.0.0')).doc!).sort()).toEqual(['entries', 'env', 'version']);
	});
});
