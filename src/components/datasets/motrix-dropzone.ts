import { consume } from '@lit/context';
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { t } from '../../i18n/translator.js';
import { AppStore, storeContext } from '../../state/actions.js';
import { base, tokens } from '../../styles/tokens.css.js';
import { StoreController } from '../common/store-controller.js';

/**
 * Drag-and-drop plus a file picker, for both EMS CSV shapes.
 *
 * **One zone, not two.** The prototype had a zone per file and no shape check, so dropping
 * the wrong file into the wrong zone produced zero rows and a silent empty state. The
 * source sniffs the header instead, which makes a single zone both simpler and stricter.
 */
@customElement('motrix-dropzone')
export class MotrixDropzone extends LitElement {
	static styles = [
		tokens,
		base,
		css`
			:host {
				display: block;
			}

			.zone {
				border: 1.5px dashed var(--border);
				border-radius: var(--radius);
				padding: 28px 20px;
				text-align: center;
				background: var(--bg-secondary);
				cursor: pointer;
				transition: border-color 120ms, background 120ms;
			}

			.zone:hover,
			.zone.over {
				border-color: var(--accent);
				background: var(--bg-tertiary);
			}

			.zone.compact {
				padding: 10px 14px;
				text-align: left;
				font-size: 13px;
			}

			.hint {
				margin-top: 6px;
				font-size: 12px;
				color: var(--text-muted);
			}

			input {
				display: none;
			}
		`,
	];

	// This component had no store connection at all until i18n needed one. Both of its mount
	// points sit under motrix-app's single provider, so the context resolves.
	@consume({ context: storeContext })
	store!: AppStore;

	readonly localeSub = new StoreController(this, () => this.store, (s) => s.locale);

	@property({ type: Boolean }) compact = false;
	@state() private over = false;

	render() {
		return html`
			<div
				class="zone ${this.over ? 'over' : ''} ${this.compact ? 'compact' : ''}"
				role="button"
				tabindex="0"
				@click=${this.pick}
				@keydown=${this.onKey}
				@dragover=${this.onDragOver}
				@dragleave=${() => (this.over = false)}
				@drop=${this.onDrop}
			>
				${this.compact
					? html`${t('dropzone.add')}`
					: html`
							<div><strong>${t('dropzone.title')}</strong></div>
							<div class="hint">
								${t('dropzone.hint', {
									readings: 'device_data.csv',
									decisions: 'algorithm_decisions.csv',
									replay: 'replay.csv',
									config: 'config.json',
								})}
							</div>
						`}
				<!-- Accept, not classify: the store decides what a file is from its first bytes,
				     so a .json holding CSV still loads as CSV. This only widens the picker. -->
				<input type="file" accept=".csv,text/csv,.json,application/json" multiple @change=${this.onPicked} />
			</div>
		`;
	}

	private pick(): void {
		this.renderRoot.querySelector('input')?.click();
	}

	private onKey(event: KeyboardEvent): void {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			this.pick();
		}
	}

	private onDragOver(event: DragEvent): void {
		event.preventDefault();
		this.over = true;
	}

	private onDrop(event: DragEvent): void {
		event.preventDefault();
		this.over = false;
		const files = [...(event.dataTransfer?.files ?? [])];
		if (files.length > 0) this.emit(files);
	}

	private onPicked(event: Event): void {
		const input = event.target as HTMLInputElement;
		const files = [...(input.files ?? [])];
		// Reset, so picking the same file twice in a row still fires a change event —
		// which is exactly what someone does after re-running a backtest.
		input.value = '';
		if (files.length > 0) this.emit(files);
	}

	private emit(files: File[]): void {
		this.dispatchEvent(new CustomEvent('files-selected', { detail: { files }, bubbles: true, composed: true }));
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'motrix-dropzone': MotrixDropzone;
	}
	interface HTMLElementEventMap {
		'files-selected': CustomEvent<{ files: File[] }>;
	}
}
