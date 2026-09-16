/**
 * A content hash for one API snapshot, so a repeated poll is not a repeated reading.
 *
 * This is what separates a live feed from garbage. `/devices` is a snapshot endpoint with no
 * `?since=` and no history, so polling a fifteen-minute meter every two seconds manufactures
 * 450 identical readings — a chart that looks like a dense measurement of nothing.
 */

/**
 * Canonical serialisation, defined precisely because "just JSON.stringify it" is wrong here.
 *
 * - **Object keys are sorted.** `_jsonable` stringifies every dict key on the Python side,
 *   and V8 then re-orders integer-like keys (`"1"`, `"2"`) ahead of the rest regardless of
 *   what Python emitted. Insertion order is not stable across the boundary; sorted order is.
 * - **Arrays keep their order.** The flattener's path grammar is positional
 *   (`data.3.obis.class`), so a reordered list genuinely *is* a different reading and must
 *   not hash equal. The accepted cost: `_jsonable` turns a Python `set` into an array in
 *   arbitrary order, so a device that exposes a set in `data` may emit spurious samples.
 *   Sorting would suppress genuine reorderings, which is strictly worse than a device shape
 *   nothing in this project uses.
 * - **Strings are length-prefixed**, so `{"a": "1"}` cannot collide with `{"a1": ""}`.
 *
 * Streamed into the hash rather than built as a string: 50 devices × 4 KB every two seconds
 * would otherwise allocate megabytes an hour to produce two integers.
 */

const OFFSET_A = 0x811c9dc5;
const OFFSET_B = 0x01000193;
const PRIME = 0x01000193;
const MAX_DEPTH = 12;

class Fnv1a {
	private a = OFFSET_A;
	private b = OFFSET_B;

	push(text: string): void {
		for (let i = 0; i < text.length; i++) {
			const code = text.charCodeAt(i);
			this.a = Math.imul(this.a ^ code, PRIME);
			// A second lane with a different starting basis. One 32-bit lane over the ~10^4
			// distinct payloads a long session produces gives roughly a 1% chance of a
			// collision — i.e. about one genuine sample silently suppressed per session.
			// Two lanes take that to ~5e-12.
			this.b = Math.imul(this.b ^ code, PRIME) + (this.a & 0xff);
		}
	}

	digest(): string {
		return `${(this.a >>> 0).toString(36)}:${(this.b >>> 0).toString(36)}`;
	}
}

function walk(hash: Fnv1a, value: unknown, depth: number): void {
	if (depth > MAX_DEPTH) {
		// The API caps its own recursion at 10, so this is a belt rather than a policy.
		hash.push(`s${String(value).length}:${String(value)}`);
		return;
	}
	if (value === null || value === undefined) {
		hash.push('n');
		return;
	}
	switch (typeof value) {
		case 'boolean':
			hash.push(value ? 't' : 'f');
			return;
		case 'number':
			hash.push(`#${String(value)}`);
			return;
		case 'string':
			hash.push(`s${value.length}:${value}`);
			return;
	}
	if (Array.isArray(value)) {
		hash.push('[');
		for (const item of value) walk(hash, item, depth + 1);
		hash.push(']');
		return;
	}
	hash.push('{');
	const record = value as Record<string, unknown>;
	for (const key of Object.keys(record).sort()) {
		hash.push(`s${key.length}:${key}`);
		walk(hash, record[key], depth + 1);
	}
	hash.push('}');
}

export function canonicalHash(value: unknown): string {
	const hash = new Fnv1a();
	walk(hash, value, 0);
	return hash.digest();
}
