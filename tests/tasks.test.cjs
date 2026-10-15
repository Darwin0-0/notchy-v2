const {test} = require('node:test');
const assert = require('node:assert/strict');
const {FocusModel, createTasks} = require('../focus.js');
const {modulePlacementPlan, normalizeModules, getModuleDefinitions, createActivityScene} = require('../notch.js');
const fs = require('node:fs'), vm = require('node:vm');

test('task cycle estimates migrate safely and retain real completion counts beyond an estimate', () => {
  const state = FocusModel.restore({minutes:25, activeTaskId:'legacy', tasks:[
    {id:'legacy',title:'Saved task'}, {id:'real',title:'Actual progress',estimatedCycles:4,completedCycles:6,secret:'discard'},
    {id:'bad',title:'Invalid counters',estimatedCycles:'4',completedCycles:-1}
  ]});
  assert.deepEqual(state.tasks, [
    {id:'legacy',title:'Saved task',done:false,estimatedCycles:1,completedCycles:0},
    {id:'real',title:'Actual progress',done:false,estimatedCycles:4,completedCycles:6},
    {id:'bad',title:'Invalid counters',done:false,estimatedCycles:1,completedCycles:0}
  ]);
  assert.equal(state.activeTaskId,'legacy');
  assert.equal(state.task,'Saved task');
  assert.deepEqual(FocusModel.restore(JSON.parse(JSON.stringify(state))).tasks,state.tasks);
});

test('task estimation, selection and unlinking preserve both running and paused timer state', () => {
  for(const deadline of [1510000,null]) {
    const state=FocusModel.restore({minutes:25,remaining:1234,deadline,sessionActive:true,
      pomodoro:{work:25,rest:5,longRest:15,total:4,phase:'work',session:1}},10000);
    const timing=()=>JSON.stringify([state.minutes,state.remaining,state.deadline,state.sessionActive,state.complete,state.pomodoro]);
    const before=timing();
    assert(FocusModel.taskAction(state,{type:'add',title:'Keep this task',estimatedCycles:4},'task'));
    assert.equal(state.activeTaskId,null);
    assert(FocusModel.taskAction(state,{type:'select',id:'task'}));
    assert(FocusModel.taskAction(state,{type:'estimate',id:'task',estimatedCycles:8}));
    assert.equal(state.tasks[0].estimatedCycles,8);
    assert(FocusModel.taskAction(state,{type:'unlink'}));
    assert.equal(state.activeTaskId,null); assert.equal(state.task,'');
    assert.equal(timing(),before);
    for(const estimatedCycles of [0,13,2.5,'3',Infinity,null]) {
      const snapshot=JSON.stringify(state);
      assert.equal(FocusModel.taskAction(state,{type:'estimate',id:'task',estimatedCycles}),false);
      assert.equal(JSON.stringify(state),snapshot);
    }
  }
});

test('Tasks has its own placeable host without adding a second timer or changing saved slots', () => {
  const tasks=getModuleDefinitions().find(item=>item.id==='tasks');
  assert.equal(tasks.element,'tasks-player'); assert.equal(tasks.view,'tasks');
  assert.equal(typeof createTasks,'function'); assert.throws(()=>createTasks({}),TypeError);
  const old={enabled:['music','focus'],slots:['music','focus',null,null]};
  assert.deepEqual(normalizeModules(old),old);
  const alone=modulePlacementPlan({enabled:['tasks'],slots:['tasks']});
  assert.equal(alone.items[0].presentation,'full'); assert.equal(alone.items[0].share,100);
  assert.equal(modulePlacementPlan({enabled:['tasks','music'],slots:['tasks','music']}).items[0].presentation,'scene');
  assert.equal(modulePlacementPlan({enabled:['tasks','music'],slots:['music','tasks']}).items[1].presentation,'scene');
  const scene=createActivityScene();
  assert.equal(scene.update([{id:'tasks',key:'tasks',label:'Tasks'}],{preserveOrder:true}).primary,'tasks');
  assert.deepEqual(scene.update([{id:'music',key:'music'},{id:'tasks',key:'tasks'}],{preserveOrder:true}).items.map(item=>item.id),['tasks','music']);
});

test('the real Tasks start handler starts idle Focus, resumes paused Focus and preserves a running deadline', () => {
  const source=fs.readFileSync(require.resolve('../focus.js'),'utf8'), begin=source.indexOf('    function click(event)',source.indexOf('  function createTasks(')), end=source.indexOf('    function submit(event)',begin);
  assert(begin>0&&end>begin);
  for(const [active,paused,expected] of [[false,false,'start'],[true,true,'toggle'],[true,false,null]]) {
    const calls=[],state=FocusModel.restore({minutes:25,remaining:1234,deadline:active&&!paused?1244000:null,sessionActive:active,tasks:[{id:'target',title:'Selected task'}]},10000);
    const deadline=state.deadline;
    const scope={disposed:false,host:{contains:()=>true},expand(){},render(){},focus:{tasks:action=>FocusModel.taskAction(state,action),summary:()=>({active,paused}),command:value=>calls.push(value)}};
    vm.runInNewContext(`${source.slice(begin,end)}this.click=click;`,scope);
    scope.click({target:{closest:()=>({disabled:false,dataset:{taskAction:'start',taskId:'target'}})}});
    assert.equal(state.activeTaskId,'target'); assert.equal(state.deadline,deadline);
    assert.deepEqual(calls,expected?[expected]:[]);
  }
});
