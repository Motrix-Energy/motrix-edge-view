import type { Catalogue } from './catalogue.js';

/**
 * Dutch.
 *
 * **`satisfies`, never a type annotation** — see the note in `fr.ts` for why the two are
 * not interchangeable.
 *
 * Dutch shares English's plural *categories* but not its word forms: `1 melding` /
 * `2 meldingen`, `1 rij` / `2 rijen`. Both forms still have to be written out.
 */
export const nl = {
	'nav.label': 'Weergaven',
	'nav.home': 'Start',
	'nav.workspace': 'Werkruimte',
	'nav.live': 'Live status',
	'nav.language': 'Taal',
	'app.title.home': 'Motrix Edge View',
	'app.title.workspace': 'Werkruimte',
	'app.title.live': 'Live status',

	'probe.reachable': 'live EMS bereikbaar',
	'probe.unreachable': 'bestandsmodus',

	'home.lede':
		'Bekijk wat Motrix Edge heeft gedaan — apparaatmetingen en algoritmebeslissingen op één gesynchroniseerde tijdlijn.',
	'home.files.title': 'Bestanden openen',
	'home.files.body':
		'{readings} en {decisions}, zoals de opslagbackend {backend} ze schrijft, plus de {replay} die de pseudo-connector afspeelde en de {config} die de run beschrijft. Elke vorm wordt automatisch herkend, en meerdere runs kunnen naast elkaar worden geladen.',
	'home.live.title': 'Een live EMS volgen',
	'home.live.pending': 'Zoeken naar een live EMS…',
	'home.live.reachable': 'Een live EMS heeft geantwoord.',
	'home.live.unreachable': 'Geen live EMS heeft geantwoord.',
	'home.live.pendingDetail': 'We vragen /api/health of er iets luistert.',
	'home.live.reachableDetail':
		'De status, klok, apparaten en workers staan op de pagina Live status.',
	'home.live.unreachableDetail':
		'Dat is normaal wanneer dit bestand rechtstreeks vanaf schijf is geopend. Een live verbinding vereist dat de viewer naast een draaiende EMS wordt aangeboden.',
	'home.live.open': 'Live status',
	'home.loaded.datasets': 'Datasets',
	'home.loaded.events': 'Gebeurtenissen',
	'home.loaded.span': 'Tijdsduur',
	'home.loaded.open': 'Werkruimte openen',
	'home.notes.title': 'Wat het wel en niet kan vertellen',
	'home.notes.decisionsLead': 'Beslissingen komen alleen uit bestanden.',
	'home.notes.decisions':
		'De REST-API van deze EMS bevat geen beslissingsgeschiedenis, dus de live modus toont metingen en workerstatus — nooit de beslissingsruiten. Laad algorithm_decisions.csv ernaast om ze te zien.',
	'home.notes.decisionsLiveLead': 'Beslissingen komen ook live binnen.',
	'home.notes.decisionsLive':
		'Deze EMS levert een beslissingsgeschiedenis, dus een live dataset bevat beslissingen én metingen. Alleen wat gebeurde terwijl dit tabblad open was — de viewer begint bij het heden en haalt niets in.',
	'home.notes.sampledLead': 'Live reeksen worden door de viewer bemonsterd.',
	'home.notes.sampled':
		'{devices} is een momentopname, geen tijdreeks; een monster verschijnt alleen wanneer de payload van een apparaat werkelijk verandert.',
	'home.notes.gapsLead': 'Een gat betekent “geen meting ontvangen”',
	'home.notes.gaps':
		'— niet nul, en niet ongewijzigd. Grafieken onderbreken de lijn in plaats van er een te verzinnen.',
	'home.notes.zoneLead': 'Niet elk tijdstempel draagt een tijdzone.',
	'home.notes.zone':
		'Naïeve tijdstempels worden gelezen als lokale tijd van deze machine, en elke dataset die er een bevat krijgt een label.',
	'home.notes.localLead': 'Alles wordt in deze browser gelezen.',
	'home.notes.local': 'Er wordt niets geüpload.',
	'home.footer': 'Leest opslagformaat {version} — het CSV-contract dat de EMS publiceert.',

	'workspace.empty':
		'Niets geladen. Zet hier een CSV neer, of ga terug naar Start voor een begeleide start.',

	'live.title': 'Live status',
	'live.pending': 'Bezig met controleren…',
	'live.reachable': 'Een EMS heeft geantwoord op /api/health.',
	'live.unreachable': 'Geen EMS bereikbaar — de viewer draait alleen op bestanden.',
	'live.status.ok': 'Alles draait.',
	'live.status.degraded': 'Draait, maar er is iets gecrasht en hersteld.',
	'live.status.down': 'Een worker ligt definitief plat.',
	'live.status.unknown': 'De EMS meldde een status die deze viewer niet kent:',
	'live.health.title': 'Status',
	'live.health.uptime': 'Bedrijfstijd',
	'live.health.workers': 'Actieve workers',
	'live.health.restarts': 'Herstarts',
	'live.health.devicesReady': 'Apparaten met gegevens',
	'live.health.requests': 'Verzoeken / min',
	'live.clock.title': 'Klok',
	'live.clock.mode': 'Modus',
	'live.clock.simulated': 'replay',
	'live.clock.wall': 'wandkloktijd',
	'live.clock.generation': 'Stap',
	'live.clock.step': 'Staptijd',
	'live.clock.pending': 'Deze stap wacht nog op:',
	'live.devices.title': 'Apparaten ({n})',
	'live.devices.name': 'Naam',
	'live.devices.class': 'Klasse',
	'live.devices.connector': 'Connector',
	'live.devices.ready': 'Gereedheid',
	'live.devices.capabilities': 'Mogelijkheden',
	'live.devices.energy': 'Totaal kWh',
	'live.devices.connected': 'verbonden',
	'live.devices.hasData': 'heeft gegevens',
	'live.workers.title': 'Workers ({n})',
	'live.workers.name': 'Naam',
	'live.workers.axis': 'As',
	'live.workers.state': 'Toestand',
	'live.workers.restarts': 'Herstarts',
	'live.workers.runs': 'Uitvoeringen',
	'live.workers.lastRun': 'Laatste uitvoering (wandkloktijd)',
	'live.workers.state.running': 'actief',
	'live.workers.state.finished': 'klaar',
	'live.workers.state.down': 'plat',
	'live.workers.state.lost': 'verloren',
	'live.workers.state.unknown': 'onbekend:',
	'live.workers.crashes': { one: '— {n} crash', other: '— {n} crashes' },
	'live.paused': 'Het bevragen is gepauzeerd omdat dit tabblad op de achtergrond staat. Het hervat, met een verse meting, zodra u terugkomt — doorgaan zou de monsters stilletjes uitdunnen en doen alsof er niets gebeurd was.',
	'live.cannot.title': 'Wat het niet kan tonen',
	'live.cannot.decisionsLead': 'Geen algoritmebeslissingen.',
	'live.cannot.decisions':
		'Deze EMS biedt geen beslissingsgeschiedenis; die bestaat alleen in {file}. Laad dat bestand in de werkruimte om ze te zien.',
	'live.can.decisions':
		'Deze EMS levert {endpoint}, dus beslissingen komen op een live dataset binnen naast de metingen — vanaf het moment dat u verbinding maakte.',
	'live.cannot.seenLead': 'Geen “laatst gezien” per apparaat.',
	'live.cannot.seen':
		'De API meldt of een apparaat gegevens heeft, nooit wanneer het voor het laatst iets stuurde. Een gestopt apparaat ziet er precies zo uit als een apparaat met een ongewijzigde waarde.',

	'dropzone.add': '+ Bestand toevoegen',
	'dropzone.title': 'Zet de EMS-bestanden hier neer',
	'dropzone.hint':
		'{readings}, {decisions}, een {replay} of de {config} van de run — of klik om te bladeren. Elke vorm wordt herkend aan de inhoud, niet aan de naam.',

	'dataset.rename': 'Deze dataset hernoemen',
	'dataset.remove': 'Verwijderen',
	'dataset.naiveBadge': 'naïeve TZ',
	'dataset.naiveTitle': {
		one: '{n} tijdstempel draagt geen UTC-offset en is gelezen als lokale tijd van deze machine. De EMS schrijft naïeve tijdstempels voor live runs, dus de echte zone is die van de machine die het bestand schreef.',
		other:
			'{n} tijdstempels dragen geen UTC-offset en zijn gelezen als lokale tijd van deze machine. De EMS schrijft naïeve tijdstempels voor live runs, dus de echte zone is die van de machine die het bestand schreef.',
	},
	'dataset.openReport': 'Open het laadrapport hieronder',
	'dataset.status.queued': 'in wachtrij',
	'dataset.status.ok': 'ok',
	'dataset.status.failed': 'mislukt',
	'dataset.status.live': 'live · {state}',
	'dataset.status.retrying': 'opnieuw proberen ({n})',
	'dataset.status.events': {
		one: '{count} gebeurtenis',
		other: '{count} gebeurtenissen',
	},
	'dataset.summary.datasets': {
		one: 'dataset',
		other: 'datasets',
	},
	'dataset.summary.readings': {
		one: 'meting',
		other: 'metingen',
	},
	'dataset.summary.decisions': {
		one: 'beslissing',
		other: 'beslissingen',
	},
	'dataset.summary.inputs': { one: '{n} invoer', other: '{n} invoeren' },
	'dataset.summary.span': 'tijdsduur',
	'dataset.inputBadge': 'replay-invoer',
	'dataset.inputTitle':
		'Dit zijn de payloads die de pseudo-connector publiceerde, niet wat de EMS opsloeg. Laad de device_data.csv van dezelfde run ernaast: een invoer zonder meting op hetzelfde moment is een payload die het apparaat weigerde.',
	'dataset.report.summary': {
		one: '{tag}: {n} opmerking bij het laden',
		other: '{tag}: {n} opmerkingen bij het laden',
	},
	'dataset.report.more': {
		one: '… en nog {n}',
		other: '… en nog {n}',
	},
	'dataset.report.row': 'rij {n}',

	'charts.title': 'Grafieken',
	'charts.add': '+ Grafiek toevoegen',
	'charts.alignT0': 'Datasets uitlijnen op t₀',
	'charts.zoomHint': 'Sleep over een grafiek om te zoomen — elke grafiek en de tijdlijn volgen.',
	'charts.resetZoom': 'Zoom herstellen',
	'charts.follow': 'Volgt de live rand',
	'charts.followPaused': 'Volgen (gepauzeerd — u zoomde in)',
	'charts.followWindow': 'Te volgen venster',
	// Monsters, geen minuten: een duur zegt niets wanneer de EMS-klok een replay is die
	// duizenden keren sneller loopt dan de echte tijd. Zie AppState.follow.
	'charts.followSamples': {
		one: 'laatste monster',
		other: 'laatste {n} monsters',
	},
	'charts.empty': 'Geen grafieken. Voeg er een toe om een veld te tekenen.',
	'chart.remove': 'Deze grafiek verwijderen',
	'chart.pickFields': 'Kies een of meer velden om te tekenen.',
	'chart.noFields': 'Geen numerieke velden gevonden.',
	'chart.fields': 'Velden ({n})',
	'chart.rootValue': '(waarde)',
	'chart.zoomed': ' · ingezoomd',
	// Toegankelijke naam voor de grafiek: een canvas geeft uit zichzelf niets door.
	'chart.plotLabel': 'Lijndiagram, {n} reeksen: {series}. Horizontale as {from} tot {to}.',
	'chart.pointsDrawn': {
		one: '{n} punt getekend uit {samples} zichtbare monsters',
		other: '{n} punten getekend uit {samples} zichtbare monsters',
	},

	'timeline.title': 'Tijdlijn',
	'timeline.search': 'Payloads doorzoeken…',
	'timeline.clearZoom': 'Zoom wissen',
	'timeline.shown': {
		one: '{n} getoond',
		other: '{n} getoond',
	},
	'timeline.emptyNoData': 'Laad een CSV om te beginnen.',
	'timeline.emptyFiltered': 'Niets voldoet aan de huidige filters.',
	'timeline.facet.dataset': 'Dataset',
	'timeline.facet.kind': 'Soort',
	'timeline.facet.actor': 'Bron',
	'timeline.facet.title': '{label} — één waarde, of alle',
	'timeline.facet.allDatasets': 'Alle datasets',
	'timeline.facet.allKinds': 'Alle soorten',
	'timeline.facet.allActors': 'Alle bronnen',
	'kind.reading': 'meting',
	'kind.decision': 'beslissing',
	'kind.worker': 'worker',
	'kind.health': 'status',
	'kind.input': 'replay-invoer',
	'timeline.actorOption': '{actor} ({kind})',

	'unit.days': 'd',
	'unit.hours': 'u',
	'unit.minutes': 'min',
	'unit.seconds': 's',

	'toast.configLoaded': {
		one: '{name}: {n} geconfigureerd item',
		other: '{name}: {n} geconfigureerde items',
	},
	'toast.loadFailed': 'Laden mislukt: {message}',
	'toast.liveFailed': 'Live verbinding verbroken: {message}',

	'dataset.sampledBadge': 'viewer-bemonsterd',
	'dataset.sampledTitle':
		'De EMS heeft deze reeks niet met dit tempo vastgelegd — de viewer bevroeg een momentopname-endpoint en bewaarde een monster telkens als de payload veranderde.',
	'dataset.dropped': { one: '{count} verwijderd', other: '{count} verwijderd' },
	'dataset.droppedTitle':
		'Oudere gebeurtenissen zijn weggegooid om het geheugen te begrenzen. Verhoog het retentievenster om er meer te bewaren.',
	'live.connect.open': 'Verbinden met de live EMS',
	'live.connect.interval': 'Bemonsteren elke',
	'live.connect.seconds': '{n} s',
	'live.connect.start': 'Verbinden',
	'live.connect.cancel': 'Annuleren',
	'live.connect.sampled':
		'De viewer doet het bemonsteren. /devices is een momentopname-endpoint, dus een punt verschijnt alleen wanneer een payload werkelijk verandert — een vlak stuk betekent dat er niets veranderde, niet dat er niets gemeten is.',
	'live.connect.cost':
		'Elke bevraging kost de EMS een volledige kopie van elk apparaat. Een trager tempo is vriendelijker, en bij een replay loopt de klok toch vanzelf door.',
	'live.connect.decisions':
		'Beslissingen verschijnen niet. De API bevat geen enkele beslissingsgeschiedenis — laad {file} ernaast om ze te zien.',

	'login.lead': 'Deze EMS vereist een aanmelding.',
	'login.user': 'Gebruiker',
	'login.password': 'Wachtwoord',
	'login.submit': 'Aanmelden',
	'login.checking': 'Bezig met controleren…',
	'login.dismiss': 'Niet nu',
	'login.rejected': 'Die gebruikersnaam en dat wachtwoord zijn niet geaccepteerd.',
	'login.unreachable': 'De EMS antwoordde niet. Mogelijk ligt hij plat in plaats van u te weigeren.',
	'login.expired': 'De EMS accepteert de gegevens waarmee u zich aanmeldde niet langer.',
	'login.scope':
		'Alleen live gegevens zitten hierachter. Bestanden die u opent blijven hoe dan ook lokaal.',
	'auth.locked': 'live EMS — vergrendeld',
	'auth.signedIn': 'aangemeld als {user}',
	'auth.signIn': 'Aanmelden',
	'auth.signOut': 'Afmelden',

	'warning.emptyTimestamp': 'leeg tijdstempel',
	'warning.unparseableTimestamp': 'onleesbaar tijdstempel',
	'warning.badJson': 'payload is geen geldige JSON',
	'warning.emptyColumn': 'lege {column}',
	'warning.controlLog':
		'Dit lijkt op een controlelogboek van de pseudo-connector. Het is een debuglogboek, geen CSV — geen koptekst, geen aanhalingstekens, en elk JSON-commando bevat komma’s. Laad in plaats daarvan algorithm_decisions.csv.',
	'warning.unknownColumns':
		'Niet-herkende kolommen: {columns}. Verwacht: device_data.csv of algorithm_decisions.csv van de EMS.',
	'warning.papaparse': '{message}',
	'warning.naiveTimestamps': {
		one: '{n} rij draagt geen UTC-offset en is gelezen als lokale tijd. De EMS schrijft naïeve tijdstempels voor live runs, dus de zone is die van de machine die het bestand schreef — niet noodzakelijk deze.',
		other:
			'{n} rijen dragen geen UTC-offset en zijn gelezen als lokale tijd. De EMS schrijft naïeve tijdstempels voor live runs, dus de zone is die van de machine die het bestand schreef — niet noodzakelijk deze.',
	},
	'warning.nonMonotonic': {
		one: '{n} rij gaat terug in de tijd. Dat is normaal — meerdere connectorthreads schrijven onder één lock, dus bestandsvolgorde is schrijfvolgorde — en de gebeurtenissen worden bij het laden gesorteerd.',
		other:
			'{n} rijen gaan terug in de tijd. Dat is normaal — meerdere connectorthreads schrijven onder één lock, dus bestandsvolgorde is schrijfvolgorde — en de gebeurtenissen worden bij het laden gesorteerd.',
	},
	'warning.strayEra': {
		one: '{n} rij ligt meer dan 30 dagen van de rest van de gegevens af. Een replay schrijft wandkloktijd-rijen vóór de eerste tijdstap en na het herstellen van de klok, dus een backtestbestand kan twee tijdperken overspannen. Er is niets weggegooid.',
		other:
			'{n} rijen liggen meer dan 30 dagen van de rest van de gegevens af. Een replay schrijft wandkloktijd-rijen vóór de eerste tijdstap en na het herstellen van de klok, dus een backtestbestand kan twee tijdperken overspannen. Er is niets weggegooid.',
	},
	'warning.httpError': 'De EMS antwoordde {status} op {endpoint}.',
	'warning.duplicateSnapshot':
		'Er is al {seconds} s niets veranderd in de EMS bij een cadans van {interval} s. Ofwel is de locatie echt inactief, ofwel zit de EMS vast. De viewer laat geen gegevens vallen.',
	'warning.seriesCap':
		'Deze dataset heeft de limiet van {n} verschillende velden bereikt. Velden die daarna worden ontdekt, worden genegeerd; de al geladen velden blijven metingen ontvangen. Een echte locatie blijft daar ruim onder — de limiet bestaat voor een bron die haar payloadsleutels bij elke polling hernoemt.',
	'warning.jsonReplay':
		'Dit lijkt op een JSON-replaybestand. De viewer leest de CSV-vorm van een replay; exporteer of converteer het naar CSV om het hier te laden.',
	'warning.configInvalidJson': 'Dit bestand is geen geldige JSON: {message}',
	'warning.configUnknownShape':
		'Dit is geldige JSON maar geen EMS-configuratie — er zijn geen connectoren, apparaten, algoritmen, opslag of services gevonden.',
	'warning.configTooLarge':
		'Deze configuratie is te groot om te lezen. Een config.json is enkele kilobytes; iets veel groters is vrijwel zeker een ander bestand.',
	'warning.configDuplicateName':
		'Twee items in {section} heten allebei “{name}”. Het eerste wordt gebruikt, net als de EMS doet.',
	'warning.configDanglingRef':
		'“{name}” verwijst naar “{missing}”, dat deze configuratie niet declareert.',
	'warning.configTruncated':
		'Alleen de eerste {n} items zijn gelezen. Een configuratie van deze omvang valt buiten wat deze viewer kan beschrijven.',
	'warning.decisionsReset':
		'De EMS is herstart, dus zijn beslissingsreeks begon opnieuw. Beslissingen van vóór de herstart zijn niet via de API terug te halen; ze staan in algorithm_decisions.csv.',
	'warning.decisionsGap': {
		one: '{n} beslissing is door de EMS weggegooid voordat de viewer die kon lezen. De geschiedenisbuffer is begrensd en de polling raakte achter.',
		other:
			'{n} beslissingen zijn door de EMS weggegooid voordat de viewer ze kon lezen. De geschiedenisbuffer is begrensd en de polling raakte achter.',
	},

	// --- geconfigureerde topologie --------------------------------------------------------
	'topology.title': 'Geconfigureerde topologie',
	'topology.summary': { one: '{name} — {n} item', other: '{name} — {n} items' },
	'topology.remove': 'Deze configuratie verwijderen',
	'topology.rejected': 'Deze configuratie kon niet worden gelezen.',
	'topology.version': 'versie {version}',
	'topology.env': 'env {env}',
	'topology.noData':
		'Er is nog geen CSV geladen, dus niets hieronder is vergeleken met echte gegevens. Dit is wat de configuratie declareert.',
	'topology.privacy':
		'Alleen namen, soorten, klassen, connectoren en protocollen worden uit dit bestand gelezen. Brokerhosts, gebruikersnamen, wachtwoorden, topics, poorten, registertabellen en bestandspaden worden nooit gelezen en nooit getoond.',
	'topology.silentLead': 'Geconfigureerd, maar heeft niets geproduceerd.',
	'topology.silentBody':
		'De CSV’s kunnen een stil apparaat niet onderscheiden van een dat nooit is geconfigureerd — in beide gevallen wordt geen rij geschreven. Daarvoor dient dit bestand.',
	'topology.undeclared': {
		one: '{n} naam komt in de gegevens voor maar niet in deze configuratie.',
		other: '{n} namen komen in de gegevens voor maar niet in deze configuratie.',
	},
	'topology.filterConnector': 'De tijdlijn filteren op de apparaten van deze connector',
	'topology.role.device': 'apparaat',
	'topology.role.algorithm': 'algoritme',
	'topology.role.connector': 'connector',
	'topology.role.storage': 'opslag',
	'topology.role.service': 'service',
	'topology.column.name': 'naam',
	'topology.column.role': 'rol',
	'topology.column.type': 'soort / klasse',
	'topology.column.connector': 'connector',
	'topology.column.protocol': 'protocol',
	'topology.column.status': 'in de gegevens',
	'topology.column.cadence': 'cadans',
	'topology.status.matched': 'aanwezig',
	'topology.status.silent': 'stil',
	'topology.status.na': '—',
	'topology.cadence.configured': 'elke {seconds} s geconfigureerd',
	'topology.cadence.observed': '{seconds} s waargenomen',
} satisfies Catalogue;
