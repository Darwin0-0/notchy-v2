'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sharing = require('../sharing-experience.js');
const experience = require('../experience.js');
const source = fs.readFileSync(require.resolve('../notch.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const file = (character, name = character + '.pdf', size = 12) => ({id: character.repeat(32), name, size, kind: 'document', thumbnail: null});
const peer = (id, identity = 'e'.repeat(64), alias = 'Actual fixture phone') => ({id, identity, alias, deviceType: 'mobile', secure: true});

function production(begin, end) {
  const start = source.indexOf(begin), stop = source.indexOf(end, start);
  assert(start > 0 && stop > start, `production boundaries exist for ${begin.trim()}`);
  return source.slice(start, stop);
}

function dom() {
  const document = {activeElement: null, hidden: false};
  const downloads = [];
  const descendants = (node, predicate) => [
    ...(predicate(node) ? [node] : []),
    ...node.children.flatMap(child => descendants(child, predicate)),
  ];
  const dataKey = value => value.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
  function matches(node, selector) {
    return selector.split(',').some(part => {
      part = part.trim();
      if (part[0] === '#') return node.id === part.slice(1);
      if (part[0] === '.') return node.className.split(/\s+/).includes(part.slice(1));
      const attribute = part.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
      if (attribute) {
        const value = attribute[1].startsWith('data-') ? node.dataset[dataKey(attribute[1].slice(5))] : node.attributes[attribute[1]];
        return value !== undefined && (attribute[2] === undefined || String(value) === attribute[2]);
      }
      return node.tagName === part;
    });
  }
  class Element {
    constructor(tag) {
      this.tagName = tag; this.nodeType = 1; this.localName = tag; this.ownerDocument = document; this.children = []; this.dataset = {};
      this.attributes = {}; this.listeners = {}; this.className = ''; this._text = ''; this.value = '';
      this.hidden = false; this.inert = false; this.disabled = false; this.style = {setProperty(key, value) {this[key] = value;}};
      this.classList = {
        add: (...values) => {this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...values])].join(' ');},
        contains: value => this.className.split(/\s+/).includes(value),
        remove: value => {this.className=this.className.split(/\s+/).filter(item=>item!==value).join(' ');},
      };
    }
    set textContent(value) {this._text = String(value); for (const child of this.children) child.parentElement = null; this.children = [];}
    get textContent() {return this._text + this.children.map(child => child.textContent).join('');}
    setAttribute(key, value) {this.attributes[key] = String(value);}
    removeAttribute(key) {delete this.attributes[key];}
    append(...nodes) {for (const node of nodes) {node.remove(); node.parentElement = this; this.children.push(node);}}
    prepend(...nodes) {for (const node of nodes.reverse()) {node.remove(); node.parentElement = this; this.children.unshift(node);}}
    insertBefore(node, before) {node.remove(); node.parentElement = this; const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, node);}
    replaceChildren(...nodes) {this.textContent = ''; this.append(...nodes);}
    remove() {if (this.parentElement) {const list = this.parentElement.children; list.splice(list.indexOf(this), 1); this.parentElement = null;}}
    contains(node) {return this === node || this.children.some(child => child.contains(node));}
    closest(selector) {return matches(this, selector) ? this : this.parentElement?.closest(selector) || null;}
    querySelector(selector) {return this.querySelectorAll(selector)[0] || null;}
    querySelectorAll(selector) {return this.children.flatMap(child => descendants(child, node => matches(node, selector)));}
    addEventListener(name, callback) {this.listeners[name] = callback;}
    removeEventListener(name, callback) {if (this.listeners[name] === callback) delete this.listeners[name];}
    focus() {if (!this.disabled) document.activeElement = this;}
    click() {if (this.tagName === 'a') downloads.push({href: this.href, name: this.download});}
    get firstChild() {return this.children[0];}
    get childNodes() {return this.children;}
    get isConnected() {return document.body.contains(this);}
  }
  document.createElement = tag => new Element(tag);
  document.createElementNS = (namespace, tag) => Object.assign(new Element(tag), {namespaceURI: namespace});
  document.body = new Element('body');
  return {document, downloads, descendants};
}

