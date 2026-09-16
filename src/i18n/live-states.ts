import type { EventKind } from '../core/types.js';
import type { HealthResponse, WorkerState } from '../sources/live/api-types.js';
import type { MessageKey } from './catalogue.js';
import { t } from './translator.js';

/** The `/health` status union, named so the `Record` below can be keyed on it. */
type HealthStatus = HealthResponse['status'];

/**
 * `HealthResponse['status']` -> message key.
 *
 * A `Record` rather than a `live.status.${status}` template, so adding a status without a
 * message is a **typecheck failure** rather than a `TypeError` thrown out of a Lit render —
 * a key the catalogue does not hold arrives at `t()` as `undefined`, and a render that
 * throws commits no DOM at all, on this poll and on every one after it.
 */
export const HEALTH_STATUS_KEYS: Record<HealthStatus, MessageKey> = {
	ok: 'live.status.ok',
	degraded: 'live.status.degraded',
	down: 'live.status.down',
};

/** `ApiWorker['state']` -> message key. Same reasoning, same failure mode. */
export const WORKER_STATE_KEYS: Record<WorkerState, MessageKey> = {
	running: 'live.workers.state.running',
	finished: 'live.workers.state.finished',
	down: 'live.workers.state.down',
	lost: 'live.workers.state.lost',
};

/**
 * `EventKind` -> message key. Same `Record`, a different reason.
 *
 * The two tables above map strings off the wire and must be partial. This one maps a union
 * this repository mints itself in `sources/file/csv-schema.ts` and `sources/live/`, so it is
 * total — and it is here anyway, because a `kind.${kind}` template is the same construct
 * that made the other two throw. With this table there is no `as MessageKey` left in `src/`,
 * which is what makes "grep says the key is unused" a true statement rather than a trap: a
 * catalogue key is now dead only if nothing names it as a literal.
 */
export const EVENT_KIND_KEYS: Record<EventKind, MessageKey> = {
	reading: 'kind.reading',
	decision: 'kind.decision',
	worker: 'kind.worker',
	health: 'kind.health',
	input: 'kind.input',
};

/**
 * What an unrecognised value renders as.
 *
 * Deliberately outside the `Record`s: these are not states the EMS declares, they are what
 * this viewer says when something else answers. The runtime guards in
 * `sources/live/api-types.ts` are liberal on purpose and check only that `status` is a
 * string, so the unions above are a statement about today's EMS, never about the wire.
 */
export const HEALTH_STATUS_UNKNOWN: MessageKey = 'live.status.unknown';
export const WORKER_STATE_UNKNOWN: MessageKey = 'live.workers.state.unknown';

/**
 * Message key for a value off the wire, or `undefined` when the table does not hold it.
 *
 * `undefined` rather than the fallback key so the caller can put the raw value on screen
 * beside the fallback label — as escaped text, never as part of a key. An operator reading
 * "unknown" and nothing else learns less than the EMS actually told us.
 *
 * `Object.hasOwn`, not a bare index: the table's prototype answers too, so `['toString']`
 * hands back a *function*, and giving that to `t()` is the same crash by a longer route.
 * That is the whole mechanism, so it lives once rather than once per union.
 */
export function labelKey<K extends string>(table: Record<K, MessageKey>, raw: string): MessageKey | undefined {
	if (!Object.hasOwn(table, raw)) return undefined;
	return table[raw as K];
}

/**
 * The translated label for an event kind, falling back to the raw value.
 *
 * Rendered here rather than at the call site for the same reason `warningText` is: the
 * caller holds a `string` — `splitActorKey` casts one out of a composed map key — and the
 * fallback is what keeps a kind that is somehow not in the table on screen instead of
 * throwing out of a render.
 */
export function kindLabel(kind: string): string {
	const key = labelKey(EVENT_KIND_KEYS, kind);
	return key === undefined ? kind : t(key);
}
