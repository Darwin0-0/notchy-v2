'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createActivityScene} = require('../notch.js');
const activity = (id, extra = {}) => ({id, key: id, label: id, value: 'Real value', ...extra});
const order = scene => {const state = scene.inspect(); return [state.primary, ...state.rail].filter(Boolean);};

test('one real activity fills the scene; second and third additions keep stable rail positions', () => {
  const scene = createActivityScene();
  assert.deepEqual(scene.update(), {primary: null, rail: [], items: []});
  scene.update([activity('music')]); assert.deepEqual(order(scene), ['music']);
  scene.update([activity('music'), activity('transfer')]); assert.deepEqual(order(scene), ['music', 'transfer']);
  scene.update([activity('focus'), activity('music'), activity('transfer')]); assert.deepEqual(order(scene), ['focus', 'music', 'transfer']);
  scene.update([activity('transfer'), activity('music'), activity('focus')]); assert.deepEqual(order(scene), ['focus', 'music', 'transfer'], 'data arrival order never reorders established positions');
});

test('promoting a rail card swaps only its place with the primary and persists across ticks', () => {
  const scene = createActivityScene();
  scene.update([activity('focus'), activity('music'), activity('transfer')]);
  assert.equal(scene.promote('music'), true); assert.deepEqual(order(scene), ['music', 'focus', 'transfer']);
  scene.update([activity('focus', {value: '18:41'}), activity('music'), activity('transfer')]);
  assert.deepEqual(order(scene), ['music', 'focus', 'transfer']);
  assert.equal(scene.promote('transfer'), true); assert.deepEqual(order(scene), ['transfer', 'focus', 'music']);
  assert.equal(scene.promote('weather'), false); assert.deepEqual(order(scene), ['transfer', 'focus', 'music']);
});

test('a completed transfer confirms in place once and retires without stopping other activities', () => {
  let now = 0; const scene = createActivityScene({now: () => now, confirmation: 1600});
  const focus = activity('focus'), music = activity('music'), transfer = activity('transfer', {key: 'send-1', progress: .9});
  scene.update([focus, music, transfer]); scene.promote('music');
  let state = scene.update([focus, music], {completed: ['transfer']});
  assert.deepEqual(order(scene), ['music', 'focus', 'transfer']); assert.equal(state.items[2].complete, true); assert.equal(state.items[2].progress, 1);
  now = 1599; state = scene.update([focus, music], {completed: ['transfer']}); assert.equal(state.items.length, 3);
  now = 1600; state = scene.update([focus, music], {completed: ['transfer']}); assert.deepEqual(order(scene), ['music', 'focus']);
  now = 9999; scene.update([focus, music], {completed: ['transfer']}); assert.deepEqual(order(scene), ['music', 'focus'], 'terminal data cannot recreate a retired confirmation');
});

test('cancellation retires immediately and loss of primary chooses Focus before recent activities', () => {
  const scene = createActivityScene();
  scene.update([activity('focus'), activity('music'), activity('transfer')]); scene.promote('transfer');
  scene.update([activity('music'), activity('focus')]); assert.deepEqual(order(scene), ['focus', 'music']);
  scene.promote('music'); scene.update([activity('focus')]); assert.deepEqual(order(scene), ['focus']);
  scene.update([]); assert.deepEqual(order(scene), []);
});

test('without Focus a departed primary yields to the interacting activity, then the most recent start', () => {
  const scene = createActivityScene();
  scene.update([activity('music')]); scene.update([activity('music'), activity('file')]); scene.update([activity('music'), activity('file'), activity('transfer')]);
  scene.update([activity('file'), activity('transfer')], {interacting: 'file'}); assert.deepEqual(order(scene), ['file', 'transfer']);
  scene.update([]); scene.update([activity('music')]); scene.update([activity('music'), activity('file')]); scene.update([activity('music'), activity('file'), activity('transfer')]);
  scene.update([activity('file'), activity('transfer')]); assert.deepEqual(order(scene), ['transfer', 'file']);
});

test('new real work replaces a terminal confirmation and never creates more than three cards', () => {
  let now = 0; const scene = createActivityScene({now: () => now});
  scene.update([activity('focus'), activity('music'), activity('transfer', {key: 'first'})]);
  scene.update([activity('focus'), activity('music')], {completed: ['transfer']});
  scene.update([activity('focus'), activity('music'), activity('file')]); assert.deepEqual(order(scene), ['focus', 'music', 'file']);
  scene.update([activity('focus'), activity('music'), activity('transfer', {key: 'second'})]);
  assert.deepEqual(order(scene), ['focus', 'music', 'transfer']); assert.equal(scene.inspect().items[2].complete, false);
});

test('scene models ignore invalid ids and duplicates without mutating input or leaking internal state', () => {
  const scene = createActivityScene(), values = [null, activity('retired-module'), activity('music'), activity('music'), activity('focus')], before = structuredClone(values);
  const state = scene.update(values); assert.deepEqual(order(scene), ['focus', 'music']); assert.deepEqual(values, before);
  state.items[0].label = 'Changed'; state.rail.push('file'); assert.equal(scene.inspect().items[0].label, 'focus'); assert.deepEqual(order(scene), ['focus', 'music']);
});

test('restarting Focus during its completion confirmation gives the new session the scene', () => {
  const scene = createActivityScene();
  scene.update([activity('focus'), activity('music')]); scene.promote('music');
  scene.update([activity('music')], {completed: ['focus']}); assert.equal(scene.inspect().items[1].complete, true);
  scene.update([activity('focus'), activity('music')]); assert.deepEqual(order(scene), ['focus', 'music']); assert.equal(scene.inspect().items[0].complete, false);
});
