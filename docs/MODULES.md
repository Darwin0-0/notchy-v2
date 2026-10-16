# Build a module for Notchy

Make something useful that stays close at hand. Notchy now installs **local, declarative JSON modules**: a reading tracker, a small counter or a personal note can work without adding application code, a network account or a build toolchain.

Start with the [Reading manifest](examples/module.manifest.json), the [JSON Schema](module-manifest.schema.json) and the [blank development island](../sdk/README.md). The built-in **Discover** catalog includes Reading and Water break. Import a JSON file in the module library to add your own module, then place it on Nook. Its state stays in the current Notchy profile. Removing a module also removes its local state.

Open **Settings → Module library**, or use **Library** in the home editor. The library separates Discover, My modules and Studio. Preview a manifest before confirming installation; **Place in Nook** uses a free visible slot, or the main slot when they are occupied. Studio also provides a JSON editor and a blank Nook for testing placement. Application developers can open the same screen with `window.notchy.showModuleLibrary()` and inspect installed definitions/state with `window.notchy.getCommunityModules()`.

This v2 runtime is deliberately limited to host-rendered fields and actions. It does not load JavaScript, HTML, CSS, arbitrary images, executable files or remote services. The earlier v1 manifest was a design proposal and cannot be imported; use v2 below. Built-in Music, Focus, Weather and LocalSend retain their reviewed application and native implementations.

## Try the blank island

From the repository root, run:

```sh
node sdk/serve.cjs
```

Open the loopback address printed by the script. The island starts empty. Choose **Reading**, **Water break** or **Import JSON**, try its real controls, then switch among **Full**, **Scene** and **Rail**, and between English and French. **Export manifest** saves the current validated definition. **Clear island** removes the example and its development state.

The host uses the same `module-runtime.js` as the app. It is not a screenshot or a mock API. It saves its own development library in browser storage, separate from the installed application. No Tauri, Rust, npm installation or network connection is needed. To validate a file without opening a browser:

```sh
node sdk/validate.cjs sdk/starter.manifest.json
node --test tests/module-runtime.test.cjs
```

## Manifest contract

The complete [Reading example](examples/module.manifest.json) can be installed directly. The top-level structure is:

```json
{
  "manifestVersion": 2,
  "id": "community.my-module",
  "version": "1.0.0",
  "name": {"en": "My module", "fr": "Mon module"},
  "description": {"en": "One useful job, close at hand.", "fr": "Une fonction utile, à portée de main."},
  "permissions": [],
  "fields": [
    {"id": "count", "type": "number", "label": {"en": "Count", "fr": "Compteur"}, "default": 0, "min": 0, "max": 100}
  ],
  "actions": [
    {"id": "add", "type": "increment", "field": "count", "amount": 1, "label": {"en": "Add one", "fr": "Ajouter"}}
  ],
  "presentations": {
    "full": {"fields": ["count"], "actions": ["add"]},
    "scene": {"fields": ["count"], "actions": ["add"]},
    "rail": {"fields": ["count"], "actions": ["add"]}
  },
  "appearance": {"accent": "#A6E3B4"}
}
```

| Field | Rules |
| --- | --- |
| `manifestVersion` | Exactly `2`. A contract version is different from a module release version. |
| `id` | Stable namespaced ID, such as `community.reading`; 2–4 lowercase segments, with optional digits and hyphens; at most 96 characters. Built-in IDs are not valid external IDs. |
| `version` | Three numeric components, each from 0 to 9999, without leading zeroes: `1.2.0`. Prerelease suffixes are not supported. |
| `name` | Nonempty `en` and `fr` labels, each at most 80 characters. |
| `description` | Nonempty `en` and `fr` strings, each at most 280 characters. |
| `permissions` | Exactly `[]`. Requests for network, filesystem, media or other privileged access are rejected. |
| `fields` | 1–8 typed local state fields, described below. |
| `actions` | 0–8 host-owned operations. Every target must refer to a declared field of the correct type. |
| `presentations` | All three keys, `full`, `scene` and `rail`, are required. Each lists 1–8 field IDs and 0–8 action IDs to show. References and duplicates are checked. |
| `progress` | Optional real progress derived from two numeric fields; no fabricated activity or timer. |
| `appearance` | Only `accent`, a six-digit hex color. Geometry, typography, contrast, backgrounds and motion belong to the host. |
| `$schema` | Optional editor hint, at most 512 characters. Never fetched or executed by Notchy. |

