'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Bridge=require('../focus-duration.js'),Core=require('../duration-core.js');
const {migrate,project,persistence,presentationForPlacement}=Bridge;
test('legacy IDs, long titles, estimates and validated work credits survive without invented elapsed time',()=>{
  const original={settings:{work:25,rest:5,longRest:15,total:4},state:{tasks:[{id:'old_task',title:'A'.repeat(400),estimatedCycles:3,completedCycles:2},{id:'done',title:'Completed',done:true}]}};
  const before=structuredClone(original),next=migrate(original);assert.equal(next.tasks[0].id,'old_task');assert.equal(next.tasks[0].title,original.state.tasks[0].title);assert.equal(next.tasks[0].totalMinutes,85);assert.equal(next.tasks[0].elapsedMs,0);assert.equal(next.tasks[0].earnedCycles,2);assert.equal(project(next).state.tasks[0].completedCycles,2);assert.deepEqual(original,before);
  assert.equal(next.tasks[1].done,true);assert.deepEqual(migrate({durationModule:next}),next);
});
test('inactive and completed legacy tasks keep every valid credit, including counts beyond estimates',()=>{
  for(const done of [false,true])for(const completedCycles of [0,1,6,12,9999]){
    const next=migrate({state:{tasks:[{id:'kept',title:'Keep my progress',estimatedCycles:4,completedCycles,done}]}}),task=next.tasks[0];
    assert.equal(task.earnedCycles||0,completedCycles);assert.equal(project(next).state.tasks[0].completedCycles,completedCycles);assert.equal(task.done,done);assert.equal(task.elapsedMs,0);assert.equal(next.startedAt,null);assert.equal(task.totalMinutes,115);
  }
});
test('missing or invalid legacy credit starts at zero instead of manufacturing progress',()=>{
  for(const completedCycles of [undefined,null,-1,1.5,'2',NaN,Infinity,10000]){
    const next=migrate({state:{tasks:[{id:'kept',title:'No proven credit',estimatedCycles:4,completedCycles}]}});
    assert.equal(next.tasks[0].earnedCycles,undefined);assert.equal(project(next).state.tasks[0].completedCycles,0);assert.equal(next.tasks[0].elapsedMs,0);
  }
});
test('legacy plans beyond the new form limit are not shortened',()=>{
  const next=migrate({settings:{work:180,rest:60,longRest:180,total:4},state:{tasks:[{id:'long',title:'Long task',estimatedCycles:12}]}});
  assert(next.tasks[0].totalMinutes>1439);assert.equal(Core.phase(next.tasks[0]).cycles,12);
});
test('active and paused legacy work retain phase and exact remaining seconds',()=>{
  for(const running of [true,false]){const now=1000000,next=migrate({state:{tasks:[{id:'one',title:'Preserve',estimatedCycles:4,completedCycles:2}],activeTaskId:'one',minutes:25,remaining:1234,deadline:running?now+1234000:null,sessionActive:true,pomodoro:{work:25,rest:5,longRest:15,total:4,phase:'work',session:2}}},now),p=Core.phase(next.tasks[0]);
    assert.equal(p.current.cycle,2);assert.equal(p.current.kind,'focus');assert.equal(p.remainingMs,1234000);assert.equal(next.startedAt,running?now:null);assert.equal(project(next,now).state.deadline,running?now+1234000:null);assert.equal(next.tasks[0].earnedCycles,2);assert.equal(project(next,now).state.tasks[0].completedCycles,2);
  }
});
test('real work adds to the preserved legacy credit once and retains the historical ceiling',()=>{
  const now=1000000;
  for(const completedCycles of [2,9999]){
    const next=migrate({state:{tasks:[{id:'running',title:'Preserved credit',estimatedCycles:4,completedCycles}],activeTaskId:'running',remaining:1234,deadline:now+1234000,sessionActive:true,pomodoro:{work:25,rest:5,longRest:15,total:4,phase:'work',session:2}}},now);
    const later=Core.materialize(next,now+1234000);assert.equal(later.tasks[0].earnedCycles,Math.min(9999,completedCycles+1));assert.equal(next.tasks[0].earnedCycles,completedCycles);assert.equal(Core.phase(later.tasks[0]).current.kind,'short');assert.deepEqual(Core.materialize(later,now+1234000),later);
  }
});
test('legacy final long break and free timer retain their actual phase instead of restarting focus',()=>{
  const now=1000000,long=migrate({state:{minutes:15,remaining:420,deadline:now+420000,sessionActive:true,pomodoro:{work:25,rest:5,longRest:15,total:4,phase:'break',breakKind:'long',session:4}}},now);
  assert.equal(Core.phase(long.tasks[0]).current.kind,'long');assert.equal(Core.phase(long.tasks[0]).remainingMs,420000);assert.equal(project(long,now).state.pomodoro.session,4);
  const free=migrate({settings:{work:25},state:{minutes:10,remaining:600,deadline:now+600000,sessionActive:true}},now);assert.equal(free.tasks[0].settings.work,10);assert.equal(Core.phase(free.tasks[0]).remainingMs,600000);
});
test('an overdue legacy deadline catches up to the real next phase',()=>{
  const now=1000000,next=migrate({state:{minutes:25,remaining:1500,deadline:now-2*60000,sessionActive:true,pomodoro:{work:25,rest:5,longRest:15,total:4,phase:'work',session:1}}},now),p=Core.phase(next.tasks[0]);assert.equal(p.current.kind,'short');assert.equal(p.remainingMs,3*60000);assert.equal(next.tasks[0].earnedCycles,undefined);
});
const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;
test('native shared-key persistence accepts reordered JSON and preserves the original backup and credits',async()=>{
  const original={settings:{work:25,rest:5,longRest:15,total:4},state:{tasks:[{id:'old',title:'Keep',estimatedCycles:1,completedCycles:2}]},unknown:{keep:true}};let saved;
  const win={__TAURI__:{core:{invoke(){}}},NotchyIA:{async invokeCore(command,args){if(command==='settings_get')return{[Bridge.KEY]:original,other:'untouched'};saved=args.patch;return sorted(saved);}}};
  const io=persistence(win);await io.save(await io.load());assert.deepEqual(Object.keys(saved),[Bridge.KEY]);assert.deepEqual(saved[Bridge.KEY].legacyBackup,original);assert.equal(saved[Bridge.KEY].durationModule.tasks[0].earnedCycles,2);assert.equal(saved[Bridge.KEY].state.tasks[0].completedCycles,2);
  const second=persistence({...win,NotchyIA:{async invokeCore(command,args){return command==='settings_get'?saved:args.patch;}}});const reloaded=await second.load();assert.equal(JSON.parse(reloaded).tasks[0].earnedCycles,2);await second.save(reloaded);assert.deepEqual(saved[Bridge.KEY].legacyBackup,original);
});
test('failed native acknowledgement never falls back to browser storage',async()=>{
  let browserWrites=0;const io=persistence({__TAURI__:{core:{invoke(){}}},localStorage:{setItem(){browserWrites++;}},NotchyIA:{async invokeCore(command){return command==='settings_get'?{}:{ok:false};}}});await assert.rejects(io.save(await io.load()));assert.equal(browserWrites,0);
});
test('oversized or malformed persisted envelopes are rejected before any write',async()=>{
  for(const value of ['x'.repeat(262145),'{broken','[]']){let writes=0;const io=persistence({localStorage:{getItem:()=>value,setItem(){writes++;}}});await assert.rejects(io.load());assert.equal(writes,0);}
});
test('legacy placement lookup delegates the shared four-format geometry policy',()=>{
  for(const [presentation,width,height,expected] of [['full',535,260,'full'],['scene',354,260,'quarter'],['rail',440,120,'half'],['scene',199,260,null],['rail',440,190,'details'],['rail',180,260,null],['rail',220,126,'quarter'],['full',326,140,'quarter'],['full',326,190,'quarter']])assert.equal(presentationForPlacement({presentation,width,height}),expected);
  for(const presentation of ['full','scene','rail',undefined])for(const [width,height,expected]of [[219,260,null],[220,119,null],[220,120,'quarter'],[439,260,'quarter'],[440,119,null],[440,120,'half'],[440,179,'half'],[440,180,'details'],[440,239,'details'],[440,240,'full']])assert.equal(presentationForPlacement({presentation,width,height}),expected);
  for(const geometry of [{width:0,height:200},{width:200,height:NaN},{width:-1,height:1},{width:Infinity,height:260},{width:354,height:0}])assert.equal(presentationForPlacement(geometry),null);
});
const {fixture,settle}=require('./helpers/duration-bridge-fixture.cjs');