function fixture({files = [file('a'), file('b'), file('c')], peers = [], storage = new Map(), view = 'tray'} = {}) {
  const {document, downloads, descendants} = dom();
  const nodes = new Map();
  function make(id, tag = 'section') {const node = document.createElement(tag); node.id = id; nodes.set(id, node); document.body.append(node); return node;}
  for (const id of ['health-player', 'sharing-experience', 'modules-experience', 'settings-player', 'welcome-player', 'music-queue', 'startup-windows', 'notch-panel', 'notch-menu', 'notch-toggle', 'weather-city-input', 'search-player', 'search-toggle', 'module-library-player']) make(id);
  for (const id of ['shelf-player', 'shelf-nearby-peers', 'shelf-incoming', 'shelf-nearby', 'shelf-incoming-sender', 'shelf-incoming-files', 'shelf-incoming-accept', 'shelf-incoming-reject', 'shelf-nearby-status', 'shelf-nearby-toggle', 'shelf-transfer-cancel', 'shelf-share']) make(id);
  const nearbyHint = document.createElement('p'); nearbyHint.className = 'shelf-nearby-hint'; nodes.get('shelf-nearby').append(nearbyHint);
  const remove = make('shelf-remove', 'button'); remove.dataset.shelfCommand = 'remove';
  const connect = document.createElement('button'); connect.dataset.musicQueueCommand = 'connect'; nodes.get('music-queue').append(connect);
  const settingsHealth = document.createElement('button'); settingsHealth.dataset.settingsCommand = 'health'; nodes.get('settings-player').append(settingsHealth);
  const calls = {requests: [], health: [], sharing: [], music: [], picker: [], modules: []};
  const pending = [];
  let backendFiles = plain(files);
  const translate = (value, values = {}) => String(value ?? '').replace(/\{(\w+)\}/g, (match, key) => Object.hasOwn(values, key) ? values[key] : match);
  const scope = {
    console, document, Set, Map, Number, JSON, Object, Array, Promise,
    disposed: false, shelfItems: plain(files), shelfLoaded: true, shelfBusy: false, shelfError: '', shelfDownloadError: false, shelfEpoch: 0, selectedFiles: new Set(), fileDragging: false,
    nearby: {available: true, status: 'discovering', peers: plain(peers), transfer: null, incoming: null}, nearbyBusy: false, nearbyError: '', nearbyActionError: false, nearbyMutation: 0,
    nearbyPeer: '', nearbyReading: false, nearbyLoaded: true, nearbyIncomingShown: '', nearbyReceiveCompleted: '', nearbyTimer: 0,
    localSendContext: null, moduleEditing: false, state: 'open', view, islandPage: 'essential', weather: {}, weatherBusy: false, queueBusy: false, queueState: {status: 'disconnected'}, music: {available: false},
    startupBusy: false, startupEnabled: false, desktop: {startup: {supported: false}}, weatherPickerOpen: false, queueOpen: false, welcome: null, scenarioController: null, search: null, searchShortcut: 'Ctrl+Space', moduleLibrary:null,
    moduleDefinitions: {}, toggle: nodes.get('notch-toggle'), menu: nodes.get('notch-menu'), panel: nodes.get('notch-panel'), notch: {dataset: {}}, settingsPlayer: nodes.get('settings-player'),
    shelfInput: {value: ''}, shelfPlayer: nodes.get('shelf-player'), weatherCityInput: nodes.get('weather-city-input'), t: translate,
    text(node, value) {node.textContent = value;}, textUI(node, value) {node.textContent = value;},
    byId(id) {assert(nodes.has(id), `fixture has actual requested element ${id}`); return nodes.get(id);},
    setState(value) {scope.state = value;},
    getModuleEditorActive: () => scope.moduleEditing,
    getHomeSlots: () => [], builtinVisible: () => false,
    closeModuleEditor(apply) {calls.modules.push(apply); scope.moduleEditing = false; scope.selectViewButton({dataset: {view: 'nook'}});},
    localSendPresentation: () => null,
    uploadFiles: async files => calls.picker.push(files), showFileChooser: input => calls.picker.push(input),
    shelfFileAction: async (command, item) => calls.picker.push({command, item}),
    nearbyLifecycle() {}, renderLiveActivities() {}, update() {}, protectedInteraction: () => false, notifyModuleChange() {}, gestureFeedback() {},
    performMusicCommand: async value => calls.music.push(value), startupInput: async () => {}, musicQueueCommand: async event => calls.music.push(event.target.dataset.musicQueueCommand),
    renderMusicQueue() {}, musicQueueLifecycle() {},
  };
  for (const name of ['renderIslandNavigation', 'renderMenuSelection', 'renderHomeLayout', 'musicLifecycle', 'renderFocus', 'renderFiles', 'filesLifecycle', 'renderWeather', 'weatherLifecycle', 'renderSettings', 'renderScenarios', 'renderModules', 'renderModuleFeedback', 'renderLocalSend', 'renderHomeSummaries', 'loadShelf']) scope[name] = () => {};
  scope.renderShelf = () => scope.renderExperience();
  scope.syncShelfSelection = () => scope.renderExperience();
  const response = (value, ok = true, status = ok ? 200 : 503) => ({ok, status, json: async () => plain(value)});
  let nearbyReply = async () => response(scope.nearby);
  let nearbyReadReply = async () => response(scope.nearby);
  let shelfFailure = null;
  scope.window = {
    setTimeout:()=>0, clearTimeout(){},
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value))},
    async fetch(url, options = {}) {
      calls.requests.push({url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined});
      if (url === '/api/nearby') return options.method === 'POST' ? nearbyReply(calls.requests.at(-1).body) : nearbyReadReply();
      assert.equal(options.method, 'DELETE');
      assert(url.startsWith('/api/shelf/'), 'test cannot access arbitrary endpoints');
      if (shelfFailure) {const failure = shelfFailure; shelfFailure = null; throw failure;}
      const id = url.slice('/api/shelf/'.length);
      backendFiles = backendFiles.filter(item => item.id !== id);
      return response({items: backendFiles});
    },
  };
  const code = [
    production('  function renderSearchRoute() {', '  async function invokeSearch('),
    production('  function renderExperience() {', '  function settingsNaturalPanelHeight() {'),
    production('  function acceptedFile(', '  async function fileRequest('),
    production('  async function downloadShelfFiles(', '  async function shelfFileAction('),
    production('  function setShelf(', '  async function loadShelf('),
    production('  async function shelfCommand(', '  function shelfInputChanged('),
    production('  async function nearbyRequest(', '  const filePlayer ='),
    production('  function openLocalSend(', '  function renderNearby('),
    production('  function renderNearby() {', '  function nearbyLifecycle() {'),
    production('  function selectViewButton(', '  function renderMenuSelection('),
    production('  function settingsCommand(', '  function renderExperience() {'),
    'this.getFavorites = () => peerFavorites;',
  ].join('\n');
  vm.runInNewContext(code, scope, {timeout: 500, filename: 'production-experience-handlers.js'});
  const healthComponent = experience.create({healthHost: nodes.get('health-player'), modulesHost: nodes.get('modules-experience'), t: translate, onAction: action => pending.push(scope.experienceAction(action))});
  scope.experience = {...healthComponent, renderHealth(value) {calls.health.push(plain(value)); return healthComponent.renderHealth(value);}};
  const sharingComponent = sharing.create({host: nodes.get('sharing-experience'), t: translate, onAction: (command, value) => pending.push(scope.sharingAction(command, value))});
  scope.sharingExperience = {...sharingComponent, render(value) {calls.sharing.push(plain(value)); sharingComponent.render(value);}};
  const find = (host, predicate) => descendants(host, predicate)[0];
  const sharingControl = (command, predicate = () => true) => find(nodes.get('sharing-experience'), node => node.dataset.sharingCommand === command && predicate(node));
  const clickSharing = (command, predicate) => {
    const node = sharingControl(command, predicate); assert(node, `sharing ${command} control exists`);
    nodes.get('sharing-experience').listeners.click({target: node}); return node;
  };
  const clickHealth = action => {
    const host = nodes.get('health-player'), node = find(host, node => action === 'back' ? node.dataset.experienceCommand === 'back' : node.dataset.experienceItem === action);
    assert(node, `health ${action} control exists`); host.listeners.click({target: node});
  };
  scope.renderExperience();
  return {
    scope, calls, storage, document, downloads, nodes, find, sharingControl, clickSharing, clickHealth, settingsHealth,
    async flush() {while (pending.length) await Promise.all(pending.splice(0));},
    nearbyReply(callback) {nearbyReply = callback;}, nearbyReadReply(callback) {nearbyReadReply = callback;}, response,
    failNextShelfRequest(error) {shelfFailure = error;},
    dispose() {scope.disposed = true; sharingComponent.dispose(); healthComponent.dispose();},
  };
}

