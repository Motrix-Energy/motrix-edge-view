/**
 * Best-effort credential persistence.
 *
 * `sessionStorage`, not `localStorage` and not memory-only. All three are equally exposed
 * to script running in the origin, so XSS is not the axis that separates them — what
 * separates them is how long a credential outlives the person who typed it. `localStorage`
 * on a shared control-room machine keeps a site's EMS password forever. Memory-only means
 * retyping it on every reload of a tool people reload constantly while dropping CSVs in,
 * and that friction is precisely how `VIEWER_AUTH=off` ends up set.
 *
 * What is stored is the encoded `Basic …` header, not the password: the same information,
 * but there is exactly one thing to clear and no variable named `password` anywhere outside
 * the sign-in form. Say the rest plainly — base64 is encoding, not encryption. This changes
 * the cost of someone reading the disk, not of someone running script in the page, and it
 * is a smaller exposure than the one already accepted by sending that same string over
 * plain HTTP on every request.
 *
 * Every access is wrapped, because on a `file://` origin Chrome and Safari throw
 * `SecurityError` on the **property access** — not on the method call — so
 * `'sessionStorage' in globalThis` is not a sufficient guard and an unguarded read would
 * kill boot for the app's primary audience. In the node test project the property is simply
 * `undefined`, which `?.` handles; both guards are needed for both reasons.
 */

const KEY = 'motrix-edge-view.auth';

export function readCredential(): string | null {
	try {
		return globalThis.sessionStorage?.getItem(KEY) ?? null;
	} catch {
		return null;
	}
}

export function writeCredential(credential: string | null): void {
	try {
		if (credential === null) globalThis.sessionStorage?.removeItem(KEY);
		else globalThis.sessionStorage?.setItem(KEY, credential);
	} catch {
		// file://, or a browser with storage disabled. The app is fully correct without
		// persistence — the user signs in again after a reload — and a toast here would
		// fire at exactly the people who cannot act on it.
	}
}