test('the shared task controller settles earned work once before completion and preserves it on reopen',async t=>{
  t.mock.timers.enable({apis:['Date'],now:1000000});
  const f=fixture();await f.focus.ready;
  await f.focus.durationStore.configure({work:1,rest:1,longRest:1,interval:4});
  await f.focus.durationStore.add('The actual task',3);await f.focus.durationStore.add('Keep the next task',3);
  const id=f.focus.durationStore.snapshot().activeId;
  await f.focus.durationStore.toggleTimer(id);t.mock.timers.tick(60000);
  f.focus.tasks({type:'toggle',id});await settle();
  let current=f.focus.durationStore.snapshot();
  assert.equal(current.tasks[0].done,true);assert.equal(current.tasks[0].earnedCycles,1);assert.equal(current.tasks[0].elapsedMs,60000);
  assert.equal(current.tasks[1].done,false);assert.equal(current.startedAt,null);
  f.focus.tasks({type:'toggle',id});await settle();current=f.focus.durationStore.snapshot();
  assert.equal(current.tasks[0].done,false);assert.equal(current.tasks[0].earnedCycles,1);assert.equal(current.tasks[0].elapsedMs,60000);assert.equal(current.startedAt,null);
  assert.equal(f.components.length,1,'the task actions never mount a second timer');f.focus.dispose();
});

