import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import '../src/components/motrix-app.js';
import type { MotrixApp } from '../src/components/motrix-app.js';
import type { MotrixTimeline } from '../src/components/timeline/motrix-timeline.js';
import { LOCALES } from '../src/i18n/locale.js';
import { readFixture } from './helpers/fixtures.js';

/**
 * End-to-end through the real components: drop the EMS's actual output in, and check that
 * what comes out the other side is a timeline someone can use.
 *
 * This is the test that would have caught the two wiring bugs the type checker found by
 * luck — a store captured before `@consume` resolved it, and a field catalogue rebuilt from
 * round-tripped timestamps — and it is why the DOM project exists at all.
 */
describe('<motrix-app> end to end', () => {
	let app: MotrixApp;

	beforeEach(async () => {
		// The boot probe fetches /api/health. In jsdom there is no server; make it fail
		// fast and silently, which is exactly what happens from file://.
		globalThis.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch;

		app = document.createElement('motrix-app');
		document.body.append(app);
		await app.updateComplete;
	});

	afterEach(() => {
		app.remove();
	});

	/** Load a fixture through the real file path and wait for it to finish. */
	async function load(name: string, tag = name): Promise<void> {
		app.store.addText(tag, readFixture(name));
		await waitFor(() => app.store.get().datasets.some((d) => d.status.phase === 'complete'));
		await app.updateComplete;
	}

	function timeline(): MotrixTimeline {
		const element = inWorkspace('motrix-timeline');
		expect(element, 'the timeline should be mounted once data is loaded').not.toBeNull();
		return element as MotrixTimeline;
	}

	it('starts on Home, with a drop zone and no timeline', () => {
		expect(app.store.get().view).toBe('home');
		const home = app.renderRoot.querySelector('motrix-home');
		expect(home).not.toBeNull();
		// querySelector cannot pierce a shadow root: the dropzone lives inside <motrix-home>'s.
		expect(home!.renderRoot.querySelector('motrix-dropzone')).not.toBeNull();
		expect(app.renderRoot.querySelector('motrix-workspace')).toBeNull();
	});

	it('navigates to the workspace when the first dataset lands', async () => {
		await load('auto_toggle/expected/device_data.csv');
		expect(app.store.get().view).toBe('workspace');
		expect(app.renderRoot.querySelector('motrix-workspace')).not.toBeNull();
	});

	it('stays on Home when a second dataset is added while reading it', async () => {
		await load('auto_toggle/expected/device_data.csv');
		app.store.setView('home');
		await app.updateComplete;

		app.store.addText('decisions', readFixture('auto_toggle/expected/algorithm_decisions.csv'));
		await waitFor(() => app.store.get().datasets.every((d) => d.status.phase === 'complete'));
		// Only the empty -> non-empty edge navigates. The second add is by someone who
		// already knows where the workspace is.
		expect(app.store.get().view).toBe('home');
	});

	it('reports file mode when the probe fails, without an error', async () => {
		const navbar = app.renderRoot.querySelector('motrix-navbar')!;
		await waitFor(() => navbar.renderRoot.textContent?.includes('file mode') ?? false);
		expect(app.store.get().liveProbe).toBe('unreachable');
	});

	it('loads the readings fixture and renders rows', async () => {
		await load('auto_toggle/expected/device_data.csv', 'readings');

		const dataset = app.store.get().datasets[0]!;
		expect(dataset.events).toHaveLength(54);

		const rendered = timeline().renderRoot.textContent ?? '';
		expect(rendered).toContain('p1_meter');
		expect(rendered).toContain('shelly_plug');
		expect(rendered).toContain('54 shown');
	});

	it('discovers the field catalogue through the source, not a second pass', async () => {
		await load('auto_toggle/expected/device_data.csv');
		const dataset = app.store.get().datasets[0]!;
		expect(dataset.fields.size).toBe(3);
		expect([...dataset.fields.values()].some((paths) => paths.has('power'))).toBe(true);
	});

	it('loads both files side by side as two datasets', async () => {
		await load('auto_toggle/expected/device_data.csv', 'readings');
		app.store.addText('decisions', readFixture('auto_toggle/expected/algorithm_decisions.csv'));
		await waitFor(() => app.store.get().datasets.every((d) => d.status.phase === 'complete'));
		await app.updateComplete;

		expect(app.store.get().datasets).toHaveLength(2);
		const rendered = timeline().renderRoot.textContent ?? '';
		expect(rendered).toContain('72 shown'); // 54 readings + 18 decisions, merged
		expect(rendered).toContain('AutoToggle');
	});

	it('merges the two files chronologically rather than concatenating them', async () => {
		await load('auto_toggle/expected/device_data.csv', 'readings');
		app.store.addText('decisions', readFixture('auto_toggle/expected/algorithm_decisions.csv'));
		await waitFor(() => app.store.get().datasets.every((d) => d.status.phase === 'complete'));
		await app.updateComplete;

		const rows = [...timeline().renderRoot.querySelectorAll('.row')];
		expect(rows.length).toBeGreaterThan(0);
		// A decision shares its timestep with the readings that produced it, so the two
		// datasets must interleave — a concatenation would put every decision at the end.
		const sources = rows.map((row) => row.querySelector('.source')?.textContent ?? '');
		const firstDecision = sources.indexOf('AutoToggle');
		expect(firstDecision).toBeGreaterThan(-1);
		expect(firstDecision).toBeLessThan(sources.length - 1);
	});

	it('filters intersect across facets — the prototype regression', async () => {
		await load('auto_toggle/expected/device_data.csv', 'readings');
		app.store.addText('decisions', readFixture('auto_toggle/expected/algorithm_decisions.csv'));
		await waitFor(() => app.store.get().datasets.every((d) => d.status.phase === 'complete'));

		app.store.setFilter({ actors: new Set(['p1_meter']) });
		await app.updateComplete;
		await timeline().updateComplete;

		expect(timeline().renderRoot.textContent).toContain('18 shown'); // p1_meter only...

		// ...and asserted on the *rows*, not the whole shadow root: the actor dropdown still
		// offers AutoToggle as a choice, which is correct. The prototype's bug was that
		// picking a device left every decision on screen, so the rows are what matters.
		// lit-virtualizer measures before it re-renders, so its window settles a frame after
		// the host's updateComplete — poll rather than assume.
		const renderedSources = () =>
			new Set([...timeline().renderRoot.querySelectorAll('.row .source')].map((el) => el.textContent));
		await waitFor(() => renderedSources().size === 1);
		expect(renderedSources()).toEqual(new Set(['p1_meter']));
	});

	it('shows the load report for a file with problems, with row numbers', async () => {
		await load('edge_cases/device_data.csv', 'edge cases');
		await app.updateComplete;

		const bar = inWorkspace('motrix-dataset-bar');
		await settle(bar);
		const rendered = bar!.renderRoot.textContent ?? '';
		// A real plural now, not "note(s)" — which was wrong in every language including
		// French, where zero is singular.
		expect(rendered).toMatch(/\d+ notes? while loading/);
		expect(rendered).toContain('BAD_TIMESTAMP');
		expect(rendered).toContain('row ');
	});

	it('counts a kind that charts nothing, and still offers it as a facet', async () => {
		// AutoToggle's command is the bare string `on`, so a decision produces exactly one
		// leaf and that leaf is not chartable. The tally must still see it: this is the kind
		// most likely to be lost by an implementation that counts through the chartable
		// series rather than through the events.
		await load('auto_toggle/expected/algorithm_decisions.csv', 'decisions');

		const dataset = app.store.get().datasets[0]!;
		expect(dataset.kindCounts.get('decision')).toBe(dataset.events.length);
		expect(dataset.kindCounts.get('reading')).toBeUndefined();

		await settle(timeline() as unknown as Rendered);
		expect(timeline().renderRoot.textContent).toContain('decision');
	});

	it('names the columns it did not recognise, instead of the placeholder', async () => {
		// The load report always rendered this correctly, because it holds a SourceWarning.
		// The toast holds a SourceStatus, which carried the detail but not its params, so the
		// user read the message template with `{columns}` still in it.
		app.store.addText('bad', 'alpha,beta\n1,2\n');
		await waitFor(() => app.store.get().datasets.some((d) => d.status.phase === 'error'));

		const toast = app.store.get().toasts.at(-1);
		expect(toast?.key).toBe('toast.loadFailed');
		const message = String(toast?.params?.message ?? '');
		expect(message).toContain('alpha, beta');
		expect(message).not.toContain('{');
	});

	it('flags a dataset whose timestamps carry no offset', async () => {
		await load('auto_toggle/expected/device_data.csv');
		const bar = inWorkspace('motrix-dataset-bar');
		await settle(bar);
		expect(bar!.renderRoot.textContent).toContain('naive TZ');
	});

	it('removes a dataset', async () => {
		await load('auto_toggle/expected/device_data.csv');
		app.store.removeDataset(app.store.get().datasets[0]!.id);
		await app.updateComplete;
		expect(app.store.get().datasets).toHaveLength(0);
		expect(inWorkspace('motrix-timeline')).toBeNull();
		// Removing the last dataset must NOT bounce back to Home: automatic backwards
		// navigation on a delete is disorienting.
		expect(app.store.get().view).toBe('workspace');
	});

	/**
	 * The regression guard for the one mistake this design makes easy.
	 *
	 * Translation is a module singleton, so a component renders the right language only if
	 * it subscribes to `s.locale` and re-renders. Forget that one line and the component
	 * keeps its old text forever — a bug with no type error, no console warning and no
	 * failing assertion anywhere else. Two components shipped without it before this test
	 * existed. Every text-bearing surface is checked, so adding a component and forgetting
	 * the line fails here.
	 */
	it('switches every mounted component to the chosen language', async () => {
		await load('edge_cases/device_data.csv', 'edge cases');
		// The topology panel renders nothing without a config, so give it one to render.
		app.store.addConfigText('config.json', readFixture('auto_toggle/config.json'));
		expect(timeline().renderRoot.textContent).toContain('Timeline');

		app.store.setLocale('fr');
		await app.updateComplete;

		const grid = inWorkspace('motrix-chart-grid');
		const card = grid?.renderRoot.querySelector('motrix-chart-card') as Rendered | null;
		const bar = inWorkspace('motrix-dataset-bar');
		const surfaces: Array<[string, Rendered | null, string]> = [
			['navbar', app.renderRoot.querySelector('motrix-navbar') as Rendered | null, 'Espace de travail'],
			['timeline', timeline() as unknown as Rendered, 'Chronologie'],
			['dataset bar', bar, 'remarques au chargement'],
			['chart grid', grid, 'Graphiques'],
			['chart card', card, 'Champs'],
			[
				'topology panel',
				(bar?.renderRoot.querySelector('motrix-topology-panel') ?? null) as Rendered | null,
				'Topologie configurée',
			],
		];
		for (const [name, element, french] of surfaces) {
			expect(element, name).not.toBeNull();
			await settle(element);
			expect(element!.renderRoot.textContent, name).toContain(french);
		}

		// <html lang> is a real accessibility requirement, not tidiness: it decides which
		// voice a screen reader announces the page in.
		expect(document.documentElement.lang).toBe('fr');
		app.store.setLocale('en');
	});

	it('renders in every locale without throwing, with the nav intact', async () => {
		await load('auto_toggle/expected/device_data.csv');
		for (const locale of LOCALES) {
			app.store.setLocale(locale);
			await app.updateComplete;
			const navbar = app.renderRoot.querySelector('motrix-navbar')!;
			await settle(navbar);
			const items = [...navbar.renderRoot.querySelectorAll('nav .item')];
			expect(items, locale).toHaveLength(3);
			expect(items.filter((item) => item.hasAttribute('aria-current')), locale).toHaveLength(1);
			for (const item of items) expect(item.textContent?.trim().length, locale).toBeGreaterThan(0);
		}
		app.store.setLocale('en');
	});

	it('survives a localStorage that throws, which is every file:// session', async () => {
		const original = globalThis.localStorage.setItem;
		globalThis.localStorage.setItem = () => {
			throw new Error('SecurityError');
		};
		try {
			expect(() => app.store.setLocale('nl')).not.toThrow();
			expect(app.store.get().locale).toBe('nl');
		} finally {
			globalThis.localStorage.setItem = original;
			app.store.setLocale('en');
		}
	});

	it('surfaces a file it does not recognise instead of showing an empty table', async () => {
		app.store.addText('nonsense.csv', 'a,b,c\r\n1,2,3\r\n');
		await waitFor(() => app.store.get().datasets[0]?.status.phase === 'error');
		await app.updateComplete;

		const dataset = app.store.get().datasets[0]!;
		expect(dataset.warnings.some((w) => w.code === 'UNKNOWN_SHAPE')).toBe(true);
	});

	/**
	 * The replay input beside the output it produced.
	 *
	 * `docs/storage-format.md` §7: the EMS writes no row for a payload a device rejected, so
	 * absence in `device_data.csv` is the *only* evidence of one — and it is evidence you can
	 * read only against the input. These tests pin that join against the real bytes.
	 */
	describe('a replay input loaded beside its output', () => {
		async function loadBoth(): Promise<void> {
			await load('auto_toggle/replay.naive.csv', 'replay');
			app.store.addText('device_data.csv', readFixture('auto_toggle/expected/device_data.csv'));
			await waitFor(() => app.store.get().datasets.length === 2 && app.store.get().datasets.every((d) => d.status.phase === 'complete'));
			await app.updateComplete;
		}

		/** `(actor, instant)` keys for one kind, across every loaded dataset. */
		function keysOf(kind: string): Set<string> {
			const keys = new Set<string>();
			for (const dataset of app.store.get().datasets) {
				for (const event of dataset.events) {
					if (event.kind === kind) keys.add(`${event.source}@${event.t}`);
				}
			}
			return keys;
		}

		it('keeps inputs and readings as separate kinds', async () => {
			await loadBoth();
			const kinds = app.store.get().datasets.map((d) => [...d.kindCounts.keys()]);
			expect(kinds).toEqual([['input'], ['reading']]);
		});

		it('shows that the golden run rejected nothing — every input has its reading', async () => {
			await loadBoth();
			const inputs = keysOf('input');
			const readings = keysOf('reading');
			// 36 naive input rows against the 36 naive readings inside the 54-row fixture (the
			// other 18 come from the offset-aware second run).
			expect(inputs.size).toBe(36);
			expect([...inputs].filter((key) => !readings.has(key))).toEqual([]);
		});

		it('names exactly the rejected input when a reading is missing', async () => {
			await loadBoth();
			// Delete one reading in place, which is what a rejected payload looks like in the
			// output: the input row is there, and nothing was written for it.
			const output = app.store.get().datasets[1]!;
			const victim = output.events.find((event) => event.source === 'pseudo_sensor')!;
			output.events.splice(output.events.indexOf(victim), 1);

			const readings = keysOf('reading');
			const orphans = [...keysOf('input')].filter((key) => !readings.has(key));
			expect(orphans).toEqual([`${victim.source}@${victim.t}`]);
		});

		it('badges the input dataset and does not count its rows as decisions', async () => {
			await loadBoth();
			const bar = inWorkspace('motrix-dataset-bar');
			await settle(bar);
			const text = bar!.renderRoot.textContent ?? '';
			expect(text).toContain('replay input');
			// The pre-existing bug this fixes: the decision figure was totalEvents - readings,
			// so 36 inputs would have been reported as 36 decisions.
			expect(text).toContain('0 decisions');
		});
	});
});

