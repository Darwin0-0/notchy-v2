# Third-party notices

Notchy uses the following components. Their licences remain separate from the application code.

- **NAudio**: Windows audio capture library, distributed under the Microsoft Public License (Ms-PL). The full licence is in `native/NAudio-LICENSE.txt` and accompanies the compiled components.
- **Manrope**: Copyright 2018 The Manrope Project Authors. SIL Open Font License 1.1; full text in `assets/manrope-OFL.txt`.
- **DM Sans**: Copyright 2014 The DM Sans Project Authors. SIL Open Font License 1.1; full text in `assets/duration-FONT-LICENSE.txt`.
- **Hanken Grotesk**: SIL Open Font License 1.1; full text in `assets/HankenGrotesk-OFL.txt`.
- **Lucide**: selected icons are from Lucide, under the ISC licence. Full text in `assets/LUCIDE-LICENSE.txt`.
- Rust dependencies and their versions are recorded in `src-tauri/Cargo.lock`. Each dependency retains its own licence terms.

Spotify names and icons identify the compatible service. They belong to their respective owners and do not imply an official affiliation.

## Optional external application: QuickLook

[QuickLook for Windows](https://github.com/QL-Win/QuickLook) was originally created by [Paddy Xu (@xupefei)](https://github.com/xupefei) and is maintained by the QL-Win team and contributors. Its original [author notice](https://github.com/QL-Win/QuickLook/blob/fe6dae67ce28a780c8247b70ccc4fb65cddaeab8/QuickLook/App.xaml.cs) credits Paddy Xu; current source notices credit QL-Win Contributors. QuickLook is distributed under the [GNU General Public License, version 3](https://github.com/QL-Win/QuickLook/blob/master/LICENSE-GPL.txt); its source-file notices also permit later versions.

Notchy interoperates with a separately installed QuickLook application to preview indexed search results. Notchy's installer does not include QuickLook binaries or viewer plugins. QuickLook and its plugins retain their own notices and licence terms. Thanks to its creator, maintainers and contributors for making these previews available.

This document does not grant an additional licence for the application code.
