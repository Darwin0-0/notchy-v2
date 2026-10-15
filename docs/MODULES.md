# Module manifests: a v1 integration contract

Use this contract to propose a module that feels at home in Notchy. Start with a useful job, show what survives in each presentation, and request only the access that job needs.

**Status: design and integration proposal, not an installed plugin API.** Notchy does not discover, import or execute these manifests. Saving the [example](examples/module.manifest.json) in the repository or a profile will not install a module. The [JSON Schema](module-manifest.schema.json) validates a proposal's structure; it does not grant access or make its implementation safe.

The application currently registers built-in modules in [`moduleDefinitions` in notch.js](../notch.js). `normalizeModules` accepts only those known IDs. A working addition still needs reviewed source changes, a native service when necessary, and the checks described in [CONTRIBUTING.md](../CONTRIBUTING.md). There is no external-module loader, sandbox, permission broker or stable third-party renderer interface yet.

## What exists today

| Responsibility | Current implementation |
| --- | --- |
| Catalogue identity, host element, route and band policy | `moduleDefinitions` and `getModuleDefinitions()` in [notch.js](../notch.js). |
| Enabled modules and saved positions | `normalizeModules`, `assignModuleSlot` and `modulePlacementPlan`. Unknown IDs are discarded; the first three slots are visible and the fourth is a compatible reserve. |
| Primary scene, secondary rail and temporary promotion | `createActivityScene` and `renderActivityScene`. The same model and live controller survive movement. |
| Tasks and Pomodoro | One [Focus model](../focus.js), shared by `NotchyFocus.create()` and `NotchyFocus.createTasks()`. A second presentation must not create a second clock or store. |
| Language | [i18n.js](../i18n.js), selected in Welcome or Settings. User content is kept verbatim. |
| Platform access | Reviewed Rust services in [src-tauri/src/](../src-tauri/src/), with Windows helpers in [native/](../native/). |
| Contour, visibility and motion | `ISLAND_CONFIG`, the surface controller and scoped styles. Modules do not own the native window. |

`window.notchy` exposes built-in controls such as `getModules()`, `setModules()`, `getModuleDefinitions()` and `inspect()`. These are application controls, not a registration hook or permission boundary. Likewise, the local `/api/music`, `/api/weather`, `/api/shelf` and `/api/nearby` routes serve specific built-in features; a manifest must not treat them as an unrestricted extension API. Clipboard history and system-notification collectors are not part of the current public base.

## Describe one module

The v1 fields are intentionally declarative:

| Field | Meaning |
| --- | --- |
| `manifestVersion` | Contract version, currently `1`. A module's release number belongs in `version`. |
| `id` | A stable, namespaced identifier such as `community.reading-log`. Do not rename it to translate the interface or reuse a built-in ID. |
| `name`, `description` | Required English and French interface strings. |
| `regions` | Requested placement roles: `scene` for the primary area and `rail` for the secondary area. These are placement roles, not a percentage or an instruction to resize Notchy. |
| `presentations` | Three separately designed views: `full`, `scene` and `rail`. Each declares its purpose, essential snapshot fields and visible action IDs. |
| `permissions` | Requested access categories for review. An empty list is the preferred starting point. Declarations are not grants. |
| `capabilities` | Progress semantics, labelled action metadata, settings availability and live-band policy. |
| `appearance` | A suggested accent, an opaque host surface and an optional validated-cover treatment. No CSS or asset URL is embedded. |
| `motion` | Host-controlled motion, a reduced-motion alternative, visibility cleanup and whether measured data drives ambient movement. |

There are deliberately no `script`, `entrypoint`, `html`, `css`, `command`, executable path, endpoint or credential fields. Extra fields are rejected. Text is data and must be rendered as text, never evaluated or inserted as HTML. Future support for executable extensions would need its own security design and a new reviewed contract.

## Design all three presentations

| Presentation | Current host mapping | Keep visible |
| --- | --- | --- |
| `full` | One placed module fills the scene. | The complete useful workflow and a route to secondary controls. |
| `scene` | A half-width card: either side with two modules, or the primary half with three. | The main state and the actions needed for its ordinary use. |
| `rail` | One of the two secondary quarter cards with three modules. | A clear value or status and its essential action; open or promote for details. |

The host chooses placement and shares: one module uses the available area, two use equal halves, and three use one half plus two quarters. A `rail` placement can therefore receive the `scene` presentation when only two modules are present. Do not infer a design from its saved slot number. No manifest field can override these shares, force a larger panel or hide another module.

All three presentation declarations are required, even if a proposal requests a restricted region. That restriction still needs product review; the current editor does not enforce manifest-defined regions. At smaller work areas, the host may stack cards and provide internal scrolling. Follow the current dimensions and corner tokens in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), rather than copying a demonstration canvas or scaling text with a transform.

`content` contains names of fields supplied by a future reviewed adapter, not field values or executable bindings. It does not define a generic renderer. Keep names stable across sizes and write down their types, empty/loading/error states and source in the implementation proposal. Each presentation's `actions` must reference a unique ID in `capabilities.actions`. Essential actions must remain reachable with a keyboard; omitted secondary controls need a discoverable route.

## Language and accessibility

Every manifest label and explanation contains both `en` and `fr`. The adapter should integrate those strings with the existing language mechanism and update text without replacing the module's state or taking focus. Task titles, track and artist names, city names and file names are content, not translation keys.

