'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Core=require('../duration-core.js');
function setup(options={}){let time=1000,id=0,saved=null;const store=Core.createStore({now:()=>time,makeId:()=>`test-${++id}`,save:encoded=>{saved=encoded;},...options});return{store,advance:ms=>{time+=ms;},saved:()=>saved};}
test('task duration is a complete wall-clock plan including clipped pauses from the reference',()=>{
  assert.deepEqual(Core.plan(90).map(s=>[s.kind,s.minutes]),[['focus',25],['short',5],['focus',25],['short',5],['focus',25],['short',5]]);
  assert.deepEqual(Core.plan(150).slice(6).map(s=>[s.kind,s.minutes]),[['focus',25],['long',15],['focus',20]]);
  assert.deepEqual(Core.plan(27).map(s=>[s.kind,s.minutes]),[['focus',25],['short',2]]);
});
test('bounded plans preserve every minute and contiguous phase boundaries without the demo truncation',()=>{
  for(const total of [1,20,25,26,30,90,130,1439,1440,3000,Core.LIMITS.minutes]){
    const segments=Core.plan(total);assert.equal(segments.reduce((sum,s)=>sum+s.minutes,0),total);
    assert(segments.every(s=>s.minutes>0));assert.equal(segments[0].startMs,0);
    for(let i=1;i<segments.length;i++)assert.equal(segments[i].startMs,segments[i-1].startMs+segments[i-1].durationMs);
  }
  const many=Core.plan(1439,{work:1,rest:1,longRest:1,interval:4});assert(many.length>40);assert.equal(many.reduce((sum,s)=>sum+s.minutes,0),1439);
  for(const value of [0,-1,NaN,Infinity,1.5,'90',Core.LIMITS.minutes+1])assert.throws(()=>Core.plan(value));
});
test('task plans snapshot their real configuration independently of later defaults',async()=>{
  const x=setup();await x.store.ready;await x.store.add('First',90);await x.store.configure({work:50,rest:10,longRest:20,interval:2});await x.store.add('Second',90);
  const tasks=x.store.snapshot().tasks;assert.equal(tasks[0].settings.work,25);assert.equal(tasks[1].settings.work,50);assert.equal(tasks[0].earnedCycles,undefined);x.store.dispose();
});
test('only real elapsed focus boundaries earn cycles; pause and repeated snapshots add no credit',async()=>{
  const x=setup();await x.store.ready;await x.store.add('Actual task',90);await x.store.toggleTimer('test-1');x.advance(25*60000);
  assert.equal(x.store.snapshot().tasks[0].earnedCycles,1);assert.equal(x.store.snapshot().tasks[0].earnedCycles,1);
  await x.store.toggleTimer('test-1');x.advance(3600000);assert.equal(x.store.snapshot().tasks[0].earnedCycles,1);
  await x.store.toggleTimer('test-1');x.advance(5*60000);assert.equal(Core.phase(x.store.snapshot().tasks[0]).current.cycle,2);assert.equal(x.store.snapshot().tasks[0].earnedCycles,1);
  x.advance(25*60000);assert.equal(x.store.snapshot().tasks[0].earnedCycles,2);x.store.dispose();
});
test('skip advances the timeline but cannot earn a focus cycle and restart clears new proof',async()=>{
  const x=setup();await x.store.ready;await x.store.add('Skip test',90);await x.store.skip('test-1');assert.equal(x.store.snapshot().tasks[0].earnedCycles,undefined);
  await x.store.toggleTimer('test-1');x.advance(30*60000);assert.equal(x.store.snapshot().tasks[0].earnedCycles,1);
  await x.store.restart('test-1');assert.equal(x.store.snapshot().tasks[0].elapsedMs,0);assert.equal(x.store.snapshot().tasks[0].earnedCycles,undefined);x.store.dispose();
});
test('restoring elapsed history never manufactures earned cycles while future real work can earn one',async()=>{
  const state=Core.fresh();state.tasks=[{id:'legacy_task',title:'Preserved',totalMinutes:90,elapsedMs:30*60000,done:false,settings:{...Core.DEFAULT_SETTINGS}}];state.activeId='legacy_task';state.startedAt=1000;
  const x=setup({load:()=>JSON.stringify(state)});await x.store.ready;assert.equal(x.store.snapshot().tasks[0].earnedCycles,undefined);x.advance(25*60000);assert.equal(x.store.snapshot().tasks[0].earnedCycles,1);x.store.dispose();
});
test('reload accounts for real running time and clamps completion without checking off the task',async()=>{
  const x=setup();await x.store.ready;await x.store.add('One minute',1);await x.store.toggleTimer('test-1');
  const restored=Core.createStore({load:()=>x.saved(),now:()=>31000});await restored.ready;assert.equal(restored.snapshot().tasks[0].elapsedMs,30000);
  x.advance(900000);assert.equal(x.store.snapshot().tasks[0].elapsedMs,60000);await x.store.settle();assert.equal(x.store.snapshot().startedAt,null);assert.equal(x.store.snapshot().tasks[0].done,false);x.store.dispose();restored.dispose();
});
test('switching tasks, completing and deleting preserves unrelated tasks and one running clock',async()=>{
  const x=setup();await x.store.ready;await x.store.add('First',10);await x.store.add('Second',20);await x.store.toggleTimer('test-1');x.advance(3000);await x.store.toggleTimer('test-2');x.advance(4000);
  const before=x.store.snapshot();assert.equal(before.tasks[0].elapsedMs,3000);assert.equal(before.tasks[1].elapsedMs,4000);assert.equal(before.activeId,'test-2');
  await x.store.complete('test-2');assert.equal(x.store.snapshot().startedAt,null);await assert.rejects(x.store.toggleTimer('test-2'));await x.store.remove('test-2');assert.equal(x.store.snapshot().tasks[0].id,'test-1');x.store.dispose();
});
test('failed asynchronous persistence leaves tasks unchanged and a later retry can commit',async()=>{
  let reject=true;const x=setup({save:async()=>{if(reject)throw Error('disk full');}});await x.store.ready;await assert.rejects(x.store.add('Not committed',90));assert.equal(x.store.snapshot().tasks.length,0);
  reject=false;await x.store.add('Committed',90);assert.equal(x.store.snapshot().tasks.length,1);x.store.dispose();
});
test('corrupt state cannot be silently overwritten and invalid earned counts are rejected',async()=>{
  let writes=0;const store=Core.createStore({load:()=>'{broken',save:()=>writes++});await assert.rejects(store.ready);await assert.rejects(store.add('No overwrite',20));assert.equal(writes,0);store.dispose();
  for(const earnedCycles of [-1,1.5,'2',NaN,10000]){const state=Core.fresh();state.tasks=[{id:'one',title:'Actual task',totalMinutes:90,elapsedMs:0,done:false,settings:{...Core.DEFAULT_SETTINGS},earnedCycles}];assert.throws(()=>Core.normalize(state));}
});

