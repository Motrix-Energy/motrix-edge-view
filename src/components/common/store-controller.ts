import type { ReactiveController, ReactiveControllerHost } from 'lit';

import type { AppState } from '../../state/app-state.js';
import type { AppStore } from '../../state/actions.js';
import type { Equality, Selector } from '../../state/store.js';

/**
 * Subscribes a Lit element to one slice of the store and requests an update when it moves.
 *
 * The point of taking a *selector* rather than the whole state: a chart must not re-render
 * because the timeline filter changed. With 100k events loaded, "every write touches every
 * component" is the difference between an app and a slideshow.
 *
 * The store arrives through a **getter**, not a value. A field initialiser runs during
 * construction, and `@consume` has not resolved the context by then — capturing
 * `this.store` there captures `undefined`, and the subscription silently never happens.
 * Resolving on first update instead is the only point at which the context is guaranteed
 * present, whatever order the controllers were registered in.
 */
export class StoreController<T> implements ReactiveController {
	private unsubscribe: (() => void) | null = null;

	constructor(
		private readonly host: ReactiveControllerHost,
		private readonly getStore: () => AppStore | undefined,
		private readonly select: Selector<AppState, T>,
		private readonly equals?: Equality<T>,
	) {
		host.addController(this);
	}

	get value(): T | undefined {
		const store = this.getStore();
		return store === undefined ? undefined : this.select(store.get());
	}

	hostUpdate(): void {
		if (this.unsubscribe !== null) return;
		const store = this.getStore();
		if (store === undefined) return;
		this.unsubscribe = store.subscribe(this.select, () => this.host.requestUpdate(), this.equals);
	}

	hostDisconnected(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}
}