Unknown properties are rejected at every level. All names, descriptions and field/action labels require both languages. Text is rendered with `textContent`; user text is never interpreted as HTML or translated as a key. Control characters are rejected in manifest labels. Field and action IDs use `[a-z][a-z0-9-]{0,47}`; `constructor` and `prototype` are reserved.

### State fields

| Type | Required properties | Behaviour |
| --- | --- | --- |
| `number` | `id`, `type`, `label`, `default`, `min`, `max` | All values must be finite. Bounds lie between −1,000,000 and 1,000,000, with `min < max`; the default must be within them. Updates clamp to these bounds. |
| `text` | `id`, `type`, `label`, `default`; optional `maxLength` | At most 512 characters by default. A custom limit must be an integer from 1 to 512; the default must fit. Saved edits are truncated to the limit and unsafe control characters removed. |
| `boolean` | `id`, `type`, `label`, `default` | Default and updates must be true or false. The host shows a translated Yes/No value. |

The manifest contains defaults, not a user's saved state. Defaults may be empty text or zero. Do not include personal information, credentials, paths or real device identities in a shared manifest.

### Host-owned actions

Every action has `id`, translated `label`, `type` and target `field`.

| Type | Target | Effect |
| --- | --- | --- |
| `increment` | `number` | Adds the finite, nonzero `amount`, then clamps to the field bounds. Negative amounts decrease it. A control is disabled at its applicable bound. |
| `reset` | Any field | Restores that field's manifest default. It does not uninstall a module or reset unrelated state. |
| `toggle` | `boolean` | Switches true ↔ false. |
| `set-text` | `text` | Renders a labelled text input and save button. Saving updates only that field. |

Actions cannot invoke a shell, access the clipboard, open a path, send a request, emit app notifications, start a native clock, or claim the discreet band. That access would need a separate reviewed API and a new contract.

### Real progress

```json
"progress": {
  "valueField": "completed",
  "targetField": "target",
  "label": {"en": "Reading progress", "fr": "Progression de lecture"}
}
```

Both references must identify different numeric fields. `valueField.min` must be nonnegative; `targetField.min` must be positive. The host renders a labelled native progress element, clamped to the target, and the actual `completed / target` values. An over-target count remains visible as data; the progress fill stays at 100%. No background events or invented percentages are created.

### Three presentations

| Presentation | Role | Recommended content |
| --- | --- | --- |
| `full` | The module is alone in the available scene. | Its useful fields, description, primary action and secondary editing/reset controls. |
| `scene` | The main card or one of two cards. | Essential fields and normal-use controls. |
| `rail` | A smaller secondary card. | One clear value and its essential action. |

These are separately selected field/action lists, not scaled screenshots. Keep the smaller view concise. The host chooses actual layout and size according to the current module arrangement and work area; a manifest cannot resize the native window, move the navbar or change another module. Switching layouts or language preserves one shared state. Follow [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) for application dimensions and spacing.

## Imports, versions and storage

- Each imported JSON file is at most **65,536 UTF-8 bytes**. Archives and executable packages are unsupported.
- A library contains at most **12** installed modules. The serialized library is bounded to **196,608 UTF-8 bytes**, including manifests and state.
- Importing the same ID and version updates its definition while retaining compatible field values, which is useful during development. Importing a newer version does the same. A lower version is rejected.
- Values survive only when their field ID and type still match. Removed fields are dropped, new or changed-type fields use defaults, and tighter numeric/text bounds clamp preserved values. There are no migration scripts.
- A write is committed and subscribers notified only after the configured persistence hook and storage adapter accept it. A rejected persistence hook leaves the previous live snapshot and local cache untouched. A corrupt restored entry is ignored without discarding other valid entries; startup never automatically rewrites malformed stored bytes.
- Removing a module removes its state. Exporting a manifest exports its definition and defaults, not the user's saved values.

The runtime returns normalized, deeply frozen objects so callers cannot mutate a shared snapshot behind the store. Invalid direct state patches and undeclared fields are rejected. The runtime revalidates persisted manifests, drops unknown state keys and repairs malformed values to their defaults.

## Host API

`module-runtime.js` exposes `window.NotchyModules` in a browser and `module.exports` in Node. It has no dependencies.

```javascript
const store = NotchyModules.createStore({
  storage: window.localStorage,
  key: 'my-development-library'
});

// Or pass the JSON file text directly; the byte cap is checked before JSON.parse.
const entry = store.install(NotchyModules.catalog[0]);
const host = document.querySelector('#module');
function draw() {
  const current = store.get(entry.manifest.id);
  return NotchyModules.render(host, current.manifest, current.state, {
    presentation: 'full',
    language: 'en',
    onAction: (actionId, value) => store.performAction(current.manifest.id, actionId, value)
  });
}
const unsubscribe = store.subscribe(draw);
let dispose = draw();
// When the host is removed: unsubscribe(); dispose();
```

