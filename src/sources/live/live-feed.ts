import { nowMs } from '../../core/time.js';
import type { ApiClient } from './api-client.js';
import { checkDecisionsResponse, type DecisionsResponse, type DevicesResponse, type HealthResponse, type WorkersResponse } from './api-types.js';
import { EndpointPoller, type PollOutcome, type PollerDeps } from './poller.js';

export type Endpoint = 'health' | 'devices' | 'workers' | 'decisions';

export interface EndpointPayload {
	health: HealthResponse;
	devices: DevicesResponse;
	workers: WorkersResponse;
	decisions: DecisionsResponse;
}

/** How many decisions one poll may carry. The EMS clamps to its own capacity. */
const DECISIONS_PAGE = 500;

/**
 * How many back-to-back catch-up requests `has_more` may trigger before waiting out the
 * interval again. A bound, not a tuning knob: an EMS that always answers `has_more` would
 * otherwise pin the request loop at full speed forever.
 */
const MAX_CHASE = 10;

type Subscriber<E extends Endpoint> = {
	readonly intervalMs: number;
	readonly notify: (outcome: PollOutcome<EndpointPayload[E]>) => void;
};

const DEFAULT_DEPS: PollerDeps = {
	setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
	clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
	now: nowMs,
	isHidden: () => globalThis.document?.hidden === true,
};

/**
 * One scheduler for the whole app, shared by every consumer of the EMS API.
 *
 * Neither `LiveSource` nor the status page owns a poller: the feed does, it outlives both,
 * and it stops itself when its last subscriber leaves. That is what lets the status page
 * poll with **zero** live datasets loaded, and what stops a status page and a live dataset
 * from making two identical requests two seconds apart — the effective interval is the
 * minimum over subscribers, and one response feeds every reader.
 *
 * It matters more than it sounds: `/health` calls `get_devices()` on the EMS, which
 * deep-copies every device under a lock, to return twenty integers. There is no cheap
 * liveness endpoint, so every request the viewer does not make is real work the EMS does not
 * do.
 */
export class LiveFeed {
	private readonly pollers = new Map<Endpoint, EndpointPoller<unknown>>();
	private readonly subscribers = new Map<Endpoint, Set<Subscriber<Endpoint>>>();
	private readonly visibility: (() => void) | null = null;
	private pausedAt: number | null = null;
	private requestsInLastMinute: number[] = [];

	/**
	 * The decision cursor lives here, not in `LiveSource`.
	 *
	 * A cursored endpoint is not idempotent: advancing it is a property of the *request*, and
	 * one request feeds every subscriber. With the cursor in a subscriber, two live datasets
	 * would each advance it and each see half the decisions.
	 *
	 * -1 means unseeded — `?after=-1` clamps to 0 on the EMS side, i.e. "from the oldest still
	 * retained". `AppStore.probeLive` seeds it to the head at boot so a session starts from the
	 * present rather than backfilling.
	 */
	private decisionsCursor = -1;
	private decisionsEpoch: string | null = null;
	/** Latched once per app session: an EMS without the route is asked exactly once. */
	private decisionsUnavailable = false;
	private decisionsChase = 0;
	/** Set for one fan-out when the EMS's sequence identity changed. */
	private decisionsReset = false;

	constructor(
		private readonly api: ApiClient,
		private readonly deps: PollerDeps = DEFAULT_DEPS,
	) {
		// Seed from the CURRENT visibility, not from the first event. A tab that is already
		// hidden when the app boots never fires `visibilitychange`, so a feed that learned
		// its state only from the event would sit there not polling and not saying why —
		// which is exactly what a viewer opened in a background tab does.
		if (this.deps.isHidden()) this.pausedAt = this.deps.now();
		if (globalThis.document !== undefined) {
			this.visibility = () => this.onVisibilityChange();
			globalThis.document.addEventListener('visibilitychange', this.visibility);
		}
	}

	/** How long polling has been paused, in ms, or null when it is running. */
	pausedForMs(): number | null {
		return this.pausedAt === null ? null : this.deps.now() - this.pausedAt;
	}

