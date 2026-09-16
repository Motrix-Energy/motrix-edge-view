import type { ApiClient, ApiResult } from './api-client.js';

/**
 * One endpoint, polled.
 *
 * Every dependency is injected so the whole thing runs in the node test project under fake
 * timers — cadence, backoff and the visibility pause are exactly the behaviours that are
 * impossible to assert on if they reach for globals.
 */
export interface PollerDeps {
	readonly setTimeout: (fn: () => void, ms: number) => unknown;
	readonly clearTimeout: (handle: unknown) => void;
	readonly now: () => number;
	readonly isHidden: () => boolean;
}

export interface PollOutcome<T> {
	readonly result: ApiResult<T>;
	readonly receivedAt: number;
	readonly consecutiveFailures: number;
}

/**
 * Widening retry delays.
 *
 * Applied as `max(interval, backoff)`, deliberately: backing a 60-second poller *off* to one
 * second is hammering relative to the rate the user chose. The consequence, stated so nobody
 * "fixes" it — at a 2s cadence the first two retries land at the normal rate and the delay
 * only starts widening from the third failure.
 */
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15_000, 30_000];

export class EndpointPoller<T> {
	private timer: unknown = null;
	private inFlight = false;
	private pendingRefresh = false;
	private stopped = false;
	private failures = 0;

	constructor(
		private readonly api: ApiClient,
		/**
		 * A fixed path, or a supplier called once per tick.
		 *
		 * The supplier form exists for a cursored endpoint, whose query string changes between
		 * polls. A union rather than supplier-only so every existing construction — and every
		 * test that passes a plain string — keeps compiling.
		 */
		private readonly path: string | (() => string),
		private intervalMs: number,
		private readonly onOutcome: (outcome: PollOutcome<T>) => void,
		private readonly deps: PollerDeps,
	) {}

	get consecutiveFailures(): number {
		return this.failures;
	}

	start(): void {
		if (this.stopped || this.inFlight || this.timer !== null) return;
		void this.tick();
	}

	setInterval(intervalMs: number): void {
		this.intervalMs = intervalMs;
		// Re-arm at the new rate rather than waiting out the old one, which for a 60s -> 1s
		// change would leave the user looking at a stalled chart for a minute.
		this.rearm(0);
	}

	/** Poll now. During a flight this is remembered rather than queued. */
	refreshNow(): void {
		if (this.stopped) return;
		if (this.inFlight) {
			this.pendingRefresh = true;
			return;
		}
		this.rearm(0);
	}

	pause(): void {
		this.clear();
	}

	/** Resume with an immediate poll, so the first thing on screen is current. */
	resume(): void {
		if (this.stopped) return;
		this.rearm(0);
	}

	stop(): void {
		this.stopped = true;
		this.clear();
	}

	private clear(): void {
		if (this.timer !== null) {
			this.deps.clearTimeout(this.timer);
			this.timer = null;
		}
	}

	private rearm(delayMs: number): void {
		this.clear();
		if (this.stopped) return;
		this.timer = this.deps.setTimeout(() => {
			this.timer = null;
			void this.tick();
		}, delayMs);
	}

	private async tick(): Promise<void> {
		if (this.stopped || this.inFlight) return;
		// Paused tabs stop polling entirely rather than being throttled behind our back —
		// see LiveFeed for why that is the honest choice.
		if (this.deps.isHidden()) return;

		this.inFlight = true;
		const before = this.failures;
		try {
			const path = typeof this.path === 'string' ? this.path : this.path();
			const result = await this.api.get<T>(path, { timeoutMs: Math.max(5000, this.intervalMs * 2) });
			if (this.stopped) return;

			this.failures = result.kind === 'ok' ? 0 : this.failures + 1;
			this.onOutcome({ result, receivedAt: this.deps.now(), consecutiveFailures: this.failures });
		} catch (error) {
			this.reportConsumerFailure(error, before);
		} finally {
			this.inFlight = false;
			// The next timer is armed ONLY here, in the completion handler. That makes "a
			// slow response stacks requests" structurally impossible rather than something
			// defended against — which is why this is a chained setTimeout and never a
			// setInterval.
			if (!this.stopped) {
				const refresh = this.pendingRefresh;
				this.pendingRefresh = false;
				this.rearm(refresh ? 0 : this.delay());
			}
		}
	}

	/**
	 * A consumer that threw is a poll that failed, exactly as much as a 500 is.
	 *
	 * Before this the `try` had only a `finally`: an exception out of `onOutcome` escaped as
	 * an unhandled rejection while `finally` re-armed the timer at full cadence with the
	 * failure counter untouched — so the backoff never engaged and the dataset chip went on
	 * reading "streaming, 0 failures" over a feed that had stopped ingesting. Reporting it as
	 * `malformed` puts it on the path an HTTP error already takes: the counter moves, the
	 * retries widen, and the UI says what is actually happening.
	 *
	 * Counted from `failuresBefore`, not from the counter as it stands: the success path above
	 * has already zeroed it on the strength of an HTTP 200 that the consumer then could not
	 * use. Resuming from zero every time would peg the streak at 1 forever — the backoff would
	 * never widen past its first step, and `LiveSource` warns on exactly the first failure of a
	 * streak, so an unbounded warning list is the other thing that would fall out of it.
	 */
	private reportConsumerFailure(error: unknown, failuresBefore: number): void {
		if (this.stopped) return;
		this.failures = failuresBefore + 1;
		try {
			this.onOutcome({
				result: { kind: 'malformed', message: String(error) },
				receivedAt: this.deps.now(),
				consecutiveFailures: this.failures,
			});
		} catch {
			// Nothing left to tell: the consumer that was to be told about the failure is the
			// thing that failed. The counter and the widened retry above are what still work,
			// and `finally` still re-arms — a poller must not die of a consumer's bug.
		}
	}

	private delay(): number {
		if (this.failures === 0) return this.intervalMs;
		return Math.max(this.intervalMs, BACKOFF_MS[Math.min(this.failures - 1, BACKOFF_MS.length - 1)]!);
	}
}