test('renaming a running task preserves its clock, plan, credit and identity',async()=>{
  const x=setup();await x.store.ready;await x.store.add('Typo',90);await x.store.toggleTimer('test-1');x.advance(26*60000);
  await x.store.update('test-1','Corrected title',90);const state=x.store.snapshot(),task=state.tasks[0];
  assert.equal(task.id,'test-1');assert.equal(task.title,'Corrected title');assert.equal(task.elapsedMs,26*60000);assert.equal(task.earnedCycles,1);assert.equal(state.startedAt,1000+26*60000);assert.equal(task.settings.work,25);x.store.dispose();
});

test('changing a progressed duration requires explicit restart and keeps that task paused',async()=>{
  const x=setup();await x.store.ready;await x.store.add('Actual work',90);await x.store.toggleTimer('test-1');x.advance(26*60000);
  await assert.rejects(x.store.update('test-1','Updated work',60),/Confirm restarting/);assert.equal(x.store.snapshot().tasks[0].totalMinutes,90);
  await x.store.configure({work:45,rest:10,longRest:20,interval:3});
  await x.store.update('test-1','Updated work',60,{restart:true});const state=x.store.snapshot(),task=state.tasks[0];
  assert.equal(task.totalMinutes,60);assert.equal(task.title,'Updated work');assert.equal(task.elapsedMs,0);assert.equal(task.earnedCycles,undefined);assert.equal(task.settings.work,25);assert.equal(state.startedAt,null);x.store.dispose();
});

