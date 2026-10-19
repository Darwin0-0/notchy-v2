'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../duration-module.js'),'utf8');
const motion=vm.runInNewContext('('+source.match(/const MOTION = Object\.freeze\((\{[^\n]+\})\);/)[1]+')');
function between(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
function fixture(save=async()=>{}){
 const fields={title:{value:'Read a chapter',focus(){}},h:{value:'1'},m:{value:'30'},save:{disabled:false,focus(){}}};
 const state={tasks:[]},calls={saved:[],draws:0,previews:0,merged:0,views:[],focus:0};
 const context=vm.createContext({Promise,Number,String,Math,Object,rows:new Map(),
  draft:{title:'Read a chapter',h:'1',m:'30',split:true},busy:false,disposed:false,viewToken:1,previousView:'tasks',status:{textContent:''},
  $:selector=>selector==='[name=title]'?fields.title:selector==='[name=h]'?fields.h:selector==='[name=m]'?fields.m:selector==='[data-command=save-task]'?fields.save:selector==='[data-command=add]'?{focus(){calls.focus++;}}:null,
  setDurationEditing(value){context.draft.split=value;calls.merged++;},
  refreshDurationPreview(){calls.previews++;},
  draw(){calls.draws++;},changeView(value){calls.views.push(value);},error(value){context.status.textContent=value;},recovery(){},options:{},
  updateRows(){},updateTimer(){},store:{snapshot:()=>state,async add(title,minutes){calls.saved.push([title,minutes]);await save();state.tasks.push({title,minutes});}}
 });
 vm.runInContext(between('    function draftMinutes()','    function setDurationEditing(')+between('    async function act(','    function onClick('),context);
 return {context,fields,state,calls,flush:()=>new Promise(resolve=>setImmediate(resolve))};
}
test('duration confirmation merges the fields and previews without creating a task',()=>{
 const f=fixture();f.context.finishDuration(false);
 assert.equal(f.context.draft.split,false);assert.equal(f.calls.draws,0,'the live duration field survives its merge transition');assert.equal(f.calls.previews,1);assert.deepEqual(f.calls.saved,[]);assert.equal(f.context.draft.h,'1');assert.equal(f.context.draft.m,'30');
});
test('invalid hours or minutes preserve the draft and never write',()=>{
 for(const [h,m]of [['24','0'],['0','60'],['0','0'],['','30'],['1','NaN']]){
  const f=fixture();f.context.draft.h=h;f.context.draft.m=m;f.context.finishDuration(true);
  assert.deepEqual(f.calls.saved,[]);assert.equal(f.context.draft.split,true);assert.match(f.context.status.textContent,/durée/);
 }
});
test('Add persists the total 90 minutes once and waits for acknowledgement before returning',async()=>{
 let acknowledge;const f=fixture(()=>new Promise(resolve=>{acknowledge=resolve;}));
 f.context.finishDuration(true);f.context.finishDuration(true);
 assert.deepEqual(f.calls.saved,[['Read a chapter',90]]);assert.equal(f.fields.save.disabled,true);assert.deepEqual(f.calls.views,[]);assert.equal(f.state.tasks.length,0);
 acknowledge();await f.flush();
 assert.equal(f.state.tasks.length,1);assert.deepEqual(f.calls.views,['tasks']);assert.equal(f.context.busy,false);assert.equal(f.calls.focus,1);
});
test('a rejected write leaves the draft available and re-enables Add for a retry',async()=>{
 let rejected=true;const f=fixture(async()=>{if(rejected)throw Error('Disk full');});
 f.context.finishDuration(true);await f.flush();
 assert.equal(f.state.tasks.length,0);assert.equal(f.context.draft.title,'Read a chapter');assert.deepEqual(f.calls.views,[]);assert.equal(f.context.busy,false);assert.equal(f.fields.save.disabled,false);assert.match(f.context.status.textContent,/enregistrer/);
 rejected=false;f.context.finishDuration(true);await f.flush();assert.equal(f.state.tasks.length,1);assert.deepEqual(f.calls.views,['tasks']);
});
test('leaving an acknowledged submission does not unexpectedly reopen the previous route',async()=>{
 let acknowledge;const f=fixture(()=>new Promise(resolve=>{acknowledge=resolve;}));f.context.finishDuration(true);f.context.viewToken++;acknowledge();await f.flush();
 assert.equal(f.state.tasks.length,1);assert.deepEqual(f.calls.views,[]);assert.equal(f.context.busy,false);
});

async function taskFlowFixture({save=async()=>{},running=false}={}){
 const Core=require('../duration-core.js'),initial=Core.fresh(),calls={writes:[],views:[],focus:[],errors:[]};
 initial.tasks=[{id:'one',title:'Read a chapter',totalMinutes:90,elapsedMs:12000,done:false,settings:{...Core.DEFAULT_SETTINGS}},
  {id:'two',title:'Review the project',totalMinutes:25,elapsedMs:0,done:false,settings:{...Core.DEFAULT_SETTINGS}}];
 initial.activeId='one';initial.startedAt=running?1000:null;
 const store=Core.createStore({load:()=>JSON.stringify(initial),now:()=>1000,save:async encoded=>{calls.writes.push(JSON.parse(encoded));await save();}});await store.ready;
 const rows=new Map();let list={scrollTop:67},editor=null,active=null;
 const focusable=kind=>({focus(options){active=this;calls.focus.push({kind,preventScroll:options?.preventScroll});}}),timer=focusable('timer'),add=focusable('add');
 const context=vm.createContext({Promise,view:'tasks',viewToken:1,size:'half',taskListReturn:null,disposed:false,status:{textContent:''},rows,store,
  options:{embedded:true,onViewChange(value){calls.views.push(value.view);},onError(cause){calls.errors.push(cause.message);}},
  closeMenu(){},recovery(){},updateRows(){},updateTimer(){},setSize(){throw Error('An embedded route must retain its slot size');},
  error(value){context.status.textContent=value;},
  $:selector=>selector==='.nd-list'?list:selector==='[data-command=toggle]'?timer:selector==='[data-command=add]'?add:null,
  draw(){rows.clear();list=context.view==='tasks'?{scrollTop:0}:null;editor=context.view.startsWith('create')?{title:'Unfinished draft'}:null;
   if(list)for(const task of store.snapshot().tasks){const controls={'.nd-row-play':focusable(task.id+':play'),'.nd-title-button':focusable(task.id+':detail')};rows.set(task.id,{querySelector:selector=>controls[selector]});}}
 });
 vm.runInContext(between('    function changeView(','    function header(')+between('    async function act(','    function confirmTitle(')+between('    function onClick(','    function onInput('),context);
 return{context,store,calls,get list(){return list;},get editor(){return editor;},get active(){return active;},timer,rows,
  click(command,id='one'){const button={disabled:false,dataset:{command,id}};context.onClick({target:{closest:()=>button}});},
  flush:()=>new Promise(resolve=>setImmediate(resolve))};
}

test('launching a task opens its timer only after the shared store acknowledges persistence',async()=>{
 let acknowledge;const f=await taskFlowFixture({save:()=>new Promise(resolve=>{acknowledge=resolve;})});
 f.click('play');await f.flush();
 assert.equal(f.calls.writes.length,1);assert.equal(f.store.snapshot().startedAt,null);assert.equal(f.context.view,'tasks');assert.deepEqual(f.calls.views,[]);assert.deepEqual(f.calls.focus,[]);
 assert.equal(f.context.taskListReturn.id,'one');assert.equal(f.context.taskListReturn.command,'play');assert.equal(f.context.taskListReturn.scroll,67);
 acknowledge();await f.flush();
 assert.equal(f.store.snapshot().activeId,'one');assert.equal(f.store.snapshot().startedAt,1000);assert.equal(f.context.view,'timer');assert.deepEqual(f.calls.views,['timer']);assert.equal(f.active,f.timer);
 assert.deepEqual(f.calls.focus,[{kind:'timer',preventScroll:true}]);assert.equal(f.context.size,'half');f.store.dispose();
});

test('pausing a running task from its list persists the pause without replacing the list or its focus',async()=>{
 const f=await taskFlowFixture({running:true}),list=f.list,before=f.store.snapshot();f.click('play');await f.flush();
 assert.equal(f.calls.writes.length,1);assert.equal(f.store.snapshot().startedAt,null);assert.equal(f.store.snapshot().tasks[0].elapsedMs,before.tasks[0].elapsedMs);
 assert.equal(f.context.view,'tasks');assert.equal(f.list,list);assert.equal(f.list.scrollTop,67);assert.deepEqual(f.calls.views,[]);assert.deepEqual(f.calls.focus,[]);f.store.dispose();
});

test('a failed task launch preserves its list and stored clock and reports the persistence failure',async()=>{
 const f=await taskFlowFixture({save:async()=>{throw Error('Disk full');}}),list=f.list,before=f.store.snapshot();f.click('play');await f.flush();
 assert.equal(f.calls.writes.length,1);assert.deepEqual(f.store.snapshot(),before);assert.equal(f.context.view,'tasks');assert.equal(f.list,list);assert.equal(f.list.scrollTop,67);
 assert.deepEqual(f.calls.views,[]);assert.deepEqual(f.calls.focus,[]);assert.match(f.context.status.textContent,/enregistrer/);assert.deepEqual(f.calls.errors,['Disk full']);f.store.dispose();
});

test('a delayed launch acknowledgement cannot replace an editor opened while the write was pending',async()=>{
 let acknowledge;const f=await taskFlowFixture({save:()=>new Promise(resolve=>{acknowledge=resolve;})});f.click('play');await f.flush();
 f.context.changeView('create-duration');const editor=f.editor,token=f.context.viewToken;acknowledge();await f.flush();
 assert.equal(f.store.snapshot().startedAt,1000,'the acknowledged operation still commits');assert.equal(f.context.view,'create-duration');assert.equal(f.context.viewToken,token);
 assert.equal(f.editor,editor);assert.equal(f.editor.title,'Unfinished draft');assert.deepEqual(f.calls.views,['create-duration']);assert.deepEqual(f.calls.focus,[]);f.store.dispose();
});

test('returning from the timer restores the initiating row action and list scroll without changing the clock',async()=>{
 for(const command of ['play','detail']){
  const f=await taskFlowFixture({running:true});f.context.rememberTaskList('one',command);f.context.changeView('timer');const before=f.store.snapshot();
  f.click('tasks');
  assert.equal(f.context.view,'tasks');assert.equal(f.list.scrollTop,67);assert.equal(f.active,f.rows.get('one').querySelector(command==='play'?'.nd-row-play':'.nd-title-button'));
  assert.deepEqual(f.calls.focus,[{kind:'one:'+command,preventScroll:true}]);assert.deepEqual(f.store.snapshot(),before);assert.equal(f.calls.writes.length,0);f.store.dispose();
 }
});

test('returning after the initiating task disappeared safely focuses Add and preserves the running timer',async()=>{
 const f=await taskFlowFixture({running:true});f.context.rememberTaskList('removed-task','play');f.context.changeView('timer');const before=f.store.snapshot();
 f.context.returnToTasks();assert.equal(f.list.scrollTop,67);assert.deepEqual(f.calls.focus,[{kind:'add',preventScroll:true}]);assert.deepEqual(f.store.snapshot(),before);assert.equal(f.calls.writes.length,0);f.store.dispose();
});

test('editing delegates the original task identity and preserves a same-duration timer',async()=>{
 const f=fixture(),updated=[];f.context.draft.id='existing';f.state.tasks.push({id:'existing',totalMinutes:90,elapsedMs:30000});f.context.previousView='pomodoro';
 f.context.store.update=async(...args)=>updated.push(args);f.context.finishDuration(true);await f.flush();
 assert.deepEqual(f.calls.saved,[]);assert.equal(updated.length,1);assert.equal(updated[0][0],'existing');assert.equal(updated[0][1],'Read a chapter');assert.equal(updated[0][2],90);assert.equal(updated[0][3].restart,false);assert.deepEqual(f.calls.views,['pomodoro']);
});

test('a migrated task longer than the creation form limit can be renamed without shortening it',async()=>{
 const f=fixture(),updated=[];Object.assign(f.context.draft,{id:'existing',h:'50',m:'0'});f.state.tasks.push({id:'existing',totalMinutes:3000,elapsedMs:5000});f.context.store.update=async(...args)=>updated.push(args);
 f.context.finishDuration(true);await f.flush();assert.equal(updated.length,1);assert.equal(updated[0][2],3000);assert.equal(updated[0][3].restart,false);
});

test('a newly progressed duration edit presents the restart action before it can save',async()=>{
 const f=fixture(),updated=[];Object.assign(f.context.draft,{id:'existing',h:'1',m:'0',restartRequired:false});f.state.tasks.push({id:'existing',totalMinutes:90,elapsedMs:1000});
 f.context.store.update=async(...args)=>updated.push(args);f.context.finishDuration(true);await f.flush();assert.equal(updated.length,0);assert.equal(f.calls.draws,1);assert.equal(f.context.busy,false);
 f.context.draft.restartRequired=true;f.context.finishDuration(true);await f.flush();assert.equal(updated.length,1);assert.equal(updated[0][2],60);assert.equal(updated[0][3].restart,true);
});

test('a failed edit preserves the task draft and re-enables the same Save action',async()=>{
 const f=fixture();Object.assign(f.context.draft,{id:'existing',title:'Corrected',restartRequired:false});f.state.tasks.push({id:'existing',totalMinutes:90,elapsedMs:0});f.context.store.update=async()=>{throw Error('Disk full');};
 f.context.finishDuration(true);await f.flush();assert.equal(f.context.draft.id,'existing');assert.equal(f.context.draft.title,'Read a chapter');assert.equal(f.context.draft.h,'1');assert.equal(f.context.draft.m,'30');assert.equal(f.fields.save.disabled,false);assert.deepEqual(f.calls.views,[]);assert.match(f.context.status.textContent,/enregistrer/);
});

function recoveryFixture(store,owners){
 const status={children:[],get textContent(){return this.children.map(child=>child.textContent).join('');},set textContent(value){this.children=value?[{textContent:value}]:[];},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];},querySelector(){return this.children.find(child=>child.command==='undo-remove')||null;}};
 const token={clear(){if(status.querySelector())status.replaceChildren();}},context=vm.createContext({store,RECOVERY_OWNERS:owners,recoveryToken:token,status,t:value=>value,node:(_tag,_class,textContent)=>({textContent}),button:command=>({command,textContent:''})});
 vm.runInContext(between('    function recovery()','    function setSize('),context);return {context,status,token,hasUndo:()=>!!status.querySelector()};
}

