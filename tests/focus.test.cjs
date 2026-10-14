const {test} = require('node:test');
const assert = require('node:assert/strict');
const {FocusModel: focus, focusConfiguration} = require('../notch.js');

test('Focus configuration starts with a complete Pomodoro and preserves valid settings', () => {
  assert.deepEqual(focusConfiguration(), {work: 25, rest: 5, longRest: 15, total: 4});
  assert.deepEqual(focusConfiguration({work: 45, rest: 7, longRest: 20, total: 6, foreign: true}),
    {work: 45, rest: 7, longRest: 20, total: 6});
  for (const settings of [{work: 1, rest: 1, longRest: 1, total: 1}, {work: 180, rest: 60, longRest: 180, total: 12}]) {
    assert.deepEqual(focusConfiguration(settings), settings);
  }
});

test('Focus configuration rejects invalid persisted types and remains inside integer bounds', () => {
  for (const value of [null, [], '25', false]) {
    assert.deepEqual(focusConfiguration(value), {work: 25, rest: 5, longRest: 15, total: 4});
  }
  const bounds = {work: [1, 180], rest: [1, 60], longRest: [1, 180], total: [1, 12]};
  for (const value of [0, -1, 100000, 2.5, '25', Infinity, NaN, null]) {
    const config = focusConfiguration({work: value, rest: value, longRest: value, total: value});
    for (const [key, [min, max]] of Object.entries(bounds)) {
      assert(Number.isInteger(config[key]) && config[key] >= min && config[key] <= max, `${key}: ${String(value)}`);
    }
  }
});

test('Focus restore validates persisted values and strips foreign properties', () => {
  for (const value of [null, [], {minutes: 0}, {minutes: 181}, {minutes: '25'}, {minutes: 25, deadline: 'soon'}, {minutes: 25, deadline: Infinity}]) {
    assert.deepEqual(focus.restore(value, 10000), focus.defaults());
  }
  const state = focus.restore({minutes: 10, remaining: 700, task: 'a'.repeat(700), sessionActive: 'yes', complete: true,
    foreign: 'ignored', pomodoro: {work: 25, rest: -1, total: 4, session: 1, phase: 'work'}}, 10000);
  assert.equal(state.remaining, 600);
  assert.equal(state.task.length, 500);
  assert.equal(state.sessionActive, false);
  assert.equal(state.complete, false);
  assert.equal(state.foreign, undefined);
  assert.equal(state.pomodoro, undefined);
});

test('active Focus follows an absolute deadline across sleep without replaying missed seconds', () => {
  const state = focus.restore({...focus.defaults(), deadline: 610000, remaining: 600, minutes: 10}, 10000);
  assert.equal(focus.remaining(state, 10000), 600);
  assert.equal(focus.remaining(state, 310000), 300);
  assert.equal(focus.remaining(state, 700000), 0);
  assert.equal(state.sessionActive, true);
});

test('completed phase boundaries remain compatible with automatic phase advancement', () => {
  const state = focus.restore({minutes: 25, remaining: 0, deadline: null, complete: true,
    pomodoro: {work: 25, rest: 5, total: 4, session: 1, phase: 'work'}}, 10000);
  assert.equal(focus.nextPhase(state, 10000), true);
  assert.equal(state.pomodoro.phase, 'break');
  assert.equal(state.pomodoro.session, 1);
  assert.equal(state.remaining, 300);
  assert.equal(state.deadline, 310000);
  Object.assign(state, {complete: true, deadline: null, remaining: 0});
  assert.equal(focus.nextPhase(state, 400000), true);
  assert.equal(state.pomodoro.phase, 'work');
  assert.equal(state.pomodoro.session, 2);
  assert.equal(state.remaining, 1500);
  assert.equal(state.deadline, 1900000);
});

test('last Pomodoro work enters a long break and finishes only after that break', () => {
  const state = focus.restore({minutes: 25, remaining: 0, complete: true,
    pomodoro: {work: 25, rest: 5, total: 4, session: 4, phase: 'work'}}, 10000);
  assert.equal(focus.nextPhase(state, 10000), true);
  assert.equal(state.pomodoro.phase, 'break');
  assert.equal(state.pomodoro.breakKind, 'long');
  assert.equal(state.minutes, 15);
  assert.equal(state.deadline, 910000);
  assert.equal(focus.tick(state, 910000).finished, true);
  assert.equal(state.pomodoro.finished, true);
  assert.equal(state.pomodoro.session, 4);
  assert.equal(state.complete, true);
  assert.equal(state.sessionActive, false);
  assert.equal(state.deadline, null);
  assert.equal(focus.tick(state, 920000).finished, false);
});

test('Pomodoro runs work and short breaks automatically before its final long break', () => {
  const start = 10000;
  const state = focus.restore({minutes: 25, remaining: 1500, deadline: start + 1500000, sessionActive: true,
    pomodoro: {work: 25, rest: 5, longRest: 15, total: 3, session: 1, phase: 'work'}}, start);
  const phases = [];
  for (let index = 0; index < 6; index++) {
    const boundary = state.deadline, result = focus.tick(state, boundary);
    phases.push([state.pomodoro.phase, state.pomodoro.breakKind || null, state.pomodoro.session, state.minutes, result.finished]);
    if (!result.finished) {
      assert.equal(state.complete, false);
      assert.equal(state.sessionActive, true);
      assert.equal(state.deadline, boundary + state.minutes * 60000);
    }
  }
  assert.deepEqual(phases, [
    ['break', 'short', 1, 5, false], ['work', null, 2, 25, false],
    ['break', 'short', 2, 5, false], ['work', null, 3, 25, false],
    ['break', 'long', 3, 15, false], ['break', 'long', 3, 15, true],
  ]);
});

