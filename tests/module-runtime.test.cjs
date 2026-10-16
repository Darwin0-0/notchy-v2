'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const modules = require('../module-runtime.js');
const copy = value => JSON.parse(JSON.stringify(value));
const reading = () => copy(modules.catalog[0]);
const memory = initial => {
  let value = initial ?? null;
  return { getItem: () => value, setItem: (_, next) => { value = next; }, saved: () => value };
};

function fixture() {
  const document = { activeElement: null };
  class Element {
    constructor(tag) { this.tagName = tag; this.ownerDocument = document; this.parentNode = null; this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = new Map(); this.style = { setProperty: (key, value) => { this.attributes[key] = value; } }; this.value = ''; this._text = ''; }
    set innerHTML(_) { throw new Error('Markup must never be inserted'); }
    set textContent(value) { this._text = String(value); this.replaceChildren(); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); } }
    replaceChildren(...nodes) { this.children.forEach(child => { child.parentNode = null; }); this.children = []; this.append(...nodes); }
    remove() { if (this.parentNode) { const parent = this.parentNode; parent.children.splice(parent.children.indexOf(this), 1); this.parentNode = null; } }
    addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
    removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== fn)); }
    emit(type) { const event = { preventDefault() { this.prevented = true; } }; for (const fn of this.listeners.get(type) || []) fn(event); return event; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    focus() { document.activeElement = this; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  }
  document.createElement = tag => new Element(tag);
  const host = document.createElement('div');
  function all(node = host) { return [node, ...node.children.flatMap(child => all(child))]; }
  return { document, host, all, find: predicate => all().find(predicate) };
}

test('browser and CommonJS expose the same frozen dependency-free runtime', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../module-runtime.js'), 'utf8'), { window });
  assert.equal(typeof window.NotchyModules.createStore, 'function');
  assert(Object.isFrozen(modules)); assert(Object.isFrozen(modules.catalog[0].fields[0].label));
  assert.equal(modules.limits.modules, 12); assert.equal(modules.limits.manifestBytes, 65536);
});

test('normalization owns immutable copies and does not mutate the imported JSON', () => {
  const source = reading(), original = JSON.stringify(source), validated = modules.validateManifest(source);
  source.name.en = 'Changed'; source.fields[0].default = 'changed';
  assert.equal(validated.name.en, 'Reading'); assert.equal(validated.fields[0].default, '');
  assert(Object.isFrozen(validated.presentations.rail.actions));
  assert.equal(JSON.stringify(modules.validateManifest(JSON.parse(original))), original);
});

test('rejects unknown properties, executable declarations, platform permissions and invalid identities', () => {
  for (const modify of [
    value => { value.entrypoint = 'evil.js'; }, value => { value.permissions = ['network']; },
    value => { value.appearance.css = 'body{}'; }, value => { value.fields[0].html = '<script>'; },
    value => { value.manifestVersion = 1; }, value => { value.id = 'music'; },
    value => { value.version = '1.2'; }, value => { value.appearance.accent = 'url(https://example.com)'; },
    value => { value.presentations.full.script = 'evil'; }, value => { value.fields[0].id = 'constructor'; },
  ]) {
    const value = reading(); modify(value); assert.throws(() => modules.validateManifest(value), /Module:/);
  }
  assert.throws(() => modules.parseManifest(JSON.stringify(reading()).replace('"name":', '"__proto__":{},"name":')), /unknown property/);
  const accessor = reading(); Object.defineProperty(accessor, 'name', { get() { throw new Error('should not execute'); } });
  assert.throws(() => modules.validateManifest(accessor), /accessors/);
});

test('action references and cross-field semantics are validated before install', () => {
  for (const modify of [
    value => { value.actions[0].field = 'absent'; }, value => { value.actions[0].field = 'title'; },
    value => { value.actions[0].type = 'shell'; }, value => { value.actions[0].amount = Infinity; },
    value => { value.actions[0].amount = 0; }, value => { value.actions.push(copy(value.actions[0])); },
    value => { value.presentations.rail.actions = ['absent']; }, value => { value.presentations.full.fields = ['absent']; },
    value => { value.progress.targetField = 'completed'; }, value => { value.fields[2].min = 0; },
    value => { value.fields[0].type = 'url'; }, value => { value.fields[1].min = value.fields[1].max; },
  ]) { const value = reading(); modify(value); assert.throws(() => modules.validateManifest(value), /Module:/); }
});

test('import byte cap is checked before parsing and applies to UTF-8 rather than code units', () => {
  assert.throws(() => modules.parseManifest(' '.repeat(65537)), /size limit/);
  assert.throws(() => modules.parseManifest('"' + '界'.repeat(22000) + '"'), /size limit/);
  assert.throws(() => modules.parseManifest('{'), /invalid JSON/);
  assert.equal(modules.parseManifest(JSON.stringify(reading())).id, 'community.reading');
});

