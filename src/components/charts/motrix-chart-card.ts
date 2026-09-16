import { consume } from '@lit/context';
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import uPlot from 'uplot';

import { buildChartData, type SeriesSpec } from '../../core/chart-data.js';
import { formatValue } from '../../core/format.js';
import { splitActorKey } from '../../core/ingest.js';
import { isChartable } from '../../core/numeric.js';
import { formatAxisTick, formatElapsed } from '../../core/time.js';
import { plural, t } from '../../i18n/translator.js';
import { datasetOffset, followWindow, type Dataset } from '../../state/app-state.js';
import { AppStore, storeContext } from '../../state/actions.js';
import { base, tokens } from '../../styles/tokens.css.js';
import { StoreController } from '../common/store-controller.js';
import './motrix-uplot.js';
import type { MotrixUplot } from './motrix-uplot.js';

/** A chosen series: which dataset, which actor, which path. */
export interface SeriesChoice {
	readonly datasetId: string;
	readonly actorKey: string;
	readonly path: string;
}

export function choiceKey(choice: SeriesChoice): string {
	return `${choice.datasetId}\0${choice.actorKey}\0${choice.path}`;
}

/**
 * The chart palette, in fixed assignment order — never cycled into a generated hue.
 *
 * These are NOT the brand's headline colours and must not be "corrected" to them. A dark
 * surface has its own selected steps: every entry sits inside the OKLCH lightness band
 * 0.48–0.67 against --bg-secondary, clears the chroma floor, and keeps colour-vision
 * separation (min protan/deutan ΔE 12.5, normal-vision ΔE 17.2) between adjacent slots.
 * Brand teal at #2FE6C8 is L 0.83 — far outside that band, and glaring as a 1.5px line on
 * near-black. Slot 1 is the same hue one ramp step down, which is where #159E88 already
 * lives. Re-validate before changing any of these.
 *
 * Order: teal, amber, blue, green, magenta, violet, orange, cyan.
 */
const SERIES_COLOURS = ['#00AC94', '#C98500', '#0C84FA', '#49AC0D', '#DD499B', '#965CE5', '#EE5129', '#0098B1'];

/**
 * Plot height in CSS pixels.
 *
 * Fixed rather than derived: a card is as wide as the workspace, so tying height to width
 * would make a maximised window draw a chart taller than the viewport and push the
 * timeline off screen. This is chosen against the axis instead — tall enough that a series
 * with a small dynamic range still has vertical room to show shape once the x axis and its
 * labels have taken their 34px.
 */
const PLOT_HEIGHT = 300;

@customElement('motrix-chart-card')
export class MotrixChartCard extends LitElement {
	static styles = [
		tokens,
		base,
		css`
			:host {
				display: block;
				background: var(--bg-secondary);
				border: 1px solid var(--border);
				border-radius: var(--radius);
				margin-bottom: 10px;
			}

			header {
				display: flex;
				gap: 8px;
				align-items: center;
				flex-wrap: wrap;
				padding: 8px 10px;
				border-bottom: 1px solid var(--border);
				font-size: 12px;
			}

			.spacer {
				flex: 1 1 auto;
			}

			details.picker {
				position: relative;
			}

			details.picker > summary {
				cursor: pointer;
				list-style: none;
				background: var(--bg-tertiary);
				border: 1px solid var(--border);
				border-radius: 6px;
				padding: 4px 8px;
			}

			details.picker > summary::-webkit-details-marker {
				display: none;
			}

			.menu {
				position: absolute;
				z-index: 20;
				top: calc(100% + 4px);
				left: 0;
				width: 460px;
				max-height: 320px;
				overflow: auto;
				background: var(--bg-tertiary);
				border: 1px solid var(--border);
				border-radius: var(--radius);
				padding: 8px;
				box-shadow: 0 8px 24px rgb(0 0 0 / 45%);
			}

			.group {
				margin-bottom: 8px;
			}

			.group-title {
				font-weight: 600;
				color: var(--text-secondary);
				margin-bottom: 3px;
				font-size: 11px;
				text-transform: uppercase;
				letter-spacing: 0.04em;
			}

			label.field {
				display: flex;
				gap: 6px;
				align-items: center;
				padding: 2px 4px;
				border-radius: 4px;
				cursor: pointer;
				font-family: var(--font-mono);
				font-size: 11px;
			}

			label.field:hover {
				background: var(--bg-hover);
			}

			.legend {
				display: flex;
				gap: 10px;
				flex-wrap: wrap;
				font-size: 11px;
				color: var(--text-secondary);
			}

			.legend span {
				display: inline-flex;
				gap: 4px;
				align-items: center;
			}

			.dash {
				width: 12px;
				height: 2px;
				border-radius: 1px;
			}

			.plot {
				padding: 6px 4px 4px;
			}

			.empty {
				padding: 28px;
				text-align: center;
				color: var(--text-muted);
				font-size: 13px;
			}

			.note {
				padding: 0 10px 6px;
				font-size: 11px;
				color: var(--text-muted);
			}
		`,
	];

