'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {setTimeout: delay} = require('node:timers/promises');
const search = require('../search.js');
const hit = (id, name = 'rapport.pdf', kind = 'file') => ({id, name, path: 'C:\\Documents\\' + name, kind});
const response = hits => ({hits, files: 42, indexing: false, updatedAt: 10, lastError: null});
const deferred = () => {let resolve, reject; const promise = new Promise((ok, fail) => {resolve = ok; reject = fail;}); return {promise, resolve, reject};};

function fixture(invoke, language = 'fr', options = {}) {
  const document = {activeElement: null, documentElement: {lang: language}};
  class Element {
    constructor(name) {this.nodeType = 1; this.localName = name; this.ownerDocument = document; this.parentNode = null; this.childNodes = []; this.attributes = {}; this.dataset = {}; this.listeners = new Map(); this.className = ''; this.hidden = false; this.disabled = false; this.value = ''; this._text = ''; this.isConnected = true; this.style = {};}
    get children() {return this.childNodes;}
    get classList() {return {contains: name => this.className.split(/\s+/).includes(name), add: name => {this.className += ' ' + name;}, remove: name => {this.className = this.className.split(/\s+/).filter(item => item !== name).join(' ');}};}
    set innerHTML(_) {throw new Error('Untrusted markup insertion');}
    set textContent(value) {this._text = String(value); this.replaceChildren();}
    get textContent() {return this._text + this.childNodes.map(child => child.textContent).join('');}
    setAttribute(name, value) {this.attributes[name] = String(value);}
    getAttribute(name) {return this.attributes[name] ?? null;}
    removeAttribute(name) {delete this.attributes[name];}
    append(...nodes) {for (const node of nodes) {node.remove(); node.parentNode = this; this.childNodes.push(node);}}
    replaceChildren(...nodes) {for (const child of this.childNodes) child.parentNode = null; this.childNodes = []; this.append(...nodes);}
    remove() {if (this.parentNode) {const parent = this.parentNode; parent.childNodes.splice(parent.childNodes.indexOf(this), 1); this.parentNode = null;}}
    addEventListener(name, fn) {this.listeners.set(name, [...(this.listeners.get(name) || []), fn]);}
    removeEventListener(name, fn) {this.listeners.set(name, (this.listeners.get(name) || []).filter(item => item !== fn));}
    emit(name, detail = {}) {const event = {target: this, preventDefault() {this.prevented = true;}, stopImmediatePropagation() {this.stopped = true;}, ...detail}; for (const fn of this.listeners.get(name) || []) fn(event); return event;}
    focus() {document.activeElement = this;}
    scrollIntoView() {this.scrolled = true;}
    getBoundingClientRect() {return this.className.includes('search-context-menu') ? {left:0,top:0,width:224,height:116,bottom:116} : {left:16,top:16,width:562,height:224,bottom:240};}
    contains(node) {return this === node || this.childNodes.some(child => child.contains(node));}
    closest(selector) {return selector === '[data-result-id]' && this.dataset.resultId ? this : this.parentNode?.closest(selector) || null;}
  }
  document.createElement = name => new Element(name); document.createElementNS = (_, name) => new Element(name);
  const documentEvents = new Element('document'); document.addEventListener = documentEvents.addEventListener.bind(documentEvents); document.removeEventListener = documentEvents.removeEventListener.bind(documentEvents); document.emit = documentEvents.emit.bind(documentEvents);
  const host = document.createElement('section'), original = document.createElement('strong'), opener = document.createElement('button');
  host.className = 'approved-search-host'; host.setAttribute('aria-label', 'Original'); host.append(original); opener.focus();
  const calls = [];
  const controller = search.create({host, invoke: async (name, args) => {calls.push({name, args}); return name === 'search_status' ? options.status?.() || {files: 42, indexing: false} : invoke?.(name, args);}, ...options});
  const type = async value => {controller.elements.input.value = value; controller.elements.input.emit('input'); await delay(search.CONFIG.debounce + 15);};
  const key = (name, options = {}) => host.emit('keydown', {target: controller.elements.input, key: name, ...options});
  return {document, host, controller, calls, type, key, opener, original};
}

test('browser/CommonJS share a dependency-free component and named controls', () => {
  const window = {document: {}}; vm.runInNewContext(fs.readFileSync(require.resolve('../search.js'), 'utf8'), {window});
  assert.equal(typeof window.NotchySearch.create, 'function'); assert(Object.isFrozen(search.CONFIG));
  assert.equal(search.CONFIG.debounce, 80); assert.equal(search.CONFIG.limit, 8);
});

