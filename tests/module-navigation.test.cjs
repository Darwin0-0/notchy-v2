'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../ia.js'), 'utf8');
const moduleDefinitions=Object.fromEntries(require('../notch.js').getModuleDefinitions().map(definition=>[definition.id,definition]));
function compactPolicy(source){const begin=source.indexOf('  function usesCompactSummary('),end=source.indexOf('  function layoutContract(',begin);assert(begin>0&&end>begin);return source.slice(begin,end);}

test('module backgrounds and clocks keep their placement; explicit actions still navigate', () => {
  const routes = [], action = {dataset: {scenePromote: 'shelf'}};
  const scope = {document: {getElementById: () => ({contains: node => node === action})}, onRoute: route => routes.push(route)};
  const begin = source.indexOf('    function openCard('), end = source.indexOf('    const nook=', begin);
  assert(begin > 0 && end > begin);
  vm.runInNewContext(source.slice(begin, end) + ';this.click=openCard;', scope);
  for (const kind of ['background', 'title', 'clock']) {
    scope.click({type: 'click', target: {closest: selector => selector === '[data-activity]' ? {dataset: {activity: 'focus'}} : null},
      preventDefault() {assert.fail(kind + ' must stay in place');}, stopImmediatePropagation() {assert.fail(kind + ' must stay in place');}});
  }
  assert.deepEqual(routes, []);
  let prevented = false, stopped = false;
  scope.click({type: 'click', target: {closest: () => action}, preventDefault() {prevented = true;}, stopImmediatePropagation() {stopped = true;}});
  assert.deepEqual(routes, ['tray']); assert(prevented && stopped);
});

test('the same live Focus component is used in a secondary placement and its size survives lifecycle updates', () => {
  const app = fs.readFileSync(require.resolve('../notch.js'), 'utf8');
  const player = {classList:{add(){}},dataset:{presentation:'rail'},hidden:false};
  const scope = {moduleDefinitions,homeLayout:null,communityCards:new Map(),activityCards:new Map(),focusPlayer:player};
  const start=app.indexOf('  function activitySummaryCard('),end=app.indexOf('  function renderShelfSummaryContents(',start);
  assert(start>0&&end>start);
  vm.runInNewContext(compactPolicy(app)+app.slice(start,end)+'this.card=activitySummaryCard;',scope);
  assert.equal(scope.card('focus'),player); assert.equal(scope.card('focus'),player);
  for(const parent of ['activity-main','activity-rail-cards','notch-panel']) {
    player.dataset.presentation='rail'; player.parentElement={classList:{contains:value=>value===parent}};
    const lifecycle=[], tasksPlayer={hidden:false,dataset:{}}, context={homeLayout:null,disposed:false,focusPlayer:player,tasksPlayer,builtinVisible:id=>id==='tasks'&&context.view==='tasks',focusCoreEnabled:()=>true,document:{hidden:false},state:'open',getModuleEditorActive:()=>false,
      focusComponent:{lifecycle:value=>lifecycle.push(value)},view:'nook',tasksComponent:{render(){}},renderFocusRouteBack(){},renderFocusTaskPrompt(){}};
    const begin=app.indexOf('  function renderFocus() {'),finish=app.indexOf('  function renderFocusTaskPrompt()',begin);
    vm.runInNewContext(app.slice(begin,finish)+'this.render=renderFocus;',context);context.render();
    assert.equal(player.dataset.presentation,parent==='notch-panel'?'full':'rail');assert.equal(lifecycle[0].visible,true);
    assert.equal(tasksPlayer.hidden,true,'the internal task detail cannot duplicate the home module');context.view='tasks';context.render();assert.equal(tasksPlayer.hidden,false);assert.equal(tasksPlayer.dataset.presentation,'full');
  }
});

