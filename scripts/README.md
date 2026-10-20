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
