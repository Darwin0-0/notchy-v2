'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {ISLAND_CONFIG,nookGridPlan,getModuleDefinitions,scenarioModulePlan,createScenarioController,modulePlacementPlan} = require('../notch.js');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../notch.js'),'utf8');

function productionSection(begin,end) {
  const start = source.indexOf(begin), stop = source.indexOf(end,start);
  assert(start > 0 && stop > start,'fixture locates the production function boundaries');
  return source.slice(start,stop);
}

const installed = Object.freeze(['music', 'focus', 'weather', 'shelf']);
const tile = (id,column,row,columns,rows) => ({id,column,row,columns,rows});
const reference = {
  music: [tile('music',1,1,4,4)],
  focus: [tile('focus',1,1,2,4),tile('tasks',3,1,2,4)],
  tasks: [tile('pomodoro',1,1,4,1),tile('tasks',1,2,2,3),tile('shelf',3,2,2,3)],
  essential: [tile('weather',1,1,2,2),tile('localsend',3,1,2,2),tile('shelf',1,3,2,2),tile('scenarios',3,3,2,2)],
};

function occupiedCells(plan) {
  const cells = new Set();
  for (const item of plan) {
    assert(Object.values(item).every(value => typeof value === 'string' || Number.isInteger(value)));
    assert(item.column >= 1 && item.row >= 1 && item.columns >= 1 && item.rows >= 1);
    assert(item.column + item.columns <= 5 && item.row + item.rows <= 5,'a tile stays inside the four by four grid');
    for (let row=item.row; row<item.row+item.rows; row++) for (let column=item.column; column<item.column+item.columns; column++) {
      const cell = column + '/' + row;
      assert(!cells.has(cell),'tile ' + item.id + ' cannot overlap another tile at ' + cell);
      cells.add(cell);
    }
  }
  return cells;
}

for (const [page,expected] of Object.entries(reference)) test('Nook ' + page + ' uses the supplied Grille composition without gaps or overlap', () => {
  const plan = nookGridPlan(page,installed);
  assert.deepEqual(plan,expected);
  assert.equal(occupiedCells(plan).size,16);
});

test('Pomodoro and Tasks require the existing Focus module instead of separate installations', () => {
  assert.deepEqual(nookGridPlan('focus',['tasks','pomodoro']),[]);
  assert.deepEqual(nookGridPlan('focus',['focus']),reference.focus);
  assert.deepEqual(nookGridPlan('tasks',['focus']),reference.tasks.slice(0,2));
  assert.deepEqual(nookGridPlan('tasks',['shelf']),reference.tasks.slice(2));
  assert.deepEqual(nookGridPlan('music',['focus']),[],'missing module fallback belongs to Nook navigation');
});

test('disabled modules leave utilities reachable without installing retired modules or moving the remaining cells', () => {
  const utilities = reference.essential.filter(item => ['localsend','scenarios'].includes(item.id));
  assert.deepEqual(nookGridPlan('essential',[]),utilities);
  assert.deepEqual(nookGridPlan('essential',['files','calendar','clipboard','calls']),utilities);
  assert.deepEqual(nookGridPlan('essential',['weather']),reference.essential.filter(item => item.id !== 'shelf'));
  assert.deepEqual(nookGridPlan('tasks',[]),[]);
  for (const page of Object.keys(reference)) occupiedCells(nookGridPlan(page,['focus','weather']));
});

test('unknown pages fall back safely and malformed module lists do not enable controls', () => {
  for (const page of [undefined,null,'unknown','__proto__','constructor','toString']) assert.deepEqual(nookGridPlan(page,installed),reference.music);
  for (const enabled of [undefined,null,false,42,'focus',{}]) {
    assert.deepEqual(nookGridPlan('focus',enabled),[]);
    assert.deepEqual(nookGridPlan('essential',enabled),reference.essential.filter(item => ['localsend','scenarios'].includes(item.id)));
  }
});

test('duplicate module entries and caller edits cannot mutate the configured modules or later plans', () => {
  const enabled = ['music','focus','shelf','weather','focus','music'];
  const before = structuredClone(enabled), first = nookGridPlan('tasks',enabled);
  assert.deepEqual(first,reference.tasks);
  first[0].rows=100; first.push(tile('fake',1,1,4,4));
  assert.deepEqual(enabled,before);
  assert.deepEqual(nookGridPlan('tasks',enabled),reference.tasks);
});

