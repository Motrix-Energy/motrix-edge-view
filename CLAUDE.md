# Motrix Edge View

## Goal

A standalone single-page app that visualises what a Motrix Edge did — device readings
and algorithm decisions on a synchronised timeline. It ships as **one self-contained
`index.html`** you can double-click, with every dependency vendored and no network access
required at runtime. An EMS lives on a site LAN; a local debugging tool that needs the
internet to render is the wrong shape.

The viewer is **fully generic**. It knows nothing about specific algorithms, devices, or
data schemas — every device name, algorithm name and chartable field is discovered from
the data at load time. Nothing is hardcoded.

## Standing rule — this repository is public

Never put a customer name, a site topology, a real address or GPS coordinate, a broker
host, a MAC address, a meter serial, or a non-English domain field name in this
repository. Sample data uses `p1_meter` / `shelly_plug` / `pseudo_sensor` and the
`AutoToggle` algorithm.

The interface is translated into four languages, and that is not an exception to the line
above — it sharpens it. `src/i18n/` covers **UI chrome only**: buttons, labels, warnings,
the pages' own prose. Device names, algorithm names and field paths are discovered from the
data at load time and are never translated, never enumerated and never hardcoded. A
non-English string in a catalogue is fine; a non-English string that came from somebody's
site is the thing this rule exists to stop.

**Nothing from a real installation belongs in this repository** — not a device name, not a
field path, not a sample row, not a UI mock-up, not a test fixture. Sites run private
algorithms over private data, and a viewer that ships one operator's vocabulary has both
leaked it and stopped being generic. The worked example is always `AutoToggle`, and the
fixtures are the ones Motrix Edge generates by running itself.

## Input

### Files — the two CSVs written by the EMS's `csv_file` storage backend

```csv
timestamp,device_name,data_json
2024-01-15T10:00:00,pseudo_sensor,"{""topic"": ""sensors/zone/temperature"", ""payload"": ""{\""value\"": 15.2}"", ""parsed"": {""value"": 15.2}}"
```

```csv
timestamp,algorithm,device,command
2024-01-15T10:30:00,AutoToggle,shelly_plug,on
```

`command` is an **opaque string** — `AutoToggle` emits the bare words `on` and `off`, not
JSON. Code that assumes `JSON.parse(command)` breaks on the project's own public example.

`docs/storage-format.md` in the EMS repository is the **normative** reference: dialect,
CRLF, lazy header, the naive-vs-offset-aware timestamp ambiguity, gap semantics, and the
flattening/numeric rule. Read it before changing any parser here.

### Files — the replay input, which is not storage output

```csv
timestamp,device_name,topic,payload
2024-01-15T10:00:00,shelly_plug,shellies/plug-s/relay/0/power,118.4
```

What the pseudo connector **published**, where a reading is what the EMS **stored**. It gets
its own `EventKind`, `'input'`, and must never be folded into `'reading'`: the two would
share an actor key and the distinction would be gone. That distinction is the feature —
storage-format.md §7 says no row is written for a rejected payload, so an input with no
reading at the same instant is the only evidence one was rejected.

`topic` is optional (`pseudo.py` reads it with `row.get`) and doubles as the series-path
prefix, because one device publishes on several topics with different payload types. The
payload cell is **never trimmed**: a P1 telegram loses its terminating CRLF if you do, and
`pseudo.py` does not trim it either. JSON replays are recognised and declined by name.

### Files — `config.json`, as a topology overlay

Not a `DataSource`: a config has no instant, and inventing one would put a marker at `tMax`
that retention measures its window back from. It is a separate list on `AppState`, matched
against the union of loaded datasets.

**`src/core/topology.ts` is a privacy boundary.** It reads twelve named paths and constructs
entries field by field — no spread, no `delete`, no denylist — so an EMS option added next
year is excluded by default rather than by somebody remembering. Four of those paths reach
inside an `options` object; everything else under any `options` is never touched, including
every untyped key under an algorithm's, which is where a private algorithm's parameters live.
Two tests assert that no credential, host, topic or path can reach the parsed document or the
rendered DOM. **Do not delete them.**

### Live — the EMS REST API

`GET /api/health`, `/api/devices`, `/api/devices/{name}`, `/api/workers`, and — on an EMS new
enough — `/api/decisions`. GET-only, unauthenticated, **polling only**: no WebSocket, no SSE.
Reached through a same-origin `/api` prefix that nginx (container) and Vite's dev proxy
(development) both strip; the app never learns an absolute URL.

`/decisions` is the one **cursored** endpoint, and three things about it are load-bearing:

- **The cursor is `seq`, never a timestamp.** storage-format.md §4 makes timestamps
  non-monotonic with legal duplicates, and under `speed=0` every decision in a timestep shares
  one instant — so an inclusive timestamp cursor re-delivers the step every poll and an
  exclusive one drops all but the first of it.