	/** Requests issued in the last minute — shown on the status page, because only the user can judge it. */
	requestsPerMinute(): number {
		const cutoff = this.deps.now() - 60_000;
		this.requestsInLastMinute = this.requestsInLastMinute.filter((at) => at >= cutoff);
		return this.requestsInLastMinute.length;
	}

	/**
	 * Start streaming decisions from the EMS's current head rather than from its oldest record.
	 *
	 * Called by the boot probe, which learns the head from one `?after=-1&limit=0` request.
	 * Without it a live dataset connected an hour into a run would backfill the whole buffer:
	 * old decisions would arrive *after* the readings already collected, `appendAscending`
	 * would repair heavily enough to raise a NON_MONOTONIC line on every session, and retention
	 * — measured back from `tMax` — would delete most of them on arrival.
	 */
	seedDecisionsCursor(next: number): void {
		if (Number.isFinite(next)) this.decisionsCursor = next;
	}

	/**
	 * Stop asking for decisions, for the rest of this app session.
	 *
	 * An EMS predating `GET /decisions` answers 404 forever, and the viewer must degrade to
	 * exactly its old behaviour: no warning, no failure count, no retry.
	 */
	markDecisionsUnavailable(): void {
		this.decisionsUnavailable = true;
		this.pollers.get('decisions')?.stop();
		this.pollers.delete('decisions');
		this.subscribers.delete('decisions');
	}

	/** True once an EMS has answered 404/405/501 for the decisions route. */
	get decisionsSupported(): boolean {
		return !this.decisionsUnavailable;
	}

	/** Consumed by `LiveSource`: true for exactly one fan-out after the EMS's epoch changed. */
	takeDecisionsReset(): boolean {
		const reset = this.decisionsReset;
		this.decisionsReset = false;
		return reset;
	}

	subscribe<E extends Endpoint>(
		endpoint: E,
		intervalMs: number,
		notify: (outcome: PollOutcome<EndpointPayload[E]>) => void,
	): () => void {
		// A no-op unsubscribe rather than a poller: a second live dataset added after the first
		// learned the route is missing must not start asking again.
		if (endpoint === 'decisions' && this.decisionsUnavailable) return () => {};
		const entry = { intervalMs, notify } as Subscriber<Endpoint>;
		let set = this.subscribers.get(endpoint);
		if (set === undefined) {
			set = new Set();
			this.subscribers.set(endpoint, set);
		}
		set.add(entry);
		this.ensurePoller(endpoint);
		return () => {
			set!.delete(entry);
			if (set!.size === 0) {
				this.pollers.get(endpoint)?.stop();
				this.pollers.delete(endpoint);
				this.subscribers.delete(endpoint);
			} else {
				this.retune(endpoint);
			}
		};
	}

	refreshNow(endpoint?: Endpoint): void {
		if (endpoint === undefined) for (const poller of this.pollers.values()) poller.refreshNow();
		else this.pollers.get(endpoint)?.refreshNow();
	}

	close(): void {
		for (const poller of this.pollers.values()) poller.stop();
		this.pollers.clear();
		this.subscribers.clear();
		this.decisionsCursor = -1;
		this.decisionsEpoch = null;
		this.decisionsUnavailable = false;
		this.decisionsChase = 0;
		this.decisionsReset = false;
		if (this.visibility !== null) globalThis.document?.removeEventListener('visibilitychange', this.visibility);
	}

	private ensurePoller(endpoint: Endpoint): void {
		let poller = this.pollers.get(endpoint);
		if (poller === undefined) {
			poller = new EndpointPoller<unknown>(
				this.api,
				// The decisions path carries a cursor that moves between polls, so it is built
				// per tick rather than once at construction.
				endpoint === 'decisions'
					? () => `/decisions?after=${this.decisionsCursor}&limit=${DECISIONS_PAGE}`
					: `/${endpoint}`,
				this.effectiveInterval(endpoint),
				(outcome) => this.fanOut(endpoint, outcome),
				this.deps,
			);
			this.pollers.set(endpoint, poller);
			poller.start();
			return;
		}
		this.retune(endpoint);
		poller.refreshNow();
	}