test('Nook uses configured placements while Tasks opens its full card and Essentials keeps its grid', () => {
  const source=require('node:fs').readFileSync(require.resolve('../notch.js'),'utf8');
  const begin=source.indexOf('  function getHomeSlots() {'), end=source.indexOf('  function getModuleOrder()',begin);
  assert(begin>0 && end>begin);
  const moduleSettings={enabled:[...installed],slots:['music','focus','weather',null]};
  const scope={nookGridPlan,scenarioModulePlan,modulePlacementPlan,moduleSettings,view:'nook',islandPage:'music',getModuleEditorActive:()=>false,
    isModuleEnabled:id=>moduleSettings.enabled.includes(id),moduleDefinitions:Object.fromEntries(getModuleDefinitions().map(item=>[item.id,item])),scenarioController:null};
  require('node:vm').runInNewContext(`${source.slice(begin,end)}this.read=getHomeSlots;`,scope);
  const read=()=>{const before=JSON.stringify(moduleSettings),result=Array.from(scope.read());assert.equal(JSON.stringify(moduleSettings),before,'navigation preserves installed modules and saved placements');return result;};
  scope.islandPage='focus'; assert.deepEqual(read(),['music','focus','weather']);
  scope.islandPage='tasks'; assert.deepEqual(read(),['tasks',null,null]);
  scope.islandPage='essential'; assert.deepEqual(read(),['weather','shelf',null]);
  moduleSettings.enabled=['focus','weather','shelf']; scope.islandPage='music';
  assert.deepEqual(read(),[null,'focus','weather']); assert.equal(scope.islandPage,'music');
  moduleSettings.enabled=['weather','shelf']; scope.islandPage='music';
  assert.deepEqual(read(),[null,null,'weather']); assert.equal(scope.islandPage,'music');
  moduleSettings.enabled=[]; scope.islandPage='music';
  assert.deepEqual(read(),[null,null,null]); assert.equal(scope.islandPage,'music','the explicit utility pages stay reachable without replacing placements');
});

test('four core destinations stay accessible while Nook uses the shared split Focus instance', () => {
  const source=require('node:fs').readFileSync(require.resolve('../notch.js'),'utf8');
  const begin=source.indexOf('  function renderIslandNavigation() {'), end=source.indexOf('  function islandNavigation(',begin);
  assert(begin>0 && end>begin);
  const buttons=Object.keys(reference).map(id=>({dataset:{islandPage:id},attributes:{},style:{setProperty(){}},setAttribute(name,value){this.attributes[name]=value;}}));
  const presentations=[]; let enabled=[...installed];
  const scope={ISLAND_CONFIG,view:'nook',islandPage:'focus',state:'open',closingTo:null,notch:{dataset:{}},islandCoreView:()=>true,getModuleEditorActive:()=>false,
    isModuleEnabled:id=>enabled.includes(id),islandFooter:{querySelectorAll:()=>buttons},focusComponent:{setPage:page=>presentations.push(page)}};
  require('node:vm').runInNewContext(`${source.slice(begin,end)}this.render=renderIslandNavigation;`,scope);
  for (const page of Object.keys(reference)) {
    scope.islandPage=page; scope.render();
    assert.equal(scope.islandFooter.hidden,false); assert.equal(scope.islandFooter.inert,false);
    assert.deepEqual(buttons.filter(button=>button.attributes['aria-pressed']==='true').map(button=>button.dataset.islandPage),[page]);
    assert.equal(presentations.at(-1),'split','Nook does not hide one side of the shared Focus component');
  }
  enabled=['music']; scope.render();
  assert.deepEqual(buttons.filter(button=>button.disabled).map(button=>button.dataset.islandPage),['focus','tasks']);
  assert.equal(buttons.find(button=>button.dataset.islandPage==='essential').disabled,false);
  scope.closingTo='rest'; scope.render(); assert.equal(scope.islandFooter.inert,true,'the outgoing navigation cannot accept clicks');
  scope.closingTo=null; scope.view='tasks'; scope.render(); assert.equal(presentations.at(-1),'tasks','the direct task route keeps its own presentation');
});

