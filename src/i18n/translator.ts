import type { DurationUnits } from '../core/time.js';
import type { Catalogue, MessageKey, Params, PluralForms, PluralKey } from './catalogue.js';
import { de } from './de.js';
import { en } from './en.js';
import { fr } from './fr.js';
import { nl } from './nl.js';
import type { Locale } from './locale.js';

/**
 * The four catalogues, **statically imported**, and that is not negotiable.
 *
 * The deliverable is one self-contained `index.html` opened by double-clicking a file.
 * Dynamic `import()` resolves against an opaque `file://` origin and fails; ESLint bans
 * `ImportExpression` and Rollup is configured with `inlineDynamicImports` for the same
 * reason. So every locale is in the bundle whether or not anyone selects it — about 30 KB
 * against a 900 KB ceiling, which is the whole cost of the decision.
 *
 * This is also why `@lit/localize` is not here: its transform mode emits one bundle per
 * locale (and `scripts/check-bundle-size.mjs` asserts `dist/` holds exactly one file), and
 * its runtime mode is built around a promise-returning module loader. Neither survives the
 * constraint above, and neither offers plural rules, which is the part that is actually
 * hard.
 */
const CATALOGUES: Record<Locale, Catalogue> = { en, fr, nl, de };

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Module-level singletons, so `t('nav.home')` beats `this.i18n.t('nav.home')` at ~200 call
 * sites. Reassigned together by `setActiveLocale`.
 *
 * The singleton is global while `AppStore` is per-instance, so two stores means
 * last-constructed wins. That happens only in tests, where each construction re-detects and
 * the outcome is identical — but it is worth knowing before discovering it as a mystery.
 */
let catalogue: Catalogue = en;
let plurals = new Intl.PluralRules('en');
let numbers = new Intl.NumberFormat('en');
let compactNumbers = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
let collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function setActiveLocale(locale: Locale): void {
	catalogue = CATALOGUES[locale];
	plurals = new Intl.PluralRules(locale);
	numbers = new Intl.NumberFormat(locale);
	compactNumbers = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
	collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
}

/** Look up a single-form message and interpolate its `{placeholders}`. */
export function t(key: MessageKey, params?: Params): string {
	const message = catalogue[key];
	// A plural key reached through t() is a caller bug; rendering `other` beats
	// "[object Object]" on screen while the type system and review catch it.
	return interpolate(typeof message === 'string' ? message : message.other, params);
}

/**
 * Look up a count-dependent message.
 *
 * `{n}` is injected automatically so no caller passes the count twice. The categories that
 * differ from English and will be got wrong by a naive port:
 *
 * - **French treats 0 as singular** — "0 note", not "0 notes". That is the exact case the
 *   load report hits most often.
 * - **French has `many`** for large powers of ten. Absent from an older ICU, hence the
 *   `?? forms.other` fallback rather than an assertion.
 * - Dutch and German share English's *categories* but not its word forms: `1 Datensatz` /
 *   `2 Datensätze`, `1 melding` / `2 meldingen`.
 */
export function plural(key: PluralKey, count: number, params?: Params): string {
	const forms = catalogue[key] as PluralForms;
	const template = forms[plurals.select(count)] ?? forms.other;
	return interpolate(template, { n: count, ...params });
}

/** Locale-aware integer formatting. Replaces every bare `.toLocaleString()`. */
export function n(value: number): string {
	return numbers.format(value);
}

/** Compact form for chip counts — `1,2 M` in French, `1.2M` in English. */
export function compact(value: number): string {
	return compactNumbers.format(value);
}

/** Locale-aware comparison. Replaces `.localeCompare()`, which uses the ambient locale. */
export function compare(a: string, b: string): number {
	return collator.compare(a, b);
}

/**
 * Duration suffixes for `core/time.ts`'s `formatDuration`.
 *
 * Passed in rather than looked up there, so `core/` keeps depending on nothing above it.
 */
export function durationUnits(): DurationUnits {
	return { d: t('unit.days'), h: t('unit.hours'), m: t('unit.minutes'), s: t('unit.seconds') };
}

function interpolate(template: string, params: Params | undefined): string {
	if (params === undefined) return template;
	return template.replace(PLACEHOLDER, (whole, name: string) => {
		const value = params[name];
		if (value === undefined) return whole;
		// Numbers always go through Intl. A count interpolated with String(n) is precisely
		// the ambient-locale leak this module exists to close.
		return typeof value === 'number' ? numbers.format(value) : value;
	});
}
