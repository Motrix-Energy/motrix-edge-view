/** Identifier for one loaded dataset. Datasets are a *list*, never a current-source switch. */
export type DatasetId = string;

/**
 * What a normalised event is.
 *
 * `reading` and `decision` come from either source; `worker` and `health` only ever come
 * from the live API. They share one stream so that a connector going down is a timeline
 * entry sitting beside the readings it stopped producing, for free.
 *
 * `input` only ever comes from a replay file. It is what the pseudo connector **published**,
 * where `reading` is what the EMS **stored** — and keeping them apart is the whole point:
 * `docs/storage-format.md` §7 says no row is written for a payload a device rejected, so an
 * input with no reading beside it is the only way to see one. Folding them into `reading`
 * would union their paths under one actor key and collapse exactly that distinction.
 */
export type EventKind = 'reading' | 'decision' | 'worker' | 'health' | 'input';

/**
 * The single shape every source produces and every consumer reads.
 *
 * Deliberately *not* carrying the parsed payload. At 100k events the parsed objects
 * dominate memory, and after ingest nothing needs them: the columns were already built
 * during the flattening pass, and the timeline only needs a short preview until the user
 * expands a row — at which point `raw` is re-parsed once and cached. Text search runs over
 * `raw` for the same reason.
 */
export interface NormalisedEvent {
	/** Epoch milliseconds as a float. The fraction preserves the EMS's microseconds. */
	readonly t: number;
	/**
	 * Position within its source, assigned at ingest.
	 *
	 * The tiebreak for equal timestamps, which are the norm rather than the exception: an
	 * EMS timestep writes every device at the same instant, and the microsecond fraction
	 * collides for the wall-clock rows. Without it the timeline's order would be whatever
	 * the sort happened to do.
	 */
	readonly seq: number;
	readonly kind: EventKind;
	/** Device name, algorithm name, or worker name. */
	readonly source: string;
	/**
	 * For a decision, the device it was sent to. For a replay input, the topic it was
	 * published on. Null otherwise.
	 */
	readonly target: string | null;
	/** The payload cell verbatim — `data_json`, `command`, or a serialised API snapshot. */
	readonly raw: string;
	/** One-line preview, budgeted at ingest. Never `JSON.stringify(...).slice()`. */
	readonly preview: string;
	/** True when the source timestamp carried no UTC offset, so its zone was assumed. */
	readonly naive: boolean;
}

/** A flattened leaf discovered in a payload. */
export interface FlatField {
	readonly path: string;
	readonly value: unknown;
	/** A sibling `unit` key, when the payload volunteered one (P1 does). */
	readonly unit?: string;
}

export type FieldKey = string;

/** How a dataset's naive timestamps should be interpreted. */
export type NaiveZone = 'local' | 'utc' | number;
