# Frontend build

Run `npm run build` with Node.js 22 or later. The app keeps its readable module
sources, while `dist/index.html` loads only the generated `app.bundle.js`.
`app.js` is the central startup entry and runs after its dependencies.

`frontend-manifest.json` is the single list of source order and packaged UI
assets. The builder preserves classic browser script and UMD semantics, checks
syntax and paths, and replaces only `dist/`, removing stale generated assets.
It uses Node's standard library and needs no package download. CSS, fonts and
icons are copied unchanged; no design or module behavior is transformed.

Cargo calls this same builder before embedding the frontend and watches every
manifest input. Node.js must be on `PATH`, or `NOTCHY_NODE` can name its executable.
Do not edit or commit `dist/`; rebuild it after changing a source file.

## Native trial on Windows

Run `Lancer-Notchy-Essai.cmd -BuildHost` once with Node, Rust and the Windows C++
build tools available. This builds a debug Tauri host, copies its declared native
helpers and opens the real desktop app. It does not create or install an NSIS
package. `-TargetDirectory <path>` can reuse an existing Cargo build cache.
Use `-BuildHost -Offline` when the Rust dependencies are already cached.

After that, double-click `Lancer-Notchy-Essai.cmd`: it rebuilds only the frontend
and opens or reloads the same native host, without recompiling Rust. Debug serves
the current `dist/` files with the packaged asset allowlist, MIME restrictions,
link checks and `no-store`; release builds continue using embedded assets.
Adding a new packaged filename or changing Rust requires `-BuildHost` again.

The trial has a separate process identifier, an ephemeral loopback port and an
isolated profile in `.development/profile/`. The interactive trial registers the
normal Spotlight shortcut; explicit `--data-root` checks do not. It does not
register Windows startup, modify the installed version, or copy its credentials.
LocalSend still uses its normal LAN port, so an already running installed instance
may occupy that port; the trial displays the service's real availability.

## Stockage et mémoire

`npm run storage:check` (ou `Verifier-Stockage.cmd`) mesure les caches générés et
écrit un seul rapport fixe dans `.development/storage-report.json`. Il ne supprime
rien. `npm run storage:guard` renvoie un échec si les caches Cargo dépassent 8 Go,
les navigateurs d'essai 2 Go, ou si le disque a moins de 12 Go libres. Le lancement
avec `-BuildHost` effectue ce contrôle avant Cargo et un bilan après. Ne pas
contourner un dépassement : présenter les chemins à nettoyer et demander un nouvel
accord humain. Les octets logiques mesurés ne sont pas un gain physique garanti.

Le profil Cargo de développement désactive les gros symboles de debug et le cache
incrémental. Les prochains builds seront moins volumineux et plus lents. La version
d'essai déjà compilée n'est pas reconstruite par cette configuration.

Conserver un essai actif, un retour arrière jusqu'à validation et le dernier
installateur. Limiter les environnements de test à deux par fonctionnalité,
réutiliser leurs emplacements, et conserver les rapports utiles sans multiplier
les moteurs et profils complets. Le coffre `../Notchy — Mémoire` et les règles
`../AGENTS.md` documentent les décisions et la validation demandée après livraison.

Avant de remplacer `dist/`, le builder conserve une seule fois l'essai existant
dans `.development/previous-trial/` (binaire vérifié, ressources, licences et
frontend). Le profil utilisateur n'est pas copié. Cette copie fixe n'est jamais
rotée ni supprimée automatiquement ; une copie inachevée ou invalide doit être
examinée avant de continuer. Il s'agit d'une sauvegarde, pas d'une restauration
automatique : demander validation puis accord avant de la remplacer ou de
restaurer les fichiers. Le code courant et la version installée restent distincts.
