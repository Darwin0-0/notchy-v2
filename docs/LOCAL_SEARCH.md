# Local search

Find a file or folder without leaving Notchy. Select the search button in the header, or press **Ctrl+Space** from another application. If that shortcut is already in use, Notchy tries **Ctrl+Shift+Space**. **Ctrl+K** opens search while Notchy has keyboard focus.

Type at least two characters. Use the arrow keys to select a result, **Enter** to open it, or **Ctrl+Enter** to reveal it in Explorer. **Escape** returns to the previous Notchy view. The selected file can also be copied to the Shelf and passed to the existing LocalSend device picker; sending still requires choosing a device.

## What is searched

The first version indexes names and paths in the Windows Desktop, Documents, Downloads, Music, Pictures and Videos libraries. It does not read document contents or contact an external search service. Hidden folders, credential files, build caches, network drives, links and offline cloud placeholders are excluded. Application and document-content search are not included in this version.

Indexing runs in the background. Filesystem notifications keep the results current; a periodic reconciliation catches missed events. The search footer shows indexing progress and offers a manual index rebuild. An unavailable library or shortcut does not prevent the other Notchy modules from working.

## Implementation

- `src-tauri/src/search.rs` owns SQLite FTS5 storage, bounded background indexing, filesystem watching and identity-checked file actions. Adjustable limits and exclusions are declared near the top of that file.
- `src-tauri/src/search_hotkey.rs` owns global shortcut registration and releases it on shutdown.
- `search.js` and `search.css` implement the self-contained search view. Its `CONFIG` object defines input limits, debounce and polling.
- Search uses the existing origin-checked desktop bridge. There are no search endpoints on the loopback HTTP API, no arbitrary path commands and no shell-command construction.
- The database lives in `search/index.sqlite3` under the current Notchy data directory. It stores names, paths, file identity, modification metadata and local opening frequency. This app data directory is excluded from indexing.
- Before opening or copying a result, Notchy checks that the file still belongs to an allowed library and matches its recorded identity. Direct opening accepts the same standard document and media formats as the Shelf; executables, scripts, shortcuts and other formats must be opened from Explorer. Search-to-LocalSend copies preserve conservative origin protection and leave the original intact.
- Isolated `--data-root` and check profiles index only a pre-created sibling directory named `<profile>-search-fixtures`; they do not register a global shortcut or scan the user's libraries.

The source assets are included by the normal Tauri build. There is no post-build patcher or separate installer to run.
