# Module QuickLook

QuickLook est une extension native facultative du **Market**. Elle fournit les aperçus dans l’Explorateur, sur le Bureau, dans les boîtes de fichiers compatibles, ainsi que dans Spotlight et l’étagère ; elle n’occupe aucun emplacement du panneau Nook. Le protocole d’aperçu appartient au noyau Notchy. Le moteur officiel QuickLook reste un processus distinct, téléchargé uniquement à la demande.

## Parcours

1. Ouvrir **Market → QuickLook**. Quand le moteur est absent, l’action d’aperçu d’un format externe mène à cette fiche. HTML utilise le lecteur intégré décrit ci-dessous ; les documents Office utilisent QuickLook avec l’extension officielle OfficeViewer.
2. Cliquer **Obtenir**, ou **Compléter Office** pour un ancien module QuickLook déjà présent. La fiche affiche le téléchargement, la vérification et l’installation, avec des états distincts pour le moteur et OfficeViewer. Une erreur permet de réessayer.
3. Revenir aux fichiers, sélectionner un élément puis appuyer sur **Espace**. Les flèches changent de fichier ; **Échap** ferme l’aperçu. **Entrée** et le double-clic gardent leur action d’ouverture normale.
4. Utiliser **Retirer** dans la fiche pour supprimer seulement le moteur géré par Notchy. Une installation QuickLook externe et les fichiers personnels restent indépendants du module.

La première installation nécessite Internet : environ **156 Mo** pour le moteur officiel, OfficeViewer et leurs sources. Le moteur décompressé occupe environ **280 Mo** et OfficeViewer **45 Mo**, auxquels s’ajoutent les sources et données locales. Compléter un moteur déjà installé télécharge seulement OfficeViewer et ses sources, soit environ **15,4 Mo**. Les aperçus installés ne nécessitent pas de nouveau téléchargement. Les aperçus vidéo peuvent aussi dépendre du pilote graphique et du runtime VC++ de Windows.

## Aperçus Office avec OfficeViewer

L’extension officielle **OfficeViewer 6** affiche Word, Excel et PowerPoint avec les composants de rendu **Syncfusion**, sans Microsoft Office et sans utiliser les gestionnaires COM de WPS. Elle reproduit la mise en page, les images et les graphiques pris en charge par ce moteur. Word utilise un lecteur de document, Excel conserve ses feuilles et graphiques, et PowerPoint produit un PDF statique en mémoire. Ce rendu dépend du format et des polices disponibles ; les animations de diapositives ne sont pas jouées. Les fichiers portant l’attribut Windows « lecture seule » sont une limite de cette version officielle.

Les extensions prises en charge par OfficeViewer 6 sont `.doc`, `.docm`, `.docx`, `.rtf`, `.xls`, `.xlsx`, `.xlsm`, `.pptx`, `.pptm`, `.potx` et `.potm`. L’ancien `.ppt` reste dépendant d’un autre gestionnaire QuickLook disponible. Les documents Office ne sont plus transformés en listes de paragraphes ou tableaux simplifiés par Notchy.

### Rendu Office isolé et cache local

La passerelle `QuickLook.Plugin.NotchyOfficeIsolation` délègue le document au plugin officiel OfficeViewer **inchangé**, exécuté dans un processus WPF distinct. Le noyau Rust supervise ce processus par un Job Object Windows : un seul chargement lourd actif, 1 Gio de mémoire maximum et 30 secondes pour obtenir le premier contenu rendu. Échap, le changement de fichier et la fermeture du lecteur annulent le traitement sans attendre le moteur de tableur. Une erreur ou une limite atteinte affiche un message permettant de choisir l’ouverture dans WPS ; le fichier n’est jamais ouvert automatiquement.

Le moteur reçoit une copie temporaire modifiable, sans accès en écriture au document original. Le nom et les informations de provenance Windows sont conservés. Le chargement du classeur par OfficeViewer reste complet : afficher une partie de la grille ne signifie pas que le fichier est lu en streaming.

Le cache conserve une **image fidèle de la première zone affichée**, publiée seulement après le chargement réel et la disposition du contenu. À la réouverture, cette image apparaît pendant la préparation de la navigation interactive. Ce mécanisme accélère le premier affichage ; il ne promet pas qu’un classeur entier soit instantanément interactif. La clé combine chemin canonique, identité du fichier, taille, date de modification, version du moteur et dimensions. Un changement invalide l’ancienne image. Aucun hash intégral du document n’est imposé avant l’affichage.

Le cache privé se trouve dans `.desktop-profile/office-preview/cache`, avec un maximum de 64 images, 128 Mio au total et une conservation de 14 jours. Les copies de travail sont supprimées après l’arrêt du worker. Le protocole local utilise un canal nommé aléatoire, un secret propre à la session et des requêtes typées ; aucune page HTML aperçue n’y a accès. La passerelle et le worker sont sous GPL, leurs sources et leur recette se trouvent dans `native/office-preview/` et dans le paquet généré `native/bin/NotchyOfficePreview.zip`. Les DLL QuickLook et Syncfusion restent externes.