function scenarioFixture({page='music',value,enabled=[...installed],state='rest'}={}) {
  let clock=0, serial=0, activity={focusActive:false,focusRunning:false,focusPhase:'work',focusSession:1,musicPlaying:false,transferActive:false};
  const timers=new Map(), changes=[], renders=[], saves=[];
  const scope={islandPage:page,scenarioReturnPage:null,state,view:'nook',isModuleEnabled:id=>enabled.includes(id),
    renderScenarios(){},renderHomeLayout(){renders.push(scope.islandPage);},renderMusic(){},renderFocus(){},renderShelf(){},renderWeather(){},weatherLifecycle(){},update(){},
    setState(){assert.fail('a scenario change must not open or close the island');}};
  vm.runInNewContext(productionSection('  function scenarioNookPage(','  function scenarioInput('),scope);
  const controller=createScenarioController({value,now:()=>clock,activity:()=>activity,enabled:()=>enabled,interacting:()=>false,
    schedule(callback,delay){timers.set(++serial,{callback,at:clock+delay});return serial;},unschedule:id=>timers.delete(id),save:value=>saves.push(value),
    changed(change){changes.push(change);scope.scenarioChanged(change);}});
  return {scope,controller,changes,renders,saves,timers,
    activity(value){activity={...activity,...value};controller.observe();},
    advance(milliseconds){clock+=milliseconds;},
  };
}

test('manual scenarios choose a Nook template without waking a closed island or changing enabled modules', () => {
  const cases=[['focus','focus'],['ambience','music'],['day','essential'],['complete','essential'],['minimal','music']];
  for(const [scenario,page] of cases) {
    const enabled=[...installed], before=JSON.stringify(enabled), f=scenarioFixture({page:'tasks',enabled});
    assert.equal(f.controller.pick(scenario),true);
    assert.equal(f.scope.islandPage,page); assert.equal(f.renders.at(-1),page);
    assert.equal(f.scope.state,'rest'); assert.equal(JSON.stringify(enabled),before);
    f.controller.dispose();
  }
  for(const [enabled,page] of [[['focus','weather'],'focus'],[['weather','shelf'],'essential']]) {
    const f=scenarioFixture({enabled}); assert.equal(f.controller.pick('minimal'),true); assert.equal(f.scope.islandPage,page); f.controller.dispose();
  }
});

test('automatic Focus and Undo restore the actual prior Nook page even when the prior scenario was null', () => {
  const f=scenarioFixture({page:'tasks'});
  f.activity({focusActive:true,focusRunning:true});
  assert.equal(f.controller.getPreferences().selected,'focus'); assert.equal(f.scope.islandPage,'focus');
  assert.equal(f.scope.scenarioReturnPage,'tasks'); assert.equal(f.scope.state,'rest');
  f.advance(4999); assert.equal(f.controller.undo(),true);
  assert.equal(f.controller.getPreferences().selected,null); assert.equal(f.scope.islandPage,'tasks');
  assert.equal(f.scope.scenarioReturnPage,null); assert.equal(f.renders.at(-1),'tasks'); assert.equal(f.scope.state,'rest');
  f.controller.dispose();
});

test('a manual scenario supersedes an automatic return page and preference-only updates preserve the current template', () => {
  const f=scenarioFixture({page:'tasks'});
  f.activity({focusActive:true,focusRunning:true}); assert.equal(f.scope.scenarioReturnPage,'tasks');
  assert.equal(f.controller.pick('day'),true); assert.equal(f.scope.islandPage,'essential');
  assert.equal(f.scope.scenarioReturnPage,null); assert.equal(f.controller.undo(),false);
  const preferences=f.controller.getPreferences(), renderCount=f.renders.length;
  preferences.mode='manual'; f.controller.configure(preferences);
  assert.equal(f.scope.islandPage,'essential'); assert.equal(f.renders.length,renderCount,'changing mode alone does not replace the displayed template');
  assert.equal(f.scope.state,'rest'); f.controller.dispose();
});

