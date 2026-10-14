const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../focus.js'), 'utf8');

test('early Focus script waits for the selected lab host and mounts once', () => {
  let ready, mounts = 0, host = null;
  const document = {readyState: 'loading', body: null, getElementById: () => host,
    addEventListener(name, callback, options) {assert.equal(name, 'DOMContentLoaded'); assert.equal(options.once, true); ready = callback;}};
  const window = {document};
  vm.runInNewContext(source, {window});
  assert.equal(typeof window.NotchyFocus.create, 'function');
  window.NotchyFocus.mountLab = () => {mounts++; window.notchyFocusLab = {};};
  assert.equal(mounts, 0);
  document.body = {hasAttribute: name => name === 'data-focus-lab'}; host = {};
  ready(); ready();
  assert.equal(mounts, 1);
});

test('normal pages and missing lab hosts never mount an isolated timer', () => {
  for (const selected of [false, true]) {
    const document = {readyState: 'complete', body: {hasAttribute: () => selected}, getElementById: () => null};
    const window = {document};
    vm.runInNewContext(source, {window});
    assert.equal(typeof window.NotchyFocus.create, 'function');
    assert.equal(window.notchyFocusLab, undefined);
  }
});