test('a shared task deletion offers one Undo only in its initiating mount across its view changes',async()=>{
 let canUndo=false;const store={canUndoRemove:()=>canUndo,async remove(){canUndo=true;return 'saved';}},owners=new WeakMap(),tasks=recoveryFixture(store,owners),focus=recoveryFixture(store,owners);
 assert.equal(await tasks.context.removeTask('one'),'saved');tasks.context.recovery();focus.context.recovery();assert.equal(tasks.hasUndo(),true);assert.equal(focus.hasUndo(),false);
 tasks.status.textContent='';tasks.context.recovery();assert.equal(tasks.hasUndo(),true,'the originating component can redraw its list/detail without losing Undo');
 await focus.context.removeTask('two');focus.context.recovery();tasks.context.recovery();assert.equal(focus.hasUndo(),true);assert.equal(tasks.hasUndo(),false,'a successful deletion in another mount transfers ownership');
 canUndo=false;focus.context.recovery();tasks.context.recovery();assert.equal(focus.hasUndo(),false);assert.equal(tasks.hasUndo(),false);
});

test('a rejected deletion does not steal recovery ownership and a failed owner action retains Undo',async()=>{
 let reject=false;const store={canUndoRemove:()=>true,async remove(){if(reject)throw Error('Disk full');}},owners=new WeakMap(),tasks=recoveryFixture(store,owners),focus=recoveryFixture(store,owners);
 await tasks.context.removeTask('one');tasks.context.recovery();reject=true;await assert.rejects(focus.context.removeTask('two'));focus.context.recovery();assert.equal(tasks.hasUndo(),true);assert.equal(focus.hasUndo(),false);assert.equal(owners.get(store),tasks.token);
 tasks.status.textContent='Could not save. Try again.';tasks.context.recovery();assert.equal(tasks.hasUndo(),true);assert.match(tasks.status.textContent,/Could not save/);
});
test('slot presentation changes preserve the task, form or timer route',()=>{
 const method=source.match(/setPresentation\(value\)\{[^\n]+\}/)[0].replace(/^setPresentation/,'function setPresentation');
 for(const view of ['tasks','timer','create-duration','settings','pomodoro']){
  const calls=[],context=vm.createContext({view,draw(){calls.push('draw');},setSize(value){calls.push(value);}});vm.runInContext(method,context);context.setPresentation('scene');
  assert.equal(context.view,view);assert.deepEqual(calls,['details','draw']);
 }
});
test('creation puts total and plan beside Add in a shared footer, with segments above',()=>{
 function node(tag,className,text=''){return {tag,className,textContent:text,children:[],append(...children){this.children.push(...children);},setAttribute(){}};}
 const screen=node('div',''),Core=require('../duration-core.js'),context=vm.createContext({Number,String,Math,Core,screen,node,
  view:'create-duration',draft:{title:'Read a chapter',h:'1',m:'30',split:false},busy:false,t:value=>value,
  pad:value=>String(value).padStart(2,'0'),button(command,label,glyph,className){const element=node('button',className);element.command=command;return element;},
  segmentBar(){return node('div','nd-segments');},store:{snapshot:()=>({settings:{work:25,rest:5,longRest:15,interval:4}})}
 });
 vm.runInContext(between('    const totalLabel =','    function node(')+between('    function durationView()','    function setDurationEditing('),context);context.durationView();
 const wrap=screen.children[0],preview=wrap.children.find(child=>child.className==='nd-plan-preview'),footer=wrap.children.find(child=>child.className==='nd-create-footer');
 assert.equal(preview.children.length,1);assert.equal(preview.children[0].className,'nd-segments');
 assert.equal(footer.children[0].className,'nd-plan-summary');assert.equal(footer.children[0].children[0].tag,'strong');assert.equal(footer.children[0].children[0].textContent,'1h30');assert.equal(footer.children[0].children[1].textContent,'1h15 focus · 15 min pauses');
 assert.equal(footer.children[1].command,'save-task');assert.equal(footer.children[1].textContent,'Ajouter la tâche');assert.equal(footer.hidden,false);
});

