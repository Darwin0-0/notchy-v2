<div align="center">

<img src="assets/notchy-mark.svg" width="112" alt="Notchy's Mimo robot head on a black tile">

# Notchy V2

**Your day, a little closer.**

Music, focus and local files—right where you need them.

![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D4) ![Status: actively evolving](https://img.shields.io/badge/status-actively%20evolving-62d7be) [![Contributions welcome](https://img.shields.io/badge/contributions-welcome-8b6ce7)](CONTRIBUTING.md)

[Download for Windows](https://github.com/Darwin0-0/notchy-v2/releases/latest) · [Help improve Notchy](CONTRIBUTING.md) · [Report a bug](https://github.com/Darwin0-0/notchy-v2/issues/new)

</div>

**Meet Notchy in 28 seconds.** Music, focus and nearby sharing, in one quiet space.

https://github.com/user-attachments/assets/94bf59c0-2316-48e4-83d8-acb2e9363eca

[Watch or download the film](assets/previews/notchy-film.mp4)

Notchy is a compact notch for Windows. Click to open your controls. Move away and the notch settles into its discreet view. Its panel adapts to the modules you choose and the space they need.

Nook keeps the arrangement you choose, with your everyday essentials beside it. Use an activity's buttons or clickable title for its detailed controls, then return to the same layout. Starting or pausing a focus session keeps your music in place.

On your first launch, Mimo wakes up, takes a curious look and welcomes you in. An optional quick guide helps you find your way; revisit it from Settings whenever you need a reminder. The installed app starts with Windows and stays discreet after setup. You can turn this off in Settings.

<p align="center"><img src="assets/previews/welcome.gif" alt="Mimo greeting on Notchy’s welcome screen, with a language choice"></p>

The project is actively evolving. Choose Français or English on the welcome screen or in Settings; the film and previews use sample data.

## Make room for what matters

- **Music within reach.** Notchy automatically follows compatible Windows media players, with artwork, playback controls, track progress and a softly animated spectrum. Everyday playback needs no personal API key. Add **Up next** with the optional Spotify connection.
- **One place for tasks and Pomodoro.** Give a task a total time budget, including breaks, and preview its focus and rest intervals before adding it. The timer and task list share the same progress.
- **A panel that fits your setup.** Arrange your modules on a shared grid. Each module adapts to its assigned space, while your music, tasks and files keep their state.
- **Your day at a glance.** Read the weather, open detailed forecasts from the city, and keep appointments in a local calendar. Its icon changes color when you have something planned today.
- **Files ready to use.** Drop files into the Shelf, select a file and press **Space** for its QuickLook preview. Get the optional QuickLook extension directly in **Market**; Notchy downloads and manages the preview engine without a separate installer. Use the arrow keys to browse files and **Escape** to close the preview. File actions such as OCR and conversion stay available.

  Standalone HTML runs in an integrated, isolated frame. Office files (`.docx`, `.xlsx`, `.pptx`) use QuickLook's official OfficeViewer extension to preserve layout, images and supported charts without Microsoft Office. See [Office rendering and its limits](docs/QUICKLOOK_MODULE.md#aperçus-office-avec-officeviewer).
- **Ready to receive.** LocalSend starts with Notchy. Accept incoming files, send to nearby devices, and follow the transfer without leaving the notch.
- **Find it, keep your flow.** Open local search from the magnifying glass or **Ctrl+Space**. Find a file or folder by name, preview the selected result with **Space** through the optional QuickLook extension, reveal it in Explorer, or choose a nearby device to send it with LocalSend. Your search stays on your PC.
- **Make space for your own ideas.** Open **Market** to find Music, Tasks & Focus, Weather and Shelf, with their real installed state. Preview local community examples or import your own JSON module. Your module data stays on this device.

![Local search inside Notchy, with sample files and keyboard controls](assets/previews/search.png)

![Tasks and Pomodoro together in the Focus module, using sample data](assets/previews/focus.png)

<p align="center"><img src="assets/previews/localsend.gif" alt="A sample LocalSend reception, from consent to completion"></p>

[Watch the LocalSend scenarios](docs/LOCALSEND_SCENARIOS.md): discovery, sending, receiving and retrying, with sample files and devices.

## Start small, make it yours

1. [Download the Windows installer](https://github.com/Darwin0-0/notchy-v2/releases/latest) and run setup. No build tools are needed; setup downloads WebView2 if it is missing.
2. Hover over the notch for a quick preview, then click to open the controls. Move away to return to the discreet view. Keyboard editing, file dialogs and active drags stay protected while you use them.
3. Open **Settings → Modules** to arrange Music, Tasks & Focus, Weather and Shelf. **Market** lets you install or remove modules; removing a built-in module keeps its data and saved placement. Open **Tray** for files and LocalSend; save a copy to Downloads whenever you need one.
4. Choose your city and add a task: enter its title, set hours and minutes, review the interval plan, then choose **Add task**. A 90-minute budget includes three 25-minute focus intervals and three 5-minute breaks with the default settings. Pomodoro settings apply to new task plans; existing plans keep their timings and progress. Back or Escape cancels an unsaved form.
5. Use **Ctrl+Space** for local search. Navigate with the arrow keys, press **Enter** to open a result or **Ctrl+Enter** to reveal it, and **Escape** to return. When results are ready, press **Space** directly in the search field to toggle the selected result’s optional [QuickLook preview](docs/LOCAL_SEARCH.md#quicklook-previews), initially the first result; arrows switch the preview and Escape closes it first. Use **Shift+Space** to type a space while results are ready. Unmodified Space stays text when there are no results, a search is loading, or previews are unsupported. If the global shortcut is busy, Notchy tries **Ctrl+Shift+Space**; **Ctrl+K** also works inside Notchy.

Your personal profiles and files stay in local data folders and are excluded from the source repository. Weather uses a public forecast service; Spotify is optional, and LocalSend connects devices on your local network. Setup and privacy details are in the [development guide](docs/DEVELOPMENT.md).

The [interaction guide](docs/INTERACTIONS.md) follows the complete paths from tasks to a focus session, detailed music controls, and local sharing.

## Build it with us

You do not need to know the whole codebase to make Notchy better. A clear bug report, a small fix or a thoughtful design observation is a useful place to start.

[Open an issue](https://github.com/Darwin0-0/notchy-v2/issues/new) with what you tried and what you expected, or read [CONTRIBUTING.md](CONTRIBUTING.md) to work on one focused improvement. Screenshots, keyboard-access feedback and reports from different display scales are welcome.

The [project backlog](docs/ROADMAP.md) lists the remaining decisions, release checks and product improvements, with a clear finish line for each.

Have an idea for a module? Start on the [blank island in the module SDK](sdk/README.md), then follow the [detailed JSON manifest reference](docs/MODULES.md). The same renderer powers the SDK and imported modules. Market ships with the built-in modules and local examples; an online community catalog is not connected yet.

## Architecture

Use **Nook** for your activities, **Tray** for files and nearby sharing, and **Market** to manage modules. **Settings** groups General, Appearance, Notch, Modules, Health and About in one sidebar. Buttons and clickable titles open detailed controls; the card background does not navigate. Return to Nook without losing the current song, task or timer.

The shared layout assigns a declared presentation to every module. Music, Tasks & Focus and Weather support Small, Wide, Tall, Side, Main and Full; Shelf supports Small, Side, Main and Full. Open **Module Lab** from Settings → Modules to inspect the real module in each supported format. Opening a detail keeps your saved placement. The [layout contract](docs/MODULE_LAYOUT.md) defines dimensions, spacing and the rules for future modules.

The Rust core owns native settings, network diagnostics, device discovery and file operations. The interface reuses those results and keeps its presentation separate from them. Shared [design tokens](docs/tokens.md) keep activity colors, status colors, type and motion consistent. LocalSend works on the same local network without internet; when automatic discovery is unavailable, add a private IP or use the explicit local-network search in Health.

[Local search](docs/LOCAL_SEARCH.md) is a utility available from every main view. It indexes file and folder names in your personal Windows libraries, with live updates and keyboard navigation. Document contents and application launching are outside this first version; hidden, private and offline locations are excluded.

Small contributions fit here: improve a real interaction, test an empty or error state, or help refine one module. The [development guide](docs/DEVELOPMENT.md) explains how to run and verify a change.

## Thanks, and licensing

Thanks to everyone who tests a build, reports a rough edge or shares an idea—and to the authors of the [third-party components](THIRD_PARTY_NOTICES.md) used here.

Special thanks to [Paddy Xu (@xupefei)](https://github.com/xupefei), the original creator of [QuickLook for Windows](https://github.com/QL-Win/QuickLook), and the QL-Win maintainers and contributors. QuickLook provides optional previews in Windows, Notchy's search and Shelf and is licensed under [GNU GPL v3](https://github.com/QL-Win/QuickLook/blob/4.5.0/LICENSE-GPL.txt). **Market → QuickLook → Get** downloads the pinned official portable engine, OfficeViewer and their corresponding sources into Notchy's private module directory. The base installer includes only a small GPL PDFViewer compatibility component; the complete engine is downloaded separately. The PDFViewer correction is a Notchy modification, with its [source patch and rebuild recipe](native/quicklook-compat/README.md), and protects rapid PowerPoint preview changes. Prepare that component before a native build. OfficeViewer and its rendering libraries remain unchanged. An existing external QuickLook installation remains compatible. See [the extension contract](docs/QUICKLOOK_MODULE.md).

A project-wide licence has not been selected yet. Public availability does not add one; check the licensing status before reusing or redistributing the application code. Third-party licences remain in place.
