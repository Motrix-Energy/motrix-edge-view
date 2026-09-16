import Papa from 'papaparse';

import { ColumnStore } from '../../core/column-store.js';
import { truncate } from '../../core/format.js';
import { Ingestor, type IngestOptions, type IngestSummary } from '../../core/ingest.js';
import type { DatasetId, NormalisedEvent } from '../../core/types.js';
import type { DataSource, SourceDescriptor, SourceSink, SourceWarning } from '../data-source.js';
import { detectShape, looksLikeControlLog, looksLikeJsonReplay, type CsvShape } from './csv-schema.js';
import { readText } from './read-text.js';

/**
 * PapaParse config shared by both entry points.
 *
 * `worker: false` is not a default being restated — it is a constraint. The prototype
 * enabled the worker above 5 MB, and blob-URL workers are blocked from an opaque `file://`
 * origin, so the deliverable would fail for exactly the audience it is built for.
 *
 * `dynamicTyping` stays off: every cell arrives as a string and every real number comes
 * from parsing the payload column. Letting Papa guess types would give us a second,
 * different numeric rule alongside `core/numeric.ts`.
 */
const PAPA_BASE = {
	header: true,
	skipEmptyLines: true,
	dynamicTyping: false,
	worker: false,
} as const;

export interface CsvParseResult {
	readonly shape: CsvShape | null;
	readonly events: readonly NormalisedEvent[];
	readonly summary: IngestSummary;
	readonly warnings: readonly SourceWarning[];
	readonly fields: Ingestor['fields'];
	/** Every chartable series, built in the same walk that discovered the fields. */
	readonly columns: ColumnStore;
}

/**
 * Parse CSV **text** into events. Pure, synchronous, and the whole of the logic.
 *
 * Kept separate from the `DataSource` below so that everything worth testing — CRLF, quote
 * doubling, a field containing a raw newline, a lazily written header, ragged rows, both
 * timestamp shapes — is testable in node against the real fixture bytes, with no DOM and no
 * FileReader in the way.
 */
export function parseCsvText(text: string, options: IngestOptions & { shape?: CsvShape } = {}): CsvParseResult {
	const warnings: SourceWarning[] = [];
	const collect = (warning: SourceWarning) => {
		warnings.push(warning);
		options.onWarning?.(warning);
	};

	// Same bound on both halves of the one walk, so the catalogue and the columns cannot end up
	// disagreeing about which fields this dataset knows.
	const columns = new ColumnStore(options.maxSeries);
	const ingestor = new Ingestor({
		...options,
		onWarning: collect,
		onSample: (kind, actor, path, t, value, unit) => columns.sample(kind, actor, path, t, value, unit),
	});

	if (text.trim() === '') {
		return { shape: null, events: [], summary: ingestor.finish(), warnings, fields: ingestor.fields, columns };
	}

	const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n')).replace(/\r$/, '');
	if (options.shape === undefined && looksLikeControlLog(firstLine)) {
		collect({
			code: 'UNKNOWN_SHAPE',
			row: null,
			detail: 'controlLog',
			sample: truncate(firstLine, 80),
		});
		return { shape: null, events: [], summary: ingestor.finish(), warnings, fields: ingestor.fields, columns };
	}
	if (options.shape === undefined && looksLikeJsonReplay(text)) {
		// Named rather than left to the header sniff, which would report "Unrecognised
		// columns: (none)" about a file the EMS accepts perfectly well.
		collect({
			code: 'UNKNOWN_SHAPE',
			row: null,
			detail: 'jsonReplay',
			sample: truncate(firstLine, 80),
		});
		return { shape: null, events: [], summary: ingestor.finish(), warnings, fields: ingestor.fields, columns };
	}

	const parsed = Papa.parse<Record<string, string | null>>(text, PAPA_BASE);

	// The prototype dropped Papa's own diagnostics entirely. They are the only signal for a
	// ragged row, which a process killed mid-write leaves behind.
	for (const error of parsed.errors.slice(0, 20)) {
		collect({
			code: 'PAPAPARSE',
			row: typeof error.row === 'number' ? error.row + 1 : null,
			detail: 'papaparse',
			params: { message: error.message },
			sample: null,
		});
	}

	const header = parsed.meta.fields ?? [];
	const shape = options.shape ?? detectShape(header);
	if (shape === null) {
		collect({
			code: 'UNKNOWN_SHAPE',
			row: null,
			detail: 'unknownColumns',
			params: { columns: header.join(', ') || '(none)' },
			sample: null,
		});
		return { shape: null, events: [], summary: ingestor.finish(), warnings, fields: ingestor.fields, columns };
	}

	// A BOM survives into the first field name; strip it once rather than at every lookup.
	const timeColumn = resolveColumn(header, shape.timeColumn);
	const actorColumn = resolveColumn(header, shape.actorColumn);
	const targetColumn = shape.targetColumn === null ? null : resolveColumn(header, shape.targetColumn);
	const payloadColumn = resolveColumn(header, shape.payloadColumn);

	let row = 0;
	for (const record of parsed.data) {
		row++;
		const actor = record[actorColumn];
		if (actor === null || actor === undefined || actor === '') {
			collect({
				code: 'MISSING_COLUMN',
				row,
				detail: 'emptyColumn',
				params: { column: shape.actorColumn },
				sample: null,
			});
			continue;
		}
		const target = targetColumn === null ? null : (record[targetColumn] ?? null);
		// The payload cell is passed through untouched — never trimmed. `connectors/pseudo.py`
		// deliberately does not trim it either, because a P1 telegram loses the CRLF that
		// terminates it and stops parsing on the EMS side too.
		ingestor.add(
			shape.kind,
			actor,
			target,
			record[timeColumn],
			record[payloadColumn],
			row,
			shape.targetQualifiesPath ? (target ?? '') : '',
		);
	}

	const summary = ingestor.finish();
	reportSummary(summary, collect);
	// Sort and derive gap thresholds once, now that every sample has arrived.
	columns.seal();
	return { shape, events: ingestor.events, summary, warnings, fields: ingestor.fields, columns };
}