	@consume({ context: storeContext }) store!: AppStore;

	@property({ type: String }) chartId = '';
	/** Shared with the grid: every card joins the same uPlot sync key. */
	@property({ type: String }) syncKey = 'ems';

	@state() private chosen: SeriesChoice[] = [];
	/** Set once the user unticks the last field, so auto-select does not fight them. */
	private userCleared = false;
	@state() private width = 800;

	readonly datasetsSub = new StoreController(this, () => this.store, (s) => s.datasets);
	readonly viewportSub = new StoreController(this, () => this.store, (s) => s.viewport);
	readonly alignmentSub = new StoreController(this, () => this.store, (s) => s.alignment);
	readonly localeSub = new StoreController(this, () => this.store, (s) => s.locale);
	readonly followSub = new StoreController(this, () => this.store, (s) => s.follow);

	/** Non-zero while this component is driving the x scale itself. See the setScale hook. */
	private programmatic = 0;

	/** When a pointer last touched this plot. uPlot's only zoom gestures are pointer ones. */
	private lastPointerAt = -Infinity;

	private pointerRecent(): boolean {
		// uPlot commits a drag-zoom on pointerup, synchronously within the gesture, so a
		// short window is generous rather than approximate.
		return performance.now() - this.lastPointerAt < 1000;
	}

	private observer: ResizeObserver | null = null;

	/** A stable ref, so re-binding it in `bindPlot` is a no-op rather than a duplicate. */
	private readonly markPointer = (): void => {
		this.lastPointerAt = performance.now();
	};

	willUpdate(): void {
		// Not in connectedCallback: a card is mounted as soon as a dataset exists, which is
		// *before* the file finishes loading and its fields are discovered — so selecting
		// once on connect finds nothing and the chart stays permanently empty. That is the
		// prototype's blank-chart defect wearing a different hat. Select as soon as there is
		// something to select; the guard below makes it a one-shot.
		this.autoSelect();
	}

	updated(): void {
		this.bindPlot();
		this.applyFollowWindow();
	}

	/**
	 * Push the follow window onto the x scale.
	 *
	 * Explicit because `setData(data, false)` does not move x — the `false` is `resetScales`
	 * — so a live append alone would never scroll the view. Wrapped in the `programmatic`
	 * counter so the setScale hook it triggers (and the ones uPlot's cursor sync fans out to
	 * every sibling) are recognised as ours and do not read as a user zoom.
	 */
	private applyFollowWindow(): void {
		const window = followWindow(this.store.get());
		if (window === null) return;
		const plot = this.renderRoot.querySelector('motrix-uplot') as MotrixUplot | null;
		if (plot === null) return;
		this.programmatic++;
		try {
			plot.setXRange(window[0], window[1]);
		} finally {
			this.programmatic--;
		}
	}

	firstUpdated(): void {
		this.bindPlot();
	}

	/**
	 * Bind the size observer and the pointer taps to `.plot`, once there is a `.plot`.
	 *
	 * Doing this in `firstUpdated` alone was silently a no-op. A card mounts as soon as a
	 * dataset exists, which is before the file has finished parsing — the same race
	 * `willUpdate` above already documents — so the first render takes the `specs.length
	 * === 0` branch and emits `.empty` instead of `.plot`. The query returned null, `?.`
	 * swallowed both listeners, the `host !== null` guard skipped the observer, and nothing
	 * ever looked again. The chart then kept `width`'s 800px starting guess for the rest of
	 * the session no matter how wide its card was, and `pointerRecent()` never saw a
	 * gesture, so every drag-zoom read as programmatic.
	 *
	 * Re-checking on each update costs one `querySelector` against a bound flag.
	 */
	private bindPlot(): void {
		const host = this.renderRoot.querySelector('.plot');
		if (host === null) return;

		// addEventListener de-duplicates on (type, callback, capture), so a stable callback
		// makes these idempotent across every re-render and any re-connection.
		host.addEventListener('pointerdown', this.markPointer, { capture: true });
		host.addEventListener('wheel', this.markPointer, { capture: true, passive: true });

		if (this.observer !== null || typeof ResizeObserver === 'undefined') return;
		this.observer = new ResizeObserver((entries) => {
			const next = Math.max(200, Math.floor(entries[0]!.contentRect.width));
			if (Math.abs(next - this.width) > 4) this.width = next;
		});
		this.observer.observe(host);
	}

