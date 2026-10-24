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
    focus() {for(let node=this;node;node=node.parentNode)if(node.hidden||node.inert)return;if (!this.focusBlocked) document.activeElement = this;}
    scrollIntoView() {this.scrolled = true;}
    getBoundingClientRect() {return this.className.includes('search-context-menu') ? {left:0,top:0,width:224,height:116,bottom:116} : {left:16,top:16,width:562,height:224,bottom:240};}
    contains(node) {return this === node || this.childNodes.some(child => child.contains(node));}
    closest(selector) {return selector === '[data-result-id]' && this.dataset.resultId ? this : this.parentNode?.closest(selector) || null;}
  }
  document.createElement = name => new Element(name); document.createElementNS = (_, name) => new Element(name);
  const documentEvents = new Element('document'); document.addEventListener = documentEvents.addEventListener.bind(documentEvents); document.removeEventListener = documentEvents.removeEventListener.bind(documentEvents); document.emit = documentEvents.emit.bind(documentEvents);
  const frames = new Map(); let frameId = 0;
  if (options.animationFrames) {document.defaultView = new Element('window'); document.defaultView.requestAnimationFrame = callback => {frames.set(++frameId, callback); return frameId;}; document.defaultView.cancelAnimationFrame = id => frames.delete(id);}
  const host = document.createElement('section'), original = document.createElement('strong'), opener = document.createElement('button');
  host.className = 'approved-search-host'; host.setAttribute('aria-label', 'Original'); host.append(original); opener.focus();
  const calls = [];
  const controller = search.create({host, invoke: async (name, args) => {calls.push({name, args}); return name === 'search_status' ? options.status?.() || {files: 42, indexing: false} : invoke?.(name, args);}, ...options});
  const type = async value => {controller.elements.input.value = value; controller.elements.input.emit('input'); await delay(search.CONFIG.debounce + 15);};
  const key = (name, options = {}) => host.emit('keydown', {target: document.activeElement || controller.elements.input, key: name, ...options});
  const paint = () => {const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(0);};
  return {document, host, controller, calls, type, key, opener, original, frames, paint};
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

test('every query word and repeated occurrence is highlighted independently without changing source text', () => {
  assert.deepEqual(search.highlightParts('Projet final — FINAL projet.pdf', 'final PROJET final'), [
    {text:'Projet',matched:true},{text:' ',matched:false},{text:'final',matched:true},{text:' — ',matched:false},
    {text:'FINAL',matched:true},{text:' ',matched:false},{text:'projet',matched:true},{text:'.pdf',matched:false},
  ]);
  assert.deepEqual(search.highlightParts('banana.pdf', 'ana nana'), [{text:'b',matched:false},{text:'anana',matched:true},{text:'.pdf',matched:false}]);
  assert.deepEqual(search.highlightParts('rapport[1].pdf', '[1] .pdf'), [{text:'rapport',matched:false},{text:'[1].pdf',matched:true}]);
});

test('accent folding preserves composed and decomposed accents plus the original emoji offsets', () => {
  const source = '📁 Résumé re\u0301sume\u0301 ÉTÉ.pdf';
  const parts = search.highlightParts(source, 'resume été');
  assert.deepEqual(parts,[{text:'📁 ',matched:false},{text:'Résumé',matched:true},{text:' ',matched:false},{text:'re\u0301sume\u0301',matched:true},{text:' ',matched:false},{text:'ÉTÉ',matched:true},{text:'.pdf',matched:false}]);
  assert.equal(parts.map(part=>part.text).join(''),source);
  assert.deepEqual(search.highlightParts('Été à Québec', '  '), [{text:'Été à Québec',matched:false}]);
  assert.deepEqual(search.highlightParts('unchanged', '\u0301'), [{text:'unchanged',matched:false}]);
});

test('keyboard opening retries input focus after the shell becomes focusable without any pointer event', () => {
  const f = fixture(undefined,'fr',{animationFrames:true});
  try {
    f.controller.elements.input.focusBlocked = true; f.controller.open(); assert.equal(f.document.activeElement,f.opener);
    f.controller.elements.input.focusBlocked = false; f.paint(); assert.equal(f.document.activeElement,f.controller.elements.input); assert.equal(f.frames.size,0);
    f.opener.focus(); f.document.defaultView.emit('focus'); assert.equal(f.document.activeElement,f.controller.elements.input);
    f.controller.close(); f.paint(); assert.equal(f.document.activeElement,f.opener); assert.equal(f.frames.size,0);
  } finally {f.controller.dispose();}
});

test('the real native search opening route reveals the host before input focus without awaiting index status', () => {
  const source=fs.readFileSync(require.resolve('../notch.js'),'utf8'),start=source.indexOf('  function searchOpening() {'),end=source.indexOf('\n  function searchClosed()',start);
  assert(start>=0&&end>start,'The test exercises the actual route-opening function');
  const pending=deferred(),steps=[];let context;
  const f=fixture(undefined,'fr',{animationFrames:true,status:()=>pending.promise,onOpen:()=>context.searchOpening()});
  context=vm.createContext({view:'nook',state:'rest',searchReturnView:null,searchReturnState:null,
    clearModuleFeedback(){},
    selectViewButton(button){context.view=button.dataset.view;steps.push('select:'+context.state);context.renderSearchRoute();},
    openFromOutside(){context.state='open';steps.push('open:'+context.state);return true;},
    renderSearchRoute(){steps.push('render:'+context.state);f.host.hidden=context.view!=='search'||context.state!=='open';},
  });
  vm.runInContext(source.slice(start,end),context);
  try {
    f.controller.open();
    assert.equal(f.host.hidden,false);assert.equal(f.document.activeElement,f.controller.elements.input,'Focus succeeds before any status reply or paint');
    assert.deepEqual(steps,['select:rest','render:rest','open:open','render:open']);
    assert.equal(context.searchReturnView,'nook');assert.equal(context.searchReturnState,'rest');assert.equal(f.calls[0].name,'search_status');
  } finally {f.controller.dispose();pending.resolve({files:42,indexing:false});}
});

