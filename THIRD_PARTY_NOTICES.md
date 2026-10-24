# Third-party notices

Notchy uses the following components. Their licences remain separate from the application code.

- **NAudio**: Windows audio capture library, distributed under the Microsoft Public License (Ms-PL). The full licence is in `native/NAudio-LICENSE.txt` and accompanies the compiled components.
- **Manrope**: Copyright 2018 The Manrope Project Authors. SIL Open Font License 1.1; full text in `assets/manrope-OFL.txt`.
- **DM Sans**: Copyright 2014 The DM Sans Project Authors. SIL Open Font License 1.1; full text in `assets/duration-FONT-LICENSE.txt`.
- **Hanken Grotesk**: SIL Open Font License 1.1; full text in `assets/HankenGrotesk-OFL.txt`.
- **Lucide**: selected icons are from Lucide, under the ISC licence. Full text in `assets/LUCIDE-LICENSE.txt`.
- Rust dependencies and their versions are recorded in `src-tauri/Cargo.lock`. Each dependency retains its own licence terms.

Spotify names and icons identify the compatible service. They belong to their respective owners and do not imply an official affiliation.

## Optional downloadable module: QuickLook

[QuickLook for Windows](https://github.com/QL-Win/QuickLook) was originally created by [Paddy Xu (@xupefei)](https://github.com/xupefei) and is maintained by the QL-Win team and contributors. Its original [author notice](https://github.com/QL-Win/QuickLook/blob/fe6dae67ce28a780c8247b70ccc4fb65cddaeab8/QuickLook/App.xaml.cs) credits Paddy Xu; current source notices credit QL-Win Contributors. QuickLook is distributed under the [GNU General Public License, version 3](https://github.com/QL-Win/QuickLook/blob/master/LICENSE-GPL.txt); its source-file notices also permit later versions.

Notchy's Market downloads the official QuickLook 4.5.0 portable distribution directly from QL-Win, then applies the PDFViewer compatibility correction described below. The engine remains a separate process and retains its own licence. The base installer includes the small compatibility component, not the complete QuickLook engine. The downloaded module also contains the full GPL text, creator credits and the source archive for the exact upstream commit `b13df028f3cce1f84792f7043b57bf5cea3a3e4c`. Sources can also be obtained from [that commit](https://github.com/QL-Win/QuickLook/tree/b13df028f3cce1f84792f7043b57bf5cea3a3e4c). Its project files record the upstream dependency references and build instructions. QuickLook's plugins and dependencies retain their separate notices and licence terms, including LAV/FFmpeg used for video. See [the module documentation](docs/QUICKLOOK_MODULE.md). An external QuickLook installation can still be used. Thanks to its creator, maintainers and contributors for making these previews available.

### PDFViewer compatibility correction

Notchy's compatibility build of QuickLook.PDFViewer retains QL-Win's GPL v3-or-later licence and author notices. It protects rendering when a preview has been closed or has no valid layout yet, including the upstream [PowerPoint switching issue #1892](https://github.com/QL-Win/QuickLook/issues/1892). This is a Notchy modification, not an official QL-Win release. The corresponding modified source, patch, build recipe and GPL notice accompany the component; the module retains the full pinned upstream source archive. OfficeViewer and Syncfusion binaries remain unchanged.

The same compatibility assembly includes a small HTML sizing adapter. It delegates page rendering and menus to QL-Win's original HtmlViewer, opens web previews at a bounded initial size and leaves later resizing to the user. Its GPL source accompanies the compatibility package. This does not modify OfficeViewer, Syncfusion or an independently installed QuickLook application.

This document does not grant an additional licence for the application code.

## Optional official QuickLook extension: OfficeViewer

The optional module also downloads the unmodified official [OfficeViewer 6 plugin](https://github.com/QL-Win/QuickLook.Plugin.OfficeViewer/releases/tag/6) directly from QL-Win for installation in the user's separate QuickLook process. The plugin is credited to Paddy Xu and QL-Win contributors. Its source code is MIT licensed; the included Syncfusion 32.1.19 rendering components retain their separate proprietary licence terms. They are not licensed under QuickLook's GPL or Notchy's licence. Developing or distributing an integration using those components requires the permissions described in the [upstream README](https://github.com/QL-Win/QuickLook.Plugin.OfficeViewer#readme). Notchy does not modify those components or include their binaries in its source repository or base installer.

The local extension metadata retains the original README, MIT licence and source archive for commit [`fa994a6800b3f73b0a327ff1d6de4fed04ca5b71`](https://github.com/QL-Win/QuickLook.Plugin.OfficeViewer/tree/fa994a6800b3f73b0a327ff1d6de4fed04ca5b71). The official package is verified before installation: 15,314,985 bytes, SHA-256 `9ea7b49d293f00180fc6e502890a58d51872e3e2c8ff3e739b92ca98468ba4f5`.
## Galet motion — Notch Buddy / Coucou

The spherical gaze, blink timings and reaction motion originate from Louis Raillé's [Notch Buddy prototype in Coucou](https://github.com/Louis-CFM/coucou/blob/main/design/prototype/notch-buddy.html). The user supplied Galet's original SVG design references and the subsequent **Mimo — états et émotes** HTML board. `mimo-renderer.js` preserves the board's Canvas drawing and motion block; `galet.js` adapts its lifecycle and application event names. The file-catch return (420 ms) and page motion (360 ms) also follow this prototype, driven by Notchy's real file actions rather than its demonstration upload timer. This integration uses no Coucou services, agent integrations or external character assets.

MIT License

Copyright (c) 2026 Louis Raillé

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

# Passerelle Office isolée Notchy

`native/office-preview/` contient une passerelle et un worker sous GPL-3.0-or-later, construits pour l’interface `IViewer` de QuickLook. Le paquet généré conserve les sources correspondantes, la recette et la GPL. Il ne contient aucune DLL OfficeViewer ou Syncfusion. Le rendu est fourni par l’extension officielle OfficeViewer de Paddy Xu et des contributeurs QL-Win, installée séparément et inchangée ; leurs licences restent applicables.