test('result normalization keeps opaque IDs, rejects malformed rows and caps eight unique hits', () => {
  const values = [null, {}, hit('', 'bad'), {...hit('bad'), path: null}, hit('one'), hit('one'), hit('folder', 'docs', 'dir'), ...Array.from({length: 12}, (_, i) => hit(String(i)))];
  const hits = search.normalizeHits(values); assert.equal(hits.length, 8); assert.equal(hits[0].id, 'one'); assert.equal(hits[1].kind, 'folder');
  assert.deepEqual(search.normalizeHits(null), []);
});

test('substring highlighting is case-insensitive and preserves markup as literal text', () => {
  assert.deepEqual(search.highlightParts('Rapport PORT.pdf', 'port'), [{text: 'Rap', matched: false}, {text: 'port', matched: true}, {text: ' ', matched: false}, {text: 'PORT', matched: true}, {text: '.pdf', matched: false}]);
  const text = '<img src=x onerror=alert(1)>'; assert.equal(search.highlightParts(text, '<img').map(part => part.text).join(''), text);
  assert.deepEqual(search.highlightParts('İrapport[1].pdf', 'port[1]'), [{text: 'İrap', matched: false}, {text: 'port[1]', matched: true}, {text: '.pdf', matched: false}]);
});

test('opening focuses the combobox, waits for two characters, and Escape restores the opener', async () => {
  let closed = 0; const f = fixture(undefined, 'en', {onClose: () => closed++});
  try {
    f.controller.open(); await delay(0); assert.equal(f.document.activeElement, f.controller.elements.input); assert.equal(f.host.hidden, false);
    await f.type('r'); assert.equal(f.calls.filter(call => call.name === 'search_query').length, 0); assert.match(f.controller.elements.empty.textContent, /Type at least two/);
    const event = f.key('Escape'); assert.equal(event.prevented, true); assert.equal(event.stopped, true); assert.equal(f.controller.isOpen(), false); assert.equal(f.document.activeElement, f.opener); assert.equal(closed, 1);
  } finally {f.controller.dispose();}
});

test('English search templates survive an untranslated host formatter before counts are inserted', async () => {
  let status = {files:42, indexing:false};
  const f = fixture(name => name === 'search_query' ? {...response([hit('one'), hit('two')]), ...status} : {}, 'en', {
    t: (key, values = {}) => key.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? values[name] : match),
    status: () => status,
  });
  try {
    f.controller.open(); await delay(0);
    assert.equal(f.controller.elements.information.textContent, '42 indexed items');
    await f.type('pdf'); assert.equal(f.controller.elements.announcer.textContent, '2 results');
    status = {files:42, indexing:true}; f.controller.refresh(); await delay(0);
    assert.equal(f.controller.elements.information.textContent, 'Indexing 42 items…');
    f.document.documentElement.lang = 'fr'; f.controller.render();
    assert.equal(f.controller.elements.information.textContent, 'Indexation de 42 éléments…');
  } finally {f.controller.dispose();}
});

test('latest query wins and clearing input invalidates already-running queries', async () => {
  const old = deferred(), next = deferred(); const f = fixture((name, args) => args.q === 'old' ? old.promise : next.promise);
  try {
    f.controller.open(); await f.type('old'); await f.type('new'); next.resolve(response([hit('new', 'new.pdf')])); await delay(0);
    assert.equal(f.controller.elements.list.children[0].dataset.resultId, 'new'); old.resolve(response([hit('old')])); await delay(0);
    assert.equal(f.controller.elements.list.children[0].dataset.resultId, 'new');
    f.controller.elements.clear.emit('click'); assert.equal(f.controller.elements.list.children.length, 0); assert.equal(f.controller.elements.input.getAttribute('aria-activedescendant'), null);
  } finally {f.controller.dispose();}
});

test('closing cancels pending display work without reopening or overwriting the return route', async () => {
  const result = deferred(); const f = fixture(() => result.promise);
  try {
    f.controller.open(); await f.type('rap'); f.controller.close(); result.resolve(response([hit('one')])); await delay(0);
    assert.equal(f.host.hidden, true); assert.equal(f.controller.elements.list.children.length, 0); assert.equal(f.controller.isOpen(), false);
  } finally {f.controller.dispose();}
});

