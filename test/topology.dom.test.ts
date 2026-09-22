import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import '../src/components/motrix-app.js';
import type { MotrixApp } from '../src/components/motrix-app.js';
import { readFixture } from './helpers/fixtures.js';

/**
 * The topology overlay, end to end through the real drop path.
 *
 * The routing tests here are the point: classification is by content, not extension, and the
 * only way to prove that is to hand the store real `File` objects and see which list they land
 * in.
 */
describe('<motrix-topology-panel> and the drop routing', () => {
	let app: MotrixApp;

	beforeEach(async () => {
		globalThis.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch;
		// The router reads location.hash at boot, and jsdom keeps one Location for the whole
		// file — so without this a test that navigated to the workspace silently decides where
		// the *next* test starts.
		location.hash = '';
		app = document.createElement('motrix-app');
		document.body.append(app);
		await app.updateComplete;
	});

	afterEach(() => {
		app.remove();
	});

	const CONFIG = () => readFixture('auto_toggle/config.json');
	const READINGS = () => readFixture('auto_toggle/expected/device_data.csv');

	function file(name: string, text: string): File {
		return new File([text], name, { type: name.endsWith('.json') ? 'application/json' : 'text/csv' });
	}

	async function settle(): Promise<void> {
		await app.updateComplete;
		const home = app.renderRoot.querySelector('motrix-home');
		if (home !== null) await home.updateComplete;
		const bar = app.renderRoot.querySelector('motrix-workspace')?.renderRoot.querySelector('motrix-dataset-bar');
		if (bar != null) await bar.updateComplete;
	}

	/** The panel, wherever it is currently mounted. */
	function panel(): Element | null {
		const home = app.renderRoot.querySelector('motrix-home');
		const fromHome = home?.renderRoot.querySelector('motrix-topology-panel') ?? null;
		if (fromHome !== null) return fromHome;
		const bar = app.renderRoot.querySelector('motrix-workspace')?.renderRoot.querySelector('motrix-dataset-bar');
		return bar?.renderRoot.querySelector('motrix-topology-panel') ?? null;
	}

	async function panelText(): Promise<string> {
		const element = panel();
		expect(element, 'the topology panel should be mounted').not.toBeNull();
		await (element as unknown as { updateComplete: Promise<unknown> }).updateComplete;
		return element!.shadowRoot?.textContent ?? '';
	}

	describe('routing by content', () => {
		it('routes a config to the topology list and creates no dataset', async () => {
			await app.store.addDropped(file('config.json', CONFIG()));
			expect(app.store.get().topologies).toHaveLength(1);
			expect(app.store.get().datasets).toHaveLength(0);
		});

		it('routes a CSV to the dataset list and creates no topology', async () => {
			await app.store.addDropped(file('device_data.csv', READINGS()));
			expect(app.store.get().datasets).toHaveLength(1);
			expect(app.store.get().topologies).toHaveLength(0);
		});

		it('routes a .json-named file holding CSV down the CSV path — content wins', async () => {
			await app.store.addDropped(file('device_data.json', READINGS()));
			expect(app.store.get().datasets).toHaveLength(1);
			expect(app.store.get().topologies).toHaveLength(0);
		});

		it('routes a .csv-named file holding a config down the config path', async () => {
			await app.store.addDropped(file('topology.csv', CONFIG()));
			expect(app.store.get().topologies).toHaveLength(1);
			expect(app.store.get().datasets).toHaveLength(0);
		});

		it('does not navigate away from Home when only a config is dropped', async () => {
			// A config has nothing to plot, and Home is where the panel already is.
			await app.store.addDropped(file('config.json', CONFIG()));
			await settle();
			expect(app.store.get().view).toBe('home');
		});
	});

	describe('rendering', () => {
		it('renders nothing at all with no config loaded', async () => {
			await settle();
			const element = panel();
			expect(element).not.toBeNull();
			// Not textContent: jsdom's adoptedStyleSheets fallback puts the component's own CSS
			// into the shadow root as text, so an empty render is never an empty string.
			expect(element!.shadowRoot?.querySelector('details')).toBeNull();
		});

		it('shows the version note in the panel, beside the version it still prints verbatim', async () => {
			// The whole feature reaches the screen through the load-report seam that already
			// existed: `parseTopology` returns the warning, the panel maps every warning
			// through `warningText()`. No component change, and a drifted config is still a
			// usable overlay rather than a refusal.
			const drifted = CONFIG().replace('"version": "1.0.0"', '"version": "2.0.0"');
			expect(drifted).toContain('"version": "2.0.0"');
			await app.store.addDropped(file('config.json', drifted));
			await settle();
			// Assert the summary's own node, not the flat panel text: the warning sentence
			// contains the version string too, so `toContain('2.0.0')` over the whole panel
			// would stay green with the verbatim display deleted — and that display is what
			// makes an unreadable version legible, since the parser stays silent about it.
			const summary = panel()!.shadowRoot!.querySelector('summary .meta')?.textContent ?? '';
			expect(summary).toContain('version 2.0.0');
			const text = await panelText();
			expect(text).toContain('a major version is the only notice');
			for (const name of ['p1_meter', 'shelly_plug', 'pseudo_sensor', 'AutoToggle', 'replay']) {
				expect(text).toContain(name);
			}
		});

		it('lists the declared topology before any CSV is loaded', async () => {
			await app.store.addDropped(file('config.json', CONFIG()));
			await settle();
			const text = await panelText();
			for (const name of ['p1_meter', 'shelly_plug', 'pseudo_sensor', 'AutoToggle', 'replay']) {
				expect(text).toContain(name);
			}
			expect(text).toContain('No CSV is loaded yet');
		});

		it('reports every device once the run’s readings are loaded', async () => {
			await app.store.addDropped(file('config.json', CONFIG()));
			app.store.addText('device_data.csv', READINGS());
			await waitFor(() => app.store.get().datasets.some((d) => d.status.phase === 'complete'));
			await settle();

			// Only readings were loaded, so the algorithm and the connector are legitimately
			// still silent — assert on the devices rather than on the absence of silence.
			const rows = [...(panel()!.shadowRoot?.querySelectorAll('tbody tr') ?? [])];
			const statusOf = (name: string) =>
				rows.find((row) => row.querySelector('td')?.textContent?.trim() === name)?.lastElementChild?.textContent?.trim();
			expect(statusOf('p1_meter')).toBe('reporting');
			expect(statusOf('shelly_plug')).toBe('reporting');
			expect(statusOf('pseudo_sensor')).toBe('reporting');
			// The CSV backend never appears as an actor, so it must never be badged silent.
			expect(statusOf('csv')).toBe('—');
		});

		it('marks a device the run never produced as silent', async () => {
			app.store.addConfigText(
				'second.json',
				JSON.stringify({ devices: [{ name: 'ghost_meter', kind: 'p1' }] }),
			);
			app.store.addText('device_data.csv', READINGS());
			await waitFor(() => app.store.get().datasets.some((d) => d.status.phase === 'complete'));
			await settle();

			const text = await panelText();
			expect(text).toContain('ghost_meter');
			expect(text).toContain('Configured, but produced nothing');
		});

		it('shows a refused config with its reason and creates no dataset', async () => {
			await app.store.addDropped(file('broken.json', '{"devices": ['));
			await settle();
			const text = await panelText();
			expect(text).toContain('could not be read');
			expect(text).toContain('not valid JSON');
			expect(app.store.get().datasets).toHaveLength(0);
		});

		it('resolves protocols through emulates, matching what /api/devices reports', async () => {
			await app.store.addDropped(file('config.json', CONFIG()));
			await settle();
			// The connector's protocol is `pseudo`; its devices emulate `mqtt`.
			expect(await panelText()).toContain('mqtt');
		});
	});

	describe('privacy, at the rendered-DOM level', () => {
		const SECRETS = ['mqtt.example.invalid', 'ops-account', 'REDACT-ME-IF-YOU-SEE-THIS', 'secret/topic/#'];

		it('never puts a credential, host or topic on screen', async () => {
			// DO NOT DELETE. The parser test proves the allowlist; this proves nothing renders
			// a field the parser was never supposed to keep.
			app.store.addConfigText(
				'hostile.json',
				JSON.stringify({
					connectors: [
						{
							name: 'broker',
							protocol: 'mqtt',
							options: {
								host: 'mqtt.example.invalid',
								username: 'ops-account',
								password: 'REDACT-ME-IF-YOU-SEE-THIS',
							},
						},
					],
					devices: [
						{
							name: 'p1_meter',
							kind: 'p1',
							options: {
								connector_options: { name: 'broker' },
								listener_options: { subscription: 'secret/topic/#' },
							},
						},
					],
				}),
			);
			await settle();

			const text = await panelText();
			expect(text).toContain('p1_meter');
			for (const secret of SECRETS) expect(text).not.toContain(secret);
		});
	});
});

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error('timed out waiting for a condition');
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}