test('refreshing the live Focus placement does not notify the model again and recurse into the scene', () => {
  const app=fs.readFileSync(require.resolve('../notch.js'),'utf8'), card={}, item={id:'focus'}; let renders=0;
  const scope={moduleDefinitions,homeLayout:null,activityStage:{contains:node=>node===card},byId:()=>({dataset:{layout:'activities'}}),activityMain:{dataset:{activity:'focus'}},
    sceneActivities:()=>[item],activityScene:{inspect:()=>({items:[item]})},activityCards:new Map([['focus',card]]),communityCards:new Map(),
    activitySide:{setAttribute(){}},t:value=>value,focusComponent:{render(notify=true){assert.equal(notify,false,'a scene repaint must not notify and re-enter itself');renders++;}}};
  const begin=app.indexOf('  function renderActivitySceneValues() {'),end=app.indexOf('  function renderActivityScene() {',begin);
  vm.runInNewContext(compactPolicy(app)+app.slice(begin,end)+'this.render=renderActivitySceneValues;',scope);scope.render();assert.equal(renders,1);
});

test('module customization yields to a task menu and native fields inside the component shadow root', () => {
  const app=fs.readFileSync(require.resolve('../notch.js'),'utf8');let opened=0,prevented=0;
  const host={matches:()=>false},input={matches:()=>true};
  const scope={view:'nook',welcome:null,notch:{contains:()=>true},window:{getSelection:()=>null},openModuleEditor(){opened++;return true;}};
  const begin=app.indexOf('  function moduleContextMenu(event) {'),end=app.indexOf('  function modulePreview(',begin);
  vm.runInNewContext(app.slice(begin,end)+'this.open=moduleContextMenu;',scope);
  const event={target:host,preventDefault(){prevented++;},composedPath:()=>[host]};
  assert.equal(scope.open({...event,defaultPrevented:true}),false);
  assert.equal(scope.open({...event,composedPath:()=>[input,host]}),false);
  assert.equal(opened,0);assert.equal(prevented,0);
  assert.equal(scope.open(event),true);assert.equal(opened,1);assert.equal(prevented,1);
});

test('compact transfer and file actions open their actual temporary flow without becoming Shelf commands',()=>{
  const app=fs.readFileSync(require.resolve('../notch.js'),'utf8'),calls=[];
  const node=()=>({dataset:{sceneCommand:'shelf-open'},attributes:{},setAttribute(name,value){this.attributes[name]=value;},querySelector:()=>({setAttribute(){}})});
  const action=node(),title=node(),detail=node(),card={dataset:{},querySelector:selector=>selector==='.module-compact-title'?title:selector==='.module-compact-detail'?detail:action};
  const incoming={id:'actual-request',files:[{name:'photo.jpg'}]},scope={moduleDefinitions,disposed:false,t:value=>value,nearby:{incoming},localSendContext:{direction:'receive'},compactModuleCard:()=>card,
    openLocalSend:(...args)=>calls.push(['localsend',...args]),openActivityDetail:route=>calls.push(['detail',route]),selectViewButton:button=>calls.push(['route',button.dataset.view]),setState:value=>calls.push(['state',value])};
  const renderStart=app.indexOf('  function renderCompactModule('),renderEnd=app.indexOf('  function labIds(',renderStart),commandStart=app.indexOf('  function activitySceneCommand('),commandEnd=app.indexOf('  function renderHomeLayout(',commandStart);
  vm.runInNewContext(app.slice(renderStart,renderEnd)+app.slice(commandStart,commandEnd)+'this.render=renderCompactModule;this.command=activitySceneCommand;',scope);
  const click=()=>scope.command({target:{closest:selector=>selector==='[data-scene-promote]'&&action.dataset.scenePromote?action:selector==='[data-scene-command]'&&action.dataset.sceneCommand?action:null}});
  scope.render({id:'transfer',label:'LocalSend',value:'42 %'},{fits:true});assert.equal(action.dataset.scenePromote,'transfer');assert.equal(action.dataset.sceneCommand,undefined);click();assert.deepEqual(calls,[['localsend','receive',incoming]]);
  calls.length=0;scope.nearby.incoming=null;click();assert.deepEqual(calls,[['route','localsend'],['state','open']]);
  calls.length=0;scope.render({id:'file',label:'Document',value:'50 %'},{fits:true});assert.equal(action.dataset.scenePromote,'file');assert.equal(action.dataset.sceneCommand,undefined);click();assert.deepEqual(calls,[['detail','files']]);
});

