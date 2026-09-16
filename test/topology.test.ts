import { describe, expect, it } from 'vitest';

import {
	MAX_TOPOLOGY_ENTRIES,
	looksLikeConfigJson,
	matchTopology,
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

	it('reads the version without ever comparing it', () => {
		// config.py's own version check is a TODO that warns on any mismatch — the EMS's worked
		// example trips it. Displaying the string is honest; gating on it would not be.
		expect(doc(text).version).toBe('1.0.0');
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