	private retune(endpoint: Endpoint): void {
		this.pollers.get(endpoint)?.setInterval(this.effectiveInterval(endpoint));
	}

	private effectiveInterval(endpoint: Endpoint): number {
		let interval = Infinity;
		for (const subscriber of this.subscribers.get(endpoint) ?? []) {
			interval = Math.min(interval, subscriber.intervalMs);
		}
		return Number.isFinite(interval) ? interval : 5000;
	}

	/**
	 * One response, every subscriber — and a subscriber that throws takes only itself down.
	 *
	 * Sharing one poll between the status page and a live dataset means their failure modes
	 * were shared too: an exception out of the first subscriber used to skip every later one,
	 * so a page that rendered badly could stop a dataset ingesting, silently and in the order
	 * they happened to have subscribed.
	 *
	 * The first exception is re-thrown after everyone has been told, deliberately not
	 * swallowed. Swallowing would leave the poller re-arming at full cadence with its failure
	 * counter at zero — ingestion dead while the dataset chip reads "streaming". `tick`
	 * catches this and turns it into the same reported failure a 500 takes.
	 */
	private fanOut(endpoint: Endpoint, outcome: PollOutcome<unknown>): void {
		this.requestsInLastMinute.push(outcome.receivedAt);
		if (endpoint === 'decisions') this.advanceDecisions(outcome);
		let thrown: { readonly error: unknown } | null = null;
		for (const subscriber of [...(this.subscribers.get(endpoint) ?? [])]) {
			try {
				subscriber.notify(outcome as PollOutcome<EndpointPayload[Endpoint]>);
			} catch (error) {
				// Boxed rather than compared against a sentinel: a subscriber may well throw
				// `undefined`, and "did anything throw" must not depend on what it threw.
				thrown ??= { error };
			}
		}
		if (thrown !== null) throw thrown.error;
	}

	/**
	 * Advance the decision cursor from one response, before any subscriber sees it.
	 *
	 * The only place the transport layer looks inside a payload, and it has to: the cursor is
	 * per-request state, so no subscriber can own it. It goes through the same runtime guard the
	 * subscriber will use, so a malformed body cannot move the cursor past records nobody read.
	 */
	private advanceDecisions(outcome: PollOutcome<unknown>): void {
		if (outcome.result.kind !== 'ok') return;
		const checked = checkDecisionsResponse(outcome.result.value);
		if (checked === null) return;
		const page = checked.value;

		if (typeof page.epoch === 'string' && page.epoch !== this.decisionsEpoch) {
			// First response of the session sets the baseline silently; a later change is a
			// restart, and the cursor we hold refers to a sequence that no longer exists.
			if (this.decisionsEpoch !== null) {
				this.decisionsReset = true;
				this.decisionsCursor = -1;
			}
			this.decisionsEpoch = page.epoch;
		}

		this.decisionsCursor = page.next_cursor;

		if (page.has_more && this.decisionsChase < MAX_CHASE) {
			this.decisionsChase++;
			this.refreshNow('decisions');
		} else {
			this.decisionsChase = 0;
		}
	}

	/**
	 * Hidden tabs pause, and resume with an immediate poll.
	 *
	 * Continuing would be a **lie about the sample rate**. Browsers throttle background
	 * timers to roughly one per minute, so a 2s cadence silently becomes ~60s — and because
	 * every sample is still stamped and charted, the user comes back to a plausible-looking
	 * series whose density dropped thirtyfold with nothing on screen saying so. Dedupe then
	 * renders the sparse stretch as "the device went quiet", which is the opposite of what
	 * happened.
	 *
	 * Pausing costs nothing throttling would not also cost: `/devices` is a snapshot with no
	 * `?since=` and no history, so whatever happened between two polls is unrecoverable
	 * either way. There is no catch-up being given up — only a gap that is now attributable.
	 */
	private onVisibilityChange(): void {
		if (this.deps.isHidden()) {
			this.pausedAt = this.deps.now();
			for (const poller of this.pollers.values()) poller.pause();
			return;
		}
		this.pausedAt = null;
		for (const poller of this.pollers.values()) poller.resume();
	}
}
