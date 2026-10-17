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
test('placement AUTO exposes four real formats, including a compact narrow rail',()=>{
  for(const [presentation,width,height,expected] of [['full',535,260,'full'],['scene',350,260,'details'],['rail',250,190,'half'],['rail',180,260,'quarter'],['rail',180,126,'quarter'],['full',326,140,'half'],['full',326,190,'details']])assert.equal(presentationForPlacement({presentation,width,height}),expected);
  for(const geometry of [{width:0,height:200},{width:200,height:NaN},{width:-1,height:1}])assert.equal(presentationForPlacement(geometry),null);
});
function fixture(){
  const storage=new Map(),components=[],callbacks=[],changes=[],opens=[],observers=[],intervals=new Set();let language='fr',languageChanged;
  const document={createElement(){return{className:'',remove(){this.removed=true;}};}};
  const win={localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},setTimeout:callback=>(callbacks.push(callback),1),setInterval:callback=>(intervals.add(callback),callback),clearInterval:callback=>intervals.delete(callback),ResizeObserver:class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}},NotchyI18n:{locale:()=>language,t:value=>value,onChange(callback){languageChanged=callback;return()=>{languageChanged=null;};}},NotchyDuration:{mount(host,options){let view=options.view,size='full';const calls={sizes:[],languages:[],fits:0};const component={ready:Promise.resolve(),calls,options,inspect:()=>({view,size}),setPresentation(value){size=value;calls.sizes.push(value);},fit(){calls.fits++;},setLanguage(value){calls.languages.push(value);},showSettings(){view='settings';options.onViewChange({view});},showTimer(){view='timer';options.onViewChange({view});},showTasks(){view='tasks';options.onViewChange({view});},startCreate(){view='create-title';options.onViewChange({view});},cancelEdit(){view=options.view;options.onViewChange({view});},dispose(){this.disposed=true;}};components.push(component);return component;}}};document.defaultView=win;
  const host=(presentation='full',width=535,height=260)=>({ownerDocument:document,dataset:{presentation},clientWidth:width,clientHeight:height,hidden:false,children:[],append(node){this.children.push(node);}});
  const focusHost=host(),focus=Bridge.create({host:focusHost,changed:value=>changes.push(value),openDuration:kind=>opens.push(kind),closeConfiguration(){throw Error('leaveRoute must suppress restoration callbacks');}});
  return{focus,focusHost,host,components,changes,opens,observers,flush(){while(callbacks.length)callbacks.shift()();},tick(){for(const callback of intervals)callback();},language(value){language=value;languageChanged?.();}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('render(false) avoids model emissions, unchanged format redraws and duplicate language updates',async()=>{
  const f=fixture();await f.focus.ready;f.flush();const count=f.changes.length,sizes=f.components[0].calls.sizes.length;f.focus.render(false);f.focus.render(false);assert.equal(f.changes.length,count);assert.equal(f.components[0].calls.sizes.length,sizes);
  f.language('fr');assert.equal(f.components[0].calls.languages.length,0);f.language('en');f.language('en');assert.deepEqual(f.components[0].calls.languages,['en']);
  f.focusHost.dataset.presentation='scene';f.focusHost.clientWidth=350;f.focus.render(false);assert.equal(f.components[0].inspect().size,'details');f.focus.dispose();
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
test('opening a detailed Pomodoro promotes its own host without treating it as an editable form',async()=>{
  const f=fixture(),tasks=Bridge.createTasks({host:f.host('rail',180,126),focus:f.focus});await tasks.ready;
  f.focus.editView('tasks','pomodoro');assert.equal(f.opens.at(-1),'tasks');assert.equal(f.focus.inspect().configOpen,false);
  const calls=f.opens.length;f.focus.editView('tasks','pomodoro');assert.equal(f.opens.length,calls,'an unchanged detailed view does not promote again');tasks.leaveRoute();assert.equal(f.opens.length,calls,'leaving a detailed view does not promote or restore recursively');tasks.dispose();f.focus.dispose();
});
test('start is idempotent while running and pause/resume preserve the single shared task clock',async t=>{
  t.mock.timers.enable({apis:['Date'],now:1000000});const f=fixture();await f.focus.ready;await f.focus.durationStore.add('Actual timer',90);
  f.focus.command('start');await settle();const started=f.focus.durationStore.snapshot().startedAt;assert.equal(started,1000000);
  f.focus.command('start');await settle();assert.equal(f.focus.durationStore.snapshot().startedAt,started);
  t.mock.timers.tick(10000);f.focus.command('pause');await settle();assert.equal(f.focus.durationStore.snapshot().startedAt,null);const elapsed=f.focus.durationStore.snapshot().tasks[0].elapsedMs;
  t.mock.timers.tick(60000);f.focus.command('start');await settle();assert.equal(f.focus.durationStore.snapshot().tasks[0].elapsedMs,elapsed);f.focus.dispose();
});
test('natural timer completion notifies exactly once regardless of the UI and bridge tick order',async t=>{
  t.mock.timers.enable({apis:['Date'],now:1000000});
  for(const settleFirst of [true,false]){
    const f=fixture();await f.focus.ready;f.flush();await f.focus.durationStore.add('Real completion',1);const id=f.focus.durationStore.snapshot().activeId;await f.focus.durationStore.toggleTimer(id);
    t.mock.timers.tick(60000);if(settleFirst)await f.focus.durationStore.settle();f.tick();await f.focus.durationStore.settle();f.tick();f.tick();
    assert.equal(f.focus.durationStore.snapshot().startedAt,null);assert.deepEqual(f.changes.filter(change=>change.event).map(change=>change.event),[{kind:'complete',title:'Session terminée',detail:'Real completion'}]);f.focus.dispose();
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