test('selecting through the shared controller credits the old boundary before pausing on the new task',async t=>{
  t.mock.timers.enable({apis:['Date'],now:1000000});
  const f=fixture();await f.focus.ready;
  await f.focus.durationStore.configure({work:1,rest:1,longRest:1,interval:4});
  await f.focus.durationStore.add('Previous task',3);await f.focus.durationStore.add('Next task',3);
  const [first,next]=f.focus.durationStore.snapshot().tasks;
  await f.focus.durationStore.toggleTimer(first.id);t.mock.timers.tick(60000);
  f.focus.tasks({type:'select',id:next.id});await settle();
  const current=f.focus.durationStore.snapshot();
  assert.equal(current.activeId,next.id);assert.equal(current.startedAt,null);assert.equal(current.tasks[0].elapsedMs,60000);assert.equal(current.tasks[0].earnedCycles,1);
  assert.equal(current.tasks[1].elapsedMs,0);assert.equal(current.tasks[1].earnedCycles,undefined);
  assert.equal(f.focus.getState().tasks[0].completedCycles,1);assert.equal(f.focus.getState().tasks[1].completedCycles,0);f.focus.dispose();
});

test('canonical arrangements consume the host assignment without legacy canvas sizing or clock writes',async t=>{
  t.mock.timers.enable({apis:['Date'],now:1000000});
  const f=fixture(undefined,{canonical:true});await f.focus.ready;await f.focus.durationStore.add('Keep my exact running plan',90);await f.focus.durationStore.toggleTimer(f.focus.durationStore.snapshot().activeId);
  const component=f.components[0],saved=JSON.stringify(f.focus.durationStore.snapshot()),writes=f.writes.length;
  for(let round=0;round<3;round++)for(const [presentation,width,height]of [['full',812,368],['main',536,368],['side',260,368],['tall',260,240],['wide',536,112],['small',260,112]]){
    Object.assign(f.focusHost.dataset,{modulePresentation:presentation,durationTasks:'quarter',durationTimer:'quarter'});f.focusHost.clientWidth=width;f.focusHost.clientHeight=height;
    component.showTasks();f.focus.render(false);assert.equal(component.inspect().modulePresentation,presentation);component.showTimer();assert.equal(component.inspect().modulePresentation,presentation);
    assert.equal(component.calls.sizes.length,0,'canonical formats cannot inherit a legacy scaled canvas');assert.equal(JSON.stringify(f.focus.durationStore.snapshot()),saved);assert.equal(f.writes.length,writes);
  }
  component.startCreate();const formats=component.calls.presentations.length;f.focusHost.dataset.modulePresentation='full';f.focus.render(false);assert.equal(component.inspect().view,'create-title');assert.equal(component.calls.presentations.length,formats+1);assert.equal(f.writes.length,writes);f.focus.dispose();
});

