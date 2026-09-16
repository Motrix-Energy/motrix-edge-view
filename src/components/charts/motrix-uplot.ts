import { LitElement, css, html, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import uPlot from 'uplot';
import uplotCss from 'uplot/dist/uPlot.min.css?inline';

/**
 * A thin lifecycle wrapper around uPlot. It owns the instance and nothing else.
 *
 * uPlot's own stylesheet is imported `?inline` and adopted into this shadow root. uPlot
 * injects its CSS into `document.head`, which **does not cross a shadow boundary** — the
 * chart renders as an unstyled mess and the cause is not obvious. This is that fix.
 *
 * All the decisions live upstream in `buildChartData`, which is pure and tested. This
 * element's contract is: render the array you are handed.
 */
@customElement('motrix-uplot')
export class MotrixUplot extends LitElement {
	static styles = [
		unsafeCSS(uplotCss),
		css`
			:host {
				display: block;
			}

			.uplot {
				font-family: var(--font-sans);
			}

			/* uPlot's defaults assume a light page. */
			.u-legend {
				color: var(--text-secondary);
				font-size: 11px;
			}

			.u-select {
				background: color-mix(in srgb, var(--accent) 20%, transparent);
			}
		`,
	];

	@property({ attribute: false }) data: uPlot.AlignedData = [[]];
	@property({ attribute: false }) options!: uPlot.Options;

	private chart: uPlot | null = null;
	private container: HTMLDivElement | null = null;

	render() {
		return html`<div part="plot"></div>`;
	}

	firstUpdated(): void {
		this.container = this.renderRoot.querySelector('div');
		this.create();
	}

	updated(changed: Map<string, unknown>): void {
		if (this.chart === null) return;
		if (changed.has('options')) {
			// A changed series set means a different chart; uPlot cannot restructure in place.
			this.destroy();
			this.create();
			return;
		}
		if (changed.has('data')) this.chart.setData(this.data, false);
	}

	/**
	 * Move the x scale.
	 *
	 * Needed because `setData(data, false)` does NOT move it — the `false` is `resetScales`,
	 * so new data alone will never scroll a following window.
	 */
	setXRange(min: number, max: number): void {
		this.chart?.setScale('x', { min, max });
	}

	disconnectedCallback(): void {
		super.disconnectedCallback();
		this.destroy();
	}

	private create(): void {
		if (this.container === null || this.options === undefined) return;
		this.chart = new uPlot(this.options, this.data, this.container);
	}

	private destroy(): void {
		this.chart?.destroy();
		this.chart = null;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'motrix-uplot': MotrixUplot;
	}
}
