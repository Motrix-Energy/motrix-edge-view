import { consume } from '@lit/context';
import { LitElement, css, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import { plural, t } from '../../i18n/translator.js';
import { AppStore, storeContext } from '../../state/actions.js';
import { base, tokens } from '../../styles/tokens.css.js';
import { StoreController } from '../common/store-controller.js';
import './motrix-chart-card.js';

/**
 * Follow windows, in **samples**. Distinct from retention: what you watch, not what you keep.
 *
 * These were 1, 5, 15 and 60 minutes. A duration is the wrong unit for a window measured in
 * data time: under a `speed: 0` replay the EMS clock runs roughly 9 000× real time, so
 * consecutive polls land hours apart in data time and every one of those four windows
 * contained a single point or none — the control appeared to do nothing whichever you
 * picked. A count means the same thing whether the clock is real or replayed, and the axis
 * still says what it spans. See `AppState.follow`.
 */
const FOLLOW_WINDOWS = [50, 200, 1000, 5000] as const;

/**
 * N charts, all sharing one uPlot sync key.
 *
 * `uPlot.sync()` gives crosshair *and* x-zoom across every joined chart natively, which the
 * prototype had to fan out by hand — and it never managed the crosshair half at all. Each
 * card joins by passing the same key; nothing here has to broadcast anything.
 *
 * The authoritative viewport still lives in the store, as epoch numbers, because the
 * timeline and (later) the follow logic both read it.
 */
@customElement('motrix-chart-grid')
export class MotrixChartGrid extends LitElement {
	static styles = [
		tokens,
		base,
		css`
			:host {
				display: block;
				padding: 10px 12px;
				overflow: auto;
			}

			header {
				display: flex;
				gap: 8px;
				align-items: center;
				margin-bottom: 8px;
				font-size: 13px;
			}

			h2 {
				margin: 0;
				font-size: 13px;
				font-weight: 600;
			}

			.spacer {
				flex: 1 1 auto;
			}

			.hint {
				color: var(--text-muted);
				font-size: 12px;
			}

			.empty {
				padding: 20px;
				text-align: center;
				color: var(--text-muted);
				font-size: 13px;
				border: 1px dashed var(--border);
				border-radius: var(--radius);
			}
		`,
	];

	@consume({ context: storeContext }) store!: AppStore;
	@state() private charts: string[] = ['chart-1'];

	readonly viewportSub = new StoreController(this, () => this.store, (s) => s.viewport);
	readonly alignmentSub = new StoreController(this, () => this.store, (s) => s.alignment);
	readonly followSub = new StoreController(this, () => this.store, (s) => s.follow);
	readonly datasetsSub = new StoreController(this, () => this.store, (s) => s.datasets);
	readonly localeSub = new StoreController(this, () => this.store, (s) => s.locale);

	private nextId = 2;

	/**
	 * Follow mode, shown only when there is something unbounded to follow.
	 *
	 * When it drops out the label says *why*, and re-arming is a click. Never automatic:
	 * silently resuming is exactly the fighting the drop-out exists to prevent.
	 */
	private followControls() {
		const state = this.store.get();
		if (!state.datasets.some((dataset) => !dataset.finite)) return nothing;
		return html`
			<label class="hint">
				<input
					type="checkbox"
					.checked=${state.follow.on}
					@change=${(event: Event) => this.store.setFollow({ on: (event.target as HTMLInputElement).checked })}
				/>
				${state.follow.on ? t('charts.follow') : t('charts.followPaused')}
			</label>
			<select
				aria-label=${t('charts.followWindow')}
				@change=${(event: Event) =>
					this.store.setFollow({ samples: Number((event.target as HTMLSelectElement).value), on: true })}
			>
				${FOLLOW_WINDOWS.map(
					(samples) => html`<option value=${samples} ?selected=${state.follow.samples === samples}>
						${plural('charts.followSamples', samples)}
					</option>`,
				)}
			</select>
		`;
	}

	render() {
		const state = this.store.get();
		return html`
			<header>
				<h2>${t('charts.title')}</h2>
				<button @click=${this.addChart}>${t('charts.add')}</button>
				<label class="hint">
					<input
						type="checkbox"
						.checked=${state.alignment === 't0'}
						@change=${(event: Event) =>
							this.store.setAlignment((event.target as HTMLInputElement).checked ? 't0' : 'absolute')}
					/>
					${t('charts.alignT0')}
				</label>
				${this.followControls()}
				<span class="spacer"></span>
				${state.viewport === null
					? html`<span class="hint">${t('charts.zoomHint')}</span>`
					: html`<button @click=${() => this.store.setViewport(null)}>${t('charts.resetZoom')}</button>`}
			</header>

			${this.charts.length === 0
				? html`<div class="empty">${t('charts.empty')}</div>`
				: this.charts.map(
						(id) => html`
							<motrix-chart-card
								.chartId=${id}
								syncKey="ems"
								@remove-chart=${this.removeChart}
								@viewport-change=${this.onViewport}
							></motrix-chart-card>
						`,
					)}
		`;
	}

	private addChart = (): void => {
		this.charts = [...this.charts, `chart-${this.nextId++}`];
	};

	private removeChart = (event: CustomEvent<{ id: string }>): void => {
		this.charts = this.charts.filter((id) => id !== event.detail.id);
	};

	/**
	 * A chart changed its x range.
	 *
	 * uPlot's sync has already moved the other charts; this only mirrors the range into the
	 * store so the timeline filters to the same window. Guarded against a no-op write so a
	 * sync-driven `setScale` on every sibling does not loop back through the store N times
	 * per drag frame.
	 */
	private onViewport = (event: CustomEvent<{ min: number; max: number }>): void => {
		const current = this.store.get().viewport;
		const { min, max } = event.detail;
		if (current !== null && Math.abs(current[0] - min) < 0.5 && Math.abs(current[1] - max) < 0.5) return;
		this.store.setViewport([min, max]);
	};
}

declare global {
	interface HTMLElementTagNameMap {
		'motrix-chart-grid': MotrixChartGrid;
	}
}
