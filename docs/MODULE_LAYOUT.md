# One host, predictable modules

Notchy owns placement, geometry, navigation and motion. A module owns its data and rendering inside its assigned frame. The supplied Design System v2 tokens and 844 × 464 cell-grid export define the shared geometry. A presentation is a deliberate content arrangement, never a scaled screenshot or a button that rotates through sizes.

## Shared grid

`module-contracts.js` exposes `window.NotchyLayout` in the app and Module Lab. Its immutable `grid`, `formats` and `metrics` are the common layout policy. `tokens.js` owns shell measurements; `tokens.css` owns typography, colors and spacing. Module renderers consume `--module-padding`, `--gap-between-modules`, `--radius-module` and the assigned slot dimensions.

The logical panel is **844 × 464 px** with **16 px padding**. Its 48 px navigation begins at y=16; a 16 px gap places the content at y=80. The content is **812 × 368 px**: three columns of 260 px, three rows of 112 px, and 16 px gutters. Panel, card, control and chip radii are 40, 24, 16 and 12 px. Cards use `--surface-card` (`#17171a`) inside the black shell.

| Presentation | Cell span | Ideal outer frame | Content rule |
| --- | --- | --- | --- |
| `small` | 1 × 1 | 260 × 112 | One concise value and its essential action. |
| `wide` | 2 × 1 | 536 × 112 | A horizontal summary and useful secondary information. |
| `tall` | 1 × 2 | 260 × 240 | A compact vertical arrangement and primary controls. |
| `side` | 1 × 3 | 260 × 368 | Essential values, primary controls and a path to detail. |
| `main` | 2 × 3 | 536 × 368 | Normal use with richer content. |
| `full` | 3 × 3 | 812 × 368 | One module fills the scene. |

A single module receives Full. Two modules receive Main and Side. Three receive Main, Tall and Small. This exact cell split supersedes the earlier approximate 65/35 example: 536 + 16 + 260 = 812. Every card shares the same vertical grid and gutter. Modules cannot promote or resize themselves.

`planSlots(entries, options)` derives the ordinary scene without mutating entries. `planGrid(entries, options)` gives the editor and Lab the same geometry. Its entries are `{id, presentation, column, row}` with zero-based coordinates. The whole proposal is checked for unique IDs, valid spans, bounds and collisions before the caller saves anything. It returns allocated items and `freeCells`. Invalid placements throw; unsupported module formats remain visibly unavailable. `getFormat(name)` returns a copy of a format and `supportedFormats(contract)` lists only declared formats. `applyHost` publishes the presentation and cell metadata through `data-module-*` attributes.

## Module contract

Each supported presentation declares `min` and `ideal` logical dimensions for its outer frame, including padding. Minimums are constraints. A module that omits Small, Wide or Tall cannot be explicitly placed in those formats. Shelf supports Full, Main, Side and Small; Wide and Tall remain unavailable. Its Small summary has a 260 × 112 px ideal frame and a 196 × 104 px minimum, with a folder icon, the real stored-file count and the existing Open action. File names remain in the larger views and Tray. Music, Tasks & Focus and Weather support all six arrangements. The host never lowers minimums to claim a fit.

Community v2 manifests may declare:

```json
"layout": {
  "main": {"min": {"width": 240, "height": 180}, "ideal": {"width": 536, "height": 368}},
  "tall": {"min": {"width": 180, "height": 180}, "ideal": {"width": 260, "height": 240}},
  "wide": {"min": {"width": 280, "height": 104}, "ideal": {"width": 536, "height": 112}}
}
```

This example deliberately supports only Main, Tall and Wide. Every dimension is an integer from 1 to 4096; ideal dimensions cannot be below minimums. Keys, dimensions and nested properties are strictly validated; accessors and custom prototypes are rejected without running module code. Layout metadata grants no executable, network or native permission.

Existing v2 manifests and saved values remain valid. Their required `full` / `scene` / `rail` field-and-action lists remain unchanged: Full uses `full`; Main, Side and Tall use `scene`; Wide and Small use `rail`. An omitted `layout` receives the six safe default contracts. An explicit layout supports only its declared keys. Ordinary constrained layouts may fall back to a supported, readable arrangement; an explicit editor or Lab format never silently changes to a different format.

## State, scale and temporary views

All appearance formats use the same **844 × 464 logical canvas**. The host applies one display scale: Compact **0.70** (about 591 × 325 px), Standard **0.85** (about 717 × 394 px), and Large **1.00**. Compact remains the default. Text, spacing, controls and hit regions scale together. Native Windows DPI conversion happens after this host conversion. SDK authors use logical pixels and do not add their own zoom. The closed handle, activity strip and onboarding retain their separate dimensions.

The available work area caps the displayed surface. Below a minimum, the host chooses a supported arrangement or a reachable unavailable summary. It does not clip a rich module or overwrite saved placement. The Lab reserves its own 40 px toolbar without removing height from the module frame.

**Overlay is a temporary region, not another module size.** Queue, forecast, agenda and search retain their origin. Click or keyboard activation opens them; hover supplies feedback only. Escape or Back returns to the trigger. Covered controls are inert and opening detail does not rewrite placement.

There is one state per module identity. Resizing, moving a card, changing language or opening an overlay preserves tasks, timer deadlines, files, media ownership and community values. Presentation changes reuse live components. A layout plan is derived configuration, not a second store. Subscriptions are disposed when their host is removed.

Unsubmitted text is a host-bound draft. A presentation or locale change preserves it without silently saving. A rejected save retains the draft and the last committed value. A successful acknowledgement consumes only the matching saved draft; newer typing remains editable. `render(..., {resetDrafts: true})` is reserved for an explicit successful reset.

## Verify a module

Open **Settings → Modules → Module Lab**, choose a module and a supported format, then exercise its real state. Developers can call `notchy.beginModuleLab({id: 'focus', presentation: 'tall'})` and return with `notchy.endModuleLab()`. Back/Escape restores the originating route and saved arrangement. The standalone [Module Lab](../sdk/README.md) uses the same contracts and declarative runtime with a separate development store, not a native-service imitation.

Test every declared format at minimum and ideal dimensions, French and English, defaults, long content, keyboard access and real rejected saves. Repeat edits, scrolling, detail/Back, format changes and reloads. Check unchanged data, restored focus, bounded geometry and reachable overflow. Instant feedback, interruptible motion and reduced-motion behavior belong to the common shell.

Adding a declarative module should change its JSON and, only when needed, its renderer adapter. It should not require a module-specific placement rule in `notch.js`.