test('install and host-owned actions produce persistent real progress and bounded text', () => {
  const storage = memory(), store = modules.createStore({ storage, key: 'test-library' });
  store.install(reading()); store.performAction('community.reading', 'advance');
  assert.equal(store.get('community.reading').state.completed, 1);
  store.updateState('community.reading', { completed: 999999 });
  assert.equal(store.get('community.reading').state.completed, 1000);
  store.performAction('community.reading', 'advance'); assert.equal(store.get('community.reading').state.completed, 1000);
  store.performAction('community.reading', 'rename', 'x'.repeat(200)); assert.equal(store.get('community.reading').state.title.length, 120);
  store.performAction('community.reading', 'reset'); assert.equal(store.get('community.reading').state.completed, 0);
  const restored = modules.createStore({ storage }); assert.equal(restored.get('community.reading').state.title.length, 120);
  assert.equal(JSON.parse(storage.saved()).registryVersion, 1);
});

test('boolean actions are typed and callers cannot write undeclared state or invalid values', () => {
  const value = reading(); value.fields.push({ id: 'finished', type: 'boolean', label: { en: 'Finished', fr: 'Terminé' }, default: false });
  value.actions.push({ id: 'finish', type: 'toggle', field: 'finished', label: { en: 'Toggle', fr: 'Basculer' } });
  const store = modules.createStore(); store.install(value); store.performAction(value.id, 'finish');
  assert.equal(store.get(value.id).state.finished, true);
  for (const patch of [{ completed: '2' }, { unknown: true }, { completed: NaN }, { finished: 1 }]) assert.throws(() => store.updateState(value.id, patch), /Module:/);
  assert.throws(() => store.performAction(value.id, 'absent'), /unknown action/);
  assert.throws(() => store.performAction(value.id, 'rename', 1), /requires text/);
});

test('upgrades preserve compatible state, clamp new bounds and remove fields rather than merging arbitrary old data', () => {
  const store = modules.createStore(); store.install(reading()); store.updateState('community.reading', { title: 'My book', completed: 80 });
  const next = reading(); next.version = '1.1.0'; next.fields[1].max = 10;
  next.fields[0] = { id: 'title', type: 'boolean', label: next.fields[0].label, default: false };
  next.actions = next.actions.filter(action => action.id !== 'rename');
  for (const presentation of Object.values(next.presentations)) presentation.actions = presentation.actions.filter(action => action !== 'rename');
  store.install(next);
  assert.equal(store.get(next.id).state.completed, 10); assert.equal(store.get(next.id).state.title, false);
  assert.throws(() => store.install(reading()), /newer module version/);
  const removed = copy(next); removed.version = '1.2.0'; removed.fields = removed.fields.filter(field => field.id !== 'title');
  for (const presentation of Object.values(removed.presentations)) presentation.fields = presentation.fields.filter(field => field !== 'title');
  store.install(removed); assert(!Object.hasOwn(store.get(next.id).state, 'title'));
});

test('malformed restoration is inert, drops corrupt entries and never rewrites stored bytes', () => {
  for (const initial of ['broken', '{"registryVersion":99,"modules":[]}', ' '.repeat(196609)]) {
    const storage = memory(initial), store = modules.createStore({ storage }); assert.equal(store.list().length, 0); assert.equal(storage.saved(), initial);
  }
  const manifest = reading(), restored = modules.validateRegistry({ registryVersion: 1, modules: [
    { manifest, state: { title: '<img onerror=alert(1)>', completed: -80, target: NaN, private: 'drop me' } },
    { manifest: { permissions: ['files'] }, state: {} }, { manifest, state: {} },
  ] });
  assert.equal(restored.modules.length, 1); assert.equal(restored.modules[0].state.completed, 0);
  assert.equal(restored.modules[0].state.target, 12); assert(!Object.hasOwn(restored.modules[0].state, 'private'));
  assert(Object.isFrozen(restored.modules[0].state));
});

test('storage errors are atomic and observers only see successfully saved changes', () => {
  let fail = false, observed = 0;
  const store = modules.createStore({ storage: { getItem: () => null, setItem() { if (fail) throw new Error('Quota exceeded'); } }, onChange: () => observed++ });
  store.install(reading()); const previous = store.snapshot(); fail = true;
  assert.throws(() => store.performAction('community.reading', 'advance'), /Quota/);
  assert.equal(store.snapshot(), previous); assert.equal(observed, 1);
  assert.throws(() => store.remove('community.reading'), /Quota/); assert.equal(store.list().length, 1);
});

