# Interface foundations

[tokens.css](../tokens.css) defines the supplied Design System v2 primitives, semantic roles, typography and geometry. [tokens.js](../tokens.js) exposes matching activity/status colors, JavaScript timings and shell configuration as `NOTCH_TOKENS`. [module-contracts.js](../module-contracts.js) is the shared grid/format policy. The generated app bundle preserves this dependency order; source modules remain separate. The supplied values are also available as [design-tokens.v2.json](design-tokens.v2.json).

## Semantic roles

Use role tokens rather than copying primitive hex values into components.

| Role | CSS token | Value |
| --- | --- | --- |
| Shell | `--surface-base` | `#000000` |
| Card | `--surface-card` | `#17171a` |
| Raised surface | `--surface-raised` | `#1c1c1f` |
| Control | `--surface-control` | `#202024` |
| Subtle border | `--border-subtle` | `#26262a` |
| Primary / secondary / tertiary text | `--text-primary/secondary/tertiary` | `#ffffff` / `#c9c9ce` / `#a1a1a6` |
| Muted text | `--text-muted` | `#6b6b73` |
| Tasks and Focus work | `--accent-focus`, `--activity-focus/tasks` | `#ff7a45` |
| Short and long break | `--accent-break`, `--activity-break/long` | `#86b7ff` |
| LocalSend | `--activity-transfer` | `#86b7ff` |
| Music | `--activity-music` | Measured artwork color; `#f08a9a` fallback |
| Weather | `--weather-sky`, `--activity-weather` | `#9db8d9` |
| Shelf | `--activity-shelf` | `#ff9f1c` |
| Positive / negative status | `--status-positive/negative` | `#6ee7b7` / `#f87171` |
| Warning / idle | `--status-warning/idle` | `#ff9f1c` / `#a1a1a6` |

Status is a semantic outcome, not another module identity. Pair color with an icon or label. Both break phases intentionally share blue; their labels still distinguish them. Dynamic artwork values come from decoded pixels. `--music-art-saturation: 1.12` and `--music-art-contrast: 1.02` affect foreground artwork, not text contrast or the measured spectrum.

## Typography and spacing

`--font` is **DM Sans, system-ui, sans-serif**; `--font-ui` aliases it. The font is bundled locally. Sizes are logical pixels before the host display scale.

| Type role | Size / line height / weight | Tracking |
| --- | --- | --- |
| `numeral-xl` | 96 / 1 / 300 | −.03em |
| `numeral` | 34 / 1 / 700 | −.01em |
| `title-l` | 26 / 1.15 / 700 | −.01em |
| `title` | 18 / 1.25 / 700 | 0 |
| `headline` | 16 / 1.3 / 700 | 0 |
| `body` | 15 / 1.45 / 400 | 0 |
| `callout` | 13 / 1.4 / 500 | 0 |
| `label` | 11 / 1.2 / 700 | .14em |

Each role exposes `--<role>-size/lh/weight/tracking`. Existing `--text-xs/s/m/l/xl` alias Label, Callout, Body, Title and Title L. Prefer the named role for new components.

Spacing names are literal pixel values: **`--space-4/8/12/16/24/32`**. Existing renderer needs also have explicit 2, 6, 20, 28, 40 and 48 px tokens. Do not treat the suffix as an index; `--space-4` means **4 px**. Compatibility `--measure-*` and `--color-*` values remain for existing SVG and renderer measurements, not a second spacing or color system.

Radii are `--r-panel: 40px`, `--r-card: 24px`, `--r-control: 16px` and `--r-chip: 12px`. The old semantic aliases point to these roles; pills retain their circular radius.

## Grid, formats and metadata

The panel is **844 × 464** with **16 px padding**. Its navigation row is 48 px high; content starts at y=80 after the top padding and gutter. The content grid is **812 × 368**, three columns/rows, with **260 × 112 cells** and **16 px gaps**.

| Format | Span | Width × height |
| --- | --- | --- |
| `small` | 1 × 1 | 260 × 112 |
| `wide` | 2 × 1 | 536 × 112 |
| `tall` | 1 × 2 | 260 × 240 |
| `side` | 1 × 3 | 260 × 368 |
| `main` | 2 × 3 | 536 × 368 |
| `full` | 3 × 3 | 812 × 368 |

CSS publishes `--cell-w/h`, `--grid-gap`, `--panel-padding`, `--panel-w/h` and `--format-<name>-w/h`. JavaScript exposes immutable `NotchyLayout.grid/formats` and copies through `getFormat`. Module manifests declare supported formats and integer `min`/`ideal` dimensions in optional `layout` JSON; unsupported keys are never invented. Placements use zero-based `column` and `row`, with cell spans supplied by the shared format registry. Read [MODULE_LAYOUT.md](MODULE_LAYOUT.md) and the [JSON schema](module-manifest.schema.json).

Compact, Standard and Large share that canvas and use **.70 / .85 / 1.00 display scales**. Only the host applies scale; modules retain logical dimensions and real state. Rest remains 128 × 10, preview 240 × 40, and activity rows 240/300/360 × 42 with 8 px shoulders. Onboarding has its separate dimensions. Live Lab adds a 40 px control band. These are different surfaces, not extra module formats.

## Motion and state

Duration roles are **instant 150, fast 200, base 350, spring 500, exit 150 and reduced 150 ms**. Music, Focus and LocalSend progress uses **250 ms linear** interpolation. Text, digit and morph CSS roles are 500, 350 and 850 ms. Entrance and row stagger are 80 ms. Legacy card 280 and check 350 remain explicit JavaScript compatibility timings. Protocol limits, deadlines, measured progress and SVG coordinates remain with their owners.

The surface solver retains **stiffness 400, damping 30, mass 1**, position and velocity through interruptions. CSS spring easing is a component approximation; it does not replace the analytical window solver. Text/digit/label blur tokens are **14 / 10 / 6 px**. New animations must be interruptible and respect the owner's lifecycle.

`prefers-reduced-motion: reduce` and `body[data-motion="false"]` disable CSS animation/transition inside the island. JavaScript observes the same preference and cancels its pending work. Timers and persisted data remain real; no decorative audio spectrum or duplicate preview timer is introduced.

The rendered physical states are exactly `rest`, `compact` and `open`. Routes and module presentations are separate. Hover supplies feedback/preview; click or keyboard activation opens content. Closing a temporary route restores its origin and focus, preserving active sessions and drafts. Verify changed tokens against the supported formats, display scales and interaction checks described in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).
