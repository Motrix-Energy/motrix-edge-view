import { describe, expect, it, vi } from 'vitest';

import { ApiClient, basicCredential } from '../src/sources/live/api-client.js';

/** A fetch stub that records what it was called with. */
function stubFetch(reply: () => Response | Promise<Response>) {
	const calls: Array<{ url: string; init: RequestInit }> = [];
	const fake = (async (url: string, init: RequestInit) => {
		calls.push({ url, init });
		return reply();
	}) as unknown as typeof fetch;
	return { fake, calls };
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('basicCredential', () => {
	it('encodes the pair the way an HTTP Basic header expects', () => {
		expect(basicCredential('admin', 'admin')).toBe('Basic YWRtaW46YWRtaW4=');
	});

	it('survives a non-ASCII password, which bare btoa does not', () => {
		// btoa('é') throws InvalidCharacterError. Anyone who sets a password with an accent
		// in it would otherwise get an exception instead of a 401.
		expect(() => basicCredential('user', 'passwörd')).not.toThrow();
		expect(basicCredential('user', 'passwörd')).toMatch(/^Basic [A-Za-z0-9+/=]+$/);
	});
});

describe('ApiClient', () => {
	it('omits credentials, which is what suppresses the browser dialog', async () => {
		const { fake, calls } = stubFetch(() => json({ status: 'ok' }));
		await new ApiClient(fake).get('/health');
		// The default of 'same-origin' would set includeCredentials TRUE for a same-origin
		// request, and a gated nginx would then pop its own credential prompt over the
		// app's login panel. nginx cannot help: add_header cannot remove WWW-Authenticate.
		expect(calls[0]!.init.credentials).toBe('omit');
		expect(calls[0]!.init.cache).toBe('no-store');
	});

	it('sends no Authorization header until one is set', async () => {
		const { fake, calls } = stubFetch(() => json({}));
		const client = new ApiClient(fake);
		await client.get('/health');
		expect(calls[0]!.init.headers).toBeUndefined();

		client.setCredential('Basic x');
		await client.get('/health');
		expect(calls[1]!.init.headers).toEqual({ Authorization: 'Basic x' });
	});

	it('prefixes /api, which both proxies strip', async () => {
		const { fake, calls } = stubFetch(() => json({}));
		await new ApiClient(fake).get('/devices');
		expect(calls[0]!.url).toBe('/api/devices');
	});

	it('treats 503 as a usable answer, not a failure', async () => {
		// /health returns 503 when a worker is permanently down — which still means the EMS
		// is up and answering, and the body is the same shape as a 200.
		const { fake } = stubFetch(() => json({ status: 'down' }, 503));
		const result = await new ApiClient(fake).get<{ status: string }>('/health');
		expect(result.kind).toBe('ok');
		expect(result.kind === 'ok' && result.value.status).toBe('down');
		expect(result.kind === 'ok' && result.status).toBe(503);
	});

	it('reports 401 as its own kind, never as a generic HTTP failure', async () => {
		const { fake } = stubFetch(() => new Response('', { status: 401 }));
		expect((await new ApiClient(fake).get('/health')).kind).toBe('unauthorized');
	});

	it('fires onUnauthorized only when a credential was actually offered', async () => {
		const { fake } = stubFetch(() => new Response('', { status: 401 }));
		const client = new ApiClient(fake);
		const seen = vi.fn();
		client.onUnauthorized = seen;

		await client.get('/health');
		// No credential sent: a 401 here is "you need to sign in", not "your credential
		// stopped working". Firing the expiry funnel would clear a session nobody had.
		expect(seen).not.toHaveBeenCalled();

		client.setCredential('Basic x');
		await client.get('/health');
		expect(seen).toHaveBeenCalledOnce();
	});

	it('separates a 502 from a 401, because they mean opposite things', async () => {
		// 502 is nginx saying the EMS declares no rest_api service — documented as intended,
		// and the app must go quietly file-only rather than asking for a password.
		const { fake } = stubFetch(() => new Response('', { status: 502 }));
		const result = await new ApiClient(fake).get('/health');
		expect(result).toEqual({ kind: 'http', status: 502 });
	});

	it('distinguishes a timeout from a network failure', async () => {
		vi.useFakeTimers();
		try {
			const hang = (async (_url: string, init: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
				})) as unknown as typeof fetch;
			const pending = new ApiClient(hang).get('/health', { timeoutMs: 1500 });
			await vi.advanceTimersByTimeAsync(1600);
			expect((await pending).kind).toBe('timeout');
		} finally {
			vi.useRealTimers();
		}
	});

	it('reports an unreachable origin as a network failure — the file:// case', async () => {
		const { fake } = stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
		const result = await new ApiClient(fake).get('/health');
		expect(result.kind).toBe('network');
	});

	it('reports a body that is not JSON rather than throwing into the caller', async () => {
		const { fake } = stubFetch(() => new Response('<html>nginx</html>', { status: 200 }));
		expect((await new ApiClient(fake).get('/health')).kind).toBe('malformed');
	});

	it('calls the global fetch with the right receiver', async () => {
		// The regression this exists for shipped and reached a real browser. `fetch` is a
		// WebIDL operation on Window: called with any other receiver, Chrome throws
		// "Illegal invocation" — so every EMS reported as unreachable, in a build whose
		// entire DOM suite was green, because jsdom does not enforce the receiver at all.
		//
		// Simulated here rather than hoped for: a fetch that refuses a foreign `this`.
		const original = globalThis.fetch;
		globalThis.fetch = function fetchWithReceiverCheck(this: unknown) {
			if (this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
			return Promise.resolve(json({ status: 'ok' }));
		} as unknown as typeof fetch;
		try {
			// No injected fetch: this is the production path.
			const result = await new ApiClient().get<{ status: string }>('/health');
			expect(result.kind, 'an unbound global fetch would surface as a network failure').toBe('ok');
		} finally {
			globalThis.fetch = original;
		}
	});

	it('lets one call override the stored credential, for testing a sign-in', async () => {
		const { fake, calls } = stubFetch(() => json({}));
		const client = new ApiClient(fake);
		client.setCredential('Basic stored');
		await client.get('/health', { credential: 'Basic trial' });
		expect(calls[0]!.init.headers).toEqual({ Authorization: 'Basic trial' });
		// The trial must not become the stored one until it is known to work.
		expect(client.hasCredential()).toBe(true);
		await client.get('/health');
		expect(calls[1]!.init.headers).toEqual({ Authorization: 'Basic stored' });
	});
});
