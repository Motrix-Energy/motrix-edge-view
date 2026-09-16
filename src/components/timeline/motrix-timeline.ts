import '@lit-labs/virtualizer';

import { consume } from '@lit/context';
import { LitElement, css, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import { splitActorKey } from '../../core/ingest.js';
import { mergeDatasets, type MergeInput, type MergedIndex } from '../../core/merge.js';
import { formatDay, formatFull, formatSpanAware, startOfNextDay } from '../../core/time.js';
import type { EventKind, NormalisedEvent } from '../../core/types.js';
import type { MessageKey } from '../../i18n/catalogue.js';
import { kindLabel } from '../../i18n/live-states.js';
import { compare, plural, t } from '../../i18n/translator.js';
import { datasetOffset, overallSpan, type Dataset } from '../../state/app-state.js';
import { AppStore, storeContext } from '../../state/actions.js';
import { base, tokens } from '../../styles/tokens.css.js';
import { StoreController } from '../common/store-controller.js';

interface Row {
	readonly kind: 'event' | 'day';
	readonly t: number;
	readonly dataset: Dataset;
	readonly event: NormalisedEvent;
	readonly index: number;
}

@customElement('motrix-timeline')
export class MotrixTimeline extends LitElement {
	static styles = [
		tokens,
		base,
		css`
			:host {
				display: flex;
				flex-direction: column;
				min-height: 0;
				height: 100%;
			}

			header {
				display: flex;
				gap: 8px;
				align-items: center;
				flex-wrap: wrap;
				padding: 8px 12px;
				border-bottom: 1px solid var(--border);
				font-size: 13px;
				flex: 0 0 auto;
			}

			h2 {
				margin: 0;
				font-size: 13px;
				font-weight: 600;
			}

			select,
			input[type='search'] {
				background: var(--bg-tertiary);
				color: inherit;
				border: 1px solid var(--border);
				border-radius: 6px;
				padding: 4px 6px;
				font: inherit;
				font-size: 12px;
			}

			input[type='search'] {
				min-width: 16ch;
			}

			.count {
				color: var(--text-secondary);
				font-size: 12px;
				margin-left: auto;
			}

			lit-virtualizer {
				flex: 1 1 auto;
				/* !important, which is otherwise never used in this codebase, because the
				   competing declaration is an inline style written by the virtualizer itself
				   and inline beats any selector. Even as a scroller it stamps a min-height
				   echoing its last measured height, which is a tick behind the flex layout —
				   so the element floors itself a few pixels taller than the space it was
				   given, and the host overflows by exactly that much into an ancestor that is
				   overflow:hidden. Flex must be free to size this; the scroll length comes
				   from the virtualizer's internal spacer, not from this box. */
				min-height: 0 !important;
				overflow: auto;
				font-family: var(--font-mono);
				font-size: 12px;
			}

			.row {
				display: flex;
				align-items: baseline;
				gap: 10px;
				padding: 3px 12px;
				border-bottom: 1px solid color-mix(in srgb, var(--border) 45%, transparent);
				cursor: pointer;
				white-space: nowrap;
			}

			.row:hover {
				background: var(--bg-secondary);
			}

			.row.selected {
				background: color-mix(in srgb, var(--accent) 18%, transparent);
			}

			.day {
				position: sticky;
				top: 0;
				z-index: 1;
				background: var(--bg-tertiary);
				color: var(--text-secondary);
				padding: 3px 12px;
				border-bottom: 1px solid var(--border);
				font-weight: 600;
			}

			.dot {
				width: 8px;
				height: 8px;
				border-radius: 50%;
				flex: 0 0 auto;
			}

			.time {
				color: var(--text-secondary);
				flex: 0 0 auto;
			}

			.source {
				color: var(--text-primary);
				font-weight: 600;
				flex: 0 0 auto;
			}

			/* A replay input's target is its topic, not a device it acted on, so the arrow must
			   not borrow the decision colour and imply an actuation that never happened. */
			.arrow {
				color: var(--text-secondary);
				flex: 0 0 auto;
			}

			.arrow.decision {
				color: var(--decision-color);
			}

			.payload {
				color: var(--text-muted);
				overflow: hidden;
				text-overflow: ellipsis;
				flex: 1 1 auto;
			}

			.expanded {
				padding: 8px 12px 12px 40px;
				background: var(--bg-secondary);
				border-bottom: 1px solid var(--border);
				white-space: pre-wrap;
				word-break: break-word;
				color: var(--text-primary);
				max-height: 320px;
				overflow: auto;
			}

			.empty {
				padding: 24px;
				color: var(--text-muted);
				text-align: center;
			}
		`,
	];

	@consume({ context: storeContext }) store!: AppStore;
	@state() private expanded: number | null = null;

	// Held only for their subscriptions; see StoreController. Four separate selectors
	// rather than one on the whole state, so an unrelated write does not rebuild the
	// merged index.
	readonly datasetsSub = new StoreController(this, () => this.store, (s) => s.datasets);
	readonly filterSub = new StoreController(this, () => this.store, (s) => s.filter);
	readonly alignmentSub = new StoreController(this, () => this.store, (s) => s.alignment);
	readonly selectedSub = new StoreController(this, () => this.store, (s) => s.selectedRow);
	readonly localeSub = new StoreController(this, () => this.store, (s) => s.locale);

	private inputs: MergeInput[] = [];
	private index: MergedIndex = { datasetOrdinal: new Uint32Array(0), localIndex: new Uint32Array(0), length: 0 };
	private rows: Row[] = [];

	render() {
		const state = this.store.get();
		this.rebuild();

		const span = overallSpan(state);
		const spanMs = span === null ? 0 : span[1] - span[0];

		return html`
			<header>
				<h2>${t('timeline.title')}</h2>
				${this.facet(
					'timeline.facet.dataset',
					'timeline.facet.allDatasets',
					state.datasets.map((d) => [d.id, d.tag] as const),
					state.filter.datasets,
					(set) => this.store.setFilter({ datasets: set }),
				)}
				${this.facet(
					'timeline.facet.kind',
					'timeline.facet.allKinds',
					this.kinds(),
					state.filter.kinds as ReadonlySet<string> | null,
					(set) => this.store.setFilter({ kinds: set as ReadonlySet<EventKind> | null }),
				)}
				${this.facet('timeline.facet.actor', 'timeline.facet.allActors', this.actors(), state.filter.actors, (set) =>
					this.store.setFilter({ actors: set }),
				)}
				<!-- Labelled as well as hinted: a placeholder is only a *fallback* accessible
				     name, and it is the one that disappears the moment the field has content —
				     so the control would lose its name exactly when it starts to matter. -->
				<input
					type="search"
					placeholder=${t('timeline.search')}
					aria-label=${t('timeline.search')}
					.value=${state.filter.text ?? ''}
					@input=${(event: Event) => this.store.setFilter({ text: (event.target as HTMLInputElement).value || null })}
				/>
				${state.filter.window === null
					? nothing
					: html`<button @click=${() => this.store.setViewport(null)}>${t('timeline.clearZoom')}</button>`}
				<span class="count">${plural('timeline.shown', this.index.length)}</span>
			</header>
			${this.rows.length === 0
				? html`<div class="empty">
						${state.datasets.length === 0 ? t('timeline.emptyNoData') : t('timeline.emptyFiltered')}
					</div>`
				: html`
						<!--
							The scroller attribute makes the virtualizer its own scroll container, and
							it is load-bearing rather than cosmetic. Without it the virtualizer runs in
							its default mode, where some *ancestor* is assumed to scroll: it stamps an
							inline min-height equal to the full height of every row — 110 000px for a
							ten-day run — so the ancestor's scrollbar comes out the right length. An
							inline min-height beats the min-height:0 in this component's stylesheet, so
							flex:1 1 auto could never compress it, and the overflow:auto alongside was
							inert because the element was always exactly as tall as its content.
							Nothing in the app scrolls that ancestor either: motrix-app is
							overflow:hidden by design.
						-->
						<lit-virtualizer
							scroller
							.items=${this.rows}
							.renderItem=${(row: Row, i: number) => this.renderRow(row, i, spanMs)}
						></lit-virtualizer>
					`}
		`;
	}

	/**
	 * Rebuild the merged index.
	 *
	 * Cheap enough to do on render because the merge is O(total) over already-sliced ranges
	 * and Lit batches renders to a microtask — where the prototype ran up to three full
	 * `Array.filter` passes per zoom event, unthrottled against the chart's own stream.
	 */
	private rebuild(): void {
		const state = this.store.get();
		this.inputs = state.datasets.map((dataset) => ({
			id: dataset.id,
			events: dataset.events,
			offsetMs: datasetOffset(state, dataset),
		}));
		this.index = mergeDatasets(this.inputs, state.filter);

		const rows: Row[] = [];
		// A numeric threshold rather than `formatDay(t) !== lastDay`. Formatting per event
		// meant one `Date` plus three padded strings for each of up to 200 000 rows, on every
		// render, to answer a question that is one comparison — and `formatDay` then runs
		// again in `renderRow` for the one separator actually on screen. Merged rows ascend,
		// so the threshold only ever moves forward; recomputing it from the current instant
		// handles a jump of several days. Calendar arithmetic, so it stays DST-correct.
		let nextDayStart = -Infinity;
		for (let i = 0; i < this.index.length; i++) {
			const dataset = state.datasets[this.index.datasetOrdinal[i]!]!;
			const event = dataset.events[this.index.localIndex[i]!]!;
			const t = event.t + this.inputs[this.index.datasetOrdinal[i]!]!.offsetMs;
			if (t >= nextDayStart) {
				// A sticky separator whenever the date changes. The prototype showed
				// HH:MM:SS with no date at all, which over a ten-day span made every row
				// ambiguous.
				rows.push({ kind: 'day', t, dataset, event, index: i });
				nextDayStart = startOfNextDay(t);
			}
			rows.push({ kind: 'event', t, dataset, event, index: i });
		}
		this.rows = rows;
	}

	private renderRow(row: Row | undefined, position: number, spanMs: number) {
		// The virtualizer measures against one row list and renders against the next, so when
		// a filter shrinks the index mid-frame it asks for a position that no longer exists.
		// Undefined is a legitimate argument here, not a bug upstream — render nothing and let
		// the next frame settle.
		if (row === undefined) return nothing;
		if (row.kind === 'day') return html`<div class="day">${formatDay(row.t)}</div>`;

		const event = row.event;
		const isExpanded = this.expanded === position;
		return html`
			<div
				class="row ${this.store.get().selectedRow === row.index ? 'selected' : ''}"
				@click=${() => this.toggle(position, row.index)}
			>
				<span class="dot" style="background:${event.kind === 'decision' ? 'var(--decision-color)' : row.dataset.colour}"></span>
				<span class="time" title=${formatFull(row.t)}>${formatSpanAware(row.t, spanMs)}</span>
				<span class="source">${event.source}</span>
				${event.target === null
					? nothing
					: html`<span class="arrow ${event.kind === 'decision' ? 'decision' : ''}">→ ${event.target}</span>`}
				<span class="payload">${event.preview}</span>
			</div>
			${isExpanded ? html`<div class="expanded">${this.pretty(event)}</div>` : nothing}
		`;
	}

	/**
	 * Pretty-print on expand only.
	 *
	 * The row preview was budgeted once at ingest; this is the only place the full payload
	 * is ever materialised, and only for the one row the user asked about.
	 */
	private pretty(event: NormalisedEvent): string {
		try {
			return JSON.stringify(JSON.parse(event.raw), null, 2);
		} catch {
			return event.raw;
		}
	}

	private toggle(position: number, index: number): void {
		this.expanded = this.expanded === position ? null : position;
		this.store.selectRow(index);
	}

	private kinds(): readonly (readonly [string, string])[] {
		// `kindCounts`, not a walk of every event of every dataset: this ran on every render,
		// including every keystroke in the search box, and at the 200 000-event retention cap
		// it is the scan `core/merge.ts`'s index exists to make unnecessary. The store keeps
		// the tally as batches arrive and retention decrements it, so a kind that has aged
		// out stops being offered.
		const present = new Set<string>();
		for (const dataset of this.store.get().datasets) for (const kind of dataset.kindCounts.keys()) present.add(kind);
		// The four EventKind values are a closed enum in core/types.ts, so translating them
		// is safe — unlike the device and algorithm names they sit beside in the dropdown,
		// which are operator-chosen data and are never touched.
		return [...present].sort().map((kind) => [kind, kindLabel(kind)] as const);
	}

	/**
	 * Devices and algorithms share one facet.
	 *
	 * Not a shortcut — it is what makes the intersection honest. With separate facets the
	 * natural implementation narrows each event type independently, which is the prototype's
	 * behaviour and reads as a bug: picking a device left every decision on screen.
	 */
	private actors(): readonly (readonly [string, string])[] {
		const present = new Map<string, string>();
		for (const dataset of this.store.get().datasets) {
			for (const key of dataset.fields.keys()) {
				const { kind, actor } = splitActorKey(key);
				present.set(actor, t('timeline.actorOption', { actor, kind: kindLabel(kind) }));
			}
		}
		// Sorted by the actor — the data key — not by the rendered label. Sorting by label
		// would reorder the whole dropdown when the language changes, because "(reading)"
		// becomes "(relevé)". `compare` is numeric-aware, so sensor10 also stops sorting
		// before sensor2.
		return [...present.entries()].sort((a, b) => compare(a[0], b[0]));
	}

	/**
	 * `allKey` is a whole separate string, not `All ${label}s`.
	 *
	 * Not a plural problem: French gender makes the determiner un-computable from the noun
	 * ("Tous les types" but "Toutes les sources"), and lowercasing a label is meaningless in
	 * German, where every noun is capitalised.
	 */
	private facet(
		labelKey: MessageKey,
		allKey: MessageKey,
		options: readonly (readonly [string, string])[],
		selected: ReadonlySet<string> | null,
		apply: (set: ReadonlySet<string> | null) => void,
	) {
		if (options.length === 0) return nothing;
		return html`
			<select
				title=${t('timeline.facet.title', { label: t(labelKey) })}
				@change=${(event: Event) => {
					const value = (event.target as HTMLSelectElement).value;
					apply(value === '' ? null : new Set([value]));
				}}
			>
				<option value="" ?selected=${selected === null}>${t(allKey)}</option>
				${options.map(
					([value, text]) => html`<option value=${value} ?selected=${selected?.has(value) ?? false}>${text}</option>`,
				)}
			</select>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'motrix-timeline': MotrixTimeline;
	}
}
