'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../notch.js'),'utf8');
const begin=source.indexOf('  function openActivityDetail(route) {'),end=source.indexOf('  const focusComponent =',begin);
assert(begin>0&&end>begin);

function fixture() {
  const trigger={id:'original-nook-control'},focused=[];
  const back=name=>({hidden:false,closest:()=>null,focus:options=>focused.push({name,options})});
  const scope={moduleLab:null,view:'nook',islandPage:'music',document:{activeElement:trigger},focusToolReturn:null,detailReturn:null,detailView:'',
    focusToolBack:back('focus-return'),detailBack:back('detail-return'),
    selectViewButton(button){scope.view=button.dataset.view;},setState(state){scope.state=state;}};
  const origin=source.slice(source.indexOf('  function captureRouteOrigin('),source.indexOf('  function returnFromDetail('));
  vm.runInNewContext(origin+source.slice(begin,end)+'this.openActivityDetail=openActivityDetail;',scope);
  return{scope,trigger,focused};
}

test('keyboard Music and Tasks detail navigation immediately focuses visible Return, preserving the Nook origin',()=>{
  for(const route of ['music','tasks']) {
    const f=fixture();f.scope.openActivityDetail(route);
    assert.equal(f.scope.view,route);assert.equal(f.scope.state,'open');assert.equal(f.scope.detailView,route);
    assert.equal(f.scope.detailReturn.control,f.trigger);assert.equal(f.scope.detailReturn.view,'nook');assert.equal(f.scope.detailReturn.page,'music');
    assert.deepEqual(f.focused.map(item=>item.name),['detail-return']);assert.equal(f.focused[0].options.preventScroll,true);
  }
});

test('Focus detail moves keyboard focus to its own Return without changing the saved source',()=>{
  const f=fixture();f.scope.openActivityDetail('focus');
  assert.equal(f.scope.focusToolReturn.control,f.trigger);assert.equal(f.scope.focusToolReturn.view,'nook');
  assert.deepEqual(f.focused.map(item=>item.name),['focus-return']);assert.equal(f.scope.detailReturn,null);
});

test('details entered from settings and tasks retain their actual initiating view',()=>{
  for(const [origin,route] of [['settings','weather'],['health','weather'],['tasks','focus'],['tray','music']]) {
    const f=fixture();f.scope.view=origin;f.scope.openActivityDetail(route);
    const saved=route==='focus'?f.scope.focusToolReturn:f.scope.detailReturn;
    assert.equal(saved.view,origin);assert.equal(saved.control,f.trigger);assert.equal(f.scope.state,'open');
  }
});

test('hidden or inert Return controls are never focused',()=>{
  for(const inaccessible of ['hidden','inert']) {
    const f=fixture();if(inaccessible==='hidden')f.scope.detailBack.hidden=true;else f.scope.detailBack.closest=()=>({inert:true});
    f.scope.openActivityDetail('music');assert.deepEqual(f.focused,[]);
  }
});

test('keyboard return stays anchored in the persistent toolbar until its original control is visible',()=>{
  const start=source.indexOf('  function restoreFocusRoute(origin) {'),stop=source.indexOf('  function openActivityDetail(route)',start);
  const calls=[],document={activeElement:{id:'detail-back'}},navigation={focus(){document.activeElement=navigation;calls.push('toolbar-focus');}};
  const original={isConnected:true,closest:()=>null,focus(){document.activeElement=original;calls.push('origin-focus');}};
  const scope={document,keyboardNavigation:true,menu:{querySelector:()=>navigation},islandPage:'focus',
    selectViewButton(button){assert.equal(document.activeElement,navigation,'an automatic scenario must not observe body focus during the route change');calls.push('route-'+button.dataset.view);},
    setState(state){calls.push('state-'+state);}};
  vm.runInNewContext(source.slice(start,stop)+'this.restoreFocusRoute=restoreFocusRoute;',scope);
  scope.restoreFocusRoute({view:'nook',page:'music',control:original});
  assert.deepEqual(calls,['toolbar-focus','route-nook','state-open','origin-focus']);assert.equal(scope.islandPage,'music');assert.equal(document.activeElement,original);
});

