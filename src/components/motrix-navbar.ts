import { consume } from '@lit/context';
import { LitElement, css, html, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';

import type { MessageKey } from '../i18n/catalogue.js';
import { LOCALES, LOCALE_NAMES, isLocale } from '../i18n/locale.js';
import { t } from '../i18n/translator.js';
import { AppStore, storeContext } from '../state/actions.js';
import type { View } from '../state/app-state.js';
import { base, tokens } from '../styles/tokens.css.js';
import { StoreController } from './common/store-controller.js';

/**
 * The single header: brand, the three views, and the live-connection chip.
 *
 * **One bar, not two.** This replaces the old `header.app` rather than stacking under it.
 * Two 40px rows cost 80px of a viewport whose entire layout budget is "charts take at most
 * 55%, the timeline takes the rest" — vertical space is the scarcest resource in this UI.
 *
 * Semantics are `<nav>` + buttons + `aria-current`, deliberately **not** `role="tablist"`.
 * The tab pattern is the more literally accurate description of three panels, but it
 * obliges `aria-controls` pointing at the panel — and IDREF attributes cannot cross a
 * shadow root boundary. The buttons live here and the panels live in `motrix-app`'s root, so
 * `aria-controls` would silently dangle: markup that looks right, does nothing, and warns
 * nobody. At three items `aria-current` costs no roving tabindex and loses only the
 * "tab 1 of 3" announcement.
 */
@customElement('motrix-navbar')
export class MotrixNavbar extends LitElement {
	static styles = [
		tokens,
		base,
		css`
			:host {
				/* Must not shrink: the timeline's virtualizer computes its window from a
				   measured height, so a header that gives way silently breaks row counts. */
				flex: 0 0 auto;
				display: block;
				background: var(--bg-secondary);
				/* 2px, not 1: this is the page's one major rule, and the system it follows
				   organises with the strength of its dividers rather than with whitespace. */
				border-bottom: 2px solid var(--border);
			}

			.bar {
				display: flex;
				align-items: center;
				gap: 16px;
				padding: 0 16px;
				min-height: 44px;
				flex-wrap: wrap;
			}

			/* The lockup: mark, then the wordmark over its kicker. Sized so the whole
			   thing clears the bar's 44px without pushing it taller. */
			.brand {
				display: flex;
				align-items: center;
				gap: 9px;
				white-space: nowrap;
			}

			.mark {
				height: 26px;
				width: auto;
				flex: none;
			}

			.lockup {
				display: flex;
				flex-direction: column;
				gap: 1px;
			}

			.word {
				font-size: 17px;
				font-weight: 800;
				letter-spacing: -0.03em;
				line-height: 1;
			}

			.kicker {
				font-size: 8px;
				font-weight: 600;
				letter-spacing: 0.18em;
				line-height: 1;
				color: var(--accent);
			}

			nav {
				display: flex;
				gap: 2px;
			}

			.item {
				background: none;
				border: none;
				border-bottom: 2px solid transparent;
				border-radius: 0;
				padding: 12px 10px;
				font-size: 13px;
				color: var(--text-secondary);
				display: flex;
				align-items: center;
				gap: 7px;
				white-space: nowrap;
			}

			.item:hover {
				background: var(--bg-hover);
				color: var(--text-primary);
			}

			.item[aria-current] {
				color: var(--text-primary);
				border-bottom-color: var(--accent);
			}

			.right {
				margin-left: auto;
				display: flex;
				align-items: center;
				gap: 12px;
			}

			select {
				font-size: 12px;
				padding: 4px 6px;
				background: var(--bg-tertiary);
				color: var(--text-primary);
				border: 1px solid var(--border);
				border-radius: var(--radius);
			}

			.chip {
				font-size: 12px;
				color: var(--text-muted);
				white-space: nowrap;
			}

			.dot {
				width: 7px;
				height: 7px;
				border-radius: 50%;
				background: var(--text-muted);
				flex: 0 0 auto;
			}

			.dot.reachable {
				background: var(--success);
			}

			.dot.unreachable {
				background: var(--border);
			}
		`,
	];

	@consume({ context: storeContext })
	store!: AppStore;

	// Held only for their subscriptions; see StoreController.
	readonly viewSub = new StoreController(this, () => this.store, (s) => s.view);
	readonly probeSub = new StoreController(this, () => this.store, (s) => s.liveProbe);
	readonly localeSub = new StoreController(this, () => this.store, (s) => s.locale);
	readonly authSub = new StoreController(this, () => this.store, (s) => s.auth);

	render() {
		return html`
			<div class="bar">
				<span class="brand" role="img" aria-label="Motrix Edge View">
					<svg class="mark" viewBox="6 24 108 80" aria-hidden="true">
						<defs>
							<linearGradient id="nav-flow" x1="14" y1="0" x2="106" y2="0" gradientUnits="userSpaceOnUse">
								<stop offset="0" stop-color="#2FE6C8" />
								<stop offset="1" stop-color="#FFB443" />
							</linearGradient>
						</defs>
						<path
							d="M22 73 L22 34 L60 70 L98 34 L98 73"
							fill="none"
							stroke="url(#nav-flow)"
							stroke-width="11"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
						<circle cx="22" cy="88" r="8" fill="none" stroke="#2FE6C8" stroke-width="6.5" />
						<circle cx="98" cy="88" r="8" fill="none" stroke="#FFB443" stroke-width="6.5" />
					</svg>
					<span class="lockup">
						<span class="word">motrix</span>
						<span class="kicker">EDGE VIEW</span>
					</span>
				</span>
				<nav aria-label=${t('nav.label')}>
					${this.item('home', 'nav.home')} ${this.item('workspace', 'nav.workspace')}
					${this.item('live', 'nav.live')}
				</nav>
				<div class="right">
					<span class="chip">${this.probeLabel()}</span>
					${this.authControl()}${this.languagePicker()}
				</div>
			</div>
		`;
	}

	private item(view: View, label: MessageKey) {
		const active = this.store.get().view === view;
		return html`
			<button
				type="button"
				class="item"
				aria-current=${active ? 'page' : nothing}
				@click=${() => this.store.setView(view)}
			>
				${t(label)}
				${view === 'live' ? html`<span class="dot ${this.store.get().liveProbe}" aria-hidden="true"></span>` : nothing}
			</button>
		`;
	}

	/**
	 * A native <select>, which is already this repo's idiom for a facet.
	 *
	 * Zero accessibility implementation, keyboard-native, and `base` already styles its
	 * focus ring. The options are endonyms from LOCALE_NAMES rather than catalogue entries,
	 * so they read the same in all four languages and cost no translation.
	 */
	private languagePicker() {
		const current = this.store.get().locale;
		return html`
			<select
				aria-label=${t('nav.language')}
				@change=${(event: Event) => {
					const value = (event.target as HTMLSelectElement).value;
					if (isLocale(value)) this.store.setLocale(value);
				}}
			>
				${LOCALES.map(
					(locale) => html`<option value=${locale} ?selected=${locale === current}>${LOCALE_NAMES[locale]}</option>`,
				)}
			</select>
		`;
	}

	/**
	 * The way back in once the sign-in strip has been dismissed.
	 *
	 * Nothing at all when there is no gate: an EMS with no nginx in front needs no sign-in,
	 * and a "Sign in" button pointing at nothing is worse than no button.
	 */
	private authControl() {
		const auth = this.store.get().auth;
		if (auth.phase === 'required') {
			return html`<button type="button" @click=${() => this.store.reopenLogin()}>${t('auth.signIn')}</button>`;
		}
		if (auth.phase === 'authenticated') {
			return html`<button type="button" @click=${() => this.store.signOut()}>${t('auth.signOut')}</button>`;
		}
		return nothing;
	}

	/**
	 * `liveProbe` and `auth` answer two different questions, and this chip reports both.
	 *
	 * "locked" rather than "file mode" for a 401 is the entire reason `auth` is a separate
	 * field: the EMS is right there and answering, and saying "file mode" would send
	 * somebody hunting a network fault that does not exist.
	 */
	private probeLabel(): string {
		const state = this.store.get();
		if (state.auth.phase === 'required') return t('auth.locked');
		if (state.auth.phase === 'authenticated') return t('auth.signedIn', { user: state.auth.user });
		switch (state.liveProbe) {
			case 'pending':
				return '';
			case 'reachable':
				return t('probe.reachable');
			case 'unreachable':
				return t('probe.unreachable');
		}
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'motrix-navbar': MotrixNavbar;
	}
}