test('settings explain that only new tasks receive defaults before presenting the fields',()=>{
 function node(tag,className,text=''){return {tag,className,textContent:text,children:[],append(...children){this.children.push(...children);},setAttribute(){}};}
 const screen=node('div',''),context=vm.createContext({String,screen,node,t:value=>value,button(command,label,glyph,className){const element=node('button',className);element.command=command;return element;},store:{snapshot:()=>({settings:{work:25,rest:5,longRest:15,interval:4}})}});
 vm.runInContext(between('    function settingsView()','    function fit()'),context);context.settingsView();const form=screen.children[0];
 assert.equal(form.children[0].children[0].textContent,'Réglages des nouvelles tâches');assert.equal(form.children[1].textContent,'Les tâches existantes gardent leurs réglages et leur progression.');
 assert.deepEqual(form.children[2].children.map(label=>label.children[0].value),[25,5,15,4]);
});
test('overall remaining time uses hours and minutes while the phase clock stays separate',()=>{
 const Core=require('../duration-core.js');
 for(const [minutes,expected]of [[90,'1h30 restantes'],[122,'2h02 restantes'],[1,'1 min restante']]){
  const remaining={textContent:''},task={id:'task',title:'Reading',totalMinutes:minutes,elapsedMs:0,done:false,settings:{work:25,rest:5,longRest:15,interval:4}},context=vm.createContext({Number,String,Math,Core,view:'timer',size:'half',ACCENT:'#ff7a45',surface:{style:{setProperty(){}}},
   selected:()=>task,t:value=>value,pad:value=>String(value).padStart(2,'0'),screen:{querySelectorAll:()=>[]},$:selector=>selector==='.nd-remaining-label'?remaining:null});
  vm.runInContext(between('    const totalLabel =','    function node(')+between('    function updateTimer(','    function notifyPhase('),context);context.updateTimer({tasks:[task],activeId:'task',startedAt:null});assert.equal(remaining.textContent,expected);
 }
});

