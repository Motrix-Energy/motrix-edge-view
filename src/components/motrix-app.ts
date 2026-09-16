import { provide } from '@lit/context';
import { LitElement, css, html, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';

import type { MessageKey } from '../i18n/catalogue.js';
import { t } from '../i18n/translator.js';
import { AppStore, storeContext } from '../state/actions.js';
import { isView, type View } from '../state/app-state.js';
import { base, tokens } from '../styles/tokens.css.js';
import { StoreController } from './common/store-controller.js';
import './common/motrix-login.js';
import './motrix-navbar.js';
import './live/motrix-live-status.js';
import './pages/motrix-home.js';
import './pages/motrix-workspace.js';

/**
 * Document title per view.
 *
 * Half-translated on purpose: "Motrix Edge View" is a product name and product names do not
 * translate, so making it a catalogue key with the same value in four files would be
 * ceremony. The *suffix* is worth translating — it pays off the moment somebody has two
 * windows open on different views, which is how this tool is actually used.
 */
const VIEW_TITLE_KEYS: Record<View, MessageKey> = {
	home: 'app.title.home',
	workspace: 'app.title.workspace',
	live: 'app.title.live',
};

const PRODUCT = 'Motrix Edge View';

@customElement('motrix-app')
export class MotrixApp extends LitElement {
	static styles = [
		tokens,
		base,
		css`
			:host {
				display: flex;
				flex-direction: column;
				height: 100%;
				overflow: hidden;
			}

			main {
				flex: 1 1 auto;
				min-height: 0;
				display: flex;
				flex-direction: column;
			}

			.toasts {
				position: fixed;
				right: 16px;
				bottom: 16px;
				display: flex;
				flex-direction: column;
				gap: 8px;
				z-index: 10;
			}

			.toast {
				background: var(--bg-tertiary);
				border: 1px solid var(--border);
				border-left-width: 3px;
				border-radius: var(--radius);
				padding: 8px 12px;
				font-size: 13px;
				max-width: 48ch;
				cursor: pointer;
			}

			.toast.error {
				border-left-color: var(--error);
			}

			.toast.warning {
				border-left-color: var(--warning);
			}

			.toast.info {
				border-left-color: var(--accent);
			}
		`,
	];

	@provide({ context: storeContext })
	store = new AppStore();

	// Held only for their subscriptions; see StoreController.
	readonly viewSub = new StoreController(this, () => this.store, (s) => s.view);
	readonly toastsSub = new StoreController(this, () => this.store, (s) => s.toasts);
	readonly localeSub = new StoreController(this, () => this.store, (s) => s.locale);
	readonly authSub = new StoreController(this, () => this.store, (s) => s.auth);
	readonly loginSub = new StoreController(this, () => this.store, (s) => s.loginDismissed);

	private readonly onHashChange = (): void => this.applyHash();

	connectedCallback(): void {
		super.connectedCallback();
		this.applyHash();
		globalThis.addEventListener('hashchange', this.onHashChange);
		// The probe lives in the store, not here: its result feeds three components, it must
		// survive this element re-mounting, and its 401 branch is an auth decision rather
		// than a rendering one. From file:// it simply fails, which is correct.
		void this.store.probeLive();
	}

	disconnectedCallback(): void {
		globalThis.removeEventListener('hashchange', this.onHashChange);
		super.disconnectedCallback();
	}

	/**
	 * `location.hash` is the only history API usable here.
	 *
	 * `history.pushState` throws `SecurityError` on a `file://` origin in Chrome, and a
	 * double-clicked file is this app's primary distribution. The store stays the single
	 * source of truth; the hash is a mirror, so back and forward work without anything
	 * downstream having to know a URL exists.
	 */
	private applyHash(): void {
		const candidate = globalThis.location?.hash.replace(/^#\/?/, '') ?? '';
		if (isView(candidate)) this.store.setView(candidate);
	}

	updated(): void {
		const { view, locale } = this.store.get();
		// Document-level effects belong to the shell: the store stays DOM-free, and these
		// live outside every shadow root, so no template can reach them. <html lang> is a
		// real accessibility requirement rather than tidiness — it decides screen-reader
		// pronunciation, and a French UI announced by an English voice is unusable.
		document.documentElement.lang = locale;
		document.title = view === 'home' ? PRODUCT : `${PRODUCT} — ${t(VIEW_TITLE_KEYS[view])}`;
		const hash = `#/${view === 'home' ? '' : view}`;
		if (globalThis.location !== undefined && globalThis.location.hash !== hash) {
			globalThis.location.hash = hash;
		}
	}

	render() {
		const state = this.store.get();
		return html`
			<motrix-navbar></motrix-navbar>
			${state.auth.phase === 'required' && !state.loginDismissed ? html`<motrix-login></motrix-login>` : nothing}

			<main @files-selected=${this.onFiles}>
				${state.view === 'home' ? html`<motrix-home></motrix-home>` : nothing}
				${state.view === 'workspace' ? html`<motrix-workspace></motrix-workspace>` : nothing}
				${state.view === 'live' ? html`<motrix-live-status></motrix-live-status>` : nothing}
			</main>

			<div class="toasts">
				${state.toasts.map(
					(toast) => html`
						<div class="toast ${toast.tone}" @click=${() => this.store.dismissToast(toast.id)}>
							${t(toast.key, toast.params)}
						</div>
					`,
				)}
			</div>
		`;
	}

	/**
	 * One handler for every dropzone, wherever it is mounted.
	 *
	 * `files-selected` is composed and bubbling, so it crosses the page components' shadow
	 * boundaries and lands here whether it came from Home or from the empty workspace.
	 */
	private onFiles(event: CustomEvent<{ files: File[] }>): void {
		// addDropped, not addFile: a dropped file is classified by its first bytes, so a
		// config.json becomes a topology overlay and everything else stays a CSV dataset.
		for (const file of event.detail.files) void this.store.addDropped(file);
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'motrix-app': MotrixApp;
	}
}