- **`canonical.ts` dedupe must not be applied to it.** That exists because `/devices` is a
  snapshot; this is an append-only log where byte-identical repeats are real events. The
  golden fixture is six `off` then twelve `on`.
- **404 is not a failure.** An EMS predating the route answers 404, and the viewer must
  degrade to exactly its old behaviour: stop asking for the session, no warning, no failure
  count, and the UI keeps saying decisions are file-only. Three UI sentences switch on
  `state.liveDecisions` rather than being deleted, because against an older EMS the old
  sentence is still true.

The cursor lives in `LiveFeed`, not `LiveSource`: advancing it is a property of the *request*,
and one request feeds every subscriber.

## Architecture

**One app, two data sources.** Charts, timeline, filters and summary all operate on a
normalised stream of `{timestamp, source, kind, payload}`. `FileSource` (PapaParse over
the CSVs) and `LiveSource` (polling the API) both produce that same stream behind one
`DataSource` interface. This mirrors the EMS's own thesis one level up: an algorithm does
not care whether data came from MQTT or a CSV replay, and the viewer should not care
whether it came from a file or a socket.

**A dataset *list*, not a source *switch*.** State is N loaded datasets, each with a
source, a tag and a colour; one of them may be a live subscription. Nothing downstream may
bake in "the current source" — that assumption is a rewrite of the state model to remove
later, and a list is what delivers side-by-side comparison of two algorithm runs and the
record → export → reload loop.

**Boot probe.** Fetch `/api/health` on start. Reachable → offer the live source.
Unreachable → file-only, silently. Opened from `file://` the probe simply fails, which is
correct, not an error to report.

**Live datasets need three things file ones do not**: a retention bound (a file is finite,
a subscription grows until the tab dies), a follow mode (sliding window that drops out on
any manual zoom rather than fighting the user), and **time alignment** — a 2013 replay and
a live feed share no wall-clock range, so the x-axis toggles between absolute and
t₀-normalised.

**Honesty about the live source is a requirement, not a nicety.** `/devices` is a snapshot
endpoint, not a time series: samples are emitted only when a device's payload actually
changes, live series are labelled *sampled by viewer @ Ns*, and the UI says plainly that
decisions are file-only.

## Tech stack

- **Lit** — web components, TypeScript, **legacy decorators** (`experimentalDecorators`).
  Not a style choice: Vite transpiles with esbuild, which does not implement TC39 standard
  decorators.
- **uPlot** — charts. ~45 KB against Plotly's ~1 MB, native `uPlot.sync()` for cursor and
  zoom across charts, and built for the 5k–100k+ point range this app lives in.
- **PapaParse** — CSV. **Never with `worker: true`**: blob-URL workers are blocked from a
  `file://` origin, which would break the deliverable.
- **`@lit-labs/virtualizer`** — the timeline.
- **Vite + `vite-plugin-singlefile`** — one inlined, offline `index.html`.
- **Vitest** — `core` (node) and `dom` (jsdom) projects.

## Brand and visual system

The product is **Motrix Edge View**; its sibling runtime is **Motrix Edge**.

The brand rides a design system called Modernist: flat, architectural, set entirely in
Archivo, **zero corner radius**, strong 2px rules on major dividers and 1px on control
chrome, everything flush left. Nothing floats and nothing is decorated.

- **Every colour comes from a token in `index.html`'s `:root`.** No component invents a
  hex. The ground is brand navy `#0B1E2D`; the accent is brand teal `#2FE6C8`; readings are
  teal and decisions amber because those are the mark's two nodes — a reading comes off a
  node, a decision is the dispatch that leaves it.
- **Every text token clears WCAG AA against all three backgrounds.** That is a constraint,
  not an aspiration; the worst case is `--text-muted` on `--bg-tertiary` at 4.82:1. Check
  with a calculator before changing one.
- **Primary buttons carry `var(--bg-primary)`, never `#fff`.** White on this accent is
  1.6:1.
- **Chart marks are not set from those tokens.** `SERIES_COLOURS` and `DATASET_COLOURS` are
  one validated categorical palette held in two places, deliberately in the same order.
  They sit inside an OKLCH lightness band for a dark surface, clear a chroma floor, and keep
  colour-vision separation between adjacent slots. Brand teal itself is far too light to be
  a 1.5px line on near-black — slot 1 is that hue one ramp step down. Re-validate before
  changing any of them.
- **The typeface is vendored, never linked.** `src/styles/fonts/` holds two woff2 subsets of
  the Archivo variable font, imported from `main.ts` so `@font-face` lands in the document
  rather than a shadow root. A `<link>` to Google Fonts would fail
  `scripts/check-bundle-size.mjs` and would silently degrade on an offline site anyway.
- The mark is inline SVG in `motrix-navbar.ts` and `motrix-home.ts`, and a `data:` URI for the
  favicon. Nothing about it may become an external reference.

