#!/usr/bin/env node
/**
 * Re-vendor the golden fixture from the EMS repository into test/fixtures/.
 *
 *     node scripts/update-fixtures.mjs                    # from ../motrix-edge
 *     EDGE_REPO=/path/to/motrix-edge node scripts/update-fixtures.mjs
 *
 * That fixture *is* the interface between the two repositories: the EMS produces it by
 * running itself, and this app tests against the same bytes. Copying rather than
 * submoduling is deliberate — the version boundary is the fixture and a pinned image tag,
 * not a git pointer.
 *
 * Every file is checked against the EMS's own MANIFEST.json before it lands, so a
 * half-copied or hand-edited fixture fails here rather than as a mysterious test failure
 * three commits later. Note what that check is and is not: the manifest supplies both the
 * bytes and the digest, so it proves the copy is internally consistent, never that the
 * source is trustworthy. The containment check below is what handles the rest — a manifest
 * key is a path, and a path from outside this repository is chosen by whoever wrote it.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

const EDGE_REPO = resolve(process.env.EDGE_REPO ?? '../motrix-edge');
const SRC = join(EDGE_REPO, 'examples');
const DEST = resolve('test/fixtures');

/**
 * Where a manifest key is allowed to land, or null.
 *
 * `join(DEST, name)` follows `..` like any other path, and `test/` one level up is a
 * directory vitest executes — setup.ts is the configured setupFile, and any *.test.ts is
 * picked up. A key of `../setup.ts` was therefore a write into the next `npm test`.
 */
function destinationFor(name) {
	if (typeof name !== 'string' || name === '') return null;
	const to = resolve(DEST, name);
	if (to !== DEST && !to.startsWith(DEST + sep)) return null;
	return to;
}

let manifest;
try {
	manifest = JSON.parse(readFileSync(join(SRC, 'MANIFEST.json'), 'utf8'));
} catch (error) {
	console.error(
		`Could not read ${join(SRC, 'MANIFEST.json')}.\n` +
			`Set EDGE_REPO to a motrix-edge checkout, and run \`python examples/generate.py\` there first.\n` +
			String(error),
	);
	process.exit(1);
}

const problems = [];
for (const [name, digest] of Object.entries(manifest.files)) {
	const to = destinationFor(name);
	if (to === null) {
		problems.push(`${name} is not a path inside test/fixtures — refusing to copy it`);
		continue;
	}
	const from = join(SRC, name);
	let bytes;
	try {
		bytes = readFileSync(from);
	} catch {
		problems.push(`${name} is missing from ${SRC}`);
		continue;
	}
	const actual = createHash('sha256').update(bytes).digest('hex');
	if (actual !== digest) {
		problems.push(`${name} does not match the EMS MANIFEST.json — regenerate it there first`);
		continue;
	}
	mkdirSync(dirname(to), { recursive: true });
	copyFileSync(from, to);
}

// The edge-case tier is authored rather than generated, so it carries no checksum. Copy it
// anyway: it is half the reason this app can claim to survive a real site's files.
//
// auto_toggle/config.json rides in the same tier for the same reason: it is a committed,
// stable *input* to the golden run rather than generator output, so the EMS's MANIFEST.json
// does not checksum it. The topology overlay reads it, so it travels with the run it describes.
for (const name of [
	'auto_toggle/config.json',
	'edge_cases/device_data.csv',
	'edge_cases/algorithm_decisions.csv',
	'edge_cases/device_data.empty.csv',
	'edge_cases/device_data.headers_only.csv',
	'edge_cases/device_data.bom.csv',
	'edge_cases/device_data.unterminated_quote.csv',
	'edge_cases/README.md',
]) {
	const to = join(DEST, name);
	mkdirSync(dirname(to), { recursive: true });
	try {
		copyFileSync(join(SRC, name), to);
	} catch {
		problems.push(`${name} is missing from ${SRC}`);
	}
}

if (problems.length > 0) {
	console.error('Fixture update FAILED:\n' + problems.map((p) => `  - ${p}`).join('\n'));
	process.exit(1);
}

writeFileSync(join(DEST, 'MANIFEST.json'), readFileSync(join(SRC, 'MANIFEST.json')));

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (pkg.motrixStorageFormat !== manifest.storage_format_version) {
	console.warn(
		`\nStorage format moved: package.json says ${pkg.motrixStorageFormat}, the EMS says ` +
			`${manifest.storage_format_version}.\nRead the EMS's docs/storage-format.md, adapt the ` +
			`parsers, then update "motrixStorageFormat" in package.json.`,
	);
}

console.log(`Vendored ${Object.keys(manifest.files).length} generated + 7 authored fixtures from ${SRC}`);