/**
 * Reach a component mounted inside `<motrix-workspace>`'s shadow root.
 *
 * The charts, the timeline and the dataset bar all moved one level down when the shell
 * gained views, and `querySelector` does not cross a shadow boundary — it returns null
 * rather than failing, which is exactly the kind of silence this helper exists to avoid.
 */
function inWorkspace(selector: string): Rendered | null {
	const app = document.querySelector('motrix-app');
	const workspace = app?.renderRoot.querySelector('motrix-workspace');
	return (workspace?.renderRoot.querySelector(selector) as Rendered | undefined) ?? null;
}

/** The slice of a Lit element these assertions actually touch. */
type Rendered = Element & { renderRoot: ParentNode & { textContent: string | null } };

async function settle(element: Element | null): Promise<void> {
	await (element as unknown as { updateComplete?: Promise<unknown> } | null)?.updateComplete;
}

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error('timed out waiting for a condition');
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

/**
 * The chart layer, through the real components.
 *
 * uPlot cannot draw in jsdom — there is no canvas context — so these assert on what the
 * card *decides*: that it selects fields on creation rather than rendering blank, that the
 * series it builds come from the columnar store, and that zooming moves the shared viewport.
 */
describe('<motrix-chart-card> wiring', () => {
	let app: MotrixApp;

	beforeEach(async () => {
		globalThis.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch;
		app = document.createElement('motrix-app');
		document.body.append(app);
		await app.updateComplete;
		app.store.addText('readings', readFixture('auto_toggle/expected/device_data.csv'));
		await waitFor(() => app.store.get().datasets.some((d) => d.status.phase === 'complete'));
		await app.updateComplete;
	});

	afterEach(() => app.remove());

	it('builds columns during ingest, not on demand', () => {
		const dataset = app.store.get().datasets[0]!;
		expect(dataset.columns.size).toBeGreaterThan(5);
		// ShellyPlug's power is stored as a string by the EMS and must still be a series.
		const power = dataset.columns.get('reading', 'shelly_plug', 'power');
		expect(power).toBeDefined();
		expect(power!.n).toBeGreaterThan(0);
	});

	it('derives a gap threshold from the observed cadence', () => {
		const power = app.store.get().datasets[0]!.columns.get('reading', 'shelly_plug', 'power')!;
		expect(power.gapMs).toBeGreaterThan(0);
	});

	it('captures the unit P1 volunteers, so the axis grouper has a real signal', () => {
		const dataset = app.store.get().datasets[0]!;
		const energy = dataset.columns.get('reading', 'p1_meter', 'data.0.data.0.value');
		expect(energy?.unit).toBe('kWh');
	});

	it('renders a chart card that is not blank on first paint', async () => {
		const grid = inWorkspace('motrix-chart-grid');
		expect(grid).not.toBeNull();
		await settle(grid);

		const card = grid!.renderRoot.querySelector('motrix-chart-card');
		expect(card).not.toBeNull();
		await waitFor(() => (card!.renderRoot.textContent ?? '').includes('points drawn'));
		expect(card!.renderRoot.querySelector('.empty')).toBeNull();
	});

	it('zooming the viewport filters the timeline to the same window', async () => {
		const span = app.store.get().datasets[0]!;
		const mid = (span.tMin + span.tMax) / 2;
		app.store.setViewport([span.tMin, mid]);
		await app.updateComplete;

		const timeline = inWorkspace('motrix-timeline')!;
		await settle(timeline);
		const shown = Number((timeline.renderRoot.textContent ?? '').match(/(\d+) shown/)?.[1] ?? '0');
		expect(shown).toBeGreaterThan(0);
		expect(shown).toBeLessThan(54);
	});
});
