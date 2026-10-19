'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../ia.js'), 'utf8');

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
  const scope = {communityCards:new Map(),activityCards:new Map(),focusPlayer:player};
  const start=app.indexOf('  function activitySummaryCard(id) {'),end=app.indexOf('  function renderActivitySceneValues()',start);
  vm.runInNewContext(app.slice(start,end)+'this.card=activitySummaryCard;',scope);
  assert.equal(scope.card('focus'),player); assert.equal(scope.card('focus'),player);
  for(const parent of ['activity-main','activity-rail-cards','notch-panel']) {
    player.dataset.presentation='rail'; player.parentElement={classList:{contains:value=>value===parent}};
    const lifecycle=[], tasksPlayer={hidden:false,dataset:{}}, context={disposed:false,focusPlayer:player,tasksPlayer,builtinVisible:id=>id==='tasks'&&context.view==='tasks',focusCoreEnabled:()=>true,document:{hidden:false},state:'open',getModuleEditorActive:()=>false,
      focusComponent:{lifecycle:value=>lifecycle.push(value)},view:'nook',tasksComponent:{render(){}},renderFocusRouteBack(){},renderFocusTaskPrompt(){}};
    const begin=app.indexOf('  function renderFocus() {'),finish=app.indexOf('  function renderFocusTaskPrompt()',begin);
    vm.runInNewContext(app.slice(begin,finish)+'this.render=renderFocus;',context);context.render();
    assert.equal(player.dataset.presentation,parent==='notch-panel'?'full':'rail');assert.equal(lifecycle[0].visible,true);
    assert.equal(tasksPlayer.hidden,true,'the internal task detail cannot duplicate the home module');context.view='tasks';context.render();assert.equal(tasksPlayer.hidden,false);assert.equal(tasksPlayer.dataset.presentation,'full');
  }
});

test('refreshing the live Focus placement does not notify the model again and recurse into the scene', () => {
  const app=fs.readFileSync(require.resolve('../notch.js'),'utf8'), card={}, item={id:'focus'}; let renders=0;
  const scope={activityStage:{contains:node=>node===card},byId:()=>({dataset:{layout:'activities'}}),activityMain:{dataset:{activity:'focus'}},
    sceneActivities:()=>[item],activityScene:{inspect:()=>({items:[item]})},activityCards:new Map([['focus',card]]),communityCards:new Map(),
    activitySide:{setAttribute(){}},t:value=>value,focusComponent:{render(notify=true){assert.equal(notify,false,'a scene repaint must not notify and re-enter itself');renders++;}}};
  const begin=app.indexOf('  function renderActivitySceneValues() {'),end=app.indexOf('  function renderActivityScene() {',begin);
  vm.runInNewContext(app.slice(begin,end)+'this.render=renderActivitySceneValues;',scope);scope.render();assert.equal(renders,1);
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
