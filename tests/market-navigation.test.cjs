'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {normalizeModules}=require('../notch.js'),source=fs.readFileSync(require.resolve('../notch.js'),'utf8'),KEY='notchy-minimal-modules-v1';
function fixture({native=false,ack,failWrite=false}={}){
 const before={enabled:['music','focus','weather'],slots:['music','focus','weather','shelf']},writes=[],calls=[];let value=structuredClone(before);
 const scope={disposed:false,Object,JSON,Set,TypeError,Error,moduleStorageKey:KEY,normalizeModules,
  moduleDefinitions:{music:{},focus:{},weather:{},shelf:{},'community.reading':{community:true}},getModules:()=>structuredClone(value),
  window:{__TAURI__:native?{core:{invoke(){}}}:undefined,NotchyIA:{async invokeCore(command,args){calls.push({command,args});if(ack)return ack(command,args);return args.patch;}},localStorage:{setItem(key,encoded){if(failWrite)throw Error('Storage unavailable');writes.push([key,encoded]);}}},
  setModules(next,persist){assert.equal(persist,false,'Market must remain open');value=structuredClone(next);calls.push('apply');},update(){calls.push('update');}};
 const a=source.indexOf('  async function changeBuiltinAvailability('),b=source.indexOf('  function renderCommunityCard(',a);assert(a>0&&b>a);vm.runInNewContext(source.slice(a,b)+'this.change=changeBuiltinAvailability;',scope);
 return {scope,before,writes,calls,get value(){return value;}};
}
test('Market removes and reinstalls built-ins without shifting slots or touching task data',async()=>{
 const f=fixture();await f.scope.change('focus',false);assert.deepEqual(f.value.enabled,['music','weather']);assert.deepEqual(f.value.slots,f.before.slots);
 await f.scope.change('focus',true);assert(f.value.enabled.includes('focus'));assert.deepEqual(f.value.slots,f.before.slots);assert.equal(f.writes.length,2);assert(f.writes.every(([key])=>key===KEY));
});
test('Market availability waits for real native persistence before updating its installed state',async()=>{
 let release;const f=fixture({native:true,ack:(_command,args)=>new Promise(resolve=>{release=()=>resolve(args.patch);})});const pending=f.scope.change('focus',false);
 assert.deepEqual(f.value,f.before);assert.deepEqual(f.writes,[]);release();await pending;assert(!f.value.enabled.includes('focus'));assert.equal(f.calls[0].command,'settings_set');
});
test('failed or missing native acknowledgement cannot claim a successful removal',async()=>{
 for(const ack of [()=>Promise.reject(Error('Disk unavailable')),()=>({}),()=>({[KEY]:{enabled:[],slots:[]}})]){
  const f=fixture({native:true,ack});await assert.rejects(f.scope.change('focus',false));assert.deepEqual(f.value,f.before);assert.deepEqual(f.writes,[]);assert.equal(f.calls.includes('apply'),false);
 }
});
test('a browser save failure leaves installed states and saved placements untouched',async()=>{
 const f=fixture({failWrite:true});await assert.rejects(f.scope.change('music',false));assert.deepEqual(f.value,f.before);assert.deepEqual(f.writes,[]);
});

test('acknowledged native availability remains current if the optional browser cache fails',async()=>{
 const f=fixture({native:true,failWrite:true});await f.scope.change('focus',false);
 assert(!f.value.enabled.includes('focus'));assert.deepEqual(f.value.slots,f.before.slots);assert.equal(f.calls[0].command,'settings_set');assert(f.calls.includes('apply'));assert.deepEqual(f.writes,[]);
});
test('only known built-in IDs and explicit boolean availability may be changed',async()=>{
 for(const [id,installed]of [['missing',true],['__proto__',false],['community.reading',true],['focus',1]]){const f=fixture();await assert.rejects(f.scope.change(id,installed));assert.deepEqual(f.value,f.before);assert.deepEqual(f.calls,[]);}
});
test('Market Back restores the complete originating route instead of losing its Nook page',()=>{
 const origin={view:'nook',page:'tasks',control:{id:'market-button'},detail:{origin:{view:'weather'},view:'focus'},focus:null},calls=[];
 const scope={disposed:false,welcome:null,view:'nook',nearby:{incoming:null},captureRouteOrigin:()=>origin,getModuleEditorActive:()=>false,selectViewButton:button=>{scope.view=button.dataset.view;},openFromOutside(){},moduleLibrary:{show(){calls.push('show');},hide(){calls.push('hide');}},restoreFocusRoute:value=>calls.push(value)};
 const a=source.indexOf('  function showModuleLibrary('),b=source.indexOf('  function placeCommunityModule(',a);vm.runInNewContext('let libraryReturnOrigin=null;'+source.slice(a,b)+'this.open=showModuleLibrary;this.close=closeModuleLibrary;',scope);
 scope.open();assert.equal(scope.view,'module-library');scope.close();assert.equal(calls.at(-1),origin);assert.equal(calls.at(-1).page,'tasks');
});

test('the primary navigation keeps Market visible and selects its actual route',()=>{
 const buttons=['nook','tray','module-library','settings','focus'].map(id=>({dataset:{view:id},hidden:true,attrs:{},setAttribute(key,value){this.attrs[key]=value;}}));
 const scope={menuButtons:buttons,moduleDefinitions:{},view:'module-library',getModuleEditorActive:()=>false};
 const a=source.indexOf('  function renderMenuSelection() {'),b=source.indexOf("  notch.addEventListener('pointerenter'",a);vm.runInNewContext(source.slice(a,b)+'this.render=renderMenuSelection;',scope);scope.render();
 assert.deepEqual(buttons.filter(button=>!button.hidden).map(button=>button.dataset.view),['nook','tray','module-library','settings']);assert.equal(buttons[2].attrs['aria-current'],'page');
 scope.view='nook';scope.render();assert.equal(buttons[2].hidden,false);assert.equal(buttons[2].attrs['aria-current'],'false');assert.equal(buttons[0].attrs['aria-current'],'page');
});
