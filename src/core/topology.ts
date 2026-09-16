import type { SourceWarning } from '../sources/data-source.js';

/**
 * The EMS's `config.json`, reduced to what a viewer may see.
 *
 * ## Why this file exists
 *
 * `docs/storage-format.md` §8 in the EMS repository: **names are the only join key**. The two
 * CSVs carry no kind, class, connector or protocol, and §7 adds that they cannot distinguish
 * a device that went silent from one that was never configured. Live mode answers both from
 * `/api/devices`; file mode had no equivalent. A config supplies exactly that, and nothing
 * about it belongs in the time series — which is why this is not a `DataSource`.
 *
 * ## The allowlist is the whole point
 *
 * A real `config.json` holds broker hosts, usernames, passwords, API tokens, MQTT topics,
 * Modbus register maps and filesystem paths. This module reads **twelve named paths** and
 * cannot read a thirteenth: entries are *constructed* field by field from named reads, with
 * no spread, no `delete` and no denylist anywhere. A key nobody named here does not survive
 * into the returned object, so an option the EMS adds next year is excluded by default rather
 * than by somebody remembering to exclude it. That is the same discipline
 * `services/rest_api.py` applies to a device payload, and for the same reason.
 *
 * Four of those paths reach inside an `options` object. They are named individually below;
 * everything else under any `options` — including every untyped key under an algorithm's,
 * which is where a private algorithm's parameters live — is never touched.
 */

/** The five plugin axes a config declares, as they appear to a reader. */
export type TopologyRole = 'device' | 'algorithm' | 'connector' | 'storage' | 'service';

export interface TopologyEntry {
	readonly role: TopologyRole;
	readonly name: string;
	/**
	 * `kind` for a device, `class` for an algorithm/storage/service, `protocol` for a
	 * connector. One column, because the EMS uses three words for one idea.
	 */
	readonly type: string | null;
	/** Devices only: `options.connector_options.name`. */
	readonly connector: string | null;
	/**
	 * Devices only, **resolved**: the referenced connector's `options.emulates`, falling back
	 * to its `protocol`.
	 *
	 * Reproduces `config/config.py`'s own resolution, so this equals what
	 * `/api/devices[].protocol` reports for the same device — a replay connector declaring
	 * `emulates: "mqtt"` makes its devices read `mqtt` in both modes. Null when the device
	 * names a connector the config does not declare.
	 */
	readonly protocol: string | null;
	/** Algorithms only: `options.delay_seconds`, when it is a finite number. */
	readonly delaySeconds: number | null;
	/** Algorithms only: `options.wait_for_devices_timeout`, when it is a finite number. */
	readonly waitForDevicesTimeout: number | null;
	/** Algorithms only: `options.required_devices`, strings only. */
	readonly requiredDevices: readonly string[];
}

export interface TopologyDoc {
	/**
	 * Displayed verbatim, **never compared**.
	 *
	 * `config/config.py` warns on any mismatch against its own `DEFAULT_VERSION` and carries a
	 * TODO for real semver handling — the EMS's own worked example trips that warning. A gate
	 * built on this field would be a gate on a value nobody can satisfy.
	 */
	readonly version: string | null;
	/** Null unless it is one of the three the EMS schema allows, so no arbitrary string renders. */
	readonly env: 'prod' | 'test' | 'dev' | null;
	readonly entries: readonly TopologyEntry[];
}

export interface TopologyParse {
	/** Null when the document was refused; `warnings` then says why. */
	readonly doc: TopologyDoc | null;
	readonly warnings: readonly SourceWarning[];
}

/**
 * Bound on entries read from one document.
 *
 * Same reasoning as `MAX_SERIES` in `core/ingest.ts`: a dropped file is untrusted input, and
 * the honest response to an absurd one is a stated truncation rather than a frozen tab.
 */
export const MAX_TOPOLOGY_ENTRIES = 2000;

/** Bytes above which a `{`-leading file is refused unread. */
export const MAX_CONFIG_BYTES = 2 * 1024 * 1024;

const ENV_VALUES = new Set(['prod', 'test', 'dev']);

/**
 * Whether this text looks like a JSON config rather than a CSV.
 *
 * Content, not extension — the same rule `looksLikeControlLog` follows. A `.json` file
 * holding CSV goes down the CSV path, and a config saved under any name still loads.
 */