test('canonical detail affordances promote the existing Focus or Tasks instance and shared store',async()=>{
  const f=fixture(undefined,{canonical:true}),tasks=Bridge.createTasks({host:f.host('rail',260,108),focus:f.focus});await tasks.ready;await f.focus.durationStore.add('One shared task',25);
  const before=JSON.stringify(f.focus.durationStore.snapshot()),writes=f.writes.length;f.components[0].options.onRequestDetails();assert.equal(f.opens.at(-1),'focus');f.components[1].options.onRequestDetails();assert.equal(f.opens.at(-1),'tasks');
  assert.equal(f.components[0].options.store,f.components[1].options.store);assert.equal(f.components[1].options.store,f.focus.durationStore);assert.equal(JSON.stringify(f.focus.durationStore.snapshot()),before);assert.equal(f.writes.length,writes);assert.equal(f.components.length,2,'opening details does not mount another module');tasks.dispose();f.focus.dispose();
});

test('detail routes resolve a declared arrangement from the actual mount budget after Back takes its space',async()=>{
  const f=fixture(undefined,{canonical:true});await f.focus.ready;await f.focus.durationStore.add('Keep the detail and its plan',90);const component=f.components[0],mount=f.focusHost.children[0],saved=JSON.stringify(f.focus.durationStore.snapshot()),writes=f.writes.length;
  component.options.onRequestDetails();const promotions=f.opens.length;
  for(const [width,height,expected]of [[812,368,'full'],[640,304,'full'],[639,304,'main'],[536,368,'main'],[536,303,'tall'],[260,368,'side'],[260,304,'side'],[260,303,'tall'],[260,240,'tall'],[260,220,'tall'],[260,219,'small'],[260,112,'small']]){
    delete f.focusHost.dataset.modulePresentation;f.focusHost.dataset.presentation='full';f.focusHost.clientWidth=width;f.focusHost.clientHeight=height+32;Object.assign(mount,{clientWidth:width,clientHeight:height});
    f.focus.render(false);assert.equal(component.inspect().modulePresentation,expected,width+'×'+height+' excludes the32px Back band');const redraws=component.calls.presentations.length;f.focus.render(false);assert.equal(component.calls.presentations.length,redraws);
    assert.equal(component.inspect().view,'tasks');assert.equal(JSON.stringify(f.focus.durationStore.snapshot()),saved);assert.equal(f.writes.length,writes);assert.equal(f.opens.length,promotions,'fitting a promoted route never promotes again');
  }
  f.focus.dispose();
});

