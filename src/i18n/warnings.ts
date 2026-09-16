import type { SourceWarning, WarningDetail, WarningParams } from '../sources/data-source.js';
import type { MessageKey, PluralKey } from './catalogue.js';
import { plural, t } from './translator.js';

/**
 * `WarningDetail` -> message key.
 *
 * A `Record` rather than a switch, so adding a detail without a message is a **typecheck
 * failure** rather than a blank line in the load report — which is precisely the failure
 * mode the load report exists to prevent.
 */
const WARNING_KEYS: Record<WarningDetail, MessageKey> = {
	emptyTimestamp: 'warning.emptyTimestamp',
	unparseableTimestamp: 'warning.unparseableTimestamp',
	badJson: 'warning.badJson',
	emptyColumn: 'warning.emptyColumn',
	controlLog: 'warning.controlLog',
	unknownColumns: 'warning.unknownColumns',
	papaparse: 'warning.papaparse',
	naiveTimestamps: 'warning.naiveTimestamps',
	nonMonotonic: 'warning.nonMonotonic',
	strayEra: 'warning.strayEra',
	httpError: 'warning.httpError',
	duplicateSnapshot: 'warning.duplicateSnapshot',
	seriesCap: 'warning.seriesCap',
	jsonReplay: 'warning.jsonReplay',
	configInvalidJson: 'warning.configInvalidJson',
	configUnknownShape: 'warning.configUnknownShape',
	configTooLarge: 'warning.configTooLarge',
	configDuplicateName: 'warning.configDuplicateName',
	configDanglingRef: 'warning.configDanglingRef',
	configTruncated: 'warning.configTruncated',
	decisionsReset: 'warning.decisionsReset',
	decisionsGap: 'warning.decisionsGap',
};

/**
 * Details whose message varies with `params.n`.
 *
 * `configTruncated` is deliberately absent: its `{n}` is the *cap*, a fixed bound, not a count
 * of anything — so it is one sentence in every locale and pluralising it would be inventing
 * agreement with a number that never varies.
 */
const COUNTED = new Set<WarningDetail>(['naiveTimestamps', 'nonMonotonic', 'strayEra', 'decisionsGap']);

/**
 * Render the message for one warning detail, in the active locale.
 *
 * Takes the detail and its params rather than a whole `SourceWarning`, because the other
 * caller does not have one. An error *status* carries the same two fields and nothing else
 * this function reads, and the way it used to get here was by fabricating a warning with an
 * invented `code`, a null `row` and a null `sample` — which dropped `params` on the floor
 * and reported `Unrecognised columns: {columns}` to the user, placeholder and all.
 */
export function detailText(detail: WarningDetail, params?: WarningParams): string {
	const key = WARNING_KEYS[detail];
	if (COUNTED.has(detail)) return plural(key as PluralKey, Number(params?.n ?? 0), params);
	return t(key, params);
}

/** Render one warning in the active locale. */
export function warningText(warning: SourceWarning): string {
	return detailText(warning.detail, warning.params);
}
