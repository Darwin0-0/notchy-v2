# Development

Notchy targets Windows with a Rust engine, a Tauri WebView interface and small Windows helpers for media, audio, location and OCR. The running application does not require Node.js. Its frontend uses four scripts (`i18n.js`, `notch.js`, `focus.js`, `welcome.js`) and two stylesheets (`notch.css`, `welcome.css`).

## Build and run on Windows

Prerequisites:

- Windows 10/11 x64, WebView2 and .NET Framework 4.x.
- Rust with the MSVC x64 toolchain.
- Visual Studio C++ build tools with a Windows SDK.
- Node.js for JavaScript tests and optional installer packaging.

Clone the repository and open a **64-bit PowerShell** in its folder:

```powershell
git clone https://github.com/Darwin0-0/notchy-v2.git
cd notchy-v2
powershell -NoProfile -ExecutionPolicy Bypass -File .\Build-Notchy.ps1 -Release
```

[Build-Notchy.ps1](../Build-Notchy.ps1) first compiles the helpers from [native/](../native/) using the Windows .NET Framework compiler, then builds Rust with `Cargo.lock`. The portable application and its helpers are placed in `build/release/`. Omit `-Release` for `build/debug/`.

After building, double-click `Notchy V2.cmd`. It prefers a release build, otherwise uses the debug build, and enables LocalSend. This launcher passes the repository folder as the data root. A release executable without `--data-root` uses the Windows application-data folder; a debug executable defaults to the repository folder.

Close the executable and its helpers before rebuilding the same output folder. The build above creates the portable application. WebView2 is a shared Windows runtime, separate from Notchy’s files.

### Package a Windows installer

After the release build above, package it with the pinned Tauri CLI:

```powershell
npm exec --yes --ignore-scripts --package=@tauri-apps/cli@2.12.3 -- tauri build --bundles nsis --ci -- --locked
```

The NSIS installer is written to `src-tauri/target/release/bundle/nsis/` unless `CARGO_TARGET_DIR` is set. The first packaging run downloads the CLI and the NSIS tools. Build from a clean source checkout; the resource list in `src-tauri/tauri.conf.json` includes only the compiled helpers and required notices and licences. Personal profiles, credentials and Shelf files are not package resources.

This package is unsigned. WebView2 is not embedded in the installer: setup can download its bootstrapper if the runtime is missing, so that download is separate from the reported installer size. A local package does not imply that a GitHub release has been published.

### Use a separate development profile