test('production sharing integration selects and downloads exactly the chosen shelf files', async () => {
  const f = fixture();
  f.clickSharing('select', node => node.dataset.sharingFile === file('a').id); await f.flush();
  f.clickSharing('select', node => node.dataset.sharingFile === file('c').id); await f.flush();
  assert.deepEqual([...f.scope.selectedFiles], [file('a').id, file('c').id]);
  f.clickSharing('download'); await f.flush();
  assert.deepEqual(f.downloads, [{href: '/api/shelf/' + file('a').id, name: 'a.pdf'}, {href: '/api/shelf/' + file('c').id, name: 'c.pdf'}]);
  assert.equal(f.document.body.querySelectorAll('a').length, 0, 'temporary download links are removed');
  f.clickSharing('select-all'); await f.flush(); assert.equal(f.scope.selectedFiles.size, 3);
  f.clickSharing('select-all'); await f.flush(); assert.equal(f.scope.selectedFiles.size, 0);
  assert.equal(f.calls.requests.length, 0, 'selection and link creation do not mutate backend files');
  f.dispose();
});

test('native Tray export sends only selected opaque IDs, retains originals and avoids browser links', async () => {
  const f=fixture(), exported=[], notices=[];
  const status=f.document.createElement('p'); f.nodes.set('shelf-status',status);
  f.scope.notifyModuleChange=value=>notices.push(plain(value));
  f.scope.desktop.exportShelfItems=async ids=>{exported.push([...ids]);return {ok:true,saved:ids.map(id=>({id,name:'copy.pdf'}))};};
  await f.scope.sharingAction('select',{selectedIds:[file('a').id,file('c').id]});
  f.clickSharing('download'); await f.flush();
  assert.deepEqual(exported,[[file('a').id,file('c').id]]);
  assert.deepEqual(f.downloads,[]); assert.equal(f.scope.shelfItems.length,3); assert.equal(f.scope.shelfBusy,false);
  assert.match(f.find(f.nodes.get('sharing-experience'),node=>node.className==='sharing-file-status').textContent,/2 fichier/);
  assert.equal(notices.length,1); f.dispose();
});

