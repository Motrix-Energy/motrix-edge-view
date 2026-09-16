/**
 * English: the source of truth.
 *
 * `as const` and **deliberately unannotated** — `Catalogue` in `catalogue.ts` is derived
 * from this object, so adding a key here is what makes it required in the other three.
 * A plain string is a plain string; an object of CLDR plural forms is a plural message.
 *
 * **UI chrome only.** Device names, algorithm names and field paths are discovered from the
 * data at load time and are never translated — translating an operator's device name would
 * make the chart disagree with the CSV they are reading it against.
 *
 * Placeholders are `{name}`, never `${name}`: a catalogue value must not be mistakable for
 * a template literal, and `test/i18n.test.ts` asserts none of them are.
 */
export const en = {
	// --- navigation and shell -------------------------------------------------------------
	'nav.label': 'Views',
	'nav.home': 'Home',
	'nav.workspace': 'Workspace',
	'nav.live': 'Live status',
	'nav.language': 'Language',
	'app.title.home': 'Motrix Edge View',
	'app.title.workspace': 'Workspace',
	'app.title.live': 'Live status',

	// --- the live probe -------------------------------------------------------------------
	'probe.reachable': 'live EMS reachable',
	'probe.unreachable': 'file mode',

	// --- home -----------------------------------------------------------------------------
	'home.lede': 'See what Motrix Edge did — device readings and algorithm decisions on one synchronised timeline.',
	'home.files.title': 'Open files',
	'home.files.body':
		'{readings} and {decisions}, as written by the {backend} storage backend, plus the {replay} the pseudo connector replayed and the {config} that describes the run. Every shape is recognised automatically, and several runs can be loaded side by side.',
	'home.live.title': 'Watch a live EMS',
	'home.live.pending': 'Checking for a live EMS…',
	'home.live.reachable': 'A live EMS answered.',
	'home.live.unreachable': 'No live EMS answered.',
	'home.live.pendingDetail': 'Asking /api/health whether anything is listening.',
	'home.live.reachableDetail': 'Its health, clock, devices and workers are on the Live status page.',
	'home.live.unreachableDetail':
		'That is normal when this file was opened directly from disk. A live connection needs the viewer served alongside a running EMS.',
	'home.live.open': 'Live status',
	'home.loaded.datasets': 'Datasets',
	'home.loaded.events': 'Events',
	'home.loaded.span': 'Span',
	'home.loaded.open': 'Open the workspace',
	'home.notes.title': 'What it can and cannot tell you',
	'home.notes.decisionsLead': 'Decisions are file-only.',
	'home.notes.decisions':
		"This EMS's REST API carries no decision history, so live mode shows readings and worker health — never the decision diamonds. Load algorithm_decisions.csv beside it to see them.",
	'home.notes.decisionsLiveLead': 'Decisions arrive live too.',
	'home.notes.decisionsLive':
		'This EMS serves a decision history, so a live dataset carries decisions as well as readings. Only what happened while this tab was open — the viewer starts from the present rather than backfilling.',
	'home.notes.sampledLead': 'Live series are sampled by the viewer.',
	'home.notes.sampled':
		'{devices} is a snapshot endpoint, not a time series; a sample appears only when a device’s payload actually changes.',
	'home.notes.gapsLead': 'A gap means “no reading received”',
	'home.notes.gaps': '— not zero, and not unchanged. Charts break the line rather than inventing one across it.',
	'home.notes.zoneLead': 'Not every timestamp carries a timezone.',
	'home.notes.zone': 'Naive stamps are read as local to this machine, and any dataset holding one is badged.',
	'home.notes.localLead': 'Everything is read in this browser.',
	'home.notes.local': 'Nothing is uploaded anywhere.',
	'home.footer': 'Reads storage format {version} — the CSV contract published by the EMS.',

	// --- workspace --------------------------------------------------------------------------
	'workspace.empty': 'Nothing loaded. Drop a CSV here, or go back to Home for the guided start.',

	// --- live status ------------------------------------------------------------------------
	'live.title': 'Live status',
	'live.pending': 'Checking…',
	'live.reachable': 'An EMS answered at /api/health.',
	'live.unreachable': 'No EMS is reachable — the viewer is running file-only.',
	'live.status.ok': 'Everything is running.',
	'live.status.degraded': 'Running, but something crashed and recovered.',
	'live.status.down': 'A worker is permanently down.',
	// Shown with the raw value beside it, for a status this version has never heard of.
	'live.status.unknown': 'The EMS reported a status this viewer does not know:',
	'live.health.title': 'Health',
	'live.health.uptime': 'Uptime',
	'live.health.workers': 'Workers running',
	'live.health.restarts': 'Restarts',
	'live.health.devicesReady': 'Devices with data',
	'live.health.requests': 'Requests / min',
	'live.clock.title': 'Clock',
	'live.clock.mode': 'Mode',
	'live.clock.simulated': 'replay',
	'live.clock.wall': 'wall clock',
	'live.clock.generation': 'Step',
	'live.clock.step': 'Step time',
	'live.clock.pending': 'This step is still waiting on:',
	'live.devices.title': 'Devices ({n})',
	'live.devices.name': 'Name',
	'live.devices.class': 'Class',
	'live.devices.connector': 'Connector',
	'live.devices.ready': 'Readiness',
	'live.devices.capabilities': 'Capabilities',
	'live.devices.energy': 'Total kWh',
	'live.devices.connected': 'connected',
	'live.devices.hasData': 'has data',
	'live.workers.title': 'Workers ({n})',
	'live.workers.name': 'Name',
	'live.workers.axis': 'Axis',
	'live.workers.state': 'State',
	'live.workers.restarts': 'Restarts',
	'live.workers.runs': 'Runs',
	'live.workers.lastRun': 'Last run (wall clock)',
	'live.workers.state.running': 'running',
	'live.workers.state.finished': 'finished',
	'live.workers.state.down': 'down',
	'live.workers.state.lost': 'lost',
	'live.workers.state.unknown': 'unknown:',
	'live.workers.crashes': { one: '— {n} crash', other: '— {n} crashes' },
	'live.paused': 'Polling is paused because this tab is in the background. It resumes, with a fresh reading, as soon as you come back — continuing would quietly thin the samples out and pretend nothing had happened.',
	'live.cannot.title': 'What it cannot show',
	'live.cannot.decisionsLead': 'No algorithm decisions.',
	'live.cannot.decisions':
		'This EMS exposes no decision history; those live only in {file}. Load that file in the Workspace to see them.',
	'live.can.decisions':
		'This EMS serves {endpoint}, so decisions arrive on a live dataset alongside readings — from the moment you connected onwards.',
	'live.cannot.seenLead': 'No “last seen” per device.',
	'live.cannot.seen':
		'The API reports whether a device has data, never when it last reported. A device that stopped looks exactly like one reporting an unchanged value.',

	// --- dropzone ---------------------------------------------------------------------------
	'dropzone.add': '+ Add a file',
	'dropzone.title': 'Drop the EMS files here',
	'dropzone.hint':
		'{readings}, {decisions}, a {replay} or the run’s {config} — or click to browse. Every shape is recognised from its contents, not its name.',

	// --- dataset bar --------------------------------------------------------------------------
	'dataset.rename': 'Rename this dataset',
	'dataset.remove': 'Remove',
	'dataset.naiveBadge': 'naive TZ',
	'dataset.naiveTitle': {
		one: '{n} timestamp carries no UTC offset and was read as this machine’s local time. The EMS writes naive stamps for live runs, so the real zone is whichever machine wrote the file.',
		other:
			'{n} timestamps carry no UTC offset and were read as this machine’s local time. The EMS writes naive stamps for live runs, so the real zone is whichever machine wrote the file.',
	},
	'dataset.openReport': 'Open the load report below',
	'dataset.status.queued': 'queued',
	'dataset.status.ok': 'ok',
	'dataset.status.failed': 'failed',
	'dataset.status.live': 'live · {state}',
	'dataset.status.retrying': 'retrying ({n})',
	'dataset.status.events': {
		one: '{count} event',
		other: '{count} events',
	},
	'dataset.summary.datasets': {
		one: 'dataset',
		other: 'datasets',
	},
	'dataset.summary.readings': {
		one: 'reading',
		other: 'readings',
	},
	'dataset.summary.decisions': {
		one: 'decision',
		other: 'decisions',
	},
	'dataset.summary.inputs': { one: '{n} input', other: '{n} inputs' },
	'dataset.summary.span': 'span',
	'dataset.inputBadge': 'replay input',
	'dataset.inputTitle':
		'These are the payloads the pseudo connector published, not what the EMS stored. Load the run’s device_data.csv beside it: an input with no reading at the same instant is a payload the device rejected.',
	'dataset.report.summary': {
		one: '{tag}: {n} note while loading',
		other: '{tag}: {n} notes while loading',
	},
	'dataset.report.more': {
		one: '… and {n} more',
		other: '… and {n} more',
	},
	'dataset.report.row': 'row {n}',

	// --- charts -----------------------------------------------------------------------------
	'charts.title': 'Charts',
	'charts.add': '+ Add chart',
	'charts.alignT0': 'Align datasets to t₀',
	'charts.zoomHint': 'Drag on a chart to zoom — every chart and the timeline follow.',
	'charts.resetZoom': 'Reset zoom',
	'charts.follow': 'Following the live edge',
	'charts.followPaused': 'Follow (paused — you zoomed)',
	'charts.followWindow': 'Window to follow',
	// Samples, not minutes: a duration is meaningless when the EMS clock is a replay running
	// thousands of times faster than the wall clock. See AppState.follow.
	'charts.followSamples': {
		one: 'last sample',
		other: 'last {n} samples',
	},
	'charts.empty': 'No charts. Add one to plot a field.',
	'chart.remove': 'Remove this chart',
	'chart.pickFields': 'Pick one or more fields to chart.',
	'chart.noFields': 'No numeric fields found.',
	'chart.fields': 'Fields ({n})',
	'chart.rootValue': '(value)',
	'chart.zoomed': ' · zoomed',
	// Accessible name for the plot. It is a canvas, which exposes nothing on its own, so
	// without this a screen reader announces an empty graphic, or skips it entirely.
	'chart.plotLabel': 'Line chart, {n} series: {series}. Horizontal axis {from} to {to}.',
	// Two independent counts in one sentence, and CLDR selects on exactly one number. Select
	// on the drawn count and keep the samples half plural-invariant: a chart that rendered
	// cannot have drawn from a single sample, so that branch is unreachable in practice.
	'chart.pointsDrawn': {
		one: '{n} point drawn from {samples} samples in view',
		other: '{n} points drawn from {samples} samples in view',
	},

	// --- timeline ---------------------------------------------------------------------------
	'timeline.title': 'Timeline',
	'timeline.search': 'Search payloads…',
	'timeline.clearZoom': 'Clear zoom',
	'timeline.shown': {
		one: '{n} shown',
		other: '{n} shown',
	},
	'timeline.emptyNoData': 'Load a CSV to begin.',
	'timeline.emptyFiltered': 'Nothing matches the current filters.',
	'timeline.facet.dataset': 'Dataset',
	'timeline.facet.kind': 'Kind',
	'timeline.facet.actor': 'Actor',
	'timeline.facet.title': '{label} — one value, or all',
	// Three fixed strings, not `All ${label.toLowerCase()}s`. Not a plural problem: French
	// gender makes the determiner un-computable from the noun ("Tous les types" vs "Toutes
	// les sources"), and lowercasing a label is meaningless in German.
	'timeline.facet.allDatasets': 'All datasets',
	'timeline.facet.allKinds': 'All kinds',
	'timeline.facet.allActors': 'All actors',
	// The four EventKind values, which are a closed enum in core/types.ts — safe to
	// translate, unlike the device and algorithm names beside them in the same dropdown.
	'kind.reading': 'reading',
	'kind.decision': 'decision',
	'kind.worker': 'worker',
	'kind.health': 'health',
	'kind.input': 'replay input',
	'timeline.actorOption': '{actor} ({kind})',

	// --- duration units ----------------------------------------------------------------------
	'unit.days': 'd',
	'unit.hours': 'h',
	'unit.minutes': 'm',
	'unit.seconds': 's',

	// --- toasts ------------------------------------------------------------------------------
	'toast.configLoaded': {
		one: '{name}: {n} configured entry',
		other: '{name}: {n} configured entries',
	},
	'toast.loadFailed': 'Could not load: {message}',
	'toast.liveFailed': 'Live connection lost: {message}',

	// --- sign-in ------------------------------------------------------------------------------
	// --- live subscription ---------------------------------------------------------------
	'dataset.sampledBadge': 'viewer-sampled',
	'dataset.sampledTitle':
		'The EMS did not record this series at this rate — the viewer polled a snapshot endpoint and kept a sample each time the payload changed.',
	'dataset.dropped': { one: '{count} dropped', other: '{count} dropped' },
	'dataset.droppedTitle':
		'Older events have been discarded to bound memory. Raise the retention window to keep more.',
	'live.connect.open': 'Connect to the live EMS',
	'live.connect.interval': 'Sample every',
	'live.connect.seconds': '{n}s',
	'live.connect.start': 'Connect',
	'live.connect.cancel': 'Cancel',
	'live.connect.sampled':
		'The viewer does the sampling. /devices is a snapshot endpoint, so a point appears only when a payload actually changes — a flat stretch means nothing changed, not that nothing was measured.',
	'live.connect.cost':
		'Every poll costs the EMS a full copy of every device. A slower cadence is kinder, and on a replay the clock advances on its own regardless.',
	'live.connect.decisions':
		'Decisions will not appear. The API carries no decision history at all — load {file} alongside this to see them.',

	'login.lead': 'This EMS requires a sign-in.',
	'login.user': 'User',
	'login.password': 'Password',
	'login.submit': 'Sign in',
	'login.checking': 'Checking…',
	'login.dismiss': 'Not now',
	'login.rejected': 'That username and password were not accepted.',
	'login.unreachable': 'The EMS did not answer. It may be down, rather than refusing you.',
	'login.expired': 'The EMS stopped accepting the credential you signed in with.',
	'login.scope': 'Only live data is behind this. Files you open stay local either way.',
	'auth.locked': 'live EMS — locked',
	'auth.signedIn': 'signed in as {user}',
	'auth.signIn': 'Sign in',
	'auth.signOut': 'Sign out',

	// --- source warnings ----------------------------------------------------------------------
	'warning.emptyTimestamp': 'empty timestamp',
	'warning.unparseableTimestamp': 'unparseable timestamp',
	'warning.badJson': 'payload is not valid JSON',
	'warning.emptyColumn': 'empty {column}',
	'warning.controlLog':
		'This looks like a pseudo-connector control log. It is a debug log, not CSV — no header, no quoting, and every JSON command contains commas. Load algorithm_decisions.csv instead.',
	'warning.unknownColumns':
		'Unrecognised columns: {columns}. Expected the EMS’s device_data.csv or algorithm_decisions.csv.',
	// PapaParse's own message, passed through. Library output is not translatable, and
	// pretending otherwise would mean either an infinite catalogue or a lie.
	'warning.papaparse': '{message}',
	'warning.naiveTimestamps': {
		one: '{n} row carries no UTC offset and was read as local time. The EMS writes naive stamps for live runs, so the zone is the machine that wrote the file — not necessarily this one.',
		other:
			'{n} rows carry no UTC offset and were read as local time. The EMS writes naive stamps for live runs, so the zone is the machine that wrote the file — not necessarily this one.',
	},
	'warning.nonMonotonic': {
		one: '{n} row steps backwards in time. This is normal — several connector threads append under one lock, so file order is write order — and the events are sorted on load.',
		other:
			'{n} rows step backwards in time. This is normal — several connector threads append under one lock, so file order is write order — and the events are sorted on load.',
	},
	'warning.strayEra': {
		one: '{n} row sits more than 30 days from the rest of the data. A replay writes wall-clock rows before its first timestep and after the clock resets, so a backtest file can straddle two eras. Nothing was dropped.',
		other:
			'{n} rows sit more than 30 days from the rest of the data. A replay writes wall-clock rows before its first timestep and after the clock resets, so a backtest file can straddle two eras. Nothing was dropped.',
	},
	'warning.httpError': 'The EMS answered {status} for {endpoint}.',
	'warning.duplicateSnapshot':
		'Nothing in the EMS has changed for {seconds}s at a {interval}s cadence. Either the site is genuinely idle, or the EMS is wedged. The viewer is not dropping data.',
	'warning.seriesCap':
		'This dataset has reached its limit of {n} distinct fields. Fields discovered after that are ignored; the ones already loaded keep receiving samples. A real site stays far below this — a source that renames its payload keys on every poll is the case the limit exists for.',
	'warning.jsonReplay':
		'This looks like a JSON replay file. The viewer reads the CSV form of a replay; export or convert it to CSV to load it here.',
	'warning.configInvalidJson': 'This file is not valid JSON: {message}',
	'warning.configUnknownShape':
		'This is valid JSON but not an EMS configuration — no connectors, devices, algorithms, storage or services were found.',
	'warning.configTooLarge':
		'This configuration is too large to read. A config.json is a few kilobytes; something much bigger is almost certainly a different file.',
	'warning.configDuplicateName': 'Two entries in {section} are both named “{name}”. The first is used, as the EMS does.',
	'warning.configDanglingRef': '“{name}” refers to “{missing}”, which this configuration does not declare.',
	'warning.configTruncated':
		'Only the first {n} entries were read. A configuration this large is outside anything this viewer is built to describe.',
	'warning.decisionsReset':
		'The EMS restarted, so its decision sequence began again. Decisions from before the restart are not recoverable through the API; they are in algorithm_decisions.csv.',
	'warning.decisionsGap': {
		one: '{n} decision was dropped by the EMS before the viewer could read it. Its history buffer is bounded, and polling fell behind it.',
		other:
			'{n} decisions were dropped by the EMS before the viewer could read them. Its history buffer is bounded, and polling fell behind it.',
	},

	// --- topology overlay ---------------------------------------------------------------------
	'topology.title': 'Configured topology',
	'topology.summary': { one: '{name} — {n} entry', other: '{name} — {n} entries' },
	'topology.remove': 'Remove this configuration',
	'topology.rejected': 'This configuration could not be read.',
	'topology.version': 'version {version}',
	'topology.env': 'env {env}',
	'topology.noData':
		'No CSV is loaded yet, so nothing below has been matched against real data. This is what the configuration declares.',
	'topology.privacy':
		'Only names, kinds, classes, connectors and protocols are read from this file. Broker hosts, usernames, passwords, topics, ports, register maps and file paths are never read and never shown.',
	'topology.silentLead': 'Configured, but produced nothing.',
	'topology.silentBody':
		'The CSVs cannot tell a silent device from one that was never configured — no row is written for either. That is what this file is for.',
	'topology.undeclared': {
		one: '{n} name appears in the data but not in this configuration.',
		other: '{n} names appear in the data but not in this configuration.',
	},
	'topology.filterConnector': 'Filter the timeline to this connector’s devices',
	'topology.role.device': 'device',
	'topology.role.algorithm': 'algorithm',
	'topology.role.connector': 'connector',
	'topology.role.storage': 'storage',
	'topology.role.service': 'service',
	'topology.column.name': 'name',
	'topology.column.role': 'role',
	'topology.column.type': 'kind / class',
	'topology.column.connector': 'connector',
	'topology.column.protocol': 'protocol',
	'topology.column.status': 'in the data',
	'topology.column.cadence': 'cadence',
	'topology.status.matched': 'reporting',
	'topology.status.silent': 'silent',
	'topology.status.na': '—',
	'topology.cadence.configured': 'every {seconds}s configured',
	'topology.cadence.observed': '{seconds}s observed',
} as const;