export function looksLikeConfigJson(text: string): boolean {
	return text.trimStart().startsWith('{');
}

/** The five sections, and which role each contributes. */
const SECTIONS: readonly { readonly key: string; readonly role: TopologyRole; readonly typeKey: string }[] = [
	{ key: 'connectors', role: 'connector', typeKey: 'protocol' },
	{ key: 'devices', role: 'device', typeKey: 'kind' },
	{ key: 'algorithms', role: 'algorithm', typeKey: 'class' },
	{ key: 'storage', role: 'storage', typeKey: 'class' },
	{ key: 'services', role: 'service', typeKey: 'class' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
	return typeof value === 'string' && value !== '' ? value : null;
}

function finiteOrNull(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The one nested read allowed on a device: `options.connector_options.name`. */
function connectorName(options: unknown): string | null {
	if (!isRecord(options)) return null;
	const connectorOptions = options['connector_options'];
	return isRecord(connectorOptions) ? stringOrNull(connectorOptions['name']) : null;
}

/** The one read allowed on a connector's options: the transport it emulates. */
function emulates(options: unknown): string | null {
	return isRecord(options) ? stringOrNull(options['emulates']) : null;
}

function warn(detail: SourceWarning['detail'], params?: SourceWarning['params'], sample?: string): SourceWarning {
	return { code: 'CONFIG_SHAPE', row: null, detail, params, sample: sample ?? null };
}

/**
 * Parse a config document into a topology, or refuse it with a reason.
 *
 * Never throws. Every failure mode is a warning the caller can render, because a refusal that
 * cannot explain itself is the empty-table bug the CSV shape sniffing already exists to avoid.
 */
export function parseTopology(text: string): TopologyParse {
	if (text.length > MAX_CONFIG_BYTES) {
		return { doc: null, warnings: [warn('configTooLarge')] };
	}

	let root: unknown;
	try {
		root = JSON.parse(text);
	} catch (error) {
		return { doc: null, warnings: [warn('configInvalidJson', { message: String(error) })] };
	}
	if (!isRecord(root)) {
		return { doc: null, warnings: [warn('configUnknownShape')] };
	}

	const warnings: SourceWarning[] = [];
	const entries: TopologyEntry[] = [];
	// Map, never a plain object: config names are untrusted text, and `__proto__` as a key on
	// an object literal is a prototype write rather than an entry. test/i18n.test.ts already
	// pins that family of name as a live concern in this repository.
	const connectorProtocols = new Map<string, string>();
	const seen = new Map<string, Set<string>>();
	let truncated = false;
	let recognised = false;

	// Connectors first: a device's protocol resolves through them, and section order in the
	// document is not guaranteed.
	const connectors = root['connectors'];
	if (Array.isArray(connectors)) {
		for (const raw of connectors) {
			if (!isRecord(raw)) continue;
			const name = stringOrNull(raw['name']);
			const protocol = stringOrNull(raw['protocol']);
			if (name === null || protocol === null) continue;
			if (!connectorProtocols.has(name)) connectorProtocols.set(name, emulates(raw['options']) ?? protocol);
		}
	}

	for (const section of SECTIONS) {
		const list = root[section.key];
		if (!Array.isArray(list)) continue;
		const names = new Set<string>();
		seen.set(section.key, names);
		for (const raw of list) {
			if (!isRecord(raw)) continue;
			const name = stringOrNull(raw['name']);
			const type = stringOrNull(raw[section.typeKey]);
			// The EMS requires both; an entry missing either is not an entry this can describe.
			if (name === null || type === null) continue;
			recognised = true;
			if (names.has(name)) {
				// The EMS deduplicates the same way — first wins, the rest are reported.
				warnings.push(warn('configDuplicateName', { section: section.key, name }, name));
				continue;
			}
			names.add(name);
			if (entries.length >= MAX_TOPOLOGY_ENTRIES) {
				truncated = true;
				continue;
			}

			const options = raw['options'];
			const isDevice = section.role === 'device';
			const isAlgorithm = section.role === 'algorithm';
			const connector = isDevice ? connectorName(options) : null;
			let protocol: string | null = null;
			if (isDevice && connector !== null) {
				protocol = connectorProtocols.get(connector) ?? null;
				if (protocol === null) {
					warnings.push(warn('configDanglingRef', { name, missing: connector }, connector));
				}
			}

			entries.push({
				role: section.role,
				name,
				type,
				connector,
				protocol,
				delaySeconds: isAlgorithm && isRecord(options) ? finiteOrNull(options['delay_seconds']) : null,
				waitForDevicesTimeout:
					isAlgorithm && isRecord(options) ? finiteOrNull(options['wait_for_devices_timeout']) : null,
				requiredDevices:
					isAlgorithm && isRecord(options) && Array.isArray(options['required_devices'])
						? options['required_devices'].filter((device): device is string => typeof device === 'string')
						: [],
			});
		}
	}

	if (!recognised) {
		// Valid JSON, but nothing that looks like an EMS config — a package.json, a tsconfig,
		// an arbitrary object. Refused rather than shown as an empty topology, which would
		// read as "this config declares nothing".
		return { doc: null, warnings: [warn('configUnknownShape')] };
	}
	if (truncated) warnings.push(warn('configTruncated', { n: MAX_TOPOLOGY_ENTRIES }));

	// A required_devices entry naming a device the config does not declare is the same class of
	// error as a dangling connector, and the EMS logs it too.
	const devices = new Set(entries.filter((entry) => entry.role === 'device').map((entry) => entry.name));
	for (const entry of entries) {
		if (entry.role !== 'algorithm') continue;
		for (const required of entry.requiredDevices) {
			if (!devices.has(required)) {
				warnings.push(warn('configDanglingRef', { name: entry.name, missing: required }, required));
			}
		}
	}

	const env = stringOrNull(root['env']);
	return {
		doc: {
			version: stringOrNull(root['version']),
			env: env !== null && ENV_VALUES.has(env) ? (env as TopologyDoc['env']) : null,
			entries,
		},
		warnings,
	};
}

/**
 * Actor names actually observed, by the kind that carried them.
 *
 * Built from a dataset's `fields` catalogue — one entry per actor — rather than by walking
 * every event. Walking is exactly what `core/merge.ts`'s index and the `kindCounts` tally
 * exist to avoid.
 */
export interface SeenActors {
	readonly readings: ReadonlySet<string>;
	readonly decisions: ReadonlySet<string>;
	readonly workers: ReadonlySet<string>;
}

export type TopologyStatus = 'matched' | 'silent' | 'notApplicable';

export interface TopologyRow {
	readonly entry: TopologyEntry;
	readonly status: TopologyStatus;
}

export interface TopologyMatch {
	readonly rows: readonly TopologyRow[];
	/** Names present in the data that this configuration does not declare. */
	readonly undeclared: readonly string[];
	readonly silentCount: number;
}

/**
 * Compare a declared topology against what the loaded data actually contains.
 *
 * Matching is **byte-exact**: no trim, no case folding. `storage-format.md` §8 makes names the
 * only join key and they are operator-chosen free text, so a config name differing from a data
 * name by one trailing space produces two honest rows — "configured, no data" and "in the data,
 * not in this configuration" — which beats one confidently wrong join.
 *
 * Storage backends and services are `notApplicable` rather than `silent`: neither ever appears
 * as an actor in either CSV, so badging a CSV backend "no data" would be a lie about a
 * component that is working perfectly.
 */
export function matchTopology(doc: TopologyDoc, seen: SeenActors): TopologyMatch {
	const rows: TopologyRow[] = [];
	let silentCount = 0;
	for (const entry of doc.entries) {
		let status: TopologyStatus;
		if (entry.role === 'storage' || entry.role === 'service') {
			status = 'notApplicable';
		} else if (entry.role === 'device') {
			status = seen.readings.has(entry.name) ? 'matched' : 'silent';
		} else if (entry.role === 'algorithm') {
			// A live worker is named after its algorithm, so either surface counts as evidence.
			status = seen.decisions.has(entry.name) || seen.workers.has(entry.name) ? 'matched' : 'silent';
		} else {
			status = seen.workers.has(entry.name) ? 'matched' : 'silent';
		}
		if (status === 'silent') silentCount++;
		rows.push({ entry, status });
	}

	const declared = new Set(doc.entries.map((entry) => entry.name));
	const undeclared: string[] = [];
	for (const name of [...seen.readings, ...seen.decisions]) {
		if (!declared.has(name) && !undeclared.includes(name)) undeclared.push(name);
	}

	return { rows, undeclared, silentCount };
}