test('native export rejection stays with Shelf, reenables controls and never claims success', async () => {
  const f=fixture(), notices=[];
  const status=f.document.createElement('p'); f.nodes.set('shelf-status',status);
  f.scope.notifyModuleChange=value=>notices.push(plain(value));
  f.scope.desktop.exportShelfItems=async()=>({ok:false,error:'Downloads storage unavailable'});
  await f.scope.sharingAction('select',{selectedIds:[file('a').id]});
  f.clickSharing('download'); await f.flush(); f.scope.renderExperience();
  assert.equal(f.scope.shelfBusy,false); assert.equal(f.scope.shelfDownloadError,true); assert.deepEqual(notices,[]);
  assert.equal(f.find(f.nodes.get('sharing-experience'),node=>node.className==='sharing-file-status').textContent,'Downloads storage unavailable');
  assert.equal(f.find(f.nodes.get('sharing-experience'),node=>node.className==='sharing-status').textContent,'');
  assert.equal(f.scope.shelfItems.length,3); assert.deepEqual(f.downloads,[]); f.dispose();
});

test('production bulk remove invokes actual shelf deletion and preserves unselected files', async () => {
  const f = fixture();
  await f.scope.sharingAction('select', {selectedIds: [file('a').id, file('c').id, 'missing']});
  f.clickSharing('remove'); await f.flush();
  assert.deepEqual(f.calls.requests.map(value => [value.method, value.url]), [['DELETE', '/api/shelf/' + file('a').id], ['DELETE', '/api/shelf/' + file('c').id]]);
  assert.deepEqual(plain(f.scope.shelfItems).map(value => value.id), [file('b').id]);
  assert.equal(f.scope.selectedFiles.size, 0); assert.equal(f.scope.shelfBusy, false);
  assert(f.nodes.get('sharing-experience').textContent.includes('b.pdf'));
  f.dispose();
});

