# Design system and interaction contracts

Notchy follows the supplied Design System v2. The shell is black; module cards use `--surface-card` (`#17171a`) with a 24 px radius. DM Sans, semantic colors, explicit spacing tokens and concentric radii are shared across Nook, settings, the editor and Market. An authored module supplies its own internal inset; its host must not add a second opaque card or padding layer.

[tokens.css](../tokens.css) defines visual roles. [tokens.js](../tokens.js) defines the matching JavaScript palette, timings and shell measurements. [module-contracts.js](../module-contracts.js) owns supported formats, minimums and cell allocation; [module-layout.css](../module-layout.css) applies that geometry. [notch.js](../notch.js) hosts navigation and native geometry. See [tokens.md](tokens.md) for values and [MODULE_LAYOUT.md](MODULE_LAYOUT.md) for the module contract.

## Surface and grid

The open logical panel is **844 × 464 px**. Its outer padding is **16 px**, navigation is 48 px high at y=16, and a 16 px gap places the module scene at y=80. The scene is **812 × 368 px**: three 260 px columns, three 112 px rows and 16 px gutters. Panel, card, control and chip radii are **40 / 24 / 16 / 12 px**. Existing corner preferences adjust the open contour around its 40 px default; native clipping uses the same resulting curve.

| Format | Cell span | Outer frame |
| --- | --- | --- |
| Small | 1 × 1 | 260 × 112 |
| Wide | 2 × 1 | 536 × 112 |
| Tall | 1 × 2 | 260 × 240 |
| Side | 1 × 3 | 260 × 368 |
| Main | 2 × 3 | 536 × 368 |
| Full | 3 × 3 | 812 × 368 |

One module receives Full. Two receive Main and Side. Three receive Main, Tall and Small. The exact cell grid replaces the older approximate column shares. Empty cells remain available in the editor. A renderer adapts to the assigned presentation; it cannot move siblings, enlarge the native window or lower its declared minimum.

All three appearance choices keep this logical canvas. Compact, the default, displays it at **0.70** (about **591 × 325 px**); Standard uses **0.85** (about **717 × 394 px**); Large uses **1.00**. The host scales text, padding, controls and hit regions together. It converts geometry once before the desktop bridge; Windows DPI conversion remains native. The work area caps the displayed surface. On smaller screens the host selects a supported arrangement, internal scrolling or a reachable unavailable summary rather than clipping a rich view or rewriting data.

The Module Lab reserves an additional 40 px toolbar without reducing the module frame. Tasks & Focus detail retains its bounded 496 px logical route. Agenda has its own bounded content height. Back/Escape restores the originating route, format and saved placement.

## Closed states and activation

| Surface | Logical size | Lower radius |
| --- | --- | --- |
| Rest handle | 128 × 10 | 6 |
| Preview without activity | 240 × 40 | 10 |
| One / two / three activities | 240 / 300 / 360 × 42 | 6 |
| Temporary notification | 300 × 72 | 8 |
| Small confirmation | 220 × 38 | 19 |
| Intro logo | 460 × 128 | 38 |
| Welcome/tutorial | 570 × 350 | 38 |

Activity previews have 8 px painted shoulders on each side. Rest has no shoulders. The native hit region follows the visible contour, excluding transparent margins and corner cutouts; there is no oversized invisible target. Pointer conversion uses the window's DPI context consistently.

Hover or keyboard focus previews the activity row after its dwell delay. **Only click or keyboard activation opens the panel.** A quick pointer pass cancels preview. Leaving waits 280 ms; an open panel completes its 150 ms content exit before returning to Rest. Reentry interrupts closure from its current position. Deliberate shortcut/tray openings wait for a confirmed pointer entry, so a stationary outside acknowledgement cannot immediately close the requested panel. Outside click and deactivation still dismiss through the normal exit path. Real editing, file dialogs, drags and LocalSend consent retain their interaction guards.

Rest stays thin during music, Focus and transfers. It uses actual progress and measured audio, or the centered handle when idle. Preview values come from real clocks or transfer state. Idle discovery, saved files and weather do not invent ongoing activities. A fixed custom grid keeps its configured cards; transfer activity remains in its dedicated feedback/route rather than displacing a saved cell.

## Editing and module metadata

Right-click opens the cell-grid editor. Its nine cells are available to placements, with at most nine unique module identities; a larger format consumes multiple cells. The options menu lists only formats declared by that module and disables choices whose required cells are unavailable. Add, resize, remove, drag and keyboard movement use the same central validation for bounds, overlap and minimum dimensions. Failed proposals leave the draft intact.

**Done** commits the draft and returns to Nook. Escape first dismisses an open menu or movement mode; leaving the editor without Done discards its draft. The previous four-slot profile remains compatible, including holes, the reserve and the Tasks-to-Focus migration. Reopening the editor copies committed grid entries rather than editing them by reference.

Preview content is inert and hidden from the accessibility tree; the surrounding card and its options are the keyboard interface. Previews reuse current rendering/state without creating a second running timer or duplicating action handlers. Ordinary polling does not rebuild unchanged previews.

