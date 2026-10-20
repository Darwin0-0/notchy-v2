const test = require('node:test');
const assert = require('node:assert/strict');
const {create} = require('../app.js');

test('the central entry waits for the document and starts one shared shell', () => {
  const callbacks = [], instance = {}, document = {readyState: 'loading', addEventListener(type, callback, options) {
    assert.equal(type, 'DOMContentLoaded'); assert.equal(options.once, true); callbacks.push(callback);
  }};
  let starts = 0;
  const app = create({document, NotchyShell: {create() {starts++; return instance;}}});
  assert.equal(app.boot(), null); assert.equal(app.boot(), null); assert.equal(callbacks.length, 1); assert.equal(starts, 0);
  document.readyState = 'interactive'; callbacks[0](); callbacks[0]();
  assert.equal(app.start(), instance); assert.equal(app.boot(), instance); assert.equal(starts, 1);
});

test('a deferred bundle starts immediately once DOM parsing has finished', () => {
  let starts = 0; const instance = {};
  const app = create({document: {readyState: 'interactive'}, NotchyShell: {create() {starts++; return instance;}}});
  assert.equal(app.boot(), instance); assert.equal(app.start(), instance); assert.equal(starts, 1);
});

test('missing shell dependencies fail before mounting and can be supplied before startup', () => {
  const window = {document: {readyState: 'complete'}}; const app = create(window);
  assert.throws(() => app.boot(), /shell is unavailable/);
  const instance = {}; window.NotchyShell = {create: () => instance};
  assert.equal(app.start(), instance);
});

test('a failed shell mount cannot be retried against partially attached listeners', () => {
  const failure = new Error('Missing dependency'); let starts = 0;
  const app = create({document: {readyState: 'complete'}, NotchyShell: {create() {starts++; throw failure;}}});
  assert.throws(() => app.start(), error => error === failure);
  assert.throws(() => app.start(), error => error === failure);
  assert.throws(() => app.boot(), error => error === failure);
  assert.equal(starts, 1);
});
test('recursive initialization cannot attach a second set of listeners or timers', () => {
  let app, starts = 0;
  app = create({document: {readyState: 'complete'}, NotchyShell: {create() {starts++; return app.start();}}});
  assert.throws(() => app.start(), /already starting/); assert.equal(starts, 1);
});
