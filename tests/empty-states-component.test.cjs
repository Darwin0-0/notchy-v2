const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const NotchEmpty = require('../empty-states.js');

function dom() {
  const document = {activeElement: null};
  class Element {
    constructor(tag, namespaceURI = 'http://www.w3.org/1999/xhtml') {
      this.nodeType = 1; this.localName = tag; this.namespaceURI = namespaceURI; this.ownerDocument = document;
      this.childNodes = []; this.parentNode = null; this.attributes = {}; this.listeners = new Map();
      this.className = ''; this.dataset = {}; this.hidden = false; this.disabled = false; this._text = ''; this.textWrites = 0;
      this.classList = {
        contains: name => this.className.split(/\s+/).includes(name),
        add: name => {if (!this.classList.contains(name)) this.className = [this.className, name].filter(Boolean).join(' ');},
        remove: name => {this.className = this.className.split(/\s+/).filter(item => item !== name).join(' ');},
      };
    }
    set innerHTML(_) {throw new Error('Markup insertion is forbidden.');}
    set textContent(value) {this.textWrites++; this._text = String(value); this.replaceChildren();}
    get textContent() {return this._text + this.childNodes.map(node => node.textContent).join('');}
    setAttribute(key, value) {this.attributes[key] = String(value);}
    getAttribute(key) {return this.attributes[key] ?? null;}
    removeAttribute(key) {delete this.attributes[key];}
    append(...nodes) {for (const node of nodes) {node.remove(); node.parentNode = this; this.childNodes.push(node);}}
    insertBefore(node, before) {node.remove(); node.parentNode = this; const index = this.childNodes.indexOf(before); this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, node);}
    get nextSibling() {return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] || null;}
    replaceChildren(...nodes) {for (const node of this.childNodes) node.parentNode = null; this.childNodes = []; this.append(...nodes);}
    remove() {if (this.parentNode) {this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1); this.parentNode = null;}}
    closest(tag) {return this.localName === tag ? this : this.parentNode?.closest(tag) || null;}
    contains(node) {return this === node || this.childNodes.some(child => child.contains(node));}
    addEventListener(name, fn) {this.listeners.set(name, fn);}
    removeEventListener(name, fn) {if (this.listeners.get(name) === fn) this.listeners.delete(name);}
    click(event = {type: 'click'}) {return this.listeners.get('click')?.(event);}
    focus() {document.activeElement = this;}
  }
  document.createElement = tag => new Element(tag);
  document.createElementNS = (namespace, tag) => new Element(tag, namespace);
  const host = document.createElement('section'); host.className = 'approved-module-empty';
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  return {document, host, icon};
}