A placement is JSON data, for example:

```json
{"id":"focus","presentation":"main","column":0,"row":0}
```

Coordinates are zero-based. A community manifest's optional `layout` declares minimum and ideal dimensions for any supported `full`, `main`, `side`, `tall`, `wide` or `small` format. Omitted keys are unsupported. Legacy render lists remain `full` / `scene` / `rail`; the host translates formats without cloning module state. JSON metadata grants no executable, network or native permissions. See [MODULES.md](MODULES.md) and the [manifest schema](module-manifest.schema.json).

Music, Tasks & Focus and Weather expose six arrangements. Shelf exposes Full, Main, Side and Small. Its Small view keeps the folder icon, actual file count and Open action; Wide and Tall remain unavailable. One identity keeps one task list, timer, file set, media controller and community state across resizing, movement, language changes and temporary views. Unsubmitted drafts and caret positions survive presentation changes; rejected saves preserve the last committed values and the draft.

## Navigation and module behavior

The header keeps Nook, Tray, Market, search and settings in stable positions. Temporary status text cannot push navigation sideways. Settings use the same black shell, grouped surfaces and scrollable body. Market shows the bundled modules and actual installed state; it is not a remote executable-extension store.

A temporary view retains its source. Click or keyboard activation opens it, hover supplies feedback, and Back/Escape restores the visible trigger. Covered controls are inert. Long lists and forms scroll internally even when scrollbars are visually quiet. Keyboard focus, accessible names, disabled states and pointer targets remain reachable in every supported format.

Weather's date opens the local agenda; its calendar state reflects actual appointments. The city opens forecast detail. Inline forecast dismissal and Escape return to the same card without moving or restarting music. All variants use the same validated forecast and selected city. Missing, stale and failed values remain labelled; production does not use mock readings.

Tasks & Focus is one module. Its six arrangements share task selection, duration editing, timer transport and settings. A completed task checks first, strikes through with a small lateral movement, then settles below unfinished tasks. Timer deadlines and the single underlying clock survive view changes. Completed work earns real elapsed-work credit; skipping does not. Cycle-end choices use configured work/break durations and keep their task association. Automatic timer events never steal keyboard focus or cover editing, settings or LocalSend consent.

Music preserves the approved cover/gradient composition. Foreground artwork receives modest saturation **1.12** and contrast **1.02**; background luminance remains bounded for readable text. A decoded cover can supply the hover silhouette's backdrop without changing hit testing. The spectrum uses real native loopback samples and artwork color, with white fallback; silence and pause stay quiet. There is no fabricated audio loop. Actual capabilities govern playback, seeking, queue and library controls.

Up next slides beside the existing reader in the same body. It preserves route, placement, player identity and playback state; narrow areas keep both panes reachable by scrolling. Closing restores its trigger. Manual media interaction suppresses a new-track announcement that would otherwise interrupt the controls. Unsupported system-player queue access is shown honestly and cannot leave stale Spotify items visible.

Shelf keeps the file list scrollable while header and selection actions remain reachable. Downloads stream through Rust using opaque item IDs into Windows Downloads; the frontend does not choose a destination path. Existing files are not overwritten and Shelf originals remain available. File errors stay with file actions rather than masquerading as transfer errors.

LocalSend keeps the existing discovery, consent, waiting, progress, result and return paths. A receiver must explicitly accept an incoming request. Offline favorites cannot receive a send; unknown firewall status stays unknown. Private/link-local manual connection and certificate-derived identities remain guarded by Rust. UI changes do not add an external server, account requirement or bypass for consent.

## Motion, access and verification

The native surface uses the analytical **400 stiffness / 30 damping / 1 mass** spring, with a bounded rebound and a 500 ms settle. Interruptions retain position and velocity. Content holds its final layout while the contour moves. CSS component easing and the physical surface solver are distinct implementations, not interchangeable strings.

Shared durations are **150 ms press/exit, 200 ms color, 350 ms content/check, 500 ms spring** and **250 ms linear progress**. Entrance and row stagger are 80 ms. Text, digits and labels use the exported blur roles; transitions start from their current rendered state. Values still come from real clocks, acknowledged actions or measured transfers. A notification never opens the full panel automatically and expires by its own activity/transfer identity.

`prefers-reduced-motion: reduce` and the in-app motion setting disable spatial travel, blur, shake and shimmer. JavaScript owners cancel pending animation work; hidden/disposed views cannot leave invisible interactive layers or restart narrative callbacks. Preserve focus-visible indicators, meaningful labels and status text/icons alongside color. Reduced motion shows a usable welcome directly. Mimo remains the original robot head, and language changes do not replay onboarding or alter user-entered content.

Verify every supported module format, French/English, three appearance scales, empty/error states and long content. Repeat forward/return navigation, editing, scrolling, interrupted transitions and reduced motion. Check grid collisions, save rejection, reloads, unchanged state and focus restoration. Browser tests complement actual Windows contour, DPI and pointer checks; they do not replace native verification.
