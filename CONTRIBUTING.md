# Contributing to Notchy

Thanks for helping make a small daily tool feel better. A useful contribution can be a reproducible bug, a clearer interaction, or a focused fix. Start with a part you understand; you do not need to rewrite the application.

## Choose your first contribution

- **Bug report:** explain the steps, what you expected and what happened. Include Windows version, display scaling, the build or commit, and the modules involved. For hover or sizing issues, say where the pointer was when the panel changed.
- **Design feedback:** describe one use case and show where the interface gets in the way. A screenshot or short recording with private content removed is useful. A rough sketch is welcome.
- **Small pull request:** explain the problem, keep the change focused, and include the checks you ran. If the change adds a module, dependency or native service, open an issue first so its size, interactions and scope can be discussed.

Look through [existing issues](https://github.com/Darwin0-0/notchy-v2/issues) before opening a new one. If you are unsure where to start, describe the behaviour you want to improve in an issue.

## Get a development build

Follow the [Windows setup and development-profile instructions](docs/DEVELOPMENT.md#build-and-run-on-windows). Use a separate data folder so test files and preferences do not mix with your normal profile. The guide includes the explicit debug launch command; the ordinary launcher prefers an existing release build.

## Where to edit

| Area | Files |
| --- | --- |
| Application startup | [app.js](app.js) |
| Tasks, Pomodoro state and timer UI | [duration-core.js](duration-core.js), [duration-module.js](duration-module.js), [focus-duration.js](focus-duration.js) |
| Saved Focus compatibility and projections | [focus.js](focus.js) |
| Generated frontend and packaged asset list | [scripts/](scripts/) |
| Module layout, notch transitions and interactions | [notch.js](notch.js) |
| Appearance, spacing and responsive layouts | [notch.css](notch.css), [index.html](index.html) |
| Mimo's welcome and tutorial | [welcome.js](welcome.js) |
| Local services, Windows geometry and file handling | [src-tauri/src/](src-tauri/src/) |
| Local search, keyboard navigation and indexing | [search.js](search.js), [search.css](search.css), [search.rs](src-tauri/src/search.rs) |
| Windows media, audio and OCR helpers | [native/](native/) |
| JavaScript behaviour checks | [tests/](tests/) |

Prefer an existing function or component over a new script or dependency. Keep Tasks and Pomodoro in the same Focus module, and Mimo in the welcome flow. The current public scope is Music, Focus, Weather, Shelf, LocalSend and the local-search utility; avoid adding unrelated collectors or modules to a small fix. Keep both French and English UI text consistent, and preserve user-entered text and file or track names when changing language. Most translations live in [i18n.js](i18n.js); search keeps its own small dictionary in [search.js](search.js). Repository documentation is in English.

## Check the behaviour you changed

Use the [verification commands](docs/DEVELOPMENT.md#run-the-checks). For a JavaScript-only change, run the JavaScript suite. For a Rust or native-helper change, run the relevant Rust checks and build the Windows application. Add a meaningful regression test for a bug; test the behaviour that failed rather than copying the implementation into an assertion.

For an interface change, attach **two screenshots: before and after**, with sample data. Check the affected view at your display scale and one other scale, verify that controls fit, and try opening, hovering, shrinking and closing the panel. Check keyboard access and reduced motion if your change affects interaction or animation. Report what you did not check.

Read [DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) when changing module dimensions, dismissal, activity feedback or motion. Preserve those contracts along with the appearance.

To build a local module, start with the [module SDK](sdk/README.md) and [manifest reference](docs/MODULES.md). The blank island runs the same declarative renderer as Notchy. Import a validated JSON manifest from **Settings → Modules → Library**, review it, then place it in Nook. Design all three presentations. Executable extensions, network access and native services require a separate reviewed proposal; an imported manifest cannot request them.

LocalSend changes need a real transfer between devices as well as automated checks. Use disposable test files and report which direction and file counts you tried. Audio changes need real playback; demo bars are not evidence that the spectrum works.

## Keep the pull request easy to review

Lead with the user-visible problem and the resulting behaviour. List the checks you ran and include the relevant preview. One coherent change is easier to review than a collection of unrelated cleanups.

Before submitting, inspect the diff for personal information. Commit source, tests and necessary demo assets only. Leave out builds, profiles, logs, tokens, API credentials, certificates, actual Shelf files and captured personal messages or music metadata. Use the placeholder configuration in `.env.example`, never a real client ID. Avoid introducing a new licence or changing third-party notices as part of an unrelated fix.

The application code does not yet have a project-wide licence. The [third-party notices](THIRD_PARTY_NOTICES.md) still apply to their components; do not assume public source availability grants redistribution rights.
