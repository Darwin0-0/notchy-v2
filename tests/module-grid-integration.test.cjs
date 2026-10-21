'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Shell=require('../notch.js'),Layout=require('../module-contracts.js'),Modules=require('../module-runtime.js');
const Experience=require('../experience.js'),{fixture:gridDom}=require('./helpers/experience-dom.cjs');
const source=fs.readFileSync(require.resolve('../notch.js'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
function excerpt(name,next){const begin=source.indexOf('  function '+name+'('),end=source.indexOf('  function '+next+'(',begin);assert(begin>=0&&end>begin,'real shell function '+name+' is available');return source.slice(begin,end);}
function fixture(profile){
  const definitions=Object.fromEntries(Shell.getModuleDefinitions().map(item=>[item.id,item])),community=new Map();
  for(let index=0;index<6;index++){
    const manifest=clone(Modules.catalog[1]);manifest.id='community.grid-'+index;manifest.name={en:'Grid '+index,fr:'Grille '+index};
    const entry={manifest:Modules.validateManifest(manifest),state:{glasses:index,goal:8}};community.set(manifest.id,entry);
    definitions[manifest.id]={id:manifest.id,community:true,defaultInstalled:false,initialSlot:null,contract:Modules.getLayoutContract(entry.manifest)};
  }
  const memory=new Map(),writes=[],changes=[];
  const scope={moduleDefinitions:definitions,ModuleLayout:Layout,moduleSettings:clone(profile||{enabled:['music','focus','weather'],slots:['music','focus','weather',null]}),moduleLab:null,focus:{sessionSummary:null,task:'Real current task',deadline:null,tasks:[{id:'actual',title:'Real current task',done:false}]},focusSettings:{},islandPage:'music',disposed:false,moduleEditing:false,moduleDraft:null,moduleMessage:'',view:'nook',moduleStorageKey:'notchy-modules-v1',
    scenarioController:{getPreferences:()=>({selected:null}),configure(){}},window:{localStorage:{getItem:key=>memory.get(key)||null,setItem(key,value){writes.push({key,value});memory.set(key,value);}}},
    getCollapsedActivities:()=>[],isModuleEnabled:id=>scope.moduleSettings.enabled.includes(id),focusCoreEnabled:()=>scope.moduleSettings.enabled.includes('focus'),getHomeSlots:()=>scope.moduleSettings.grid?.map(item=>item.id)||scope.moduleSettings.slots,
    communityStore:{get:id=>community.get(id)},i18n:{locale:()=> 'en'},nearby:{transfer:null},fileJob:{status:'idle'},music:{title:'Actual song',artist:'Actual artist',source:'Player',playing:false,duration:120},connectionLost:false,shelfItems:[],
    t:value=>value,time:value=>String(value),position:()=>42,focusCardValues:()=>({seconds:1500,progress:.25}),focusLabel:()=> 'Tasks & Focus',localSendCount:value=>String(value),getWeatherSummary:()=>({narrative:{temperature:'26°',city:'Kinshasa'}}),
    slotViewport:()=>({width:812,height:368}),layoutContract:id=>definitions[id]?.contract,renderModules(){},modulesChanged:previous=>changes.push(clone(previous))};
  vm.runInNewContext(excerpt('normalizeModules','moduleEditorPresentation')+excerpt('createActivityScene','closedBandSize')+excerpt('getModules','isModuleEnabled')+excerpt('setModules','revealModuleSelection')+excerpt('sceneActivities','ensureActivityStage')+excerpt('planHomeSlots','modulePlacementCandidate')+'this.api={normalizeModules,assignModuleSlot,modulePlacementPlan,createActivityScene,getModules,setModules,sceneActivities,planHomeSlots};',scope);
  scope.activityScene=scope.api.createActivityScene({now:()=>1000});
  return {scope,api:scope.api,definitions,community,memory,writes,changes};
}
function nineProfile(){const ids=['music','focus','weather',...Array.from({length:6},(_,index)=>'community.grid-'+index)];return {enabled:ids,slots:['music','focus','weather',null],grid:ids.map((id,index)=>({id,presentation:'small',column:index%3,row:Math.floor(index/3)}))};}

test('grid drags remain active when bubbling through the legacy editor and keep scaled placement validation',()=>{
  for(const scale of [.5,.7,1]){
    const dom=gridDom(),changes=[],initial=[{id:'music',presentation:'small',column:0,row:0},{id:'weather',presentation:'small',column:1,row:0}];
    const component=Experience.create({...dom,layout:Layout,onModulesChange:value=>changes.push(structuredClone(value))});
    component.renderModules({enabled:['music','weather'],grid:initial});
    const card=id=>dom.modulesHost.querySelectorAll('.experience-grid-module').find(node=>node.dataset.experienceModule===id),stage=dom.modulesHost.querySelector('.experience-module-grid');
    stage.rect={left:20,top:40,width:Layout.grid.width*scale,height:Layout.grid.height*scale};
    let legacyRenders=0;
    const scope={disposed:false,moduleEditing:true,moduleDraft:{grid:initial},moduleLabels:{music:'Music',weather:'Weather'},moduleMime:'application/x-notchy-module',moduleEditorLayout(){legacyRenders++;},modulePicked:null};
    vm.runInNewContext(excerpt('moduleDragStart','moduleEditorKey')+'this.drag={dragstart:moduleDragStart,dragover:moduleDragOver,drop:moduleDrop};',scope);
    const data=new Map(),transfer={setData(type,value){data.set(type,value);},getData:type=>data.get(type),get types(){return [...data.keys()];}};
    const bubble=(type,target,point={})=>{const event=dom.event(dom.modulesHost,type,target,{dataTransfer:transfer,...point});if(!event.stopped)scope.drag[type]?.(event);return event;};
    const point=(column,row)=>({clientX:20+(column*(Layout.grid.cellWidth+Layout.grid.gap)+30)*scale,clientY:40+(row*(Layout.grid.cellHeight+Layout.grid.gap)+30)*scale});
    const original=card('music'),start=bubble('dragstart',original);
    assert.notEqual(start.prevented,true,'the legacy handler must not cancel a real grid drag');
    assert.equal(legacyRenders,0);assert.equal(scope.modulePicked,null);assert.equal(card('music'),original);assert.equal(transfer.effectAllowed,'move');
    bubble('drop',stage,point(1,0));assert.deepEqual(changes[0].grid,[{...initial[0],column:1},{...initial[1],column:0}],'an occupied target repacks the same module rectangles');
    bubble('dragstart',card('music'));bubble('drop',stage,{clientX:19,clientY:39});bubble('dragend',card('music'));assert.equal(changes.length,1,'outside the grid does not commit');
    bubble('dragstart',card('music'));const over=bubble('dragover',stage,point(0,1));assert.equal(over.prevented,true);assert.equal(transfer.dropEffect,'move');
    bubble('drop',stage,point(0,1));assert.deepEqual(changes[1].grid,[{...initial[0],row:1},{...initial[1],column:0}]);assert.equal(dom.document.activeElement,card('music'));
    dom.event(dom.modulesHost,'keydown',card('music'),{key:'ArrowLeft'});assert.equal(changes.length,2,'keyboard movement retains its boundary validation');
    dom.event(dom.modulesHost,'keydown',card('music'),{key:'ArrowDown'});assert.deepEqual(changes[2].grid,[{...initial[0],row:2},{...initial[1],column:0}]);
    const resize=card('music').querySelector('.experience-grid-resize'),resizeDrag=bubble('dragstart',resize);assert.equal(resizeDrag.prevented,true,'the resize handle remains reserved for resizing');
    assert.deepEqual(initial,[{id:'music',presentation:'small',column:0,row:0},{id:'weather',presentation:'small',column:1,row:0}]);
    component.dispose();
  }
});

for(const commit of [false,true])test(`full-grid movement preserves the real task/file state and saved profile until ${commit?'Done commits':'Escape cancels'} the production draft`,()=>{
  const profile={enabled:['music','focus','weather'],slots:['music','focus','weather',null],grid:[{id:'music',presentation:'main',column:0,row:0},{id:'focus',presentation:'tall',column:2,row:0},{id:'weather',presentation:'small',column:2,row:2}]},f=fixture(profile),dom=gridDom();
  f.scope.shelfItems=[{id:'owned-file',name:'Existing file.pdf'}];const tasks=clone(f.scope.focus),files=clone(f.scope.shelfItems),fallback=dom.document.createElement('button');dom.document.body.append(fallback);
  Object.assign(f.scope,{moduleEditing:true,moduleDraft:clone(profile),moduleDraftOrder:['music','focus','weather','shelf'],moduleOrderSaved:false,moduleOrder:['music','focus','weather','shelf'],modulePicked:null,moduleEditorMount:null,moduleReturnFocus:null,modulePreviousView:'nook',modulePreviousState:'open',state:'open',document:dom.document,modulesPlayer:dom.modulesHost,menu:{querySelector:()=>fallback},moduleEditorLayout(){}});
  vm.runInNewContext(excerpt('closeModuleEditor','moduleContextMenu')+'this.closeEditor=closeModuleEditor;',f.scope);
  const component=Experience.create({...dom,modulesToolbarHost:dom.toolbar,layout:Layout,onModulesChange(value){f.scope.moduleDraft=f.api.normalizeModules({enabled:value.order.filter(id=>value.enabled.includes(id)),slots:value.order.filter(id=>value.enabled.includes(id)).slice(0,3),grid:value.grid});},onAction:action=>f.scope.closeEditor(action==='done')});
  component.renderModules({enabled:profile.enabled,grid:profile.grid});const card=()=>dom.modulesHost.querySelectorAll('.experience-grid-module').find(node=>node.dataset.experienceModule==='music');
  dom.event(dom.modulesHost,'keydown',card(),{key:'ArrowRight'});const expected=[{...profile.grid[0],column:1},{...profile.grid[1],column:0},{...profile.grid[2],column:0}];
  assert.deepEqual(clone(f.scope.moduleDraft.grid),expected);assert.deepEqual(clone(f.api.getModules()),profile);assert.deepEqual(f.writes,[]);assert.deepEqual(f.scope.focus,tasks);assert.deepEqual(f.scope.shelfItems,files);
  if(commit)dom.click(dom.toolbar,dom.toolbar.querySelector('button'));else dom.event(dom.modulesHost,'keydown',card(),{key:'Escape'});
  assert.equal(f.scope.moduleEditing,false);assert.deepEqual(clone(f.api.getModules()),commit?{...profile,grid:expected}:profile);
  const saved=f.writes.filter(item=>item.key==='notchy-modules-v1');assert.equal(saved.length,commit?1:0);if(commit)assert.deepEqual(JSON.parse(saved[0].value).grid,expected);
  assert.deepEqual(f.scope.focus,tasks);assert.deepEqual(f.scope.shelfItems,files);assert.deepEqual(profile.grid,[{id:'music',presentation:'main',column:0,row:0},{id:'focus',presentation:'tall',column:2,row:0},{id:'weather',presentation:'small',column:2,row:2}]);component.dispose();
});

test('a saved nine-cell profile round-trips through normalization without changing module state or old reserved slots',()=>{
  const profile=nineProfile(),before=clone(profile),f=fixture(profile),states=clone([...f.community.values()].map(entry=>entry.state));
  const normalized=clone(f.api.normalizeModules(profile));assert.deepEqual(normalized,before);assert.deepEqual(profile,before);
  const restored=clone(f.api.normalizeModules(JSON.parse(JSON.stringify(normalized))));assert.deepEqual(restored,normalized);
  const plan=clone(f.api.modulePlacementPlan(restored));assert.equal(plan.count,9);assert.deepEqual(plan.slots,profile.grid.map(item=>item.id));assert.deepEqual(plan.indices,[0,1,2,3,4,5,6,7,8]);
  assert.deepEqual(plan.items.map(({id,presentation,column,row})=>({id,presentation,column,row})),profile.grid);
  assert.deepEqual([...f.community.values()].map(entry=>entry.state),states);assert.deepEqual(f.scope.focus.tasks,[{id:'actual',title:'Real current task',done:false}]);
});

test('the live profile getter copies cell placements so editing a draft cannot rewrite the committed grid',()=>{
  const profile=nineProfile(),f=fixture(profile),returned=f.api.getModules();assert.deepEqual(clone(returned),profile);
  returned.enabled.pop();returned.slots[0]='weather';returned.grid[0].column=2;returned.grid.splice(1,1);
  assert.deepEqual(f.scope.moduleSettings,profile);assert.deepEqual(clone(f.api.getModules()),profile);
});

test('the existing save path persists the full grid and restores the same nine modules after reload',()=>{
  const profile=nineProfile(),f=fixture(),before=clone(profile),states=clone([...f.community.values()].map(entry=>entry.state));
  assert.equal(f.api.setModules(profile),true);assert.equal(f.writes.length,1);assert.equal(f.writes[0].key,'notchy-modules-v1');
  const persisted=JSON.parse(f.writes[0].value);assert.deepEqual(persisted,before);assert.deepEqual(clone(f.api.getModules()),before);
  const restored=fixture(persisted);assert.equal(restored.api.modulePlacementPlan(restored.api.getModules()).count,9);assert.deepEqual(clone(restored.api.getModules()),before);
  assert.deepEqual(profile,before);assert.deepEqual([...f.community.values()].map(entry=>entry.state),states);assert.equal(f.changes.length,1);
});

test('invalid grid proposals retain the old slots, enabled modules and caller-owned cell data',()=>{
  const profile=nineProfile(),f=fixture(profile),base={enabled:profile.enabled,slots:profile.slots};
  const invalid=[
    profile.grid.map((item,index)=>index===1?{...item,column:0,row:0}:item),
    profile.grid.map((item,index)=>index===1?{...item,id:profile.grid[0].id}:item),
    profile.grid.map((item,index)=>index===0?{...item,presentation:'full',column:1}:item),
    profile.grid.map((item,index)=>index===0?{...item,column:-1}:item),
    profile.grid.map((item,index)=>index===0?{...item,row:3}:item),
    profile.grid.map((item,index)=>index===0?{...item,presentation:'overlay'}:item),
    [...profile.grid,{id:'community.extra',presentation:'small',column:0,row:0}],
  ];
  for(const grid of invalid){
    // The extra module is registered so the nine-cell limit is tested before
    // a normal unknown-module filter can discard it.
    f.definitions['community.extra']={id:'community.extra',contract:Layout.getCommunityContract({id:'community.extra'})};
    const input={...base,enabled:[...base.enabled,'community.extra'],grid},before=clone(input),result=clone(f.api.normalizeModules(input));
    assert.equal(Object.hasOwn(result,'grid'),false);assert.deepEqual(result.slots,base.slots);assert.deepEqual(result.enabled,input.enabled);assert.deepEqual(input,before);
  }
});

test('unsupported formats are rejected as a whole rather than silently dropping a saved module',()=>{
  const f=fixture(),input={enabled:['music','shelf'],slots:['music','shelf',null,null],grid:[{id:'music',presentation:'main',column:0,row:0},{id:'shelf',presentation:'tall',column:2,row:0}]},before=clone(input),result=clone(f.api.normalizeModules(input));
  assert.deepEqual(result,{enabled:input.enabled,slots:input.slots});assert.deepEqual(input,before);
  const scene=f.api.modulePlacementPlan(input);assert.equal(scene.count,2);assert.deepEqual(Array.from(scene.items,item=>item.id),['music','shelf']);
});

test('a saved Shelf Small placement restores through the same live grid without changing file or task state',()=>{
 const profile={enabled:['music','shelf'],slots:['music','shelf',null,null],grid:[{id:'music',presentation:'main',column:0,row:0},{id:'shelf',presentation:'small',column:2,row:2}]},f=fixture(profile),before=clone(profile);f.scope.shelfItems=[{id:'kept-file',name:'Existing document.pdf'}];const tasks=clone(f.scope.focus.tasks),files=clone(f.scope.shelfItems);assert.deepEqual(clone(f.api.normalizeModules(profile)),profile);const plan=f.api.planHomeSlots(f.api.modulePlacementPlan(profile).items);assert.equal(plan.items.find(item=>item.id==='shelf').presentation,'small');assert.equal(plan.items.find(item=>item.id==='shelf').fits,true);assert.deepEqual(f.scope.focus.tasks,tasks);assert.deepEqual(f.scope.shelfItems,files);assert.deepEqual(profile,before);assert.deepEqual(f.writes,[]);
});

test('legacy profiles still preserve holes, the reserve and the Tasks-to-Focus migration without manufacturing a grid',()=>{
  const f=fixture();
  for(const [input,expected]of [
    [{enabled:['tasks','music','shelf'],slots:[null,'tasks','music','shelf']},{enabled:['focus','music','shelf'],slots:[null,'focus','music','shelf']}],
    [{enabled:[],slots:[]},{enabled:[],slots:[null,null,null,null]}],
    [{enabled:['music','weather','retired'],slots:['weather',null,'music','shelf']},{enabled:['music','weather'],slots:['weather',null,'music','shelf']}],
  ]){
    const before=clone(input),result=clone(f.api.normalizeModules(input));assert.deepEqual(result,expected);assert.deepEqual(clone(f.api.normalizeModules(result)),expected);assert.deepEqual(input,before);assert.equal(Object.hasOwn(result,'grid'),false);
  }
  const alias={enabled:['tasks','music'],slots:['tasks','music',null,null],grid:[{id:'tasks',presentation:'main',column:0,row:0},{id:'music',presentation:'side',column:2,row:0}]};
  assert.deepEqual(Array.from(f.api.normalizeModules(alias).grid,item=>item.id),['focus','music']);
});

test('an invalid old-slot operation is a no-op for a committed custom grid',()=>{
  const profile=nineProfile(),before=clone(profile),f=fixture(profile);
  for(const [index,id]of [[4,'music'],[-1,'music'],[.5,'music'],['0','music'],[0,'unknown']])assert.deepEqual(clone(f.api.assignModuleSlot(profile,index,id)),before);
  assert.deepEqual(profile,before);
  const replaced=clone(f.api.assignModuleSlot(profile,1,'music'));assert.equal(Object.hasOwn(replaced,'grid'),false);assert.deepEqual(replaced.slots,['focus','music','weather',null]);assert.deepEqual(profile,before);
});

test('nine configured activities remain visible and LocalSend never replaces a cell in the fixed grid',()=>{
  const profile=nineProfile(),f=fixture(profile),before=clone(profile);
  f.scope.getCollapsedActivities=()=>[{id:'transfer',playing:true,progress:.5}];f.scope.nearby.transfer={id:'test-transfer',status:'sending'};
  const activities=f.api.sceneActivities();assert.equal(activities.length,9);assert.deepEqual(Array.from(activities,item=>item.id),profile.grid.map(item=>item.id));assert(!activities.some(item=>item.id==='transfer'));
  const snapshot=f.scope.activityScene.update(activities,{preserveOrder:true,maxItems:9});assert.equal(snapshot.items.length,9);assert.equal(snapshot.primary,'music');
  const repeated=f.scope.activityScene.update(f.api.sceneActivities(),{preserveOrder:true,maxItems:9});assert.deepEqual(Array.from(repeated.items,item=>item.id),profile.grid.map(item=>item.id));assert.deepEqual(f.scope.moduleSettings,before);
  assert.equal(f.scope.activityScene.update(activities,{preserveOrder:true}).items.length,3,'the normal activity band keeps its independent three-item limit');
});

test('temporary activity promotion keeps each fixed-grid rectangle and contract attached to its own module ID',()=>{
  const profile={enabled:['music','focus','weather'],slots:['music','focus','weather',null],grid:[{id:'music',presentation:'main',column:0,row:0},{id:'focus',presentation:'tall',column:2,row:0},{id:'weather',presentation:'small',column:2,row:2}]},before=clone(profile),f=fixture(profile);
  const original=f.api.planHomeSlots(f.api.sceneActivities()),byId=new Map(original.items.map(item=>[item.id,clone(item)]));
  f.scope.activityScene.update(f.api.sceneActivities(),{preserveOrder:true,maxItems:9});assert.equal(f.scope.activityScene.promote('focus'),true);
  const snapshot=f.scope.activityScene.update(f.api.sceneActivities(),{preserveOrder:true,maxItems:9}),plan=f.api.planHomeSlots(snapshot.items);
  assert.deepEqual(Array.from(plan.items,item=>item.id),Array.from(snapshot.items,item=>item.id),'the shell matches its primary renderer with the assignment for the same ID');
  for(const item of plan.items){const previous=byId.get(item.id);assert.deepEqual([item.x,item.y,item.width,item.height,item.presentation],[previous.x,previous.y,previous.width,previous.height,previous.presentation]);}
  assert.deepEqual(f.scope.moduleSettings,before);assert.deepEqual(profile,before);
});

test('a temporary module Lab format gets the exact grid canvas without rewriting the saved arrangement',()=>{
  const profile=nineProfile(),before=clone(profile),f=fixture(profile);
  for(const presentation of Layout.PRESENTATIONS){f.scope.moduleLab={id:'focus',presentation,ids:['focus']};const plan=f.api.planHomeSlots([{id:'focus'}]),format=Layout.getFormat(presentation);assert.equal(plan.items.length,1);assert.equal(plan.items[0].id,'focus');assert.equal(plan.items[0].presentation,presentation);assert.deepEqual([plan.items[0].width,plan.items[0].height],[format.width,format.height]);assert.deepEqual(f.scope.moduleSettings,before);}
  f.scope.moduleLab=null;assert.equal(f.api.planHomeSlots(f.api.sceneActivities()).items.length,9);
});
