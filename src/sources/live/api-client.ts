/**
 * The only module in `src/` that knows `/api` exists, and the only one that constructs an
 * `Authorization` value.
 *
 * Everything else — the boot probe, the live source, the status page — asks this for a
 * result and never learns whether a credential was involved. That is what keeps "auth" from
 * becoming a concern every component has an opinion about.
 */

/** Relative on purpose: nginx and the Vite dev proxy both strip this prefix. */
export const API_BASE = '/api';

export type ApiResult<T> =
	| { readonly kind: 'ok'; readonly value: T; readonly status: number }
	/** The gate rejected us. Distinct from every other failure, and never retried blindly. */
	| { readonly kind: 'unauthorized' }
	/** Reached a server, got an answer we cannot use. `status` is real. */
	| { readonly kind: 'http'; readonly status: number }
	/** Never reached a server: DNS, connection refused, `file://`, CORS. */
	| { readonly kind: 'network'; readonly message: string }
	| { readonly kind: 'timeout' }
	/** Reached the EMS, but the body was not the JSON shape we expect. */
	| { readonly kind: 'malformed'; readonly message: string };

export interface ApiRequestOptions {
	readonly timeoutMs?: number;
	/** Overrides the stored credential for one call — used to test a sign-in attempt. */
	readonly credential?: string | null;
	readonly signal?: AbortSignal;
}

/** Build a `Basic …` header value. UTF-8 safe, which `btoa` alone is not. */
export function basicCredential(user: string, password: string): string {
	const bytes = new TextEncoder().encode(`${user}:${password}`);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return `Basic ${btoa(binary)}`;
}

export class ApiClient {
	private credential: string | null = null;

	/**
	 * Called on any 401 from a request that carried a credential.
	 *
	 * One funnel, set once by the store, so a mid-session rejection — nginx restarted with
	 * a new password, say — reaches the UI from wherever it happened without every caller
	 * having to remember to handle it.
	 */
	onUnauthorized: (() => void) | null = null;

	/**
	 * `fetch` is injectable, and resolved **per call** when it is not injected.
	 *
	 * Binding `globalThis.fetch` once in the constructor looks equivalent and is not: it
	 * captures whatever the global was at construction, so a later reassignment is silently
	 * ignored. That is invisible in a browser and wrong everywhere else — it is why the
	 * first version of the sign-in test could not make a second attempt fail differently.
	 */
	constructor(private readonly injectedFetch?: typeof fetch) {}

	private get doFetch(): typeof fetch {
		// `.bind(globalThis)` is not decoration. `fetch` is a WebIDL operation on Window, and
		// calling it as `this.doFetch(...)` would pass the ApiClient as its receiver —
		// "Illegal invocation" in Chrome, every request, forever. jsdom does not enforce the
		// receiver, so the entire DOM suite passed while a real browser reported every EMS as
		// unreachable. Bound per call, because the constructor must not capture a global that
		// a test may replace afterwards.
		return this.injectedFetch ?? globalThis.fetch.bind(globalThis);
	}

	setCredential(credential: string | null): void {
		this.credential = credential;
	}

	hasCredential(): boolean {
		return this.credential !== null;
	}

	async get<T>(path: string, options: ApiRequestOptions = {}): Promise<ApiResult<T>> {
		const credential = options.credential === undefined ? this.credential : options.credential;
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
		const forward = (): void => controller.abort();
		options.signal?.addEventListener('abort', forward, { once: true });

		try {
			const response = await this.doFetch(`${API_BASE}${path}`, {
				signal: controller.signal,
				cache: 'no-store',
				headers: credential === null ? undefined : { Authorization: credential },
				// THE LOAD-BEARING LINE.
				//
				// The Fetch Standard gates its "prompt the end user for a username and
				// password" step on `includeCredentials`, and `omit` makes that false —
				// Chromium maps it to LOAD_DO_NOT_SEND_AUTH_DATA and cancels the challenge,
				// Gecko to LOAD_ANONYMOUS, WebKit to StoredCredentialsPolicy::DoNotUse. The
				// default of 'same-origin' would set it TRUE for these same-origin requests,
				// so a gated nginx would pop the browser's own credential dialog over the
				// app's login panel. nginx cannot help here: it sends WWW-Authenticate on
				// every 401 and `add_header` cannot remove a header (verified in a real
				// container). This is the whole mechanism.
				//
				// It also means "sign out" means something: the browser holds no session of
				// its own to silently replay.
				credentials: 'omit',
			});

			if (response.status === 401) {
				if (credential !== null) this.onUnauthorized?.();
				return { kind: 'unauthorized' };
			}
			// 503 is a VALID answer from /health: the EMS is up and reporting itself down.
			if (!response.ok && response.status !== 503) return { kind: 'http', status: response.status };

			try {
				return { kind: 'ok', value: (await response.json()) as T, status: response.status };
			} catch (error) {
				return { kind: 'malformed', message: String(error) };
			}
		} catch (error) {
			// An abort is either our timeout or the caller's cancellation; the caller's own
			// signal is the only way to tell them apart, and it does not need us to.
			if (controller.signal.aborted && options.signal?.aborted !== true) return { kind: 'timeout' };
			return { kind: 'network', message: String(error) };
		} finally {
			clearTimeout(timeout);
			options.signal?.removeEventListener('abort', forward);
		}
	}
}
