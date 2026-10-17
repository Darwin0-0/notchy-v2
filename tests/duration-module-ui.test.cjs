'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../duration-module.js'),'utf8');
function between(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
function fixture(save=async()=>{}){
 const fields={title:{value:'Read a chapter',focus(){}},h:{value:'1'},m:{value:'30'},save:{disabled:false,focus(){}}};
 const state={tasks:[]},calls={saved:[],draws:0,merged:0,views:[],focus:0};
 const context=vm.createContext({Promise,Number,String,Math,Object,
  draft:{title:'Read a chapter',h:'1',m:'30',split:true},busy:false,disposed:false,viewToken:1,previousView:'tasks',status:{textContent:''},
  $:selector=>selector==='[name=title]'?fields.title:selector==='[name=h]'?fields.h:selector==='[name=m]'?fields.m:selector==='[data-command=save-task]'?fields.save:selector==='[data-command=add]'?{focus(){calls.focus++;}}:null,
  setDurationEditing(value){context.draft.split=value;calls.merged++;},
  draw(){calls.draws++;},changeView(value){calls.views.push(value);},error(value){context.status.textContent=value;},options:{},
  updateRows(){},updateTimer(){},store:{snapshot:()=>state,async add(title,minutes){calls.saved.push([title,minutes]);await save();state.tasks.push({title,minutes});}}
 });
 vm.runInContext(between('    function draftMinutes()','    function setDurationEditing(')+between('    async function act(','    function onClick('),context);
 return {context,fields,state,calls,flush:()=>new Promise(resolve=>setImmediate(resolve))};
}
test('duration confirmation merges the fields and previews without creating a task',()=>{
 const f=fixture();f.context.finishDuration(false);
 assert.equal(f.context.draft.split,false);assert.equal(f.calls.draws,1);assert.deepEqual(f.calls.saved,[]);assert.equal(f.context.draft.h,'1');assert.equal(f.context.draft.m,'30');
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
 assert.equal(footer.children[0].className,'nd-plan-summary');assert.equal(footer.children[0].children[0].tag,'strong');assert.equal(footer.children[0].children[0].textContent,'1h30');assert.match(footer.children[0].children[1].textContent,/3 focus · 3 pauses/);
 assert.equal(footer.children[1].command,'save-task');assert.equal(footer.children[1].textContent,'Ajouter la tâche');assert.equal(footer.hidden,false);
});
test('overall remaining time uses hours and minutes while the phase clock stays separate',()=>{
 const Core=require('../duration-core.js');
 for(const [minutes,expected]of [[90,'1h30 restantes'],[122,'2h02 restantes'],[1,'1 min restante']]){
  const remaining={textContent:''},task={id:'task',title:'Reading',totalMinutes:minutes,elapsedMs:0,done:false,settings:{work:25,rest:5,longRest:15,interval:4}},context=vm.createContext({Number,String,Math,Core,view:'timer',size:'half',ACCENT:'#ff7a45',surface:{style:{setProperty(){}}},
   selected:()=>task,t:value=>value,pad:value=>String(value).padStart(2,'0'),screen:{querySelectorAll:()=>[]},$:selector=>selector==='.nd-remaining-label'?remaining:null});
  vm.runInContext(between('    const totalLabel =','    function node(')+between('    function updateTimer(','    function notifyPhase('),context);context.updateTimer({tasks:[task],activeId:'task',startedAt:null});assert.equal(remaining.textContent,expected);
 }
});

test('leaving a form or detailed timer restores the host destination without changing task state',()=>{
 const method=source.match(/cancelEdit\(\)\{[^\n]+\}/)[0].replace(/^cancelEdit/,'function cancelEdit');
 for(const hostView of ['tasks','timer'])for(const view of ['settings','create-title','create-duration','pomodoro']){
  let draws=0;const context=vm.createContext({view,viewToken:0,options:{view:hostView},draw(){draws++;}});
  vm.runInContext(method,context);context.cancelEdit();assert.equal(context.view,hostView);assert.equal(context.viewToken,1);assert.equal(draws,1);
 }
});