test('bulk-remove failure keeps existing files and reports the actual backend failure', async () => {
  const f = fixture();
  await f.scope.sharingAction('select', {selectedIds: [file('a').id, file('c').id]});
  f.failNextShelfRequest(new Error('Fixture storage unavailable'));
  f.clickSharing('remove'); await f.flush();
  assert.equal(f.calls.requests.length, 1);
  assert.equal(f.scope.shelfItems.length, 3); assert.equal(f.scope.shelfBusy, false);
  assert.equal(f.scope.shelfError, 'Fixture storage unavailable');
  assert(f.nodes.get('sharing-experience').textContent.includes('Fixture storage unavailable'));
  f.dispose();
});

test('favorite persistence uses certificate identity across new live IDs and supports offline removal', async () => {
  const storage = new Map(), first = peer('old-session');
  const f = fixture({peers: [first], storage});
  f.clickSharing('favorite'); await f.flush();
  const saved = JSON.parse(storage.get('notchy-peer-favorites-v1'));
  assert.deepEqual(saved, [{identity: first.identity, alias: first.alias, deviceType: 'mobile'}]);
  assert(!JSON.stringify(saved).includes(first.id), 'transient send ID is not persisted');
  f.dispose();
  const reloaded = fixture({storage, peers: [peer('new-session', first.identity, 'Renamed fixture phone')]});
  const star = reloaded.sharingControl('favorite');
  assert.equal(star.attributes['aria-pressed'], 'true');
  assert(reloaded.nodes.get('sharing-experience').textContent.includes('Renamed fixture phone'));
  reloaded.scope.nearby.peers = []; reloaded.scope.renderExperience();
  assert.equal(reloaded.sharingControl('favorite'), star, 'stable identity keeps the actual favorite control');
  assert(reloaded.nodes.get('sharing-experience').textContent.includes('Hors ligne'));
  const offline = reloaded.sharingControl('send', node => node.dataset.sharingPeer === 'offline:' + first.identity);
  assert.equal(offline.disabled, true); reloaded.clickSharing('send', node => node === offline); await reloaded.flush();
  assert.equal(reloaded.calls.requests.length, 0);
  reloaded.clickSharing('favorite'); await reloaded.flush();
  assert.deepEqual(JSON.parse(storage.get('notchy-peer-favorites-v1')), []);
  assert.equal(reloaded.sharingControl('favorite'), undefined);
  reloaded.dispose();
});

