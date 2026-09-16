import type { Catalogue } from './catalogue.js';

/**
 * German.
 *
 * **`satisfies`, never a type annotation** — see the note in `fr.ts` for why the two are
 * not interchangeable.
 *
 * German shares English's plural *categories* but not its word forms: `1 Datensatz` /
 * `2 Datensätze`, and `1 Zeitstempel` / `2 Zeitstempel` are identical yet both still have
 * to be declared.
 */
export const de = {
	'nav.label': 'Ansichten',
	'nav.home': 'Start',
	'nav.workspace': 'Arbeitsbereich',
	'nav.live': 'Live-Status',
	'nav.language': 'Sprache',
	'app.title.home': 'Motrix Edge View',
	'app.title.workspace': 'Arbeitsbereich',
	'app.title.live': 'Live-Status',

	'probe.reachable': 'Live-EMS erreichbar',
	'probe.unreachable': 'Dateimodus',

	'home.lede':
		'Sehen Sie, was Motrix Edge getan hat — Gerätemesswerte und Algorithmusentscheidungen auf einer synchronisierten Zeitachse.',
	'home.files.title': 'Dateien öffnen',
	'home.files.body':
		'{readings} und {decisions}, wie das Speicher-Backend {backend} sie schreibt, dazu das vom Pseudo-Konnektor abgespielte {replay} und die {config}, die den Lauf beschreibt. Jede Form wird automatisch erkannt, und mehrere Läufe lassen sich nebeneinander laden.',
	'home.live.title': 'Ein Live-EMS beobachten',
	'home.live.pending': 'Suche nach einem Live-EMS…',
	'home.live.reachable': 'Ein Live-EMS hat geantwortet.',
	'home.live.unreachable': 'Kein Live-EMS hat geantwortet.',
	'home.live.pendingDetail': '/api/health wird gefragt, ob etwas lauscht.',
	'home.live.reachableDetail':
		'Zustand, Uhr, Geräte und Worker finden Sie auf der Seite Live-Status.',
	'home.live.unreachableDetail':
		'Das ist normal, wenn diese Datei direkt von der Festplatte geöffnet wurde. Eine Live-Verbindung setzt voraus, dass der Viewer neben einem laufenden EMS ausgeliefert wird.',
	'home.live.open': 'Live-Status',
	'home.loaded.datasets': 'Datensätze',
	'home.loaded.events': 'Ereignisse',
	'home.loaded.span': 'Zeitraum',
	'home.loaded.open': 'Arbeitsbereich öffnen',
	'home.notes.title': 'Was es sagen kann und was nicht',
	'home.notes.decisionsLead': 'Entscheidungen gibt es nur aus Dateien.',
	'home.notes.decisions':
		'Die REST-API dieses EMS führt keinen Entscheidungsverlauf, daher zeigt der Live-Modus Messwerte und Worker-Zustand — niemals die Entscheidungsrauten. Laden Sie algorithm_decisions.csv daneben, um sie zu sehen.',
	'home.notes.decisionsLiveLead': 'Entscheidungen kommen auch live an.',
	'home.notes.decisionsLive':
		'Dieses EMS liefert einen Entscheidungsverlauf, daher trägt ein Live-Datensatz Entscheidungen ebenso wie Messwerte. Nur was geschah, während dieser Tab offen war — der Viewer beginnt in der Gegenwart und holt nichts nach.',
	'home.notes.sampledLead': 'Live-Reihen werden vom Viewer abgetastet.',
	'home.notes.sampled':
		'{devices} ist ein Momentaufnahme-Endpunkt, keine Zeitreihe; eine Probe erscheint nur, wenn sich die Nutzlast eines Geräts tatsächlich ändert.',
	'home.notes.gapsLead': 'Eine Lücke bedeutet „kein Messwert empfangen“',
	'home.notes.gaps':
		'— nicht null und nicht unverändert. Diagramme unterbrechen die Linie, statt eine zu erfinden.',
	'home.notes.zoneLead': 'Nicht jeder Zeitstempel trägt eine Zeitzone.',
	'home.notes.zone':
		'Naive Zeitstempel werden als Ortszeit dieses Rechners gelesen, und jeder Datensatz mit einem solchen wird gekennzeichnet.',
	'home.notes.localLead': 'Alles wird in diesem Browser gelesen.',
	'home.notes.local': 'Nichts wird irgendwohin hochgeladen.',
	'home.footer': 'Liest Speicherformat {version} — den vom EMS veröffentlichten CSV-Vertrag.',

	'workspace.empty':
		'Nichts geladen. Legen Sie hier eine CSV ab, oder kehren Sie für den geführten Einstieg zu Start zurück.',

	'live.title': 'Live-Status',
	'live.pending': 'Wird geprüft…',
	'live.reachable': 'Ein EMS hat unter /api/health geantwortet.',
	'live.unreachable': 'Kein EMS erreichbar — der Viewer läuft nur im Dateimodus.',
	'live.status.ok': 'Alles läuft.',
	'live.status.degraded': 'Läuft, aber etwas ist abgestürzt und wiederhergestellt worden.',
	'live.status.down': 'Ein Worker ist dauerhaft ausgefallen.',
	'live.status.unknown': 'Das EMS meldete einen Zustand, den dieser Viewer nicht kennt:',
	'live.health.title': 'Zustand',
	'live.health.uptime': 'Laufzeit',
	'live.health.workers': 'Aktive Worker',
	'live.health.restarts': 'Neustarts',
	'live.health.devicesReady': 'Geräte mit Daten',
	'live.health.requests': 'Anfragen / Min.',
	'live.clock.title': 'Uhr',
	'live.clock.mode': 'Modus',
	'live.clock.simulated': 'Replay',
	'live.clock.wall': 'Echtzeit',
	'live.clock.generation': 'Schritt',
	'live.clock.step': 'Schrittzeit',
	'live.clock.pending': 'Dieser Schritt wartet noch auf:',
	'live.devices.title': 'Geräte ({n})',
	'live.devices.name': 'Name',
	'live.devices.class': 'Klasse',
	'live.devices.connector': 'Konnektor',
	'live.devices.ready': 'Bereitschaft',
	'live.devices.capabilities': 'Fähigkeiten',
	'live.devices.energy': 'kWh gesamt',
	'live.devices.connected': 'verbunden',
	'live.devices.hasData': 'hat Daten',
	'live.workers.title': 'Worker ({n})',
	'live.workers.name': 'Name',
	'live.workers.axis': 'Achse',
	'live.workers.state': 'Zustand',
	'live.workers.restarts': 'Neustarts',
	'live.workers.runs': 'Läufe',
	'live.workers.lastRun': 'Letzter Lauf (Echtzeit)',
	'live.workers.state.running': 'läuft',
	'live.workers.state.finished': 'beendet',
	'live.workers.state.down': 'ausgefallen',
	'live.workers.state.lost': 'verloren',
	'live.workers.state.unknown': 'unbekannt:',
	'live.workers.crashes': { one: '— {n} Absturz', other: '— {n} Abstürze' },
	'live.paused': 'Die Abfrage pausiert, weil dieser Tab im Hintergrund ist. Sie wird mit einem frischen Messwert fortgesetzt, sobald Sie zurückkehren — Weiterlaufen würde die Proben still ausdünnen und so tun, als wäre nichts geschehen.',
	'live.cannot.title': 'Was sie nicht zeigen kann',
	'live.cannot.decisionsLead': 'Keine Algorithmusentscheidungen.',
	'live.cannot.decisions':
		'Dieses EMS bietet keinen Entscheidungsverlauf; diese existieren nur in {file}. Laden Sie diese Datei im Arbeitsbereich, um sie zu sehen.',
	'live.can.decisions':
		'Dieses EMS liefert {endpoint}, daher kommen Entscheidungen neben den Messwerten auf einem Live-Datensatz an — ab dem Moment, in dem Sie sich verbunden haben.',
	'live.cannot.seenLead': 'Kein „zuletzt gesehen“ pro Gerät.',
	'live.cannot.seen':
		'Die API meldet, ob ein Gerät Daten hat, nie wann es zuletzt gemeldet hat. Ein ausgefallenes Gerät sieht genauso aus wie eines mit unverändertem Wert.',

	'dropzone.add': '+ Datei hinzufügen',
	'dropzone.title': 'Legen Sie die EMS-Dateien hier ab',
	'dropzone.hint':
		'{readings}, {decisions}, ein {replay} oder die {config} des Laufs — oder klicken zum Durchsuchen. Jede Form wird an ihrem Inhalt erkannt, nicht am Namen.',

	'dataset.rename': 'Diesen Datensatz umbenennen',
	'dataset.remove': 'Entfernen',
	'dataset.naiveBadge': 'naive Zeitzone',
	'dataset.naiveTitle': {
		one: '{n} Zeitstempel trägt keinen UTC-Versatz und wurde als Ortszeit dieses Rechners gelesen. Das EMS schreibt naive Zeitstempel für Live-Läufe, die echte Zone ist also die des schreibenden Rechners.',
		other:
			'{n} Zeitstempel tragen keinen UTC-Versatz und wurden als Ortszeit dieses Rechners gelesen. Das EMS schreibt naive Zeitstempel für Live-Läufe, die echte Zone ist also die des schreibenden Rechners.',
	},
	'dataset.openReport': 'Ladebericht unten öffnen',
	'dataset.status.queued': 'wartet',
	'dataset.status.ok': 'ok',
	'dataset.status.failed': 'fehlgeschlagen',
	'dataset.status.live': 'live · {state}',
	'dataset.status.retrying': 'erneuter Versuch ({n})',
	'dataset.status.events': {
		one: '{count} Ereignis',
		other: '{count} Ereignisse',
	},
	'dataset.summary.datasets': {
		one: 'Datensatz',
		other: 'Datensätze',
	},
	'dataset.summary.readings': {
		one: 'Messwert',
		other: 'Messwerte',
	},
	'dataset.summary.decisions': {
		one: 'Entscheidung',
		other: 'Entscheidungen',
	},
	'dataset.summary.inputs': { one: '{n} Eingabe', other: '{n} Eingaben' },
	'dataset.summary.span': 'Zeitraum',
	'dataset.inputBadge': 'Replay-Eingabe',
	'dataset.inputTitle':
		'Dies sind die Nutzlasten, die der Pseudo-Konnektor veröffentlicht hat, nicht das, was das EMS gespeichert hat. Laden Sie die device_data.csv desselben Laufs daneben: eine Eingabe ohne Messwert zum selben Zeitpunkt ist eine Nutzlast, die das Gerät abgelehnt hat.',
	'dataset.report.summary': {
		one: '{tag}: {n} Hinweis beim Laden',
		other: '{tag}: {n} Hinweise beim Laden',
	},
	'dataset.report.more': {
		one: '… und {n} weiterer',
		other: '… und {n} weitere',
	},
	'dataset.report.row': 'Zeile {n}',

	'charts.title': 'Diagramme',
	'charts.add': '+ Diagramm hinzufügen',
	'charts.alignT0': 'Datensätze an t₀ ausrichten',
	'charts.zoomHint':
		'Ziehen Sie über ein Diagramm zum Zoomen — alle Diagramme und die Zeitachse folgen.',
	'charts.resetZoom': 'Zoom zurücksetzen',
	'charts.follow': 'Folgt dem Live-Rand',
	'charts.followPaused': 'Folgen (pausiert — Sie haben gezoomt)',
	'charts.followWindow': 'Zu folgendes Fenster',
	// Proben, keine Minuten: eine Dauer sagt nichts aus, wenn die EMS-Uhr ein Replay ist, das
	// tausendfach schneller läuft als die Echtzeit. Siehe AppState.follow.
	'charts.followSamples': {
		one: 'letzte Probe',
		other: 'letzte {n} Proben',
	},
	'charts.empty': 'Keine Diagramme. Fügen Sie eines hinzu, um ein Feld darzustellen.',
	'chart.remove': 'Dieses Diagramm entfernen',
	'chart.pickFields': 'Wählen Sie ein oder mehrere Felder zum Darstellen.',
	'chart.noFields': 'Keine numerischen Felder gefunden.',
	'chart.fields': 'Felder ({n})',
	'chart.rootValue': '(Wert)',
	'chart.zoomed': ' · gezoomt',
	// Zugänglicher Name des Diagramms: ein Canvas gibt von sich aus nichts weiter.
	'chart.plotLabel': 'Liniendiagramm, {n} Reihen: {series}. Horizontale Achse {from} bis {to}.',
	'chart.pointsDrawn': {
		one: '{n} Punkt aus {samples} sichtbaren Proben gezeichnet',
		other: '{n} Punkte aus {samples} sichtbaren Proben gezeichnet',
	},

	'timeline.title': 'Zeitachse',
	'timeline.search': 'Nutzlasten durchsuchen…',
	'timeline.clearZoom': 'Zoom aufheben',
	'timeline.shown': {
		one: '{n} angezeigt',
		other: '{n} angezeigt',
	},
	'timeline.emptyNoData': 'Laden Sie eine CSV, um zu beginnen.',
	'timeline.emptyFiltered': 'Nichts entspricht den aktuellen Filtern.',
	'timeline.facet.dataset': 'Datensatz',
	'timeline.facet.kind': 'Art',
	'timeline.facet.actor': 'Quelle',
	'timeline.facet.title': '{label} — ein Wert oder alle',
	'timeline.facet.allDatasets': 'Alle Datensätze',
	'timeline.facet.allKinds': 'Alle Arten',
	'timeline.facet.allActors': 'Alle Quellen',
	'kind.reading': 'Messwert',
	'kind.decision': 'Entscheidung',
	'kind.worker': 'Worker',
	'kind.health': 'Zustand',
	'kind.input': 'Replay-Eingabe',
	'timeline.actorOption': '{actor} ({kind})',

	'unit.days': 'T',
	'unit.hours': 'Std.',
	'unit.minutes': 'Min.',
	'unit.seconds': 's',

	'toast.configLoaded': {
		one: '{name}: {n} konfigurierter Eintrag',
		other: '{name}: {n} konfigurierte Einträge',
	},
	'toast.loadFailed': 'Laden fehlgeschlagen: {message}',
	'toast.liveFailed': 'Live-Verbindung verloren: {message}',

	'dataset.sampledBadge': 'Viewer-Abtastung',
	'dataset.sampledTitle':
		'Das EMS hat diese Reihe nicht in diesem Takt aufgezeichnet — der Viewer hat einen Momentaufnahme-Endpunkt abgefragt und bei jeder Änderung der Nutzlast eine Probe behalten.',
	'dataset.dropped': { one: '{count} verworfen', other: '{count} verworfen' },
	'dataset.droppedTitle':
		'Ältere Ereignisse wurden verworfen, um den Speicher zu begrenzen. Erhöhen Sie das Aufbewahrungsfenster, um mehr zu behalten.',
	'live.connect.open': 'Mit dem Live-EMS verbinden',
	'live.connect.interval': 'Abtasten alle',
	'live.connect.seconds': '{n} s',
	'live.connect.start': 'Verbinden',
	'live.connect.cancel': 'Abbrechen',
	'live.connect.sampled':
		'Der Viewer tastet ab. /devices ist ein Momentaufnahme-Endpunkt, ein Punkt erscheint also nur, wenn sich eine Nutzlast tatsächlich ändert — ein flacher Abschnitt bedeutet, dass sich nichts geändert hat, nicht dass nichts gemessen wurde.',
	'live.connect.cost':
		'Jede Abfrage kostet das EMS eine vollständige Kopie jedes Geräts. Ein langsamerer Takt ist freundlicher, und bei einem Replay läuft die Uhr ohnehin von selbst weiter.',
	'live.connect.decisions':
		'Entscheidungen erscheinen nicht. Die API führt überhaupt keinen Entscheidungsverlauf — laden Sie {file} daneben, um sie zu sehen.',

	'login.lead': 'Dieses EMS erfordert eine Anmeldung.',
	'login.user': 'Benutzer',
	'login.password': 'Passwort',
	'login.submit': 'Anmelden',
	'login.checking': 'Wird geprüft…',
	'login.dismiss': 'Später',
	'login.rejected': 'Dieser Benutzername und dieses Passwort wurden nicht akzeptiert.',
	'login.unreachable': 'Das EMS hat nicht geantwortet. Möglicherweise ist es aus, statt Sie abzuweisen.',
	'login.expired': 'Das EMS akzeptiert die Anmeldedaten nicht mehr, mit denen Sie sich angemeldet haben.',
	'login.scope':
		'Nur Live-Daten liegen dahinter. Dateien, die Sie öffnen, bleiben in jedem Fall lokal.',
	'auth.locked': 'Live-EMS — gesperrt',
	'auth.signedIn': 'angemeldet als {user}',
	'auth.signIn': 'Anmelden',
	'auth.signOut': 'Abmelden',

	'warning.emptyTimestamp': 'leerer Zeitstempel',
	'warning.unparseableTimestamp': 'unlesbarer Zeitstempel',
	'warning.badJson': 'Nutzlast ist kein gültiges JSON',
	'warning.emptyColumn': 'leeres Feld {column}',
	'warning.controlLog':
		'Das sieht nach einem Steuerprotokoll des Pseudo-Konnektors aus. Es ist ein Debug-Protokoll, kein CSV — keine Kopfzeile, keine Anführungszeichen, und jeder JSON-Befehl enthält Kommas. Laden Sie stattdessen algorithm_decisions.csv.',
	'warning.unknownColumns':
		'Unbekannte Spalten: {columns}. Erwartet: device_data.csv oder algorithm_decisions.csv des EMS.',
	'warning.papaparse': '{message}',
	'warning.naiveTimestamps': {
		one: '{n} Zeile trägt keinen UTC-Versatz und wurde als Ortszeit gelesen. Das EMS schreibt naive Zeitstempel für Live-Läufe, die Zone ist also die des schreibenden Rechners — nicht zwingend dieser.',
		other:
			'{n} Zeilen tragen keinen UTC-Versatz und wurden als Ortszeit gelesen. Das EMS schreibt naive Zeitstempel für Live-Läufe, die Zone ist also die des schreibenden Rechners — nicht zwingend dieser.',
	},
	'warning.nonMonotonic': {
		one: '{n} Zeile geht in der Zeit zurück. Das ist normal — mehrere Konnektor-Threads schreiben unter einem Lock, die Dateireihenfolge ist die Schreibreihenfolge — und die Ereignisse werden beim Laden sortiert.',
		other:
			'{n} Zeilen gehen in der Zeit zurück. Das ist normal — mehrere Konnektor-Threads schreiben unter einem Lock, die Dateireihenfolge ist die Schreibreihenfolge — und die Ereignisse werden beim Laden sortiert.',
	},
	'warning.strayEra': {
		one: '{n} Zeile liegt mehr als 30 Tage von den übrigen Daten entfernt. Ein Replay schreibt Echtzeitzeilen vor dem ersten Zeitschritt und nach dem Zurücksetzen der Uhr, eine Backtest-Datei kann also zwei Epochen umspannen. Es wurde nichts verworfen.',
		other:
			'{n} Zeilen liegen mehr als 30 Tage von den übrigen Daten entfernt. Ein Replay schreibt Echtzeitzeilen vor dem ersten Zeitschritt und nach dem Zurücksetzen der Uhr, eine Backtest-Datei kann also zwei Epochen umspannen. Es wurde nichts verworfen.',
	},
	'warning.httpError': 'Das EMS antwortete {status} für {endpoint}.',
	'warning.duplicateSnapshot':
		'Im EMS hat sich seit {seconds} s bei einer Taktung von {interval} s nichts geändert. Entweder ist die Anlage wirklich im Leerlauf, oder das EMS hängt. Der Viewer verwirft keine Daten.',
	'warning.seriesCap':
		'Dieser Datensatz hat seine Grenze von {n} verschiedenen Feldern erreicht. Danach entdeckte Felder werden ignoriert; die bereits geladenen erhalten weiterhin Messwerte. Eine echte Anlage bleibt weit darunter — die Grenze gibt es für eine Quelle, die ihre Nutzlastschlüssel bei jeder Abfrage umbenennt.',
	'warning.jsonReplay':
		'Dies sieht nach einer JSON-Replaydatei aus. Der Viewer liest die CSV-Form eines Replays; exportieren oder konvertieren Sie sie nach CSV, um sie hier zu laden.',
	'warning.configInvalidJson': 'Diese Datei ist kein gültiges JSON: {message}',
	'warning.configUnknownShape':
		'Dies ist gültiges JSON, aber keine EMS-Konfiguration — es wurden keine Konnektoren, Geräte, Algorithmen, Speicher oder Dienste gefunden.',
	'warning.configTooLarge':
		'Diese Konfiguration ist zu groß zum Lesen. Eine config.json hat wenige Kilobyte; etwas viel Größeres ist mit hoher Wahrscheinlichkeit eine andere Datei.',
	'warning.configDuplicateName':
		'Zwei Einträge in {section} heißen beide „{name}“. Der erste wird verwendet, so wie es das EMS tut.',
	'warning.configDanglingRef':
		'„{name}“ verweist auf „{missing}“, was diese Konfiguration nicht deklariert.',
	'warning.configTruncated':
		'Nur die ersten {n} Einträge wurden gelesen. Eine Konfiguration dieser Größe liegt außerhalb dessen, was dieser Viewer beschreiben soll.',
	'warning.decisionsReset':
		'Das EMS wurde neu gestartet, daher begann seine Entscheidungssequenz von vorn. Entscheidungen von vor dem Neustart sind über die API nicht wiederherstellbar; sie stehen in algorithm_decisions.csv.',
	'warning.decisionsGap': {
		one: '{n} Entscheidung wurde vom EMS verworfen, bevor der Viewer sie lesen konnte. Sein Verlaufspuffer ist begrenzt, und die Abfrage ist zurückgefallen.',
		other:
			'{n} Entscheidungen wurden vom EMS verworfen, bevor der Viewer sie lesen konnte. Sein Verlaufspuffer ist begrenzt, und die Abfrage ist zurückgefallen.',
	},

	// --- konfigurierte Topologie ----------------------------------------------------------
	'topology.title': 'Konfigurierte Topologie',
	'topology.summary': { one: '{name} — {n} Eintrag', other: '{name} — {n} Einträge' },
	'topology.remove': 'Diese Konfiguration entfernen',
	'topology.rejected': 'Diese Konfiguration konnte nicht gelesen werden.',
	'topology.version': 'Version {version}',
	'topology.env': 'env {env}',
	'topology.noData':
		'Es ist noch keine CSV geladen, daher wurde nichts unten mit echten Daten abgeglichen. Dies ist, was die Konfiguration deklariert.',
	'topology.privacy':
		'Aus dieser Datei werden nur Namen, Arten, Klassen, Konnektoren und Protokolle gelesen. Broker-Hosts, Benutzernamen, Passwörter, Topics, Ports, Registertabellen und Dateipfade werden nie gelesen und nie angezeigt.',
	'topology.silentLead': 'Konfiguriert, aber ohne Ausgabe.',
	'topology.silentBody':
		'Die CSVs können ein stummes Gerät nicht von einem nie konfigurierten unterscheiden — in beiden Fällen wird keine Zeile geschrieben. Genau dafür ist diese Datei da.',
	'topology.undeclared': {
		one: '{n} Name kommt in den Daten vor, aber nicht in dieser Konfiguration.',
		other: '{n} Namen kommen in den Daten vor, aber nicht in dieser Konfiguration.',
	},
	'topology.filterConnector': 'Die Zeitleiste auf die Geräte dieses Konnektors filtern',
	'topology.role.device': 'Gerät',
	'topology.role.algorithm': 'Algorithmus',
	'topology.role.connector': 'Konnektor',
	'topology.role.storage': 'Speicher',
	'topology.role.service': 'Dienst',
	'topology.column.name': 'Name',
	'topology.column.role': 'Rolle',
	'topology.column.type': 'Art / Klasse',
	'topology.column.connector': 'Konnektor',
	'topology.column.protocol': 'Protokoll',
	'topology.column.status': 'in den Daten',
	'topology.column.cadence': 'Taktung',
	'topology.status.matched': 'vorhanden',
	'topology.status.silent': 'stumm',
	'topology.status.na': '—',
	'topology.cadence.configured': 'alle {seconds} s konfiguriert',
	'topology.cadence.observed': '{seconds} s beobachtet',
} satisfies Catalogue;