test('the unified module restores an ongoing or paused session and otherwise opens its task list',async()=>{
  for(const kind of ['fresh','running','paused','completed']){
    const state=Core.fresh();state.tasks=[{id:'saved-task',title:'Continue actual work',totalMinutes:25,settings:{...state.settings},elapsedMs:kind==='paused'?7000:kind==='completed'?1500000:0,done:kind==='completed'}];state.activeId='saved-task';state.startedAt=kind==='running'?Date.now():null;
    const f=fixture({durationModule:state});await f.focus.ready;f.flush();
    assert.equal(f.components[0].inspect().view,['running','paused'].includes(kind)?'timer':'tasks',kind);
    assert.equal(f.focus.durationStore.snapshot().tasks[0].id,'saved-task');
    assert.equal(f.focus.durationStore.snapshot().startedAt!==null,kind==='running');f.focus.dispose();
  }
});
test('render(false) avoids model emissions, unchanged format redraws and duplicate language updates',async()=>{
  const f=fixture();await f.focus.ready;f.flush();const count=f.changes.length,sizes=f.components[0].calls.sizes.length;f.focus.render(false);f.focus.render(false);assert.equal(f.changes.length,count);assert.equal(f.components[0].calls.sizes.length,sizes);
  f.language('fr');assert.equal(f.components[0].calls.languages.length,0);f.language('en');f.language('en');assert.deepEqual(f.components[0].calls.languages,['en']);
  f.focusHost.dataset.presentation='scene';f.focusHost.clientWidth=354;f.focusHost.clientHeight=190;f.focus.render(false);assert.equal(f.components[0].inspect().size,'quarter');
  f.focusHost.clientHeight=260;f.focus.render(false);assert.equal(f.components[0].inspect().size,'quarter');f.focusHost.clientWidth=440;f.focus.render(false);assert.equal(f.components[0].inspect().size,'full');f.focus.dispose();
});
test('the native half budget uses the Tasks list quarter and Focus half without redrawing forms',async()=>{
  const f=fixture(),taskHost=f.host('rail',440,120),tasks=Bridge.createTasks({host:taskHost,focus:f.focus});await tasks.ready;
  f.focusHost.dataset.presentation='rail';f.focusHost.clientWidth=440;f.focusHost.clientHeight=120;f.focus.render(false);
  assert.equal(f.components[0].inspect().size,'quarter','the unified module starts with its task list');assert.equal(f.components[1].inspect().size,'quarter');
  f.components[0].showTasks();assert.equal(f.components[0].inspect().size,'quarter','opening Tasks immediately uses its compact list canvas');
  f.components[0].showTimer();assert.equal(f.components[0].inspect().size,'half','returning to the timer immediately restores the wide format');
  f.components[1].showTimer();assert.equal(f.components[1].inspect().size,'half');f.components[1].showTasks();assert.equal(f.components[1].inspect().size,'quarter');
  const before=JSON.stringify(f.focus.durationStore.snapshot());
  const formats=f.components.map(component=>component.calls.sizes.length);
  f.components[0].showSettings();f.components[1].showSettings();
  f.focusHost.clientHeight=260;taskHost.clientHeight=260;f.focus.render(false);tasks.render();
  assert.equal(f.components[0].inspect().view,'settings');assert.equal(f.components[0].inspect().size,'half');
  assert.equal(f.components[1].inspect().view,'settings');assert.equal(f.components[1].inspect().size,'quarter');
  assert.deepEqual(f.components.map(component=>component.calls.sizes.length),formats,'opening or resizing a form does not redraw its presentation');
  assert.equal(JSON.stringify(f.focus.durationStore.snapshot()),before);tasks.dispose();f.focus.dispose();
});
test('host-assigned task and timer formats remain authoritative through repeated placement changes',async t=>{
  t.mock.timers.enable({apis:['Date'],now:1000000});
  const f=fixture();await f.focus.ready;await f.focus.durationStore.add('Preserve my running task',90);
  await f.focus.durationStore.toggleTimer(f.focus.durationStore.snapshot().activeId);
  const before=JSON.stringify(f.focus.durationStore.snapshot()),writes=f.writes.length,component=f.components[0];
  for(let pass=0;pass<3;pass++)for(const [presentation,tasks,timer]of [['full','full','full'],['main','quarter','details'],['side','quarter','half'],['small','quarter','quarter']]){
    Object.assign(f.focusHost.dataset,{modulePresentation:presentation,durationTasks:tasks,durationTimer:timer});
    component.showTasks();assert.equal(component.inspect().size,tasks);
    component.showTimer();assert.equal(component.inspect().size,timer);
    assert.equal(JSON.stringify(f.focus.durationStore.snapshot()),before);
    assert.equal(f.writes.length,writes,'presentation never persists or resets the running clock');
  }
  delete f.focusHost.dataset.durationTasks;delete f.focusHost.dataset.durationTimer;
  f.focusHost.clientWidth=440;f.focusHost.clientHeight=120;
  component.showTasks();assert.equal(component.inspect().size,'quarter');component.showTimer();assert.equal(component.inspect().size,'half','unassigned detail hosts still use the shared policy');
  f.focus.dispose();
});
test('a placement assignment during an editor fits the host without redrawing or changing its state',async()=>{
  const f=fixture();await f.focus.ready;await f.focus.durationStore.add('Keep my task',25);
  f.components[0].startCreate();const formats=f.components[0].calls.sizes.length,fits=f.components[0].calls.fits,writes=f.writes.length,before=JSON.stringify(f.focus.durationStore.snapshot());
  Object.assign(f.focusHost.dataset,{modulePresentation:'small',durationTasks:'quarter',durationTimer:'quarter'});
  f.focusHost.clientWidth=220;f.focusHost.clientHeight=120;f.focus.render(false);
  assert.equal(f.components[0].inspect().view,'create-title');assert.equal(f.components[0].calls.sizes.length,formats);assert(f.components[0].calls.fits>fits);
  assert.equal(JSON.stringify(f.focus.durationStore.snapshot()),before);assert.equal(f.writes.length,writes);
  f.focus.dispose();
});
test('unknown host renderer values fall back to the shared policy instead of entering the component',async()=>{
  const f=fixture();await f.focus.ready;
  f.focusHost.clientWidth=300;f.focusHost.clientHeight=190;
  for(const value of ['gigantic','half','details']){Object.assign(f.focusHost.dataset,{durationTasks:value,durationTimer:'__proto__'});f.components[0].showTasks();assert.equal(f.components[0].inspect().size,'quarter','Tasks cannot inherit a timer-only canvas');}
  f.components[0].showTimer();assert.equal(f.components[0].inspect().size,'quarter');f.focus.dispose();
});
test('Tasks mounts real shared content and leaving its editor suppresses recursive route restoration',async()=>{
  const f=fixture(),taskHost=f.host('full'),tasks=Bridge.createTasks({host:taskHost,focus:f.focus});await tasks.ready;f.flush();
  assert.equal(taskHost.hidden,false);assert.equal(f.components[1].options.store,f.focus.durationStore);assert.equal(f.components[1].inspect().view,'tasks');assert.equal(f.focus.views.size,2);
  await f.focus.durationStore.add('Shared actual task',90);assert.equal(f.focus.getState().tasks[0].title,'Shared actual task');
  tasks.focusInput();await settle();assert.equal(f.opens.at(-1),'tasks');assert.equal(f.focus.inspect().configOpen,true);
  f.focus.leaveRoute();assert.equal(f.focus.inspect().configOpen,true,'leaving Focus does not discard the Tasks draft');tasks.render();assert.equal(f.components[1].inspect().view,'create-title');
  tasks.leaveRoute();assert.equal(f.focus.inspect().configOpen,false);assert.equal(f.components[1].inspect().view,'tasks');
  f.language('en');assert.deepEqual(f.components[1].calls.languages,['en']);tasks.dispose();assert.equal(f.focus.views.size,1);f.focus.dispose();assert(f.observers.every(observer=>observer.disconnected));
});
test('legacy Pomodoro detail no longer promotes a redundant screen or enters editable mode',async()=>{
  const f=fixture(),tasks=Bridge.createTasks({host:f.host('rail',180,126),focus:f.focus});await tasks.ready;
  f.focus.editView('tasks','pomodoro');assert.deepEqual(f.opens,[]);assert.equal(f.focus.inspect().configOpen,false);
  const calls=f.opens.length;f.focus.editView('tasks','pomodoro');assert.equal(f.opens.length,calls,'an unchanged detailed view does not promote again');tasks.leaveRoute();assert.equal(f.opens.length,calls,'leaving a detailed view does not promote or restore recursively');tasks.dispose();f.focus.dispose();
});
test('start is idempotent while running and pause/resume preserve the single shared task clock',async t=>{
  t.mock.timers.enable({apis:['Date'],now:1000000});const f=fixture();await f.focus.ready;await f.focus.durationStore.add('Actual timer',90);
  f.focus.command('start');await settle();const started=f.focus.durationStore.snapshot().startedAt;assert.equal(started,1000000);
  f.focus.command('start');await settle();assert.equal(f.focus.durationStore.snapshot().startedAt,started);
  t.mock.timers.tick(10000);f.focus.command('pause');await settle();assert.equal(f.focus.durationStore.snapshot().startedAt,null);const elapsed=f.focus.durationStore.snapshot().tasks[0].elapsedMs;
  t.mock.timers.tick(60000);f.focus.command('start');await settle();assert.equal(f.focus.durationStore.snapshot().tasks[0].elapsedMs,elapsed);f.focus.dispose();
});

