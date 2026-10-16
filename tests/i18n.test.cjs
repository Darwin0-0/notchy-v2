'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {create} = require('../i18n.js');

function storage(saved = {}) {
  const values = new Map(Object.entries(saved));
  return {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values};
}
test('The language choice persists independently and notifies only real changes', () => {
  const saved = storage({'notchy-minimal-focus-v1': '{"deadline":12345}', 'notchy-minimal-modules-v1': '{"slots":["music"]}'});
  const i18n = create(saved), changes = [], remove = i18n.onChange(value => changes.push(value));
  assert.equal(i18n.locale(), 'fr'); assert.equal(i18n.t('Réglages'), 'Réglages');
  assert.equal(i18n.setLocale('en'), true); assert.equal(i18n.t('Réglages'), 'Settings');
  assert.equal(i18n.setLocale('en'), false); assert.equal(i18n.setLocale('de'), false);
  assert.equal(create(saved).locale(), 'en');
  assert.equal(saved.getItem('notchy-minimal-focus-v1'), '{"deadline":12345}');
  assert.equal(saved.getItem('notchy-minimal-modules-v1'), '{"slots":["music"]}');
  remove(); i18n.setLocale('fr'); assert.deepEqual(changes, ['en']);
});
test('Only application messages are translated; interpolated titles and unknown strings stay intact', () => {
  const i18n = create(null); i18n.setLocale('en');
  assert.equal(i18n.t('Choisir pour Focus : {task}', {task: 'Pause courte <script>'}), 'Choose for Focus: Pause courte <script>');
  assert.equal(i18n.t('{count} fichiers', {count: 8}), '8 files');
  assert.equal(i18n.t('Supprimer : {task}', {task: '{minutes}'}), 'Delete: {minutes}');
  for (const text of ['constructor', 'toString', '__proto__', 'unknown operating system error']) assert.equal(i18n.t(text), text);
  assert.equal(i18n.t('  Ajouter une tâche  '), '  Add a task  ');
  assert.equal(i18n.message('Le transfert a été interrompu.'), 'The transfer was interrupted.');
  i18n.setLocale('fr'); assert.equal(i18n.message('The transfer was interrupted.'), 'Le transfert a été interrompu.');
});
test('An invalid saved language and unavailable storage retain a usable French default', () => {
  assert.equal(create(storage({'notchy-language-v1': 'unknown'})).locale(), 'fr');
  const unavailable = create({getItem() {throw new Error('denied');}, setItem() {throw new Error('denied');}});
  assert.equal(unavailable.locale(), 'fr'); assert.equal(unavailable.setLocale('en'), true);
  const context = {window: {get localStorage() {throw new Error('denied');}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../i18n.js'), 'utf8'), context);
  assert.equal(context.window.NotchyI18n.locale(), 'fr');
});
test('Source HTML binding translates only marked nodes and restores their French source', () => {
  const i18n = create(null), fixed = {nodeType: 3, nodeValue: 'Réglages'}, user = {nodeType: 3, nodeValue: 'Pause courte'};
  const attributes = {'data-i18n': '', 'data-i18n-aria-label': 'Fermer les réglages'};
  const marked = {childNodes: [fixed], hasAttribute: name => Object.hasOwn(attributes, name), getAttribute: name => attributes[name], setAttribute: (name, value) => attributes[name] = value};
  const document = {documentElement: {}, querySelectorAll: () => [marked], user};
  const render = i18n.bind(document); render(); i18n.setLocale('en'); render();
  assert.equal(fixed.nodeValue, 'Settings'); assert.equal(attributes['aria-label'], 'Close settings');
  assert.equal(user.nodeValue, 'Pause courte'); assert.equal(document.documentElement.lang, 'en');
  i18n.setLocale('fr'); render(); assert.equal(fixed.nodeValue, 'Réglages');
});
test('The native preference bridge hydrates and stores the same language key without replacing Focus', async () => {
  const app = fs.readFileSync(path.join(__dirname, '../src-tauri/src/settings.rs'), 'utf8');
  const keys = [...app.match(/const KEYS:[\s\S]*?= \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
  const calls = []; class Storage {constructor() {this.values = new Map();} getItem(key) {return this.values.get(key) ?? null;} setItem(key, value) {this.values.set(key, String(value));} removeItem(key) {this.values.delete(key);}}
  const localStorage = new Storage(), context = {Storage, localStorage, location: new URL('http://127.0.0.1:1234/?desktop=1'), URL, Request, Headers, ArrayBuffer, Uint8Array, DataView, TextDecoder};
  context.window = {fetch: async () => ({ok: true}), EventSource: class {}, __TAURI__: {core: {invoke: async (command, args) => {calls.push(args.value); return {ok: true};}}, event: {listen: async () => () => {}}}};
  const bridge = fs.readFileSync(path.join(__dirname, '../src-tauri/src/window_bridge.js'), 'utf8');
  vm.runInNewContext(bridge.replace('__NOTCHY_CONFIG__', JSON.stringify({token: 'test-token', keys, preferences: {'notchy-language-v1': 'en', 'notchy-minimal-focus-v1': '{"deadline":12345}'}})), context);
  const i18n = create(localStorage); assert.equal(i18n.locale(), 'en'); i18n.setLocale('fr'); await Promise.resolve();
  assert.equal(calls.length, 1); assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), {command: 'preference', value: {key: 'notchy-language-v1', value: 'fr'}});
  assert.equal(localStorage.getItem('notchy-minimal-focus-v1'), '{"deadline":12345}');
});