QuickLook assure aussi la touche **Espace** dans l’Explorateur Windows et sur le Bureau lorsqu’il fonctionne en arrière-plan. Les raccourcis natifs restent ceux de QuickLook ; Notchy emploie le même moteur pour ses propres fichiers.

## Aperçus HTML intégrés

Dans la version native, **Espace** affiche les fichiers `.html` et `.htm` dans le panneau Notchy. Les boutons précédent/suivant changent de fichier ; **Échap** ferme l’aperçu et conserve la sélection.

Dans l’Explorateur, les aperçus web du moteur QuickLook géré utilisent son lecteur HTML original, avec un adaptateur de taille Notchy. La taille de départ vise 800 × 520 unités Windows, réduites selon la zone utile et le DPI de l’écran. Le lecteur ne démarre pas maximisé ; le bouton d’agrandissement et le redimensionnement manuel restent disponibles ensuite. Le réglage initial n’est appliqué qu’à l’ouverture ou au changement de document, sans boucle qui impose de nouveau une taille pendant la lecture. Si l’utilisateur a choisi le plein écran avec F11, ce mode reste géré par QuickLook jusqu’à sa désactivation manuelle. Les aperçus HTML internes restent contenus dans l’encoche.

HTML conserve ses styles et scripts intégrés, dans une iframe `sandbox="allow-scripts"` sans `allow-same-origin`. Les pages autonomes peuvent inclure des cadres imbriqués créés en mémoire (`blob:null/…`) ; ils héritent du même bac à sable et des mêmes restrictions réseau. Pour les maquettes autonomes exportées, la navigation temporaire des cadres locaux est terminée avant de charger leur contenu embarqué. Ses ressources réseau et fichiers relatifs sont bloqués : ce lecteur convient aux pages autonomes, pas aux projets web à plusieurs fichiers. Le document n’a pas accès au DOM parent, au stockage Notchy ni à son pont natif. Des objets internes Tauri peuvent être présents dans le cadre, mais leur transport HTTP est bloqué et le transport natif du runtime est réservé au document principal. Seuls les messages fixes de disponibilité du document et de fermeture Échap sont acceptés depuis le cadre courant ; aucun message ne relaie d’invocation native. Dans un cadre imbriqué qui capture le clavier, le bouton de fermeture de la barre d’aperçu reste disponible.

Les scripts intégrés ou créés en mémoire peuvent s’exécuter dans ce bac à sable, y compris les compilateurs de modèles JavaScript des maquettes autonomes. Cette permission concerne exclusivement le document aperçu ; elle ne change pas la politique de scripts de Notchy. Les polices web externes restent bloquées et peuvent être remplacées par une police locale.

Le lecteur HTML accepte les documents UTF-8 de 2 Mio au maximum. Un document invalide ou trop volumineux affiche une erreur, sans ouvrir automatiquement le fichier dans une autre application.

Le serveur conserve un seul document éphémère en mémoire, derrière un identifiant aléatoire. Changer de fichier ou fermer l’aperçu révoque l’ancien identifiant. Les règles de scripts de la fenêtre principale restent inchangées. Une protection WebView2 supplémentaire interdit au cadre de naviguer vers une autre route ou un autre site ; si elle ne peut être installée, ces aperçus restent désactivés.

L’interface native utilise la route dédiée `/notchy-ui?desktop=1`. Sa capacité Tauri correspond uniquement à `/notchy-ui`, y compris lorsque l’IPC retire les paramètres de l’adresse. Elle exclut `/rendered-preview/…`, `/api/…` et les autres pages. La racine `/` n’est pas utilisée dans cette règle : le parseur Tauri l’élargirait à tous les chemins.

La page principale conserve `connect-src 'self'`. Le transport natif de messages fourni par Tauri conserve le chemin du document appelant pour cette vérification ; son transport HTTP `ipc` basé seulement sur l’en-tête Origin n’est pas autorisé par cette politique.

## Installation gérée

Le noyau accepte uniquement les opérations fixes `status`, `install`, `remove` et `source`, depuis l’interface native autorisée. La dernière ouvre la page officielle des sources exactes. Il ne prend ni URL de téléchargement ni chemin d’exécutable fourni par un manifeste communautaire. Les modules communautaires JSON restent sans accès au réseau ou à l’exécution de programmes.

Le téléchargement utilise QuickLook **4.5.0** et OfficeViewer **6**, avec tailles et SHA-256 épinglés. Les archives sont vérifiées avant extraction dans un dossier temporaire privé, puis publiées. Une extraction refuse les chemins sortants, les liens et les entrées anormales. OfficeViewer est téléchargé directement depuis sa release officielle, sans modifier ses DLL et sans les inclure dans le dépôt ou l’installateur Notchy. Le moteur portable conserve ses plugins et `portable.lock`, et stocke ses propres données dans son dossier `UserData`. Son extension est installée dans `UserData/QuickLook.Plugin/QuickLook.Plugin.OfficeViewer`, comme le prévoit QuickLook. Notchy le démarre silencieusement avec `/autorun`, sans créer un deuxième démarrage automatique Windows. La recherche automatique de mises à jour du moteur géré est désactivée pour conserver la version vérifiée.