test('changing the selected task refreshes every timer title without reopening the view',()=>{
 const Core=require('../duration-core.js'),titles=[{textContent:'',title:''},{textContent:'',title:''},{textContent:'',title:''}];
 const task=id=>({id,title:'Task '+id,totalMinutes:25,elapsedMs:0,done:false,settings:{work:25,rest:5,longRest:15,interval:4}});
 const tasks=[task('A'),task('B')],context=vm.createContext({Number,String,Math,Core,view:'timer',size:'full',ACCENT:'#ff7a45',surface:{style:{setProperty(){}}},
  selected:state=>state.tasks.find(task=>task.id===state.activeId),t:value=>value,pad:value=>String(value).padStart(2,'0'),
  screen:{querySelectorAll:selector=>selector.includes('.nd-mini-title')?titles:[]},$:()=>null});
 vm.runInContext(between('    function updateTimer(','    function notifyPhase('),context);
 context.updateTimer({tasks,activeId:'A',startedAt:null});
 assert(titles.every(title=>title.textContent==='Task A'&&title.title==='Task A'));
 context.updateTimer({tasks,activeId:'B',startedAt:null});
 assert(titles.every(title=>title.textContent==='Task B'&&title.title==='Task B'));
});

test('leaving a form or detailed timer restores the host destination without changing task state',()=>{
 const method=source.match(/cancelEdit\(\)\{[^\n]+\}/)[0].replace(/^cancelEdit/,'function cancelEdit');
 for(const hostView of ['tasks','timer'])for(const view of ['settings','create-title','create-duration','pomodoro']){
  let draws=0;const context=vm.createContext({view,viewToken:0,options:{view:hostView},draw(){draws++;}});
  vm.runInContext(method,context);context.cancelEdit();assert.equal(context.view,hostView);assert.equal(context.viewToken,1);assert.equal(draws,1);
 }
});

