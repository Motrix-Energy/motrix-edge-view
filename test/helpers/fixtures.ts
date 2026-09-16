import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const FIXTURES = resolve('test/fixtures');

export interface Manifest {
	storage_format_version: string;
	files: Record<string, string>;
}

export const manifest: Manifest = JSON.parse(readFileSync(join(FIXTURES, 'MANIFEST.json'), 'utf8'));

/**
 * Read a fixture as text, **preserving CRLF**.
 *
 * `readFileSync(path, 'utf8')` already does; the point of routing every read through here
 * is that nothing in the suite is ever tempted to normalise line endings on the way in.
 * The EMS writes CRLF, a quoted field can contain a raw CRLF, and a parser that only ever
 * sees LF in its tests is a parser that has not been tested.
 */
export function readFixture(name: string): string {
	return readFileSync(join(FIXTURES, name), 'utf8');
}

/** Read a fixture as bytes, for assertions about the dialect itself. */
export function readFixtureBytes(name: string): Buffer {
	return readFileSync(join(FIXTURES, name));
}
