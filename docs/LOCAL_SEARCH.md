# Local search

Find a file or folder without leaving Notchy. Select the search button in the header, or press **Ctrl+Space** from another application. If that shortcut is already in use, Notchy tries **Ctrl+Shift+Space**. **Ctrl+K** opens search while Notchy has keyboard focus.

Type at least two characters. Use the arrow keys to select a result, **Enter** to open it, or **Ctrl+Enter** to reveal it in Explorer. **Escape** closes an active QuickLook preview first, then returns to the previous Notchy view when pressed again. The selected file can also be copied to the Shelf and passed to the existing LocalSend device picker; sending still requires choosing a device.

## QuickLook previews

Click a result once to select it, then press **Space** to toggle its [QuickLook](https://github.com/QL-Win/QuickLook) preview. **Up/Down** move through results; while a preview is open, **Left/Right** also switch the selected result in the same preview window. **Escape** closes the preview first; a second Escape leaves search. **Enter** or a double-click opens the selected item in its normal application. The eye button, context menu and **Alt+P** toggle the preview too.

The search field keeps normal text editing, including spaces. Arrow navigation moves keyboard focus into the results so Space can preview instead of typing. Typing a letter or Backspace from a selected result returns to editing the query. The query is preserved throughout. Notchy keeps search open while its preview is active and dismisses the preview when you leave search.

QuickLook is an optional external Windows application, originally created by [Paddy Xu (@xupefei)](https://github.com/xupefei) and maintained by the QL-Win team and contributors under [GNU GPL v3](https://github.com/QL-Win/QuickLook/blob/master/LICENSE-GPL.txt). Install it separately from the [official releases](https://github.com/QL-Win/QuickLook/releases). Notchy detects its standard per-user, Program Files, Scoop, App Paths and registered Microsoft Store locations. A portable distribution can live in `quicklook/` beside the Notchy executable, or its absolute `QuickLook.exe` path can be supplied through `NOTCHY_QUICKLOOK_PATH`. No QuickLook binaries or viewer plugins are bundled in Notchy's installer.

When QuickLook is absent, the action reads **Get QuickLook** and opens its official releases page. Install it once, then return to Notchy; availability refreshes when the window regains focus or search is reopened. The actual formats supported depend on the installed QuickLook version and its viewer plugins. QuickLook plugin packages (`.qlplugin`) cannot be launched as previews from search.

The native preview command accepts only an opaque indexed result ID. It rechecks the library boundary, file identity and offline/link exclusions before sending an Invoke message to QuickLook's per-user named pipe. Selection updates reuse that window; closing uses a dedicated Close message and never opens a result through its file association. Notchy starts the detected viewer when needed, coalesces rapid navigation to the latest selection, rejects IPC delimiters in paths, and does not run filenames as shell commands.

## Indexed locations

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
