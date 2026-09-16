/**
 * The four supported locales, plus detection and best-effort persistence.
 *
 * Deliberately separate from `translator.ts`: this module is pure data and browser
 * plumbing with no dependency on any catalogue, so `AppStore` can resolve a locale before
 * anything renders without dragging four message tables into the import graph early.
 */

export const LOCALES = ['en', 'fr', 'nl', 'de'] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * Endonyms, not English names.
 *
 * A French speaker scans a language menu for "Français", not for "French" — you have to
 * already read the interface language to find your way out of it otherwise. It also means
 * these four labels are identical in all four catalogues, so they live here and cost zero
 * translation entries.
 *
 * No flags. There is no flag for German (Germany? Austria? Switzerland?), and showing the
 * Dutch flag to a Belgian Dutch speaker is a small insult. A flag is a country; this is a
 * language.
 */
export const LOCALE_NAMES: Record<Locale, string> = {
	en: 'English',
	fr: 'Français',
	nl: 'Nederlands',
	de: 'Deutsch',
};

const STORAGE_KEY = 'motrix-edge-view.locale';

export function isLocale(value: unknown): value is Locale {
	return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Stored choice, else the browser's preference, else English. */
export function detectLocale(): Locale {
	return readStoredLocale() ?? fromNavigator() ?? 'en';
}

function fromNavigator(): Locale | null {
	if (typeof navigator === 'undefined') return null;
	// `languages`, not `language`. A Belgian browser reports ['nl-BE', 'fr-BE', 'en-US'] and
	// the *order* is the user's stated preference — reading only the first entry throws away
	// the answer to "what if we do not have their top choice".
	const tags = navigator.languages ?? [navigator.language ?? ''];
	for (const tag of tags) {
		const base = tag.toLowerCase().split('-')[0];
		if (isLocale(base)) return base;
	}
	return null;
}

/**
 * Persistence, which this app has none of anywhere else.
 *
 * Opened from `file://` the origin is opaque and Chrome throws `SecurityError` on the
 * **property access** — not on `getItem` — so the `try` has to wrap the access itself and
 * `'localStorage' in globalThis` is not a sufficient guard. Safari throws too. Getting this
 * wrong kills boot for the app's primary audience: someone who downloaded one HTML file and
 * double-clicked it.
 *
 * Losing persistence entirely is survivable by design: the locale falls back to the
 * navigator's, which is the right answer anyway, and the picker still works for the session.
 */
function readStoredLocale(): Locale | null {
	try {
		const value = globalThis.localStorage?.getItem(STORAGE_KEY);
		return isLocale(value) ? value : null;
	} catch {
		return null;
	}
}

export function storeLocale(locale: Locale): void {
	try {
		globalThis.localStorage?.setItem(STORAGE_KEY, locale);
	} catch {
		// file://. Nothing to do, and nothing to report — a toast here would fire on every
		// language change for exactly the users who cannot fix it.
	}
}
