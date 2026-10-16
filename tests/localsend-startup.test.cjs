'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const i18n = require('../i18n.js');
const source = fs.readFileSync(require.resolve('../notch.js'), 'utf8');
const start = source.indexOf('  function renderExperience() {'), end = source.indexOf('  async function experienceAction(', start);
assert(start > 0 && end > start);
const startupError = 'LocalSend ne peut pas écouter le réseau local. Vérifie le réseau et les autorisations Windows.';

function fixture({ view = 'health', language = 'en', nearby = {}, requestError = '' } = {}) {
  const languageApi = i18n.create({ language });
  languageApi.setLocale(language);
  const nodes = new Map(['module-library-player', 'health-player', 'sharing-experience'].map(id => [id, {}]));
  const rendered = {};
  const scope = { view, state: 'open', disposed: false, moduleEditing: false, moduleLibrary: null,
    renderSearchRoute() {}, renderDetailReturn() {}, byId: id => nodes.get(id), notch: { dataset: {} },
    t: languageApi.t, uiMessage: languageApi.message,
    experience: { renderHealth: value => { rendered.health = JSON.parse(JSON.stringify(value)); } },
    sharingExperience: { render: value => { rendered.tray = JSON.parse(JSON.stringify(value)); } },
    nearby: { available: false, peers: [], transfer: null, incoming: null, ...nearby }, nearbyError: requestError, nearbyBusy: false,
    weather: {}, weatherBusy: false, queueBusy: false, queueState: { status: 'disconnected' }, music: { available: false },
    startupBusy: false, startupEnabled: false, desktop: { startup: { supported: false } },
    shelfItems: [], selectedFiles: new Set(), shelfBusy: false, shelfError: '', shelfDownloadError: false, peerFavorites: [],
  };
  vm.runInNewContext(source.slice(start, end) + ';renderExperience();', scope);
  return { scope, rendered, network: rendered.health?.items.find(item => item.id === 'network') };
}

test('a LocalSend launch failure is visible in Health without ever opening Tray', () => {
  const value = fixture({ nearby: { status: 'error', error: startupError } });
  assert.equal(value.network.status, 'error');
  assert.equal(value.network.detail, 'LocalSend cannot listen on the local network. Check your connection and Windows permissions.');
  assert.equal(value.network.action, 'network'); assert.equal(value.network.actionLabel, 'Enable');
  assert.equal(value.rendered.tray, undefined);
});

test('Tray exposes a native startup error even when no interface command has failed', () => {
  const value = fixture({ view: 'tray', nearby: { status: 'error', error: startupError } });
  assert.equal(value.rendered.tray.status.error, true); assert.equal(value.rendered.tray.status.message, 'LocalSend cannot listen on the local network. Check your connection and Windows permissions.');
  assert.equal(value.rendered.tray.available, false);
});

test('a confirmed active listener is shown as ready while a deliberate Stop remains off without error', () => {
  const active = fixture({ nearby: { available: true, status: 'discovering' } });
  assert.equal(active.network.status, 'ready'); assert.equal(active.network.detail, 'LocalSend is running');
  const stopped = fixture({ nearby: { available: false, status: 'off', error: null } });
  assert.equal(stopped.network.status, 'unknown'); assert.equal(stopped.network.detail, 'Local sharing is off');
  assert.equal(fixture({ view: 'tray' }).rendered.tray.status.error, false);
});

test('a user-action error takes precedence over an older startup error', () => {
  const value = fixture({ nearby: { error: startupError }, requestError: 'Action rejected' });
  assert.equal(value.network.status, 'error'); assert.equal(value.network.detail, 'Action rejected');
});

test('the existing French and English message formatter handles the native listener failure', () => {
  assert.equal(fixture({ language: 'fr', nearby: { error: startupError } }).network.detail, startupError);
  assert.equal(fixture({ view: 'tray', language: 'fr', nearby: { error: startupError } }).rendered.tray.status.message, startupError);
});