test('send integration forwards only selected real file IDs and a currently present device ID', async () => {
  const live = peer('live-session'), f = fixture({peers: [live]});
  await f.scope.sharingAction('select', {selectedIds: [file('b').id]});
  f.clickSharing('send', node => node.dataset.sharingPeer === live.id); await f.flush();
  assert.deepEqual(f.calls.requests.map(value => value.body), [{command: 'share', peerId: live.id, ids: [file('b').id]}]);
  assert.equal(f.scope.view, 'localsend');
  assert.deepEqual(plain(f.scope.localSendContext.files).map(value => value.id), [file('b').id]);
  f.calls.requests.length = 0;
  await f.scope.sharingAction('send', {ids: [file('a').id, 'missing'], peerId: 'stale-session'});
  assert.equal(f.calls.requests.length, 0, 'a stale favorite/session cannot start a transfer');
  await f.scope.sharingAction('send', {ids: ['missing'], peerId: live.id});
  assert.equal(f.calls.requests.length, 0); assert.equal(f.scope.shelfError, 'Choisis un fichier à envoyer.');
  f.dispose();
});

test('manual IP submits the real command, disables controls while pending, and surfaces async failure', async () => {
  const f = fixture({peers: []});
  let rejectRequest;
  f.nearbyReply(() => new Promise((_, reject) => {rejectRequest = reject;}));
  f.clickSharing('manual-ip');
  const host = f.nodes.get('sharing-experience'), form = host.querySelector('form'), input = host.querySelector('input');
  input.value = '192.168.1.42';
  form.listeners.submit({preventDefault() {}, stopPropagation() {}});
  assert.deepEqual(f.calls.requests[0].body, {command: 'connect', address: '192.168.1.42'});
  assert.equal(f.scope.nearbyBusy, true); assert.equal(input.disabled, true);
  assert.equal(f.sharingControl('connect').disabled, true);
  rejectRequest(new Error('Fixture device unreachable')); await f.flush();
  assert.equal(f.scope.nearbyBusy, false); assert.equal(input.disabled, false);
  assert(host.textContent.includes('Fixture device unreachable'));
  assert.equal(f.scope.nearby.peers.length, 0, 'failure never manufactures an online peer');
  const actual = peer('registered-fixture-session');
  f.nearbyReply(async () => f.response({available: true, peers: [actual], transfer: null, incoming: null, error: null}));
  form.listeners.submit({preventDefault() {}, stopPropagation() {}}); await f.flush();
  assert.deepEqual(plain(f.scope.nearby.peers), [actual]);
  assert.equal(f.calls.requests.length, 2); assert(host.textContent.includes(actual.alias));
  f.dispose();
});

test('a successful nearby poll cannot hide a failed explicit connection until the next successful action', async () => {
  const f = fixture();
  const failure = 'Fixture registration failed';
  const clean = {available: true, peers: [peer('poll-discovered-device')], transfer: null, incoming: null, error: null};
  let finishConnect, finishPoll;
  f.nearbyReply(() => new Promise(resolve => {finishConnect = resolve;}));
  f.nearbyReadReply(() => new Promise(resolve => {finishPoll = resolve;}));
  const connection = f.scope.sharingAction('connect', {address: '192.168.1.42'});
  const concurrentPoll = f.scope.readNearby();
  assert.deepEqual(f.calls.requests.map(request => request.method), ['POST', 'GET']);
  finishConnect(f.response({...clean, peers: [], error: failure}, false, 503));
  await connection;
  const visibleError = () => {
    const status = f.nodes.get('sharing-experience').querySelector('.sharing-status');
    assert.equal(status.hidden, false);
    assert.equal(status.dataset.error, 'true');
    assert.equal(status.textContent, failure);
    assert.equal(f.nodes.get('shelf-nearby-status').textContent, failure);
  };
  visibleError();
  finishPoll(f.response(clean));
  await concurrentPoll;
  assert(f.nodes.get('sharing-experience').textContent.includes(clean.peers[0].alias), 'the successful concurrent poll really updates and renders the discovered peer');
  visibleError();
  f.nearbyReadReply(async () => f.response(clean));
  await f.scope.readNearby();
  visibleError();
  f.nearbyReply(async () => f.response(clean));
  await f.scope.sharingAction('discover');
  const status = f.nodes.get('sharing-experience').querySelector('.sharing-status');
  assert.equal(status.hidden, true);
  assert.equal(status.dataset.error, 'false');
  assert.equal(f.nodes.get('shelf-nearby-status').textContent, 'Choisis un appareil');
  assert.deepEqual(f.calls.requests.map(request => request.method), ['POST', 'GET', 'GET', 'POST']);
  f.dispose();
});