test('compact Focus names its actual next action and dispatches through the live scene handler in every timer state',()=>{
  const app=fs.readFileSync(require.resolve('../notch.js'),'utf8'),calls=[];
  const path={attributes:{},setAttribute(name,value){this.attributes[name]=value;}},action={dataset:{scenePromote:'focus'},attributes:{},disabled:true,setAttribute(name,value){this.attributes[name]=value;},querySelector:()=>path};
  const title={},detail={},card={dataset:{},querySelector:selector=>selector==='.module-compact-title'?title:selector==='.module-compact-detail'?detail:action};
  const scope={moduleDefinitions,disposed:false,t:value=>value,focus:{tasks:[]},compactModuleCard:()=>card,focusComponent:{command:value=>calls.push(value)}};
  const activeStart=app.indexOf('  function focusIsActive()'),activeEnd=app.indexOf('  function focusLabel()',activeStart),renderStart=app.indexOf('  function renderCompactModule('),renderEnd=app.indexOf('  function labIds(',renderStart),commandStart=app.indexOf('  function activitySceneCommand('),commandEnd=app.indexOf('  function renderHomeLayout(',commandStart);
  assert(activeStart>0&&activeEnd>activeStart&&renderStart>0&&renderEnd>renderStart&&commandStart>0&&commandEnd>commandStart);
  vm.runInNewContext(app.slice(activeStart,activeEnd)+app.slice(renderStart,renderEnd)+app.slice(commandStart,commandEnd)+'this.render=renderCompactModule;this.command=activitySceneCommand;',scope);
  const click=()=>scope.command({target:{closest:selector=>selector==='[data-scene-command]'?action:null}});
  const task={id:'kept',title:'Keep the current task',done:false};
  for(const scenario of [
    {name:'empty',state:{tasks:[],sessionActive:false,deadline:null},playing:false,label:'Nouvelle tâche',command:'start',icon:'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6Z'},
    {name:'ready',state:{tasks:[task],sessionActive:false,deadline:null},playing:false,label:'Démarrer Focus',command:'start',icon:'M8 5v14l11-7Z'},
    {name:'paused',state:{tasks:[task],sessionActive:true,deadline:null},playing:false,label:'Reprendre',command:'toggle',icon:'M8 5v14l11-7Z'},
    {name:'running',state:{tasks:[task],sessionActive:true,deadline:Date.now()+60000},playing:true,label:'Mettre en pause',command:'toggle',icon:'M6 5h4v14H6ZM14 5h4v14h-4Z'},
    {name:'all completed',state:{tasks:[{...task,done:true}],sessionActive:false,deadline:null},playing:false,label:'Nouvelle tâche',command:'start',icon:'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6Z'},
  ]){
    scope.focus=scenario.state;calls.length=0;
    scope.render({id:'focus',label:'Focus',value:scenario.name,playing:scenario.playing},{fits:true});
    assert.equal(action.attributes['aria-label'],scenario.label,scenario.name);assert.equal(path.attributes.d,scenario.icon,scenario.name);
    assert.equal(action.dataset.scenePromote,undefined,scenario.name);assert.equal(action.dataset.sceneCommand,'focus-toggle',scenario.name);assert.equal(action.disabled,false,scenario.name);assert.equal(action.hidden,false,scenario.name);
    click();assert.deepEqual(calls,[scenario.command],scenario.name+' must use the current task controller without promoting or rerouting');
    assert.equal(scope.focus,scenario.state,'rendering must preserve the same task/timer state');
  }
});