test('keyboard navigation uses active descendant and sends only the selected opaque ID to reveal', async () => {
  const f = fixture(name => name === 'search_query' ? response([hit('one'), hit('two', 'second.pdf')]) : {});
  try {
    f.controller.open(); await f.type('pdf'); assert.equal(f.controller.elements.input.getAttribute('aria-expanded'), 'true');
    f.key('ArrowDown'); const row = f.controller.elements.list.children[1]; assert.equal(row.getAttribute('aria-selected'), 'true'); assert.equal(f.controller.elements.input.getAttribute('aria-activedescendant'), row.id);
    f.key('Enter', {ctrlKey: true}); await delay(0);
    const action = f.calls.find(call => call.name === 'search_reveal'); assert.deepEqual(action.args, {id: 'two'}); assert.equal(f.controller.isOpen(), false);
  } finally {f.controller.dispose();}
});

test('malicious result names and paths stay text; a real result click opens once', async () => {
  const payload = '<img src=x onerror=alert(1)>.txt', f = fixture(name => name === 'search_query' ? response([hit('opaque', payload)]) : {});
  try {
    f.controller.open(); await f.type('img'); const row = f.controller.elements.list.children[0]; assert(row.textContent.includes(payload)); assert.equal(row.localName, 'button');
    f.controller.elements.list.emit('click', {target: row}); await delay(0); assert.deepEqual(f.calls.find(call => call.name === 'search_open').args, {id: 'opaque'});
  } finally {f.controller.dispose();}
});

test('failed opens retain the result and show a localized visible error rather than silently closing', async () => {
  const f = fixture(name => {if (name === 'search_query') return response([hit('gone')]); throw new Error('C:\\private\\secret');}, 'en');
  try {
    f.controller.open(); await f.type('rap'); f.controller.elements.open.focus(); f.controller.elements.open.emit('click'); await delay(0);
    assert.equal(f.controller.isOpen(), true); assert.equal(f.controller.elements.information.textContent, 'This item could not be opened.');
    assert(!f.host.textContent.includes('secret')); assert.equal(f.controller.elements.open.disabled, false);
    assert.equal(f.document.activeElement, f.controller.elements.input);
  } finally {f.controller.dispose();}
});

test('LocalSend is optional, unavailable for folders, and receives an opaque ID for files', async () => {
  const sent = [], f = fixture(name => name === 'search_query' ? response([hit('folder', 'docs', 'folder'), hit('file')]) : {}, 'fr', {onSend: id => sent.push(id)});
  try {
    f.controller.open(); await f.type('rap'); assert.equal(f.controller.elements.send.hidden, true); f.key('ArrowDown'); assert.equal(f.controller.elements.send.hidden, false);
    f.controller.elements.send.emit('click'); await delay(0); assert.deepEqual(sent, ['file']); assert.equal(f.controller.isOpen(), false);
  } finally {f.controller.dispose();}
});

test('right click selects exactly that result and keeps menu actions stable while the pointer moves', async () => {
  const f = fixture(name => name === 'search_query' ? response([hit('one'), hit('two')]) : {});
  try {
    f.controller.open(); await f.type('pdf'); const {list, contextMenu, more} = f.controller.elements, row = list.children[1];
    const event = list.emit('contextmenu', {target: row, clientX: 570, clientY: 235});
    assert.equal(event.prevented, true); assert.equal(event.stopped, true); assert.equal(contextMenu.hidden, false);
    assert.equal(row.getAttribute('aria-selected'), 'true'); assert.equal(more.getAttribute('aria-expanded'), 'true');
    assert.equal(contextMenu.style.left, '330px'); assert.equal(contextMenu.style.top, '100px');
    assert.equal(f.document.activeElement, contextMenu.children[0]);
    list.emit('pointermove', {target: list.children[0]}); assert.equal(row.getAttribute('aria-selected'), 'true');
    assert.equal(f.calls.filter(call => call.name === 'search_open').length, 0);
    contextMenu.children[1].emit('click'); await delay(0);
    assert.deepEqual(f.calls.find(call => call.name === 'search_reveal').args, {id:'two'});
    assert.equal(f.calls.filter(call => call.name === 'search_open').length, 0);
  } finally {f.controller.dispose();}
});

