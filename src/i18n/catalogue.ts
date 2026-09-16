import type { en } from './en.js';

/**
 * CLDR plural categories.
 *
 * `other` is the only one every locale is guaranteed to have, so it is the only required
 * form and the runtime fallback. The rest are optional because which of them a locale uses
 * is a property of the locale, not of the message: French needs `many` for large powers of
 * ten, German does not, and declaring an unused category is not an error worth failing on.
 */
export type PluralForms = {
	readonly other: string;
	readonly zero?: string;
	readonly one?: string;
	readonly two?: string;
	readonly few?: string;
	readonly many?: string;
};

export type MessageKey = keyof typeof en;

/** Keys whose message is a set of plural forms — the ones `plural()` accepts. */
export type PluralKey = {
	[K in MessageKey]: (typeof en)[K] extends string ? never : K;
}[MessageKey];

/**
 * Every locale supplies exactly the English key set, with the same shape per key.
 *
 * A key that is a plain string in `en` must be a plain string here, and a key that is
 * plural forms in `en` must be plural forms here. That makes a missing key, an extra key
 * and a shape mismatch all compile errors rather than a blank label somebody notices in
 * production.
 */
export type Catalogue = {
	readonly [K in MessageKey]: (typeof en)[K] extends string ? string : PluralForms;
};

/** Interpolation values. Numbers are formatted through `Intl.NumberFormat`, never `String`. */
export type Params = Readonly<Record<string, string | number>>;