test('a persisted scenario is mapped before the first Nook render without opening or rewriting preferences', () => {
  for(const [selected,page] of [['focus','focus'],['ambience','music'],['day','essential'],['complete','essential'],['minimal','music'],[null,'music']]) {
    const renders=[],saves=[],timers=new Map();let serial=0;
    const scope={createScenarioController,scenarioPreferences:{mode:'manual',selected},scenarioController:null,islandPage:'music',state:'rest',
      scenarioStorageKey:'test-scenario-preferences',scenarioActivity:()=>({}),configuredModuleOrder:()=>[...installed],scenarioInteracting:()=>false,
      isModuleEnabled:id=>installed.includes(id),scenarioChanged(){assert.fail('restoration does not apply a new scenario');},
      window:{setTimeout(callback,delay){timers.set(++serial,{callback,delay});return serial;},clearTimeout:id=>timers.delete(id),localStorage:{setItem:(key,value)=>saves.push([key,value])}},
      renderScenarios(){},renderAppearance(){},renderHomeLayout(){renders.push(scope.islandPage);},renderModules(){},renderFocus(){},renderFiles(){},renderWeather(){}};
    vm.runInNewContext(productionSection('  function scenarioNookPage(','  function scenarioChanged(')+
      productionSection('  scenarioController = createScenarioController({value: scenarioPreferences,',"  setState('rest');"),scope);
    assert.deepEqual(renders,[page]); assert.equal(scope.state,'rest'); assert.equal(scope.scenarioController.getPreferences().selected,selected);
    assert.deepEqual(saves,[]); assert.equal(timers.size,0); scope.scenarioController.dispose();
  }
});

test('the LocalSend tile opens pending consent or the real file picker route instead of an empty send', () => {
  const calls=[],button={dataset:{moduleOpen:'localsend'}};
  const incoming={id:'incoming-request',alias:'Téléphone',files:[{name:'photo.jpg',size:20}]};
  const scope={disposed:false,nearby:{incoming},moduleDefinitions:Object.fromEntries(getModuleDefinitions().map(item=>[item.id,item])),
    openLocalSend:(direction,request)=>calls.push({kind:'transfer',direction,request}),selectViewButton:button=>calls.push({kind:'route',view:button.dataset.view}),
    setState:state=>calls.push({kind:'state',state}),openModuleEditor(){assert.fail('LocalSend must not open the module editor');}};
  vm.runInNewContext(productionSection('  function openBuiltin(','  function modulesChanged('),scope);
  const click=()=>scope.openBuiltin({target:{closest:()=>button}});
  click(); assert.equal(calls.length,1); assert.equal(calls[0].direction,'receive'); assert.equal(calls[0].request,incoming);
  calls.length=0;scope.nearby.incoming=null;click();
  assert.deepEqual(calls,[{kind:'route',view:'tray'},{kind:'state',state:'open'}]);
  calls.length=0;scope.disposed=true;click();assert.deepEqual(calls,[]);
});

function headerNavigationFixture({view='nook',page='tasks'}={}) {
  const moduleSettings={enabled:[...installed,'tasks'],slots:['music','focus','weather',null]},renders=[];
  const button={dataset:{view:'nook'}},scope={calendar:null,view,state:'open',islandPage:page,disposed:false,moduleSettings,
    shelfLoaded:true,shelfBusy:false,fileDragging:false,moduleDefinitions:Object.fromEntries(getModuleDefinitions().map(item=>[item.id,item])),
    welcome:null,t:value=>value,toggle:{},menu:{hidden:false,contains:element=>element===button},panel:{setAttribute(){}},byId:()=>({}),
    getModuleEditorActive:()=>false,builtinVisible:()=>false,isModuleEnabled:id=>moduleSettings.enabled.includes(id),scenarioController:null,
    modulePlacementPlan,scenarioModulePlan,nookGridPlan,
    renderIslandNavigation(){},renderMenuSelection(){},renderHomeLayout(){renders.push(Array.from(scope.getHomeSlots()));},
    musicLifecycle(){},renderFocus(){},renderShelf(){},renderFiles(){},filesLifecycle(){},renderWeather(){},weatherLifecycle(){},
    renderExperience(){},renderSettings(){},renderScenarios(){},renderModules(){},nearbyLifecycle(){},renderModuleFeedback(){},renderLocalSend(){},update(){},
    setState(){assert.fail('header navigation must not resize or close the panel');},motionEnabled:()=>false,
    activityScene:{promote(){assert.fail('the Tasks destination must not promote another module');}}};
  vm.runInNewContext(productionSection('  function getHomeSlots() {','  function getModuleOrder()')+
    productionSection('  function islandNavigation(','  let homeLayout =')+
    productionSection('  function selectView(','  function renderMenuSelection('),scope);
  return {scope,moduleSettings,renders,clickNook:()=>scope.selectView({target:{closest:()=>button}})};
}

