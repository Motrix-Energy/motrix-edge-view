import { consume } from '@lit/context';
import { LitElement, css, html } from 'lit';
import { customElement } from 'lit/decorators.js';

import { t } from '../../i18n/translator.js';
import { AppStore, storeContext } from '../../state/actions.js';
import { base, tokens } from '../../styles/tokens.css.js';
import { StoreController } from '../common/store-controller.js';
import '../charts/motrix-chart-grid.js';
import '../datasets/motrix-dataset-bar.js';
import '../datasets/motrix-dropzone.js';
import '../timeline/motrix-timeline.js';
import '../topology/motrix-topology-panel.js';

/**
 * Charts and the timeline over every loaded dataset.
 *
 * The `hasData` fork that used to live in `motrix-app` moved here, and its meaning narrowed
 * with the move: it now chooses between "charts + timeline" and "nothing loaded yet",
 * rather than between "the app" and "a welcome screen". The welcome screen became Home.
 */
@customElement('motrix-workspace')
export class MotrixWorkspace extends LitElement {
	static styles = [
		tokens,
		base,
		css`
			:host {
				flex: 1 1 auto;
				min-height: 0;
				display: flex;
				flex-direction: column;
			}

			/* Explicit, not inherited from the default flex item sizing: this element is
			   display:block internally and only avoids shrinking today because min-height
			   floors it at content height. That is luck, not design. */
			motrix-dataset-bar {
				flex: 0 0 auto;
			}

			/* Charts take what they need; the timeline takes the rest and scrolls. */
			motrix-chart-grid {
				flex: 0 0 auto;
				max-height: 55%;
			}

			motrix-timeline {
				flex: 1 1 auto;
				min-height: 0;
				/* A major band divider, so 2px — control chrome elsewhere stays 1px. */
				border-top: 2px solid var(--border);
			}

			.empty {
				flex: 1 1 auto;
				display: grid;
				place-items: center;
				padding: 24px;
			}

			.empty-inner {
				max-width: 52ch;
				width: 100%;
				text-align: center;
			}

			.empty p {
				color: var(--text-secondary);
				font-size: 13px;
				line-height: 1.6;
			}
		`,
	];

	@consume({ context: storeContext })
	store!: AppStore;

	readonly datasetsSub = new StoreController(this, () => this.store, (s) => s.datasets);
	readonly localeSub = new StoreController(this, () => this.store, (s) => s.locale);

	render() {
		const hasData = this.store.get().datasets.length > 0;
		if (!hasData) {
			return html`
				<div class="empty">
					<div class="empty-inner">
						<motrix-dropzone></motrix-dropzone>
						<p>${t('workspace.empty')}</p>
						<!-- Also here, not only in the dataset bar: dropping a config with nothing
						     loaded is a real path — it answers "what does this run configure?"
						     before any CSV exists — and the bar only mounts once data does. -->
						<motrix-topology-panel></motrix-topology-panel>
					</div>
				</div>
			`;
		}
		return html`
			<motrix-dataset-bar></motrix-dataset-bar>
			<motrix-chart-grid></motrix-chart-grid>
			<motrix-timeline></motrix-timeline>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'motrix-workspace': MotrixWorkspace;
	}
}