For development, use a separate data folder and launch the debug build explicitly:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Build-Notchy.ps1
$notchyDevData = [IO.Path]::GetFullPath(".\work\dev-profile")
& ".\build\debug\Notchy V2.exe" --data-root $notchyDevData --localsend
```

This avoids mixing development files and preferences with your normal profile. `work/` is ignored by Git. Only one normal application instance runs at a time; close your existing Notchy instance when testing this build.

## Run the checks

From the repository root:

```powershell
node --test tests/*.test.cjs
$notchyPreviousTauriConfig = $env:TAURI_CONFIG
$notchyPreviousTemp = $env:TEMP
$notchyPreviousTmp = $env:TMP
$notchyTestTemp = (Get-Item -LiteralPath ([IO.Path]::GetTempPath())).FullName
try {
  $env:TAURI_CONFIG = '{"bundle":{"resources":null}}'
  $env:TEMP = $notchyTestTemp
  $env:TMP = $notchyTestTemp
  cargo test --locked --manifest-path src-tauri/Cargo.toml --no-default-features --lib --bins -- --test-threads=1
} finally {
  $env:TAURI_CONFIG = $notchyPreviousTauriConfig
  $env:TEMP = $notchyPreviousTemp
  $env:TMP = $notchyPreviousTmp
}
```

JavaScript tests cover interaction, module sizing, persisted state, Pomodoro phases, media feedback and the Tauri bridge. Rust tests cover local services and their validation. Automated tests complement visual checks on Windows, real audio playback and transfers between devices. Record what you actually ran rather than assuming another contributor’s results apply to your changes.

The Rust checks temporarily set `TAURI_CONFIG` to `{"bundle":{"resources":null}}`, then restore your previous environment value. GitHub Actions uses the same resource override, so these checks do not need the separately compiled Windows media bridges or create an application package. They also cover language preference validation in the application entry point. `Build-Notchy.ps1` builds the bridges and retains the normal bundle resources. A green test job does not replace checking the complete Windows application.

The check command also expands the Windows temporary directory to its full path and restores `TEMP`/`TMP` afterward. GitHub Actions does the same for its runner directory. Windows short aliases such as `RUNNER~1` can otherwise fail private-storage path validation; the storage protections remain enabled during tests.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the file map and review expectations, and [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) for sizing and interaction contracts.

## Automatic Windows music

Notchy listens to the Windows Global System Media Transport Controls sessions without a personal API key or account connection. It follows the current playing session, falls back to another playing session when the Windows selection is paused, and keeps a paused session available for resuming. Session and playback events update the selected player when applications start, pause or close.

Title, artist, artwork, timeline and available commands come from the player. Play/pause, previous/next, seeking, shuffle and repeat only work when that session exposes the corresponding capability. A browser session may identify Microsoft Edge or Google Chrome rather than the website playing inside it; Notchy does not infer a streaming platform from a song title.

The Windows session API does not provide a universal queue or playlist collection. See the [Microsoft session API](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssession) and [session manager](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionmanager) for the supported metadata, commands and events.

## Optional Spotify queue

Windows playback controls and the audio spectrum work without a personal API client ID. The **Up next** queue and Spotify-specific actions use the separate, optional Spotify Web API connection. The [Spotify queue endpoint](https://developer.spotify.com/documentation/web-api/reference/get-queue) requires account authorisation; [PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow) avoids embedding a client secret but still requires a registered application client ID. This development build accepts your own application configuration and does not ship a shared account or credentials.

Configure the redirect URI as `http://127.0.0.1:43821/callback`. Set the client ID in the environment before launching Notchy:

```powershell
$env:NOTCHY_SPOTIFY_CLIENT_ID = "YOUR_SPOTIFY_CLIENT_ID"
& ".\build\release\Notchy V2.exe" --data-root (Get-Location).Path --localsend
```

Alternatively, create `.desktop-profile/spotify-client.json` inside your chosen data root:

```json
{"clientId":"YOUR_SPOTIFY_CLIENT_ID"}
```

Replace the placeholder with your own 32-character hexadecimal client ID. Do not add a client secret: the configuration accepts only `clientId`. Authorisation uses PKCE and saved sessions use Windows data protection. Keep the real configuration file private.

[.env.example](../.env.example) is a reference only. Notchy does not automatically load `.env` files. Missing configuration leaves Windows music available and shows the queue’s configuration state instead of connecting with a bundled account.

## Weather and LocalSend

Weather uses Open-Meteo without a personal key. Current-location access depends on Windows permissions; a city can be chosen manually.

The launcher enables LocalSend with `--localsend`. Devices must be able to reach each other on the local network, and Windows Firewall may require permission. LocalSend has no artificial byte-size cap per file or transfer. Available disk space, Shelf file-count limits and preview/OCR/conversion processing limits are separate constraints.

## Keep runtime data private

Local data includes `.desktop-profile/`, `.tauri-webview/`, `.localsend/`, `.shelf/` and `weather.json`. [.gitignore](../.gitignore) excludes these paths, generated builds, logs and credential files. Each installation generates its own LocalSend identity and certificates.

Do not publish account tokens, client IDs, device identities, certificates, saved locations, real Shelf files or diagnostic profiles. Review screenshots and logs before attaching them to an issue. Use sample content for previews.

This version does not run collectors for calls, system notifications or clipboard history. Copying a file-tool result to the Windows clipboard remains an explicit action. Weather, optional Spotify authorisation and LocalSend make the network requests required by those features; local storage does not mean the application never uses the network.

## Licensing

[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) covers NAudio, fonts and icons. Their licences are retained in source and builds. No project-wide licence has been selected for the application code yet.
