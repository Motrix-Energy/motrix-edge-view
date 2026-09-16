import { looksLikeJsonObject, parseJsonLenient } from './json.js';

/**
 * Turn an arbitrary device payload into flat `path -> value` leaves.
 *
 * Device payloads have no common shape — the pseudo device is double-encoded, ShellyPlug
 * is flat with string-typed numbers, P1 is nested OBIS lists — so flattening is generic
 * and everything downstream (field discovery, columns, charts) works off the result.
 *
 * The path grammar matches the EMS's own `storage/influxdb.py`, published normatively in
 * `docs/storage-format.md`:
 *
 *   - object key      ->  `parent.key`
 *   - array index     ->  `parent.0`   (a dot, like the Python; NOT brackets)
 *   - depth beyond 10 ->  the value is stringified and stops there
 *
 * Two known, documented weaknesses of that grammar, inherited on purpose rather than
 * silently "fixed" into a different one:
 *
 *   - A key that already contains `.` collides with nesting. Last write wins, and a
 *     flattened path is not invertible.
 *   - Array indices are **positional**, so `data.3.obis.class` names a different register
 *     the moment a meter emits a different number of lines. Nothing here detects a stable
 *     discriminator; if that is ever wanted, a `data[obis=1-0:1.8.1]` form would be
 *     unambiguous against this grammar precisely because it never emits brackets.
 *
 * One addition the Python does not need: a **string that is itself JSON** is descended
 * into. The pseudo device keeps `payload` as a JSON string and `parsed` as the decoded
 * object; without this, charting `payload` finds nothing.
 */

export const DEFAULT_SEPARATOR = '.';
export const MAX_DEPTH = 10;
/** How many times a JSON-in-a-string may be unwrapped. Two is enough for `payload`. */
export const MAX_REENCODE = 2;

export interface FlattenOptions {
	separator?: string;
	maxDepth?: number;
	maxReencode?: number;
	/** Descend into strings that are themselves JSON. On by default. */
	descendEncoded?: boolean;
}

/**
 * Called once per leaf. `unit` is a sibling `unit` key when the payload volunteered one —
 * P1 emits `{"value": 123.4, "unit": "kWh"}`, and that is the only automatic signal the
 * axis grouper has for telling a temperature from a power.
 */
export type LeafVisitor = (path: string, value: unknown, unit?: string) => void;

export function flatten(value: unknown, visit: LeafVisitor, options: FlattenOptions = {}): void {
	const separator = options.separator ?? DEFAULT_SEPARATOR;
	const maxDepth = options.maxDepth ?? MAX_DEPTH;
	const maxReencode = options.maxReencode ?? MAX_REENCODE;
	const descendEncoded = options.descendEncoded ?? true;

	const join = (prefix: string, part: string) => (prefix === '' ? part : prefix + separator + part);

	function walk(node: unknown, prefix: string, depth: number, reencode: number): void {
		if (node === null || node === undefined) {
			visit(prefix, null);
			return;
		}

		const type = typeof node;

		if (type === 'string' && descendEncoded && reencode < maxReencode && looksLikeJsonObject(node as string)) {
			// `parseJsonLenient`, not `JSON.parse`: the outer payload is already parsed that way
			// by `Ingestor.discover`, and using the strict one here made the same rule answer
			// twice. A pseudo device writes `payload` as a JSON *string* — the case this branch
			// exists for — so a run with `allow_nan=True` had its bare NaN repaired at depth 0
			// and not at depth 1, and that one payload stayed a single opaque leaf.
			const inner = parseJsonLenient(node as string);
			if (inner.ok && inner.value !== null && typeof inner.value === 'object') {
				walk(inner.value, prefix, depth, reencode + 1);
				return;
			}
			// Not JSON after all. Fall through and record it as the string it is.
		}

		if (type !== 'object') {
			visit(prefix, node);
			return;
		}

		if (depth >= maxDepth) {
			// Not dropped: a consumer would rather see a truncated value than nothing, and
			// the string still shows up in the timeline. It is simply not chartable.
			visit(prefix, JSON.stringify(node));
			return;
		}

		if (Array.isArray(node)) {
			if (node.length === 0) visit(prefix, '[]');
			for (let i = 0; i < node.length; i++) walk(node[i], join(prefix, String(i)), depth + 1, reencode);
			return;
		}

		const record = node as Record<string, unknown>;
		const keys = Object.keys(record);
		if (keys.length === 0) {
			visit(prefix, '{}');
			return;
		}

		// A `unit` sibling annotates its `value` sibling rather than being a leaf of its
		// own — P1's {"value": 123.4, "unit": "kWh"} is one measurement, not two fields.
		const unit = typeof record['unit'] === 'string' ? (record['unit'] as string) : undefined;

		for (const key of keys) {
			const child = record[key];
			if (unit !== undefined && key === 'value' && child !== null && typeof child !== 'object') {
				visit(join(prefix, key), child, unit);
				continue;
			}
			walk(child, join(prefix, key), depth + 1, reencode);
		}
	}

	walk(value, '', 0, 0);
}

/** Convenience wrapper for tests and one-off inspection. Do not use on the ingest path. */
export function flattenToRecord(value: unknown, options?: FlattenOptions): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	flatten(value, (path, leaf) => void (out[path] = leaf), options);
	return out;
}
