import { consume } from '@lit/context';
import { LitElement, css, html, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';

import { matchTopology, type TopologyEntry, type TopologyMatch, type TopologyRole } from '../../core/topology.js';
import { seenActors, type Topology } from '../../state/app-state.js';
import type { MessageKey } from '../../i18n/catalogue.js';
import { plural, t } from '../../i18n/translator.js';
import { warningText } from '../../i18n/warnings.js';
import { AppStore, storeContext } from '../../state/actions.js';
import { base, tokens } from '../../styles/tokens.css.js';
import { StoreController } from '../common/store-controller.js';

/**
 * What the EMS was *told* to run, beside what it actually produced.
 *
 * The one question the CSVs cannot answer on their own: `docs/storage-format.md` §7 says no row
 * is written for a device that never reported *or* for a device that was never configured, so
 * absence is ambiguous in the data and only the config disambiguates it.
 *
 * Renders nothing at all when no config is loaded, which is the whole cost of this feature in a
 * session that never uses it.
 */

/** `TopologyRole` -> message key. A total Record, so a new role cannot ship label-less. */
const ROLE_KEYS: Record<TopologyRole, MessageKey> = {
	device: 'topology.role.device',
	algorithm: 'topology.role.algorithm',
	connector: 'topology.role.connector',
	storage: 'topology.role.storage',
	service: 'topology.role.service',
};

@customElement('motrix-topology-panel')
export class MotrixTopologyPanel extends LitElement {
	static styles = [
		tokens,
		base,
		css`
			:host {
				display: block;
			}

			details {
				border-top: 1px solid var(--border);
				margin-top: 8px;
				padding-top: 8px;
			}

			summary {
				cursor: pointer;
				font-size: 13px;
				color: var(--text-secondary);
				display: flex;
				align-items: center;
				gap: 8px;
				flex-wrap: wrap;
			}

			summary b {
				color: var(--text-primary);
			}

			.meta {
				font-size: 12px;
				color: var(--text-secondary);
			}

			.note {
				font-size: 12px;
				color: var(--text-secondary);
				margin: 8px 0;
				max-width: 78ch;
				line-height: 1.5;
			}

			.note b {
				color: var(--text-primary);
			}

			.scroll {
				overflow-x: auto;
			}

			table {
				border-collapse: collapse;
				font-size: 12px;
				margin: 8px 0;
				min-width: 100%;
			}

			th,
			td {
				text-align: left;
				padding: 4px 10px 4px 0;
				white-space: nowrap;
			}

			th {
				color: var(--text-secondary);
				font-weight: 500;
				border-bottom: 1px solid var(--border);
			}

			td.name {
				color: var(--text-primary);
			}

			.silent {
				color: var(--warning);
			}

			.na {
				color: var(--text-secondary);
			}

			.warnings {
				margin: 6px 0 0;
				padding-left: 18px;
				font-size: 12px;
				color: var(--text-secondary);
			}

			button.link {
				background: none;
				border: none;
				color: var(--accent);
				cursor: pointer;
				font: inherit;
				padding: 0;
				text-decoration: underline;
			}

			button.remove {
				background: none;
				border: none;
				color: var(--text-secondary);
				cursor: pointer;
				font-size: 14px;
				line-height: 1;
				padding: 0 4px;
			}
		`,
	];

	@consume({ context: storeContext }) store!: AppStore;

	readonly topologiesSub = new StoreController(this, () => this.store, (s) => s.topologies);
	// Silent/reporting is computed against the loaded data, so this must re-render when either
	// the dataset list or any dataset's revision moves.
	readonly datasetsSub = new StoreController(this, () => this.store, (s) => s.datasets);
	readonly localeSub = new StoreController(this, () => this.store, (s) => s.locale);

	render() {
		const state = this.store.get();
		if (state.topologies.length === 0) return nothing;
		const seen = seenActors(state);
		const hasData = state.datasets.length > 0;
		return html`${state.topologies.map((topology) => this.panel(topology, seen, hasData))}`;
	}

	private panel(topology: Topology, seen: ReturnType<typeof seenActors>, hasData: boolean) {
		const doc = topology.doc;
		const match = doc === null ? null : matchTopology(doc, seen);
		return html`
			<details>
				<summary>
					<b>${t('topology.title')}</b>
					<span
						>${doc === null
							? topology.label
							: plural('topology.summary', doc.entries.length, {
									name: topology.label,
									n: doc.entries.length,
								})}</span
					>
					${doc?.version == null ? nothing : html`<span class="meta">${t('topology.version', { version: doc.version })}</span>`}
					${doc?.env == null ? nothing : html`<span class="meta">${t('topology.env', { env: doc.env })}</span>`}
					<button
						class="remove"
						title=${t('topology.remove')}
						@click=${(event: Event) => {
							event.preventDefault();
							this.store.removeTopology(topology.id);
						}}
					>
						×
					</button>
				</summary>

				${doc === null ? html`<p class="note">${t('topology.rejected')}</p>` : nothing}
				${doc !== null && !hasData ? html`<p class="note">${t('topology.noData')}</p>` : nothing}
				${match !== null && match.silentCount > 0
					? html`<p class="note">
							<b>${t('topology.silentLead')}</b> ${t('topology.silentBody')}
						</p>`
					: nothing}
				${match !== null && match.undeclared.length > 0
					? html`<p class="note">
							${plural('topology.undeclared', match.undeclared.length, { n: match.undeclared.length })}
							${match.undeclared.join(', ')}
						</p>`
					: nothing}
				${match === null ? nothing : this.table(match)}
				${topology.warnings.length === 0
					? nothing
					: html`<ul class="warnings">
							${topology.warnings.map((warning) => html`<li>${warningText(warning)}</li>`)}
						</ul>`}
				<p class="note">${t('topology.privacy')}</p>
			</details>
		`;
	}

	private table(match: TopologyMatch) {
		return html`
			<div class="scroll">
				<table>
					<thead>
						<tr>
							<th>${t('topology.column.name')}</th>
							<th>${t('topology.column.role')}</th>
							<th>${t('topology.column.type')}</th>
							<th>${t('topology.column.connector')}</th>
							<th>${t('topology.column.protocol')}</th>
							<th>${t('topology.column.cadence')}</th>
							<th>${t('topology.column.status')}</th>
						</tr>
					</thead>
					<tbody>
						${match.rows.map(
							(row) => html`
								<tr>
									<td class="name">${row.entry.name}</td>
									<td>${t(ROLE_KEYS[row.entry.role])}</td>
									<td>${row.entry.type ?? ''}</td>
									<td>${this.connectorCell(row.entry, match)}</td>
									<td>${row.entry.protocol ?? ''}</td>
									<td>
										${row.entry.delaySeconds === null
											? ''
											: t('topology.cadence.configured', { seconds: row.entry.delaySeconds })}
									</td>
									<td class=${row.status === 'silent' ? 'silent' : row.status === 'notApplicable' ? 'na' : ''}>
										${t(
											row.status === 'matched'
												? 'topology.status.matched'
												: row.status === 'silent'
													? 'topology.status.silent'
													: 'topology.status.na',
										)}
									</td>
								</tr>
							`,
						)}
					</tbody>
				</table>
			</div>
		`;
	}

	/**
	 * A connector name, as a button that filters the timeline to its devices.
	 *
	 * Deliberately **not** a timeline facet. A facet would be a control that appears and
	 * disappears with a config, writing the same `filter.actors` set the actor facet already
	 * owns — two widgets fighting over one field. This writes that field once, on a click, and
	 * adds no new filter state at all: `core/filter.ts` is untouched by this feature.
	 */
	private connectorCell(entry: TopologyEntry, match: TopologyMatch) {
		if (entry.connector === null) return entry.role === 'connector' ? '' : '';
		const devices = match.rows
			.filter((row) => row.entry.role === 'device' && row.entry.connector === entry.connector)
			.map((row) => row.entry.name);
		return html`<button
			class="link"
			title=${t('topology.filterConnector')}
			@click=${() => this.store.setFilter({ actors: new Set(devices) })}
		>
			${entry.connector}
		</button>`;
	}
}