test('browser and CommonJS expose the same small API without a DOM at import time', () => {
  const window = {document: {}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../empty-states.js'), 'utf8'), {window});
  assert.equal(typeof window.NotchEmpty.show, 'function');
  assert.deepEqual(Object.keys(NotchEmpty), ['show']);
});

test('renders one real action and passes the actual event without triggering it on show', () => {
  const {host, icon} = dom(), calls = [];
  const controller = NotchEmpty.show(host, {icon, title: 'Aucun appareil', hint: 'Même réseau Wi-Fi.', actionLabel: 'Rechercher', onAction: event => calls.push(event)});
  assert.equal(calls.length, 0); assert(host.classList.contains('approved-module-empty'));
  assert.equal(host.childNodes.filter(node => node.localName === 'button').length, 1);
  assert.equal(controller.elements.action.type, 'button'); assert.equal(controller.elements.icon.getAttribute('aria-hidden'), 'true');
  const event = {type: 'click', stopPropagation() {this.stopped = true;}};
  controller.update({onAction: received => {received.stopPropagation(); calls.push(received);}});
  controller.elements.action.click(event);
  assert.equal(calls.length, 1); assert.equal(calls[0], event); assert.equal(event.stopped, true);
});

test('rejects missing hosts and malformed option containers before mutating content', () => {
  const {host, document} = dom(), original = document.createElement('strong'); host.append(original);
  for (const value of [null, {}, 'section', 3]) assert.throws(() => NotchEmpty.show(value, {}), TypeError);
  for (const value of [null, [], 'title', 1]) assert.throws(() => NotchEmpty.show(host, value), TypeError);
  assert.deepEqual(host.childNodes, [original]);
});

test('does not nest an action button in a button host or its descendant', () => {
  const {document} = dom(), button = document.createElement('button'), child = document.createElement('span'); button.append(child);
  assert.throws(() => NotchEmpty.show(button, {}), TypeError);
  assert.throws(() => NotchEmpty.show(child, {}), TypeError);
  assert.equal(button.childNodes.length, 1); assert.equal(child.childNodes.length, 0);
});

test('user strings stay text and only a trusted SVG DOM node can become an icon', () => {
  const {host, document} = dom(), payload = '<img src=x onerror=alert(1)>';
  const controller = NotchEmpty.show(host, {icon: '<svg onload=alert(1)>', title: payload, hint: payload, actionLabel: payload, onAction() {}});
  assert.equal(controller.elements.title.textContent, payload); assert.equal(controller.elements.hint.textContent, payload);
  assert.equal(controller.elements.action.textContent, payload); assert.equal(controller.elements.icon.childNodes.length, 0);
  controller.update({icon: document.createElement('div'), title: {toString() {throw new Error('not text');}}});
  assert.equal(controller.elements.icon.childNodes.length, 0); assert.equal(controller.elements.title.hidden, true);
});

test('an SVG containing the host cannot be moved into its own descendant', () => {
  const {host, icon} = dom(); icon.append(host);
  const controller = NotchEmpty.show(host, {icon});
  assert.equal(controller.elements.icon.hidden, true); assert.equal(host.parentNode, icon);
  assert.equal(controller.elements.icon.childNodes.length, 0);
});

test('unchanged show/update preserves all nodes, focus, caller state and the original SVG', () => {
  const {host, icon, document} = dom(), initial = {icon, title: 'Vide', hint: 'Choisis un fichier.', actionLabel: 'Ajouter', onAction() {}};
  const controller = NotchEmpty.show(host, initial), nodes = [...host.childNodes];
  controller.elements.action.focus(); controller.elements.action.disabled = true; controller.elements.action.dataset.command = 'real-add';
  const writes = nodes.map(node => node.textWrites);
  assert.equal(NotchEmpty.show(host, initial), controller); assert.equal(controller.update({}), true);
  assert.deepEqual(host.childNodes, nodes); assert.deepEqual(nodes.map(node => node.textWrites), writes);
  assert.equal(document.activeElement, controller.elements.action); assert.equal(controller.elements.action.disabled, true);
  assert.equal(controller.elements.action.dataset.command, 'real-add'); assert.equal(controller.elements.icon.childNodes[0], icon);
});

test('changed text and callback update existing nodes and never replay an earlier action', () => {
  const {host} = dom(); let first = 0, second = 0;
  const controller = NotchEmpty.show(host, {title: 'Avant', actionLabel: 'Ajouter', onAction() {first++;}}), action = controller.elements.action;
  action.click(); controller.update({title: 'Après', onAction() {second++;}});
  assert.equal(first, 1); assert.equal(second, 0); assert.equal(controller.elements.action, action);
  action.click(); assert.equal(first, 1); assert.equal(second, 1); assert.equal(controller.elements.title.textContent, 'Après');
});

test('missing labels or callbacks hide and disable the sole action instead of offering a fake one', () => {
  const {host} = dom(); let calls = 0;
  const controller = NotchEmpty.show(host, {actionLabel: 'Réessayer'}), action = controller.elements.action;
  assert.equal(action.hidden, true); assert.equal(action.disabled, true);
  controller.update({onAction() {calls++;}}); assert.equal(action.hidden, false); action.click(); assert.equal(calls, 1);
  controller.update({actionLabel: '  '}); action.click(); assert.equal(calls, 1); assert.equal(action.hidden, true);
  controller.update({actionLabel: 'Réessayer', onAction: 'not a callback'}); assert.equal(action.disabled, true);
});

test('real Date and epoch timestamps produce an actual datetime while unchanged dates retain the node', () => {
  const {host} = dom(), date = new Date('2026-10-16T08:30:00.000Z');
  const controller = NotchEmpty.show(host, {since: date}), time = controller.elements.time;
  assert.equal(time.localName, 'time'); assert.equal(time.getAttribute('datetime'), date.toISOString()); assert.equal(time.hidden, false);
  const writes = time.textWrites; controller.update({since: date.getTime()}); assert.equal(time.textWrites, writes);
  controller.update({since: 0}); assert.equal(time.getAttribute('datetime'), '1970-01-01T00:00:00.000Z');
});

test('invalid timestamps clear the timestamp without substituting now or scheduling a timer', () => {
  const {host} = dom(), controller = NotchEmpty.show(host, {since: new Date('2026-10-16T08:30:00Z')});
  for (const since of [undefined, null, '2026-10-16', NaN, Infinity, new Date('invalid'), 9e20]) {
    controller.update({since}); assert.equal(controller.elements.time.hidden, true);
    assert.equal(controller.elements.time.getAttribute('datetime'), null); assert.equal(controller.elements.time.textContent, '');
  }
});

test('dispose removes its listener, restores original nodes, and an old controller cannot update a fresh mount', () => {
  const {host, document} = dom(), original = document.createElement('span'); original.dataset.retained = 'yes'; host.append(original);
  let calls = 0; const controller = NotchEmpty.show(host, {actionLabel: 'Ajouter', onAction() {calls++;}}), action = controller.elements.action;
  assert.equal(controller.dispose(), true); assert.equal(controller.dispose(), false); action.click(); assert.equal(calls, 0);
  assert.equal(controller.update({title: 'Stale'}), false); assert.deepEqual(host.childNodes, [original]);
  assert.equal(original.dataset.retained, 'yes'); assert.equal(host.className, 'approved-module-empty');
  const fresh = NotchEmpty.show(host, {title: 'Fresh'}); assert.notEqual(fresh, controller);
  controller.dispose(); assert.equal(fresh.elements.title.textContent, 'Fresh');
});

test('dispose preserves replacement content supplied by a newer host owner', () => {
  const {host, document} = dom(), controller = NotchEmpty.show(host, {title: 'Old empty state'}), replacement = document.createElement('input');
  replacement.value = 'User input'; host.replaceChildren(replacement); controller.dispose();
  assert.deepEqual(host.childNodes, [replacement]); assert.equal(replacement.value, 'User input');
});

test('disposing a borrowed icon restores the original wrapper and sibling order', () => {
  const {host, document, icon} = dom(), wrapper = document.createElement('span'), label = document.createElement('span');
  wrapper.append(icon, label); host.append(wrapper);
  const controller = NotchEmpty.show(host, {icon, title: 'Vide'});
  assert.equal(controller.elements.icon.childNodes[0], icon); controller.update({icon: null}); controller.dispose();
  assert.deepEqual(host.childNodes, [wrapper]); assert.deepEqual(wrapper.childNodes, [icon, label]);
});
