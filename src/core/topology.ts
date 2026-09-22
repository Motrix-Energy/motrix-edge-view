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
 *
 * The document's `version` is one of the twelve and is now **compared** — its major only,
 * and only to raise a warning. That is not a widening: nothing about the comparison reaches
 * the returned object, `TopologyDoc.version` is still the raw declared string, and the type
 * gains no field. A decision is not data.
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
	 * Displayed verbatim; its **major alone** is compared, and only ever to annotate.
	 *
	 * The EMS reads this as the version of the *config document format* — never its own
	 * release — and `motrix-edge/config/version.py` holds the bump table. The viewer is not
	 * entitled to as much from it, because it reads twelve named paths out of a file it did
	 * not write: a minor that adds an option under `services` moves nothing here, and an
	 * operator hand-editing a `1.0.0` file can break every path without touching the number.
	 *
	 * What a **major** is, is the only notice this document can give that a path below may
	 * have moved — and a moved path does not fail loudly here, it produces a plausible,
	 * wrong table: devices with null connectors, a burst of `configDanglingRef` blaming the
	 * operator's configuration for a format change, `silent` badges on devices that are
	 * reporting fine. So a `2.x` config still renders in full, with one sentence in the load
	 * report saying an empty kind or an unresolved connector may be the format rather than
	 * the configuration. That is an annotation, not a gate; nothing is refused and nothing
	 * is hidden, which is the whole difference from the gate this comment used to rule out.
	 *
	 * Deliberately **not** parsed into this type. `TopologyDoc` gains no field: the
	 * comparison is a decision taken inside `parseTopology` and then discarded, so the
	 * surface stays exactly the twelve named paths it was.
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

/**
 * The config-document format this module's twelve named paths were written against.
 *
 * Pinned to the major of the worked example the EMS publishes and this repository vendors
 * — `test/topology.test.ts` asserts the pair — rather than to the EMS's own Python
 * constant, which nothing here can read.
 *
 * **This pin is weaker than `motrixStorageFormat`, and the difference is worth knowing.**
 * That one is declaration-to-declaration: the EMS *declares* `storage_format_version` in
 * `examples/MANIFEST.json` and `test/fixtures.test.ts` fails the build against it. This one
 * is constant-to-sample — `auto_toggle/config.json` is not checksummed by that manifest,
 * `scripts/update-fixtures.mjs` copies it in the authored tier, and nothing forces the
 * re-vendor. So a bump on the EMS side reaches this constant only when somebody re-vendors.
 * That is tolerable precisely because nothing here gates on it: the cost of noticing late
 * is one missing sentence in a load report, not a misparsed file.
 */
export const CONFIG_FORMAT_MAJOR = 1;

const ENV_VALUES = new Set(['prod', 'test', 'dev']);

/**
 * `^\d+\.\d+\.\d+$` — exactly `config.schema.json`'s grammar, and not one character wider.
 *
 * Stricter than semver.org on purpose (no pre-release, no build metadata) because the EMS
 * pattern is, and more tolerant than semver.org about leading zeros for the same reason:
 * `01.0.0` is schema-valid there, so refusing it here would produce silence about a file
 * the EMS accepts.
 *
 * The one place it is narrower is component length. The EMS pattern bounds nothing, but
 * `config/version.py` bounds each component to nine digits — `int()` raises above
 * `sys.get_int_max_str_digits()`, and that loader promises never to raise — so this carries
 * the same bound to keep the two implementations agreeing on every input rather than only
 * on realistic ones. `CLAUDE.md`'s rule about a deliberate second implementation of a
 * Python rule is what this is: acceptable, as long as it cannot drift silently.
 *
 * `\d` here is ECMA-262's, so it is exactly `[0-9]` — which is also what the EMS's own
 * JSON Schema pattern means, JSON Schema regexes being ECMA-262. `config/version.py` spells
 * `[0-9]` out for that reason: Python's `\d` is Unicode-aware, so left as `\d` it would read
 * `٢.٠.٠` as a major of 2 and log an error about a document this would say nothing about.
 */
const CONFIG_VERSION_PATTERN = /^(\d{1,9})\.(\d{1,9})\.(\d{1,9})$/;

/**
 * The declared version as three numbers, or null when there is no version to read.
 *
 * Null is how this says *I did not read a version*, and the caller's answer to that is
 * silence plus the verbatim display — today's behaviour, preserved for every input the
 * comparison cannot honestly cover. Being any more tolerant would mean reading a major out
 * of a string the EMS's own validator would have rejected and then warning an operator
 * about a number this module invented.
 *
 * Exported for `test/topology.test.ts` only, the way `looksLikeConfigJson` is.
 */
export function parseConfigVersion(value: unknown): { major: number; minor: number; patch: number } | null {
	if (typeof value !== 'string') return null;
	const match = CONFIG_VERSION_PATTERN.exec(value);
	if (match === null) return null;
	return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

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

	const declaredVersion = stringOrNull(root['version']);
	const parsedVersion = parseConfigVersion(declaredVersion);
	if (parsedVersion !== null && parsedVersion.major !== CONFIG_FORMAT_MAJOR) {
		// First, not last. The panel renders `warnings` in array order, and this note is the
		// frame for everything under it — an unresolved connector may be the format rather
		// than the configuration — so a reader who meets it last has already blamed the
		// wrong thing. Built here rather than earlier because it needs nothing from the walk,
		// and after the `!recognised` refusal above deliberately: a document this cannot
		// describe at all gets one reason, not two.
		//
		// The minor is not compared. A minor is additive by the EMS's own bump rule, so it
		// cannot move a path this module already reads — which is the only thing a version
		// can tell this module. The EMS does warn about a newer minor, because unlike this
		// it reads every key in the file and can have ignored one.
		warnings.unshift(
			warn('configVersionDrift', { declared: declaredVersion!, supported: String(CONFIG_FORMAT_MAJOR) }),
		);
	}

	const env = stringOrNull(root['env']);
	return {
		doc: {
			version: declaredVersion,
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