	disconnectedCallback(): void {
		super.disconnectedCallback();
		this.observer?.disconnect();
		this.observer = null;
	}

	/**
	 * Pick the first couple of chartable fields, once.
	 *
	 * A chart that renders blank while showing ticked checkboxes is the prototype's most
	 * confusing behaviour; the user is left unsure whether the data or the app is broken.
	 */
	private autoSelect(): void {
		if (this.chosen.length > 0 || this.userCleared) return;
		const candidates = this.candidates();
		if (candidates.length === 0) return;
		this.chosen = candidates.slice(0, 2).map((candidate) => candidate.choice);
	}

	private candidates(): { choice: SeriesChoice; label: string; dataset: Dataset }[] {
		const out: { choice: SeriesChoice; label: string; dataset: Dataset }[] = [];
		for (const dataset of this.store.get().datasets) {
			for (const [key, paths] of dataset.fields) {
				const { actor } = splitActorKey(key);
				for (const [path, stats] of paths) {
					if (!isChartable(stats)) continue;
					out.push({
						choice: { datasetId: dataset.id, actorKey: key, path },
						label: `${actor} · ${path || t('chart.rootValue')}`,
						dataset,
					});
				}
			}
		}
		return out;
	}

	private specs(): SeriesSpec[] {
		const state = this.store.get();
		const specs: SeriesSpec[] = [];
		for (const choice of this.chosen) {
			const dataset = state.datasets.find((candidate) => candidate.id === choice.datasetId);
			if (dataset === undefined) continue;
			const { kind, actor } = splitActorKey(choice.actorKey);
			const column = dataset.columns.get(kind, actor, choice.path);
			if (column === undefined || column.n === 0) continue;
			specs.push({
				key: choiceKey(choice),
				label: `${dataset.tag} · ${actor} · ${choice.path || t('chart.rootValue')}`,
				colour: SERIES_COLOURS[specs.length % SERIES_COLOURS.length]!,
				column,
				offsetMs: datasetOffset(state, dataset),
				stepped: kind === 'decision',
			});
		}
		return specs;
	}

	render() {
		const state = this.store.get();
		const specs = this.specs();
		const built = buildChartData({
			series: specs,
			viewport: state.viewport,
			plotWidthPx: this.width,
			devicePixelRatio: typeof devicePixelRatio === 'number' ? devicePixelRatio : 1,
		});

		return html`
			<header>
				${this.picker()}
				<div class="legend">
					${specs.map(
						(spec) => html`<span
							><i class="dash" style="background:${spec.colour}"></i>${spec.label}
							${built.scales.get(spec.key) === 'y' ? '' : `(${built.scales.get(spec.key)})`}</span
						>`,
					)}
				</div>
				<span class="spacer"></span>
				<button
					title=${t('chart.remove')}
					aria-label=${t('chart.remove')}
					@click=${() =>
						this.dispatchEvent(new CustomEvent('remove-chart', { detail: { id: this.chartId }, bubbles: true, composed: true }))}
				>
					<span aria-hidden="true">×</span>
				</button>
			</header>

			${specs.length === 0
				? html`<div class="empty">${t('chart.pickFields')}</div>`
				: html`
						<!--
							The plot is pixels. A canvas exposes nothing to a screen reader, so without a
							name it is announced as an empty graphic, or skipped. role=img plus a label
							naming the series and the span is the honest summary — the per-point values
							stay in the timeline below, which is already a list of real text.
						-->
						<div class="plot" role="img" aria-label=${this.plotLabel(specs)}>
							<motrix-uplot .data=${built.data as uPlot.AlignedData} .options=${this.uplotOptions(specs, built.scales)}></motrix-uplot>
						</div>
						<div class="note">
							${plural('chart.pointsDrawn', built.drawn, { samples: built.sampledFrom })}${state.viewport === null
								? ''
								: t('chart.zoomed')}
						</div>
					`}
		`;
	}

