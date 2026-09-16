import { consume } from '@lit/context';
import { LitElement, css, html, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';

import { t } from '../../i18n/translator.js';
import { AppStore, storeContext } from '../../state/actions.js';
import { base, tokens } from '../../styles/tokens.css.js';
import { StoreController } from './store-controller.js';

/**
 * A sign-in strip under the navbar — **not** a full-screen gate and not a modal.
 *
 * The constraint decides it. A full-screen gate blocks somebody who only wants to open a
 * CSV offline, which is the primary use of this tool and needs no credential at all. A
 * modal is barely better: a modal's entire semantic is "deal with me before anything else",
 * and here the correct semantic is the exact opposite — you never have to deal with this.
 * So: a dismissible strip, with the dropzone and every loaded dataset fully live behind it.
 */
@customElement('motrix-login')
export class MotrixLogin extends LitElement {
	static styles = [
		tokens,
		base,
		css`
			:host {
				flex: 0 0 auto;
				display: block;
				background: var(--bg-secondary);
				border-bottom: 1px solid var(--border);
				border-left: 3px solid var(--accent);
			}

			form {
				display: flex;
				align-items: center;
				gap: 10px;
				flex-wrap: wrap;
				padding: 10px 16px;
			}

			.lead {
				font-size: 13px;
				font-weight: 600;
			}

			label {
				display: flex;
				align-items: center;
				gap: 6px;
				font-size: 12px;
				color: var(--text-secondary);
			}

			input {
				background: var(--bg-tertiary);
				color: var(--text-primary);
				border: 1px solid var(--border);
				border-radius: var(--radius);
				padding: 5px 8px;
				font: inherit;
				font-size: 13px;
				width: 15ch;
			}

			button.primary {
				background: var(--accent);
				border-color: var(--accent);
				/* Ink, not #fff — white on the teal accent is 1.6:1. */
				color: var(--bg-primary);
			}

			.error {
				flex-basis: 100%;
				font-size: 12px;
				color: var(--error);
			}

			.note {
				flex-basis: 100%;
				font-size: 12px;
				color: var(--text-muted);
			}

			.spacer {
				flex: 1 1 auto;
			}
		`,
	];

	@consume({ context: storeContext })
	store!: AppStore;

	readonly authSub = new StoreController(this, () => this.store, (s) => s.auth);
	readonly localeSub = new StoreController(this, () => this.store, (s) => s.locale);

	render() {
		const auth = this.store.get().auth;
		if (auth.phase !== 'required') return nothing;

		return html`
			<!-- A real <form>, so Enter submits and the password never reaches a URL. -->
			<form @submit=${this.onSubmit}>
				<span class="lead">${t('login.lead')}</span>
				<label>
					${t('login.user')}
					<input name="user" autocomplete="username" .value=${'admin'} ?disabled=${auth.checking} />
				</label>
				<label>
					${t('login.password')}
					<input name="password" type="password" autocomplete="current-password" ?disabled=${auth.checking} />
				</label>
				<button type="submit" class="primary" ?disabled=${auth.checking}>
					${auth.checking ? t('login.checking') : t('login.submit')}
				</button>
				<button type="button" @click=${() => this.store.dismissLogin()}>${t('login.dismiss')}</button>
				<span class="spacer"></span>
				<!-- Inline in the form, never a toast: a toast is for a background event, and
				     a form error belongs where the form is. -->
				${auth.reason === 'initial' ? nothing : html`<span class="error">${t(this.reasonKey(auth.reason))}</span>`}
				<!-- The panel's mere presence makes people think the whole app is gated. -->
				<span class="note">${t('login.scope')}</span>
			</form>
		`;
	}

	/** Four failures that read completely differently. `unreachable` must never look like a typo. */
	private reasonKey(reason: 'rejected' | 'unreachable' | 'expired') {
		return reason === 'rejected' ? 'login.rejected' : reason === 'expired' ? 'login.expired' : 'login.unreachable';
	}

	private onSubmit(event: SubmitEvent): void {
		event.preventDefault();
		const form = event.target as HTMLFormElement;
		const user = (form.elements.namedItem('user') as HTMLInputElement).value.trim();
		const password = (form.elements.namedItem('password') as HTMLInputElement).value;
		if (user === '' || password === '') return;
		void this.store.signIn(user, password);
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'motrix-login': MotrixLogin;
	}
}