test('starting an explicit next task awaits its selection and preserves finished unchecked work',async t=>{
 t.mock.timers.enable({apis:['Date'],now:1000000});const state=Core.fresh(),task=(id,elapsedMs,done=false)=>({id,title:id,totalMinutes:1,elapsedMs,done,settings:{...state.settings}});state.tasks=[task('finished-unchecked',60000),task('checked',12000,true),task('next',0)];state.activeId='finished-unchecked';
 const f=fixture({durationModule:state});await f.focus.ready;const finished=f.focus.durationStore.snapshot().tasks[0];f.focus.startTask('next');await settle();const started=f.focus.durationStore.snapshot();assert.equal(started.activeId,'next');assert.equal(started.startedAt,1000000);assert.deepEqual(started.tasks[0],finished);assert.equal(started.tasks[1].done,true);assert.equal(f.components[0].inspect().view,'timer');
 f.focus.startTask('next');await settle();assert.equal(f.focus.durationStore.snapshot().startedAt,1000000,'repeating an explicit start never pauses it');await f.focus.durationStore.toggleTimer('next');f.focus.startTask('finished-unchecked');await settle();assert.equal(f.focus.durationStore.snapshot().startedAt,null);assert.deepEqual(f.focus.durationStore.snapshot().tasks[0],finished,'completed duration is never reset');f.focus.startTask('checked');await settle();assert.equal(f.focus.durationStore.snapshot().startedAt,null);f.focus.dispose();
});