test('delayed opening focus does not steal a deliberately focused search action or survive disposal', () => {
  const f = fixture(undefined,'fr',{animationFrames:true});
  f.controller.open(); f.controller.elements.reindex.focus(); f.paint(); assert.equal(f.document.activeElement,f.controller.elements.reindex);
  f.controller.open(); assert.equal(f.frames.size,1); f.document.emit('pointerdown',{target:f.controller.elements.reindex}); assert.equal(f.frames.size,0);
  f.controller.open(); f.controller.dispose(); assert.equal(f.frames.size,0); f.opener.focus(); f.paint(); assert.equal(f.document.activeElement,f.opener);
});

test('result names and visible paths both mark all words using text nodes and the shared orange token', async () => {
  const payload = '<img src=x>.txt', path = 'C:\\Résumé\\final\\resume\\FINAL\\' + payload;
  const f = fixture(name=>name==='search_query'?response([{id:'safe',name:'Résumé FINAL resume.txt',path,kind:'file'}]):{});
  try {
    f.controller.open(); await f.type('resume final');
    const row = f.controller.elements.list.children[0], copy = row.children[1], name = copy.children[0], location = copy.children[1];
    assert.deepEqual(name.children.filter(node=>node.localName==='mark').map(node=>node.textContent),['Résumé','FINAL','resume']);
    assert.deepEqual(location.children.filter(node=>node.localName==='mark').map(node=>node.textContent),['Résumé','final','resume','FINAL']);
    assert.equal(location.textContent,path); assert.equal(location.title,path); assert(!row.children.some(node=>node.localName==='img'));
    const css = fs.readFileSync(require.resolve('../search.css'),'utf8');
    assert.match(css,/\.notchy-search \.search-result-copy mark\s*\{[^}]*color:\s*var\(--accent-focus\)[^}]*text-decoration:\s*none/);
  } finally {f.controller.dispose();}
});

