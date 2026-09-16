import { describe, expect, it } from 'vitest';

import type { Catalogue, MessageKey, PluralForms } from '../src/i18n/catalogue.js';
import { de } from '../src/i18n/de.js';
import { en } from '../src/i18n/en.js';
import { fr } from '../src/i18n/fr.js';
import {
	EVENT_KIND_KEYS,
	HEALTH_STATUS_KEYS,
	HEALTH_STATUS_UNKNOWN,
	WORKER_STATE_KEYS,
	WORKER_STATE_UNKNOWN,
	labelKey,
} from '../src/i18n/live-states.js';
import { LOCALES, LOCALE_NAMES, isLocale, type Locale } from '../src/i18n/locale.js';
import { nl } from '../src/i18n/nl.js';
import { compact, compare, n, plural, setActiveLocale, t } from '../src/i18n/translator.js';

const CATALOGUES: Record<Locale, Catalogue> = { en, fr, nl, de };
const TRANSLATIONS: readonly Locale[] = ['fr', 'nl', 'de'];

const PLACEHOLDER = /\{(\w+)\}/g;

function placeholders(template: string): Set<string> {
	return new Set([...template.matchAll(PLACEHOLDER)].map((match) => match[1]!));
}

/** Every string a catalogue can render, plural forms flattened out. */
function templates(catalogue: Catalogue): Map<string, string> {
	const out = new Map<string, string>();
	for (const [key, message] of Object.entries(catalogue)) {
		if (typeof message === 'string') out.set(key, message);
		else for (const [form, text] of Object.entries(message)) out.set(`${key}.${form}`, text as string);
	}
	return out;
}

describe('catalogue completeness', () => {
	// Largely redundant with `satisfies Catalogue`, which fails the build on a missing or
	// extra key. Kept because it costs three lines and it also validates `en`, which cannot
	// satisfy a type derived from itself.
	it.each(TRANSLATIONS)('%s has exactly the English key set', (locale) => {
		expect(Object.keys(CATALOGUES[locale]).sort()).toEqual(Object.keys(en).sort());
	});

	it.each(TRANSLATIONS)('%s matches the English shape for every key', (locale) => {
		for (const key of Object.keys(en) as MessageKey[]) {
			const mine = CATALOGUES[locale][key];
			expect(typeof mine, `${locale}/${key}`).toBe(typeof en[key]);
		}
	});
});

describe('placeholder parity', () => {
	/**
	 * The test the type system provably cannot replace.
	 *
	 * A recursive template-literal type could extract `{n}` from the `as const` English
	 * literal — but `Catalogue` types every translated value as a plain `string`, so the
	 * placeholders in fr/nl/de are unconstrained no matter how clever the type is. Which
	 * means the type could never catch the bug that actually ships: French writing `{count}`
	 * where English wrote `{n}`, rendering a literal brace on screen.
	 */
	it.each(TRANSLATIONS)('%s uses exactly the placeholders English uses', (locale) => {
		const mine = templates(CATALOGUES[locale]);
		for (const [key, english] of templates(en)) {
			const translated = mine.get(key);
			if (translated === undefined) continue; // a plural form English does not declare
			expect([...placeholders(translated)].sort(), `${locale}/${key}`).toEqual([...placeholders(english)].sort());
		}
	});

	it.each(LOCALES)('%s never uses a JS template literal by mistake', (locale) => {
		for (const [key, text] of templates(CATALOGUES[locale])) {
			// `${…}` in a catalogue renders literally — the interpolator only knows `{…}`.
			expect(text, `${locale}/${key}`).not.toContain('${');
		}
	});

	it.each(LOCALES)('%s has no empty message', (locale) => {
		for (const [key, text] of templates(CATALOGUES[locale])) {
			expect(text.length, `${locale}/${key}`).toBeGreaterThan(0);
		}
	});
});

describe('plural forms', () => {
	it.each(LOCALES)('%s only declares categories its locale actually has', (locale) => {
		const allowed = new Set(new Intl.PluralRules(locale).resolvedOptions().pluralCategories);
		for (const [key, message] of Object.entries(CATALOGUES[locale])) {
			if (typeof message === 'string') continue;
			for (const form of Object.keys(message)) {
				expect(allowed.has(form as Intl.LDMLPluralRule), `${locale}/${key}/${form}`).toBe(true);
			}
		}
	});

	it.each(LOCALES)('%s declares `other` and `one` for every plural message', (locale) => {
		for (const [key, message] of Object.entries(CATALOGUES[locale])) {
			if (typeof message === 'string') continue;
			const forms = message as PluralForms;
			expect(forms.other, `${locale}/${key}`).toBeTypeOf('string');
			expect(forms.one, `${locale}/${key}`).toBeTypeOf('string');
		}
	});

	/**
	 * The CLDR rules this catalogue was written against, pinned as executable documentation.
	 *
	 * Without this, the French entries look like typos — "0 note" reads as a bug to an
	 * English speaker — and somebody eventually "fixes" them back to the wrong thing.
	 */
	it('records that French treats zero as singular', () => {
		const french = new Intl.PluralRules('fr');
		expect(french.select(0)).toBe('one');
		expect(french.select(1)).toBe('one');
		expect(french.select(2)).toBe('other');
	});

	it('records that English, Dutch and German treat zero as plural', () => {
		for (const locale of ['en', 'nl', 'de'] as const) {
			expect(new Intl.PluralRules(locale).select(0), locale).toBe('other');
		}
	});

	// `many` is deliberately NOT required: an older ICU legitimately lacks it for French,
	// and `plural()` falls back to `other`. This only asserts the fallback is reachable.
	it('falls back to `other` for a category the catalogue does not declare', () => {
		setActiveLocale('fr');
		expect(plural('dataset.summary.readings', 1_000_000)).toBe('relevés');
		setActiveLocale('en');
	});
});