test('a failed explicit task selection never proceeds to a timer start',async t=>{
 const f=fixture();await f.focus.ready;await f.focus.durationStore.add('First task',1);await f.focus.durationStore.add('Next task',1);const before=f.focus.durationStore.snapshot(),next=before.tasks[1].id,errors=[];t.mock.method(console,'error',(...args)=>errors.push(args));f.focusHost.ownerDocument.defaultView.localStorage.setItem=()=>{throw Error('Storage rejected');};f.focus.startTask(next);await settle();assert.deepEqual(f.focus.durationStore.snapshot(),before);assert.equal(f.components[0].inspect().view,'tasks');assert.equal(errors.length,1);assert.match(String(errors[0][1]),/Storage rejected/);f.focus.dispose();
});
test('natural timer completion notifies exactly once regardless of the UI and bridge tick order',async t=>{
  t.mock.timers.enable({apis:['Date'],now:1000000});
  for(const settleFirst of [true,false]){
    const f=fixture();await f.focus.ready;f.flush();await f.focus.durationStore.add('Real completion',1);const id=f.focus.durationStore.snapshot().activeId;await f.focus.durationStore.toggleTimer(id);
    t.mock.timers.tick(60000);if(settleFirst)await f.focus.durationStore.settle();f.tick();await f.focus.durationStore.settle();f.tick();f.tick();
    assert.equal(f.focus.durationStore.snapshot().startedAt,null);const events=f.changes.filter(change=>change.event).map(change=>change.event);assert.deepEqual(events.map(({kind,title,detail})=>({kind,title,detail})),[{kind:'complete',title:'Session terminée',detail:'Real completion'}]);assert.equal(events[0].boundary.kind,'task');assert.equal(events[0].boundary.taskDone,false);assert.equal(events[0].boundary.title,'Durée terminée');assert.equal(events[0].boundary.nextTask,null);f.focus.dispose();
  }
});
test('natural phase boundaries notify but pause, resume, manual skip and restart stay quiet',async t=>{
  t.mock.timers.enable({apis:['Date'],now:1000000});const f=fixture();await f.focus.ready;f.flush();
  await f.focus.durationStore.configure({work:1,rest:1,longRest:1,interval:4});await f.focus.durationStore.add('Three minutes',3);const id=f.focus.durationStore.snapshot().activeId;
  await f.focus.durationStore.toggleTimer(id);t.mock.timers.tick(60000);f.tick();assert.deepEqual(f.changes.filter(change=>change.event).map(change=>change.event.kind),['phase']);
  await f.focus.durationStore.toggleTimer(id);t.mock.timers.tick(60000);f.tick();await f.focus.durationStore.toggleTimer(id);
  await f.focus.durationStore.skip(id);await f.focus.durationStore.skip(id);await f.focus.durationStore.restart(id);f.tick();
  assert.deepEqual(f.changes.filter(change=>change.event).map(change=>change.event.kind),['phase']);f.focus.dispose();
});


test('grid previews reuse the real shared renderer without a second clock, write or editable state',async()=>{
 const f=fixture(undefined,{canonical:true});await f.focus.ready;await f.focus.durationStore.add('Preview actual task',90);const before=JSON.stringify(f.focus.durationStore.snapshot()),writes=f.writes.length;
 for(const presentation of ['full','main','side','tall','wide','small']){
  const host=f.host(),preview=f.focus.renderPreview(host,{presentation});assert.equal(await preview.ready,true);
  const renderer=f.components.at(-1);assert.equal(renderer.options.store,f.focus.durationStore);assert.equal(renderer.options.preview,true);assert.equal(renderer.options.embedded,true);assert.equal(renderer.inspect().modulePresentation,presentation);assert.equal(renderer.calls.fits,1);assert.equal(f.focus.views.size,1,'previews never join active route or language controllers');
  assert.equal(JSON.stringify(f.focus.durationStore.snapshot()),before);assert.equal(f.writes.length,writes);preview.dispose();preview.dispose();assert.equal(renderer.disposed,true);assert.equal(host.children[0].removed,true);
 }
 const host=f.host(),preview=f.focus.renderPreview(host,{presentation:'side'});preview.dispose();assert.equal(await preview.ready,false,'a removed cell cannot fit or remount after readiness');f.focus.dispose();
});