test('Spotlight uses neutral selected-result shading with orange query marks and no keyboard rings', () => {
  const css=fs.readFileSync(require.resolve('../search.css'),'utf8');
  assert.doesNotMatch(css,/--color-0066bd/);
  assert.match(css,/\.search-result\[aria-selected="true"\]\s*\{[^}]*background-color:\s*var\(--color-ffffff24\)/);
  assert.match(css,/#notch #search-player :is\(button,input\):is\(:focus,:focus-visible\)\s*\{[^}]*outline:\s*none;[^}]*box-shadow:\s*none;/);
  assert.match(css,/\.search-result-copy mark\s*\{[^}]*color:\s*var\(--accent-focus\)/);
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

test('keyboard reaches the final result, scrolling closes its context menu, and Enter opens that same item', async () => {
  const hits=Array.from({length:search.CONFIG.limit},(_,index)=>hit('row-'+index,'résumé-'+index+'.pdf'));
  const f=fixture(name=>name==='search_query'?response(hits):{},'fr',{animationFrames:true});
  try {
    f.controller.open();f.paint();await f.type('resume');
    for(let index=1;index<hits.length;index++)f.key('ArrowDown');
    const {input,list,contextMenu}=f.controller.elements,last=list.children.at(-1);
    assert.equal(last.getAttribute('aria-selected'),'true');assert.equal(last.scrolled,true);assert.equal(f.document.activeElement,input);
    f.key('ContextMenu');assert.equal(contextMenu.hidden,false);list.emit('scroll');assert.equal(contextMenu.hidden,true);assert.equal(f.document.activeElement,input);
    f.key('Enter');await delay(0);assert.deepEqual(f.calls.find(call=>call.name==='search_open').args,{id:'row-7'});assert.equal(f.controller.isOpen(),false);assert.equal(f.frames.size,0);
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

test('a scaled search context menu converts viewport coordinates into local coordinates once',async()=>{
  const f=fixture(name=>name==='search_query'?response([hit('scaled')]):{});
  try {
    f.controller.open();await f.type('pdf');
    f.host.offsetWidth=800;f.host.getBoundingClientRect=()=>({left:100,top:20,width:560,height:280,bottom:300});
    const {list,contextMenu}=f.controller.elements;
    contextMenu.getBoundingClientRect=()=>({left:0,top:0,width:156.8,height:81.2,bottom:81.2});
    list.emit('contextmenu',{target:list.children[0],clientX:240,clientY:90});
    assert.equal(parseFloat(contextMenu.style.left),200);assert.equal(parseFloat(contextMenu.style.top),100);
    list.emit('contextmenu',{target:list.children[0],clientX:659,clientY:299});
    assert(Math.abs(parseFloat(contextMenu.style.left)-(800-224-search.CONFIG.menuInset))<.001);
    assert(Math.abs(parseFloat(contextMenu.style.top)-(400-116-search.CONFIG.menuInset))<.001);
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

for (const extension of ['html', 'htm']) test('integrated '+extension+' preview uses first Space and preserves its source through navigation and close without QuickLook', async () => {
  let market=0;
  const f=fixture(name=>name==='search_query'?response([hit('first','first.'+extension),hit('second','second.'+extension.toUpperCase())]):{},'en',
    {onGetQuickLook:()=>{market++;},status:()=>({files:42,indexing:false,quickLook:{supported:false,available:false},renderedPreview:{supported:true,visible:true}})});
  try{
    f.controller.open();await f.type('report');assert.equal(f.controller.elements.preview.hidden,false);assert.equal(f.controller.elements.preview.getAttribute('aria-label'),'Preview');assert.equal(f.key(' ').prevented,true);await delay(0);
    assert.equal(f.controller.previewTarget(),'first');assert.deepEqual(f.calls.filter(call=>call.name==='search_preview').map(call=>call.args),[{id:'first'}]);assert.equal(market,0);
    const previewControl=f.document.createElement('button');previewControl.focus();
    assert.equal(f.controller.navigatePreview(1),true);assert.equal(f.document.activeElement===previewControl,true,'Navigation keeps the reader focused while the next preview loads');await delay(0);assert.equal(f.controller.previewTarget(),'second');assert.equal(f.document.activeElement===previewControl,true);assert.equal(f.controller.elements.input.value,'report');
    const sent=f.calls.filter(call=>call.name==='search_preview').length;assert.equal(f.controller.navigatePreview(1),true);await delay(0);assert.equal(f.document.activeElement===previewControl,true,'The final document cannot move focus behind the reader');assert.equal(f.calls.filter(call=>call.name==='search_preview').length,sent);
    assert.equal(f.controller.navigatePreview(-1),true);await delay(0);assert.equal(f.controller.previewTarget(),'first');assert.equal(f.document.activeElement===previewControl,true);assert.equal(f.controller.navigatePreview(-1),true);assert.equal(f.document.activeElement===previewControl,true);assert.equal(f.controller.navigatePreview(2),false);
    f.controller.stopPreview();await delay(0);assert.equal(f.controller.previewTarget(),null);assert.equal(f.controller.isOpen(),true);assert.equal(f.controller.elements.input.value,'report');assert.equal(f.controller.navigatePreview(1),false);
    f.controller.elements.list.children[0].focus();f.key(' ');await delay(0);assert.equal(f.controller.previewTarget(),'first');await f.type('new query');assert.equal(f.controller.previewTarget(),null);assert.equal(f.controller.elements.input.value,'new query');assert(f.calls.filter(call=>call.name==='search_preview_close').length>=2);
    assert.equal(market,0);assert.equal(f.calls.some(call=>['search_open','search_reveal','search_quicklook_install'].includes(call.name)),false);
  }finally{f.controller.dispose();}
});

test('integrated preview errors are bounded neutral feedback and never direct the user to QuickLook Market',async()=>{
  let market=0;const f=fixture(name=>{if(name==='search_query')return response([hit('one','report.html')]);if(name==='search_preview')throw Error('Reader failed C:\\private\\secret '+ 'x'.repeat(1000));return {};},'en',
    {onGetQuickLook:()=>{market++;},status:()=>({files:42,indexing:false,quickLook:{supported:true,available:false},renderedPreview:{supported:true,visible:false}})});
  try{f.controller.open();await f.type('report');f.key(' ');await delay(0);assert.equal(f.controller.elements.information.textContent,'Preview unavailable.');assert.equal(f.controller.previewTarget(),null);assert.equal(f.controller.isPreviewing(),false);assert.equal(f.controller.elements.preview.getAttribute('aria-label'),'Preview');assert(!f.host.textContent.includes('secret'));assert(!f.host.textContent.includes('Market'));assert.equal(market,0);assert.equal(f.controller.elements.list.children.length,1);}
  finally{f.controller.dispose();}
});

test('a late integrated failure cannot replace feedback after the source query is changed',async()=>{
  const pending=deferred(),f=fixture(name=>name==='search_query'?response([hit('one','report.html')]):name==='search_preview'?pending.promise:{},'en',
    {status:()=>({files:42,indexing:false,quickLook:{supported:true,available:false},renderedPreview:{supported:true,visible:true}})});
  try{f.controller.open();await f.type('report');f.key(' ');await delay(0);await f.type('new query');pending.reject(Error('old conversion failed'));await delay(0);assert.equal(f.controller.previewTarget(),null);assert.equal(f.controller.elements.input.value,'new query');assert.equal(f.controller.elements.information.textContent,'42 indexed items');}
  finally{f.controller.dispose();}
});

test('a folder named like an integrated document keeps its existing QuickLook setup route',async()=>{
  let market=0;const f=fixture(name=>name==='search_query'?response([hit('folder','folder.html','folder')]):{},'en',
    {onGetQuickLook:()=>{market++;},status:()=>({files:42,indexing:false,quickLook:{supported:true,available:false},renderedPreview:{supported:true,visible:false}})});
  try{f.controller.open();await f.type('folder');assert.equal(f.controller.elements.preview.getAttribute('aria-label'),'Get QuickLook');f.key(' ');await delay(0);assert.equal(market,1);assert.equal(f.calls.some(call=>call.name==='search_preview'),false);}
  finally{f.controller.dispose();}
});

for (const extension of ['docx', 'pptx', 'xlsx']) {
  test('Office '+extension+' opens Market when QuickLook is absent despite the HTML reader being available', async () => {
    let market=0;const f=fixture(name=>name==='search_query'?response([hit('office','report.'+extension)]):{},'en',
      {onGetQuickLook:()=>{market++;},status:()=>({files:42,indexing:false,quickLook:{supported:true,available:false},renderedPreview:{supported:true,visible:true}})});
    try{f.controller.open();await f.type('report');assert.equal(f.controller.elements.preview.getAttribute('aria-label'),'Get QuickLook');assert.equal(f.key(' ').prevented,true);await delay(0);assert.equal(market,1);assert.equal(f.controller.isPreviewing(),false);assert.equal(f.controller.elements.input.value,'report');assert.equal(f.controller.elements.list.children[0].getAttribute('aria-selected'),'true');assert.equal(f.calls.some(call=>['search_preview','search_open','search_reveal','search_quicklook_install'].includes(call.name)),false);}
    finally{f.controller.dispose();}
  });
  test('Office '+extension+' uses external QuickLook visibility and preserves keyboard navigation and selection', async () => {
    let visible=true;const f=fixture(name=>name==='search_query'?response([hit('first','first.'+extension),hit('second','second.'+extension.toUpperCase())]):{},'en',
      {onGetQuickLook:()=>{throw Error('Installed QuickLook must not open Market');},status:()=>({files:42,indexing:false,quickLook:{supported:true,available:true,previewVisible:visible},renderedPreview:{supported:true,visible:false}})});
    try{f.controller.open();await f.type('report');const {input,list,preview}=f.controller.elements;assert.equal(preview.getAttribute('aria-label'),'QuickLook preview');assert.equal(f.key(' ').prevented,true);await delay(0);assert.equal(f.controller.previewTarget(),'first');assert.equal(f.document.activeElement,list.children[0]);f.host.emit('pointerenter');await delay(0);assert.equal(f.controller.isPreviewing(),true,'The HTML reader visibility cannot close an Office preview');f.key('ArrowRight');await delay(0);assert.equal(f.controller.previewTarget(),'second');assert.equal(f.document.activeElement,list.children[1]);assert.deepEqual(f.calls.filter(call=>call.name==='search_preview').map(call=>call.args),[{id:'first'},{id:'second'}]);assert.equal(f.key('Escape').prevented,true);await delay(0);assert.equal(f.controller.isPreviewing(),false);assert.equal(f.controller.isOpen(),true);assert.equal(input.value,'report');assert.equal(list.children[1].getAttribute('aria-selected'),'true');f.key(' ');await delay(0);visible=false;f.host.emit('pointerenter');await delay(0);assert.equal(f.controller.isPreviewing(),false,'Closing QuickLook externally ends the Office preview');assert.equal(list.children[1].getAttribute('aria-selected'),'true');}
    finally{f.controller.dispose();}
  });
}

test('QuickLook previews files and folders by opaque ID while preserving search and its query', async () => {
  const f = fixture(name => name === 'search_query' ? response([hit('folder', 'Reports', 'folder'), hit('file')]) : {}, 'en',
    {status: () => ({files:42, indexing:false, quickLook:{supported:true,available:true}})});
  try {
    f.controller.open(); await f.type('report'); const {preview, input, contextMenu, more} = f.controller.elements;
    assert.equal(preview.hidden, false); assert.equal(preview.getAttribute('aria-label'), 'QuickLook preview');
    preview.emit('click'); await delay(0);
    assert.deepEqual(f.calls.find(call => call.name === 'search_preview').args, {id:'folder'});
    assert.equal(f.controller.isOpen(), true); assert.equal(input.value, 'report');
    f.key('ArrowDown'); more.emit('click'); contextMenu.children[3].emit('click'); await delay(0);
    assert.deepEqual(f.calls.filter(call => call.name === 'search_preview').at(-1).args, {id:'file'});
    assert.equal(f.calls.some(call => call.name === 'search_open'), false);
  } finally {f.controller.dispose();}
});

test('Alt+P previews once and IME input remains editable', async () => {
  const f = fixture(name => name === 'search_query' ? response([hit('file')]) : {}, 'fr',
    {status: () => ({files:42, indexing:false, quickLook:{supported:true,available:true}})});
  try {
    f.controller.open(); await f.type('report');
    assert.equal(f.key('p', {altKey:true,isComposing:true}).prevented, undefined);
    assert.equal(f.key('p', {altKey:true,repeat:true}).prevented, undefined);
    assert.equal(f.key('p', {altKey:true}).prevented, true); await delay(0);
    assert.equal(f.calls.filter(call => call.name === 'search_preview').length, 1);
    assert.equal(f.controller.isOpen(), true);
  } finally {f.controller.dispose();}
});

test('the first Down enters the initial selected result and Space previews it without a down/up detour', async () => {
  const f=fixture(name=>name==='search_query'?response([hit('first'),hit('second')]):{},'fr',
    {status:()=>({files:42,indexing:false,quickLook:{supported:true,available:true}})});
  try {
    f.controller.open();await f.type('rapport');const {input,list}=f.controller.elements;
    assert.equal(f.document.activeElement,input);
    f.key('ArrowDown');assert.equal(f.document.activeElement?.dataset.resultId,'first');assert.equal(list.children[0].getAttribute('aria-selected'),'true');
    const event=f.key(' ');assert.equal(event.prevented,true);await delay(0);
    assert.deepEqual(f.calls.filter(call=>call.name==='search_preview').map(call=>call.args.id),['first']);assert.equal(input.value,'rapport');
    f.key('ArrowDown');await delay(0);assert.equal(f.document.activeElement?.dataset.resultId,'second');
    assert.deepEqual(f.calls.filter(call=>call.name==='search_preview').map(call=>call.args.id),['first','second']);
  } finally {f.controller.dispose();}
});

test('Space from the query immediately previews the initial result and keeps its opaque selection', async () => {
  const f=fixture(name=>name==='search_query'?response([hit('first'),hit('second')]):{},'fr',
    {status:()=>({files:42,indexing:false,quickLook:{supported:true,available:true}})});
  try {
    f.controller.open();await f.type('rapport final');const {input,list}=f.controller.elements;
    assert.equal(f.document.activeElement,input);assert.equal(list.children[0].getAttribute('aria-selected'),'true');
    assert.equal(f.key(' ',{code:'Space'}).prevented,true);await delay(0);
    assert.equal(input.value,'rapport final');assert.equal(f.document.activeElement,list.children[0]);
    assert.deepEqual(f.calls.filter(call=>call.name==='search_preview').map(call=>call.args.id),['first']);
    f.key('ArrowDown');await delay(0);input.focus();f.key(' ');await delay(0);
    assert.equal(f.controller.isPreviewing(),false,'Space toggles the current selected result after returning to the query');
    f.key(' ');await delay(0);
    assert.deepEqual(f.calls.filter(call=>call.name==='search_preview').map(call=>call.args.id),['first','second','second']);
    assert.equal(f.document.activeElement,list.children[1]);
  } finally {f.controller.dispose();}
});

test('query Space preview ignores repeats, modifiers and composition without disturbing input or requests', async () => {
  const f=fixture(name=>name==='search_query'?response([hit('first')]):{},'fr',
    {status:()=>({files:42,indexing:false,quickLook:{supported:true,available:true}})});
  try {
    f.controller.open();await f.type('rapport');const {input}=f.controller.elements;
    for(const modifier of ['ctrlKey','altKey','metaKey','shiftKey'])assert.equal(f.key(' ',{[modifier]:true}).prevented,undefined,modifier);
    assert.equal(f.key(' ',{isComposing:true}).prevented,undefined);
    input.emit('compositionstart');assert.equal(f.key(' ').prevented,undefined);input.emit('compositionend');
    await f.type('rapport');assert.equal(f.key(' ',{repeat:true}).prevented,true);
    await delay(0);assert.equal(f.calls.some(call=>call.name==='search_preview'),false);assert.equal(f.document.activeElement,input);
    f.key(' ');await delay(0);input.focus();assert.equal(f.key(' ',{repeat:true}).prevented,true);await delay(0);
    assert.equal(f.controller.isPreviewing(),true);assert.equal(f.calls.filter(call=>call.name==='search_preview').length,1);
    assert.equal(input.value,'rapport');
  } finally {f.controller.dispose();}
});

test('Space stays normal query text without eligible loaded results, including pending search and unsupported QuickLook', async () => {
  const pending=deferred();let count=0;
  const f=fixture(name=>name==='search_query'?(++count===1?response([]):pending.promise):{},'fr',
    {status:()=>({files:42,indexing:false,quickLook:{supported:true,available:true}})});
  try {
    f.controller.open();assert.equal(f.key(' ').prevented,undefined);
    await f.type('none');assert.equal(f.key(' ').prevented,undefined);
    const typing=f.type('pending');await delay(search.CONFIG.debounce+10);assert.equal(count,2,'The second native query is still in flight');assert.equal(f.key(' ').prevented,undefined);
    pending.resolve(response([hit('first')]));await typing;assert.equal(f.key(' ').prevented,true);await delay(0);
    assert.deepEqual(f.calls.find(call=>call.name==='search_preview').args,{id:'first'});
  } finally {f.controller.dispose();pending.resolve(response([]));}
  const unsupported=fixture(name=>name==='search_query'?response([hit('first')]):{});
  try {unsupported.controller.open();await unsupported.type('rapport');assert.equal(unsupported.key(' ').prevented,undefined);assert.equal(unsupported.calls.some(call=>call.name==='search_preview'),false);}
  finally {unsupported.controller.dispose();}
});

test('query Space opens the Market module detail when QuickLook is supported but missing', async () => {
  let market=0;
  const f=fixture(name=>name==='search_query'?response([hit('first')]):{},'fr',
    {onGetQuickLook:()=>{market++;},status:()=>({files:42,indexing:false,quickLook:{supported:true,available:false}})});
  try {f.controller.open();await f.type('rapport');assert.equal(f.key(' ').prevented,true);await delay(0);
    assert.equal(market,1);assert.equal(f.calls.some(call=>['search_quicklook_install','search_preview','search_open','search_reveal'].includes(call.name)),false);assert.equal(f.controller.elements.input.value,'rapport');assert.equal(f.controller.isOpen(),true);
  } finally {f.controller.dispose();}
});

test('a result refetch preserves the focused opaque ID and its immediate Space preview', async () => {
  const pending=deferred();let count=0;
  const f=fixture(name=>name==='search_query'?(++count===1?response([hit('first'),hit('second')]):pending.promise):{},'fr',
    {status:()=>({files:42,indexing:false,quickLook:{supported:true,available:true}})});
  try {
    f.controller.open();await f.type('rapport');const {list,input}=f.controller.elements;
    list.emit('click',{target:list.children[0]});const original=list.children[0];f.controller.refresh();
    assert.equal(f.document.activeElement,original,'Refreshing cannot detach the focused result while waiting');assert.equal(list.children.length,2);
    pending.resolve(response([hit('second'),hit('first')]));await delay(0);
    assert.equal(f.document.activeElement?.dataset.resultId,'first');assert.equal(f.document.activeElement,list.children[1]);assert.equal(list.children[1].getAttribute('aria-selected'),'true');
    f.key(' ');await delay(0);assert.deepEqual(f.calls.filter(call=>call.name==='search_preview').map(call=>call.args.id),['first']);assert.equal(input.value,'rapport');
  } finally {f.controller.dispose();pending.resolve(response([]));}
});

test('a pending result refetch never steals focus back after the query input is deliberately resumed', async () => {
  const pending=deferred();let count=0;
  const f=fixture(name=>name==='search_query'?(++count===1?response([hit('first')]):pending.promise):{},'fr',
    {status:()=>({files:42,indexing:false,quickLook:{supported:true,available:true}})});
  try {
    f.controller.open();await f.type('rapport');const {list,input}=f.controller.elements;
    list.emit('click',{target:list.children[0]});f.controller.refresh();input.focus();
    pending.resolve(response([hit('first')]));await delay(0);
    assert.equal(f.document.activeElement,input);assert.equal(f.calls.some(call=>call.name==='search_preview'),false);
    assert.equal(f.key(' ').prevented,true);await delay(0);assert.deepEqual(f.calls.find(call=>call.name==='search_preview').args,{id:'first'});
  } finally {f.controller.dispose();pending.resolve(response([]));}
});

test('missing QuickLook opens only its Market detail and leaves the result available', async () => {
  let market=0;
  const f = fixture(name => name === 'search_query' ? response([hit('file')]) : {}, 'en',
    {onGetQuickLook:()=>{market++;},status: () => ({files:42, indexing:false, quickLook:{supported:true,available:false}})});
  try {
    f.controller.open(); await f.type('report'); assert.equal(f.controller.elements.preview.getAttribute('aria-label'), 'Get QuickLook');
    f.controller.elements.preview.emit('click'); await delay(0);
    assert.equal(market,1);assert.equal(f.calls.some(call=>call.name==='search_quicklook_install'),false);
    assert.equal(f.calls.some(call => call.name === 'search_preview' || call.name === 'search_open'), false);
    assert.equal(f.controller.isOpen(), true); assert.match(f.controller.elements.information.textContent, /Market/);
    assert.equal(f.controller.elements.preview.disabled, false);
  } finally {f.controller.dispose();}
});

test('failed QuickLook previews preserve results, show a safe error and allow retry', async () => {
  const f = fixture(name => {if (name === 'search_query') return response([hit('file')]); throw new Error('C:\\private\\secret');}, 'en',
    {status: () => ({files:42, indexing:false, quickLook:{supported:true,available:true}})});
  try {
    f.controller.open(); await f.type('report'); f.controller.elements.preview.emit('click'); await delay(0);
    assert.equal(f.controller.isOpen(), true); assert.equal(f.controller.elements.list.children.length, 1);
    assert.equal(f.controller.elements.information.textContent, 'QuickLook preview could not be started.');
    assert(!f.host.textContent.includes('secret')); assert.equal(f.controller.elements.preview.disabled, false);
  } finally {f.controller.dispose();}
});

test('returning after setup redetects QuickLook and clears its setup hint without losing the query', async () => {
  let available = false;
  const f = fixture(name => name === 'search_query' ? response([hit('file')]) : {}, 'en',
    {animationFrames:true,status: () => ({files:42,indexing:false,quickLook:{supported:true,available}})});
  try {
    f.controller.open(); await f.type('report'); f.controller.elements.preview.emit('click'); await delay(0);
    assert.match(f.controller.elements.information.textContent,/Market/);
    available=true;f.document.defaultView.emit('focus');await delay(0);
    assert.equal(f.controller.elements.preview.getAttribute('aria-label'),'QuickLook preview');
    assert.equal(f.controller.elements.information.textContent,'42 indexed items');
    assert.equal(f.controller.elements.input.value,'report');assert.equal(f.controller.elements.list.children.length,1);
  } finally {f.controller.dispose();}
});

test('macOS-style selection uses Space to toggle preview and Escape closes preview before search', async () => {
  const f = fixture(name => name === 'search_query' ? response([hit('one'),hit('two')]) : {}, 'en',
    {status: () => ({files:42,indexing:false,quickLook:{supported:true,available:true}})});
  const resultKey = (key,extra={}) => f.host.emit('keydown',{target:f.document.activeElement,key,...extra});
  try {
    f.controller.open();await f.type('rapport');const {list,preview,input}=f.controller.elements;
    list.emit('click',{target:list.children[0]});assert.equal(f.document.activeElement,list.children[0]);
    assert.equal(f.calls.some(call=>call.name==='search_open'),false);
    resultKey(' ');await delay(0);assert.equal(f.controller.isPreviewing(),true);
    assert.deepEqual(f.calls.find(call=>call.name==='search_preview').args,{id:'one'});
    assert.equal(preview.getAttribute('aria-label'),'Close preview');
    resultKey(' ',{repeat:true});await delay(0);assert.equal(f.controller.isPreviewing(),true);
    resultKey('ArrowDown');await delay(0);assert.equal(f.document.activeElement,list.children[1]);
    assert.deepEqual(f.calls.filter(call=>call.name==='search_preview').at(-1).args,{id:'two'});
    list.emit('pointermove',{target:list.children[0]});assert.equal(list.children[1].getAttribute('aria-selected'),'true');
    resultKey('Escape');await delay(0);assert.equal(f.controller.isPreviewing(),false);assert.equal(f.controller.isOpen(),true);
    assert.equal(f.calls.filter(call=>call.name==='search_preview_close').length,1);assert.equal(input.value,'rapport');
    resultKey(' ');await delay(0);resultKey(' ');await delay(0);assert.equal(f.controller.isPreviewing(),false);
    assert.equal(f.calls.filter(call=>call.name==='search_preview_close').length,2);
    resultKey('Escape');assert.equal(f.controller.isOpen(),false);
  } finally {f.controller.dispose();}
});

test('rapid preview navigation keeps one request in flight and coalesces to the newest selection', async () => {
  const first=deferred();let previews=0;
  const f=fixture(name=>name==='search_query'?response([hit('one'),hit('two'),hit('three')]):name==='search_preview'&&++previews===1?first.promise:{},'fr',
    {status:()=>({files:42,indexing:false,quickLook:{supported:true,available:true}})});
  const key=name=>f.host.emit('keydown',{target:f.document.activeElement,key:name});
  try {
    f.controller.open();await f.type('rapport');const {list}=f.controller.elements;list.emit('click',{target:list.children[0]});key(' ');
    key('ArrowDown');key('ArrowDown');assert.equal(f.calls.filter(call=>call.name==='search_preview').length,1);
    first.resolve({ok:true});await delay(0);
    assert.deepEqual(f.calls.filter(call=>call.name==='search_preview').map(call=>call.args.id),['one','three']);
    key('ArrowRight');await delay(0);assert.equal(f.calls.filter(call=>call.name==='search_preview').length,2);
    key('ArrowLeft');await delay(0);assert.equal(f.calls.filter(call=>call.name==='search_preview').at(-1).args.id,'two');
  } finally {f.controller.dispose();}
});

test('Escape cancels a pending preview before it settles and its late failure cannot replace search feedback', async () => {
  const pending=deferred(),closing=deferred(),f=fixture(name=>name==='search_query'?response([hit('one','large.xlsx')]):name==='search_preview'?pending.promise:name==='search_preview_close'?closing.promise:{},'en',
    {status:()=>({files:42,indexing:false,quickLook:{supported:true,available:true}})});
  try {
    f.controller.open();await f.type('large');f.key(' ');f.key('Escape');
    assert.equal(f.calls.filter(call=>call.name==='search_preview_close').length,1,'Native cancellation is sent while the heavy Open is still pending');
    assert.equal(f.controller.isPreviewing(),false);assert.equal(f.controller.isOpen(),true);
    pending.reject(Error('Cancelled obsolete workbook'));await delay(0);
    assert.equal(f.controller.elements.information.textContent,'42 indexed items');
    closing.resolve({});await delay(0);assert.equal(f.calls.filter(call=>call.name==='search_preview_close').length,1);
  } finally {pending.resolve({});closing.resolve({});f.controller.dispose();}
});

test('returning to the same result during cancellation retries it only after the old Close settles', async () => {
  const pending=deferred(),closing=deferred();let count=0;
  const f=fixture(name=>name==='search_query'?response([hit('one'),hit('two')]):name==='search_preview'&&++count===1?pending.promise:name==='search_preview_close'?closing.promise:{},'fr',
    {status:()=>({files:42,indexing:false,quickLook:{supported:true,available:true}})});
  try {
    f.controller.open();await f.type('rapport');f.key(' ');f.key('ArrowDown');f.key('ArrowUp');
    assert.equal(f.calls.filter(call=>call.name==='search_preview_close').length,1);
    pending.resolve({});await delay(0);assert.equal(f.calls.filter(call=>call.name==='search_preview').length,1,'A late Close must not race the next Open');
    closing.resolve({});await delay(0);
    assert.deepEqual(f.calls.filter(call=>call.name==='search_preview').map(call=>call.args.id),['one','one']);assert.equal(f.controller.isPreviewing(),true);
  } finally {pending.resolve({});closing.resolve({});f.controller.dispose();}
});

test('a late preview response is closed after a query edit or disposal instead of reopening stale content', async () => {
  for(const dispose of [false,true]) {
    const pending=deferred(),f=fixture(name=>name==='search_query'?response([hit('one')]):name==='search_preview'?pending.promise:{},'en',
      {status:()=>({files:42,indexing:false,quickLook:{supported:true,available:true}})});
    try {
      f.controller.open();await f.type('rapport');f.controller.elements.preview.emit('click');
      if(dispose)f.controller.dispose();else{f.controller.elements.input.value='new';f.controller.elements.input.emit('input');}
      pending.resolve({ok:true});await delay(0);
      assert.equal(f.calls.filter(call=>call.name==='search_preview_close').length,1);
      assert.equal(f.controller.isPreviewing(),false);
    } finally {f.controller.dispose();}
  }
});

test('double-click opens the selected file normally after single-click selection', async () => {
  const f=fixture(name=>name==='search_query'?response([hit('one')]):{},'fr',
    {status:()=>({files:42,indexing:false,quickLook:{supported:true,available:true}})});
  try {
    f.controller.open();await f.type('rapport');const {list}=f.controller.elements;
    list.emit('click',{target:list.children[0]});assert.equal(f.calls.some(call=>call.name==='search_open'),false);
    list.emit('dblclick',{target:list.children[0]});await delay(0);
    assert.deepEqual(f.calls.find(call=>call.name==='search_open').args,{id:'one'});assert.equal(f.controller.isOpen(),false);
  } finally {f.controller.dispose();}
});

test('typing from a selected result returns to query editing and closes its preview', async () => {
  const f=fixture(name=>name==='search_query'?response([hit('one')]):{},'fr',
    {status:()=>({files:42,indexing:false,quickLook:{supported:true,available:true}})});
  try {
    f.controller.open();await f.type('rapport');const {list,input}=f.controller.elements;
    list.emit('click',{target:list.children[0]});f.host.emit('keydown',{target:list.children[0],key:' '});await delay(0);
    f.host.emit('keydown',{target:list.children[0],key:'x'});await delay(0);
    assert.equal(input.value,'rapportx');assert.equal(f.document.activeElement,input);assert.equal(f.controller.isPreviewing(),false);
    assert.equal(f.calls.filter(call=>call.name==='search_preview_close').length,1);
    await delay(search.CONFIG.debounce+10);list.emit('click',{target:list.children[0]});
    f.host.emit('keydown',{target:list.children[0],key:'Backspace'});assert.equal(input.value,'rapport');
  } finally {f.controller.dispose();}
});

test('a status response started before Space cannot clear the preview opened while it was pending', async () => {
  const pending=deferred(),ready={files:42,indexing:false,quickLook:{supported:true,available:true,previewVisible:false}};
  let nextStatus=ready;
  const f=fixture(name=>name==='search_query'?response([hit('one')]):{},'en',
    {animationFrames:true,status:()=>nextStatus});
  try {
    f.controller.open();await f.type('rapport');
    nextStatus=pending.promise;f.document.defaultView.emit('focus');
    const {list,preview}=f.controller.elements;
    list.emit('click',{target:list.children[0]});f.host.emit('keydown',{target:list.children[0],key:' '});await delay(0);
    assert.equal(f.controller.isPreviewing(),true,'Space has opened the viewer and its Invoke has completed');
    assert.equal(preview.getAttribute('aria-pressed'),'true');
    pending.resolve(ready);await delay(0);
    assert.equal(f.controller.isPreviewing(),true,'A snapshot taken before Invoke cannot describe the current viewer');
    assert.equal(preview.getAttribute('aria-pressed'),'true');
    assert.equal(f.calls.some(call=>call.name==='search_preview_close'),false,'A stale visibility snapshot cannot close the active preview');
  } finally {pending.resolve(ready);f.controller.dispose();}
});

test('a status snapshot taken during Invoke cannot clear the viewer once Invoke has completed', async () => {
  const statusReply=deferred(),invokeReply=deferred(),ready={files:42,indexing:false,quickLook:{supported:true,available:true,previewVisible:false}};
  let nextStatus=ready;
  const f=fixture(name=>name==='search_query'?response([hit('one')]):name==='search_preview'?invokeReply.promise:{},'en',
    {animationFrames:true,status:()=>nextStatus});
  try {
    f.controller.open();await f.type('rapport');f.controller.elements.preview.emit('click');
    nextStatus=statusReply.promise;f.document.defaultView.emit('focus');
    invokeReply.resolve({ok:true});await delay(0);
    assert.equal(f.controller.isPreviewing(),true);
    statusReply.resolve(ready);await delay(0);
    assert.equal(f.controller.isPreviewing(),true,'A status sampled while the native viewer was opening is stale after Invoke completes');
    assert.equal(f.controller.elements.preview.getAttribute('aria-pressed'),'true');
    assert.equal(f.calls.some(call=>call.name==='search_preview_close'),false);
  } finally {invokeReply.resolve({ok:true});statusReply.resolve(ready);f.controller.dispose();}
});

test('closing the native viewer clears preview state on return without closing search or sending another Close', async () => {
  let visible=true;
  const f=fixture(name=>name==='search_query'?response([hit('one')]):{},'en',
    {animationFrames:true,status:()=>({files:42,indexing:false,quickLook:{supported:true,available:true,previewVisible:visible}})});
  try {
    f.controller.open();await f.type('rapport');f.controller.elements.preview.emit('click');await delay(0);
    assert.equal(f.controller.isPreviewing(),true);visible=false;f.host.emit('pointerenter');await delay(0);
    assert.equal(f.controller.isPreviewing(),false);assert.equal(f.controller.isOpen(),true);
    assert.equal(f.calls.some(call=>call.name==='search_preview_close'),false);
    f.controller.elements.preview.emit('click');await delay(0);assert.equal(f.controller.isPreviewing(),true);
  } finally {f.controller.dispose();}
});

test('unsupported platforms do not advertise QuickLook or intercept Alt+P', async () => {
  const f = fixture(name => name === 'search_query' ? response([hit('file')]) : {});
  try {
    f.controller.open(); await f.type('report'); assert.equal(f.controller.elements.preview.hidden, true);
    f.controller.elements.more.emit('click'); assert.equal(f.controller.elements.contextMenu.children[3].hidden, true);
    f.key('Escape'); assert.equal(f.key('p', {altKey:true}).prevented, undefined);
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