test('Health uses actual module state and firewall help cannot fabricate verified readiness', async () => {
  const f = fixture({view: 'health'});
  Object.assign(f.scope, {weather: {selectedCity: {name: 'Fixture city'}}, music: {available: true, source: 'Fixture player'}, startupEnabled: true, queueState: {status: 'ok'}});
  f.scope.renderExperience();
  const rows = f.calls.health.at(-1).items;
  assert.equal(rows.find(row => row.id === 'spotify').status, 'ready', 'the real successful Spotify queue status means connected');
  assert.equal(rows.find(row => row.id === 'firewall').status, 'unknown');
  assert(!f.nodes.get('health-player').textContent.includes('Tout est prêt'));
  f.clickHealth('firewall'); await f.flush();
  assert(f.nodes.get('health-player').textContent.includes('pare-feu Windows'));
  assert.equal(f.calls.health.at(-1).items.find(row => row.id === 'firewall').status, 'unknown');
  assert.equal(f.calls.requests.length, 0, 'firewall help cannot change Windows policy or fake a repair');
  f.dispose();
});

test('Health routes through Settings and returning to Nook preserves its existing page', async () => {
  const f = fixture({view: 'settings'});
  f.scope.settingsCommand({target: f.settingsHealth});
  assert.equal(f.scope.view, 'health'); assert.equal(f.nodes.get('health-player').hidden, false);
  f.clickHealth('back'); await f.flush();
  assert.equal(f.scope.view, 'settings'); assert.equal(f.nodes.get('health-player').hidden, true);
  f.scope.selectViewButton({dataset: {view: 'nook'}});
  assert.equal(f.scope.view, 'nook'); assert.equal(f.scope.islandPage, 'essential');
  assert.equal(f.nodes.get('health-player').hidden, true); assert.equal(f.nodes.get('sharing-experience').hidden, true);
  f.scope.selectViewButton({dataset: {view: 'tray'}});
  f.scope.openLocalSend('send', [f.scope.shelfItems[0]]);
  assert.equal(f.scope.view, 'localsend');
  f.scope.closeLocalSend(true);
  assert.equal(f.scope.view, 'tray'); assert.equal(f.scope.state, 'open');
  assert.equal(f.nodes.get('sharing-experience').hidden, false); assert.equal(f.scope.islandPage, 'essential');
  f.dispose();
});

test('an incoming LocalSend request during search returns to the previous usable route', () => {
  const f = fixture({view: 'search'});
  const closed = [];
  f.scope.searchReturnView = 'tray';
  f.scope.search = {close: options => closed.push(options)};
  f.scope.openLocalSend('receive', {id: 'request-1', alias: 'Fixture phone', files: [file('a')]});
  assert.equal(f.scope.view, 'localsend');
  assert.equal(f.scope.localSendContext.returnView, 'tray');
  assert.equal(closed.length, 1);
  f.scope.closeLocalSend(false);
  assert.equal(f.scope.view, 'tray');
  assert.equal(f.scope.localSendContext, null);
  f.dispose();
});