	private picker() {
		const candidates = this.candidates();
		const byActor = new Map<string, typeof candidates>();
		for (const candidate of candidates) {
			const group = `${candidate.dataset.tag} — ${splitActorKey(candidate.choice.actorKey).actor}`;
			const list = byActor.get(group) ?? [];
			list.push(candidate);
			byActor.set(group, list);
		}

		return html`
			<details class="picker">
				<summary>${t('chart.fields', { n: this.chosen.length })}</summary>
				<div class="menu">
					${[...byActor.entries()].map(
						([group, items]) => html`
							<div class="group">
								<div class="group-title">${group}</div>
								${items.map((item) => {
									const key = choiceKey(item.choice);
									const checked = this.chosen.some((choice) => choiceKey(choice) === key);
									return html`
										<label class="field">
											<input type="checkbox" .checked=${checked} @change=${() => this.toggle(item.choice)} />
											${item.choice.path || t('chart.rootValue')}
										</label>
									`;
								})}
							</div>
						`,
					)}
					${candidates.length === 0 ? html`<div class="group-title">${t('chart.noFields')}</div>` : nothing}
				</div>
			</details>
		`;
	}

	private toggle(choice: SeriesChoice): void {
		const key = choiceKey(choice);
		this.chosen = this.chosen.some((existing) => choiceKey(existing) === key)
			? this.chosen.filter((existing) => choiceKey(existing) !== key)
			: [...this.chosen, choice];
		this.userCleared = this.chosen.length === 0;
	}

	/**
	 * Resolve a CSS custom property to a literal colour, for the canvas.
	 *
	 * uPlot paints the axes into a `<canvas>`, and `ctx.fillStyle = 'var(--text-secondary)'`
	 * is not a colour the canvas API understands. An unparseable assignment to `fillStyle`
	 * is **silently ignored** — no throw, no warning — so the context keeps the value it
	 * already held, which on a fresh context is opaque black. Every axis label, tick and
	 * grid line was therefore painted #000 on a #1a1d27 panel: a contrast ratio of about
	 * 1.25:1, against the 4.5:1 WCAG AA asks for. The series lines were never affected
	 * because `SERIES_COLOURS` are already literal hex.
	 *
	 * Custom properties inherit across the shadow boundary, so the card's own computed
	 * style resolves the same token the CSS would have. The fallback covers the one case
	 * that has no computed style to read: `getComputedStyle` on a disconnected element.
	 */
	private token(name: string, fallback: string): string {
		const value = getComputedStyle(this).getPropertyValue(name).trim();
		return value === '' ? fallback : value;
	}

