/**
 * Read a Blob as UTF-8 text.
 *
 * `Blob.text()` is the direct route and is used when it exists. The FileReader fallback is
 * not defensive padding: jsdom's File does not implement `text()` at all, so without it every
 * component test fails with a `TypeError` that surfaces as "could not load this file" — and
 * older Safari is in the same position.
 *
 * Extracted from `csv-source.ts` so the config path inherits the fallback rather than growing
 * a second copy of it that nobody remembers to keep in step.
 */
export async function readText(blob: Blob): Promise<string> {
	if (typeof blob.text === 'function') return blob.text();
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result ?? ''));
		reader.onerror = () => reject(reader.error ?? new Error('could not read the file'));
		reader.readAsText(blob, 'utf-8');
	});
}
