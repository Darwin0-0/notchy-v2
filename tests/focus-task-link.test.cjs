const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const {FocusModel} = require('../focus.js');

const started = (extra = {}) => FocusModel.restore({minutes:1, remaining:60, deadline:70000, sessionActive:true,
  activeTaskId:'a', tasks:[{id:'a',title:'Write the draft',estimatedCycles:2},{id:'b',title:'Read the draft'}],
  pomodoro:{work:1,rest:1,longRest:1,total:3,phase:'work',session:1},...extra},10000);
const timing = state => JSON.stringify([state.minutes,state.remaining,state.deadline,state.sessionActive,state.complete,state.pomodoro]);

test('a real work boundary credits once, never completes a task, and survives reload without a duplicate', () => {
  const state=started(), result=FocusModel.tick(state,70000);
  assert.deepEqual(result.creditedCycles,[{taskId:'a',session:1}]);
  assert.equal(state.tasks[0].completedCycles,1); assert.equal(state.tasks[0].done,false);
  assert.deepEqual(state.taskPrompt,{kind:'cycle-complete',taskId:'a'});
  assert.equal(state.pomodoro.phase,'break'); assert.equal(state.deadline,130000);
  assert.equal(FocusModel.tick(state,70000).creditedCycles.length,0);
  const restored=FocusModel.restore(JSON.parse(JSON.stringify(state)),70000);
  assert.deepEqual(restored.taskPrompt,state.taskPrompt);
  assert.equal(FocusModel.tick(restored,129999).creditedCycles.length,0);
  assert.equal(restored.tasks[0].completedCycles,1);
});

test('skip, paused phases, free Focus and the end of a break do not invent task cycles', () => {
  const skipped=started(); Object.assign(skipped,{deadline:null,remaining:0,complete:true,sessionActive:false});
  assert(FocusModel.nextPhase(skipped,40000)); assert.equal(skipped.tasks[0].completedCycles,0); assert.equal(skipped.taskPrompt,null);
  const paused=started({deadline:null,remaining:40});
  assert.equal(FocusModel.tick(paused,99999999).changed,false); assert.equal(paused.tasks[0].completedCycles,0);
  const free=started({activeTaskId:null});
  assert.equal(FocusModel.tick(free,70000).creditedCycles.length,0); assert.equal(free.taskPrompt,null);
  const breaking=started({pomodoro:{work:1,rest:1,longRest:1,total:3,phase:'break',session:1}});
  assert.equal(FocusModel.tick(breaking,70000).creditedCycles.length,0); assert.equal(breaking.tasks[0].completedCycles,0);
});

test('sleep catchup credits every elapsed work phase only once and retains one bounded prompt', () => {
  const state=started(), change=FocusModel.tick(state,370000);
  assert.equal(change.creditedCycles.length,3); assert.equal(state.tasks[0].completedCycles,3);
  assert.equal(state.tasks[0].done,false); assert.equal(state.pomodoro.finished,true);
  assert.deepEqual(state.taskPrompt,{kind:'cycle-complete',taskId:'a'});
  assert.equal(FocusModel.tick(state,9999999).changed,false);
  const restored=FocusModel.restore(JSON.parse(JSON.stringify(state)),370000);
  assert.equal(FocusModel.tick(restored,9999999).creditedCycles.length,0); assert.equal(restored.tasks[0].completedCycles,3);
});

test('Not yet and Yes persist explicitly and cannot act twice or complete a newly selected task', () => {
  const kept=started(); FocusModel.tick(kept,70000); const before=timing(kept);
  assert(FocusModel.taskAction(kept,{type:'keep',id:'a'}));
  assert.equal(kept.taskPrompt,null); assert.equal(kept.tasks[0].done,false); assert.equal(kept.tasks[0].completedCycles,1); assert.equal(timing(kept),before);
  assert.equal(FocusModel.restore(JSON.parse(JSON.stringify(kept)),70000).taskPrompt,null);
  assert.equal(FocusModel.taskAction(kept,{type:'confirm-complete',id:'a'}),false);
  const yes=started(); FocusModel.tick(yes,70000); FocusModel.taskAction(yes,{type:'select',id:'b'}); const timer=timing(yes);
  assert(FocusModel.taskAction(yes,{type:'confirm-complete',id:'a'}));
  assert.equal(yes.tasks[0].done,true); assert.equal(yes.tasks[1].done,false); assert.equal(yes.activeTaskId,'b');
  assert.equal(yes.taskPrompt,null); assert.equal(timing(yes),timer);
  assert.equal(FocusModel.taskAction(yes,{type:'confirm-complete',id:'a'}),false);
  assert.equal(FocusModel.restore(JSON.parse(JSON.stringify(yes)),70000).tasks[0].done,true);
});

