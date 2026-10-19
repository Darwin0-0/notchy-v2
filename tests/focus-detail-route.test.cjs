'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../notch.js'),'utf8');
const begin=source.indexOf('  function openActivityDetail(route) {'),end=source.indexOf('  const focusComponent =',begin);
assert(begin>0&&end>begin);

function fixture() {
  const trigger={id:'original-nook-control'},focused=[];
  const back=name=>({hidden:false,closest:()=>null,focus:options=>focused.push({name,options})});
  const scope={view:'nook',islandPage:'music',document:{activeElement:trigger},focusToolReturn:null,detailReturn:null,detailView:'',
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
  const scope={view:'weather',islandPage:'music',detailReturn:home,detailView:'weather',focusToolReturn:null,keyboardNavigation:false,
    document:{activeElement:control},selectViewButton(button){seen.push(button.restoring);scope.view=button.dataset.view;},setState(){}};
  const capture=source.slice(source.indexOf('  function captureRouteOrigin('),source.indexOf('  function returnFromDetail('));
  const restore=source.slice(source.indexOf('  function restoreFocusRoute('),source.indexOf('  function openActivityDetail('));
  vm.runInNewContext(capture+restore+'this.capture=captureRouteOrigin;this.restore=restoreFocusRoute;',scope);
  const origin=scope.capture();scope.detailReturn={view:'settings'};scope.detailView='weather';scope.view='settings';scope.restore(origin);
  assert.equal(scope.view,'weather');assert.equal(scope.detailReturn,home);assert.equal(scope.detailView,'weather');assert.deepEqual(seen,[true]);
});
