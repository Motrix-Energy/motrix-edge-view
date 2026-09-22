import type { ColumnStore } from '../core/column-store.js';
import type { FieldStats } from '../core/numeric.js';
import type { DatasetId, NormalisedEvent } from '../core/types.js';

/**
 * The seam that keeps the file path and the live path from diverging.
 *
 * **Push callbacks plus `close()`, deliberately not an async iterator.** Back-pressure is
 * the wrong model here: `for await` hands the pull rate to the consumer, and a live source
 * cannot honour that — the EMS keeps producing whether or not the UI drained. Honouring it
 * would mean either buffering unboundedly inside the source (duplicating the store's
 * retention policy, and making "raise retention to 4 hours" require tearing down the
 * subscription) or stalling the poll loop and silently skewing the sample cadence. Pushing
 * makes a source's contract "here is what happened, now", and leaves volume to the store,
 * in one place, for one reason.
 *
 * Three smaller reasons point the same way: 100k rows through an iterator is 100k
 * microtasks against roughly 200 chunk callbacks; PapaParse is already chunk-shaped, so an
 * iterator would need a queue on the *file* path too; and `close()` maps one-to-one onto
 * `AbortController.abort()` and `parser.abort()`, where `AsyncIterator.return()` is a
 * promise that must be awaited to be reliable — awkward from `disconnectedCallback`.
 */
export interface DataSource {
	readonly id: DatasetId;
	readonly kind: 'file' | 'live';
	/**
	 * False for an unbounded source.
	 *
	 * The single discriminator the rest of the app needs: retention and follow mode both
	 * key off it, and neither concept appears anywhere in this interface.
	 */
	readonly finite: boolean;
	readonly descriptor: SourceDescriptor;
	/** Idempotent. Begins producing into `sink` and returns immediately. */
	start(sink: SourceSink): void;
	/** Idempotent, synchronous, irreversible. Aborts any in-flight parse or fetch. */
	close(): void;
}

export type SourceDescriptor =
	| { readonly type: 'file'; readonly name: string; readonly bytes: number }
	| { readonly type: 'live'; readonly baseUrl: string; readonly intervalMs: number };

export interface SourceSink {
	/**
	 * A batch of events, ascending by `(t, seq)`.
	 *
	 * The source must not retain the array after the call — the store takes ownership.
	 */
	onBatch(events: NormalisedEvent[]): void;
	/**
	 * The field catalogue discovered during ingest: `actorKey` -> path -> stats.
	 *
	 * Delivered once a finite source completes, and refreshed as a live one learns new
	 * fields. It exists on the seam rather than being recomputed by the store because the
	 * source already walked every payload — and because `isChartable` is a *ratio* over a
	 * dataset, so a catalogue built from a half-loaded file would disagree with the same
	 * file loaded in one go.
	 */
	onFields(fields: ReadonlyMap<string, ReadonlyMap<string, FieldStats>>, columns: ColumnStore): void;
	onWarning(warning: SourceWarning): void;
	onStatus(status: SourceStatus): void;
}

export type WarningCode =
	| 'BAD_TIMESTAMP'
	| 'BAD_JSON'
	| 'MISSING_COLUMN'
	| 'UNKNOWN_SHAPE'
	| 'PAPAPARSE'
	| 'NON_MONOTONIC'
	| 'STRAY_ERA'
	| 'NAIVE_TIMESTAMPS'
	| 'HTTP'
	| 'DUPLICATE_SNAPSHOT'
	| 'TOO_MANY_SERIES'
	/**
	 * The EMS's decision sequence restarted, or records were lost before we read them.
	 *
	 * One code for both, because they are one fact to a reader — a hole in the decision
	 * history the viewer did not cause — and `WarningCode` is displayed as a token and
	 * asserted on by tests, so the vocabulary stays small on purpose.
	 */
	| 'DECISIONS_RESET'
	/**
	 * A dropped `config.json`, refused or read with reservations.
	 *
	 * A topology overlay is not a `DataSource` — it has no instant, so it produces no events —
	 * but it shares this vocabulary rather than forking it. A warning is a *UI* concept, not a
	 * source one: a parallel type would fork `i18n/warnings.ts`'s total Record, the four
	 * catalogues and the load-report renderer to say the same things twice.
	 */
	| 'CONFIG_SHAPE';

/**
 * Which message a warning carries — one level finer than `WarningCode`.
 *
 * `code` alone cannot select a sentence: `BAD_TIMESTAMP` covers both "empty" and
 * "unparseable", and `UNKNOWN_SHAPE` covers both "this is a control log" and "these columns
 * mean nothing to me". And `code` cannot simply be split, because it is *displayed* as a
 * token in the load report and asserted on by tests — it is the stable, greppable identity.
 *
 * This module owns the vocabulary; `src/i18n/warnings.ts` owns the text. Neither imports
 * the other's concerns.
 */
export type WarningDetail =
	| 'emptyTimestamp'
	| 'unparseableTimestamp'
	| 'badJson'
	| 'emptyColumn'
	| 'controlLog'
	| 'unknownColumns'
	| 'papaparse'
	| 'naiveTimestamps'
	| 'nonMonotonic'
	| 'strayEra'
	| 'httpError'
	| 'duplicateSnapshot'
	| 'seriesCap'
	| 'jsonReplay'
	| 'decisionsReset'
	| 'decisionsGap'
	| 'configInvalidJson'
	| 'configUnknownShape'
	| 'configTooLarge'
	| 'configDuplicateName'
	| 'configDanglingRef'
	| 'configVersionDrift'
	| 'configTruncated';

/**
 * Interpolation values for a warning's message.
 *
 * Structurally identical to `i18n/catalogue.ts`'s `Params` and duplicated on purpose: a
 * source must not import upward from `sources/` into `i18n/` for a type this small.
 */
export type WarningParams = Readonly<Record<string, string | number>>;

export interface SourceWarning {
	readonly code: WarningCode;
	/** 1-based data row, header excluded. Null when the warning is about the file as a whole. */
	readonly row: number | null;
	/**
	 * **A message identifier, not a sentence.** It used to be pre-rendered English, which
	 * meant a load report stayed in whatever language it was raised in for the rest of the
	 * session — including three ~40-word paragraphs.
	 */
	readonly detail: WarningDetail;
	readonly params?: WarningParams;
	/** The offending cell, truncated. Null when there isn't one. */
	readonly sample: string | null;
}

export type SourceStatus =
	/** Nothing started yet. */
	| { readonly phase: 'idle' }
	/** Bytes rather than a fraction, so the UI can say "42 MB of 108 MB". */
	| { readonly phase: 'loading'; readonly bytesDone: number; readonly bytesTotal: number | null }
	/** Live only. `consecutiveFailures` lets the chip say "retrying (3)" without owning any UI idea. */
	| { readonly phase: 'streaming'; readonly lastPollAt: number; readonly consecutiveFailures: number }
	/** Finite sources only. */
	| { readonly phase: 'complete'; readonly rows: number }
	/**
	 * `detail` is translatable; `message` is not.
	 *
	 * Engine text — `String(error)`, a PapaParse diagnostic — cannot be translated, and
	 * pretending otherwise means either an infinite catalogue or a lie. So the UI renders
	 * `detail` when there is one and passes `message` through verbatim when there is not.
	 */
	| {
			readonly phase: 'error';
			readonly message: string;
			readonly detail?: WarningDetail;
			/** Interpolation values for `detail`'s message. Omitting them renders the placeholders. */
			readonly params?: WarningParams;
			readonly retryable: boolean;
	  };