test('the visible action button and keyboard context shortcut expose localized menus without closing search', async () => {
  const f = fixture(name => name === 'search_query' ? response([hit('one')]) : {}, 'en');
  try {
    f.controller.open(); await f.type('pdf'); const {more, contextMenu, input} = f.controller.elements;
    assert.equal(more.getAttribute('aria-label'), 'More actions'); more.focus(); more.emit('click');
    assert.equal(contextMenu.getAttribute('aria-label'), 'Actions for rapport.pdf'); assert.equal(contextMenu.children[0].textContent, 'Open');
    f.host.emit('keydown', {target:f.document.activeElement, key:'End'}); assert.equal(f.document.activeElement, contextMenu.children[1]);
    f.host.emit('keydown', {target:f.document.activeElement, key:'ArrowDown'}); assert.equal(f.document.activeElement, contextMenu.children[0]);
    f.host.emit('keydown', {target:f.document.activeElement, key:'Escape'});
    assert.equal(contextMenu.hidden, true); assert.equal(f.controller.isOpen(), true); assert.equal(f.document.activeElement, more);
    input.focus(); const event = f.key('F10', {shiftKey:true}); assert.equal(event.prevented, true); assert.equal(contextMenu.hidden, false);
    f.host.emit('keydown', {target:f.document.activeElement, key:'Tab'}); assert.equal(f.document.activeElement, input); assert.equal(contextMenu.hidden, true);
    f.key('ContextMenu'); assert.equal(contextMenu.hidden, false);
    f.document.documentElement.lang = 'fr'; f.controller.render(); assert.equal(contextMenu.children[0].textContent, 'Ouvrir'); assert.equal(contextMenu.hidden, false);
  } finally {f.controller.dispose();}
});

test('outside pointer, new query, and close dismiss stale menus without running actions', async () => {
  const f = fixture(name => name === 'search_query' ? response([hit('one')]) : {});
  try {
    f.controller.open(); await f.type('pdf'); const {more, contextMenu, input} = f.controller.elements;
    more.emit('click'); f.document.emit('pointerdown', {target:f.opener}); assert.equal(contextMenu.hidden, true); assert.equal(f.controller.isOpen(), true);
    more.emit('click'); f.controller.refresh(); await delay(0); assert.equal(contextMenu.hidden, true); assert.equal(f.document.activeElement, input);
    more.emit('click'); input.value = 'other'; input.emit('input'); assert.equal(contextMenu.hidden, true);
    await delay(search.CONFIG.debounce + 15); more.emit('click'); f.controller.close(); assert.equal(contextMenu.hidden, true);
    assert.equal(f.calls.filter(call => ['search_open','search_reveal','search_stage'].includes(call.name)).length, 0);
  } finally {f.controller.dispose();}
});

test('context menus keep folders non-sendable and only share the selected opaque file ID', async () => {
  const sent = [], f = fixture(name => name === 'search_query' ? response([hit('folder','Docs','folder'), hit('file')]) : {}, 'fr', {onSend:id => sent.push(id)});
  try {
    f.controller.open(); await f.type('pdf'); const {list, contextMenu} = f.controller.elements;
    list.emit('contextmenu', {target:list.children[0], clientX:40, clientY:90}); assert.equal(contextMenu.children[2].hidden, true);
    contextMenu.children[2].emit('click'); await delay(0); assert.deepEqual(sent, []);
    list.emit('contextmenu', {target:list.children[1], clientX:40, clientY:130}); assert.equal(contextMenu.children[2].hidden, false);
    contextMenu.children[2].emit('click'); await delay(0); assert.deepEqual(sent, ['file']); assert.equal(f.controller.isOpen(), false);
  } finally {f.controller.dispose();}
});

test('unsupported and active formats are reveal-only including their default keyboard action', async () => {
  const native = fs.readFileSync(require.resolve('../src-tauri/src/search.rs'), 'utf8');
  const formats = native.match(/const OPENABLE_FORMATS: &str = "([^"]+)"/)[1].split(' ');
  for (const format of formats) assert.equal(search.canOpen(hit('one','report.' + format.toUpperCase())), true, format);
  for (const name of ['script.ps1','shortcut.lnk','app.exe','unknown','unknown.notchy']) assert.equal(search.canOpen(hit('one', name)), false, name);
  assert.equal(search.canOpen(hit('folder', 'folder.exe', 'folder')), true);
  const f = fixture(name => name === 'search_query' ? response([hit('one','script.ps1')]) : {});
  try {
    f.controller.open(); await f.type('script'); const {contextMenu, more, open} = f.controller.elements;
    assert.equal(open.hidden, true); more.emit('click'); assert.equal(contextMenu.children[0].hidden, true); assert.equal(f.document.activeElement, contextMenu.children[1]);
    f.host.emit('keydown', {target:f.document.activeElement, key:'Escape'}); f.controller.elements.input.focus(); f.key('Enter'); await delay(0);
    assert.deepEqual(f.calls.find(call => call.name === 'search_reveal').args, {id:'one'}); assert.equal(f.calls.some(call => call.name === 'search_open'), false);
  } finally {f.controller.dispose();}
});