test('compact module titles and actions follow the real French/English dictionary while user city text remains intact',()=>{
  const app=fs.readFileSync(require.resolve('../notch.js'),'utf8'),i18n=require('../i18n.js').create(null),path={setAttribute(){}},action={dataset:{},attributes:{},setAttribute(name,value){this.attributes[name]=value;},querySelector:()=>path},title={},detail={},card={dataset:{},querySelector:selector=>selector==='.module-compact-title'?title:selector==='.module-compact-detail'?detail:action};
  const scope={moduleDefinitions,t:i18n.t,focus:{tasks:[],sessionActive:false,deadline:null},commandBusy:false,connectionLost:false,music:{canToggle:true},compactModuleCard:()=>card,byId:()=>({getAttribute:()=> 'M6 5h4v14H6ZM14 5h4v14h-4Z'}),getWeatherSummary:()=>({narrative:{city:'Tunis'}})};
  const active=app.slice(app.indexOf('  function focusIsActive()'),app.indexOf('  function focusLabel()')),render=app.slice(app.indexOf('  function renderCompactModule('),app.indexOf('  function labIds('));vm.runInNewContext(active+render+'this.render=renderCompactModule;',scope);
  for(const language of ['en','fr','en']){
    i18n.setLocale(language);const en=language==='en';
    for(const [id,label,aria]of [['music',en?'Music':'Musique',en?'Pause':'Mettre en pause'],['focus',en?'Tasks & Focus':'Tâches & Focus',en?'New task':'Nouvelle tâche'],['shelf',en?'Shelf':'Étagère',en?'Open':'Ouvrir'],['weather','Tunis',en?'Open':'Ouvrir']]){
      scope.render({id,label:moduleDefinitions[id].label,playing:id==='music'},{fits:true});assert.equal(title.textContent,label,language+' '+id);assert.equal(action.attributes['aria-label'],aria,language+' '+id+' action');
    }
    scope.focus.tasks=[{id:'kept',title:'Untranslated user task',done:false}];scope.render({id:'focus',playing:false},{fits:true});assert.equal(action.attributes['aria-label'],en?'Start Focus':'Démarrer Focus');scope.focus.tasks=[];
  }
});

test('promoting an arbitrary community ID opens its supported live Lab presentation through the real layout planner',()=>{
  const app=fs.readFileSync(require.resolve('../notch.js'),'utf8'),Layout=require('../module-contracts.js'),runtime=require('../module-runtime.js'),id='community.another-counter';
  const manifest=structuredClone(runtime.catalog[0]);manifest.id=id;manifest.layout={main:{min:{width:240,height:180},ideal:{width:356,height:260}}};
  const original={view:'settings',page:'music'},definition={id,community:true,contract:runtime.getLayoutContract(manifest)},calls=[];
  const scope={ModuleLayout:Layout,moduleDefinitions:{...moduleDefinitions,[id]:definition},disposed:false,moduleLab:null,view:'nook',islandPage:'music',sceneConfigurationSignature:'',notch:{dataset:{}},
    isModuleEnabled:value=>value===id,captureRouteOrigin:()=>original,slotViewport:()=>({width:Layout.surfaceLimits.richMinWidth-Layout.metrics.padding*2,height:260}),getModuleEditorActive:()=>false,activityScene:{reset:()=>calls.push('reset')},setState:value=>calls.push(value),renderHomeLayout:()=>calls.push('render'),update(){},renderModuleLabControls(){}};
  const contractStart=app.indexOf('  function layoutContract('),contractEnd=app.indexOf('  function slotViewport(',contractStart),planStart=app.indexOf('  function planHomeSlots('),planEnd=app.indexOf('  function modulePlacementCandidate(',planStart),labStart=app.indexOf('  function labIds('),labEnd=app.indexOf('  function endModuleLab(',labStart),commandStart=app.indexOf('  function activitySceneCommand('),commandEnd=app.indexOf('  function renderHomeLayout(',commandStart);
  vm.runInNewContext(app.slice(contractStart,contractEnd)+app.slice(planStart,planEnd)+app.slice(labStart,labEnd)+app.slice(commandStart,commandEnd)+'this.command=activitySceneCommand;',scope);
  const control={dataset:{scenePromote:id}};scope.command({target:{closest:selector=>selector==='[data-scene-promote]'?control:null}});
  assert.equal(scope.moduleLab.id,id);assert.equal(scope.moduleLab.presentation,'main');assert.equal(scope.moduleLab.origin,original);assert.equal(scope.view,'nook');assert.equal(scope.notch.dataset.moduleLab,'true');assert.deepEqual(calls,['reset','open','render']);
  calls.length=0;scope.moduleLab=null;scope.view='module-library';const marketOrigin={view:'module-library',page:'music'};scope.captureRouteOrigin=()=>marketOrigin;
  scope.selectViewButton=button=>{assert.equal(scope.moduleLab,null,'Normal navigation must not dispose the new Lab');scope.view=button.dataset.view;calls.push('route-'+scope.view);};
  scope.command({target:{closest:selector=>selector==='[data-scene-promote]'?control:null}});
  assert.equal(scope.moduleLab.origin,marketOrigin);assert.equal(scope.moduleLab.id,id);assert.deepEqual(calls,['route-nook','reset','open','render'],'Opening a Lab from Market uses normal route cleanup');
});

