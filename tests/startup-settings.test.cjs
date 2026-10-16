'use strict';
const {test} = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../notch.js'), 'utf8');
function fixture(desktop = null) {
  const elements = new Map(['startup-control', 'startup-windows', 'startup-status'].map(id => [id, {}]));
  const context = {desktop, disposed: false, view: 'settings', byId: id => elements.get(id), t: text => text, text: (node, value) => {node.textContent = value;}, update: () => {}};
  const functions = source.slice(source.indexOf('  let startupEnabled = '), source.indexOf('  function renderSettings()'));
  vm.runInNewContext(`${functions};this.api={renderStartupSettings,startupInput};`, context);
  context.api.renderStartupSettings();
  return {api: context.api, elements, input: enabled => context.api.startupInput({target: {id: 'startup-windows', checked: enabled}})};
}

test('the Windows startup control is native-only and starts with the real native registration', () => {
  assert.equal(fixture().elements.get('startup-control').hidden, true);
  const f = fixture({startup: {supported: true, enabled: true}});
  assert.equal(f.elements.get('startup-control').hidden, false);
  assert.equal(f.elements.get('startup-windows').checked, true);
});

test('startup saves once, disables the switch during the request and follows the confirmed result', async () => {
  let finish, requests = 0;
  const f = fixture({startup: {supported: true, enabled: true}, setStartup: enabled => {requests++; assert.equal(enabled, false); return new Promise(resolve => {finish = resolve;});}});
  const pending = f.input(false);
  assert.equal(f.elements.get('startup-windows').disabled, true);
  await f.input(true); assert.equal(requests, 1);
  finish({ok: true, supported: true, enabled: false}); await pending;
  assert.equal(f.elements.get('startup-windows').disabled, false);
  assert.equal(f.elements.get('startup-windows').checked, false);
  assert.equal(f.elements.get('startup-status').hidden, true);
});

test('an unsuccessful startup change keeps the actual registration and offers a plain retry message', async () => {
  for (const setStartup of [async () => ({ok: false, enabled: true}), async () => {throw new Error('native unavailable');}]) {
    const f = fixture({startup: {supported: true, enabled: true}, setStartup});
    await f.input(false);
    assert.equal(f.elements.get('startup-windows').checked, true);
    assert.equal(f.elements.get('startup-windows').disabled, false);
    assert.equal(f.elements.get('startup-status').hidden, false);
    assert.equal(f.elements.get('startup-status').textContent, 'Impossible de modifier le démarrage. Réessaie.');
  }
});
