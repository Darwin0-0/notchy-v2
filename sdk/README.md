# Notchy Module Lab

A blank island for building and testing a real module. It uses the same dependency-free declarative runtime as Notchy, with no application services or private profile attached.

1. From the repository root, run `node sdk/serve.cjs`.
2. Open [the local lab](http://127.0.0.1:55607/sdk/).
3. Start with Reading or Water break, or import your own JSON file.
4. Test Full, Scene and Rail, English and French, real state updates and keyboard controls.
5. Export the manifest, then import that JSON in Notchy's module library and place it on Nook.

An optional port can be supplied, for example `node sdk/serve.cjs 55608`. The server binds only to `127.0.0.1` and serves a fixed allowlist of lab/runtime files. It does not expose the repository, arbitrary user files or a native API. Stop it with Ctrl+C.

Edit [starter.manifest.json](starter.manifest.json) for a reading tracker or [water.manifest.json](water.manifest.json) for a second example, then use Import JSON to load the edited file. The built-in sample buttons use the runtime's bundled templates. Your browser keeps development state under `notchy.module-lab.v2` and remembers the selected module under `notchy.module-lab.active`; Clear island removes all development modules and saved values. Importing the same ID retains compatible field values; use Clear island before importing if you want to test fresh defaults.

Validate without a browser:

```sh
node sdk/validate.cjs sdk/starter.manifest.json
node sdk/validate.cjs sdk/water.manifest.json
node --test tests/module-runtime.test.cjs
```

Read the [complete manifest contract](../docs/MODULES.md) and [JSON Schema](../docs/module-manifest.schema.json) before sharing a module. The host renders JSON data and fixed actions; importing custom JavaScript, HTML, CSS, URLs, permissions or executable packages is unsupported. The catalog is bundled, not an online marketplace.
