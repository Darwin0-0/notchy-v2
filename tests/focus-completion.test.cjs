'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {FocusModel, focusCardValues} = require('../focus.js');
const start = (extra={}) => FocusModel.restore({minutes:1,remaining:60,deadline:70000,sessionActive:true,
  tasks:[{id:'a',title:'Original task',estimatedCycles:4},{id:'b',title:'Next task'}],activeTaskId:'a',
  pomodoro:{work:1,rest:1,longRest:2,total:3,session:1,phase:'work'},...extra},10000);
const reload = (state, now) => FocusModel.restore(JSON.parse(JSON.stringify(state)),now);

test('completion stores the earned session and task snapshot while the real next phase continues',()=>{
  const state=start(); FocusModel.tick(state,70000);
  assert.deepEqual(state.sessionSummary,{at:70000,session:1,total:3,minutes:1,taskId:'a',title:'Original task',completedCycles:1,estimatedCycles:4});
  assert.equal(state.pomodoro.phase,'break'); assert.equal(state.deadline,130000);
  state.tasks[0].title='Renamed'; FocusModel.taskAction(state,{type:'select',id:'b'});
  assert.equal(state.sessionSummary.title,'Original task'); assert.equal(state.sessionSummary.taskId,'a');
  const restored=reload(state,80000); assert.deepEqual(restored.sessionSummary,state.sessionSummary);
  assert.equal(FocusModel.tick(restored,80000).creditedCycles.length,0); assert.equal(restored.tasks[0].completedCycles,1);
  const card=focusCardValues(restored,undefined,80000);
  assert.equal(card.completion.recommended,'short'); assert.equal(card.totalSeconds,60);
});

test('free work gets a truthful summary, and skip or paused time never earns one',()=>{
  const free=start({activeTaskId:null}); FocusModel.tick(free,70000);
  assert.equal(free.sessionSummary.taskId,null); assert.equal(free.sessionSummary.completedCycles,0);
  assert.equal(free.tasks[0].completedCycles,0);
  const skipped=start(); Object.assign(skipped,{deadline:null,remaining:0,complete:true,sessionActive:false});
  FocusModel.nextPhase(skipped,30000); assert.equal(skipped.sessionSummary,null); assert.equal(skipped.tasks[0].completedCycles,0);
  const paused=start({deadline:null,remaining:30}); FocusModel.tick(paused,90000000); assert.equal(paused.sessionSummary,null);
});

test('sleep catchup keeps only the latest actual completion and dismiss survives reload',()=>{
  const state=start({pomodoro:{work:1,rest:1,longRest:1,total:3,session:1,phase:'work'}});
  FocusModel.tick(state,370000);
  assert.equal(state.sessionSummary.session,3); assert.equal(state.sessionSummary.at,310000);
  assert.equal(state.sessionSummary.completedCycles,3); assert.equal(state.tasks[0].completedCycles,3);
  const restored=reload(state,370000); assert.deepEqual(restored.sessionSummary,state.sessionSummary);
  assert.equal(focusCardValues(restored,undefined,370000).completion.recommended,'long');
  const timing=JSON.stringify([restored.deadline,restored.remaining,restored.pomodoro]);
  assert.equal(FocusModel.dismissCompletion(restored),true); assert.equal(FocusModel.dismissCompletion(restored),false);
  assert.equal(JSON.stringify([restored.deadline,restored.remaining,restored.pomodoro]),timing);
  const dismissed=reload(restored,370000); FocusModel.tick(dismissed,999999999);
  assert.equal(dismissed.sessionSummary,null); assert.equal(dismissed.tasks[0].completedCycles,3);
});

test('each choice uses the configured duration, preserves earned credit and acts only once',()=>{
  for(const [choice,minutes,phase] of [['short',3,'break'],['long',11,'break'],['continue',7,'work']]){
    const state=start({minutes:7,remaining:420,deadline:430000,pomodoro:{work:7,rest:3,longRest:11,total:2,session:1,phase:'work'}});
    FocusModel.tick(state,430000);
    assert(FocusModel.completionChoice(state,choice,435000));
    assert.equal(state.minutes,minutes); assert.equal(state.remaining,minutes*60); assert.equal(state.deadline,435000+minutes*60000);
    assert.equal(state.pomodoro.phase,phase); assert.equal(state.tasks[0].completedCycles,1); assert.equal(state.sessionSummary,null);
    assert.equal(FocusModel.completionChoice(state,choice,435000),false);
    const restored=reload(state,436000); assert.equal(restored.deadline,state.deadline);
    if(phase==='break'){FocusModel.tick(restored,restored.deadline); assert.equal(restored.pomodoro.phase,'work'); assert.equal(restored.pomodoro.session,2); assert.equal(restored.tasks[0].completedCycles,1);}
  }
});

test('a short break chosen after the final session ends the cycle without a second long break',()=>{
  const state=start({pomodoro:{work:1,rest:1,longRest:2,total:2,session:2,phase:'work'}});
  FocusModel.tick(state,70000); assert(FocusModel.completionChoice(state,'short',70000));
  assert.equal(state.pomodoro.breakKind,'short'); assert.equal(state.deadline,130000);
  FocusModel.tick(state,130000); assert.equal(state.pomodoro.finished,true); assert.equal(state.deadline,null);
  const restored=reload(state,130000); assert.equal(restored.pomodoro.finished,true); assert.equal(restored.pomodoro.breakKind,'short');
  assert.equal(FocusModel.tick(restored,99999999).changed,false); assert.equal(restored.tasks[0].completedCycles,1);
});

test('a catchup choice retargets the current phase instead of replaying an old completed session',()=>{
  const state=start(); FocusModel.tick(state,150000);
  assert.equal(state.pomodoro.phase,'work'); assert.equal(state.pomodoro.session,2); assert.equal(state.sessionSummary.session,1);
  assert(FocusModel.completionChoice(state,'continue',150000));
  assert.equal(state.pomodoro.session,2); assert.equal(state.tasks[0].completedCycles,1); assert.equal(state.deadline,210000);
  const invalid=reload({...state,sessionSummary:{...state.sessionSummary,at:'invalid'}},150000); assert.equal(invalid.sessionSummary,null);
});