test('returning from Settings restores the earlier Weather detail origin rather than losing Nook',()=>{
  const home={view:'nook',page:'music'}, control={isConnected:true,closest:()=>null,focus(){}}, seen=[];
  const scope={moduleLab:null,view:'weather',islandPage:'music',detailReturn:home,detailView:'weather',focusToolReturn:null,keyboardNavigation:false,
    document:{activeElement:control},selectViewButton(button){seen.push(button.restoring);scope.view=button.dataset.view;},setState(){}};
  const capture=source.slice(source.indexOf('  function captureRouteOrigin('),source.indexOf('  function returnFromDetail('));
  const restore=source.slice(source.indexOf('  function restoreFocusRoute('),source.indexOf('  function openActivityDetail('));
  vm.runInNewContext(capture+restore+'this.capture=captureRouteOrigin;this.restore=restoreFocusRoute;',scope);
  const origin=scope.capture();scope.detailReturn={view:'settings'};scope.detailView='weather';scope.view='settings';scope.restore(origin);
  assert.equal(scope.view,'weather');assert.equal(scope.detailReturn,home);assert.equal(scope.detailView,'weather');assert.deepEqual(seen,[true]);
});

test('a temporary detail returns to its exact Module Lab presentation and preserves the original Lab exit route',()=>{
  const originalExit={view:'settings',page:'music'},calls=[],control={isConnected:true,closest:()=>null,focus:()=>calls.push('origin-focus')};
  const scope={view:'nook',islandPage:'music',detailReturn:null,detailView:'',focusToolReturn:null,keyboardNavigation:false,moduleLab:{id:'weather',presentation:'side',origin:originalExit},document:{activeElement:control},
    beginModuleLab(value){calls.push({id:value.id,presentation:value.presentation});scope.moduleLab={id:value.id,presentation:value.presentation,origin:{view:'weather'}};scope.view='nook';return{ok:true};},
    selectViewButton(){assert.fail('successful Lab restoration must not navigate away from its presentation');},setState(){assert.fail('beginModuleLab already opens the live scene');}};
  const capture=source.slice(source.indexOf('  function captureRouteOrigin('),source.indexOf('  function returnFromDetail(')),restore=source.slice(source.indexOf('  function restoreFocusRoute('),source.indexOf('  function openActivityDetail('));
  vm.runInNewContext(capture+restore+'this.capture=captureRouteOrigin;this.restore=restoreFocusRoute;',scope);
  const origin=scope.capture();assert.equal(origin.lab.origin,originalExit);assert.equal(origin.lab.presentation,'side');
  scope.moduleLab=null;scope.view='weather';scope.restore(origin);
  assert.equal(scope.view,'nook');assert.equal(scope.moduleLab.id,'weather');assert.equal(scope.moduleLab.presentation,'side');assert.equal(scope.moduleLab.origin,originalExit);assert.deepEqual(calls,[{id:'weather',presentation:'side'},'origin-focus']);
});

test('an unavailable Module Lab presentation falls back to the captured usable route instead of trapping detail navigation',()=>{
  const calls=[],control={isConnected:true,closest:()=>null,focus:()=>calls.push('origin-focus')};
  const scope={moduleLab:null,view:'weather',islandPage:'essential',keyboardNavigation:false,beginModuleLab(){calls.push('lab-unavailable');return{ok:false,reason:'module-disabled'};},selectViewButton(button){scope.view=button.dataset.view;calls.push('route-'+scope.view);},setState:state=>calls.push('state-'+state)};
  const restore=source.slice(source.indexOf('  function restoreFocusRoute('),source.indexOf('  function openActivityDetail('));vm.runInNewContext(restore+'this.restore=restoreFocusRoute;',scope);
  scope.restore({view:'nook',page:'music',control,lab:{id:'weather',presentation:'side',origin:{view:'settings'}}});
  assert.equal(scope.view,'nook');assert.equal(scope.islandPage,'music');assert.equal(scope.moduleLab,null);assert.deepEqual(calls,['lab-unavailable','route-nook','state-open','origin-focus']);
});

