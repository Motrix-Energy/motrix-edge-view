/**
 * A small typed observable store with selector subscriptions.
 *
 * Chosen over the alternatives on purpose:
 *
 *  - **Signals** (`@lit-labs/signals`) are labs-stage, and fine-grained reactivity solves a
 *    problem this app does not have. The expensive work here is not "which DOM node
 *    updates" — it is "recompute an aligned, downsampled matrix", which is coarse-grained
 *    and already batched to an animation frame. Paying a labs runtime and another vendored
 *    dependency for that is cost with no payoff in a bundle that must stay small and
 *    offline.
 *  - **Lit context alone is not a state model.** It is a dependency-injection channel, and
 *    it is used here as exactly that: the root provides this store, and a chart card three
 *    levels down consumes it without prop-drilling.
 *
 * What selector subscriptions buy: a chart does not re-render when the timeline filter
 * changes. Without them every state write would touch every component, which at 100k
 * events is the difference between a responsive app and a slideshow.
 *
 * **The load-bearing rule: big data lives outside this store's equality checks.** Event
 * arrays and typed-array columns are held by reference and mutated in place; a `revision`
 * counter signals that they changed. Never put a 100k-element array behind a structural
 * comparison.
 */
export type Selector<S, T> = (state: S) => T;
export type Listener<T> = (value: T, previous: T) => void;
export type Equality<T> = (a: T, b: T) => boolean;

interface Subscription<S> {
	select: Selector<S, unknown>;
	notify: (value: unknown, previous: unknown) => void;
	equals: Equality<unknown>;
	last: unknown;
}

const strictEqual = (a: unknown, b: unknown) => Object.is(a, b);

export class Store<S extends object> {
	private state: S;
	private readonly subscriptions = new Set<Subscription<S>>();
	private notifying = false;

	constructor(initial: S) {
		this.state = initial;
	}

	get(): Readonly<S> {
		return this.state;
	}

	/**
	 * Apply an update.
	 *
	 * The updater returns a new top-level object; nested values may be shared. That keeps
	 * `Object.is` meaningful for the selectors that matter while letting a dataset's event
	 * array stay the same reference across a filter change.
	 */
	set(update: (state: Readonly<S>) => S): void {
		const next = update(this.state);
		if (next === this.state) return;
		this.state = next;
		this.flush();
	}

	subscribe<T>(select: Selector<S, T>, notify: Listener<T>, equals: Equality<T> = strictEqual): () => void {
		const subscription: Subscription<S> = {
			select: select as Selector<S, unknown>,
			notify: notify as (value: unknown, previous: unknown) => void,
			equals: equals as Equality<unknown>,
			last: select(this.state),
		};
		this.subscriptions.add(subscription);
		return () => void this.subscriptions.delete(subscription);
	}

	private flush(): void {
		// A listener that writes back would otherwise re-enter mid-iteration and deliver
		// listeners a value older than the one already applied.
		if (this.notifying) return;
		this.notifying = true;
		try {
			for (const subscription of [...this.subscriptions]) {
				const value = subscription.select(this.state);
				if (subscription.equals(value, subscription.last)) continue;
				const previous = subscription.last;
				subscription.last = value;
				subscription.notify(value, previous);
			}
		} finally {
			this.notifying = false;
		}
	}
}

/** Shallow array equality, for selectors returning a derived list. */
export function shallowArrayEqual<T>(a: readonly T[], b: readonly T[]): boolean {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
	return true;
}
