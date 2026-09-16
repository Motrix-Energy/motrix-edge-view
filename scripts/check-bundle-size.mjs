#!/usr/bin/env node
/**
 * Guards the one promise this build makes: `dist/index.html` is a single, self-contained
 * file you can double-click.
 *
 * vite-plugin-singlefile stops inlining *silently* once an asset exceeds
 * `assetsInlineLimit`, and the failure mode is a stray file in dist/ plus a viewer that
 * 404s the moment it is opened offline — which is the only way anyone will open it. So
 * this asserts the shape of the output rather than trusting the plugin.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const MAX_BYTES = 900 * 1024;

function walk(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		return entry.isDirectory() ? walk(path) : [path];
	});
}

const failures = [];

let files;
try {
	files = walk(DIST);
} catch {
	console.error(`${DIST}/ does not exist — run \`npm run build\` first.`);
	process.exit(1);
}

if (files.length !== 1 || !files[0].endsWith('index.html')) {
	failures.push(
		`expected exactly one file (dist/index.html), found ${files.length}:\n  ` +
			files.join('\n  ') +
			'\n  An emitted asset means something was not inlined.',
	);
}

const htmlPath = join(DIST, 'index.html');
const bytes = statSync(htmlPath).size;
if (bytes > MAX_BYTES) {
	failures.push(`dist/index.html is ${(bytes / 1024).toFixed(0)} KB, over the ${MAX_BYTES / 1024} KB ceiling.`);
}

// Anything that would make the page reach off-disk when opened from file://.
//
// Checked against the HTML *tags* rather than the whole file: the inlined bundle is
// minified JavaScript, and a substring match over it flags any string literal that happens
// to contain the word — which is a check that cries wolf and then gets deleted.
const html = readFileSync(htmlPath, 'utf8');
const tags = html.match(/<(?:link|script|img|iframe|source)\b[^>]*>/gi) ?? [];
const forbidden = [
	[/rel=["']?modulepreload/i, '<link rel="modulepreload"> — a separate request'],
	[/rel=["']?stylesheet[^>]*href=["'](?!data:)/i, 'an external stylesheet'],
	[/\ssrc=["'](?!data:)/i, 'an external src'],
	[/["'](?:\.\/)?assets\//i, 'a reference into assets/'],
];
for (const tag of tags) {
	for (const [pattern, what] of forbidden) {
		if (pattern.test(tag)) failures.push(`dist/index.html contains ${what}: ${tag.slice(0, 120)}`);
	}
	// `crossorigin` only means anything on a tag that actually fetches something. On the
	// inlined <script type="module" crossorigin> that vite-plugin-singlefile emits it is
	// inert, and flagging it would make this check something people learn to ignore.
	if (/\bcrossorigin\b/i.test(tag) && /\s(?:src|href)=/i.test(tag)) {
		failures.push(`dist/index.html contains a fetching tag with crossorigin: ${tag.slice(0, 120)}`);
	}
}

if (failures.length > 0) {
	console.error('Single-file build check FAILED:\n' + failures.map((f) => `  - ${f}`).join('\n'));
	process.exit(1);
}

console.log(`dist/index.html — one file, ${(bytes / 1024).toFixed(0)} KB, no external references.`);
