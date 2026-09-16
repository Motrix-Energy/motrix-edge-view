export interface ParsedPayload {
	/** The parsed structure, or the original string when it was not JSON. */
	readonly value: unknown;
	/** Whether it parsed as JSON at all. */
	readonly ok: boolean;
	/** Whether bare NaN/Infinity had to be repaired first. */
	readonly repaired: boolean;
}

/**
 * Parse an EMS payload, tolerating the one thing the writer used to emit that a strict
 * parser rejects.
 *
 * `json.dumps` defaults to `allow_nan=True`, so any device payload containing a non-finite
 * float wrote bare `NaN` / `Infinity` / `-Infinity` into `data_json`. That is invalid JSON,
 * and a plain `JSON.parse` in a try/catch loses **the whole row's payload** rather than the
 * one offending field — for a divide-by-zero in one device. The EMS fixed the writer in
 * storage format 1.0, but files written before that still exist and are exactly the files
 * someone opens a viewer to understand.
 *
 * The repair is a **scanner, not a regex**, because the literal text `NaN` inside a string
 * value is legitimate data — a device reporting `{"status": "NaN sensor fault"}` must come
 * back untouched. A regex cannot tell the two apart; `json.test.ts` pins it.
 *
 * Repaired values become the strings `"nan"` / `"inf"` / `"-inf"`, which is the encoding
 * the EMS's own REST API uses for the same values, so both surfaces agree.
 */
export function parseJsonLenient(text: string): ParsedPayload {
	try {
		return { value: JSON.parse(text), ok: true, repaired: false };
	} catch {
		// fall through
	}

	// Only pay for the scan when the cheap parse already failed *and* the text plausibly
	// contains the thing we know how to repair.
	if (!text.includes('NaN') && !text.includes('Infinity')) {
		return { value: text, ok: false, repaired: false };
	}

	const repaired = repairNonFinite(text);
	if (!repaired.changed) return { value: text, ok: false, repaired: false };

	try {
		return { value: JSON.parse(repaired.text), ok: true, repaired: true };
	} catch {
		return { value: text, ok: false, repaired: false };
	}
}

interface Repair {
	text: string;
	changed: boolean;
}

function repairNonFinite(text: string): Repair {
	let out = '';
	let index = 0;
	let changed = false;
	const length = text.length;

	while (index < length) {
		const char = text[index]!;

		// Copy a string literal through verbatim, escapes and all. This is the entire
		// reason for scanning rather than replacing.
		if (char === '"') {
			const start = index;
			index++;
			while (index < length) {
				if (text[index] === '\\') {
					index += 2;
					continue;
				}
				if (text[index] === '"') {
					index++;
					break;
				}
				index++;
			}
			out += text.slice(start, index);
			continue;
		}

		if (char === '-' && text.startsWith('-Infinity', index)) {
			out += '"-inf"';
			index += 9;
			changed = true;
			continue;
		}
		if (char === 'I' && text.startsWith('Infinity', index)) {
			out += '"inf"';
			index += 8;
			changed = true;
			continue;
		}
		if (char === 'N' && text.startsWith('NaN', index)) {
			out += '"nan"';
			index += 3;
			changed = true;
			continue;
		}

		out += char;
		index++;
	}

	return { text: out, changed };
}

/**
 * Whether a string is worth trying to parse as nested JSON.
 *
 * Used by the flattener to reach inside a double-encoded payload — the pseudo device keeps
 * `payload` as a JSON *string* and `parsed` as the decoded object, so a consumer charting
 * `payload` finds nothing at all. Checking the first character first avoids a throwing
 * `JSON.parse` on every string field in the file.
 */
export function looksLikeJsonObject(value: string): boolean {
	const trimmed = value.trimStart();
	return trimmed.startsWith('{') || trimmed.startsWith('[');
}
