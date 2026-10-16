# Interface foundations

`tokens.css` owns interface colours, type, spacing, radii and CSS timing.
`tokens.js` exposes the same activity/status palette and motion contract to the
browser as `NOTCH_TOKENS`, and to Node with `require('../tokens.js')`.
Load both foundations before their consuming styles and scripts.

## Meaning before colour

Activities keep their identity across every surface:

| Activity | Token | Colour |
| --- | --- | --- |
| Focus work | `--activity-focus` | `#6fe3c4` |
| Short break | `--activity-break` | `#5ac8fa` |
| Long break | `--activity-long` | `#bf8bff` |
| LocalSend transfer | `--activity-transfer` | `#8ac8ff` |
| Music | `--activity-music` | Current artwork spectrum colour |
| Tasks | `--activity-tasks` | `#a6e3b4` |
| Weather | `--activity-weather` | `#7aa7ff` |
| Shelf | `--activity-shelf` | `#ffd60a` |

Success, warning, error and idle use `--status-success`, `--status-warning`,
`--status-error` and `--status-idle`. A successful transfer shows a success status
without redefining the transfer's activity identity. Artwork colours are computed
from real decoded cover pixels; they are data rather than fixed palette literals.

## Type and space

Use `--font-ui` for one shared font stack. New text uses the five roles
`--text-xs/s/m/l/xl` (10/12/14/18/28), with `--tracking-label` for small labels.
Use `--space-1` through `--space-8` for the four-unit spacing rhythm.
Cards, controls, artwork and pills use `--radius-card/control/art/pill`.

Exact existing dimensions are retained under `--measure-*` compatibility tokens.
They preserve the approved responsive layouts during this structural migration;
they are not new text or spacing roles. Prefer semantic tokens for new components.
Media/container query thresholds remain literal because custom properties cannot
be used as query conditions in the supported browser engine.

## Motion

The duration roles are instant 120, fast 200, base 300, spring 500, exit 150 and
reduced 150 milliseconds. All music, Focus and LocalSend progress interpolation
uses `--dur-progress` (250 milliseconds) with `--ease-progress` (linear).
The `--ease-island` CSS curve mirrors the JavaScript island spring.
Content entrances use `--stagger-enter` (80) and `--stagger-step` (60).

The island keeps stiffness 400, damping 30 and mass 1. Its analytical spring
retains its current position and velocity when interrupted. Geometry is unchanged:
rest 128 × 10; compact baseline 240 × 40; open formats 540/567/594 × 324.
Activity previews retain their existing one/two/three-item widths and shoulders.
Old content-budget values 196 and 144 remain compatibility measurements rather
than a new window-height policy.

The JavaScript contract also names the existing module minimums and editor
insets, content layer transforms, playback icon frames, completion and digit
frames, and Mimo's reveal offsets. The existing card transition (280) and check
draw (350 milliseconds) remain named compatibility timings. Moving these values
does not alter their geometry or duration. Protocol limits, timer arithmetic,
measured progress and SVG artwork coordinates remain with their owning logic.

`prefers-reduced-motion: reduce` and `body[data-motion="false"]` disable all CSS
animations and transitions inside the island, including pseudo-elements.
JavaScript animation owners also observe the motion preference and cancel their
own pending work. Native audio samples remain real; no fabricated spectrum loop
is introduced.

## State vocabulary

The rendered island uses exactly `rest`, `compact` and `open`.
Pointer events, hover delays and CSS `:hover` retain their normal browser names.
Detailed routes are independent of the island's physical state.

## Migration

Run `node tools/refactor-notchy.mjs` for the safe, repeatable conversion.
Run `node tools/refactor-notchy.mjs --check` to verify that another run would make
no changes. It removes only the four proven dead rules and the obsolete active
design flags, updates state references, centralizes CSS literals without resizing
the island, and reports remaining JavaScript hex values for manual review.
Neither command accesses the network, runs third-party packages, or publishes.
