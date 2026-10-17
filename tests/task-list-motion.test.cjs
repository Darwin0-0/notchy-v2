'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {taskListOrder,TASK_LIST_MOTION,FocusModel}=require('../focus.js');
const tasks=()=>['first','second','third','old-done','older-done'].map((id,index)=>({id,title:id,done:index>2,estimatedCycles:4,completedCycles:index}));
test('task presentation places pending work first and preserves stored data order',()=>{
  const source=tasks(),before=JSON.stringify(source);assert.deepEqual(taskListOrder(source,'second'),['second','first','third','old-done','older-done']);assert.equal(JSON.stringify(source),before);
});
test('a newly completed task follows existing completed tasks without reordering their history',()=>{
  const source=tasks();source[0].done=true;
  assert.deepEqual(taskListOrder(source,null,['old-done','older-done']),['second','third','old-done','older-done','first']);
});
test('reopening a task restores its original pending place and removes it from completed history',()=>{
  const source=tasks();assert.deepEqual(taskListOrder(source,null,['old-done','older-done','first']),['first','second','third','old-done','older-done']);
  source[3].done=false;assert.deepEqual(taskListOrder(source,null,['old-done','older-done']),['first','second','third','old-done','older-done']);
});
test('multiple completions, deletion and reopening keep every surviving task exactly once',()=>{
  const source=tasks();source[0].done=source[1].done=true;
  const order=taskListOrder(source,null,['old-done','older-done','first']);assert.deepEqual(order,['third','old-done','older-done','first','second']);
  source.splice(3,1);source[0].done=false;assert.deepEqual(taskListOrder(source,null,order),['first','third','older-done','second']);
});
test('visual sorting after a real toggle never changes paused time or earned task cycles',()=>{
  const state=FocusModel.restore({minutes:25,remaining:900,deadline:null,sessionActive:true,tasks:tasks(),activeTaskId:'first'});
  const before=state.tasks.map(task=>[task.id,task.completedCycles]);FocusModel.taskAction(state,{type:'toggle',id:'first'});taskListOrder(state.tasks,state.activeTaskId,['old-done','older-done']);
  assert.equal(state.remaining,900);assert.equal(state.deadline,null);assert.deepEqual(state.tasks.map(task=>[task.id,task.completedCycles]),before);
  assert.deepEqual(state.tasks.map(task=>task.id),tasks().map(task=>task.id));
});
test('completion choreography is bounded to half a second and uses named tunable stages',()=>{
  assert.equal(TASK_LIST_MOTION.check+TASK_LIST_MOTION.strike+TASK_LIST_MOTION.move,500);assert.equal(TASK_LIST_MOTION.titleShift,4);assert(Object.isFrozen(TASK_LIST_MOTION));
});
test('completing a selected task before starting a session needs no continuation prompt or timer start',()=>{
  const state=FocusModel.defaults();state.tasks=tasks();state.activeTaskId='first';
  assert(FocusModel.taskAction(state,{type:'toggle',id:'first'}));assert.equal(state.taskPrompt,null);assert.equal(state.activeTaskId,null);
  assert.equal(state.sessionActive,false);assert.equal(state.deadline,null);assert.equal(state.remaining,1500);
  assert.equal(state.tasks.find(task=>!task.done).id,'second');
});