describe('rendering', () => {
	it.each(LOCALES)('%s leaves no placeholder unreplaced when given every parameter', (locale) => {
		setActiveLocale(locale);
		for (const [key, message] of Object.entries(CATALOGUES[locale])) {
			const params = Object.fromEntries([...placeholders(JSON.stringify(message))].map((name) => [name, 'X']));
			const rendered = typeof message === 'string' ? t(key as MessageKey, params) : plural(key as never, 2, params);
			expect(rendered, `${locale}/${key}`).not.toMatch(PLACEHOLDER);
		}
		setActiveLocale('en');
	});

	it('picks the right plural branch', () => {
		setActiveLocale('en');
		expect(plural('dataset.report.summary', 1, { tag: 'run' })).toBe('run: 1 note while loading');
		expect(plural('dataset.report.summary', 3, { tag: 'run' })).toBe('run: 3 notes while loading');

		setActiveLocale('fr');
		// Zero is singular in French — the whole reason `(s)` had to go.
		expect(plural('dataset.report.summary', 0, { tag: 'run' })).toBe('run : 0 remarque au chargement');
		expect(plural('dataset.report.summary', 2, { tag: 'run' })).toBe('run : 2 remarques au chargement');
		setActiveLocale('en');
	});

	it('formats interpolated numbers through Intl, not String', () => {
		setActiveLocale('en');
		expect(plural('timeline.shown', 54_321)).toBe('54,321 shown');
		setActiveLocale('de');
		// German groups with a full stop. This is the ambient-locale leak the module closes.
		expect(plural('timeline.shown', 54_321)).toBe('54.321 angezeigt');
		setActiveLocale('en');
	});

	it('formats counts and compact counts per locale', () => {
		setActiveLocale('en');
		expect(n(1234)).toBe('1,234');
		expect(compact(1_200_000)).toBe('1.2M');
		setActiveLocale('fr');
		expect(compact(1_200_000)).toContain('1,2');
		setActiveLocale('en');
	});

	it('compares numerically, so sensor10 sorts after sensor2', () => {
		setActiveLocale('en');
		expect(['sensor10', 'sensor2'].sort(compare)).toEqual(['sensor2', 'sensor10']);
	});
});

/**
 * The two enums the status page renders straight off the live API.
 *
 * Their labels used to be built by interpolation — `live.status.${status}` — so a value
 * this viewer did not know missed the catalogue and threw a TypeError out of a Lit render.
 * The `Record`s in `i18n/live-states.ts` make the *mapping* a typecheck (a union member
 * without a message will not compile); these make the *messages* behind it a test, in every
 * locale, including the fallback that the interpolated version never had.
 */
describe('live enum labels', () => {
	const MAPPED: ReadonlyArray<readonly [string, MessageKey]> = [
		...Object.entries(HEALTH_STATUS_KEYS).map(([member, key]) => [`status/${member}`, key] as const),
		...Object.entries(WORKER_STATE_KEYS).map(([member, key]) => [`worker/${member}`, key] as const),
		['status/unknown', HEALTH_STATUS_UNKNOWN],
		['worker/unknown', WORKER_STATE_UNKNOWN],
	];

	it.each(LOCALES)('%s labels every health status, every worker state and both fallbacks', (locale) => {
		setActiveLocale(locale);
		for (const [member, key] of MAPPED) {
			const label = t(key);
			expect(label, `${locale}/${member}`).toBeTypeOf('string');
			expect(label.trim().length, `${locale}/${member}`).toBeGreaterThan(0);
		}
		setActiveLocale('en');
	});

	it('never builds a key out of a value the EMS invented', () => {
		expect(labelKey(HEALTH_STATUS_KEYS, 'degraded')).toBe('live.status.degraded');
		expect(labelKey(WORKER_STATE_KEYS, 'lost')).toBe('live.workers.state.lost');
		expect(labelKey(EVENT_KIND_KEYS, 'decision')).toBe('kind.decision');

		expect(labelKey(HEALTH_STATUS_KEYS, 'pwned')).toBeUndefined();
		expect(labelKey(WORKER_STATE_KEYS, 'pwned')).toBeUndefined();
		// The prototype is the same crash by a longer route: a bare index would hand `t()` a
		// function here, and `catalogue[fn]` is undefined just the same.
		expect(labelKey(HEALTH_STATUS_KEYS, 'toString')).toBeUndefined();
		expect(labelKey(WORKER_STATE_KEYS, '__proto__')).toBeUndefined();
		expect(labelKey(WORKER_STATE_KEYS, 'constructor')).toBeUndefined();
		// The kind table is minted in-repo and total, but it reaches `t()` through the same
		// helper, so it answers the same way to the same hostile keys.
		expect(labelKey(EVENT_KIND_KEYS, 'toString')).toBeUndefined();
	});
});

describe('locale detection', () => {
	it('accepts only the four supported tags', () => {
		expect(isLocale('fr')).toBe(true);
		expect(isLocale('es')).toBe(false);
		expect(isLocale(null)).toBe(false);
	});

	it('names every locale in its own language', () => {
		for (const locale of LOCALES) expect(LOCALE_NAMES[locale].length).toBeGreaterThan(0);
		expect(LOCALE_NAMES.fr).toBe('Français');
	});
});