test('composition invalidates old results and waits for completed text before querying', async () => {
  const f = fixture(name => name === 'search_query' ? response([hit('one')]) : {});
  try {
    f.controller.open(); await f.type('rap'); const count = f.calls.length;
    f.controller.elements.input.emit('compositionstart'); f.controller.elements.input.value = 'rapport'; f.controller.elements.input.emit('input'); await delay(search.CONFIG.debounce + 10);
    assert.equal(f.calls.length, count); assert.equal(f.controller.elements.list.children.length, 0);
    f.controller.elements.input.emit('compositionend'); await delay(search.CONFIG.debounce + 10); assert.equal(f.calls.length, count + 1);
  } finally {f.controller.dispose();}
});

test('query failures and malformed replies expose retry and never render stale results', async () => {
  const f = fixture(() => ({hits: null}));
  try {f.controller.open(); await f.type('rap'); assert.equal(f.controller.elements.list.children.length, 0); assert.match(f.controller.elements.empty.textContent, /indisponible/); assert.equal(f.controller.elements.empty.children.at(-1).localName, 'button');}
  finally {f.controller.dispose();}
});

test('a query that starts indexing also schedules status refresh and replaces partial results when ready', async () => {
  let queries = 0;
  const f = fixture(name => name === 'search_query' ? (++queries === 1 ? {hits: [], files: 3, indexing: true} : response([hit('ready')])) : {});
  try {
    f.controller.open(); await f.type('rap'); assert.match(f.controller.elements.information.textContent, /Indexation/);
    await delay(search.CONFIG.statusInterval + 50);
    assert.equal(f.calls.filter(call => call.name === 'search_status').length, 2);
    assert.equal(f.controller.elements.list.children[0].dataset.resultId, 'ready');
  } finally {f.controller.dispose();}
});

test('reindex is explicit, prevents duplicate work, and refreshes only through the native command', async () => {
  const pending = deferred(), f = fixture(name => name === 'search_reindex' ? pending.promise : response([hit('one')]));
  try {
    f.controller.open(); await f.type('rap'); f.controller.elements.reindex.focus(); f.controller.elements.reindex.emit('click'); f.controller.elements.reindex.emit('click');
    assert.equal(f.calls.filter(call => call.name === 'search_reindex').length, 1); assert.equal(f.controller.elements.reindex.disabled, true);
    assert.equal(f.document.activeElement, f.controller.elements.input);
    pending.resolve({files: 0, indexing: true}); await delay(0); assert.equal(f.controller.elements.list.children.length, 0); assert.match(f.controller.elements.information.textContent, /Indexation/);
    assert.deepEqual(f.calls.find(call => call.name === 'search_reindex').args, {});
  } finally {f.controller.dispose();}
});

test('unavailable global shortcut is disclosed with an in-app fallback without exposing backend errors', async () => {
  const f = fixture(undefined, 'en', {status: () => ({files: 42, indexing: false, shortcut: {available: false, error: 'C:\\private\\internal error'}})});
  try {
    f.controller.open(); await delay(0); assert.equal(f.controller.elements.information.textContent, 'Global shortcut unavailable · Ctrl+K in Notchy');
    assert(!f.host.textContent.includes('private')); assert.equal(f.controller.elements.reindex.getAttribute('aria-label'), 'Rebuild the index');
  } finally {f.controller.dispose();}
});

test('disposal is repeat-safe, removes listeners, and restores caller content and label', () => {
  const f = fixture(); assert.equal(f.controller.dispose(), true); assert.equal(f.controller.dispose(), false);
  assert.equal(f.host.childNodes[0], f.original); assert.equal(f.host.getAttribute('aria-label'), 'Original'); assert.equal(f.host.classList.contains('approved-search-host'), true); assert.equal(f.controller.open(), false);
});
