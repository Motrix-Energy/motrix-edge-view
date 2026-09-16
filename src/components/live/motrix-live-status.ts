import { consume } from '@lit/context';
import { LitElement, css, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import { formatDuration } from '../../core/time.js';
import type { MessageKey } from '../../i18n/catalogue.js';
import {
	HEALTH_STATUS_KEYS,
	HEALTH_STATUS_UNKNOWN,
	WORKER_STATE_KEYS,
	WORKER_STATE_UNKNOWN,
	labelKey,
} from '../../i18n/live-states.js';
import { durationUnits, n, plural, t } from '../../i18n/translator.js';
import {
	checkDevicesResponse,
	checkHealthResponse,
	checkWorkersResponse,
	type ApiDevice,
	type ApiWorker,
	type DevicesResponse,
	type HealthResponse,
	type WorkersResponse,
} from '../../sources/live/api-types.js';
import { AppStore, storeContext } from '../../state/actions.js';
import { isLiveAvailable } from '../../state/app-state.js';
import { base, tokens } from '../../styles/tokens.css.js';
import { StoreController } from '../common/store-controller.js';
import '../datasets/motrix-live-connect.js';

/** Slow enough to be polite: every /health costs the EMS a deep copy of every device. */
const PAGE_INTERVAL_MS = 5000;

/**
 * The EMS's snapshot state: health, clock, devices, workers.
 *
 * A page rather than a dataset because none of this has a time axis — it is the live state
 * that never reaches storage. A live *time series* stays in the Workspace as one more
 * dataset, because the state model is a list and never a mode switch.
 *
 * It shares the store's `LiveFeed`, so opening this page while a live dataset is already
 * streaming costs no additional requests at all.
 */
@customElement('motrix-live-status')
export class MotrixLiveStatus extends LitElement {
	static styles = [
		tokens,
		base,
		css`
			:host {
				flex: 1 1 auto;
				min-height: 0;
				overflow: auto;
				display: block;
				padding: 24px 24px 40px;
			}

			.page {
				max-width: 92ch;
				margin: 0 auto;
				display: flex;
				flex-direction: column;
				gap: 18px;
			}

			h2 {
				margin: 0 0 8px;
				font-size: 17px;
				font-weight: 600;
			}

			h3 {
				margin: 0;
				font-size: 13px;
				font-weight: 600;
			}

			.state {
				display: flex;
				align-items: center;
				gap: 10px;
				font-size: 14px;
				flex-wrap: wrap;
			}

			.dot {
				width: 9px;
				height: 9px;
				border-radius: 50%;
				background: var(--text-muted);
				flex: 0 0 auto;
			}

			.dot.ok,
			.dot.reachable {
				background: var(--success);
			}

			.dot.degraded {
				background: var(--warning);
			}

			.dot.down {
				background: var(--error);
			}

			section {
				background: var(--bg-secondary);
				border: 1px solid var(--border);
				border-radius: var(--radius);
				padding: 14px 16px;
				display: flex;
				flex-direction: column;
				gap: 10px;
			}

			p {
				margin: 0;
				font-size: 13px;
				line-height: 1.6;
				color: var(--text-secondary);
			}

			dl {
				margin: 0;
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
				gap: 12px 20px;
			}

			dl > div {
				display: flex;
				flex-direction: column;
				gap: 2px;
			}

			dt {
				font-size: 11px;
				text-transform: uppercase;
				letter-spacing: 0.04em;
				color: var(--text-muted);
			}

			dd {
				margin: 0;
				font-size: 14px;
				font-variant-numeric: tabular-nums;
			}

			.scroll {
				overflow-x: auto;
			}

			table {
				width: 100%;
				border-collapse: collapse;
				font-size: 12px;
			}

			th {
				text-align: left;
				font-weight: 600;
				color: var(--text-muted);
				font-size: 11px;
				text-transform: uppercase;
				letter-spacing: 0.04em;
				padding: 0 10px 6px 0;
				white-space: nowrap;
			}

			td {
				padding: 4px 10px 4px 0;
				border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
				white-space: nowrap;
			}

			td.mono {
				font-family: var(--font-mono);
				font-variant-numeric: tabular-nums;
			}

			.pill {
				display: inline-block;
				border: 1px solid var(--border);
				border-radius: 999px;
				padding: 1px 7px;
				font-size: 11px;
				margin-right: 4px;
				color: var(--text-secondary);
			}

			.yes {
				color: var(--success);
			}

			.no {
				color: var(--text-muted);
			}

			.bad {
				color: var(--error);
			}

			.warnish {
				color: var(--warning);
			}

			section.caveat {
				background: none;
				border: none;
				border-left: 3px solid var(--border);
				border-radius: 0;
				padding: 2px 0 2px 14px;
			}
		`,
	];

	@consume({ context: storeContext })
	store!: AppStore;

	readonly probeSub = new StoreController(this, () => this.store, (s) => s.liveProbe);
	readonly decisionsSub = new StoreController(this, () => this.store, (s) => s.liveDecisions);
	readonly authSub = new StoreController(this, () => this.store, (s) => s.auth);
	readonly localeSub = new StoreController(this, () => this.store, (s) => s.locale);

	/** Bumped on every poll, so the paused notice re-renders when visibility changes. */
	@state() private tick = 0;
	@state() private health: HealthResponse | null = null;
	@state() private devices: DevicesResponse | null = null;
	@state() private workers: WorkersResponse | null = null;

	private readonly unsubscribes: Array<() => void> = [];

	connectedCallback(): void {
		super.connectedCallback();
		const feed = this.store.liveFeed;
		// What renders is the *checked* response, never the raw one: this page maps over
		// `capabilities` and `clock.pending`, and a render that throws commits no DOM at all —
		// on this poll and on every one after it. The checked value has had the elements it
		// could not walk removed, so the rest of the EMS still reaches the screen.
		this.unsubscribes.push(
			feed.subscribe('health', PAGE_INTERVAL_MS, ({ result }) => {
				this.tick++;
				if (result.kind !== 'ok') return;
				const checked = checkHealthResponse(result.value);
				if (checked !== null) this.health = checked.value;
			}),
			feed.subscribe('devices', PAGE_INTERVAL_MS, ({ result }) => {
				if (result.kind !== 'ok') return;
				const checked = checkDevicesResponse(result.value);
				if (checked !== null) this.devices = checked.value;
			}),
			feed.subscribe('workers', PAGE_INTERVAL_MS, ({ result }) => {
				if (result.kind !== 'ok') return;
				const checked = checkWorkersResponse(result.value);
				if (checked !== null) this.workers = checked.value;
			}),
		);
	}

	disconnectedCallback(): void {
		// The feed refcounts, so leaving this page stops the polling it started and leaves
		// whatever a live dataset is doing entirely alone.
		for (const unsubscribe of this.unsubscribes) unsubscribe();
		this.unsubscribes.length = 0;
		super.disconnectedCallback();
	}

	render() {
		const state = this.store.get();
		return html`
			<div class="page">
				<div>
					<h2>${t('live.title')}</h2>
					<div class="state">
						<span class="dot ${this.health?.status ?? state.liveProbe}" aria-hidden="true"></span>
						<span>${this.headline()}</span>
						${isLiveAvailable(state) && state.auth.phase !== 'required'
							? html`<motrix-live-connect></motrix-live-connect>`
							: nothing}
					</div>
				</div>

				${this.pausedNotice()} ${this.health === null ? nothing : this.healthSection(this.health)}
				${this.health === null ? nothing : this.clockSection(this.health)}
				${this.devices === null ? nothing : this.deviceSection(this.devices)}
				${this.workers === null ? nothing : this.workerSection(this.workers)}
				${this.caveats()}
			</div>
		`;
	}

	private headline() {
		// `degraded` deliberately answers 200 on the EMS side, so this is the only place a
		// worker that crashed and recovered is visible without reading /workers.
		if (this.health !== null) {
			return this.enumLabel(labelKey(HEALTH_STATUS_KEYS, this.health.status), HEALTH_STATUS_UNKNOWN, this.health.status);
		}
		switch (this.store.get().liveProbe) {
			case 'pending':
				return t('live.pending');
			case 'reachable':
				return t('live.reachable');
			case 'unreachable':
				return t('live.unreachable');
		}
	}

	/**
	 * Label for an enum value that arrived off the wire.
	 *
	 * `key` is `undefined` for a value the lookup tables in `i18n/live-states.ts` do not
	 * hold — a newer EMS, or an EMS that is not one. Then the fallback message is shown with
	 * the raw value beside it as ordinary escaped text, so the operator still sees what was
	 * actually said. The raw value never becomes part of a catalogue key: `t()` on a key the
	 * catalogue does not hold throws inside render(), and a render that throws commits no
	 * DOM at all — this poll and every one after it.
	 */
	private enumLabel(key: MessageKey | undefined, fallback: MessageKey, raw: string) {
		if (key !== undefined) return t(key);
		return html`${t(fallback)} <span class="pill">${raw}</span>`;
	}

	/**
	 * Say when polling is paused, rather than showing a silently empty page.
	 *
	 * A backgrounded tab stops polling on purpose — continuing would be a lie about the
	 * sample rate — but without this the page just sits blank forever with nothing to
	 * explain it, which reads as broken. Found by opening the built app in a browser pane
	 * that happened not to be displayed.
	 */
	private pausedNotice() {
		if (this.store.liveFeed.pausedForMs() === null) return nothing;
		return html`<section><p>${t('live.paused')}</p></section>`;
	}

	private healthSection(health: HealthResponse) {
		return html`
			<section>
				<h3>${t('live.health.title')}</h3>
				<dl>
					${this.stat('live.health.uptime', formatDuration(health.uptime_seconds * 1000, durationUnits()))}
					${this.stat('live.health.workers', `${n(health.workers.running)} / ${n(health.workers.total)}`)}
					${this.stat('live.health.restarts', n(health.workers.restarts))}
					${this.stat('live.health.devicesReady', `${n(health.devices.data_ready)} / ${n(health.devices.total)}`)}
					<!-- Shown because only the operator can judge whether it is too many: each of
					     these costs the EMS a full copy of every device to answer. -->
					${this.stat('live.health.requests', n(this.store.liveFeed.requestsPerMinute()))}
				</dl>
			</section>
		`;
	}

	private clockSection(health: HealthResponse) {
		const clock = health.clock;
		return html`
			<section>
				<h3>${t('live.clock.title')}</h3>
				<dl>
					${this.stat('live.clock.mode', t(clock.simulated ? 'live.clock.simulated' : 'live.clock.wall'))}
					${this.stat('live.clock.generation', n(clock.generation))}
					${this.stat('live.clock.step', clock.step_time ?? '—')}
				</dl>
				${clock.pending.length === 0
					? nothing
					: html`
							<!-- The wedged-replay diagnosis. A step that never commits is a step
							     somebody never acked, and this is the only thing that names them. -->
							<p>${t('live.clock.pending')}</p>
							<p>${clock.pending.map((name) => html`<span class="pill">${name}</span>`)}</p>
						`}
			</section>
		`;
	}

	private deviceSection(devices: DevicesResponse) {
		return html`
			<section>
				<h3>${t('live.devices.title', { n: devices.devices.length })}</h3>
				<div class="scroll">
					<table>
						<thead>
							<tr>
								<th>${t('live.devices.name')}</th>
								<th>${t('live.devices.class')}</th>
								<th>${t('live.devices.connector')}</th>
								<th>${t('live.devices.ready')}</th>
								<th>${t('live.devices.capabilities')}</th>
								<th>${t('live.devices.energy')}</th>
							</tr>
						</thead>
						<tbody>
							${devices.devices.map((device) => this.deviceRow(device))}
						</tbody>
					</table>
				</div>
			</section>
		`;
	}

	private deviceRow(device: ApiDevice) {
		return html`
			<tr>
				<td class="mono">${device.name}</td>
				<!-- The Python class name, not the config kind: a kind of "p1" arrives as "P1". -->
				<td class="mono">${device.class}</td>
				<!-- The *emulated* protocol; the connector name is what disambiguates it. -->
				<td class="mono">${device.connector ?? '—'}${device.protocol === null ? '' : ` · ${device.protocol}`}</td>
				<td>
					<span class=${device.connected ? 'yes' : 'no'}>${t('live.devices.connected')}</span> ·
					<span class=${device.data_ready ? 'yes' : 'no'}>${t('live.devices.hasData')}</span>
				</td>
				<td>${device.capabilities.map((capability) => html`<span class="pill">${capability}</span>`)}</td>
				<td class="mono">${device.total_energy_kwh === null ? '—' : n(device.total_energy_kwh)}</td>
			</tr>
		`;
	}

	private workerSection(workers: WorkersResponse) {
		return html`
			<section>
				<h3>${t('live.workers.title', { n: workers.workers.length })}</h3>
				<div class="scroll">
					<table>
						<thead>
							<tr>
								<th>${t('live.workers.name')}</th>
								<th>${t('live.workers.axis')}</th>
								<th>${t('live.workers.state')}</th>
								<th>${t('live.workers.restarts')}</th>
								<th>${t('live.workers.runs')}</th>
								<th>${t('live.workers.lastRun')}</th>
							</tr>
						</thead>
						<tbody>
							${workers.workers.map((worker) => this.workerRow(worker))}
						</tbody>
					</table>
				</div>
			</section>
		`;
	}

	private workerRow(worker: ApiWorker) {
		const stateClass = worker.state === 'running' ? 'yes' : worker.state === 'finished' ? 'no' : 'bad';
		return html`
			<tr>
				<td class="mono">${worker.name}</td>
				<td>${worker.axis}</td>
				<td class=${stateClass}>${this.enumLabel(labelKey(WORKER_STATE_KEYS, worker.state), WORKER_STATE_UNKNOWN, worker.state)}</td>
				<td class="mono ${worker.crashes > 0 ? 'warnish' : ''}">
					${n(worker.restarts)} / ${n(worker.max_restarts)}
					${worker.crashes > 0 ? plural('live.workers.crashes', worker.crashes) : ''}
				</td>
				<!-- Only the algorithm axis carries these; every extra field is optional. -->
				<td class="mono">${worker.runs === undefined ? '—' : n(worker.runs)}</td>
				<!-- Wall clock, NOT the simulation clock — the API is explicit about that, and
				     under a replay the two are years apart. -->
				<td class="mono">${worker.last_run ?? '—'}</td>
			</tr>
		`;
	}

	private caveats() {
		return html`
			<section class="caveat">
				<h3>${t('live.cannot.title')}</h3>
				${this.store.get().liveDecisions === 'available'
					? html`<p>${t('live.can.decisions', { endpoint: '/decisions' })}</p>`
					: html`<p>
							<strong>${t('live.cannot.decisionsLead')}</strong>
							${t('live.cannot.decisions', { file: 'algorithm_decisions.csv' })}
						</p>`}
				<p>
					<strong>${t('live.cannot.seenLead')}</strong>
					${t('live.cannot.seen')}
				</p>
			</section>
		`;
	}

	private stat(key: MessageKey, value: string) {
		return html`
			<div>
				<dt>${t(key)}</dt>
				<dd>${value}</dd>
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'motrix-live-status': MotrixLiveStatus;
	}
}
