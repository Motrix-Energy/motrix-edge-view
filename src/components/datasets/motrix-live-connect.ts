import { consume } from '@lit/context';
import { LitElement, css, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import { t } from '../../i18n/translator.js';
import { AppStore, storeContext } from '../../state/actions.js';
import { isLiveAvailable } from '../../state/app-state.js';
import { base, tokens } from '../../styles/tokens.css.js';
import { StoreController } from '../common/store-controller.js';

/** Cadences the user picks from. 1s is offered but not encouraged — see the note below. */
const INTERVALS = [1, 2, 5, 15, 60] as const;

/**
 * Start a live subscription: pick a cadence, get a dataset.
 *
 * Deliberately small. The honest part is the paragraph, not the form — this is where the
 * user finds out that the series they are about to create was sampled by the viewer, that
 * every request costs the EMS a full device deep-copy, and that decisions will never appear
 * in it. Those are the three things somebody discovers the hard way otherwise.
 */
@customElement('motrix-live-connect')
export class MotrixLiveConnect extends LitElement {
	static styles = [
		tokens,
		base,
		css`
			:host {
				display: inline-block;
			}

			.panel {
				background: var(--bg-secondary);
				border: 1px solid var(--border);
				border-radius: var(--radius);
				padding: 14px 16px;
				display: flex;
				flex-direction: column;
				gap: 10px;
				max-width: 46ch;
			}

			.row {
				display: flex;
				align-items: center;
				gap: 8px;
				flex-wrap: wrap;
			}

			label {
				font-size: 12px;
				color: var(--text-secondary);
			}

			select {
				background: var(--bg-tertiary);
				color: var(--text-primary);
				border: 1px solid var(--border);
				border-radius: var(--radius);
				padding: 5px 8px;
				font: inherit;
				font-size: 13px;
			}

			p {
				margin: 0;
				font-size: 12px;
				line-height: 1.55;
				color: var(--text-muted);
			}

			button.primary {
				background: var(--accent);
				border-color: var(--accent);
				/* Ink, not #fff — white on the teal accent is 1.6:1. */
				color: var(--bg-primary);
			}
		`,
	];

	@consume({ context: storeContext })
	store!: AppStore;

	@state() private open = false;
	@state() private seconds = 2;

	readonly probeSub = new StoreController(this, () => this.store, (s) => s.liveProbe);
	readonly decisionsSub = new StoreController(this, () => this.store, (s) => s.liveDecisions);
	readonly authSub = new StoreController(this, () => this.store, (s) => s.auth);
	readonly localeSub = new StoreController(this, () => this.store, (s) => s.locale);

	render() {
		const state = this.store.get();
		// Nothing to connect to, or locked out of it: an enabled button here would produce a
		// dataset that could only ever report failures.
		if (!isLiveAvailable(state) || state.auth.phase === 'required') return nothing;

		if (!this.open) {
			return html`<button type="button" @click=${() => (this.open = true)}>${t('live.connect.open')}</button>`;
		}

		return html`
			<div class="panel">
				<div class="row">
					<label for="interval">${t('live.connect.interval')}</label>
					<select
						id="interval"
						@change=${(event: Event) => (this.seconds = Number((event.target as HTMLSelectElement).value))}
					>
						${INTERVALS.map(
							(value) =>
								html`<option value=${value} ?selected=${value === this.seconds}>
									${t('live.connect.seconds', { n: value })}
								</option>`,
						)}
					</select>
					<button type="button" class="primary" @click=${this.connect}>${t('live.connect.start')}</button>
					<button type="button" @click=${() => (this.open = false)}>${t('live.connect.cancel')}</button>
				</div>
				<p>${t('live.connect.sampled')}</p>
				<p>${t('live.connect.cost')}</p>
				<p>
					${this.store.get().liveDecisions === 'available'
						? t('live.can.decisions', { endpoint: '/decisions' })
						: t('live.connect.decisions', { file: 'algorithm_decisions.csv' })}
				</p>
			</div>
		`;
	}

	private connect(): void {
		this.store.addLive({ intervalMs: this.seconds * 1000 });
		this.open = false;
		this.store.setView('workspace');
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'motrix-live-connect': MotrixLiveConnect;
	}
}
