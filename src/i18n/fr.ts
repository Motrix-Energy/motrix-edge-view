import type { Catalogue } from './catalogue.js';

/**
 * French.
 *
 * **`satisfies`, never a type annotation.** Both forms catch a *missing* key, but excess
 * property checking fires only on a fresh object literal — the moment somebody refactors to
 * `const draft = {…}; export const fr: Catalogue = draft;` the extra-key check silently
 * evaporates. `satisfies` checks the literal in place and cannot be routed around.
 *
 * Note `one` covers **0 as well as 1** here: French treats zero as singular. That is not a
 * typo in the entries below, it is the CLDR rule, and `test/i18n.test.ts` pins it.
 */
export const fr = {
	'nav.label': 'Vues',
	'nav.home': 'Accueil',
	'nav.workspace': 'Espace de travail',
	'nav.live': 'État en direct',
	'nav.language': 'Langue',
	'app.title.home': 'Motrix Edge View',
	'app.title.workspace': 'Espace de travail',
	'app.title.live': 'État en direct',

	'probe.reachable': 'EMS en direct joignable',
	'probe.unreachable': 'mode fichier',

	'home.lede':
		'Voyez ce qu’a fait Motrix Edge — relevés des appareils et décisions des algorithmes sur une seule chronologie synchronisée.',
	'home.files.title': 'Ouvrir des fichiers',
	'home.files.body':
		'{readings} et {decisions}, tels que les écrit le backend de stockage {backend}, ainsi que le {replay} rejoué par le connecteur pseudo et la {config} qui décrit l’exécution. Chaque format est reconnu automatiquement, et plusieurs exécutions peuvent être chargées côte à côte.',
	'home.live.title': 'Observer un EMS en direct',
	'home.live.pending': 'Recherche d’un EMS en direct…',
	'home.live.reachable': 'Un EMS en direct a répondu.',
	'home.live.unreachable': 'Aucun EMS en direct n’a répondu.',
	'home.live.pendingDetail': 'On demande à /api/health si quelque chose écoute.',
	'home.live.reachableDetail':
		'Son état, son horloge, ses appareils et ses processus sont sur la page État en direct.',
	'home.live.unreachableDetail':
		'C’est normal si ce fichier a été ouvert directement depuis le disque. Une connexion en direct exige que la visionneuse soit servie aux côtés d’un EMS en fonctionnement.',
	'home.live.open': 'État en direct',
	'home.loaded.datasets': 'Jeux de données',
	'home.loaded.events': 'Événements',
	'home.loaded.span': 'Durée',
	'home.loaded.open': 'Ouvrir l’espace de travail',
	'home.notes.title': 'Ce qu’il peut et ne peut pas vous dire',
	'home.notes.decisionsLead': 'Les décisions ne viennent que des fichiers.',
	'home.notes.decisions':
		'L’API REST de cet EMS ne conserve pas d’historique de décisions : le mode direct montre les relevés et l’état des processus, jamais les losanges de décision. Chargez algorithm_decisions.csv à côté pour les voir.',
	'home.notes.decisionsLiveLead': 'Les décisions arrivent aussi en direct.',
	'home.notes.decisionsLive':
		'Cet EMS expose un historique de décisions : un jeu de données en direct porte donc les décisions autant que les relevés. Uniquement ce qui s’est produit pendant que cet onglet était ouvert — la visionneuse part du présent plutôt que de rattraper le passé.',
	'home.notes.sampledLead': 'Les séries en direct sont échantillonnées par la visionneuse.',
	'home.notes.sampled':
		'{devices} est un point d’accès instantané, pas une série temporelle ; un échantillon n’apparaît que lorsque la charge utile d’un appareil change réellement.',
	'home.notes.gapsLead': 'Un trou signifie « aucun relevé reçu »',
	'home.notes.gaps':
		'— ni zéro, ni inchangé. Les graphiques interrompent la courbe au lieu d’en inventer une.',
	'home.notes.zoneLead': 'Tous les horodatages ne portent pas de fuseau horaire.',
	'home.notes.zone':
		'Les horodatages naïfs sont lus comme l’heure locale de cette machine, et tout jeu de données qui en contient est signalé.',
	'home.notes.localLead': 'Tout est lu dans ce navigateur.',
	'home.notes.local': 'Rien n’est envoyé nulle part.',
	'home.footer': 'Lit le format de stockage {version} — le contrat CSV publié par l’EMS.',

	'workspace.empty':
		'Rien de chargé. Déposez un CSV ici, ou revenez à l’accueil pour un démarrage guidé.',

	'live.title': 'État en direct',
	'live.pending': 'Vérification…',
	'live.reachable': 'Un EMS a répondu sur /api/health.',
	'live.unreachable': 'Aucun EMS joignable — la visionneuse fonctionne en mode fichier.',
	'live.status.ok': 'Tout fonctionne.',
	'live.status.degraded': 'En marche, mais quelque chose a planté puis redémarré.',
	'live.status.down': 'Un processus est définitivement arrêté.',
	'live.status.unknown': 'L’EMS a signalé un état inconnu de cette visionneuse :',
	'live.health.title': 'État',
	'live.health.uptime': 'Durée de fonctionnement',
	'live.health.workers': 'Processus actifs',
	'live.health.restarts': 'Redémarrages',
	'live.health.devicesReady': 'Appareils avec données',
	'live.health.requests': 'Requêtes / min',
	'live.clock.title': 'Horloge',
	'live.clock.mode': 'Mode',
	'live.clock.simulated': 'rejeu',
	'live.clock.wall': 'temps réel',
	'live.clock.generation': 'Pas',
	'live.clock.step': 'Heure du pas',
	'live.clock.pending': 'Ce pas attend encore :',
	'live.devices.title': 'Appareils ({n})',
	'live.devices.name': 'Nom',
	'live.devices.class': 'Classe',
	'live.devices.connector': 'Connecteur',
	'live.devices.ready': 'Disponibilité',
	'live.devices.capabilities': 'Capacités',
	'live.devices.energy': 'kWh total',
	'live.devices.connected': 'connecté',
	'live.devices.hasData': 'données reçues',
	'live.workers.title': 'Processus ({n})',
	'live.workers.name': 'Nom',
	'live.workers.axis': 'Axe',
	'live.workers.state': 'État',
	'live.workers.restarts': 'Redémarrages',
	'live.workers.runs': 'Exécutions',
	'live.workers.lastRun': 'Dernière exécution (temps réel)',
	'live.workers.state.running': 'en marche',
	'live.workers.state.finished': 'terminé',
	'live.workers.state.down': 'arrêté',
	'live.workers.state.lost': 'perdu',
	'live.workers.state.unknown': 'inconnu :',
	'live.workers.crashes': { one: '— {n} plantage', other: '— {n} plantages' },
	'live.paused': 'L’interrogation est en pause car cet onglet est en arrière-plan. Elle reprend, avec un relevé frais, dès votre retour — continuer raréfierait discrètement les échantillons en faisant comme si de rien n’était.',
	'live.cannot.title': 'Ce qu’elle ne peut pas montrer',
	'live.cannot.decisionsLead': 'Aucune décision d’algorithme.',
	'live.cannot.decisions':
		'Cet EMS n’expose pas d’historique de décisions ; celles-ci n’existent que dans {file}. Chargez ce fichier dans l’espace de travail pour les voir.',
	'live.can.decisions':
		'Cet EMS sert {endpoint} : les décisions arrivent donc sur un jeu de données en direct, à côté des relevés, à partir du moment où vous vous êtes connecté.',
	'live.cannot.seenLead': 'Aucune date de « dernier contact » par appareil.',
	'live.cannot.seen':
		'L’API indique si un appareil a des données, jamais quand il a émis pour la dernière fois. Un appareil arrêté ressemble exactement à un appareil dont la valeur ne change pas.',

	'dropzone.add': '+ Ajouter un fichier',
	'dropzone.title': 'Déposez ici les fichiers de l’EMS',
	'dropzone.hint':
		'{readings}, {decisions}, un {replay} ou la {config} de l’exécution — ou cliquez pour parcourir. Chaque format est reconnu à son contenu, pas à son nom.',

	'dataset.rename': 'Renommer ce jeu de données',
	'dataset.remove': 'Supprimer',
	'dataset.naiveBadge': 'fuseau naïf',
	'dataset.naiveTitle': {
		one: '{n} horodatage ne porte pas de décalage UTC et a été lu comme l’heure locale de cette machine. L’EMS écrit des horodatages naïfs pour les exécutions en direct : le vrai fuseau est celui de la machine qui a écrit le fichier.',
		other:
			'{n} horodatages ne portent pas de décalage UTC et ont été lus comme l’heure locale de cette machine. L’EMS écrit des horodatages naïfs pour les exécutions en direct : le vrai fuseau est celui de la machine qui a écrit le fichier.',
	},
	'dataset.openReport': 'Ouvrir le rapport de chargement ci-dessous',
	'dataset.status.queued': 'en attente',
	'dataset.status.ok': 'ok',
	'dataset.status.failed': 'échec',
	'dataset.status.live': 'direct · {state}',
	'dataset.status.retrying': 'nouvel essai ({n})',
	'dataset.status.events': {
		one: '{count} événement',
		other: '{count} événements',
	},
	'dataset.summary.datasets': {
		one: 'jeu de données',
		other: 'jeux de données',
	},
	'dataset.summary.readings': {
		one: 'relevé',
		other: 'relevés',
	},
	'dataset.summary.decisions': {
		one: 'décision',
		other: 'décisions',
	},
	'dataset.summary.inputs': { one: '{n} entrée', other: '{n} entrées' },
	'dataset.summary.span': 'durée',
	'dataset.inputBadge': 'entrée de rejeu',
	'dataset.inputTitle':
		'Ce sont les charges utiles publiées par le connecteur pseudo, pas ce que l’EMS a stocké. Chargez le device_data.csv de la même exécution à côté : une entrée sans relevé au même instant est une charge utile que l’appareil a rejetée.',
	'dataset.report.summary': {
		one: '{tag} : {n} remarque au chargement',
		other: '{tag} : {n} remarques au chargement',
	},
	'dataset.report.more': {
		one: '… et {n} de plus',
		other: '… et {n} de plus',
	},
	'dataset.report.row': 'ligne {n}',

	'charts.title': 'Graphiques',
	'charts.add': '+ Ajouter un graphique',
	'charts.alignT0': 'Aligner les jeux de données sur t₀',
	'charts.zoomHint':
		'Faites glisser sur un graphique pour zoomer — tous les graphiques et la chronologie suivent.',
	'charts.resetZoom': 'Réinitialiser le zoom',
	'charts.follow': 'Suit le bord en direct',
	'charts.followPaused': 'Suivi (en pause — vous avez zoomé)',
	'charts.followWindow': 'Fenêtre à suivre',
	// Des échantillons, pas des minutes : une durée n'a pas de sens quand l'horloge de l'EMS
	// est un rejeu des milliers de fois plus rapide que le temps réel. Voir AppState.follow.
	'charts.followSamples': {
		one: 'dernier point',
		other: '{n} derniers points',
	},
	'charts.empty': 'Aucun graphique. Ajoutez-en un pour tracer un champ.',
	'chart.remove': 'Supprimer ce graphique',
	'chart.pickFields': 'Choisissez un ou plusieurs champs à tracer.',
	'chart.noFields': 'Aucun champ numérique trouvé.',
	'chart.fields': 'Champs ({n})',
	'chart.rootValue': '(valeur)',
	'chart.zoomed': ' · zoomé',
	// Nom accessible du graphique : un canvas n'expose rien de lui-même.
	'chart.plotLabel': 'Graphique en courbes, {n} séries : {series}. Axe horizontal de {from} à {to}.',
	'chart.pointsDrawn': {
		one: '{n} point tracé sur {samples} échantillons visibles',
		other: '{n} points tracés sur {samples} échantillons visibles',
	},

	'timeline.title': 'Chronologie',
	'timeline.search': 'Rechercher dans les charges utiles…',
	'timeline.clearZoom': 'Effacer le zoom',
	'timeline.shown': {
		one: '{n} affiché',
		other: '{n} affichés',
	},
	'timeline.emptyNoData': 'Chargez un CSV pour commencer.',
	'timeline.emptyFiltered': 'Rien ne correspond aux filtres actuels.',
	'timeline.facet.dataset': 'Jeu de données',
	'timeline.facet.kind': 'Type',
	'timeline.facet.actor': 'Source',
	'timeline.facet.title': '{label} — une valeur, ou toutes',
	'timeline.facet.allDatasets': 'Tous les jeux de données',
	'timeline.facet.allKinds': 'Tous les types',
	'timeline.facet.allActors': 'Toutes les sources',
	'kind.reading': 'relevé',
	'kind.decision': 'décision',
	'kind.worker': 'processus',
	'kind.health': 'état',
	'kind.input': 'entrée de rejeu',
	'timeline.actorOption': '{actor} ({kind})',

	'unit.days': 'j',
	'unit.hours': 'h',
	'unit.minutes': 'min',
	'unit.seconds': 's',

	'toast.configLoaded': {
		one: '{name} : {n} entrée configurée',
		other: '{name} : {n} entrées configurées',
	},
	'toast.loadFailed': 'Chargement impossible : {message}',
	'toast.liveFailed': 'Connexion en direct perdue : {message}',

	'dataset.sampledBadge': 'échantillonné',
	'dataset.sampledTitle':
		'L’EMS n’a pas enregistré cette série à ce rythme — la visionneuse a interrogé un point d’accès instantané et conservé un échantillon à chaque changement de charge utile.',
	'dataset.dropped': { one: '{count} supprimé', other: '{count} supprimés' },
	'dataset.droppedTitle':
		'Des événements anciens ont été supprimés pour limiter la mémoire. Augmentez la fenêtre de rétention pour en conserver davantage.',
	'live.connect.open': 'Se connecter à l’EMS en direct',
	'live.connect.interval': 'Échantillonner toutes les',
	'live.connect.seconds': '{n} s',
	'live.connect.start': 'Connecter',
	'live.connect.cancel': 'Annuler',
	'live.connect.sampled':
		'C’est la visionneuse qui échantillonne. /devices est un point d’accès instantané : un point n’apparaît que lorsque la charge utile change réellement — une portion plate signifie que rien n’a changé, pas que rien n’a été mesuré.',
	'live.connect.cost':
		'Chaque interrogation coûte à l’EMS une copie complète de tous ses appareils. Une cadence plus lente est préférable, et lors d’un rejeu l’horloge avance de toute façon.',
	'live.connect.decisions':
		'Les décisions n’apparaîtront pas. L’API ne conserve aucun historique de décisions — chargez {file} en parallèle pour les voir.',

	'login.lead': 'Cet EMS exige une authentification.',
	'login.user': 'Utilisateur',
	'login.password': 'Mot de passe',
	'login.submit': 'Se connecter',
	'login.checking': 'Vérification…',
	'login.dismiss': 'Plus tard',
	'login.rejected': 'Ce nom d’utilisateur et ce mot de passe ont été refusés.',
	'login.unreachable': 'L’EMS n’a pas répondu. Il est peut-être arrêté, plutôt qu’en train de vous refuser.',
	'login.expired': 'L’EMS n’accepte plus les identifiants utilisés pour se connecter.',
	'login.scope':
		'Seules les données en direct sont concernées. Les fichiers que vous ouvrez restent locaux dans tous les cas.',
	'auth.locked': 'EMS en direct — verrouillé',
	'auth.signedIn': 'connecté en tant que {user}',
	'auth.signIn': 'Se connecter',
	'auth.signOut': 'Se déconnecter',

	'warning.emptyTimestamp': 'horodatage vide',
	'warning.unparseableTimestamp': 'horodatage illisible',
	'warning.badJson': 'la charge utile n’est pas du JSON valide',
	'warning.emptyColumn': '{column} vide',
	'warning.controlLog':
		'Ceci ressemble à un journal de contrôle du connecteur pseudo. C’est un journal de débogage, pas du CSV — pas d’en-tête, pas de guillemets, et chaque commande JSON contient des virgules. Chargez plutôt algorithm_decisions.csv.',
	'warning.unknownColumns':
		'Colonnes non reconnues : {columns}. Attendu : device_data.csv ou algorithm_decisions.csv de l’EMS.',
	'warning.papaparse': '{message}',
	'warning.naiveTimestamps': {
		one: '{n} ligne ne porte pas de décalage UTC et a été lue comme heure locale. L’EMS écrit des horodatages naïfs pour les exécutions en direct : le fuseau est celui de la machine qui a écrit le fichier, pas forcément celle-ci.',
		other:
			'{n} lignes ne portent pas de décalage UTC et ont été lues comme heure locale. L’EMS écrit des horodatages naïfs pour les exécutions en direct : le fuseau est celui de la machine qui a écrit le fichier, pas forcément celle-ci.',
	},
	'warning.nonMonotonic': {
		one: '{n} ligne recule dans le temps. C’est normal — plusieurs fils de connecteurs écrivent sous un même verrou, l’ordre du fichier est l’ordre d’écriture — et les événements sont triés au chargement.',
		other:
			'{n} lignes reculent dans le temps. C’est normal — plusieurs fils de connecteurs écrivent sous un même verrou, l’ordre du fichier est l’ordre d’écriture — et les événements sont triés au chargement.',
	},
	'warning.strayEra': {
		one: '{n} ligne se situe à plus de 30 jours du reste des données. Un rejeu écrit des lignes en temps réel avant son premier pas et après la réinitialisation de l’horloge : un fichier de backtest peut donc chevaucher deux époques. Rien n’a été supprimé.',
		other:
			'{n} lignes se situent à plus de 30 jours du reste des données. Un rejeu écrit des lignes en temps réel avant son premier pas et après la réinitialisation de l’horloge : un fichier de backtest peut donc chevaucher deux époques. Rien n’a été supprimé.',
	},
	'warning.httpError': 'L’EMS a répondu {status} pour {endpoint}.',
	'warning.duplicateSnapshot':
		'Rien n’a changé dans l’EMS depuis {seconds} s à une cadence de {interval} s. Soit le site est réellement au repos, soit l’EMS est bloqué. La visionneuse ne perd pas de données.',
	'warning.seriesCap':
		'Ce jeu de données a atteint sa limite de {n} champs distincts. Les champs découverts ensuite sont ignorés ; ceux déjà chargés continuent de recevoir des échantillons. Un site réel reste très en dessous de cette limite, qui existe pour le cas d’une source renommant ses clés à chaque interrogation.',
	'warning.jsonReplay':
		'Ceci ressemble à un fichier de rejeu JSON. La visionneuse lit la forme CSV d’un rejeu ; exportez-le ou convertissez-le en CSV pour le charger ici.',
	'warning.configInvalidJson': 'Ce fichier n’est pas du JSON valide : {message}',
	'warning.configUnknownShape':
		'Ce JSON est valide mais n’est pas une configuration EMS — aucun connecteur, appareil, algorithme, stockage ni service n’a été trouvé.',
	'warning.configTooLarge':
		'Cette configuration est trop volumineuse pour être lue. Un config.json fait quelques kilo-octets ; quelque chose de bien plus gros est presque certainement un autre fichier.',
	'warning.configDuplicateName':
		'Deux entrées de {section} portent le nom « {name} ». La première est utilisée, comme le fait l’EMS.',
	'warning.configDanglingRef':
		'« {name} » fait référence à « {missing} », que cette configuration ne déclare pas.',
	'warning.configVersionDrift':
		'Cette configuration déclare la version {declared}, alors que cette visionneuse lit les configurations de version {supported}.x. La version seule n’a rien fait refuser ni masquer : une version majeure est le seul avertissement qu’une configuration donne qu’un champ lu par la visionneuse a pu changer de place, donc un type vide ou un connecteur non résolu ci-dessous peut relever de la version plutôt que de la configuration.',
	'warning.configTruncated':
		'Seules les {n} premières entrées ont été lues. Une configuration de cette taille dépasse ce que cette visionneuse est faite pour décrire.',
	'warning.decisionsReset':
		'L’EMS a redémarré : sa séquence de décisions a donc recommencé. Les décisions antérieures au redémarrage ne sont pas récupérables via l’API ; elles sont dans algorithm_decisions.csv.',
	'warning.decisionsGap': {
		one: '{n} décision a été écartée par l’EMS avant que la visionneuse ne puisse la lire. Son tampon d’historique est borné, et l’interrogation a pris du retard.',
		other:
			'{n} décisions ont été écartées par l’EMS avant que la visionneuse ne puisse les lire. Son tampon d’historique est borné, et l’interrogation a pris du retard.',
	},

	// --- topologie configurée -------------------------------------------------------------
	'topology.title': 'Topologie configurée',
	'topology.summary': { one: '{name} — {n} entrée', other: '{name} — {n} entrées' },
	'topology.remove': 'Retirer cette configuration',
	'topology.rejected': 'Cette configuration n’a pas pu être lue.',
	'topology.version': 'version {version}',
	'topology.env': 'env {env}',
	'topology.noData':
		'Aucun CSV n’est encore chargé : rien ci-dessous n’a été confronté à des données réelles. Voici ce que la configuration déclare.',
	'topology.privacy':
		'Seuls les noms, types, classes, connecteurs et protocoles sont lus dans ce fichier. Les hôtes de courtier, identifiants, mots de passe, sujets, ports, tables de registres et chemins de fichiers ne sont jamais lus ni affichés.',
	'topology.silentLead': 'Configuré, mais n’a rien produit.',
	'topology.silentBody':
		'Les CSV ne distinguent pas un appareil muet d’un appareil jamais configuré — aucune ligne n’est écrite dans les deux cas. C’est à cela que sert ce fichier.',
	'topology.undeclared': {
		one: '{n} nom apparaît dans les données mais pas dans cette configuration.',
		other: '{n} noms apparaissent dans les données mais pas dans cette configuration.',
	},
	'topology.filterConnector': 'Filtrer la chronologie sur les appareils de ce connecteur',
	'topology.role.device': 'appareil',
	'topology.role.algorithm': 'algorithme',
	'topology.role.connector': 'connecteur',
	'topology.role.storage': 'stockage',
	'topology.role.service': 'service',
	'topology.column.name': 'nom',
	'topology.column.role': 'rôle',
	'topology.column.type': 'type / classe',
	'topology.column.connector': 'connecteur',
	'topology.column.protocol': 'protocole',
	'topology.column.status': 'dans les données',
	'topology.column.cadence': 'cadence',
	'topology.status.matched': 'présent',
	'topology.status.silent': 'muet',
	'topology.status.na': '—',
	'topology.cadence.configured': 'toutes les {seconds} s configurées',
	'topology.cadence.observed': '{seconds} s observées',
} satisfies Catalogue;