test('clicking the Nook header returns from either full Tasks route to the saved home even when Nook is already selected', () => {
  for (const view of ['nook','tasks']) {
    const f=headerNavigationFixture({view}),before=JSON.stringify(f.moduleSettings);
    assert.deepEqual(Array.from(f.scope.getHomeSlots()),view==='nook'?['tasks',null,null]:['music','focus','weather']);
    f.clickNook();
    assert.equal(f.scope.view,'nook');
    assert.equal(f.scope.islandPage,'music','an explicit Nook click leaves the full Tasks destination');
    assert.deepEqual(f.renders.at(-1),['music','focus','weather'],'the saved home scene is rendered');
    assert.equal(JSON.stringify(f.moduleSettings),before,'navigation does not rewrite enabled modules or saved placements');
    assert.equal(f.scope.state,'open');
  }
});

test('the Tasks navigation destination and internal Nook returns retain their explicit page', () => {
  const f=headerNavigationFixture({page:'music'});
  f.scope.islandNavigation({target:{closest:()=>({dataset:{islandPage:'tasks'},disabled:false})}});
  assert.equal(f.scope.view,'nook');assert.equal(f.scope.islandPage,'tasks');
  assert.deepEqual(f.renders.at(-1),['tasks',null,null]);
  f.scope.view='settings';f.scope.selectViewButton({dataset:{view:'nook'}});
  assert.equal(f.scope.islandPage,'tasks','an internal return restores its prior Tasks page');
  f.scope.islandPage='essential';f.scope.view='tray';f.scope.selectViewButton({dataset:{view:'nook'}});
  assert.equal(f.scope.islandPage,'essential','an internal return also preserves the utilities page');
  f.clickNook();assert.equal(f.scope.islandPage,'music');
  assert.deepEqual(f.renders.at(-1),['music','focus','weather']);
});

test('returning to a visible Shelf summary reloads an invalidated file cache once instead of showing stale files', () => {
  const loads=[],scope={calendar:null,view:'files',state:'open',islandPage:'essential',disposed:false,shelfLoaded:false,shelfBusy:false,fileDragging:false,
    moduleDefinitions:Object.fromEntries(getModuleDefinitions().map(item=>[item.id,item])),welcome:null,t:value=>value,
    toggle:{},menu:{},panel:{setAttribute(){}},byId:()=>({}),getModuleEditorActive:()=>false,builtinVisible:()=>false,
    getHomeSlots:()=>['weather','shelf',null,null],scenarioController:null,
    renderIslandNavigation(){},renderMenuSelection(){},renderHomeLayout(){},musicLifecycle(){},renderFocus(){},renderShelf(){},renderFiles(){},filesLifecycle(){},
    renderWeather(){},weatherLifecycle(){},renderExperience(){},renderSettings(){},renderScenarios(){},renderModules(){},nearbyLifecycle(){},renderModuleFeedback(){},renderLocalSend(){},update(){},
    loadShelf(){loads.push('shelf');scope.shelfLoaded=true;}};
  vm.runInNewContext(productionSection('  function selectViewButton(','  function renderMenuSelection('),scope);
  scope.selectViewButton({dataset:{view:'nook'}});
  assert.deepEqual(loads,['shelf']);assert.equal(scope.view,'nook');assert.equal(scope.state,'open');
  scope.selectViewButton({dataset:{view:'nook'}});assert.deepEqual(loads,['shelf'],'a valid cache is reused');
  scope.shelfLoaded=false;scope.getHomeSlots=()=>['music',null,null,null];
  scope.selectViewButton({dataset:{view:'nook'}});assert.deepEqual(loads,['shelf'],'a hidden summary does not fetch files');
});