test('invalid edits and rejected writes never replace a task or its progress',async()=>{
  let reject=false;const x=setup({save:()=>{if(reject)throw Error('Disk full');}});await x.store.ready;await x.store.add('Original',90);await x.store.skip('test-1');const original=x.store.snapshot();
  for(const [title,duration]of [['',90],['\u0001bad',90],['valid',0],['x'.repeat(501),90]])await assert.rejects(x.store.update('test-1',title,duration,{restart:true}));
  assert.deepEqual(x.store.snapshot(),original);reject=true;await assert.rejects(x.store.update('test-1','Lost update',60,{restart:true}));assert.deepEqual(x.store.snapshot(),original);x.store.dispose();
});

test('undo deletion restores exact task data, list position and selection with progress paused',async()=>{
  const x=setup();await x.store.ready;await x.store.add('Before',5);await x.store.add('Restore me',90);await x.store.add('After',10);await x.store.toggleTimer('test-2');x.advance(26*60000);
  const deleted=x.store.snapshot().tasks[1];await x.store.remove('test-2');assert.equal(x.store.canUndoRemove(),true);x.advance(60000);await x.store.undoRemove();const state=x.store.snapshot();
  assert.deepEqual(state.tasks.map(task=>task.id),['test-1','test-2','test-3']);assert.deepEqual(state.tasks[1],deleted);assert.equal(state.activeId,'test-2');assert.equal(state.startedAt,null);assert.equal(x.store.canUndoRemove(),false);await assert.rejects(x.store.undoRemove());x.store.dispose();
});

test('undo preserves other edits and never interrupts a timer started after deletion',async()=>{
  const x=setup();await x.store.ready;await x.store.add('First',90);await x.store.add('Second',20);await x.store.toggleTimer('test-1');x.advance(5000);await x.store.remove('test-1');
  await x.store.update('test-2','Other work',20);await x.store.toggleTimer('test-2');x.advance(3000);await x.store.undoRemove();const state=x.store.snapshot();
  assert.equal(state.tasks[0].elapsedMs,5000);assert.equal(state.tasks[1].title,'Other work');assert.equal(state.activeId,'test-2');assert.notEqual(state.startedAt,null);assert.equal(state.tasks[1].elapsedMs,3000);x.store.dispose();
});

test('failed deletion or undo retain the previous recovery and allow retry without data loss',async()=>{
  let reject=false;const x=setup({save:()=>{if(reject)throw Error('Disk full');}});await x.store.ready;await x.store.add('Recover',20);await x.store.add('Keep',30);await x.store.remove('test-1');reject=true;
  await assert.rejects(x.store.remove('test-2'));assert.equal(x.store.canUndoRemove(),true);assert.equal(x.store.snapshot().tasks[0].id,'test-2');
  await assert.rejects(x.store.undoRemove());assert.equal(x.store.canUndoRemove(),true);assert.equal(x.store.snapshot().tasks.length,1);
  reject=false;await x.store.undoRemove();assert.deepEqual(x.store.snapshot().tasks.map(task=>task.id),['test-1','test-2']);assert.equal(x.store.canUndoRemove(),false);x.store.dispose();
});
