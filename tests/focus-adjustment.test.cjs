'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const {FocusModel} = require('../focus.js');
const configuration = {work:25,rest:5,longRest:15,total:4};
const paused = (phase = 'work', breakKind) => FocusModel.restore({minutes:phase==='work'?25:breakKind==='long'?15:5,remaining:phase==='work'?900:120,sessionActive:true,deadline:null,
  pomodoro:{...configuration,session:2,phase,...(breakKind?{breakKind}: {}),...(breakKind==='long'?{chosenBreak:true}:{})},tasks:[{id:'task',title:'Keep my progress',estimatedCycles:4,completedCycles:2}],activeTaskId:'task'},10000);

test('explicit paused duration adjustment preserves elapsed time, phase, task credits and pause', () => {
  const state=paused(), tasks=JSON.stringify(state.tasks);
  assert.deepEqual(FocusModel.adjustConfiguration(state,{...configuration,work:30},10000),{ok:true});
  assert.equal(state.minutes,30); assert.equal(state.remaining,1200); assert.equal(state.deadline,null); assert.equal(state.sessionActive,true);
  assert.equal(state.pomodoro.session,2); assert.equal(state.pomodoro.phase,'work'); assert.equal(state.pomodoro.work,30);
  assert.equal(JSON.stringify(state.tasks),tasks); assert.equal(state.activeTaskId,'task');
  const restored=FocusModel.restore(JSON.parse(JSON.stringify(state)),9000000);
  assert.equal(restored.remaining,1200); assert.equal(restored.deadline,null); assert.deepEqual(restored.tasks,state.tasks);
});

test('shorter-than-elapsed or exhausted durations and lost session counts are rejected atomically', () => {
  for(const change of [{work:9},{work:10},{total:1},{total:2.5},{work:'30'}]) {
    const state=paused(), before=JSON.stringify(state);
    assert.equal(FocusModel.adjustConfiguration(state,{...configuration,...change},10000).ok,false);
    assert.equal(JSON.stringify(state),before);
  }
});

test('running or finished cycles cannot be adjusted and no work credit is fabricated', () => {
  const running=paused(); running.deadline=910000;
  const before=JSON.stringify(running); assert.equal(FocusModel.adjustConfiguration(running,{...configuration,work:30},10000).reason,'pause'); assert.equal(JSON.stringify(running),before);
  const idle=FocusModel.defaults(); assert.equal(FocusModel.adjustConfiguration(idle,configuration).ok,false);
  const state=paused(); FocusModel.adjustConfiguration(state,{...configuration,work:30},10000);
  const snapshot=JSON.stringify(state); assert.equal(FocusModel.tick(state,99999999).changed,false); assert.equal(JSON.stringify(state),snapshot);
});

test('paused short and chosen long breaks preserve actual elapsed time without changing the phase', () => {
  const short=paused('break','short');
  assert.equal(FocusModel.adjustConfiguration(short,{...configuration,rest:7},10000).ok,true);
  assert.equal(short.minutes,7); assert.equal(short.remaining,240); assert.equal(short.pomodoro.breakKind,'short');
  const long=paused('break','long'); long.pomodoro.chosenBreak=true; long.pomodoro.breakKind='long';
  assert.equal(FocusModel.adjustConfiguration(long,{...configuration,longRest:20},10000).ok,true);
  assert.equal(long.minutes,20); assert.equal(long.remaining,420); assert.equal(long.pomodoro.phase,'break'); assert.equal(long.pomodoro.chosenBreak,true); assert.equal(long.pomodoro.session,2);
});

test('Tasks can prepare Focus without starting, resuming or changing a running timer', () => {
  const source=fs.readFileSync(require.resolve('../focus.js'),'utf8'), begin=source.indexOf('    function click(event)',source.indexOf('  function createTasks(')), end=source.indexOf('    function submit(event)',begin);
  for(const active of [false,true]) {
    const state=active?paused():FocusModel.defaults(); state.tasks=[{id:'target',title:'Selected task',done:false}];
    const schedule=JSON.stringify([state.remaining,state.deadline,state.pomodoro]), prepared=[],commands=[];
    const control={disabled:false,dataset:{taskAction:'start',taskId:'target'}},scope={disposed:false,host:{contains:()=>true},render(){},prepare:button=>prepared.push(button),
      focus:{tasks:action=>FocusModel.taskAction(state,action),summary:()=>({active,paused:active}),command:value=>commands.push(value)}};
    vm.runInNewContext(source.slice(begin,end)+'this.click=click;',scope);scope.click({target:{closest:()=>control}});
    assert.equal(state.activeTaskId,'target');assert.equal(JSON.stringify([state.remaining,state.deadline,state.pomodoro]),schedule);assert.deepEqual(commands,[]);assert.equal(prepared[0],control);
  }
});
