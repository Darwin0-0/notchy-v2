# Notchy V2

Une encoche pour Windows, avec un moteur Rust et une interface Tauri. Surface noire, transitions discrètes et modules ajustés à leur contenu.

## Fonctions de base

- **Musique** : pochette, commandes disponibles du lecteur Windows, progression et spectre audio réel. La couleur du spectre vient de la pochette, avec du blanc en son absence.
- **Pomodoro** : sessions, pauses et cycles, avec affichage du temps et signal bref aux changements de phase.
- **Météo** : conditions racontées en quelques lignes, choix de la ville et actualisation.
- **Étagère** : dépôt, sélection, aperçu et réutilisation des fichiers. OCR et conversion sont des actions de fichiers, pas des modules supplémentaires.
- **LocalSend** : envoi et réception sur le réseau local, demande d'acceptation, progression et retour de fin de transfert dans l'encoche.

Le dock ouvert par clic droit propose seulement Musique, Pomodoro, Météo et Étagère. LocalSend se trouve dans Tray. Les modules restent retirables et leurs anciens emplacements compatibles sont conservés. L'interface charge **trois scripts et une feuille CSS**, sans framework frontend ni serveur Node.js dans l'application.

L'encoche possède les états **discret, survol et ouvert**. Une sortie du pointeur la replie ; le clavier et les dialogues conservent leurs protections. Liquid Glass et la capture du fond d'écran ont été retirés.

## Compiler sous Windows

Prérequis : Windows 10/11 x64, WebView2, .NET Framework 4.x, Rust MSVC x64, et les outils C++ de Visual Studio avec un Windows SDK. Node.js est nécessaire uniquement aux tests JavaScript.

Depuis un PowerShell 64 bits dans ce dépôt :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Build-Notchy.ps1 -Release
```

Le script compile les composants Windows depuis `native/`, puis Rust avec `Cargo.lock`. Le résultat portable est dans `build/release/`. Pour un build de développement, omettre `-Release` ; le résultat est dans `build/debug/`.

Après compilation, `Notchy V2.cmd` ouvre la version disponible et active LocalSend. Ce lancement conserve les données dans le dossier du dépôt. Un exécutable lancé sans `--data-root` utilise le dossier d'application Windows.

L'application n'est pas signée et ce dépôt ne fournit pas encore d'installateur. WebView2 est un runtime Windows partagé, distinct des fichiers de Notchy.

## Spotify facultatif

Les commandes Windows et le spectre fonctionnent sans identifiant API personnel. La file **À suivre** et ses commandes Spotify nécessitent la configuration de ta propre application Spotify.

Utilise la redirection `http://127.0.0.1:43821/callback`. Avant de lancer Notchy, configure `NOTCHY_SPOTIFY_CLIENT_ID` avec ton identifiant d'application. Le fichier `.env.example` est un modèle ; l'application ne charge pas automatiquement un fichier `.env`.

Autre possibilité : créer `.desktop-profile/spotify-client.json` dans le dossier de données avec une propriété `clientId`. Ne versionne jamais ce fichier. Aucun secret client n'est demandé ; l'autorisation utilise PKCE et les sessions locales utilisent la protection Windows.

La météo utilise Open-Meteo sans clé personnelle. L'accès à la position actuelle dépend des autorisations Windows ; une ville peut être choisie manuellement.

## Données et confidentialité

Ce dépôt est une copie source propre, sans historique de développement privé. Il exclut les profils, tokens, identité et certificats LocalSend, fichiers de l'Étagère, ville enregistrée, captures de diagnostic et outils locaux.

Les données de fonctionnement sont locales : `.desktop-profile/`, `.tauri-webview/`, `.localsend/`, `.shelf/` et `weather.json`. Ces chemins sont ignorés par Git. Chaque installation génère sa propre identité LocalSend ; aucun certificat ou token de session n'est livré dans les sources.

Les collecteurs d'appels, de notifications et d'historique du presse-papiers ne sont pas chargés dans cette version. Copier un résultat vers le presse-papiers Windows reste une action explicite.

LocalSend ne fixe pas de plafond artificiel en octets par fichier ou par transfert. L'espace disque, le nombre de fichiers de l'Étagère et les limites de traitement des aperçus/OCR/conversions restent des contraintes distinctes.

## Vérifications

```powershell
node --test tests/*.test.cjs
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1
```

Les tests couvrent notamment le repli, le spectre réel, la migration des emplacements, les besoins de taille des modules, les phases Pomodoro, les échanges locaux et l'absence de configuration Spotify. Ils ne remplacent pas les contrôles Windows et les transferts réels entre appareils.

## Composants tiers

Voir [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) pour NAudio, les polices et les pictogrammes. Leurs licences sont conservées dans le dépôt et les builds. Ce dépôt public n'ajoute pas de licence générale au code de l'application.
