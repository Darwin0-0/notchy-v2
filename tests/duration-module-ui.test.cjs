'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../duration-module.js'),'utf8');
const motion=vm.runInNewContext('('+source.match(/const MOTION = Object\.freeze\((\{[^\n]+\})\);/)[1]+')');
function between(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
const uiContext=value=>vm.createContext({boundary:null,surface:{dataset:{}},clearCompletion(){},motionEnabled:()=>false,updateClock(element,value){element.textContent=value;},...value});

test('the actual shared clock renders the full supported phase range without rolling a second timer',()=>{
 const context=uiContext({String,Math});
 vm.runInContext(between('    const pad =','    const totalLabel =')+'this.clock=clock;',context);
 for(const [milliseconds,expected]of [[-1,'00:00'],[0,'00:00'],[1,'00:01'],[59000,'00:59'],[60000,'01:00'],[10799000,'179:59'],[10800000,'180:00']])assert.equal(context.clock(milliseconds),expected);
});

test('the current duration editor accepts hours and minutes through 23h59 and rejects malformed new tasks',()=>{
 const context=uiContext({Number,draft:{h:'0',m:'1'},store:{snapshot:()=>({tasks:[]})}});
 vm.runInContext(between('    function draftMinutes()','    function setDurationEditing('),context);
 for(const [h,m,expected]of [['0','1',1],['1','30',90],['3','0',180],['23','59',1439]]){Object.assign(context.draft,{h,m});assert.equal(context.draftMinutes(),expected);}
 for(const [h,m]of [['0','0'],['24','0'],['1','60'],['-1','30'],['0','2.5'],['','25'],['0','Infinity']]){Object.assign(context.draft,{h,m});assert.equal(context.draftMinutes(),null);}
});

function fixture(save=async()=>{}){
 const fields={title:{value:'Read a chapter',focus(){}},h:{value:'1'},m:{value:'30'},save:{disabled:false,focus(){}}};
 const state={tasks:[]},calls={saved:[],draws:0,previews:0,merged:0,views:[],focus:0};
 const context=uiContext({Promise,Number,String,Math,Object,rows:new Map(),
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
 const context=uiContext({Promise,view:'tasks',viewToken:1,size:'half',taskListReturn:null,disposed:false,status:{textContent:''},rows,store,
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
 const token={clear(){if(status.querySelector())status.replaceChildren();}},context=uiContext({store,RECOVERY_OWNERS:owners,recoveryToken:token,status,t:value=>value,node:(_tag,_class,textContent)=>({textContent}),button:command=>({command,textContent:''})});
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
  const calls=[],context=uiContext({view,draw(){calls.push('draw');},setSize(value){calls.push(value);}});vm.runInContext(method,context);context.setPresentation('scene');
  assert.equal(context.view,view);assert.deepEqual(calls,['details','draw']);
 }
});
test('an embedded renderer never requests a host resize while all four maquette formats remain available',()=>{
 const sizes={quarter:{width:220,height:120},half:{width:440,height:120},details:{width:440,height:180},full:{width:440,height:240}};
 for(const embedded of [true,false]){
  const requests=[],removed=[],surface={dataset:{},style:{removeProperty:value=>removed.push(value)}},context=uiContext({SIZES:sizes,size:'full',surface,options:{embedded,onResize:value=>requests.push(value)}});
  vm.runInContext(between('    function setSize(','    function closeMenu('),context);
  for(const size of Object.keys(sizes)){context.setSize(size);assert.equal(context.size,size);assert.equal(surface.dataset.size,size);}
  assert.equal(removed.length,8);assert.equal(requests.length,embedded?0:4);
  assert.throws(()=>context.setSize('unknown'),/Unknown module size/);assert.equal(context.size,'full');
 }
});
test('creation puts total and plan beside Add in a shared footer, with segments above',()=>{
 function node(tag,className,text=''){return {tag,className,textContent:text,children:[],append(...children){this.children.push(...children);},setAttribute(){}};}
 const screen=node('div',''),Core=require('../duration-core.js'),context=uiContext({Number,String,Math,Core,screen,node,
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
 const screen=node('div',''),context=uiContext({String,screen,node,t:value=>value,button(command,label,glyph,className){const element=node('button',className);element.command=command;return element;},store:{snapshot:()=>({settings:{work:25,rest:5,longRest:15,interval:4}})}});
 vm.runInContext(between('    function settingsView()','    function fit()'),context);context.settingsView();const form=screen.children[0];
 assert.equal(form.children[0].children[0].textContent,'Réglages des nouvelles tâches');assert.equal(form.children[1].textContent,'Les tâches existantes gardent leurs réglages et leur progression.');
 assert.deepEqual(form.children[2].children.map(label=>label.children[0].value),[25,5,15,4]);
});
test('overall remaining time uses hours and minutes while the phase clock stays separate',()=>{
 const Core=require('../duration-core.js');
 for(const [minutes,expected]of [[90,'1h30 restantes'],[122,'2h02 restantes'],[1,'1 min restante']]){
  const remaining={textContent:''},task={id:'task',title:'Reading',totalMinutes:minutes,elapsedMs:0,done:false,settings:{work:25,rest:5,longRest:15,interval:4}},context=uiContext({Number,String,Math,Core,view:'timer',size:'half',ACCENT:'#ff7a45',surface:{dataset:{},style:{setProperty(){}}},
   selected:()=>task,t:value=>value,pad:value=>String(value).padStart(2,'0'),screen:{querySelectorAll:()=>[]},$:selector=>selector==='.nd-remaining-label'?remaining:null});
  vm.runInContext(between('    const totalLabel =','    function node(')+between('    function updateTimer(','    function notifyPhase('),context);context.updateTimer({tasks:[task],activeId:'task',startedAt:null});assert.equal(remaining.textContent,expected);
 }
});

test('changing the selected task refreshes every timer title without reopening the view',()=>{
 const Core=require('../duration-core.js'),titles=[{textContent:'',title:''},{textContent:'',title:''},{textContent:'',title:''}];
 const task=id=>({id,title:'Task '+id,totalMinutes:25,elapsedMs:0,done:false,settings:{work:25,rest:5,longRest:15,interval:4}});
 const tasks=[task('A'),task('B')],context=uiContext({Number,String,Math,Core,view:'timer',size:'full',ACCENT:'#ff7a45',surface:{dataset:{},style:{setProperty(){}}},
  selected:state=>state.tasks.find(task=>task.id===state.activeId),t:value=>value,pad:value=>String(value).padStart(2,'0'),
  screen:{querySelectorAll:selector=>selector.includes('.nd-mini-title')?titles:[]},$:()=>null});
 vm.runInContext(between('    function updateTimer(','    function notifyPhase('),context);
 context.updateTimer({tasks,activeId:'A',startedAt:null});
 assert(titles.every(title=>title.textContent==='Task A'&&title.title==='Task A'));
 context.updateTimer({tasks,activeId:'B',startedAt:null});
 assert(titles.every(title=>title.textContent==='Task B'&&title.title==='Task B'));
});

function canonicalTree(presentation,{empty=false}={}){
 const Core=require('../duration-core.js'),state=Core.fresh(),calls={rows:0,timer:0,empty:0};
 if(!empty){state.tasks=[{id:'one',title:'Read a chapter',totalMinutes:90,elapsedMs:0,done:false,settings:{...state.settings}},{id:'two',title:'Review the project',totalMinutes:25,elapsedMs:0,done:false,settings:{...state.settings}}];state.activeId='one';}
 const node=(tag,className='',textContent='')=>({tag,className,textContent,dataset:{},attributes:{},children:[],append(...children){this.children.push(...children);},setAttribute(key,value){this.attributes[key]=String(value);}});
 const screen=node('div'),button=(command,label,glyph,className)=>{const element=node('button',className);element.dataset.command=command;element.label=label;element.glyph=glyph;return element;};
 const context=uiContext({Math,Core,node,button,screen,surface:{dataset:{modulePresentation:presentation}},clock:ms=>String(ms/60000).padStart(2,'0')+':00',t:value=>value,selected:value=>value.tasks.find(task=>task.id===value.activeId)||null,
  updateRows(value){assert.equal(value,state);calls.rows++;},updateTimer(value){assert.equal(value,state);calls.timer++;},empty(){calls.empty++;}});
 vm.runInContext(between('    function header(','    function empty(')+between('    function moduleRing(','    function timerView('),context);context.moduleView(state);
 const all=()=>{const result=[];const visit=element=>{result.push(element);for(const child of element.children)visit(child);};visit(screen);return result;};
 return{context,state,screen,calls,all,find:name=>all().find(element=>element.className.split(' ').includes(name)),commands:()=>all().filter(element=>element.tag==='button').map(element=>element.dataset.command)};
}

test('Full and Main keep one selected timer beside the live task list instead of alternating pages',()=>{
 for(const presentation of ['full','main']){
  const f=canonicalTree(presentation);assert(f.find('nd-module-timer'));assert(f.find('nd-module-list'));assert(f.find('nd-divider'));assert.equal(f.find('nd-module-upnext'),undefined);assert.equal(f.find('nd-module-small-ring'),undefined);
  assert.deepEqual(f.commands(),['open-details','restart','toggle','skip',...(presentation==='main'?['open-details']:[]),'settings','add']);
  assert.equal(f.find('nd-module-list').attributes.role,'list');assert.equal(f.find('nd-module-list').attributes['aria-label'],'Tâches');assert.equal(f.calls.rows,1);assert.equal(f.calls.timer,1);assert.equal(f.calls.empty,0);
  assert.match(f.find('nd-module-ring').innerHTML,/viewBox="0 0 100 100"/);assert.match(f.find('nd-module-ring').innerHTML,new RegExp('stroke-width="'+6+'"'));assert.match(f.find('nd-module-ring').innerHTML,/stroke="#202024"/,'the DS control track remains visible against the host surface-card');
 }
});

test('Side offers the selected timer and actual next task; Small keeps just clock, title and one transport',()=>{
 const side=canonicalTree('side');assert(side.find('nd-module-timer'));assert(side.find('nd-module-upnext'));assert.equal(side.find('nd-upnext-kicker').textContent,'Ensuite');assert.equal(side.find('nd-module-list'),undefined);assert.deepEqual(side.commands(),['open-details','restart','toggle','skip','detail']);
 const small=canonicalTree('small');assert(small.find('nd-mini-clock'));assert(small.find('nd-module-small-title'));assert(small.find('nd-module-small-ring'));assert.equal(small.find('nd-module-timer'),undefined);assert.equal(small.find('nd-module-list'),undefined);assert.deepEqual(small.commands(),['open-details','toggle']);
});

test('an empty Small starts the real task form and never advertises invented timer progress',()=>{
 const f=canonicalTree('small',{empty:true});assert.deepEqual(f.commands(),['add','add']);assert.equal(f.find('nd-module-small-title').textContent,'Nouvelle tâche');assert.equal(f.calls.empty,0);
 const svg=f.find('nd-module-ring').innerHTML;assert.equal(svg.match(/stroke-dasharray="([^"]+)"/)[1],svg.match(/stroke-dashoffset="([^"]+)"/)[1]);
 for(const presentation of ['full','main','side']){const empty=canonicalTree(presentation,{empty:true});assert.equal(empty.calls.empty,1);assert.equal(empty.screen.children.length,0,'the existing empty card owns its task creation actions');}
});

test('empty cards keep their message separate from the real creation action in every tall format',()=>{
 for(const presentation of ['full','main','side','tall']){
  const f=canonicalTree(presentation,{empty:true});vm.runInContext(between('    function empty()','    function segmentBar('),f.context);f.context.moduleView(f.state);
  const content=f.find('nd-empty'),message=f.find('nd-empty-content'),action=f.find('nd-primary');assert.deepEqual(content.children,[message,action],'the action is outside the independently sized message area');assert.deepEqual(message.children.map(child=>child.tag),['div','h2','p']);assert.equal(message.children[1].textContent,'Aucune tâche');assert.equal(message.children[2].textContent,'Elles seront découpées en sessions Pomodoro.');assert.equal(action.dataset.command,'add');assert.equal(action.label,'Nouvelle tâche');assert.equal(action.children[0].textContent,'Nouvelle tâche');assert.match(message.children[0].innerHTML,/<circle class="nd-empty-rays"/);assert.match(message.children[0].innerHTML,/<path d="M22 26/,'the checklist itself remains a separate stationary SVG path');
 }
});

test('a Small projection redraws its Add or transport actions when the shared store changes emptiness elsewhere',()=>{
 const subscription=source.match(/    const unsubscribe=store\.subscribe\([^\n]+/)[0];
 for(const view of ['tasks','timer'])for(const [wasEmpty,taskCount,expectedDraw]of [[true,1,true],[false,0,true],[false,1,false],[true,0,false]]){
  let handler,draws=0,updates=0;const context=uiContext({disposed:false,view,renderedPlan:'same',surface:{dataset:{canonicalView:'true',modulePresentation:'small',empty:String(wasEmpty)}},store:{subscribe(callback){handler=callback;}},notifyPhase(){},planSignature:()=> 'same',draw(){draws++;},updateRows(){updates++;},updateTimer(){},recovery(){},$:()=>null});
  vm.runInContext(subscription,context);handler({tasks:Array.from({length:taskCount},(_,id)=>({id}))});assert.equal(draws,expectedDraw?1:0);assert.equal(updates,expectedDraw?0:1);
 }
});

test('canonical content fills every approved ideal and minimum budget at native scale',()=>{
 for(const [presentation,width,height]of [['full',812,368],['full',640,304],['main',536,368],['main',500,304],['side',260,368],['side',220,304],['tall',260,240],['tall',220,220],['wide',536,112],['wide',500,104],['small',260,112],['small',220,88],['small',196,88],['small',196,260],['small',219,88]])for(const view of ['tasks','timer']){
  const surface={style:{},dataset:{canonicalView:'true',modulePresentation:presentation,empty:'false'}},screen={style:{}},draft={title:'Do not replace'},context=uiContext({Math,view,size:'full',options:{embedded:true},SIZES:{full:{width:440,height:240}},host:{clientWidth:width,clientHeight:height,getBoundingClientRect:()=>({width:width*1.2,height:height*1.2})},surface,screen,draft});
  vm.runInContext(between('    function fit()','    function draw()'),context);context.fit();assert.equal(screen.style.transform,'none');assert.equal(screen.style.width,width+'px');assert.equal(screen.style.height,height+'px');assert.equal(screen.style.left,'0px');assert.equal(screen.style.top,'0px');assert.equal(surface.dataset.nativeScroll,'false');assert.equal(context.draft,draft);
 }
});

test('the Small format keeps its64px ring and42px transport within its112px cell',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../duration-module.css'),'utf8');
 assert(css.includes('--space-16,16px'));assert(css.includes('.nd-module-small-ring{position:relative;flex:none;width:64px;height:64px}'));
 assert(css.includes('.nd-module-small-ring>.nd-toggle{position:absolute;inset:11px;width:42px;height:42px}'));
 assert.equal(112-16*2,80);assert(64<=80);assert.equal(64-11*2,42);
 assert(css.includes('@container(max-width:219.999px)'),'the compatibility interval includes fractional widths');
});

test('canonical reassignment preserves business view and editor nodes, with no model or host-size operation',()=>{
 const method=source.match(/setModulePresentation\(value\)\{[^\n]+\}/)[0].replace(/^setModulePresentation/,'function setModulePresentation');
 for(const view of ['tasks','timer','create-title','create-duration','settings','pomodoro']){
  let draws=0,fits=0;const draft={title:'Unfinished draft',h:'2',m:'15',split:true},context=uiContext({surface:{dataset:{}},view,draft,draw(){draws++;},fit(){fits++;}});vm.runInContext(method,context);
  for(let round=0;round<2;round++)for(const presentation of ['full','main','side','small']){assert.equal(context.setModulePresentation(presentation),true);assert.equal(context.setModulePresentation(presentation),false);assert.equal(context.surface.dataset.modulePresentation,presentation);assert.equal(context.view,view);assert.equal(context.draft,draft);}
  assert.equal(draws,['tasks','timer'].includes(view)?8:0);assert.equal(fits,['tasks','timer'].includes(view)?0:8);assert.throws(()=>context.setModulePresentation('quarter'),/Unknown module presentation/);assert.equal(context.surface.dataset.modulePresentation,'small');assert.equal(context.setModulePresentation(null),true);assert.equal(context.surface.dataset.modulePresentation,undefined);
 }
});

test('a legacy Quarter to canonical Full and Main transition preserves the running session and isolates legacy styles',async()=>{
 const Core=require('../duration-core.js'),initial=Core.fresh();initial.tasks=[{id:'one',title:'Continue the same session',totalMinutes:90,elapsedMs:12000,done:false,settings:{...initial.settings}}];initial.activeId='one';initial.startedAt=1000000;
 let writes=0,draws=0;const store=Core.createStore({load:()=>JSON.stringify(initial),save:async()=>{writes++;},now:()=>1000000});await store.ready;const saved=JSON.stringify(store.snapshot()),surface={dataset:{},style:{removeProperty(){}}},context=uiContext({surface,store,view:'tasks',size:'full',SIZES:{quarter:{width:220,height:120},full:{width:440,height:240}},options:{embedded:true,onResize(){throw Error('A module cannot resize its host');}},draw(){draws++;},fit(){}});
 vm.runInContext(between('    function setSize(','    function closeMenu(')+source.match(/setPresentation\(value\)\{[^\n]+\}/)[0].replace(/^setPresentation/,'function setPresentation')+'\n'+source.match(/setModulePresentation\(value\)\{[^\n]+\}/)[0].replace(/^setModulePresentation/,'function setModulePresentation'),context);
 context.setPresentation('quarter');assert.equal(surface.dataset.size,'quarter');assert.equal(context.size,'quarter');assert.equal(context.view,'tasks');
 for(const presentation of ['full','main','side','small','full']){context.setModulePresentation(presentation);assert.equal(surface.dataset.modulePresentation,presentation);assert.equal(surface.dataset.size,'quarter','compatibility size is retained independently');assert.equal(JSON.stringify(store.snapshot()),saved);assert.equal(writes,0);}
 assert.equal(draws,6);store.dispose();
 const css=fs.readFileSync(path.join(__dirname,'../duration-module.css'),'utf8'),legacySelectors=[...css.matchAll(/([^{}]+)\{/g)].map(match=>match[1]).filter(selector=>selector.includes('[data-size=quarter][data-view=tasks]'));
 assert(legacySelectors.length>0);for(const selector of legacySelectors)assert(selector.includes(':not([data-canonical-view=true])'),'legacy Quarter selectors cannot override native canonical controls: '+selector);
});

test('canonical Tasks updates its visible timer, selected name, progress and next real task without switching view',()=>{
 const Core=require('../duration-core.js'),state=Core.fresh();state.tasks=[{id:'one',title:'Current real task',totalMinutes:90,elapsedMs:12000,done:false,settings:{...state.settings}},{id:'done',title:'Already finished',totalMinutes:25,elapsedMs:0,done:true,settings:{...state.settings}},{id:'next',title:'The next real task',totalMinutes:40,elapsedMs:0,done:false,settings:{...state.settings}}];state.activeId='one';state.startedAt=1000;
 const clocks=[{},{}],titles=[{}],smallTitle={},phase={},progress={style:{},closest:()=>({dataset:{circumference:276}})},nextTitle={},nextDuration={},next={dataset:{},setAttribute(key,value){this[key]=value;},querySelector:selector=>selector==='.nd-upnext-title'?nextTitle:nextDuration},play={setAttribute(key,value){this[key]=value;},querySelector:()=>({replaceWith(value){play.glyph=value;}})};
 const context=uiContext({Core,Number,String,Math,view:'tasks',size:'full',ACCENT:'#ff7a45',surface:{dataset:{canonicalView:'true'},style:{setProperty(){}}},selected:value=>value.tasks.find(task=>task.id===value.activeId),t:value=>value,pad:value=>String(value).padStart(2,'0'),clock:String,phaseLabel:value=>value.current.kind==='focus'?'Focus':'Pause',icon:value=>value,
  screen:{querySelectorAll:selector=>selector==='.nd-clock,.nd-mini-clock'?clocks:selector.includes('.nd-mini-title')?titles:selector==='.nd-ring-progress'?[progress]:[]},$:selector=>({'.nd-module-small-title':smallTitle,'.nd-upnext-task':next,'.nd-phase':phase,'[data-command=toggle]':play})[selector]||null});
 vm.runInContext(between('    const totalLabel =','    function node(')+between('    function updateTimer(','    function notifyPhase('),context);context.updateTimer(state);const expected=Core.phase(state.tasks[0]);
 assert(clocks.every(item=>item.textContent===String(expected.remainingMs)));assert.equal(titles[0].textContent,'Current real task');assert.equal(smallTitle.textContent,'Current real task · 1/3');assert.equal(progress.style.strokeDashoffset,276*expected.fraction);assert.equal(next.dataset.id,'next');assert.equal(nextTitle.textContent,'The next real task');assert.equal(nextDuration.textContent,'40 min');assert.equal(next.disabled,false);assert.equal(play.glyph,'pause');assert.equal(play.disabled,false);assert.equal(context.view,'tasks');
 state.startedAt=null;state.tasks[2].done=true;context.updateTimer(state);assert.equal(next.disabled,true);assert.equal(next.dataset.id,'');assert.equal(nextTitle.textContent,'Tout est fait');assert.equal(nextDuration.textContent,'');assert.equal(play.glyph,'play');
});

test('leaving a form or detailed timer restores the host destination without changing task state',()=>{
 const method=source.match(/cancelEdit\(\)\{[^\n]+\}/)[0].replace(/^cancelEdit/,'function cancelEdit');
 for(const hostView of ['tasks','timer'])for(const view of ['settings','create-title','create-duration','pomodoro']){
  let draws=0;const context=uiContext({view,viewToken:0,options:{view:hostView},draw(){draws++;}});
  vm.runInContext(method,context);context.cancelEdit();assert.equal(context.view,hostView);assert.equal(context.viewToken,1);assert.equal(draws,1);
 }
});

test('embedded lists fill their slot from a shared top inset while forms retain their reference canvas',()=>{
 const fit=source.includes('    function fit()')?between('    function fit()','    function draw()'):source.match(/fit\(\)\{[^\n]+\}/)[0].replace(/^fit/,'function fit');
 const SIZES={quarter:{width:220,height:120},half:{width:440,height:120},details:{width:440,height:180},full:{width:440,height:240}};
 for(const [view,size,width,height,logicalWidth,logicalHeight]of [
  ['tasks','quarter',220,120,220,120],['tasks','quarter',220,260,220,120],
  ['timer','quarter',220,126,220,120],['timer','half',440,126,440,120],
  ['timer','details',440,180,440,180],['timer','full',676,260,440,240],['tasks','full',440,260,440,240],
  ['create-title','quarter',562,260,440,240],['create-duration','half',562,260,440,240],
  ['settings','quarter',562,260,440,240],['pomodoro','quarter',562,260,440,240],
 ]){
  const surface={style:{},dataset:{}},screen={style:{}},context=uiContext({Math,SIZES,view,size,options:{embedded:true},host:{getBoundingClientRect:()=>({width,height})},surface,screen});
  vm.runInContext(fit,context);context.fit();
  const scale=Number(screen.style.transform.match(/scale\(([^)]+)\)/)[1]),content=['tasks','timer','pomodoro'].includes(view);
  if(content){
   assert(scale>=1,'interactive content never shrinks below its approved native canvas');
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

test('narrow forms and Pomodoro use a native scroll canvas without rebuilding drafts or shrinking inputs',()=>{
 for(const view of ['create-title','create-duration','settings','pomodoro']){
  const surface={style:{},dataset:{empty:'false',emptyCard:'true'},scrollLeft:120,scrollTop:64},screen={style:{}},host={clientWidth:220,clientHeight:120,getBoundingClientRect:()=>({width:220,height:120})};
  const draft={title:'Keep the unfinished draft',h:'2',m:'15'},context=uiContext({Math,SIZES:{full:{width:440,height:240}},view,size:'quarter',draft,options:{embedded:true},host,surface,screen});
  vm.runInContext(between('    function fit()','    function draw()'),context);context.fit();
  assert.equal(surface.dataset.nativeScroll,'true');assert.equal(surface.dataset.emptyCard,'false','a previous empty card cannot restyle the editor');
  assert.equal(screen.style.width,'440px');assert.equal(screen.style.height,'240px');assert.equal(screen.style.left,'0px');assert.equal(screen.style.top,'0px');assert.equal(screen.style.transform,'none');
  context.fit();assert.equal(surface.scrollLeft,120);assert.equal(surface.scrollTop,64);assert.equal(context.draft,draft);assert.deepEqual(draft,{title:'Keep the unfinished draft',h:'2',m:'15'});
  host.clientWidth=562;host.clientHeight=260;context.fit();assert.equal(surface.dataset.nativeScroll,'false');assert.equal(surface.scrollLeft,0);assert.equal(surface.scrollTop,0);assert.equal(context.draft,draft);assert.equal(context.view,view);
 }
});

test('scene transforms never resize the embedded reference content a second time',()=>{
 const surface={style:{},dataset:{}},screen={style:{}},context=uiContext({Math,SIZES:{full:{width:440,height:240}},view:'tasks',size:'full',options:{embedded:true},host:{clientWidth:562,clientHeight:260,getBoundingClientRect:()=>({width:281,height:130})},surface,screen});
 vm.runInContext(between('    function fit()','    function draw()'),context);context.fit();
 const scale=Number(screen.style.transform.match(/scale\(([^)]+)\)/)[1]);
 assert.equal(surface.style.width,'562px');assert.equal(surface.style.height,'260px');assert(Math.abs(parseFloat(screen.style.width)*scale-562)<.001);
});

test('the empty task card fills its available placement without shrinking its footer or centered message',()=>{
 const surface={dataset:{empty:'true'},style:{}},screen={style:{}},context=uiContext({Math,view:'tasks',options:{embedded:true},host:{clientWidth:220.3,clientHeight:260,getBoundingClientRect:()=>({width:330.45,height:390})},surface,screen});
 vm.runInContext(between('    function fit()','    function draw()'),context);context.fit();assert.equal(screen.style.transform,'none');assert.equal(screen.style.width,'220.3px');assert.equal(screen.style.height,'260px');assert.equal(screen.style.left,'0px');assert.equal(screen.style.top,'0px');
});

test('empty cards use the exact available native cell budget, including compact tall minima',()=>{
 for(const [presentation,width,height]of [['full',812,368],['full',640,304],['main',536,368],['main',500,304],['side',260,368],['side',220,304],['tall',260,240],['tall',220,220]]){
  const surface={dataset:{empty:'true',modulePresentation:presentation,canonicalView:'true'},style:{}},screen={style:{}},context=uiContext({Math,view:'tasks',options:{embedded:true},host:{clientWidth:width,clientHeight:height,getBoundingClientRect:()=>({width:width*.7,height:height*.7})},surface,screen});vm.runInContext(between('    function fit()','    function draw()'),context);context.fit();assert.equal(surface.dataset.emptyCard,'true');assert.equal(screen.style.width,width+'px');assert.equal(screen.style.height,height+'px');assert.equal(screen.style.transform,'none');assert.equal(surface.dataset.nativeScroll,'false');
 }
});

test('the compact empty illustration and copy win the CSS cascade over their larger embedded defaults',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../duration-module.css'),'utf8'),marker='@container(max-height:287px)',at=css.indexOf(marker);assert(at>0);const compact=css.slice(at,css.indexOf('@media',at));
 const specificity=selector=>(selector.match(/\.[\w-]+|\[[^\]]+\]/g)||[]).length;
 for(const [target,property,value]of [['.nd-empty-art','width','40px'],['.nd-empty h2','font-size','16px'],['.nd-empty p','font-size','12px']]){
  const rules=text=>[...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(match=>match[1].trim().endsWith(target)),base=rules(css.slice(0,at)).filter(match=>match[1].includes('[data-empty-card=true]')).at(-1),override=rules(compact).at(-1);assert(base&&override,target+' has both large and compact styles');assert(specificity(override[1])>=specificity(base[1]),target+' compact selector cannot lose to the embedded default');assert(new RegExp('(?:^|;)'+property+':'+value+'(?:;|$)').test(override[2]),target+' resolves its compact metric');
 }
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
 const context=uiContext({Map,Math,Number,rows,rowAnimations,timers,shadow,win:{getComputedStyle:row=>({opacity:opacities[row.id]})},reduced:{matches:reduced},motionEnabled:()=>appMotion!==false&&!reduced,MOTION:motion,$:()=>list});
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
 const context=uiContext({Core,Math,Number,JSON,surface:{dataset:{}},rows:new Map([['A',row]]),rowAnimations:new Map(),timers,view:'tasks',size:'full',disposed:false,MOTION:motion,store:{snapshot:()=>state},motionEnabled:()=>true,t:value=>value,clock:String,totalLabel:String,icon:()=>({}),
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
 const context=uiContext({draft:{id:'task'},store:{snapshot:()=>({tasks:[original],settings:config})},
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
 const context=uiContext({String,Map,doc:{body},win:{MutationObserver:Observer,clearTimeout:id=>calls.cleared.push(id)},reduced,disposed:false,draft,interval:91,
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
 const f=motionFixture(),stop=f.context.watchMotionPreference();Object.assign(f.context,{stopWatchingMotion:stop,unsubscribe(){},win:{clearInterval(){},clearTimeout(){}},feedbackTimer:null,feedback:null,interval:91,cleanView(){},
  screen:{removeEventListener(){}},status:{removeEventListener(){}},RECOVERY_OWNERS:new WeakMap(),recoveryToken:{},onClick(){},onInput(){},onSubmit(){},onKey(){},onContext(){},ownStore:false,link:{remove(){}},surface:{remove(){}}});
 const method=source.match(/dispose\(\)\{[^\n]+\}/)[0].replace(/^dispose/,'function dispose');vm.runInContext(method,f.context);f.context.dispose();f.context.dispose();
 assert.equal(f.calls.disconnected,1);assert.equal(f.calls.listenerRemoved,1);assert.equal(f.listeners.size,0);assert.equal(f.context.disposed,true);
});


test('six cell formats expose only their supported content and retain live actions',()=>{
 for(const presentation of ['full','main','side','tall','wide','small']){
  const f=canonicalTree(presentation);
  assert.equal(!!f.find('nd-module-list'),['full','main'].includes(presentation));
  assert.equal(!!f.find('nd-module-upnext'),['side','wide'].includes(presentation));
  assert.equal(!!f.find('nd-module-small-ring'),['small','wide'].includes(presentation));
  assert(f.commands().includes('toggle'));
  if(presentation==='tall')assert.deepEqual(f.commands(),['open-details','restart','toggle','skip']);
  if(presentation==='wide')assert.deepEqual(f.commands(),['open-details','toggle','detail','settings']);
 }
});

test('real elapsed boundaries distinguish session, resume, long-break cycle and completion without demo progression',()=>{
 const Core=require('../duration-core.js'),context=uiContext({Core});
 vm.runInContext(between('    function phaseTransition(','    function announceCompletion('),context);
 const initial=Core.fresh();initial.tasks=[{id:'one',title:'Actual work',totalMinutes:150,elapsedMs:0,done:false,settings:{...initial.settings}}];initial.activeId='one';initial.startedAt=1000;
 for(const [elapsedMinutes,kind]of [[25,'session'],[30,'resume'],[115,'cycle'],[150,'complete']]){
  const before=Core.materialize(initial,1000+(elapsedMinutes-1)*60000),after=Core.materialize(initial,1000+elapsedMinutes*60000);
  const event=context.phaseTransition(before,after,1000+elapsedMinutes*60000);
  assert.equal(event.kind,kind);assert.equal(event.task.id,'one');assert.equal(initial.tasks[0].elapsedMs,0,'visual feedback never advances the clock');
  assert.equal(context.phaseTransition(after,after,1000+elapsedMinutes*60000),null,'a repeated snapshot does not replay the boundary');
 }
 const afterSkip=Core.normalize({...initial,tasks:[{...initial.tasks[0],elapsedMs:25*60000}]});
 assert.equal(context.phaseTransition(initial,afterSkip,6000),null,'manual Skip is not natural elapsed focus');
 assert.equal(context.phaseTransition({...initial,startedAt:null},afterSkip,25*60000+1000),null,'a paused clock cannot manufacture a boundary');
 assert.equal(context.phaseTransition(initial,{...afterSkip,activeId:null,startedAt:null},25*60000+1000),null,'changing tasks stays silent');
 assert.equal(context.phaseTransition(initial,{...afterSkip,tasks:[{...afterSkip.tasks[0],done:true}],startedAt:null},25*60000+1000),null,'manual task completion uses its own feedback');
});

test('canonical editors use native available width and vertical scroll instead of scaling the maquette',()=>{
 for(const view of ['settings','create-title','create-duration'])for(const [width,height]of [[260,112],[536,368],[812,368]]){
  const surface={dataset:{modulePresentation:'side'},style:{}},screen={style:{}},draft={title:'Preserved',h:'2',m:'15'},context=uiContext({Math,view,size:'full',options:{embedded:true},SIZES:{full:{width:440,height:240}},host:{clientWidth:width,clientHeight:height,getBoundingClientRect:()=>({width,height})},surface,screen,draft});
  vm.runInContext(between('    function fit()','    function draw()'),context);context.fit();
  assert.equal(screen.style.width,width+'px');assert.equal(screen.style.transform,'none');assert.equal(surface.dataset.nativeScroll,String(height<(view==='settings'?336:288)));assert.equal(context.draft,draft);
 }
});


test('an empty Wide cell exposes creation and settings without an invented next-task action',()=>{
 const f=canonicalTree('wide',{empty:true});assert.deepEqual(f.commands(),['add','add','settings']);assert.equal(f.find('nd-module-upnext'),undefined);assert.equal(f.find('nd-module-small-title').textContent,'Nouvelle t\u00e2che');
});



function clockFixture(){
 const animations=[];
 class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.attributes={};this.style={setProperty:(key,value)=>{this.style[key]=value;}};this.data='';this.ownerDocument=document;}
  set textContent(value){this.data=String(value);for(const child of this.children)child.parentNode=null;this.children=[];}get textContent(){return this.data+this.children.map(child=>child.textContent).join('');}
  append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}prepend(node){node.parentNode=this;this.children.unshift(node);}replaceChildren(...nodes){this.textContent='';this.append(...nodes);}setAttribute(key,value){this.attributes[key]=value;}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;}
  animate(frames,options){const animation={node:this,frames,options,cancel(){this.oncancel?.();}};animations.push(animation);return animation;}
 }
 const document={createElement:tag=>new Element(tag)},clock=new Element('div'),context=uiContext({WeakMap,Math,String,Number});vm.runInContext(between('  const CLOCKS =','  const RECOVERY_OWNERS'),context);return{clock,animations,update:context.updateClock};
}
test('clock animates only changed digits, keeping unchanged cells and the colon motionless',()=>{
 const f=clockFixture();f.update(f.clock,'24:59');const cells=[...f.clock.children],digits=cells.map(cell=>cell.children[0]);f.update(f.clock,'24:58');
 assert.equal(f.clock.attributes['aria-label'],'24:58');assert.equal(f.clock.attributes.role,'timer');assert.equal(f.clock.attributes['aria-live'],'off');assert.equal(f.animations.length,2);assert(f.animations.every(animation=>animation.node.parentNode===cells[4]));assert.deepEqual(f.clock.children,cells);for(let i=0;i<4;i++)assert.equal(cells[i].children[0],digits[i]);
 assert.equal(f.animations[0].frames.at(-1).transform,'translateY(12px)');assert.equal(f.animations[0].options.duration,350);assert.equal(f.animations[1].frames[0].transform,'translateY(-12px)');assert.equal(f.animations[1].options.duration,500);assert.equal(f.animations[0].node.attributes['aria-hidden'],'true');
 assert.equal(f.update(f.clock,'24:58'),false);assert.equal(f.animations.length,2);f.animations[0].onfinish();assert.equal(f.clock.textContent,'24:58');
});
test('minute rollover animates each changed digit and reverses direction for a larger value',()=>{
 const f=clockFixture();f.update(f.clock,'24:00');f.update(f.clock,'23:59');assert.equal(f.animations.length,6);assert(f.animations.every(animation=>animation.node.parentNode!==f.clock.children[0]&&animation.node.parentNode!==f.clock.children[2]));f.update(f.clock,'24:00');assert.equal(f.animations.at(-1).frames[0].transform,'translateY(12px)');
});
test('reduced motion updates the real clock silently and external text replacement rebuilds its detached cells',()=>{
 const f=clockFixture();f.update(f.clock,'25:00');f.update(f.clock,'24:59',{motion:false});assert.equal(f.animations.length,0);assert.equal(f.clock.textContent,'24:59');f.clock.textContent='Session terminée';assert.equal(f.update(f.clock,'24:59',{motion:false}),true);assert.equal(f.clock.textContent,'24:59');assert.equal(f.clock.children.length,5);
 f.update(f.clock,'180:00',{motion:false});f.update(f.clock,'99:59',{motion:false});assert.equal(f.clock.style['--nd-clock-columns'],5,'digit capacity never shrinks during the same countdown');assert.equal(f.clock.textContent,'99:59');
});
test('selecting a task in the canonical shared module keeps the current list and skips a redundant Pomodoro page',async()=>{
 const f=await taskFlowFixture();f.context.surface.dataset.canonicalView='true';const list=f.list;f.click('detail','two');await f.flush();assert.equal(f.context.view,'tasks');assert.equal(f.list,list);assert.deepEqual(f.calls.views,[]);assert.equal(f.store.snapshot().activeId,'two');assert.equal(f.store.snapshot().startedAt,null);assert.equal(f.active,f.timer);assert(!source.includes('function soloView('));f.store.dispose();
});


function boundaryFixture({motion=true}={}){
 const scheduled=new Map(),updates=[],Core=require('../duration-core.js');let nextId=0;
 const node=(tag,className='',textContent='')=>({tag,className,textContent,dataset:{},attributes:{},children:[],style:{setProperty(key,value){this[key]=value;}},classList:{add(value){this.value=value;}},append(...nodes){for(const child of nodes){child.parent=this;this.children.push(child);}},setAttribute(key,value){this.attributes[key]=String(value);},remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);this.parent=null;},querySelector(selector){return selector==='path'?this.children.find(child=>child.tag==='path'):null;}});
 const surface=node('section'),dial=node('div','nd-ring nd-module-ring'),state=Core.fresh();state.tasks=[{id:'one',title:'Real task',totalMinutes:150,elapsedMs:25*60000,done:false,settings:{...state.settings}}];state.activeId='one';
 const context=uiContext({Core,Math,ACCENT:'#ff7a45',node,surface,feedback:null,feedbackTimer:null,boundary:null,store:{snapshot:()=>state},motionEnabled:()=>motion,t:value=>value,$:selector=>selector==='.nd-module-ring'?dial:null,icon(name,size){const svg=node('svg');svg.append(node('path'));return svg;},doc:{createElementNS(_namespace,tag){return node(tag);}},win:{setTimeout(callback,delay){scheduled.set(++nextId,{callback,delay});return nextId;},clearTimeout(id){scheduled.delete(id);}},updateTimer(value){assert.equal(value,state);updates.push({kind:context.boundary?.kind,stage:context.boundary?.stage});}});
 vm.runInContext(between('    function clearCompletion()','    function notifyPhase('),context);return{context,state,dial,surface,scheduled,updates,run(){const [id,timer]=scheduled.entries().next().value;scheduled.delete(id);timer.callback();return timer.delay;}};
}
test('phase endings stay inside their existing ring, reveal the actual next phase, and never alter business state',()=>{
 for(const kind of ['session','resume','cycle','complete']){
  const f=boundaryFixture(),event={from:kind==='resume'?'short':'focus',task:f.state.tasks[0]},saved=JSON.stringify(f.state);f.context.announceCompletion(kind,'Actual boundary','Actual next phase',event);const feedback=f.context.feedback;assert.equal(feedback.className,'nd-boundary');assert.equal(feedback.parent,f.dial);assert.equal(f.surface.children.length,0,'the module is never covered by an opaque notification');assert.equal(f.context.boundary.stage,'message');assert.equal(f.surface.dataset.boundary,kind);assert.equal(feedback.attributes.role,'status');
  if(kind==='cycle'){const segments=feedback.children.find(node=>node.classList.value==='nd-boundary-segments');assert.equal(segments.children.length,4);assert.deepEqual(segments.children.map(circle=>circle.attributes.transform),['rotate(-84 50 50)','rotate(6 50 50)','rotate(96 50 50)','rotate(186 50 50)']);}
  if(kind==='cycle'||kind==='complete')assert.equal(feedback.children.find(node=>node.classList.value==='nd-boundary-check').children[0].attributes.pathLength,'1','the final check is drawn rather than appearing as a badge');
  assert.equal(f.run(),kind==='cycle'||kind==='complete'?3200:1800);assert.equal(f.context.boundary.stage,'next');assert.equal(f.context.feedback,null);assert.equal(f.run(),1200);assert.equal(f.context.boundary,null);assert.equal(f.surface.dataset.boundary,undefined);assert.equal(JSON.stringify(f.state),saved);assert.equal(f.scheduled.size,0);
 }
});
test('task feedback remains a compact status and replacing an ending cancels every stale visual stage',()=>{
 const f=boundaryFixture({motion:false});f.context.announceCompletion('session','Session terminée','Pause de 5 min',{from:'focus',task:f.state.tasks[0]});const old=f.context.feedback;assert.equal(old.children.find(child=>child.className==='nd-completion-particles').children.length,0,'reduced motion creates no particles');f.context.announceCompletion('task','Tâche terminée');assert.equal(old.parent,null);assert.equal(f.scheduled.size,1);assert.equal(f.context.feedback.className,'nd-completion');assert.equal(f.context.feedback.parent,f.surface);assert.equal(f.context.feedback.children[0].className,'nd-completion-chip');assert.equal(f.run(),1800);assert.equal(f.context.boundary,null);assert.equal(f.scheduled.size,0);
});


test('completing an active canonical task preserves its actual row for the check, strike and reorder sequence',()=>{
 const subscription=source.match(/    const unsubscribe=store\.subscribe\([^\n]+/)[0];let handler,draws=0,rows=0,timer=0;const state={tasks:[{id:'finished',done:true},{id:'next',done:false}]},context=uiContext({disposed:false,view:'timer',renderedPlan:'finished:25',surface:{dataset:{canonicalView:'true',modulePresentation:'full',empty:'false'}},store:{subscribe(callback){handler=callback;}},notifyPhase(){},planSignature:()=> 'next:50',draw(){draws++;},updateRows(value){assert.equal(value,state);rows++;},updateTimer(value){assert.equal(value,state);timer++;},recovery(){},$:()=>null});vm.runInContext(subscription,context);handler(state);assert.equal(draws,0,'no redraw may destroy the completing row');assert.equal(rows,1);assert.equal(timer,1);
});