test('compact Weather, Shelf, file and transfer actions retain their actual Nook or Lab origin through Back',()=>{
  const app=fs.readFileSync(require.resolve('../notch.js'),'utf8');
  for(const [id,inLab] of [['weather',false],['weather',true],['shelf',false],['shelf',true],['file',false],['transfer',false]]){
    const calls=[],exit={view:'settings',page:'music'},presentation='small',route=moduleDefinitions[id]?.view||{file:'files',transfer:'tray'}[id],path={setAttribute(){}},action={dataset:{},attributes:{},isConnected:true,closest:()=>null,setAttribute(name,value){this.attributes[name]=value;},querySelector:()=>path,focus(){scope.document.activeElement=action;calls.push('origin-focus');}},title={},detail={},card={dataset:{},querySelector:selector=>selector==='.module-compact-title'?title:selector==='.module-compact-detail'?detail:action};
    const scope={moduleDefinitions,disposed:false,t:value=>value,view:'nook',islandPage:'music',moduleLab:inLab?{id,presentation,origin:exit}:null,detailReturn:null,detailView:'',focusToolReturn:null,settingsReturn:null,keyboardNavigation:false,weatherInlinePickerReturn:null,weatherPickerOpen:false,
      document:{activeElement:action},nearby:{incoming:null},localSendContext:null,compactModuleCard:()=>card,getWeatherSummary:()=>({narrative:{city:'Tunis'}}),settingsRoute:route=>['settings','scenarios','health'].includes(route),
      selectViewButton(button){scope.moduleLab=null;scope.view=button.dataset.view;calls.push('route-'+scope.view);},setState:value=>calls.push('state-'+value),
      beginModuleLab(value){scope.view='nook';scope.moduleLab={id:value.id,presentation:value.presentation,origin:null};calls.push('lab-'+value.id);return{ok:true};}};
    for(const name of ['focusToolBack','detailBack'])scope[name]={hidden:false,closest:()=>null,focus(){scope.document.activeElement=scope[name];}};
    const capture=app.slice(app.indexOf('  function captureRouteOrigin('),app.indexOf('  let calendar =')),
      routes=app.slice(app.indexOf('  function restoreFocusRoute('),app.indexOf('  const focusComponent =')),
      render=app.slice(app.indexOf('  function renderCompactModule('),app.indexOf('  function labIds(')),
      command=app.slice(app.indexOf('  function activitySceneCommand('),app.indexOf('  function renderHomeLayout('));
    vm.runInNewContext(capture+routes+render+command+'this.render=renderCompactModule;this.command=activitySceneCommand;this.back=returnFromDetail;',scope);
    scope.render({id,label:id,value:'Actual module state'},{fits:true});
    if(['file','transfer'].includes(id))assert.equal(action.dataset.scenePromote,id);else assert.equal(action.dataset.sceneCommand,id+'-open');
    scope.command({target:{closest:selector=>selector==='[data-scene-promote]'&&action.dataset.scenePromote?action:selector==='[data-scene-command]'&&action.dataset.sceneCommand?action:null}});
    assert.equal(scope.view,route);assert.equal(scope.detailReturn.view,'nook');assert.equal(scope.detailReturn.control,action);assert.equal(scope.detailView,route);
    if(inLab){assert.equal(scope.detailReturn.lab.id,id);assert.equal(scope.detailReturn.lab.presentation,presentation);assert.equal(scope.detailReturn.lab.origin,exit);}
    scope.back();assert.equal(scope.view,'nook');assert.equal(scope.document.activeElement,action);assert.equal(scope.detailReturn,null);assert.equal(scope.detailView,'');
    if(inLab){assert.equal(scope.moduleLab.id,id);assert.equal(scope.moduleLab.presentation,presentation);assert.equal(scope.moduleLab.origin,exit);}else assert.equal(scope.moduleLab,null);
  }
});
