import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FIXTURES, manifest, readFixture } from './helpers/fixtures.js';

/**
 * The vendored copy of the EMS's `examples/` is the interface between the two
 * repositories. These assertions exist so that "the EMS changed its output" is a failure
 * *here*, with a message naming what to do, rather than a viewer that quietly stops
 * parsing at a user's desk.
 */
describe('vendored fixtures', () => {
	it('every generated file matches the EMS manifest', () => {
		for (const [name, digest] of Object.entries(manifest.files)) {
			const actual = createHash('sha256').update(readFileSync(join(FIXTURES, name))).digest('hex');
			expect(actual, `${name} drifted — run \`npm run fixtures:update\``).toBe(digest);
		}
	});

	it('the storage format version matches what this app was written against', () => {
		const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
		expect(
			manifest.storage_format_version,
			"the EMS bumped its storage format. Read its docs/storage-format.md, adapt the parsers, " +
				'then update "motrixStorageFormat" in package.json.',
		).toBe(pkg.motrixStorageFormat);
	});

	it('the readings fixture really carries both timestamp shapes', () => {
		// The property the whole of core/time.ts exists for. If a future fixture loses it,
		// the timestamp tests would still pass while testing nothing interesting.
		const text = readFixture('auto_toggle/expected/device_data.csv');
		expect(text).toMatch(/,2024-01-15T10:00:00,|^2024-01-15T10:00:00,/m);
		expect(text).toMatch(/2024-03-31T\d\d:\d\d:\d\d\+0[12]:00/);
	});

	it('the readings fixture is CRLF-terminated', () => {
		const bytes = readFileSync(join(FIXTURES, 'auto_toggle/expected/device_data.csv'));
		expect(bytes.includes(Buffer.from('\r\n'))).toBe(true);
	});
});
