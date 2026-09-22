# Contributing

Motrix Edge View ships as **one self-contained `index.html`** you can double-click: every
dependency inlined, no server, no network. An EMS lives on a site LAN, and a debugging tool that
needs the internet to render is the wrong shape — so most of the rules below exist to keep that one
promise true.

The viewer is also **fully generic**. It knows nothing about specific algorithms, devices or data
schemas: every device name, algorithm name and chartable field is discovered from the data at load
time. Nothing is hardcoded, which is what makes it work with devices that did not exist when it was
written.

Four scripts must be green before a pull request — `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build` — and they run in seconds, offline, with no EMS and no hardware. That is the bar.

This file is normative. [`CLAUDE.md`](CLAUDE.md) holds the architecture and the reasoning behind
these rules at length, and the [documentation site](https://motrix-energy.github.io/contribute/viewer/)
narrates them; when any of the three disagree with this file, this file wins.

## Standing rule — this repository is public

> Never put a customer name, a site topology, a real address or GPS coordinate, a broker host, a MAC
> address, a meter serial, or a non-English domain field name in this repository. Sample data uses
> `p1_meter` / `shelly_plug` / `pseudo_sensor` and the `AutoToggle` algorithm.

Nothing from a real installation belongs here — not a device name, not a field path, not a sample
row, not a UI mock-up, not a test fixture, not a screenshot in an issue. Sites run private
algorithms over private data, and a viewer that ships one operator's vocabulary has both leaked it
and stopped being generic.

The four-language interface is not an exception to that rule; it sharpens it. `src/i18n/` covers
**UI chrome only**: buttons, labels, warnings, the pages' own prose. Device names, algorithm names
and field paths are discovered from the data and are never translated, never enumerated and never
hardcoded. A non-English string in a catalogue is fine; a non-English string that came from
somebody's site is the thing this rule exists to stop.

The rule has teeth in code. **`src/core/topology.ts` is a privacy boundary**: it reads twelve named
paths out of a dropped `config.json` and constructs entries field by field — no spread, no `delete`,
no denylist — so an EMS option added next year is excluded by default rather than by somebody
remembering. Four of those paths reach inside an `options` object; everything else under any
`options` is never touched, including every untyped key under an algorithm's, which is where a
private algorithm's parameters live. `test/topology.test.ts` and `test/topology.dom.test.ts` assert
that no credential, host, topic or path can reach the parsed document or the rendered DOM.
**Do not delete those tests**, and do not widen the allowlist without one that covers the new path.

One of those twelve paths, `version`, is **compared** — its major only, against
`CONFIG_FORMAT_MAJOR`, and only to raise a warning. That is not a widening: the comparison is a
decision taken inside `parseTopology` and discarded, `TopologyDoc` gains no field, and a
configuration of another major still renders in full. Do not turn it into a refusal.

## Set up

```bash
npm ci
npm run dev
```

`npm ci`, not `npm install` — the lockfile is the build. Node 22 or newer ([`.nvmrc`](.nvmrc)); Vite
warns below 22.12.

`npm run dev` serves on 5173 with `/api` proxied to an EMS on `127.0.0.1:8000`, so the live source
works in development. There is no Basic auth in front of the dev proxy: the gate is the container's
nginx, and it only exists in the image.

You do not need an EMS. The repository vendors the golden fixture in `test/fixtures/`, and the whole
file path — CSVs, replay inputs, `config.json` — can be exercised by dragging those files in.

## The bar

| Command | |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | eslint |
| `npm test` | vitest — `core` in node, `dom` in jsdom |
| `npm run build` | one self-contained `dist/index.html`, then the single-file check |

CI runs exactly those four on every push and pull request, and a `v*` tag runs them again before
publishing. Releasing is not part of a contribution: a merged PR is done when the four are green.

**The single-file check is not decoration.** `npm run build` ends in
[`scripts/check-bundle-size.mjs`](scripts/check-bundle-size.mjs), which asserts that `dist/` holds
exactly one file, with no external references, under 900 KB. `vite-plugin-singlefile` stops inlining
*silently* past its limits, and the failure mode is a viewer that 404s the moment someone opens it
offline — which is the only way anyone opens it. If your change pushes the bundle past the ceiling,
shrink the change; do not raise the ceiling.

`npm test` matches `test/**/*.test.ts`, so anything ending `.manual.ts` is invisible to it on
purpose: those harnesses need an EMS answering on `127.0.0.1:8000` and run for minutes. Ask for them
deliberately:

```bash
npx vitest run --config vitest.manual.config.ts
```

[`test/live-fill.manual.ts`](test/live-fill.manual.ts) polls a real EMS for three minutes through the
same modules the live source uses and asserts that the feed accumulates past the default follow
window, that the window has real width, and that a smaller window is strictly narrower than a larger
one. It exists because two bugs hid in exactly that gap and no browser could be held open long
enough to see either. If you touch retention or follow mode, run it.

## How the app is put together

**One app, two data sources.** Charts, timeline, filters and summary all operate on a normalised
stream of `{t, seq, kind, source, target, raw, preview, naive}`. `CsvFileSource` (PapaParse over the
CSVs) and `LiveSource` (polling the REST API) both produce that stream behind one interface,
[`src/sources/data-source.ts`](src/sources/data-source.ts). That is the seam. Add features against
the stream, not against a source: if your change needs to know which source produced an event, that
is usually the design telling you it is in the wrong place.

**A dataset *list*, not a source *switch*.** State is N loaded datasets, each with a source, a tag
and a colour; one of them may be a live subscription. Nothing downstream may bake in "the current
source" — the list is what delivers two runs side by side, a 2013 replay superimposed on a live feed,
and the record → export → reload loop.

**Boot probe.** The app fetches `/api/health` on start. Reachable → offer the live source.
Unreachable → file-only, silently. Opened from `file://` the probe simply fails, which is correct and
must never be reported as an error.

| Directory | |
|---|---|
| `src/core/` | Pure logic — no DOM, no uPlot: time parsing, JSON repair, flattening, numeric detection, columnar storage, LTTB, alignment, axis grouping, merge, filter. Most contributions land here |
| `src/sources/` | `data-source.ts` is the seam; `file/` parses CSVs, `live/` polls the API |
| `src/state/` | Observable store, `@lit/context`, actions — the dataset list |
| `src/components/` | Lit elements only |
| `src/i18n/` | UI chrome in four languages |
| `test/fixtures/` | Vendored from the EMS. Tracked, not ignored: it is the interface |

## Rules that are load-bearing

Each of these broke something, or provably would. Every one has a lint rule or a test behind it —
that is the standard for putting a rule in this list rather than in a comment.

- **Never `Date.parse`, never `new Date(string)`.** `new Date("2024-01-15")` is UTC while
  `new Date("2024-01-15T00:00:00")` is local, and the EMS writes six-digit fractional seconds that
  fall outside the ES grammar entirely. Use [`src/core/time.ts`](src/core/time.ts), which is the one
  module exempted from the rule. Enforced by `no-restricted-syntax` in
  [`eslint.config.js`](eslint.config.js).
- **Nothing that breaks `file://`**: no dynamic `import()` (also lint-enforced), no Web Workers — so
  PapaParse is never used with `worker: true` — and no external URL, which is why the typeface is
  vendored as woff2 subsets rather than linked. `scripts/check-bundle-size.mjs` is the backstop.
- **The big data lives outside the reactive graph.** Columns are mutable typed arrays and a
  `revision` counter drives updates. Never put a 100k-element array behind a proxy or a
  structural-equality check; `src/state/store.ts` explains why in full.
- **`refreshGap()` is mandatory for live columns**, not an optimisation. `alignSeries` holds a value
  across a foreign timestamp only when `gapMs > 0`, and `gapMs` is set by `seal()`, which only the
  file source calls — so an unsealed live column makes a multi-series chart render completely blank.
- **Retention measures its window from the dataset's own `tMax`, never the wall clock.** Under a
  replay `tMax` is 2013, and a wall-clock cutoff deletes the whole dataset on the first batch.
- **Every `/api` request goes through [`api-client.ts`](src/sources/live/api-client.ts)**, the only
  module that knows `/api` exists and the only one that builds an `Authorization` value. It sends
  `credentials: 'omit'`: that single option is what stops a gated nginx popping the browser's own
  credential dialogue over the app's sign-in panel, because the Fetch spec only prompts when
  credentials are included. It also binds `globalThis.fetch` — `fetch` is a WebIDL operation on
  Window, and calling it with any other receiver throws in a real browser while passing every jsdom
  test.
- **A component that renders text subscribes to `s.locale`.** Translation is a module singleton, so
  one missing `StoreController` means that component keeps its old language with no type error and no
  warning. `test/app.dom.test.ts` checks every text-bearing surface for exactly this.
- **Catalogues use `satisfies Catalogue`, never a type annotation.** Both catch a missing key; only
  `satisfies` reliably catches an *extra* one, because excess-property checking fires only on a fresh
  object literal.
- **[`vite.config.ts`](vite.config.ts)'s dev proxy and [`docker/nginx.conf`](docker/nginx.conf) both
  strip the `/api` prefix, and must change together.** The app never learns an absolute URL; that is
  what makes the same build work behind the container and in development.
- **The sign-in panel is a dismissible strip, never a full-screen gate.** File mode must stay usable
  by someone who never authenticates at all — the static shell is public on purpose, and `auth.phase`
  is orthogonal to `liveProbe` because a 401 means the EMS is reachable *and* we are locked out.

## Recipe: add a core module

`src/core/` is pure: no DOM, no uPlot, no `fetch`. That is what makes it testable in node, and the
`core` vitest project is where most of the suite lives.

1. **Write the module in `src/core/`.** Export functions and types, not classes with hidden state,
   unless the thing genuinely owns a buffer (`ColumnStore` does).
2. **Add `test/<name>.test.ts`.** A plain `.test.ts` runs in the `core` project (node); only
   `*.dom.test.ts` gets jsdom. Do not reach for jsdom to test logic — if a test needs a DOM, the
   logic is probably in the wrong layer.
3. **Timezone is part of the contract.** `vitest.config.ts` sets `TZ=Europe/Brussels` and
   `test/setup.ts` throws if the process did not honour it, because half the assertions in
   `time.test.ts` — the DST fold, the DST gap, naive-versus-offset divergence — pass vacuously in
   UTC. Never work around that check.
4. **Prefer the vendored fixture over an invented one.** `test/helpers/fixtures.ts` loads real EMS
   output; a test written against made-up CSV proves the parser handles made-up CSV.

## Recipe: add or change a UI string

1. **Add the key to [`src/i18n/en.ts`](src/i18n/en.ts).** English is the source of truth, and the
   object is `as const` and **deliberately unannotated** — `Catalogue` is derived from it, so adding
   a key here is what makes it required in the other three.
2. **Add it to `fr.ts`, `nl.ts` and `de.ts`.** Each ends in `satisfies Catalogue`; a missing key, an
   extra key and a shape mismatch are all compile errors.
3. **Placeholders are `{name}`, never a template literal.** A catalogue value must not be mistakable
   for one, and `test/i18n.test.ts` asserts none of them are.
4. **A plural message is an object of CLDR forms**, and `other` is the only required one — which
   forms a locale uses is a property of the locale, not of the message. Render it with `plural()`,
   never by concatenating a count.
5. **Numbers go through `n()`**, which formats via `Intl.NumberFormat`, never `String(x)`.
6. **Never translate anything discovered from data.** A device name, an algorithm name or a field
   path stays exactly as the EMS wrote it — translating an operator's device name would make the
   chart disagree with the CSV they are reading it against.

## Recipe: add a locale

1. Add the tag to `LOCALES` in [`src/i18n/locale.ts`](src/i18n/locale.ts) and its **endonym** to
   `LOCALE_NAMES` — "Français", not "French". You have to already read the interface language to find
   your way out of it otherwise. No flags: a flag is a country, this is a language.
2. Add `src/i18n/<tag>.ts`, ending in `satisfies Catalogue`, and register it where the catalogues are
   resolved.
3. Check the plural forms your locale actually uses; declaring an unused category is not an error,
   omitting a used one is.
4. `detectLocale()` reads `navigator.languages` **in order** — a Belgian browser reports
   `['nl-BE', 'fr-BE', 'en-US']` and that order is the user's stated preference. Do not reduce it to
   `navigator.language`.

## Recipe: add a warning

Warnings are how the load report tells a user what a file got wrong without failing the load.

1. **Add a `WarningDetail`** in [`src/sources/data-source.ts`](src/sources/data-source.ts). That
   union selects the *sentence*.
2. **Reuse an existing `WarningCode` if one fits.** A code is displayed as a token in the load report
   and asserted on by tests — it is the stable, greppable identity, and the vocabulary stays small on
   purpose. One code can carry several details: `BAD_TIMESTAMP` covers both "empty" and
   "unparseable".
3. **Add the message key** to `WARNING_KEYS` in [`src/i18n/warnings.ts`](src/i18n/warnings.ts) and
   the string to all four catalogues. That `Record<WarningDetail, MessageKey>` makes a detail without
   a message a typecheck failure rather than a blank line in the report.
4. **Raise it through the sink**, with the 1-based data row when there is one and a truncated
   `sample` of the offending cell. `data-source.ts` owns the vocabulary, `i18n/warnings.ts` owns the
   text, and neither imports the other's concerns.

## Recipe: add a live endpoint

The EMS API is GET-only, unauthenticated behind nginx, and **polling only** — no WebSocket, no SSE.

1. **Go through [`api-client.ts`](src/sources/live/api-client.ts).** Nothing else may know that
   `/api` exists or build an `Authorization` header.
2. **Add a shape check in [`api-types.ts`](src/sources/live/api-types.ts)** beside
   `checkHealthResponse` and friends, returning `Checked<T> | null`. The API is a separate process on
   a separate release cycle: parse it, do not assume it.
3. **Decide whether the endpoint is a snapshot or a log, and never confuse the two.** The
   `canonicalHash` dedupe exists because `/devices` is a snapshot, where a byte-identical repeat means
   nothing changed; `/decisions` is an append-only log, where a byte-identical repeat is a real event.
   Applying snapshot dedupe to a log silently eats data — the golden fixture is six `off` then twelve
   `on`.
4. **Cursor on `seq`, never on a timestamp.** Timestamps are non-monotonic with legal duplicates, and
   under `speed: 0` every decision in a timestep shares one instant — an inclusive timestamp cursor
   re-delivers the step every poll and an exclusive one drops all but the first of it. The cursor
   belongs to `LiveFeed`, not `LiveSource`: advancing it is a property of the *request*, and one
   request feeds every subscriber.
5. **Treat 404 as "this EMS is older", not as a failure.** Stop asking for the session, raise no
   warning, count no failure, and keep the UI sentence that was true before the route existed —
   switch those sentences on state rather than deleting them.

## Recipe: add a data source

1. **Implement `DataSource`** in a new directory under `src/sources/`.
2. **Push into `SourceSink`; do not expose an async iterator.** Back-pressure is the wrong model:
   `for await` hands the pull rate to the consumer, and a live source cannot honour that — the EMS
   keeps producing whether or not the UI drained. Pushing makes a source's contract "here is what
   happened, now" and leaves volume to the store, in one place.
3. **Set `finite` honestly.** It is the single discriminator the rest of the app keys off: retention
   and follow mode both read it, and neither concept appears anywhere in the interface.
4. **Emit batches ascending by `(t, seq)`, and do not retain the array** after `onBatch` — the store
   takes ownership.
5. **Call `onFields` with the discovered catalogue.** Chartability is a *ratio* over a dataset, so a
   catalogue built from a half-loaded file would disagree with the same file loaded in one go.
6. **`close()` is idempotent, synchronous and irreversible**, and must abort any in-flight parse or
   fetch — it maps one-to-one onto `AbortController.abort()` and `parser.abort()`.

## Recipe: add a component

1. **Create the element in `src/components/`**, `@customElement('motrix-…')`, and import it for side
   effect where it is used.
2. **Decorators are the legacy flavour**, set by `experimentalDecorators` and
   `useDefineForClassFields: false` in [`tsconfig.json`](tsconfig.json). Not a preference: Vite
   transpiles with esbuild, which does not implement TC39 standard decorators. Changing either line
   breaks every `@customElement` in the tree.
3. **Reach the store with `@consume(storeContext)` plus a `StoreController` over a *selector***,
   never the whole state. A chart must not re-render because the timeline filter changed. The store
   arrives through a getter because a field initialiser runs before `@consume` has resolved the
   context.
4. **If it renders text, subscribe to `s.locale`** and pull strings through `t()`. This is the rule
   with the highest ratio of silent breakage to effort.
5. **Take colours from the tokens** in [`src/styles/tokens.css.ts`](src/styles/tokens.css.ts) and
   `index.html`'s `:root`. No component invents a hex. Every text token clears WCAG AA against all
   three backgrounds — check with a calculator before changing one — and primary buttons carry
   `var(--bg-primary)`, never `#fff`, because white on the accent is 1.6:1.
6. **Add a `*.dom.test.ts`** if it renders anything a user reads.

## Recipe: add a chart or a series

1. **Compute in `buildChartData()`** ([`src/core/chart-data.ts`](src/core/chart-data.ts)). It is a
   pure function on purpose: uPlot is never unit-tested — jsdom has no canvas 2D context — so the
   whole slice → downsample → align → axes pipeline stays testable in node, and uPlot's job is
   narrowed to "render the array we hand you".
2. **Colours come from the categorical palette, not the brand tokens.** `SERIES_COLOURS` in
   `src/components/charts/motrix-chart-card.ts` and `DATASET_COLOURS` in `src/state/app-state.ts` are
   one validated palette held in two places, deliberately in the same order: inside an OKLCH lightness
   band for a dark surface, above a chroma floor, with colour-vision separation between adjacent
   slots. Brand teal itself is far too light to be a 1.5px line on near-black, which is why slot 1 is
   that hue one ramp step down. Re-validate before changing any of them.
3. **Sync cursors and zoom with `uPlot.sync()`**, which is one of the two reasons uPlot is here.
4. **Live series must be labelled as sampled by the viewer.** `/devices` is a snapshot endpoint, not
   a time series: honesty about what the live source can and cannot know is a requirement, not a
   nicety.

## Contracts shared with Motrix Edge

- **The storage format is pinned on both sides.** `motrixStorageFormat` in
  [`package.json`](package.json) must match `examples/MANIFEST.json` in
  [motrix-edge](https://github.com/Motrix-Energy/motrix-edge); `test/fixtures.test.ts` asserts the
  pair, so a format bump fails a build here rather than a chart at a user's desk.
- **`test/fixtures/` is tracked, not ignored, because it *is* the interface.** It vendors the EMS's
  golden fixture — real bytes, generated by the EMS running itself — checksum-verified against the
  manifest. Re-vendor with `npm run fixtures:update`; **never hand-edit a fixture**, and never
  regenerate one to make a failing test pass. A fixture that needs updating means the storage format
  moved, which is a cross-repo event with
  [its own procedure](https://motrix-energy.github.io/contribute/storage-format-changes/).
- **`docs/storage-format.md` in motrix-edge is normative** for dialect, CRLF, the lazy header, the
  naive-versus-offset-aware timestamp ambiguity, gap semantics and the flattening/numeric rule. Read
  it before changing any parser here.
- **The flattener and the numeric-string rule are a deliberate second implementation** of a Python
  one (`storage/influxdb.py` there). Two implementations of one rule is acceptable; two that drift
  silently is not, and the shared fixture is what keeps them honest.
- **`command` is an opaque string.** `AutoToggle` emits the bare words `on` and `off`, so code that
  assumes it is JSON breaks on the project's own public example.
- **A replay input is not a reading.** `'input'` is what the pseudo connector *published*;
  `'reading'` is what the EMS *stored*. The EMS writes no row for a rejected payload, so an input with
  no reading at the same instant is the only evidence one was rejected — folding the two together
  destroys exactly that. The payload cell is never trimmed: a P1 telegram loses its terminating CRLF
  if you do.

## Style

- **TypeScript 5.9, `strict`.** The checker is `tsc --noEmit`; Vite does the transpiling.
- **Indentation is tabs**, in `.ts` and `.json` alike. `.editorconfig` sets it; configure your editor
  before your first edit.
- **There is no formatter in this toolchain, and none is to be added.** `npm run lint` is eslint
  looking for wrong code, not style opinions. A reformat would bury every real change in whitespace.
- **British spelling**, in identifiers and prose alike: `normalise`, `COLOURS`, `licence`, `colour`.
  It is consistent throughout, matching it costs nothing, and mixed spellings make a codebase
  ungreppable.
- **Relative imports carry the `.js` extension**, and type-only imports use `import type`.
- **Comments explain *why*.** The what is in the code. Nearly every rule in this file exists as a
  comment somewhere in the tree, next to the incident that caused it; keep that habit.
- **When a rule matters, put a test or a lint rule behind it**, not a sentence alone. That is how
  every entry in "Rules that are load-bearing" earned its place.

## Before you open the pull request

- [ ] `npm run typecheck`, `npm run lint`, `npm test` all green
- [ ] `npm run build` passes, including the single-file check
- [ ] Nothing from a real installation in any example, fixture, test or screenshot
- [ ] New or changed UI strings exist in all four catalogues, with `{name}` placeholders
- [ ] No component invents a colour; nothing new reaches off-disk from `file://`
- [ ] Fixtures untouched — unless the storage format moved, in which case stop and read
      [the cross-repo procedure](https://motrix-energy.github.io/contribute/storage-format-changes/)
- [ ] Anything touching retention or follow mode has been run against the manual harness

By contributing you agree that your work is licensed under [Apache 2.0](LICENSE) and that you will
keep to the [code of conduct](CODE_OF_CONDUCT.md). Security issues do not go in a pull request — see
[SECURITY.md](SECURITY.md).
