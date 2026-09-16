import { consume } from '@lit/context';
import { LitElement, css, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import { formatBytes } from '../../core/format.js';
import { formatDuration, formatSpanAware } from '../../core/time.js';
import { overallSpan, type Dataset } from '../../state/app-state.js';
import { compact, durationUnits, n, plural, t } from '../../i18n/translator.js';
import { warningText } from '../../i18n/warnings.js';
import { AppStore, storeContext } from '../../state/actions.js';
import { base, tokens } from '../../styles/tokens.css.js';
import { StoreController } from '../common/store-controller.js';
import './motrix-dropzone.js';
import './motrix-live-connect.js';
import '../topology/motrix-topology-panel.js';

/**
 * The loaded-dataset strip: one chip per dataset, plus the add button and the summary.
 *
 * A *list*, deliberately — never a "current file" switch. Everything downstream reads from
 * every dataset, which is what makes side-by-side comparison of two runs work at all.
 */
@customElement('motrix-dataset-bar')
export class MotrixDatasetBar extends LitElement {
	static styles = [
		tokens,
		base,
		css`
			:host {
				display: block;
				background: var(--bg-secondary);
				border-bottom: 1px solid var(--border);
				padding: 10px 16px;
			}

			.row {
				display: flex;
				flex-wrap: wrap;
				gap: 8px;
				align-items: center;
			}

			.chip {
				display: flex;
				align-items: center;
				gap: 8px;
				background: var(--bg-tertiary);
				border: 1px solid var(--border);
				border-radius: var(--radius);
				padding: 5px 8px 5px 6px;
				font-size: 13px;
				max-width: 460px;
			}

			.swatch {
				width: 10px;
				height: 10px;
				border-radius: 3px;
				flex: 0 0 auto;
			}

			.tag {
				font-weight: 600;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
				max-width: 22ch;
				background: none;
				border: none;
				padding: 0;
				color: inherit;
				font-family: inherit;
				font-size: inherit;
			}

			.meta {
				color: var(--text-secondary);
				font-size: 12px;
				white-space: nowrap;
			}

			.badge {
				font-size: 11px;
				padding: 1px 5px;
				border-radius: 4px;
				border: 1px solid var(--border);
				color: var(--text-secondary);
				cursor: help;
			}

			.badge.warn {
				color: var(--warning);
				border-color: color-mix(in srgb, var(--warning) 40%, transparent);
			}

			.badge.err {
				color: var(--error);
				border-color: color-mix(in srgb, var(--error) 40%, transparent);
			}

			.remove {
				background: none;
				border: none;
				padding: 0 2px;
				color: var(--text-muted);
				font-size: 15px;
				line-height: 1;
			}

			.remove:hover {
				color: var(--error);
				background: none;
			}

			.summary {
				margin-left: auto;
				display: flex;
				gap: 14px;
				font-size: 12px;
				color: var(--text-secondary);
				white-space: nowrap;
			}

			.summary b {
				color: var(--text-primary);
				font-weight: 600;
			}

			motrix-dropzone {
				flex: 0 0 auto;
			}

			details.report {
				margin-top: 8px;
				font-size: 12px;
			}

			details.report summary {
				cursor: pointer;
				color: var(--warning);
			}

			details.report ul {
				margin: 6px 0 0;
				padding-left: 18px;
				color: var(--text-secondary);
				max-height: 180px;
				overflow: auto;
			}

			details.report li {
				margin-bottom: 3px;
			}

			details.report code {
				color: var(--text-muted);
			}
		`,
	];

	@consume({ context: storeContext }) store!: AppStore;
	@state() private expanded: string | null = null;

	// Held only for its subscription: it re-renders this element when the dataset list, or
	// any dataset's revision counter, moves.
	readonly datasetsSub = new StoreController(this, () => this.store, (s) => s.datasets);
	readonly localeSub = new StoreController(this, () => this.store, (s) => s.locale);

	render() {
		const datasets = this.store.get().datasets;
		return html`
			<div class="row">
				${datasets.map((dataset) => this.chip(dataset))}
				<motrix-dropzone compact @files-selected=${this.onFiles}></motrix-dropzone>
				<motrix-live-connect></motrix-live-connect>
				${this.summary()}
			</div>
			${this.report(datasets)}
			<motrix-topology-panel></motrix-topology-panel>
		`;
	}

	private chip(dataset: Dataset) {
		const warnings = dataset.warnings.length;
		return html`
			<div class="chip">
				<span class="swatch" style="background:${dataset.colour}"></span>
				<input
					class="tag"
					.value=${dataset.tag}
					title=${t('dataset.rename')}
					@change=${(event: Event) => this.store.retagDataset(dataset.id, (event.target as HTMLInputElement).value)}
				/>
				<span class="meta">${this.statusLabel(dataset)}</span>
				${dataset.naiveCount > 0
					? html`<span
							class="badge warn"
							title=${plural('dataset.naiveTitle', dataset.naiveCount)}
							>${t('dataset.naiveBadge')}</span
						>`
					: nothing}
				${dataset.sourceKind === 'live'
					? html`<span class="badge" title=${t('dataset.sampledTitle')}>${t('dataset.sampledBadge')}</span>`
					: nothing}
				${dataset.kindCounts.has('input')
					? html`<span class="badge" title=${t('dataset.inputTitle')}>${t('dataset.inputBadge')}</span>`
					: nothing}
				${dataset.droppedByRetention > 0
					? html`<span class="badge warn" title=${t('dataset.droppedTitle')}
							>${plural('dataset.dropped', dataset.droppedByRetention, {
								count: compact(dataset.droppedByRetention),
							})}</span
						>`
					: nothing}
				${warnings > 0
					? html`<span class="badge ${warnings > 20 ? 'err' : ''}" title=${t('dataset.openReport')}>${warnings}⚠</span>`
					: nothing}
				<button class="remove" title=${t('dataset.remove')} @click=${() => this.store.removeDataset(dataset.id)}>×</button>
			</div>
		`;
	}

	private statusLabel(dataset: Dataset) {
		const status = dataset.status;
		switch (status.phase) {
			case 'idle':
				return t('dataset.status.queued');
			case 'loading':
				return status.bytesTotal === null
					? formatBytes(status.bytesDone, n)
					: `${Math.round((status.bytesDone / Math.max(1, status.bytesTotal)) * 100)}%`;
			case 'streaming':
				return t('dataset.status.live', {
					state:
						status.consecutiveFailures > 0
							? t('dataset.status.retrying', { n: status.consecutiveFailures })
							: t('dataset.status.ok'),
				});
			case 'complete':
				return plural('dataset.status.events', status.rows, { count: compact(status.rows) });
			case 'error':
				return t('dataset.status.failed');
		}
	}

	private summary() {
		const state = this.store.get();
		if (state.datasets.length === 0) return nothing;
		// Every figure reads its own tally. `totalEvents - readings` was standing in for the
		// decision count, which already counted a live dataset's worker and health events as
		// decisions — and would have counted replay inputs as decisions too.
		const count = (kind: 'reading' | 'decision' | 'input') =>
			state.datasets.reduce((total, dataset) => total + (dataset.kindCounts.get(kind) ?? 0), 0);
		const readings = count('reading');
		const decisions = count('decision');
		const inputs = count('input');
		const span = overallSpan(state);
		return html`
			<div class="summary">
				<span
					><b>${compact(state.datasets.length)}</b> ${plural('dataset.summary.datasets', state.datasets.length)}</span
				>
				<span><b>${compact(readings)}</b> ${plural('dataset.summary.readings', readings)}</span>
				<span><b>${compact(decisions)}</b> ${plural('dataset.summary.decisions', decisions)}</span>
				${inputs === 0
					? nothing
					: html`<span
							><b>${compact(inputs)}</b> ${plural('dataset.summary.inputs', inputs, { n: inputs })}</span
						>`}
				${span === null
					? nothing
					: html`<span title="${formatSpanAware(span[0], 0)} → ${formatSpanAware(span[1], 0)}"
							><b>${formatDuration(span[1] - span[0], durationUnits())}</b> ${t('dataset.summary.span')}</span
						>`}
			</div>
		`;
	}

	/**
	 * The load report.
	 *
	 * The prototype discarded PapaParse's own diagnostics entirely and reported nothing but
	 * a toast. Every warning a source raises is shown here with its row number, because
	 * "this file has 400 unparseable timestamps" is the single most useful thing a debugging
	 * tool can say about a file that looks empty.
	 */
	private report(datasets: readonly Dataset[]) {
		const withWarnings = datasets.filter((dataset) => dataset.warnings.length > 0);
		if (withWarnings.length === 0) return nothing;
		return html`
			${withWarnings.map(
				(dataset) => html`
					<details
						class="report"
						?open=${this.expanded === dataset.id}
						@toggle=${(event: Event) =>
							(this.expanded = (event.target as HTMLDetailsElement).open ? dataset.id : null)}
					>
						<summary>
							${plural('dataset.report.summary', dataset.warnings.length, { tag: dataset.tag })}
						</summary>
						<ul>
							${dataset.warnings.slice(0, 20).map(
								(warning) => html`
									<li>
										<code>${warning.code}</code>
										${warning.row === null
											? nothing
											: html`<code>${t('dataset.report.row', { n: warning.row })}</code>`}
										${warningText(warning)}
										${warning.sample === null ? nothing : html`<code>${warning.sample}</code>`}
									</li>
								`,
							)}
							${dataset.warnings.length > 20
								? html`<li>${plural('dataset.report.more', dataset.warnings.length - 20)}</li>`
								: nothing}
						</ul>
					</details>
				`,
			)}
		`;
	}

	private onFiles(event: CustomEvent<{ files: File[] }>): void {
		for (const file of event.detail.files) void this.store.addDropped(file);
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'motrix-dataset-bar': MotrixDatasetBar;
	}
}