test('discreet boundaries describe actual focus, break, cycle and total completion without advancing the plan',()=>{
 const initial=Core.fresh();initial.tasks=[{id:'one',title:'Actual work',totalMinutes:150,elapsedMs:0,done:false,settings:{...initial.settings}}];initial.activeId='one';initial.startedAt=1000;
 for(const [minutes,kind,title]of [[25,'focus','Session terminée'],[30,'break','On reprend ?'],[115,'cycle','Cycle terminé'],[150,'task','Durée terminée']]){
  const before=Core.materialize(initial,1000+(minutes-1)*60000),after=Core.materialize(initial,1000+minutes*60000),saved=JSON.stringify(after),event=Bridge.elapsedPhaseEvent(before,after,1000+minutes*60000);assert.equal(event.boundary.kind,kind);assert.equal(event.boundary.title,title);assert.equal(event.boundary.taskDone,false);assert.equal(event.boundary.remainingMs,Core.phase(after.tasks[0]).remainingMs);assert.equal(event.boundary.remainingCount,1);assert.equal(event.boundary.nextTask,null);assert.equal(JSON.stringify(after),saved);assert.equal(Bridge.elapsedPhaseEvent(after,after,1000+minutes*60000),null);
 }
});
test('an acknowledged task check exposes the real next task without starting or changing it',()=>{
 const before=Core.fresh();before.tasks=[{id:'one',title:'Finished real task',totalMinutes:25,elapsedMs:3000,done:false,settings:{...before.settings}},{id:'two',title:'Next real task',totalMinutes:50,elapsedMs:1000,done:false,settings:{...before.settings}}];before.activeId='one';const after=structuredClone(before);after.tasks[0].done=true;const saved=JSON.stringify(after),event=Bridge.elapsedPhaseEvent(before,after,1234);assert.equal(event.boundary.kind,'task');assert.equal(event.boundary.taskDone,true);assert.equal(event.boundary.remainingCount,1);assert.deepEqual(event.boundary.nextTask,{id:'two',title:'Next real task',totalMinutes:50});assert.equal(event.boundary.task.title,'Finished real task');assert.equal(after.startedAt,null);assert.equal(JSON.stringify(after),saved);assert.equal(Bridge.elapsedPhaseEvent(after,after,2234),null);assert.equal(Bridge.elapsedPhaseEvent(after,before,3234),null,'reopening a task never announces a completion');
});

test('boundary cycles use the actual task interval instead of newer global defaults',()=>{
 const before=Core.fresh();before.tasks=[{id:'kept',title:'Existing cycle',totalMinutes:8,elapsedMs:175000,done:false,settings:{work:1,rest:1,longRest:2,interval:2}}];before.activeId='kept';before.startedAt=1000;assert.equal(before.settings.interval,4);const after=Core.materialize(before,6000),cycle=Bridge.elapsedPhaseEvent(before,after,6000);assert.equal(cycle.boundary.kind,'cycle');assert.equal(cycle.boundary.interval,2);const checked=structuredClone(after);checked.tasks[0].done=true;assert.equal(Bridge.elapsedPhaseEvent(after,checked,6000).boundary.interval,2);
});

test('the first immediate task check has a loaded baseline before the deferred initial render',async()=>{
 const state=Core.fresh();state.tasks=[{id:'current',title:'Check immediately after load',totalMinutes:25,elapsedMs:0,done:false,settings:{...state.settings}},{id:'next',title:'Real next task',totalMinutes:25,elapsedMs:0,done:false,settings:{...state.settings}}];state.activeId='current';const f=fixture({durationModule:state});await f.focus.ready;assert.equal(f.changes.length,0,'the deferred first render has not run');await f.focus.durationStore.complete('current');const events=f.changes.filter(change=>change.event);assert.equal(events.length,1);assert.equal(events[0].event.boundary.taskDone,true);assert.equal(events[0].event.boundary.task.id,'current');assert.equal(events[0].event.boundary.nextTask.id,'next');f.flush();assert.equal(f.changes.filter(change=>change.event).length,1);f.focus.dispose();
});