test('a Duration shadow host restores the live Small control after a detail rebuilt its buttons',()=>{
  const calls=[],button={isConnected:true,closest:()=>null,focus:()=>calls.push('small-control')};
  const mount={isConnected:true,closest:()=>null,focus:()=>assert.fail('a nonfocusable shadow host cannot restore its child'),shadowRoot:{querySelector(selector){assert(selector.includes('.nd-module-small-copy'));return button;}}};
  const scope={moduleLab:null,view:'focus',islandPage:'music',keyboardNavigation:false,menu:{querySelector:()=>({focus:()=>calls.push('toolbar')})},beginModuleLab(){scope.moduleLab={};return{ok:true};}};
  const restore=source.slice(source.indexOf('  function restoreFocusRoute('),source.indexOf('  function openActivityDetail('));vm.runInNewContext(restore+'this.restore=restoreFocusRoute;',scope);
  scope.restore({view:'nook',control:mount,lab:{id:'focus',presentation:'small',origin:{view:'settings'}}});assert.deepEqual(calls,['small-control']);
});

// Exercise the actual Duration view notification and the shell's FocusAPI
// callbacks together: editing is already true when openDuration runs.
function durationRouteFixture(inLab) {
  const calls=[],exit={view:'settings',page:'music'},detail={view:'nook',page:'music'};
  const scope={view:inLab?'nook':'weather',islandPage:'music',detailReturn:inLab?null:detail,detailView:inLab?'':'weather',focusToolReturn:null,focusConfigurationReturn:null,
    moduleLab:inLab?{id:'focus',presentation:'side',origin:exit}:null,keyboardNavigation:false,
    editing:new Set(),viewStates:new Map(),routeLeaving:false,focusPlayer:{dataset:{}},motionEnabled:()=>false,syncFocus(){},restoreFocusTaskControl(){},
    selectViewButton(button){scope.moduleLab=null;scope.view=button.dataset.view;calls.push('route-'+scope.view);},setState(state){scope.state=state;},
    beginModuleLab(value){calls.push('lab-'+value.presentation);scope.moduleLab={id:value.id,presentation:value.presentation,origin:null};scope.view='nook';return{ok:true};},
    FocusAPI:{create(options){scope.options=options;return{inspect:()=>({configOpen:scope.editing.size>0}),command(value){calls.push('command-'+value);}};}}};
  const control={isConnected:true,closest:()=>null,focus(){scope.document.activeElement=control;calls.push('origin-focus');}};
  scope.document={activeElement:control};scope.host=scope.focusPlayer;
  for(const name of ['focusToolBack','detailBack'])scope[name]={hidden:false,closest:()=>null,focus(){scope.document.activeElement=scope[name];}};
  const capture=source.slice(source.indexOf('  function captureRouteOrigin('),source.indexOf('  function returnFromDetail('));
  const route=source.slice(source.indexOf('  function restoreFocusRoute('),source.indexOf('  const focusComponent ='));
  const callbacks=source.slice(source.indexOf('  const focusComponent ='),source.indexOf('  focus = focusComponent.getState();'));
  const adapter=fs.readFileSync(require.resolve('../focus-duration.js'),'utf8'),edit=adapter.slice(adapter.indexOf('    function editView('),adapter.indexOf('    function leaveView('));
  vm.runInNewContext(capture+route+callbacks+edit+'this.notify=editView;',scope);
  return{scope,calls,exit,detail,control};
}

