import { consume } from '@lit/context';
import { LitElement, css, html, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';

import { formatDuration } from '../../core/time.js';
import { compact, durationUnits, t } from '../../i18n/translator.js';
import { AppStore, storeContext } from '../../state/actions.js';
import { overallSpan, totalEvents } from '../../state/app-state.js';
import { base, tokens } from '../../styles/tokens.css.js';
import { StoreController } from '../common/store-controller.js';
import '../datasets/motrix-dropzone.js';
import '../datasets/motrix-live-connect.js';
import '../topology/motrix-topology-panel.js';

/**
 * The storage-format version this build reads.
 *
 * Mirrors `motrixStorageFormat` in package.json, which `test/fixtures.test.ts` already checks
 * against the EMS's own manifest — so this string cannot drift from the contract silently.
 */
const STORAGE_FORMAT = '1.0';

/**
 * The front door: what this is, the two ways in, and what it cannot tell you.
 *
 * A hub rather than a splash. Two of its five blocks are limitations, on purpose — the
 * ones that stop somebody misreading a chart are worth more than a feature list. The
 * dropzone here is the **real** component, not a link to it, so the shortest path from
 * opening the app to seeing data is one drag.
 */
@customElement('motrix-home')
export class MotrixHome extends LitElement {
	static styles = [
		tokens,
		base,
		css`
			:host {
				flex: 1 1 auto;
				min-height: 0;
				overflow: auto;
				display: block;
				padding: 40px 40px 64px;
			}

			/*
			 * 1180px, not the 72ch this used to be. A ch measure is the right rule for a
			 * column of prose and the wrong one for a page that is mostly a two-card grid, a
			 * stats bar and a list: at 72ch the cards were squeezed under 300px each on a
			 * display with four times that free, the dropzone — the one thing this page exists
			 * to offer — wrapped its own label onto six lines, and everything sat in a narrow
			 * ribbon down the middle. The prose keeps its own measure via .prose below, so
			 * widening the page does not cost line length where line length matters.
			 */
			.page {
				max-width: 1180px;
				margin: 0 auto;
				display: flex;
				flex-direction: column;
				gap: 34px;
			}

			h2 {
				margin: 0;
				font-size: 24px;
				font-weight: 800;
				letter-spacing: -0.02em;
			}

			/* The page's own lockup — larger than the navbar's, and flush left. */
			.hero {
				display: flex;
				align-items: center;
				gap: 14px;
				margin: 0 0 10px;
			}

			.hero .mark {
				height: 44px;
				width: auto;
				flex: none;
			}

			.hero .kicker {
				display: block;
				margin-top: 3px;
				font-size: 10px;
				font-weight: 600;
				letter-spacing: 0.3em;
				color: var(--accent);
			}

			/* The reading measure the page as a whole no longer imposes. */
			.prose {
				max-width: 68ch;
			}

			.lede {
				margin: 0;
				color: var(--text-secondary);
				font-size: 15px;
				line-height: 1.65;
			}

			/* auto-fit collapses to one column on a narrow window with no media query. */
			.paths {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
				gap: 22px;
				/*
				 * Each card as tall as its own content. The grid default of stretch matched
				 * the live card to the file card, which is much taller — a dropzone plus a
				 * paragraph plus the topology panel — and the auto top margin on .actions then
				 * shoved its two buttons to the far bottom, leaving 150px of empty panel above
				 * them that reads as content which failed to load.
				 */
				align-items: start;
			}

			.card {
				background: var(--bg-secondary);
				border: 1px solid var(--border);
				border-radius: var(--radius);
				padding: 22px;
				display: flex;
				flex-direction: column;
				gap: 14px;
			}

			.card h3 {
				margin: 0;
				font-size: 14px;
				font-weight: 600;
			}

			.card p {
				margin: 0;
				font-size: 13px;
				line-height: 1.6;
				color: var(--text-secondary);
			}

			.card .status {
				display: flex;
				align-items: center;
				gap: 7px;
				font-size: 13px;
			}

			.dot {
				width: 8px;
				height: 8px;
				border-radius: 50%;
				background: var(--text-muted);
				flex: 0 0 auto;
			}

			.dot.reachable {
				background: var(--success);
			}

			.actions {
				margin-top: auto;
				display: flex;
				gap: 8px;
			}

			button.primary {
				background: var(--accent);
				border-color: var(--accent);
				/* Ink, not #fff. The accent is a bright teal — white on it is 1.6:1. */
				color: var(--bg-primary);
				padding: 7px 14px;
				font-size: 13px;
			}

			.loaded {
				background: var(--bg-secondary);
				border: 1px solid var(--border);
				border-left: 3px solid var(--accent);
				border-radius: var(--radius);
				padding: 12px 16px;
				display: flex;
				align-items: center;
				gap: 20px;
				flex-wrap: wrap;
			}

			.loaded dl {
				margin: 0;
				display: flex;
				gap: 20px;
				flex-wrap: wrap;
			}

			.loaded div {
				display: flex;
				flex-direction: column;
				gap: 2px;
			}

			.loaded dt {
				font-size: 11px;
				text-transform: uppercase;
				letter-spacing: 0.04em;
				color: var(--text-muted);
			}

			.loaded dd {
				margin: 0;
				font-size: 14px;
				font-variant-numeric: tabular-nums;
			}

			.loaded .actions {
				margin-left: auto;
			}

			.notes h3 {
				margin: 0 0 10px;
				font-size: 13px;
				font-weight: 600;
				color: var(--text-secondary);
			}

			/*
			 * Two columns once there is room. These five items are independent caveats read
			 * in any order, not a sequence, so pairing them up costs nothing and keeps each
			 * line near its reading measure — a single column across 1180px would undo
			 * exactly what widening the page was for.
			 */
			.notes ul {
				margin: 0;
				padding: 0;
				list-style: none;
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
				gap: 10px 36px;
			}

			.notes li {
				font-size: 13px;
				line-height: 1.55;
				color: var(--text-secondary);
				padding-left: 14px;
				position: relative;
			}

			.notes li::before {
				content: '';
				position: absolute;
				left: 0;
				top: 8px;
				width: 5px;
				height: 5px;
				border-radius: 50%;
				background: var(--border);
			}

			.notes strong {
				color: var(--text-primary);
				font-weight: 600;
			}

			footer {
				font-size: 12px;
				color: var(--text-muted);
				border-top: 1px solid var(--border);
				padding-top: 14px;
			}
		`,
	];

	@consume({ context: storeContext })
	store!: AppStore;

	readonly datasetsSub = new StoreController(this, () => this.store, (s) => s.datasets);
	readonly probeSub = new StoreController(this, () => this.store, (s) => s.liveProbe);
	readonly decisionsSub = new StoreController(this, () => this.store, (s) => s.liveDecisions);
	readonly localeSub = new StoreController(this, () => this.store, (s) => s.locale);

	render() {
		const state = this.store.get();
		return html`
			<div class="page">
				<div class="prose">
					<div class="hero">
						<svg class="mark" viewBox="6 24 108 80" aria-hidden="true">
						<defs>
							<linearGradient id="home-flow" x1="14" y1="0" x2="106" y2="0" gradientUnits="userSpaceOnUse">
								<stop offset="0" stop-color="#2FE6C8" />
								<stop offset="1" stop-color="#FFB443" />
							</linearGradient>
						</defs>
						<path
							d="M22 73 L22 34 L60 70 L98 34 L98 73"
							fill="none"
							stroke="url(#home-flow)"
							stroke-width="11"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
						<circle cx="22" cy="88" r="8" fill="none" stroke="#2FE6C8" stroke-width="6.5" />
						<circle cx="98" cy="88" r="8" fill="none" stroke="#FFB443" stroke-width="6.5" />
					</svg>
						<div>
							<h2>Motrix Edge View</h2>
							<span class="kicker">EDGE VIEW</span>
						</div>
					</div>
					<p class="lede">${t('home.lede')}</p>
				</div>

				${state.datasets.length > 0 ? this.loaded() : nothing}

				<div class="paths">
					<section class="card">
						<h3>${t('home.files.title')}</h3>
						<motrix-dropzone></motrix-dropzone>
						<p>
							${t('home.files.body', {
								readings: 'device_data.csv',
								decisions: 'algorithm_decisions.csv',
								backend: 'csv_file',
								replay: 'replay.csv',
								config: 'config.json',
							})}
						</p>
						<motrix-topology-panel></motrix-topology-panel>
					</section>

					<section class="card">
						<h3>${t('home.live.title')}</h3>
						<div class="status">
							<span class="dot ${state.liveProbe}" aria-hidden="true"></span>
							<span>${this.liveHeadline()}</span>
						</div>
						<p>${this.liveDetail()}</p>
						<div class="actions">
							<motrix-live-connect></motrix-live-connect>
							<button type="button" @click=${() => this.store.setView('live')}>${t('home.live.open')}</button>
						</div>
					</section>
				</div>

				<section class="notes">
					<h3>${t('home.notes.title')}</h3>
					<ul>
						<li>
						${state.liveDecisions === 'available'
							? html`<strong>${t('home.notes.decisionsLiveLead')}</strong> ${t('home.notes.decisionsLive')}`
							: html`<strong>${t('home.notes.decisionsLead')}</strong> ${t('home.notes.decisions')}`}
					</li>
						<li>
							<strong>${t('home.notes.sampledLead')}</strong>
							${t('home.notes.sampled', { devices: '/devices' })}
						</li>
						<li><strong>${t('home.notes.gapsLead')}</strong> ${t('home.notes.gaps')}</li>
						<li><strong>${t('home.notes.zoneLead')}</strong> ${t('home.notes.zone')}</li>
						<li><strong>${t('home.notes.localLead')}</strong> ${t('home.notes.local')}</li>
					</ul>
				</section>

				<footer>${t('home.footer', { version: STORAGE_FORMAT })}</footer>
			</div>
		`;
	}

	/** Never a dead end: reaching Home with data loaded must show a way back to it. */
	private loaded() {
		const state = this.store.get();
		const span = overallSpan(state);
		return html`
			<div class="loaded">
				<dl>
					<div>
						<dt>${t('home.loaded.datasets')}</dt>
						<dd>${state.datasets.length}</dd>
					</div>
					<div>
						<dt>${t('home.loaded.events')}</dt>
						<dd>${compact(totalEvents(state))}</dd>
					</div>
					<div>
						<dt>${t('home.loaded.span')}</dt>
						<dd>${span === null ? '—' : formatDuration(span[1] - span[0], durationUnits())}</dd>
					</div>
				</dl>
				<div class="actions">
					<button type="button" class="primary" @click=${() => this.store.setView('workspace')}>
						${t('home.loaded.open')}
					</button>
				</div>
			</div>
		`;
	}

	private liveHeadline(): string {
		switch (this.store.get().liveProbe) {
			case 'pending':
				return t('home.live.pending');
			case 'reachable':
				return t('home.live.reachable');
			case 'unreachable':
				return t('home.live.unreachable');
		}
	}

	private liveDetail(): string {
		switch (this.store.get().liveProbe) {
			case 'pending':
				return t('home.live.pendingDetail');
			case 'reachable':
				return t('home.live.reachableDetail');
			case 'unreachable':
				// The honest explanation, not an error: this is the expected result for the
				// app's primary distribution — a downloaded file, double-clicked.
				return t('home.live.unreachableDetail');
		}
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'motrix-home': MotrixHome;
	}
}