## Project structure

- `src/core/` — pure, no DOM, no uPlot: time parsing, JSON repair, flattening, numeric
  detection, columnar storage, LTTB, alignment, axis grouping, merge, filter. This is
  where the testable logic lives.
- `src/sources/` — `data-source.ts` (the seam), `file/`, `live/`.
- `src/state/` — observable store + `@lit/context`, actions.
- `src/components/` — Lit elements only.
- `test/fixtures/` — vendored from the EMS repo's `examples/`. Tracked, not ignored: it is
  the interface.

## Rules that are load-bearing

- **Never `Date.parse`, never `new Date(string)`.** `new Date("2024-01-15")` is UTC while
  `new Date("2024-01-15T00:00:00")` is local, and the EMS writes six-digit fractions that
  fall outside the ES grammar. Use `src/core/time.ts`. ESLint enforces this.
- **No dynamic `import()`**, no external URLs, no Web Workers — all three break `file://`.
- **The big data lives outside the reactive graph.** Columns are mutable typed arrays; a
  `revision` counter drives updates. Never put a 100k-element array behind a proxy or a
  structural-equality check.
- **The flattener and the numeric-string rule are a deliberate second implementation** of
  a Python one (`storage/influxdb.py`). Two implementations of one rule is acceptable; two
  that drift silently is not. `docs/storage-format.md` states it normatively, and
  `test/fixtures/` is the shared input that keeps them honest.
- `vite.config.ts`'s dev proxy and `docker/nginx.conf` both strip the `/api` prefix for
  the same reason. **They must change together.**
- **Every `/api` request goes through `src/sources/live/api-client.ts`**, which is the only
  module that knows `/api` exists and the only one that builds an `Authorization` value. It
  sends `credentials: 'omit'` — that single option is what stops a gated nginx popping the
  browser's own credential dialog over the app's sign-in panel, because the Fetch spec only
  prompts when credentials are included. It also binds `globalThis.fetch`: `fetch` is a
  WebIDL operation on Window and calling it with any other receiver throws in a real browser
  while passing every jsdom test.
- **A component that renders text must subscribe to `s.locale`.** Translation is a module
  singleton, so one missing `StoreController` means that component keeps its old language
  with no type error and no warning. `test/app.dom.test.ts` checks every text-bearing
  surface for exactly this.
- **Catalogues use `satisfies Catalogue`, never a type annotation.** Both catch a missing
  key; only `satisfies` reliably catches an extra one, because excess-property checking
  fires only on a fresh object literal.
- **`refreshGap()` is mandatory for live columns**, not an optimisation. `alignSeries` holds
  a value across a foreign timestamp only when `gapMs > 0`, and `gapMs` is set by `seal()`,
  which only the file source calls — so an unsealed live column makes a multi-series chart
  render completely blank.
- **Retention measures its window from the dataset's own `tMax`, never the wall clock.**
  Under a replay `tMax` is 2013, and a wall-clock cutoff deletes the whole dataset on the
  first batch.

## Authentication

The gate is nginx's, not the app's, and that is not a shortcut. This is a static file with
no backend — a password checked inside it protects nothing, because the user already has the
file.

- nginx gates **`location /api/` only**, from `VIEWER_USER` / `VIEWER_PASSWORD` via
  `docker/docker-entrypoint.d/40-viewer-auth.sh`. The static shell stays public: it is the
  same file CI publishes as a release download, and gating it would break file mode for
  someone who only wanted to open a CSV.
- The image ships **fail-closed**, in both directions. Both files are created at build time
  in the gated state with an *empty* `.htpasswd`, so an image whose hook never runs rejects
  everyone rather than admitting everyone; and the hook itself **exits non-zero** when
  `VIEWER_USER` or `VIEWER_PASSWORD` is missing or empty, so a `docker run` with no
  environment does not start at all. There is no default credential — an image that
  invented one would publish the only password in the system. Read the variables with
  `${VAR-}`, never `${VAR:-default}`: the `:-` form substitutes on empty as well as unset,
  which once made the emptiness guard below it unreachable and turned a compose-interpolated
  empty password into a working one.
- `htpasswd -n`, never `-c`: its file-writing path creates a temp file in the CWD, which is
  `/` and is not writable by uid 101. bcrypt cost 8, because nginx re-verifies on every
  request synchronously in the worker.
- The sign-in panel is a **dismissible strip**, never a full-screen gate — file mode must
  stay usable by someone who never authenticates at all.
- `auth.phase` is orthogonal to `liveProbe`. A 401 means the EMS is reachable *and* we are
  locked out, which no single value can say.

## Non-goals

- No server, no database, no backend of its own. The one gate is nginx's, in the container.
- No editing or writing back to the EMS.
- No knowledge of any specific algorithm or device type.
