import type { EventKind } from '../../core/types.js';

/**
 * Which of the EMS's two CSV shapes a file is, decided from its header.
 *
 * The prototype had no shape check at all: either file could be dropped into either zone,
 * and dropping the wrong one produced zero rows and a silent empty state. Sniffing the
 * header instead means one drop zone can accept both, and an unrecognised file says so.
 *
 * Headers are matched by *set*, not by order, so a future MINOR format bump that appends a
 * column still loads. A MAJOR bump that renames or reorders one deliberately does not —
 * see `docs/storage-format.md` in the EMS repository.
 */
export interface CsvShape {
	readonly id: 'readings' | 'decisions' | 'control-log' | 'replay';
	readonly kind: EventKind;
	readonly required: readonly string[];
	/** Column holding the timestamp. */
	readonly timeColumn: string;
	/** Column holding the actor: the device that reported, or the algorithm that decided. */
	readonly actorColumn: string;
	/** Column holding the target of a decision, if any. */
	readonly targetColumn: string | null;
	/** Column holding the opaque payload. */
	readonly payloadColumn: string;
	/**
	 * Whether the target column also qualifies the series path.
	 *
	 * True only for the replay input, and load-bearing there: one device publishes on several
	 * topics with different payload shapes. `shelly_plug` sends a bare float on
	 * `…/relay/0/power`, the word `off` on `…/relay/0` and another float on `…/temperature`.
	 * Without the prefix all three land on one path, and the numeric majority vote calls the
	 * mixture chartable — a series that silently interleaves 118.4 with a relay state.
	 */
	readonly targetQualifiesPath: boolean;
}

export const READINGS: CsvShape = {
	id: 'readings',
	kind: 'reading',
	required: ['timestamp', 'device_name', 'data_json'],
	timeColumn: 'timestamp',
	actorColumn: 'device_name',
	targetColumn: null,
	payloadColumn: 'data_json',
	targetQualifiesPath: false,
};

export const DECISIONS: CsvShape = {
	id: 'decisions',
	kind: 'decision',
	required: ['timestamp', 'algorithm', 'device', 'command'],
	timeColumn: 'timestamp',
	actorColumn: 'algorithm',
	targetColumn: 'device',
	payloadColumn: 'command',
	targetQualifiesPath: false,
};

/**
 * The pseudo connector's **input**, not the EMS's output.
 *
 * `topic` is deliberately absent from `required`: `connectors/pseudo.py` reads it with
 * `row.get('topic', '')`, so a replay without one is valid and must still load.
 *
 * There is no ambiguity to guard against — a replay has no `data_json` and a readings file has
 * no `payload` — so the set-based sniff separates them with no ordering rule.
 */
export const REPLAY: CsvShape = {
	id: 'replay',
	kind: 'input',
	required: ['timestamp', 'device_name', 'payload'],
	timeColumn: 'timestamp',
	actorColumn: 'device_name',
	targetColumn: 'topic',
	payloadColumn: 'payload',
	targetQualifiesPath: true,
};

export const SHAPES: readonly CsvShape[] = [READINGS, DECISIONS, REPLAY];

/**
 * Identify a file from its header row, or return null.
 *
 * Null is not necessarily an error: it is also what a pseudo-connector control log looks
 * like, which has no header at all and is not CSV. See `detectControlLog`.
 */
export function detectShape(header: readonly string[]): CsvShape | null {
	const present = new Set(header.map((h) => h.replace(/^\uFEFF/, '').trim()));
	for (const shape of SHAPES) {
		if (shape.required.every((column) => present.has(column))) return shape;
	}
	return null;
}

/**
 * Whether the first line looks like the pseudo connector's control log.
 *
 * That file is **not CSV**: no header, no quoting, `<iso>,<device>,<payload>` written with
 * a raw `f.write`. Every JSON command contains commas, so a CSV parser mis-splits it. It is
 * a debug log and the viewer declines to load it — recognising it exists purely so the
 * refusal can explain itself instead of showing an empty table.
 */
export function looksLikeControlLog(firstLine: string): boolean {
	if (firstLine.startsWith('timestamp,')) return false;
	const firstComma = firstLine.indexOf(',');
	if (firstComma < 0) return false;
	// An ISO-ish stamp, then a name, then something. Cheap and deliberately not exact.
	return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(firstLine.slice(0, firstComma));
}

/**
 * Whether this is the pseudo connector's *other* replay format, a JSON array.
 *
 * `connectors/pseudo.py` accepts `.csv` or `.json`; the viewer reads the CSV form. Recognised
 * so the refusal can name itself, exactly as with the control log — the alternative is
 * "Unrecognised columns: (none)", which tells a user nothing about a file the EMS accepts.
 *
 * Deliberately not implemented rather than deliberately unsupported: no JSON replay is
 * checksummed in the EMS's `examples/MANIFEST.json`, and authoring one here would make the
 * viewer's fixture something other than the interface it is meant to vendor.
 */
export function looksLikeJsonReplay(text: string): boolean {
	return text.trimStart().startsWith('[');
}