### Compatibilité du lecteur PDF

Le lecteur PDF de QuickLook 4.5.0 peut tenter de créer une image de taille nulle lorsqu’un aperçu PowerPoint différé se termine après un changement de fichier : [ticket officiel #1892](https://github.com/QL-Win/QuickLook/issues/1892). Notchy fournit un correctif ciblé du composant **GPL** `QuickLook.Plugin.PDFViewer.dll` : le rendu attend une taille d’affichage valide et ignore un contrôle déjà libéré. OfficeViewer et les bibliothèques Syncfusion restent inchangés.

Le paquet généré `native/bin/QuickLookPdfCompatibility.zip` accompagne les ressources natives de Notchy. Il est construit à partir des sources QuickLook épinglées avec le script et le patch conservés dans `native/quicklook-compat/` ; les outils C# et WPF sont requis uniquement chez le développeur ou en CI. Les binaires générés restent exclus de Git. Le build et le paquet doivent rester déterministes, car le module vérifie leurs empreintes exactes avant usage.

L’installation conserve le lecteur PDF original vérifié dans `.notchy-module/pdf-compat/original.dll`, avec le patch, la recette de compilation, la GPL, le manifeste de build et son propre marqueur. Le fichier actif est remplacé uniquement s’il correspond au lecteur officiel épinglé ou au correctif déjà géré. Un autre lecteur PDF provoque une erreur et reste intact. Un échec de publication restaure le lecteur précédent. Les sources QuickLook d’origine restent disponibles dans `.notchy-module/source.zip`.

L’état `officeInstalled` exige à la fois les fichiers OfficeViewer et ce correctif PDF vérifié. Une ancienne installation gérée peut donc afficher **Compléter Office** même si OfficeViewer 6 est déjà présent. Une ressource de compatibilité absente ou invalide reste une erreur explicite ; elle ne devient jamais un état Office prêt.

Un ancien module possédant les métadonnées Notchy peut recevoir seulement l’extension manquante. Une extension OfficeViewer indépendante déjà présente à cet emplacement provoque une erreur de conflit, sans écrasement. Une extension gérée incomplète peut être réparée ; le moteur et ses réglages sont conservés. Le chargement d’une nouvelle extension nécessite un redémarrage du processus QuickLook qui l’utilisera.

Une instance QuickLook externe déjà active reste compatible avec son protocole Windows. L’état `officeInstalled` du module décrit uniquement son extension gérée : il ne confirme pas qu’une autre instance QuickLook déjà ouverte a chargé OfficeViewer. Pour utiliser cette installation externe, télécharger [OfficeViewer 6 officiel](https://github.com/QL-Win/QuickLook.Plugin.OfficeViewer/releases/tag/6), sélectionner son fichier `.qlplugin`, appuyer sur **Espace**, cliquer **Install**, puis redémarrer QuickLook. Le retrait du module ne désinstalle jamais cette application externe. Quitter normalement Notchy arrête seulement son moteur géré, identifié par son chemin exact. Un fichier verrouillé ou un échec de retrait reste visible comme erreur. Une installation gérée incomplète reste retirable avant de réessayer le téléchargement.

## Crédits et sources

QuickLook a été créé par **Paddy Xu (@xupefei)** et est maintenu par **QL-Win et ses contributeurs**. Merci à eux. Le moteur est sous **GNU GPL v3** ; ses plugins et bibliothèques gardent leurs licences respectives. Notchy ne revendique pas leur création.

- [Distribution officielle QuickLook 4.5.0](https://github.com/QL-Win/QuickLook/releases/tag/4.5.0).
- [Sources exactes du moteur, commit b13df028](https://github.com/QL-Win/QuickLook/tree/b13df028f3cce1f84792f7043b57bf5cea3a3e4c).
- [Licence GPL complète](https://github.com/QL-Win/QuickLook/blob/4.5.0/LICENSE-GPL.txt).
- [LAV/FFmpeg utilisé par les aperçus vidéo](https://github.com/QL-Win/QuickLook.LAVFilters).
- [OfficeViewer 6 officiel](https://github.com/QL-Win/QuickLook.Plugin.OfficeViewer/releases/tag/6), sources exactes au commit [fa994a68](https://github.com/QL-Win/QuickLook.Plugin.OfficeViewer/tree/fa994a6800b3f73b0a327ff1d6de4fed04ca5b71).

Le module conserve une copie de la GPL et de l’archive source correspondante à côté du moteur. Les sources d’OfficeViewer sont sous MIT ; ses composants Syncfusion gardent leur licence propriétaire distincte. Leur utilisation pour développer ou redistribuer une intégration nécessite les droits décrits dans le README officiel. Notchy facilite l’installation du plugin binaire officiel inchangé chez l’utilisateur et ne réutilise pas ses bibliothèques dans son code. Le plugin conserve son README, sa licence source et son archive source exacte dans son sous-dossier `.notchy-module`. Les sources Notchy ne remplacent pas celles de QuickLook. Aucune archive QuickLook, DLL Syncfusion ni donnée de profil personnelle ne doit être ajoutée à l’historique Git de Notchy.