function resolveColumn(header: readonly string[], name: string): string {
	// PapaParse keys rows by the header text verbatim, BOM included, so `record["timestamp"]`
	// misses on a file Excel has been through. Match on the stripped form, return the real key.
	return header.find((candidate) => candidate.replace(/^\uFEFF/, '').trim() === name) ?? name;
}

function reportSummary(summary: IngestSummary, collect: (warning: SourceWarning) => void): void {
	if (summary.naive > 0) {
		collect({
			code: 'NAIVE_TIMESTAMPS',
			row: null,
			detail: 'naiveTimestamps',
			params: { n: summary.naive },
			sample: null,
		});
	}
	if (summary.inversions > 0) {
		collect({
			code: 'NON_MONOTONIC',
			row: null,
			detail: 'nonMonotonic',
			params: { n: summary.inversions },
			sample: null,
		});
	}
	if (summary.strayEra !== null) {
		collect({
			code: 'STRAY_ERA',
			row: null,
			detail: 'strayEra',
			params: { n: summary.strayEra.count },
			sample: null,
		});
	}
}

/**
 * A `DataSource` over a dropped or picked file.
 *
 * Reads in chunks with a yield between them so a 100 MB file does not freeze the tab, and
 * reports byte progress rather than a spinner. Deliberately thin: everything interesting
 * happens in `parseCsvText`, which is testable without a browser.
 */
export class CsvFileSource implements DataSource {
	readonly kind = 'file' as const;
	readonly finite = true;
	readonly descriptor: SourceDescriptor;

	private aborted = false;
	private started = false;

	constructor(
		readonly id: DatasetId,
		private readonly file: File,
		private readonly options: IngestOptions = {},
	) {
		this.descriptor = { type: 'file', name: file.name, bytes: file.size };
	}

	start(sink: SourceSink): void {
		if (this.started) return;
		this.started = true;
		void this.run(sink);
	}

	close(): void {
		this.aborted = true;
	}

	private async run(sink: SourceSink): Promise<void> {
		sink.onStatus({ phase: 'loading', bytesDone: 0, bytesTotal: this.file.size });
		try {
			// Read the whole file as text before parsing. Papa's own streaming mode needs
			// FileReader and a worker to be worth it, and the worker is unavailable here —
			// so the honest trade is one read plus a chunked parse with progress.
			const text = await readText(this.file);
			if (this.aborted) return;
			sink.onStatus({ phase: 'loading', bytesDone: this.file.size, bytesTotal: this.file.size });
			await yieldToBrowser();
			if (this.aborted) return;

			const result = parseCsvText(text, this.options);
			if (this.aborted) return;

			for (const warning of result.warnings) sink.onWarning(warning);
			if (result.shape === null) {
				// `detail` is what renders; `message` is the fallback for statuses that have no
				// detail, and is deliberately not a sentence so nobody mistakes it for one. The
				// params come from the warning parseCsvText already raised, rather than being
				// recomputed here from a header this scope no longer holds.
				const shape = result.warnings.find((warning) => warning.detail === 'unknownColumns');
				sink.onStatus({
					phase: 'error',
					message: 'unrecognised csv shape',
					detail: 'unknownColumns',
					params: shape?.params,
					retryable: false,
				});
				return;
			}

			sink.onFields(result.fields, result.columns);

			// Batched so a very large file does not hand the store one enormous array and
			// block layout for the length of the first render.
			const events = [...result.events].sort((a, b) => a.t - b.t || a.seq - b.seq);
			for (let i = 0; i < events.length; i += 5000) {
				if (this.aborted) return;
				sink.onBatch(events.slice(i, i + 5000));
				await yieldToBrowser();
			}
			sink.onStatus({ phase: 'complete', rows: events.length });
		} catch (error) {
			if (this.aborted) return;
			sink.onStatus({ phase: 'error', message: String(error), retryable: false });
		}
	}
}

function yieldToBrowser(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}
