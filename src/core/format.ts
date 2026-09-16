/**
 * Truncate for display.
 *
 * Called once per event at ingest, never per render. The prototype called
 * `JSON.stringify(event.data)` inside the timeline row renderer and then sliced the
 * result — which materialises the full string for a 4 KB P1 telegram on every visible row,
 * on every scroll frame. Slicing the raw cell instead costs the budget, not the payload:
 * the cell is already a string, and it is already JSON, so it reads perfectly well as a
 * preview.
 */
export function truncate(value: string, budget: number): string {
	if (value.length <= budget) return value;
	return value.slice(0, budget) + '…';
}

/**
 * Bytes for the load progress readout.
 *
 * The scale selection is here; the *number* is formatted by the caller through
 * `Intl.NumberFormat`, so a French user sees "1,5 MB" rather than "1.5 MB". The B/KB/MB
 * suffixes stay untranslated — they are symbols, and every locale here uses them.
 *
 * There used to be a `formatCount` beside this. It hand-rolled "1.2M" in English word
 * order and is now `compact()` in `i18n/translator.ts`, which `Intl` does correctly for
 * all four locales at zero bundle cost.
 */
export function formatBytes(bytes: number, format: (value: number) => string = String): string {
	if (bytes < 1024) return `${format(bytes)} B`;
	if (bytes < 1024 * 1024) return `${format(Math.round(bytes / 1024))} KB`;
	return `${format(Math.round((bytes / (1024 * 1024)) * 10) / 10)} MB`;
}

/**
 * A value for an axis tick or a tooltip.
 *
 * Significant digits rather than fixed decimals, because this app has no idea whether it
 * is showing 0.0004 m³ or 6000 W and both have to stay readable.
 */
export function formatValue(value: number): string {
	if (!Number.isFinite(value)) return '—';
	const magnitude = Math.abs(value);
	if (magnitude === 0) return '0';
	if (magnitude >= 1e6 || magnitude < 1e-3) return value.toExponential(2);
	if (magnitude >= 100) return value.toFixed(1);
	if (magnitude >= 1) return value.toFixed(2);
	return value.toPrecision(3);
}
