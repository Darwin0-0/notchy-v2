const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {FocusModel} = require('../focus.js');

function taskEventsFixture({running = true} = {}) {
  const source = fs.readFileSync(require.resolve('../focus.js'), 'utf8');
  const start = source.indexOf('    function tasks(action)'), end = source.indexOf('    function submitTask(', start);
  const state = FocusModel.restore({minutes: 25, remaining: 900, sessionActive: true,
    deadline: running ? 910000 : null, activeTaskId: 'first', tasks: [{id: 'first', title: 'Finish <draft>', done: false}],
    pomodoro: {work: 25, rest: 5, longRest: 15, total: 4, session: 2, phase: 'work'}}, 10000);
  const notifications = [], scope = {FocusModel, state,
    window: {crypto: {randomUUID: () => 'second'}}, now: () => 10000,
    save() {}, render(notify, event) {if (notify && event) notifications.push({...event});}};
  vm.runInNewContext(`let disposed=false,model=state;${source.slice(start, end)}this.tasks=tasks;`, scope);
  return {state, notifications, tasks: scope.tasks};
}

test('completing a Focus task emits its actual title once without changing running or paused time', () => {
  for (const running of [true, false]) {
    const f = taskEventsFixture({running});
    const before = {deadline: f.state.deadline, remaining: f.state.remaining, phase: {...f.state.pomodoro}};
    assert.equal(f.tasks({type: 'toggle', id: 'first'}), true);
    assert.deepEqual(f.notifications, [{kind: 'task-complete', taskId: 'first', title: 'Tâche terminée', detail: 'Finish <draft>'}]);
    assert.equal(f.state.tasks[0].done, true);
    assert.equal(f.state.activeTaskId, null);
    assert.deepEqual({deadline: f.state.deadline, remaining: f.state.remaining, phase: f.state.pomodoro}, before);
    assert.equal(f.tasks({type: 'toggle', id: 'first'}), true);
    assert.equal(f.notifications.length, 1, 'reopening does not announce completion');
    assert.equal(f.tasks({type: 'toggle', id: 'first'}), true);
    assert.equal(f.notifications.length, 2, 'a deliberate second completion emits one new event');
  }
});

test('adding, selecting, deleting, invalid actions and restored completed tasks never invent a completion', () => {
  const f = taskEventsFixture();
  assert.equal(f.tasks({type: 'add', title: 'Second task'}), true);
  assert.equal(f.tasks({type: 'select', id: 'second'}), true);
  assert.equal(f.tasks({type: 'delete', id: 'second'}), true);
  assert.equal(f.tasks({type: 'toggle', id: 'missing'}), false);
  assert.equal(f.tasks({type: 'delete', id: 'missing'}), false);
  assert.equal(f.tasks(null), false);
  f.state.tasks[0].done = true;
  assert.equal(f.tasks({type: 'toggle', id: 'first'}), true);
  assert.equal(f.notifications.length, 0);
});