for(const inLab of [false,true])for(const kind of ['focus','tasks'])for(const entry of ['settings','create-title']) {
  test(`${inLab?'Lab Side':'ordinary Weather'} origin survives ${kind} ${entry} Save through the actual Duration/shell callback seam`,()=>{
    const f=durationRouteFixture(inLab),originalView=f.scope.view;
    f.scope.notify(kind,entry);
    assert.equal(f.scope.view,kind);assert.equal(f.scope.editing.has(kind),true);assert.equal(f.scope.host.dataset.focusConfig,'true');
    assert.equal(f.scope.moduleLab,null,'the temporary route exits the visible Lab');
    assert.equal(f.scope.focusConfigurationReturn.view,originalView);assert.equal(f.scope.focusConfigurationReturn.control,f.control);
    if(inLab){assert.equal(f.scope.focusConfigurationReturn.lab.presentation,'side');assert.equal(f.scope.focusConfigurationReturn.lab.origin,f.exit);}
    f.scope.notify(kind,kind==='tasks'?'tasks':'timer');
    assert.equal(f.scope.editing.size,0);assert.equal(f.scope.host.dataset.focusConfig,'false');assert.equal(f.scope.focusConfigurationReturn,null,'the saved origin is consumed once');
    assert.equal(f.scope.document.activeElement,f.control);
    if(inLab){assert.equal(f.scope.view,'nook');assert.equal(f.scope.moduleLab.id,'focus');assert.equal(f.scope.moduleLab.presentation,'side');assert.equal(f.scope.moduleLab.origin,f.exit);assert.equal(f.calls.filter(call=>call==='lab-side').length,1);}
    else{assert.equal(f.scope.view,'weather');assert.equal(f.scope.detailReturn,f.detail);assert.equal(f.scope.detailView,'weather');assert.equal(f.scope.moduleLab,null);}
    const settled=f.calls.length;f.scope.notify(kind,'timer');assert.equal(f.calls.length,settled,'a repeated settled notification cannot navigate again');
  });
}

test('a legacy Pomodoro notification cannot add an extra screen or claim an edit Save route',()=>{
  const f=durationRouteFixture(true);f.scope.notify('focus','pomodoro');
  assert.equal(f.scope.view,'nook');assert.equal(f.scope.focusConfigurationReturn,null);assert.equal(f.scope.editing.size,0);
  assert.equal(f.scope.moduleLab.presentation,'side');assert.equal(f.scope.moduleLab.origin,f.exit);assert.equal(f.scope.focusToolReturn,null);
  const settled=f.calls.length;f.scope.notify('focus','timer');assert.equal(f.calls.length,settled,'leaving a nonediting Pomodoro must not fire a synthetic Save return');
});

test('the selected Focus title opens its shared task list without starting or reconfiguring the real timer',()=>{
 const f=durationRouteFixture(false);f.scope.options.openDuration('focus');
 assert.equal(f.scope.view,'focus');assert.equal(f.scope.focusConfigurationReturn,null);assert.equal(f.scope.editing.size,0);
 assert.equal(f.calls.filter(call=>call==='command-link-task').length,1);assert.equal(f.calls.some(call=>/command-(?:start|toggle|prepare)/.test(call)),false);
});

test('an explicit Nook tab returns to the reader and releases its temporary Focus return',()=>{
 const start=source.indexOf('  function selectView(event) {'),end=source.indexOf('  function selectViewButton(',start),button={dataset:{view:'nook'}};
 for(const view of ['focus','tasks','nook']){
  const scope={disposed:false,view,islandPage:'focus',focusToolReturn:{view:'nook',page:'focus'},menu:{hidden:false,contains:()=>true},calendar:null,getModuleEditorActive:()=>false,selectViewButton(value){scope.view=value.dataset.view;}};
  vm.runInNewContext(source.slice(start,end)+'this.selectView=selectView;',scope);scope.selectView({target:{closest:()=>button}});
  assert.equal(scope.view,'nook');assert.equal(scope.islandPage,'music');assert.equal(scope.focusToolReturn,null);
 }
});