test('optional native persistence waits for acknowledgement before local state, cache or observers change', async () => {
  const storage = memory(), pending = []; let changes = 0;
  const store = modules.createStore({ storage, persist: encoded => new Promise((resolve, reject) => pending.push({ encoded, resolve, reject })), onChange: () => changes++ });
  const manifest = reading(), installing = store.install(manifest); manifest.name.en = 'Changed after request';
  assert(installing instanceof Promise); await new Promise(setImmediate);
  assert.equal(store.list().length, 0); assert.equal(storage.saved(), null); assert.equal(changes, 0); assert.equal(pending.length, 1);
  assert.equal(JSON.parse(pending[0].encoded).modules[0].manifest.name.en, 'Reading');
  pending[0].resolve(); const installed = await installing;
  assert.equal(installed.state.completed, 0); assert.equal(store.list().length, 1); assert.equal(changes, 1);
  assert.equal(JSON.parse(storage.saved()).modules[0].manifest.id, 'community.reading');
});

test('a rejected native save leaves cache and registry untouched and does not poison later queued work', async () => {
  const storage = memory(), pending = [];
  const store = modules.createStore({ storage, persist: encoded => new Promise((resolve, reject) => pending.push({ encoded, resolve, reject })) });
  const initial = store.install(reading()); await new Promise(setImmediate); pending.shift().resolve(); await initial;
  const before = store.snapshot(), cached = storage.saved();
  const first = store.performAction('community.reading', 'advance'); const rejected = assert.rejects(first, /Disk full/);
  const second = store.performAction('community.reading', 'advance'); await new Promise(setImmediate);
  assert.equal(pending.length, 1); pending.shift().reject(new Error('Disk full')); await rejected;
  assert.equal(store.snapshot(), before); assert.equal(storage.saved(), cached);
  await new Promise(setImmediate); assert.equal(pending.length, 1);
  assert.equal(JSON.parse(pending[0].encoded).modules[0].state.completed, 1);
  pending.shift().resolve(); await second; assert.equal(store.get('community.reading').state.completed, 1);
});

test('racing asynchronous actions calculate from each preceding committed state and copy patch values', async () => {
  const persisted = [];
  const store = modules.createStore({ persist: async encoded => { await new Promise(setImmediate); persisted.push(JSON.parse(encoded)); } });
  const installing = store.install(reading());
  const first = store.performAction('community.reading', 'advance'), second = store.performAction('community.reading', 'advance');
  const patch = { title: 'My book' }, edit = store.updateState('community.reading', patch); patch.title = 'Changed after request';
  await Promise.all([installing, first, second, edit]);
  assert.deepEqual(persisted.map(value => value.modules[0].state.completed), [0, 1, 2, 2]);
  assert.equal(store.get('community.reading').state.completed, 2); assert.equal(store.get('community.reading').state.title, 'My book');
  assert.equal(await store.remove('missing'), false); assert.equal(await store.remove('community.reading'), true);
  assert.equal(store.list().length, 0); assert.equal(persisted.at(-1).modules.length, 0);
});

test('invalid async mutations reject as promises and the next valid request remains usable', async () => {
  const store = modules.createStore({ persist: async () => {} });
  await assert.rejects(store.install({}), /Module:/);
  await store.install(reading());
  await assert.rejects(store.updateState('community.reading', { completed: 'bad' }), /wrong type/);
  await assert.rejects(store.performAction('community.reading', 'unknown'), /unknown action/);
  await store.performAction('community.reading', 'advance'); assert.equal(store.get('community.reading').state.completed, 1);
});

test('installation and registry byte limits reject excess without losing installed modules', () => {
  const store = modules.createStore();
  for (let i = 0; i < 12; i++) { const value = reading(); value.id = 'community.sample-' + i; store.install(value); }
  const excess = reading(); excess.id = 'community.extra'; assert.throws(() => store.install(excess), /limit reached/); assert.equal(store.list().length, 12);
  const bulky = reading(); bulky.id = 'community.large'; delete bulky.progress; bulky.actions = [];
  bulky.fields = Array.from({ length: 8 }, (_, i) => ({ id: 'field-' + i, type: 'text', label: { en: 'Large field', fr: 'Grand champ' }, default: '界'.repeat(512), maxLength: 512 }));
  for (const presentation of Object.values(bulky.presentations)) { presentation.fields = bulky.fields.map(field => field.id); presentation.actions = []; }
  const bounded = modules.createStore(); let blocked = false;
  for (let i = 0; i < 12; i++) { bulky.id = 'community.large-' + i; try { bounded.install(bulky); } catch (error) { assert.match(error.message, /size limit/); blocked = true; break; } }
  assert(blocked); assert(bounded.list().length > 0); assert(Buffer.byteLength(JSON.stringify(bounded.snapshot())) <= 196608);
});