test('manually completing a linked task proposes another task or free Focus without resetting time', () => {
  for(const paused of [false,true]) {
    const state=started(paused?{deadline:null,remaining:40}:{}), before=timing(state);
    assert(FocusModel.taskAction(state,{type:'toggle',id:'a'}));
    assert.equal(state.activeTaskId,null); assert.deepEqual(state.taskPrompt,{kind:'continue',taskId:'a'}); assert.equal(timing(state),before);
    const restored=FocusModel.restore(JSON.parse(JSON.stringify(state)),10000);
    assert.deepEqual(restored.taskPrompt,state.taskPrompt);
    assert(FocusModel.taskAction(state,{type:'select',id:'b'})); assert.equal(state.activeTaskId,'b'); assert.equal(state.taskPrompt,null); assert.equal(timing(state),before);
    assert(FocusModel.taskAction(restored,{type:'unlink'})); assert.equal(restored.activeTaskId,null); assert.equal(restored.taskPrompt,null); assert.equal(timing(restored),before);
  }
});

test('deleting or reopening the referenced task clears obsolete prompts and never resets the timer', () => {
  for(const kind of ['cycle-complete','continue']) {
    const state=started(); if(kind==='cycle-complete')FocusModel.tick(state,70000); else FocusModel.taskAction(state,{type:'toggle',id:'a'});
    const before=timing(state);
    assert(FocusModel.taskAction(state,{type:'delete',id:'a'})); assert.equal(state.taskPrompt,null); assert.equal(state.activeTaskId,null); assert.equal(timing(state),before);
  }
  const undo=started(); FocusModel.taskAction(undo,{type:'toggle',id:'a'}); FocusModel.taskAction(undo,{type:'toggle',id:'a'});
  assert.equal(undo.taskPrompt,null); assert.equal(undo.tasks[0].done,false);
  for(const prompt of [{kind:'cycle-complete',taskId:'missing'},{kind:'continue',taskId:'a'},{kind:'other',taskId:'a'},'invalid',null]) assert.equal(FocusModel.restore({...started(),taskPrompt:prompt},10000).taskPrompt,null);
});

test('resolving the real shared prompt preserves keyboard focus on its successor or visible module', () => {
  const source=fs.readFileSync(require.resolve('../notch.js'),'utf8'), begin=source.indexOf('  function focusTaskPromptCommand(event)'), end=source.indexOf('  function musicInBand()',begin);
  for(const action of ['keep','complete']) {
    const focused=[], button={disabled:false,dataset:{focusTaskPromptAction:action,taskId:'a'}}, target=name=>({disabled:false,closest:()=>null,getClientRects:()=>[{}],focus:()=>focused.push(name)});
    const next=target('next prompt'), module=target('module'), host={hidden:false,contains:node=>node===button,querySelectorAll:()=>[next]};
    const scope={disposed:false,focus:{taskPrompt:{kind:'cycle-complete',taskId:'a'}},byId:()=>host,
      document:{activeElement:button,querySelectorAll:()=>[module]},focusComponent:{tasks(command){assert.equal(command.type,action==='complete'?'confirm-complete':'keep');host.hidden=action==='keep';return true;}}};
    vm.runInNewContext(`${source.slice(begin,end)}this.run=focusTaskPromptCommand;`,scope);
    scope.run({target:{closest:()=>button}});
    assert.deepEqual(focused,[action==='keep'?'module':'next prompt']);
  }
});