test('embedded lists fill their slot from a shared top inset while forms retain their reference canvas',()=>{
 const fit=source.includes('    function fit()')?between('    function fit()','    function draw()'):source.match(/fit\(\)\{[^\n]+\}/)[0].replace(/^fit/,'function fit');
 const SIZES={quarter:{width:220,height:120},half:{width:440,height:120},details:{width:440,height:180},full:{width:440,height:240}};
 for(const [view,size,width,height,logicalWidth,logicalHeight]of [
  ['tasks','quarter',199.453,126,220,120],['tasks','half',199.453,260,440,240],
  ['timer','quarter',199.453,126,220,120],['timer','half',350,126,440,120],
  ['timer','details',350,260,440,180],['timer','full',562,260,440,240],['tasks','full',326,260,440,240],
  ['create-title','quarter',562,260,440,240],['create-duration','half',562,260,440,240],
  ['settings','quarter',562,260,440,240],['pomodoro','quarter',562,260,440,240],
 ]){
  const surface={style:{},dataset:{}},screen={style:{}},context=vm.createContext({Math,SIZES,view,size,options:{embedded:true},host:{getBoundingClientRect:()=>({width,height})},surface,screen});
  vm.runInContext(fit,context);context.fit();
  const scale=Number(screen.style.transform.match(/scale\(([^)]+)\)/)[1]),content=['tasks','timer','pomodoro'].includes(view);
  if(content){
   assert.equal(screen.style.left,'0px');assert(Math.abs(parseFloat(screen.style.width)*scale-width)<.001,'the list uses the slot width instead of a centered narrow frame');
   assert(Math.abs(parseFloat(screen.style.top)+parseFloat(screen.style.height)*scale-height)<.001,'the list keeps its lower edge inside the slot');
   const labelTop=view==='tasks'&&size==='quarter'?8:view==='timer'&&size==='quarter'?15:view==='timer'&&size!=='full'?14:22;
   const actualTop=parseFloat(screen.style.top)+labelTop*scale;
   assert(actualTop>=0&&actualTop<=20,'content starts near the neighboring artwork instead of halfway down the slot');
   if(view==='tasks'&&size==='full'&&width>=326)assert(scale*13.5>=12,'narrow task titles remain readable');
  }else{
   assert.equal(screen.style.width,logicalWidth+'px');assert.equal(screen.style.height,logicalHeight+'px');
   assert.equal(scale,Math.min(width/logicalWidth,height/logicalHeight));
   assert(Math.abs(parseFloat(screen.style.left)-(width-logicalWidth*scale)/2)<.001);
   assert(Math.abs(parseFloat(screen.style.top)-(height-logicalHeight*scale)/2)<.001);
  }
  assert.equal(surface.style.width,width+'px');assert.equal(surface.style.height,height+'px');
 }
});

test('scene transforms never resize the embedded reference content a second time',()=>{
 const surface={style:{},dataset:{}},screen={style:{}},context=vm.createContext({Math,SIZES:{full:{width:440,height:240}},view:'tasks',size:'full',options:{embedded:true},host:{clientWidth:562,clientHeight:260,getBoundingClientRect:()=>({width:281,height:130})},surface,screen});
 vm.runInContext(between('    function fit()','    function draw()'),context);context.fit();
 const scale=Number(screen.style.transform.match(/scale\(([^)]+)\)/)[1]);
 assert.equal(surface.style.width,'562px');assert.equal(surface.style.height,'260px');assert(Math.abs(parseFloat(screen.style.width)*scale-562)<.001);
});

test('the empty task card fills its available placement without shrinking its footer or centered message',()=>{
 const surface={dataset:{empty:'true'},style:{}},screen={style:{}},context=vm.createContext({Math,options:{embedded:true},host:{clientWidth:195.3,clientHeight:260,getBoundingClientRect:()=>({width:292.95,height:390})},surface,screen});
 vm.runInContext(between('    function fit()','    function draw()'),context);context.fit();assert.equal(screen.style.transform,'none');assert.equal(screen.style.width,'195.3px');assert.equal(screen.style.height,'260px');assert.equal(screen.style.left,'0px');assert.equal(screen.style.top,'0px');
});

