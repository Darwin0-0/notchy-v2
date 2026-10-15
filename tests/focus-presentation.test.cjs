'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const {FocusModel, renderClock} = require('../focus.js');

function commands({paused = false, expired = false, configOpen = false, finalBreak = false, initiatedHere = false} = {}) {
  const model = FocusModel.restore({minutes: 1, remaining: 40, sessionActive: true, deadline: paused ? null : 70000,
    tasks: [{id: 'a', title: 'Draft', estimatedCycles: 2}, {id: 'done', title: 'Sent', done: true}, {id: 'b', title: 'Review'}],
    activeTaskId: 'a', pomodoro: {work: 1, rest: 1, longRest: 1, total: finalBreak ? 1 : 4, session: 1, phase: finalBreak ? 'break' : 'work', ...(finalBreak ? {breakKind: 'long'} : {})}}, 10000);
  const source = fs.readFileSync(require.resolve('../focus.js'), 'utf8');
  const begin = source.indexOf('    function command(value)'), end = source.indexOf('    function submitTask(', begin);
  const writes = [], events = [], focused = [], scope = {FocusModel, model, disposed: false, configOpen, now: () => expired ? 70000 : 30000,
    active: () => !model.pomodoro?.finished && (model.sessionActive || !!model.deadline), window: {},
    document: {activeElement: {matches: () => initiatedHere}}, restoreTaskFocus() {focused.push('shared-visible-control');},
    $(id) {return {focus() {focused.push(id);}};},
    save() {writes.push(JSON.parse(JSON.stringify(model)));}, render(notify, event) {if (event) events.push(event);}};
  vm.runInNewContext(`${source.slice(begin, end)}this.run=command;`, scope);
  return {state: model, run: scope.run, writes, events, focused};
}
const schedule = state => JSON.stringify([state.minutes, state.remaining, state.deadline, state.pomodoro]);

test('Next task wraps past completed tasks and preserves both running and paused phases', () => {
  for (const paused of [false, true]) {
    const f = commands({paused}), before = schedule(f.state);
    assert.equal(f.run('next-task'), true); assert.equal(f.state.activeTaskId, 'b');
    assert.equal(schedule(f.state), before); assert.equal(f.state.tasks[0].completedCycles, 0);
    assert.equal(f.run('next-task'), true); assert.equal(f.state.activeTaskId, 'a');
    assert.equal(schedule(f.state), before);
    f.state.activeTaskId = null; f.state.task = '';
    assert.equal(f.run('next-task'), true); assert.equal(f.state.activeTaskId, 'a');
  }
});

test('Next task at an expired work boundary credits the old task and never skips the new break', () => {
  const f = commands({expired: true});
  assert.equal(f.run('next-task'), true); assert.equal(f.state.activeTaskId, 'b');
  assert.equal(f.state.tasks[0].completedCycles, 1); assert.equal(f.state.tasks[2].completedCycles, 0);
  assert.equal(f.state.pomodoro.phase, 'break'); assert.equal(f.state.deadline, 130000);
  assert.deepEqual(f.state.taskPrompt, {kind: 'cycle-complete', taskId: 'a'});
  assert.equal(f.writes.at(-1).activeTaskId, 'b');
});

test('Done explicitly completes only the linked task and proposes continuation without resetting time', () => {
  const f = commands(), before = schedule(f.state);
  assert.equal(f.run('complete-task'), true); assert.equal(f.state.tasks[0].done, true);
  assert.equal(f.state.tasks[2].done, false); assert.equal(f.state.activeTaskId, null);
  assert.deepEqual(f.state.taskPrompt, {kind: 'continue', taskId: 'a'});
  assert.equal(schedule(f.state), before); assert.equal(f.events.length, 1);
  assert.equal(f.run('complete-task'), false); assert.equal(f.events.length, 1);
  f.state.tasks[2].done = true; assert.equal(f.run('next-task'), false);
  assert.deepEqual(f.focused, [], 'API calls never steal focus from an unrelated control');
});

test('Done initiated from its own control restores visible shared focus after the button is disabled', () => {
  const f = commands({initiatedHere: true}), before = schedule(f.state);
  assert.equal(f.run('complete-task'), true);
  assert.deepEqual(f.focused, ['shared-visible-control']);
  assert.equal(schedule(f.state), before); assert.equal(f.state.taskPrompt.kind, 'continue');
});

test('Skip at the final long-break boundary focuses the visible configuration back control', () => {
  for (const configOpen of [false, true]) {
    const f = commands({expired: true, finalBreak: true, configOpen});
    assert.equal(f.run('skip'), true); assert.equal(f.state.pomodoro.finished, true);
    assert.deepEqual(f.focused, [configOpen ? 'focus-config-back' : 'focus-start']);
  }
});

function clockFixture() {
  const effects = [], document = {createElement: () => new Element()};
  class Element {
    constructor() {this.children = []; this.dataset = {}; this.textContent = ''; this.ownerDocument = document;}
    get firstElementChild() {return this.children[0];}
    get lastElementChild() {return this.children.at(-1);}
    append(...nodes) {for (const node of nodes) {node.parent = this; this.children.push(node);}}
    replaceChildren(...nodes) {this.children = []; this.append(...nodes);}
    remove() {if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);}
    cloneNode() {const clone = new Element(); clone.textContent = this.textContent; clone.className = this.className; return clone;}
    getAnimations() {return [];}
    animate(frames, options) {effects.push({frames, options}); return {finished: Promise.resolve()};}
  }
  const text = element => element.children.length ? element.children.map(text).join('') : element.textContent;
  return {clock: new Element(), effects, text};
}

test('shared Focus clock supports 180 minutes, rolls only changed digits and respects reduced motion', async () => {
  const f = clockFixture();
  renderClock(f.clock, 10800, {motion: true});
  assert.equal(f.text(f.clock), '180:00'); assert.equal(f.clock.children.length, 6); assert.equal(f.effects.length, 0);
  renderClock(f.clock, 10799, {motion: true});
  assert.equal(f.effects.length, 8, 'four changed digits each fade out and in');
  assert(f.effects.every(effect => effect.options.duration === 240));
  await Promise.resolve(); assert.equal(f.text(f.clock), '179:59');
  assert(f.clock.children.every(cell => cell.children.length === 1), 'old digits are removed');
  renderClock(f.clock, 10798, {motion: false});
  assert.equal(f.text(f.clock), '179:58'); assert.equal(f.effects.length, 8);
  renderClock(f.clock, 10798, {motion: true}); assert.equal(f.effects.length, 8, 'unchanged seconds do not animate');
  renderClock(f.clock, 59, {motion: false}); assert.equal(f.text(f.clock), '00:59');
});
