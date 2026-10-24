'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const preview = require('../rendered-preview.js'), {fixture: domFixture} = require('./helpers/experience-dom.cjs');
const token = '0123456789abcdef0123456789abcdef', first = '/rendered-preview/' + token, second = '/rendered-preview/' + 'b'.repeat(32);

function eventTarget(value) {
  const listeners = new Map();
  value.addEventListener = (name, callback, capture) => listeners.set(name, [...listeners.get(name) || [], {callback, capture}]);
  value.removeEventListener = (name, callback, capture) => listeners.set(name, (listeners.get(name) || []).filter(item => item.callback !== callback || item.capture !== capture));
  value.emit = (name, extra = {}) => {
    const event = {type: name, preventDefault() {this.defaultPrevented = true;}, stopPropagation() {this.stopped = true;}, stopImmediatePropagation() {this.immediateStopped = true;}, ...extra};
    for (const {callback} of [...listeners.get(name) || []]) callback(event); return event;
  };
  value.listenerCount = () => [...listeners.values()].reduce((total, list) => total + list.length, 0);
  value.captureFor = name => (listeners.get(name) || []).map(item => item.capture);
  return value;
}
function fixture(options = {}) {
  const base = domFixture(), document = eventTarget(base.document), window = eventTarget({location: {origin: options.origin || 'http://127.0.0.1:58252'}});
  document.defaultView = window;
  const createElement = document.createElement;
  document.createElement = tag => {const node = createElement(tag); if (tag === 'iframe') node.contentWindow = {}; return node;};
  const host = document.createElement('section'), original = document.createElement('p'); original.textContent = 'Existing panel'; host.append(original); document.body.append(host);
  const closed = [], navigated = [], controller = preview.create({host, onClose: owner => closed.push(owner), onNavigate: (...args) => navigated.push(args), ...options});
  const overlay = () => host.querySelector('.rendered-preview'), frame = () => host.querySelector('[data-rendered-preview-frame]'), control = action => host.querySelector('[data-rendered-preview-action="' + action + '"]');
  const show = (url = first, owner = 'search', name = 'rapport.html') => controller.show({name, url}, owner);
  const key = (name, target = control('close'), extra = {}) => document.emit('keydown', {key: name, target, ...extra});
  const message = (data, source = frame()?.contentWindow, origin = 'null') => window.emit('message', {data, source, origin});
  const click = action => {const event = {target: control(action), preventDefault() {this.defaultPrevented = true;}, stopPropagation() {this.stopped = true;}}; host.querySelector('.rendered-preview-controls').listeners.click(event); return event;};
  return {...base, document, window, host, original, closed, navigated, controller, overlay, frame, control, show, key, message, click};
}

test('rendered preview exposes the same dependency-free browser and Node contract', () => {
  const window = {document: {}}; vm.runInNewContext(fs.readFileSync(require.resolve('../rendered-preview.js'), 'utf8'), {window});
  assert.equal(typeof window.NotchyRenderedPreview.create, 'function'); assert(Object.isFrozen(preview));
});

test('opaque preview route is same-origin, sandboxed, and never replaces the existing panel', () => {
  const f = fixture(); assert.equal(f.controller.isOpen(), false); assert.equal(f.show(), true);
  assert.equal(f.original.parentElement, f.host); assert.equal(f.overlay().hidden, false); assert.equal(f.frame().attributes.src, first);
  assert.equal(f.frame().attributes.sandbox, 'allow-scripts'); assert.equal(f.frame().attributes.referrerpolicy, 'no-referrer');
  for (const permission of ['camera', 'microphone', 'geolocation', 'clipboard-read', 'clipboard-write']) assert(f.frame().attributes.allow.includes(permission + " 'none'"));
  assert.equal(f.frame().attributes.srcdoc, undefined); assert.equal(f.document.activeElement, f.control('close'));
  assert.equal(f.controller.inspect().status, 'loading'); f.frame().listeners.load(); assert.equal(f.controller.inspect().status, 'ready');
  f.controller.dispose();
});