test('sleep and reload catch up from real phase deadlines rather than extending the cycle', () => {
  const state = focus.restore({minutes: 25, remaining: 1500, deadline: 1510000, sessionActive: true,
    pomodoro: {work: 25, rest: 5, longRest: 15, total: 4, session: 1, phase: 'work'}}, 10000);
  assert.equal(focus.tick(state, 4300000).phaseChanged, true);
  assert.equal(state.pomodoro.session, 3);
  assert.equal(state.pomodoro.phase, 'work');
  assert.equal(state.deadline, 5110000);
  assert.equal(focus.remaining(state, 4300000), 810);
  const restored = focus.restore(JSON.parse(JSON.stringify(state)), 4400000);
  assert.equal(restored.deadline, 5110000);
  assert.equal(restored.pomodoro.longRest, 15);
  assert.equal(focus.tick(restored, 9000000).finished, true);
  assert.equal(restored.pomodoro.finished, true);
  assert.equal(restored.pomodoro.breakKind, 'long');
  assert.equal(restored.pomodoro.session, 4);
  assert.equal(restored.deadline, null);
});

test('pausing freezes both time and the Pomodoro schedule until resumed', () => {
  const state = focus.restore({minutes: 25, remaining: 723, sessionActive: true, deadline: null,
    pomodoro: {work: 25, rest: 5, longRest: 20, total: 2, session: 2, phase: 'work'}}, 10000);
  assert.equal(focus.tick(state, 90000000).changed, false);
  assert.equal(state.remaining, 723);
  assert.equal(state.pomodoro.session, 2);
  state.deadline = 90000000 + 723000;
  assert.equal(focus.tick(state, state.deadline).phaseChanged, true);
  assert.equal(state.minutes, 20);
  assert.equal(state.pomodoro.breakKind, 'long');
  assert.equal(state.deadline, 91923000);
});

test('older Pomodoro saves receive defaults without resetting paused time or deadlines', () => {
  const state = focus.restore({minutes: 25, remaining: 812, deadline: null, sessionActive: true,
    pomodoro: {work: 25, rest: 5, phase: 'work'}}, 10000);
  assert.equal(state.remaining, 812);
  assert.equal(state.deadline, null);
  assert.equal(state.pomodoro.total, 4);
  assert.equal(state.pomodoro.session, 1);
  assert.equal(state.pomodoro.longRest, 15);
  const legacy = focus.restore({minutes: 5, remaining: 0, complete: true,
    pomodoro: {work: 25, rest: 5, total: 4, session: 4, phase: 'break'}}, 10000);
  assert.equal(focus.tick(legacy, 10000).phaseChanged, true);
  assert.equal(legacy.pomodoro.breakKind, 'long');
  assert.equal(legacy.deadline, 910000);
});

test('finished cycles survive restoration and never restart in the background', () => {
  const saved = {minutes: 15, remaining: 0, deadline: null, sessionActive: false, complete: true,
    pomodoro: {work: 25, rest: 5, longRest: 15, total: 4, session: 4, phase: 'break', breakKind: 'long', finished: true}};
  const state = focus.restore(saved, 10000);
  assert.equal(state.pomodoro.finished, true);
  assert.equal(focus.tick(state, 99999999).changed, false);
  assert.equal(focus.nextPhase(state, 99999999), false);
  assert.equal(state.deadline, null);
});

test('simple timers finish once and invalid long-break settings are not restored', () => {
  const state = focus.restore({minutes: 1, remaining: 60, deadline: 70000}, 10000);
  assert.equal(focus.tick(state, 70000).finished, true);
  assert.equal(focus.tick(state, 71000).finished, false);
  const invalid = focus.restore({minutes: 25,
    pomodoro: {work: 25, rest: 5, longRest: 181, total: 4, session: 1, phase: 'work'}}, 10000);
  assert.equal(invalid.pomodoro, undefined);
  const early = focus.restore({minutes: 5, remaining: 300,
    pomodoro: {work: 25, rest: 5, longRest: 15, total: 4, session: 1, phase: 'break', breakKind: 'long', finished: true}}, 10000);
  assert.equal(early.pomodoro.breakKind, 'short');
  assert.equal(early.pomodoro.finished, undefined);
});

test('idle configuration stays idle and a paused session does not lose time during sleep', () => {
  const paused = focus.restore({minutes: 25, remaining: 723, deadline: null, sessionActive: true}, 10000);
  assert.equal(focus.remaining(paused, 0), 723);
  assert.equal(focus.remaining(paused, 90000000), 723);
  assert.equal(paused.deadline, null);
  const untouched = focus.restore({minutes: 25, remaining: 1500, deadline: null}, 10000);
  assert.equal(untouched.sessionActive, false);
});

test('one-session and maximum twelve-session cycles catch up completely and finish once', () => {
  for (const total of [1, 12]) {
    const start = 10000, duration = (total + total - 1 + 1) * 60000;
    const state = focus.restore({minutes: 1, remaining: 60, deadline: start + 60000, sessionActive: true,
      pomodoro: {work: 1, rest: 1, longRest: 1, total, session: 1, phase: 'work'}}, start);
    const result = focus.tick(state, start + duration);
    assert.equal(result.finished, true);
    assert.equal(state.pomodoro.session, total);
    assert.equal(state.pomodoro.phase, 'break');
    assert.equal(state.pomodoro.breakKind, 'long');
    assert.equal(state.pomodoro.finished, true);
    assert.equal(state.deadline, null);
    assert.equal(state.remaining, 0);
    assert.equal(state.sessionActive, false);
    assert.equal(focus.tick(state, start + duration + 99999999).changed, false);
  }
});