The storage adapter implements synchronous `getItem(key)` and `setItem(key, json)`. A throwing `setItem` rejects the operation. The application uses `notchy-community-modules-v1` under its trusted browser/native preference bridge; the registry's `registryVersion` and manifest's `manifestVersion` remain separate from that storage-key name. The standalone host uses a separate browser-storage key.

For native or other asynchronous persistence, pass `persist(encodedJSON)`. Every mutator then returns a Promise and must be awaited. The runtime serializes complete operations, calculates each from the last committed state, waits for the persistence hook, writes the local cache, then publishes the new frozen snapshot. Rejection leaves local state/cache unchanged and does not block later operations. The hook must reject on a failed save; resolving an error-shaped object is not acknowledgement. The cache adapter must not separately forward a second fire-and-forget native write. Keep local cache writes small and reliable: an independent cache failure after a successful external commit needs host-level reconciliation; it cannot undo an external write automatically.

```javascript
const store = NotchyModules.createStore({
  storage: localCache,
  key: 'my-library',
  persist: encodedJSON => nativeBridge.saveModuleRegistry(encodedJSON)
});
const entry = await store.install(manifest);
await store.performAction(entry.manifest.id, 'advance');
```

Without `persist`, methods remain synchronous for ordinary local storage or an in-memory host. Do not pass a fire-and-forget writer and assume native-disk durability.

| API | Result |
| --- | --- |
| `validateManifest(object)` | A normalized frozen manifest, or a validation error. |
| `parseManifest(jsonText)` | Byte-limited JSON parsing followed by the same validation. |
| `normalizeState(validatedManifest, value)` | Declared fields only, repaired/clamped and frozen. |
| `validateRegistry(value)` | Safe frozen `{registryVersion: 1, modules: [{manifest, state}]}`; malformed entries are omitted. |
| `createStore({storage?, key?, onChange?, persist?})` | A local persistent or in-memory library. Constructor does not save. An optional persistence hook enables queued asynchronous mutations. |
| `store.list()`, `store.get(id)`, `store.snapshot()` | Frozen live entries, one entry or null, or the entire registry. |
| `store.install(manifestOrJson)` | A validated installed/updated `{manifest, state}` entry, or a Promise of it when `persist` is configured. |
| `store.updateState(id, patch)` | A typed bounded update; unknown fields reject the whole patch. Async with `persist`. |
| `store.performAction(id, actionId, value?)` | Executes only one declared host-owned operation. Async with `persist`. |
| `store.remove(id)` | True when removed, false when absent. Async with `persist`. |
| `store.subscribe(listener)` | Returns an unsubscribe function. Listener receives the registry after a successful change. |
| `render(host, manifest, state, options)` | Renders accessible plain DOM and returns a disposer. Re-rendering the same host disposes its previous listeners and preserves focus in a matching control. |
| `catalog`, `limits` | Frozen bundled sample manifests and runtime limits. |

The renderer uses `.module-runtime-*` host classes and a validated `--module-accent` CSS variable. A presentation without `onAction` is a disabled preview. Host code owns error reporting: handle a thrown import or storage failure visibly, and keep the previous installed module usable. The runtime creates no timers, global listeners or network traffic.

## Verify before sharing

Validate with the runtime as well as the Draft 2020-12 schema. JSON Schema describes structure; runtime checks additionally verify unique IDs, references, type-compatible actions, default/bound relationships and progress semantics.

Test all three presentations, both languages, long/empty text, keyboard focus, numeric bounds, save/reload, upgrades, removal and failed imports. Keep reset actions out of a tiny rail when they would be too easy to press. The bundled Water break target is a personal counter, not a health recommendation or an automatic daily schedule.

Run the full repository suite before a contribution:

```sh
node --test tests/*.test.cjs
```

See [CONTRIBUTING.md](../CONTRIBUTING.md) for source review and [DEVELOPMENT.md](DEVELOPMENT.md) for application/native checks.

## Discover today, community store later

The current catalog is bundled with Notchy, and local JSON import works offline. It is **not a remote marketplace**: there are no third-party accounts, ratings, downloads, update server or automatic updates. Share a manifest as a reviewed JSON file or propose a bundled catalog entry in a pull request. A future hosted store needs publishing/review rules, provenance, revocation and update policy before it can make trust claims. Native or executable extensions need a separate security design rather than extra fields in this manifest.