test('invalid routes and owners are rejected before replacing a valid current preview', () => {
  const f = fixture(); f.show(); const frame = f.frame(), before = f.controller.inspect();
  for (const url of ['https://example.test' + first, '//example.test' + first, first + '?x=1', first + '#x', first + '/', first + '\n', '/rendered-preview/../' + token, '/rendered-preview/' + token.slice(1), '/rendered-preview/' + token + 'a', '/rendered-preview/' + 'g'.repeat(32), 'javascript:alert(1)', 'file:///C:/secret.html', '/rendered-preview/%2f' + token, 'data:text/html,test']) {
    assert.throws(() => f.show(url), TypeError, url); assert.equal(f.frame(), frame); assert.deepEqual(f.controller.inspect(), before);
  }
  for (const owner of ['', ' ', null, {}, 1]) assert.throws(() => f.show(first, owner), TypeError);
  assert.throws(() => f.controller.show({url: first}, 'search'), TypeError); f.controller.dispose();
  const opaque = fixture({origin: 'null'}); assert.throws(() => opaque.show(), TypeError); assert.equal(opaque.controller.isOpen(), false); opaque.controller.dispose();
});

test('filename markup stays literal, and owner-aware hide cannot close the other source', () => {
  const f = fixture(), filename = '<img src=x onerror=alert(1)>.html'; f.show(first, 'search', filename);
  const title = f.host.querySelector('.rendered-preview-title'); assert.equal(title.textContent, filename); assert.equal(title.children.length, 0);
  assert.equal(f.frame().attributes.title, 'Aperçu de ' + filename); assert.equal(f.controller.isOpen('search'), true); assert.equal(f.controller.isOpen('shelf'), false);
  const old = f.frame(); f.show(second, 'shelf', 'book.xlsx'); assert.equal(old.attributes.src, 'about:blank'); assert.equal(old.parentElement, null);
  assert.equal(f.controller.hide('search'), false); assert.equal(f.controller.isOpen('shelf'), true); assert.equal(f.controller.hide('shelf'), true); assert.equal(f.frame(), null); assert.equal(f.controller.inspect().url, null); assert.deepEqual(f.closed, []);
  f.controller.dispose();
});

test('old frame loads and errors cannot overwrite the current generation or survive hide', () => {
  const f = fixture(); f.show(); const old = f.frame(), load = old.listeners.load, error = old.listeners.error;
  f.show(second, 'shelf'); load(); error(); assert.equal(f.controller.inspect().status, 'loading');
  assert.equal(old.listeners.load, undefined); assert.equal(old.listeners.error, undefined); f.frame().listeners.error(); assert.equal(f.controller.inspect().status, 'error');
  const currentLoad = f.frame().listeners.load; f.controller.hide(); currentLoad(); assert.equal(f.controller.inspect().status, 'closed'); assert.equal(f.overlay().hidden, true); f.controller.dispose();
});

test('only the current opaque iframe may send the exact two-field Escape message', () => {
  const f = fixture(); f.show(); const oldWindow = f.frame().contentWindow; f.show(second, 'shelf');
  const escape = {type: 'notchy-preview-key', key: 'Escape'};
  f.message(escape, oldWindow); f.message(escape, {}, 'null'); f.message(escape, f.frame().contentWindow, 'http://127.0.0.1:58252');
  for (const data of [null, [], 'Escape', {key: 'Escape'}, {type: 'notchy-preview-key', key: 'ArrowRight'}, {...escape, owner: 'shelf'}, {...escape, invoke: 'desktop_command'}, {...escape, [Symbol('extra')]: true}]) f.message(data);
  let getter = false; f.message({get type() {getter = true; return 'notchy-preview-key';}, key: 'Escape'}); assert.equal(getter, false);
  assert.equal(f.controller.isOpen(), true); assert.deepEqual(f.closed, []); assert.deepEqual(f.navigated, []);
  f.message(escape); assert.equal(f.controller.isOpen(), false); assert.deepEqual(f.closed, ['shelf']); f.message(escape, oldWindow); assert.deepEqual(f.closed, ['shelf']); f.controller.dispose();
});