test('subscriptions are removable, stable snapshots are immutable and unknown removal is a no-op', () => {
  const store = modules.createStore(); let changes = 0;
  const unsubscribe = store.subscribe(() => { changes++; }); store.install(reading()); unsubscribe(); store.performAction('community.reading', 'advance');
  assert.equal(changes, 1); assert(Object.isFrozen(store.list())); assert(Object.isFrozen(store.get('community.reading').state));
  assert.equal(store.remove('absent'), false); assert.equal(store.remove('community.reading'), true); assert.equal(store.list().length, 0);
});

test('all three module presentations render text, meaningful progress and translated host controls', () => {
  const manifest = reading(), f = fixture(), state = modules.normalizeState(manifest, { title: '<img src=x onerror=alert(1)>', completed: 3, target: 12 });
  for (const presentation of ['full', 'scene', 'rail']) {
    const calls = []; const dispose = modules.render(f.host, manifest, state, { presentation, language: 'fr', onAction: (...args) => calls.push(args) });
    assert.equal(f.host.children[0].className, 'module-runtime module-runtime--' + presentation);
    assert(f.host.textContent.includes('Lecture')); assert(f.host.textContent.includes('3 / 12'));
    const progress = f.find(element => element.tagName === 'progress'); assert.equal(progress.value, 3); assert.equal(progress.max, 12);
    assert.equal(progress.attributes['aria-label'], 'Progression de lecture');
    const advance = f.find(element => element.dataset.moduleAction === 'advance'); advance.emit('click'); assert.deepEqual(calls, [['advance', undefined]]);
    if (presentation !== 'rail') assert(f.host.textContent.includes('<img src=x onerror=alert(1)>'));
    dispose(); advance.emit('click'); assert.equal(calls.length, 1); assert.equal(f.host.children.length, 0);
  }
});

test('text edits go only through host actions and rerender preserves focus without duplicated handlers', () => {
  const f = fixture(), store = modules.createStore(); store.install(reading());
  const draw = () => modules.render(f.host, store.get('community.reading').manifest, store.get('community.reading').state, { presentation: 'full', language: 'en', onAction: (action, value) => store.performAction('community.reading', action, value) });
  store.subscribe(draw); draw();
  const oldAdvance = f.find(element => element.dataset.moduleAction === 'advance'); oldAdvance.focus(); oldAdvance.emit('click');
  assert.equal(store.get('community.reading').state.completed, 1);
  assert.equal(f.document.activeElement.dataset.moduleAction, 'advance'); assert.notEqual(f.document.activeElement, oldAdvance);
  oldAdvance.emit('click'); assert.equal(store.get('community.reading').state.completed, 1);
  const input = f.find(element => element.dataset.moduleField === 'title'); input.value = 'A book';
  const event = input.parentNode.parentNode.emit('submit'); assert(event.prevented); assert.equal(store.get('community.reading').state.title, 'A book');
});

test('a preview without a host dispatcher is disabled and clamped progress never invents progress', () => {
  const f = fixture(); modules.render(f.host, reading(), { completed: 5000, target: 12 });
  assert(f.all().filter(element => element.tagName === 'button').every(element => element.disabled));
  assert.equal(f.find(element => element.tagName === 'progress').value, 12);
});

test('documented installable examples stay identical to the validated bundled catalog', () => {
  for (const [file, index] of [['docs/examples/module.manifest.json', 0], ['sdk/starter.manifest.json', 0], ['sdk/water.manifest.json', 1]]) {
    const content = fs.readFileSync(path.join(__dirname, '..', file), 'utf8'); assert.deepEqual(modules.parseManifest(content), modules.catalog[index]);
  }
});

test('development server exposes only the fixed host allowlist with no-store and a restrictive CSP', async () => {
  const handleRequest = require('../sdk/serve.cjs').handleRequest;
  const get = (resource, method = 'GET') => new Promise(resolve => {
    const headers = {}, response = { status: 0, setHeader(key, value) { headers[key.toLowerCase()] = value; }, writeHead(status, extra = {}) { this.status = status; for (const [key, value] of Object.entries(extra)) this.setHeader(key, value); }, end(body = '') { resolve({ status: this.status, headers, body: String(body) }); } };
    handleRequest({ url: resource, method }, response);
  });
    assert.equal((await get('/')).headers.location, '/sdk/');
    const host = await get('/sdk/'); assert.equal(host.status, 200); assert.match(host.body, /Your module belongs here/);
    assert.equal(host.headers['cache-control'], 'no-store'); assert.match(host.headers['content-security-policy'], /default-src 'none'/);
    assert.equal((await get('/module-runtime.js')).status, 200); assert.equal((await get('/sdk/starter.manifest.json')).status, 200);
    for (const resource of ['/.git/config', '/src-tauri/tauri.conf.json', '/sdk/serve.cjs', '/sdk/host.js/anything', '/%2e%2e/private.txt']) assert.equal((await get(resource)).status, 404);
    assert.equal((await get('/sdk/', 'POST')).status, 405); assert.equal((await get('/sdk/', 'HEAD')).body, '');
});