function reorderFixture(scale,{reduced=false,appMotion=true,interrupted=false,animate=true,sameOrder=false,focusedRow=null,pending=false}={}){
 const order=interrupted?['B','C','A']:['A','B','C'],rows=new Map(),rowAnimations=new Map(),timers=new Map(pending?[['B',42]]:[]),animations=[],cancelled=[],moves=[],shadow={activeElement:null};
 const offsets=interrupted?{A:-36,B:18,C:18}:{A:0,B:0,C:0};
 const opacities={A:interrupted ? .12 : 1,B:1,C:1};
 const moving=row=>{moves.push(row.id);if(shadow.activeElement?.rowId===row.id)shadow.activeElement=null;order.splice(order.indexOf(row.id),1);};
 const list={scrollTop:36,offsetHeight:72,get children(){return order.map(id=>rows.get(id));},contains:element=>!!element&&rows.has(element.rowId),getBoundingClientRect:()=>({height:72*scale}),append(row){moving(row);order.push(row.id);},insertBefore(row,before){moving(row);order.splice(before?order.indexOf(before.id):order.length,0,row.id);}};
 for(const id of ['A','B','C']){
  rows.set(id,{id,getBoundingClientRect:()=>({top:(order.indexOf(id)*36+offsets[id]-list.scrollTop)*scale}),animate(frames,options){const animation={id,frames,options,cancel(){animation.cancelled=true;}};animations.push(animation);return animation;}});
  if(interrupted)rowAnimations.set(id,{cancel(){cancelled.push(id);offsets[id]=0;}});
 }
 const before=new Map([...rows].map(([id,row])=>[id,row.getBoundingClientRect().top]));
 const control=focusedRow?{rowId:focusedRow,isConnected:true,focus(options){assert.equal(options.preventScroll,true);shadow.activeElement=this;}}:null;shadow.activeElement=control;
 const context=vm.createContext({Map,Math,Number,rows,rowAnimations,timers,shadow,win:{getComputedStyle:row=>({opacity:opacities[row.id]})},reduced:{matches:reduced},motionEnabled:()=>appMotion!==false&&!reduced,MOTION:motion,$:()=>list});
 vm.runInContext(between('    function reorder(','    function updateRows('),context);
 const state={tasks:[{id:'A',done:sameOrder?interrupted:!interrupted},{id:'B',done:pending},{id:'C',done:false}]};context.reorder(state,animate);
 return{order,rows,rowAnimations,timers,context,state,list,animations,cancelled,before,scale,shadow,control,moves};
}
test('FLIP reordering converts viewport movement to logical coordinates at each canvas scale',()=>{
 for(const scale of [.9066,1,1.0833]){
  const f=reorderFixture(scale);assert.deepEqual(f.order,['B','C','A']);assert.equal(f.animations.length,3);assert.equal(f.list.scrollTop,36);
  for(const animation of f.animations){const delta=parseFloat(animation.frames[0].transform.match(/translateY\(([-\d.]+)px/)[1]);assert(Math.abs(delta-({A:-72,B:36,C:36}[animation.id]))<1e-8,'logical movement for '+animation.id+' at scale '+scale);assert.equal(animation.frames.at(-1).transform,'translateY(0)');}
 }
});
test('interrupting a row reorder resumes at its current rendered position after cancelling the old transform',()=>{
 for(const scale of [.9066,1,1.0833]){
  const f=reorderFixture(scale,{interrupted:true});assert.deepEqual(f.order,['A','B','C']);assert.equal(f.cancelled.length,3);assert.equal(f.animations.length,3);
  for(const animation of f.animations){const delta=parseFloat(animation.frames[0].transform.match(/translateY\(([-\d.]+)px/)[1]),after=f.rows.get(animation.id).getBoundingClientRect().top;assert(Math.abs(after+delta*scale-f.before.get(animation.id))<1e-8,'no interruption jump for '+animation.id+' at scale '+scale);}
 }
});

test('following rows fill the completed task gap in sequence and keep their presentation during the delay',()=>{
 const f=reorderFixture(.9066),byId=Object.fromEntries(f.animations.map(animation=>[animation.id,animation]));
 assert.equal(byId.B.options.delay,0);assert.equal(byId.C.options.delay,56);assert.equal(byId.A.options.delay,168,'the completed task settles after its followers');
 assert.equal(byId.B.options.duration,460);assert.equal(byId.A.options.duration,520);
 for(const animation of f.animations){assert.equal(animation.options.fill,'both');assert.notEqual(animation.options.easing,'linear');}
});

test('finished or cancelled row motion releases filled transforms and animation ownership',()=>{
 const f=reorderFixture(1),animation=f.animations[0];assert.equal(f.rowAnimations.size,3);
 animation.onfinish();assert.equal(animation.cancelled,true);assert.equal(f.rowAnimations.has(animation.id),false);
 const next=f.animations[1];next.oncancel();assert.equal(f.rowAnimations.has(next.id),false);
});

test('rapid completions finish every strike before reordering the shared list',()=>{
 const f=reorderFixture(1,{pending:true,focusedRow:'B'});assert.deepEqual(f.order,['A','B','C']);assert.deepEqual(f.moves,[]);assert.equal(f.animations.length,0);assert.equal(f.shadow.activeElement,f.control);
 f.timers.clear();f.context.reorder(f.state,true);assert.deepEqual(f.order,['C','A','B']);assert.equal(f.animations.length,3);assert.equal(f.list.scrollTop,36);assert.equal(f.shadow.activeElement,f.control);
});

test('completion gives its check and rightward strike a readable beat before any reorder',()=>{
 const Core=require('../duration-core.js'),config={work:25,rest:5,longRest:15,interval:4},task={id:'A',title:'Read a chapter',totalMinutes:25,settings:config,elapsedMs:0,done:true},state={tasks:[task],activeId:'A',startedAt:null},timers=new Map(),scheduled=[],reorders=[],classes=new Set();
 const part=()=>({setAttribute(){},replaceChildren(){},querySelector:()=>({}),textContent:''}),parts=Object.fromEntries(['.nd-radio','.nd-title-button','.nd-time-value','.nd-row-kind','.nd-row-play'].map(key=>[key,part()]));
 const row={dataset:{plan:'25:'+JSON.stringify(config)},offsetWidth:42,classList:{contains:name=>classes.has(name),add:name=>classes.add(name),remove:name=>classes.delete(name),toggle(name,on){if(on)classes.add(name);else classes.delete(name);}},querySelector:selector=>parts[selector],querySelectorAll:()=>[]};
 const context=vm.createContext({Core,Math,Number,JSON,rows:new Map([['A',row]]),rowAnimations:new Map(),timers,view:'tasks',size:'full',disposed:false,MOTION:motion,store:{snapshot:()=>state},motionEnabled:()=>true,t:value=>value,clock:String,totalLabel:String,icon:()=>({}),
  $:selector=>selector==='.nd-list'?{}:null,reorder:(...args)=>reorders.push(args),win:{clearTimeout(){},setTimeout(callback,delay){scheduled.push({callback,delay});return scheduled.length;}}});
 vm.runInContext(between('    function updateRows(','    function ring('),context);context.updateRows(state);
 assert(classes.has('is-completing'));assert.equal(scheduled.length,1);assert.equal(scheduled[0].delay,490);assert.equal(reorders.length,0);
 assert(motion.nudge>=9,'the shift remains perceptible in smaller placements');assert(motion.strike>=300,'the strike is readable, rather than effectively snapping');
 scheduled[0].callback();assert.equal(classes.has('is-completing'),false);assert.equal(reorders.length,1);assert.equal(reorders[0][0],state);assert.equal(reorders[0][1],true);assert.equal(timers.size,0);
});

test('completed travelling rows fade while crossing and interrupted rows resume at their displayed opacity',()=>{
 const complete=reorderFixture(1).animations.find(animation=>animation.id==='A');assert.equal(complete.frames[0].opacity,1);assert.equal(complete.frames[1].opacity,.12);assert.equal(complete.frames.at(-1).opacity,1);
 const reopen=reorderFixture(.9066,{interrupted:true}).animations.find(animation=>animation.id==='A');assert.equal(reopen.frames[0].opacity,.12);assert.equal(reopen.frames.at(-1).opacity,1);
});

test('confirming a duration refreshes only its plan and footer, preserving the animated field and input nodes',()=>{
 const replaced=[],config={work:25,rest:5,longRest:15,interval:4},original={id:'task',settings:{work:40}},generated=[{id:'preview'},{id:'footer'}];
 const context=vm.createContext({draft:{id:'task'},store:{snapshot:()=>({tasks:[original],settings:config})},
  durationPreview(settings,task){assert.equal(settings,original.settings);assert.equal(task,original);return generated;},
  $(selector){assert(['.nd-plan-preview','.nd-create-footer'].includes(selector),'do not replace the live duration field');return {replaceWith(element){replaced.push([selector,element.id]);}};}});
 vm.runInContext(between('    function refreshDurationPreview()','    function draftMinutes()'),context);context.refreshDurationPreview();
 assert.deepEqual(replaced,[['.nd-plan-preview','preview'],['.nd-create-footer','footer']]);
});
test('reduced motion cancels previous row animations and reorders without creating movement',()=>{
 for(const scale of [.9066,1,1.0833]){
  const f=reorderFixture(scale,{reduced:true,interrupted:true});assert.deepEqual(f.order,['A','B','C']);assert.equal(f.cancelled.length,3);assert.equal(f.animations.length,0);assert.equal(f.list.scrollTop,36);
 }
 const routine=reorderFixture(.9066,{interrupted:true,animate:false});assert.equal(routine.cancelled.length,0,'a routine nonanimated refresh preserves current movement');assert.equal(routine.animations.length,0);
});
test('application Animations Off suppresses row movement even when the OS preference permits it',()=>{
 const f=reorderFixture(.9066,{appMotion:false,reduced:false,interrupted:true});assert.deepEqual(f.order,['A','B','C']);assert.equal(f.cancelled.length,3);assert.equal(f.animations.length,0);
});
test('a passive row refresh leaves already ordered DOM and focused playback control untouched',()=>{
 const f=reorderFixture(.9066,{sameOrder:true,animate:false,focusedRow:'B'});assert.deepEqual(f.moves,[]);assert.equal(f.shadow.activeElement,f.control);assert.equal(f.list.scrollTop,36);
});
test('a real row move restores its focused control without scrolling the list',()=>{
 const f=reorderFixture(.9066,{interrupted:true,focusedRow:'A'});assert.deepEqual(f.order,['A','B','C']);assert(f.moves.includes('A'));assert.equal(f.shadow.activeElement,f.control);assert.equal(f.list.scrollTop,36);
});

function motionFixture(){
 const calls={rowCancelled:0,cssCancelled:0,cleared:[],removed:[],reorders:[],observed:[],disconnected:0,listenerRemoved:0},body={dataset:{}},listeners=new Map();
 let mutation;const reduced={matches:false,addEventListener(name,handler){listeners.set(name,handler);},removeEventListener(name,handler){assert.equal(listeners.get(name),handler);listeners.delete(name);calls.listenerRemoved++;}};
 class Observer{constructor(callback){mutation=callback;}observe(target,options){calls.observed.push({target,options});}disconnect(){calls.disconnected++;}}
 const draft={title:'Unfinished draft',h:'2',m:'15',split:true},state={tasks:[{id:'A',done:true},{id:'B',done:false}],activeId:'B',startedAt:7000};
 const context=vm.createContext({String,Map,doc:{body},win:{MutationObserver:Observer,clearTimeout:id=>calls.cleared.push(id)},reduced,disposed:false,draft,interval:91,
  surface:{dataset:{},getAnimations(options){assert.equal(options.subtree,true);return [{cancel(){calls.cssCancelled++;}}];}},
  rows:new Map(),rowAnimations:new Map(),timers:new Map(),store:{snapshot:()=>state},reorder:(value,animate)=>calls.reorders.push({value,animate})});
 vm.runInContext(between('    function motionEnabled()','    function selected('),context);
 return{context,calls,body,reduced,listeners,draft,state,mutate:()=>mutation()};
}

test('motion preference follows both the app and OS, settling only visual work without resetting a draft or clock',()=>{
 const f=motionFixture(),stop=f.context.watchMotionPreference();assert.equal(f.context.motionEnabled(),true);assert.equal(f.context.surface.dataset.motion,'true');
 assert.equal(f.calls.observed[0].target,f.body);assert.equal(f.calls.observed[0].options.attributeFilter.join(','),'data-motion');
 f.context.rows.set('A',{classList:{remove:value=>f.calls.removed.push(value)}});f.context.timers.set('A',42);f.context.rowAnimations.set('A',{cancel(){f.calls.rowCancelled++;}});
 f.body.dataset.motion='false';f.mutate();
 assert.equal(f.context.motionEnabled(),false);assert.equal(f.context.surface.dataset.motion,'false');assert.equal(f.calls.rowCancelled,1);assert.equal(f.calls.cssCancelled,1);assert.deepEqual(f.calls.cleared,[42]);assert.deepEqual(f.calls.removed,['is-completing']);
 assert.equal(f.context.rowAnimations.size,0);assert.equal(f.context.timers.size,0);assert.equal(f.calls.reorders.length,1);assert.equal(f.calls.reorders[0].value,f.state);assert.equal(f.calls.reorders[0].animate,false);
 assert.equal(f.context.draft,f.draft);assert.deepEqual(f.draft,{title:'Unfinished draft',h:'2',m:'15',split:true});assert.equal(f.context.interval,91);assert.equal(f.state.startedAt,7000);
 f.body.dataset.motion='true';f.reduced.matches=true;f.listeners.get('change')();assert.equal(f.context.surface.dataset.motion,'false','OS reduced motion still overrides app On');
 const settled=f.calls.reorders.length;f.reduced.matches=false;f.listeners.get('change')();assert.equal(f.context.surface.dataset.motion,'true');assert.equal(f.calls.reorders.length,settled,'enabling motion never replays old movement');
 stop();assert.equal(f.calls.disconnected,1);assert.equal(f.calls.listenerRemoved,1);assert.equal(f.listeners.size,0);
 const cancelled=f.calls.cssCancelled;f.context.disposed=true;f.body.dataset.motion='false';f.mutate();assert.equal(f.calls.cssCancelled,cancelled,'an already queued observer callback is inert after disposal');
 f.context.doc.body=null;f.reduced.matches=false;assert.equal(f.context.motionEnabled(),true,'standalone modules keep default motion without an app flag');
});

test('disposing the module disconnects motion subscriptions exactly once',()=>{
 const f=motionFixture(),stop=f.context.watchMotionPreference();Object.assign(f.context,{stopWatchingMotion:stop,unsubscribe(){},win:{clearInterval(){}},interval:91,cleanView(){},
  screen:{removeEventListener(){}},status:{removeEventListener(){}},RECOVERY_OWNERS:new WeakMap(),recoveryToken:{},onClick(){},onInput(){},onSubmit(){},onKey(){},onContext(){},ownStore:false,link:{remove(){}},surface:{remove(){}}});
 const method=source.match(/dispose\(\)\{[^\n]+\}/)[0].replace(/^dispose/,'function dispose');vm.runInContext(method,f.context);f.context.dispose();f.context.dispose();
 assert.equal(f.calls.disconnected,1);assert.equal(f.calls.listenerRemoved,1);assert.equal(f.listeners.size,0);assert.equal(f.context.disposed,true);
});