test('document readiness reveals content before slow nested frames finish loading', () => {
  const f = fixture(); f.show(); const oldWindow = f.frame().contentWindow; f.show(second, 'shelf');
  const ready = {type: 'notchy-preview-ready'};
  f.message(ready, oldWindow); f.message(ready, {}, 'null'); f.message(ready, f.frame().contentWindow, 'http://127.0.0.1:58252');
  for (const data of [{...ready, key: 'Escape'}, {...ready, invoke: 'desktop_command'}, {...ready, [Symbol('extra')]: true}]) f.message(data);
  let getter = false; f.message({get type() {getter = true; return 'notchy-preview-ready';}}); assert.equal(getter, false);
  assert.equal(f.controller.inspect().status, 'loading');
  f.message(ready);
  assert.equal(f.controller.inspect().status, 'ready'); assert.equal(f.overlay().attributes['aria-busy'], 'false');
  assert.equal(f.host.querySelector('.rendered-preview-status').hidden, true);
  assert.equal(f.controller.isOpen('shelf'), true); assert.deepEqual(f.closed, []); assert.deepEqual(f.navigated, []);
  f.frame().listeners.error(); f.message(ready); assert.equal(f.controller.inspect().status, 'error');
  f.controller.hide(); f.message(ready, oldWindow); assert.equal(f.controller.inspect().status, 'closed'); f.controller.dispose();
});

test('toolbar and parent keys navigate by owner without intercepting text fields or internal app arrows', () => {
  const f = fixture(); f.show(); assert.deepEqual(f.document.captureFor('keydown'), [true]);
  f.click('previous'); f.click('next'); assert.deepEqual(f.navigated, [[-1, 'search'], [1, 'search']]);
  const handled = f.key('ArrowRight'); assert.equal(handled.defaultPrevented, true); f.overlay().listeners.keydown(handled); assert.equal(f.navigated.length, 3, 'capture and local listeners must not handle the same event twice');
  for (const tag of ['input', 'textarea', 'select']) {const node = f.document.createElement(tag); f.overlay().append(node); assert.equal(f.key('ArrowLeft', node).defaultPrevented, undefined);}
  const editable = f.document.createElement('div'), text = f.document.createElement('span'); editable.setAttribute('contenteditable', 'true'); editable.append(text); f.overlay().append(editable); assert.equal(f.key('ArrowLeft', text).defaultPrevented, undefined);
  const appControl = f.document.createElement('button'); f.host.append(appControl); assert.equal(f.key('ArrowRight', appControl).defaultPrevented, undefined);
  for (const extra of [{ctrlKey: true}, {altKey: true}, {metaKey: true}, {shiftKey: true}, {isComposing: true}]) assert.equal(f.key('ArrowRight', f.control('close'), extra).defaultPrevented, undefined);
  assert.equal(f.navigated.length, 3); const escape = f.key('Escape', appControl); assert.equal(escape.defaultPrevented, true); assert.equal(escape.immediateStopped, true); assert.deepEqual(f.closed, ['search']); f.controller.dispose();
});

test('close and disposal clear iframe URL and every listener, with repeat-safe lifecycle', () => {
  const f = fixture(); f.show(); const old = f.frame(); f.click('close'); assert.equal(old.attributes.src, 'about:blank'); assert.equal(old.parentElement, null); assert.deepEqual(f.closed, ['search']);
  f.show(second, 'shelf'); const load = f.frame().listeners.load; assert.equal(f.controller.dispose(), true); assert.equal(f.controller.dispose(), false); assert.equal(f.window.listenerCount(), 0); assert.equal(f.document.listenerCount(), 0); assert.equal(f.host.children.length, 1); assert.equal(f.host.children[0], f.original); assert.equal(f.controller.show({name: 'ignored', url: first}, 'search'), false); load(); assert.equal(f.controller.inspect().open, false);
});