Use real buttons, readable labels and local focus-visible cues. Keep meaningful progress and disabled states accessible. Pair status colour with text or an icon, maintain text contrast, and do not make the smaller design a clipped version of the larger one. User-triggered actions may move focus to a visible result; background updates must not take it. A component must clean up listeners, reads and animations when hidden or disposed.

## Access is explicit and reviewed

The schema recognises these proposed permission names:

| Category | Intended scope |
| --- | --- |
| `network` | A reviewed remote data source. Implement an explicit destination allowlist and error handling in its adapter. |
| `location` | User-authorised location, with a manual alternative where possible. |
| `media.read`, `media.control` | Metadata from a detected player and only the commands that player exposes. |
| `audio.output` | Measured output-audio data. It must stop when the feature is hidden, inactive or motion is disabled. |
| `files.user-selected` | Files the user deliberately chooses or drops; no general filesystem browsing. |
| `shelf.read`, `shelf.write` | Reviewed access to Notchy's existing Shelf service. |
| `local-network` | Explicit nearby-device discovery and transfer flows, retaining receive consent. |
| `clipboard.write` | Copy a result after an explicit user action; not clipboard history. |

These names are **not** existing Tauri capability names or a new enforcement layer. Explain the need, data retention, cancellation and failure behaviour in the proposed implementation. Never place keys, tokens, saved coordinates, private file paths or device identities in a manifest. A JSON declaration cannot bypass Windows permission prompts, existing request authentication or receive consent. Permission denial must leave a truthful, usable state.

## Capabilities and real state

`capabilities.progress` describes what an adapter can report:

- `none`: there is no measurable progression.
- `determinate`: report a finite ratio from `0` to `1`, its labelled meaning and whether it increases or decreases. Unknown progress is not zero. Reject non-finite and out-of-range values at the adapter boundary.
- `indeterminate`: work is active but its percentage is unknown. Do not invent a ratio.

The manifest contains no live progress values, timers or sample production state. A future adapter owns validated state; the host formats its presentation. A layout or language change must not restart work, reset a deadline or duplicate a subscription. Focus and Tasks must keep their existing shared model. Windows media command availability and queues remain source-dependent; listing an action does not make the player support it.

`capabilities.actions` supplies IDs, translated labels and roles for design review. It does not execute anything. An implementation must map each ID to a reviewed handler, check current availability, prevent duplicate submissions and preserve a useful keyboard destination. A destructive role is a visual/interaction distinction, not automatic confirmation logic.

`capabilities.band` declares discreet and hover treatments plus meaningful event names. Progress alone is not an ongoing activity: saved files, a weather forecast or a reading count should not keep the band active. Only validated work that is actually active may claim it. A ring or progress treatment needs real progress semantics; a spectrum additionally requests `audio.output` and must use measured samples. The schema checks those declarations, not the existence of a data source.

Band events require a reviewed whitelist in the module definition. Emit real transitions once, rather than every render. Existing manual play, pause, resume, start and stop actions do not create notifications. A background event may use the existing temporary feedback, but must not open the central panel or cover a consent request. Preserve the current activity priority and dismissal rules.

## Appearance and movement belong to the host

`surface: "host-opaque"` preserves the single black notch and its bounded inner cards. An accent is a suggestion; the host must maintain contrast and a non-colour status cue. `artwork: "validated-cover"` requests the existing cover-derived treatment, with validated image data, a contrast-bounded palette and a safe fallback. It is not permission to fetch an arbitrary image URL or add glass effects.

`motion.preset: "host"` keeps geometry, interruptible transitions and content choreography under the existing controller. Do not animate text size, start a competing window-resize loop or keep an invisible layer interactive. Use `static` or a short `fade` for reduced motion. Hidden or disposed views cancel their transient reads and visual effects; a running timer or accepted transfer retains its owning service and state. `pauseWhenHidden` does not pause a deadline or cancel a transfer. Restoring visibility does not replay a completed introduction or automatically reopen the panel. `ambient: "measured-data"` means movement follows actual samples or progress, not a decorative fake spectrum.

## Validate a proposal

The [example reading manifest](examples/module.manifest.json) is a safe design proposal: no platform permissions, no live-band claim and no executable content. It cannot be installed in today's app.

Use a JSON Schema validator that supports Draft 2020-12. For example, if Ajv 8 is already available in your development environment:

```javascript
const fs = require('node:fs');
const Ajv2020 = require('ajv/dist/2020');
const schema = JSON.parse(fs.readFileSync('docs/module-manifest.schema.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync('docs/examples/module.manifest.json', 'utf8'));
const validate = new Ajv2020({strict: true, allErrors: true}).compile(schema);
if (!validate(manifest)) throw new Error(JSON.stringify(validate.errors));
```

No validator dependency is added to the application by these documents. Schema validation does not check that snapshot fields exist, action IDs are unique and referenced correctly, permissions are granted, contrast is sufficient, or a component cleans up. Review those semantics and test them in the implementation. Test all three designs with empty, loading, unavailable and long-content states; keyboard navigation; interrupted transitions; hidden views; and both languages. Native, audio and transfer changes also need the real checks in [DEVELOPMENT.md](DEVELOPMENT.md).

When a manifest is accepted, update the reviewed built-in registry, component, translations, relevant native adapter and tests together. A dynamic loader, permission broker, runtime renderer protocol, migration policy and extension compatibility negotiation remain future work. The v1 document is a shared starting point for that work, not a promise that those facilities already exist.