	private uplotOptions(specs: readonly SeriesSpec[], scales: ReadonlyMap<string, string>): uPlot.Options {
		const state = this.store.get();
		const elapsedBase = state.alignment === 't0' ? this.earliest() : 0;
		// Hoisted for the same reason `elapsedBase` above it is: the tick formatter runs per
		// split, per draw, and `spanOf` walks every spec each time.
		const spanMs = this.spanOf(specs);
		// Resolved to literal colours here, once per options build, because the canvas cannot
		// read a var(). See `token` above for what used to happen when it tried.
		const axisInk = this.token('--text-secondary', '#AFC2CD');
		const gridInk = this.token('--border', '#244358');

		return {
			width: this.width,
			height: PLOT_HEIGHT,
			ms: 1,
			// One shared sync key across every card gives native crosshair AND x-zoom sync in
			// one line. `setSeries: false` because series indices differ per chart — syncing
			// them would highlight an unrelated trace.
			cursor: { sync: { key: this.syncKey, setSeries: false, scales: ['x', null] } },
			legend: { show: false },
			scales: {
				x: { time: false },
				y: { auto: true },
				y2: { auto: true },
				y3: { auto: true },
			},
			axes: [
				{
					stroke: axisInk,
					grid: { stroke: gridInk, width: 1 },
					ticks: { stroke: gridInk },
					// uPlot's default of 50px is sized for a bare `HH:MM`. These labels carry a
					// date as well, so at the default the axis packs them edge to edge and they
					// read as one unbroken string of digits.
					space: 96,
					size: 34,
					values: (_u, splits) =>
						splits.map((t) => (state.alignment === 't0' ? formatElapsed(t - elapsedBase) : formatAxisTick(t, spanMs))),
				},
				{
					scale: 'y',
					stroke: axisInk,
					grid: { stroke: gridInk, width: 1 },
					values: (_u, splits) => splits.map(formatValue),
				},
				{
					scale: 'y2',
					side: 1,
					stroke: axisInk,
					grid: { show: false },
					values: (_u, splits) => splits.map(formatValue),
				},
			],
			series: [
				{},
				...specs.map((spec) => ({
					label: spec.label,
					stroke: spec.colour,
					width: 1.5,
					scale: scales.get(spec.key) ?? 'y',
					// A decision holds its value until the next one; a reading is sampled.
					paths: spec.stepped ? STEPPED : undefined,
					points: { show: false },
					spanGaps: false,
				})),
			],
			hooks: {
				setScale: [
					(u, key) => {
						if (key !== 'x') return;
						// Ours, not the user's. A COUNTER rather than a boolean: uPlot's cursor
						// sync fans one setScale out to every joined chart and those hooks fire
						// synchronously, so a boolean would be cleared by an inner return while
						// the outer call was still unwinding.
						if (this.programmatic > 0) return;
						// uPlot fires setScale for its OWN auto-range too — on the very first
						// paint, and again whenever the series set changes. Treating that as a
						// user zoom switched follow mode off before the first frame was on
						// screen, so following never actually worked. uPlot has no keyboard
						// zoom: every real zoom is a drag or a double-click on this plot, so a
						// recent pointer gesture is the honest signal for "a person did this".
						if (!this.pointerRecent()) return;
						const { min, max } = u.scales.x;
						if (min === undefined || max === undefined) return;
						// Epoch numbers, always. The prototype round-tripped its chart library's
						// non-ISO date strings through new Date() and re-localised them.
						this.dispatchEvent(
							new CustomEvent('viewport-change', { detail: { min, max }, bubbles: true, composed: true }),
						);
					},
				],
			},
		};
	}

	private spanOf(specs: readonly SeriesSpec[]): number {
		const viewport = this.store.get().viewport;
		if (viewport !== null) return viewport[1] - viewport[0];
		let min = Infinity;
		let max = -Infinity;
		for (const spec of specs) {
			if (spec.column.n === 0) continue;
			min = Math.min(min, spec.column.t[0]! + spec.offsetMs);
			max = Math.max(max, spec.column.t[spec.column.n - 1]! + spec.offsetMs);
		}
		return Number.isFinite(min) && Number.isFinite(max) ? max - min : 0;
	}

	private earliest(): number {
		let min = Infinity;
		for (const dataset of this.store.get().datasets) if (Number.isFinite(dataset.tMin)) min = Math.min(min, dataset.tMin);
		return Number.isFinite(min) ? min : 0;
	}

	/**
	 * The accessible name for the plot.
	 *
	 * Names the series and the x range, which is what the axes say to someone who can see
	 * them. It deliberately does not try to describe the shape of the traces: any summary
	 * of "rises then flattens" would be this component's opinion rather than the data, and
	 * the timeline underneath already lists every reading and decision as real text — that
	 * is the accessible equivalent of the points, and it is greppable besides.
	 */
	private plotLabel(specs: readonly SeriesSpec[]): string {
		let min = Infinity;
		let max = -Infinity;
		for (const spec of specs) {
			if (spec.column.n === 0) continue;
			min = Math.min(min, spec.column.t[0]! + spec.offsetMs);
			max = Math.max(max, spec.column.t[spec.column.n - 1]! + spec.offsetMs);
		}
		const spanMs = Number.isFinite(min) && Number.isFinite(max) ? max - min : 0;
		const bounds = Number.isFinite(min)
			? { from: formatAxisTick(min, spanMs), to: formatAxisTick(max, spanMs) }
			: { from: '—', to: '—' };
		return t('chart.plotLabel', { n: specs.length, series: specs.map((spec) => spec.label).join(', '), ...bounds });
	}
}

/**
 * Decisions are drawn stepped, readings interpolated.
 *
 * A control command is not a sample of a continuous signal — it is a value that holds
 * until the next command. Drawing a straight line between two setpoints invents a ramp
 * that never happened.
 */
const STEPPED = uPlot.paths.stepped!({ align: 1 });

declare global {
	interface HTMLElementTagNameMap {
		'motrix-chart-card': MotrixChartCard;
	}
	interface HTMLElementEventMap {
		'remove-chart': CustomEvent<{ id: string }>;
		'viewport-change': CustomEvent<{ min: number; max: number }>;
	}
}
