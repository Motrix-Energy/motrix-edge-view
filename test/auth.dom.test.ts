import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import '../src/components/motrix-app.js';
import type { MotrixApp } from '../src/components/motrix-app.js';

/**
 * The boot decision table, and what the UI does with each row of it.
 *
 * Every case runs through the real `<motrix-app>` and the real store, because the thing worth
 * checking is not that `probeLive` sets a field — it is that a locked EMS says "locked"
 * while file mode stays completely usable behind the panel.
 */
describe('auth', () => {
	let app: MotrixApp;

	/** Answer the boot probe with one status, and record what was sent. */
	function serve(status: number, body: unknown = { status: 'ok' }) {
		const sent: Array<Record<string, string> | undefined> = [];
		globalThis.fetch = (async (_url: string, init: RequestInit) => {
			sent.push(init.headers as Record<string, string> | undefined);
			return new Response(status === 204 ? null : JSON.stringify(body), {
				status,
				headers: { 'Content-Type': 'application/json' },
			});
		}) as unknown as typeof fetch;
		return sent;
	}

	async function mount(): Promise<void> {
		app = document.createElement('motrix-app');
		document.body.append(app);
		await app.updateComplete;
		await settled();
	}

	/** The probe is async; let its microtasks and the follow-up render finish. */
	async function settled(): Promise<void> {
		for (let i = 0; i < 6; i++) await app.updateComplete;
		await new Promise((resolve) => setTimeout(resolve, 0));
		await app.updateComplete;
	}

	beforeEach(() => {
		globalThis.sessionStorage.clear();
	});

	afterEach(() => app?.remove());

	it('goes file-only and silent when nothing is listening', async () => {
		globalThis.fetch = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;
		await mount();

		expect(app.store.get().liveProbe).toBe('unreachable');
		expect(app.store.get().auth.phase).toBe('unknown');
		// No sign-in panel at all: there is nothing to sign in to, and asking would be noise
		// for the app's most common case — a file opened by double-clicking it.
		expect(app.renderRoot.querySelector('motrix-login')).toBeNull();
	});

	it('offers live with no sign-in when the EMS is ungated', async () => {
		serve(200);
		await mount();

		expect(app.store.get().liveProbe).toBe('reachable');
		expect(app.store.get().auth.phase).toBe('none');
		expect(app.renderRoot.querySelector('motrix-login')).toBeNull();
	});

	it('stays live-capable through a 503, which means up-but-unwell', async () => {
		serve(503, { status: 'down' });
		await mount();
		expect(app.store.get().liveProbe).toBe('reachable');
	});

	it('goes file-only for a 502, the no-rest_api-service case', async () => {
		serve(502);
		await mount();
		expect(app.store.get().liveProbe).toBe('unreachable');
		expect(app.store.get().auth.phase).toBe('unknown');
	});

	it('reports a 401 as reachable-but-locked, never as file mode', async () => {
		serve(401);
		await mount();

		// The distinction the whole AuthState type exists for: saying "file mode" here would
		// send somebody hunting a network fault against an EMS that is answering fine.
		expect(app.store.get().liveProbe).toBe('reachable');
		expect(app.store.get().auth).toEqual({ phase: 'required', reason: 'initial', checking: false });

		const navbar = app.renderRoot.querySelector('motrix-navbar')!;
		await (navbar as unknown as { updateComplete: Promise<unknown> }).updateComplete;
		expect(navbar.renderRoot.textContent).toContain('locked');
		expect(app.renderRoot.querySelector('motrix-login')).not.toBeNull();
	});

	it('leaves file mode fully usable behind the sign-in panel', async () => {
		serve(401);
		await mount();

		// The reason this is a strip and not a full-screen gate: opening a CSV offline is
		// the primary use of the tool and needs no credential at all.
		app.store.addText('readings', 'timestamp,device_name,data_json\r\n2024-01-15T10:00:00,p1_meter,"{""power"": 1}"\r\n');
		for (let i = 0; i < 40 && app.store.get().datasets[0]?.status.phase !== 'complete'; i++) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		expect(app.store.get().datasets[0]!.events.length).toBe(1);
		expect(app.renderRoot.querySelector('motrix-login')).not.toBeNull();
	});

	it('discards a stored credential the gate has stopped accepting', async () => {
		globalThis.sessionStorage.setItem('motrix-edge-view.auth', 'Basic stale');
		const sent = serve(401);
		await mount();

		expect(sent[0]).toEqual({ Authorization: 'Basic stale' });
		// Demonstrably stale — keeping it would mean every later poll retries a credential
		// already known to fail.
		expect(globalThis.sessionStorage.getItem('motrix-edge-view.auth')).toBeNull();
	});

	it('signs in, stores the credential, and attaches it to later calls', async () => {
		let status = 401;
		const sent: Array<Record<string, string> | undefined> = [];
		globalThis.fetch = (async (_url: string, init: RequestInit) => {
			sent.push(init.headers as Record<string, string> | undefined);
			return new Response(JSON.stringify({ status: 'ok' }), { status });
		}) as unknown as typeof fetch;
		await mount();

		status = 200;
		await app.store.signIn('admin', 'admin');
		await settled();

		expect(app.store.get().auth).toEqual({ phase: 'authenticated', user: 'admin' });
		expect(sent.at(-1)).toEqual({ Authorization: 'Basic YWRtaW46YWRtaW4=' });
		expect(globalThis.sessionStorage.getItem('motrix-edge-view.auth')).toBe('Basic YWRtaW46YWRtaW4=');

		const navbar = app.renderRoot.querySelector('motrix-navbar')!;
		await (navbar as unknown as { updateComplete: Promise<unknown> }).updateComplete;
		expect(navbar.renderRoot.textContent).toContain('signed in as admin');
	});

	it('tells a rejected password apart from an EMS that is simply down', async () => {
		serve(401);
		await mount();

		await app.store.signIn('admin', 'wrong');
		expect(app.store.get().auth).toEqual({ phase: 'required', reason: 'rejected', checking: false });

		globalThis.fetch = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;
		await app.store.signIn('admin', 'admin');
		// Showing "wrong password" here is how people retype a correct password twenty times.
		expect(app.store.get().auth).toEqual({ phase: 'required', reason: 'unreachable', checking: false });
	});

	it('reopens the panel when the gate stops accepting a live session', async () => {
		let status = 200;
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ status: 'ok' }), { status })) as unknown as typeof fetch;
		await mount();
		await app.store.signIn('admin', 'admin');
		expect(app.store.get().auth.phase).toBe('authenticated');

		app.store.dismissLogin();
		status = 401;
		await app.store.api.get('/devices');
		await settled();

		// Funnelled through ApiClient.onUnauthorized from wherever it happened, and the
		// dismissal is cleared: this is new information, not the message already dismissed.
		expect(app.store.get().auth).toEqual({ phase: 'required', reason: 'expired', checking: false });
		expect(app.store.get().loginDismissed).toBe(false);
		expect(app.renderRoot.querySelector('motrix-login')).not.toBeNull();
	});

	it('signs out without leaving a credential behind', async () => {
		serve(200);
		await mount();
		await app.store.signIn('admin', 'admin');

		app.store.signOut();
		expect(app.store.get().auth.phase).toBe('required');
		expect(globalThis.sessionStorage.getItem('motrix-edge-view.auth')).toBeNull();
		expect(app.store.api.hasCredential()).toBe(false);
	});

	it('does not let a late probe clobber a sign-in the user already started', async () => {
		// The probe is fired at connectedCallback and resolves whenever it resolves. If it
		// wrote unconditionally, a fast typist would be logged back out by their own boot.
		serve(200);
		await mount();
		await app.store.signIn('admin', 'admin');

		await app.store.probeLive();
		expect(app.store.get().auth.phase).toBe('authenticated');
	});

	it('survives a sessionStorage that throws, which is every file:// session', async () => {
		const original = globalThis.sessionStorage.setItem;
		globalThis.sessionStorage.setItem = () => {
			throw new DOMException('SecurityError');
		};
		try {
			serve(200);
			await mount();
			await expect(app.store.signIn('admin', 'admin')).resolves.toBeUndefined();
			expect(app.store.get().auth.phase).toBe('authenticated');
		} finally {
			globalThis.sessionStorage.setItem = original;
		}
	});
});
