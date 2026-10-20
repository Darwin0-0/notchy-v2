'use strict';
const {test} = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src-tauri/src/window_bridge.js'), 'utf8');
const key = 'notchy-minimal-modules-v1';
function fixture({saved={},preferences={},invoker,localSendActive=false,startup,development=false,keys=[key]}={}) {
  const calls=[],fetches=[],listeners=[],events=[];
  class Storage {constructor(){this.values=new Map(Object.entries(saved));}getItem(key){return this.values.get(key)??null;}setItem(key,value){this.values.set(key,String(value));}removeItem(key){this.values.delete(key);}}
  class EventSource {constructor(url,options){events.push({url,options});}}
  const localStorage=new Storage();
  const window={fetch:async(input,options)=>{fetches.push({input,options});return {ok:true};},EventSource,__TAURI__:{core:{invoke:async(command,args)=>{calls.push({command,args});return invoker?invoker(command,args):{ok:true};}},event:{listen:async(name,callback)=>{const entry={name,callback,removed:false};listeners.push(entry);return ()=>{entry.removed=true;};}}}};
  const location=new URL('http://127.0.0.1:58252/?desktop=1');
  vm.runInNewContext(source.replace('__NOTCHY_CONFIG__',JSON.stringify({token:'private-session',keys,preferences,checking:false,development,localSendActive,startup})),{window,Storage,localStorage,location,URL,Request,Headers,ArrayBuffer,Uint8Array,DataView,TextDecoder});
  return {window,calls,fetches,listeners,events,localStorage};
}
test('Tauri credentials apply only to this server and replace legacy public header',async()=>{
  const context=fixture();
  await context.window.fetch('/api/shelf',{headers:{'X-Notchy':'1'},method:'POST',body:'file'});
  await context.window.fetch('https://example.com/api/shelf');
  assert.equal(context.fetches[0].options.headers.get('X-Notchy'),'private-session');
  assert.equal(context.fetches[1].options,undefined);
  new context.window.EventSource('/api/music/events?spectrum=1');
  new context.window.EventSource('https://example.com/events');
  const own=new URL(context.events[0].url);
  assert.equal(own.searchParams.get('spectrum'),'1');assert.equal(own.searchParams.get('token'),'private-session');
  assert.equal(new URL(context.events[1].url).searchParams.has('token'),false);
});
test('Migration seeds absent keys and preserves current WebView preferences',async()=>{
  const old=JSON.stringify({enabled:['music'],slots:['music']});
  const current=JSON.stringify({enabled:[],slots:[]});
  const context=fixture({saved:{[key]:current},preferences:{[key]:old,unrelated:'secret'}});
  assert.equal(context.localStorage.getItem(key),current);assert.equal(context.localStorage.getItem('unrelated'),null);assert.equal(context.calls.length,0);
  context.localStorage.setItem(key,old);await Promise.resolve();
  assert.equal(context.calls[0].args.value.command,'preference');assert.equal(context.calls[0].args.value.value.key,key);
  context.localStorage.setItem('unrelated','value');assert.equal(context.calls.length,1);
  assert.equal(fixture({preferences:{[key]:old}}).localStorage.getItem(key),old);
});
test('Unsubscribing before asynchronous event registration removes the listener',async()=>{
  const context=fixture();let seen=0;
  const remove=context.window.notchyDesktop.onResume(()=>seen++);remove();await Promise.resolve();
  assert.equal(context.listeners[0].removed,true);
  context.listeners[0].callback({payload:{reason:'open'}});assert.equal(seen,0);
});
test('Native cursor events expose only the payload and stop after asynchronous unsubscription',async()=>{
  const context=fixture(),seen=[];
  const remove=context.window.notchyDesktop.onPointer(value=>seen.push(value));await Promise.resolve();
  assert.equal(context.listeners[0].name,'notchy:pointer');
  context.listeners[0].callback({payload:{inside:false,moved:true}});assert.deepEqual(seen,[{inside:false,moved:true}]);
  remove();assert.equal(context.listeners[0].removed,true);
  context.listeners[0].callback({payload:{inside:true}});assert.equal(seen.length,1);
  const second=fixture();const early=second.window.notchyDesktop.onPointer(()=>assert.fail('Disposed pointer subscription fired'));
  early();await Promise.resolve();assert.equal(second.listeners[0].removed,true);
  second.listeners[0].callback({payload:{inside:false}});
});
test('Native geometry serializes animations and coalesces to the latest frame',async()=>{
  const replies=[];let active=0,peak=0;
  const context=fixture({invoker:()=>new Promise(resolve=>{active++;peak=Math.max(peak,active);replies.push(value=>{active--;resolve(value);});})});
  const first=context.window.notchyDesktop.sendGeometry({height:300,state:'open'});
  const second=context.window.notchyDesktop.sendGeometry({height:100,state:'compact'});
  const last=context.window.notchyDesktop.sendGeometry({height:14,state:'rest'});
  assert.equal(context.calls.length,1);assert.equal(first,second);assert.equal(second,last);
  replies[0]({maxHeight:800});
  for(let i=0;i<8;i++)await Promise.resolve();
  assert.equal(context.calls.length,2);assert.equal(context.calls[1].args.value.value.state,'rest');
  replies[1]({maxHeight:800});await last;assert.equal(peak,1);
});
test('Startup exposes only confirmed LocalSend availability for incoming request monitoring',()=>{
  assert.equal(fixture().window.notchyDesktop.localSendActive,false);
  assert.equal(fixture({localSendActive:true}).window.notchyDesktop.localSendActive,true);
  assert.equal(fixture({localSendActive:'true'}).window.notchyDesktop.localSendActive,false);
});
test('The opaque interface no longer exposes desktop capture',()=>{
  const context=fixture();
  assert.equal(typeof context.window.notchyDesktop.captureBackdrop,'undefined');
  assert.equal(context.calls.length,0);
});

test('module registry writes await native acknowledgement and never queue a duplicate cache write',async()=>{
  const registryKey='notchy-community-modules-v1',encoded='{"registryVersion":1,"modules":[]}';
  let accept;const context=fixture({keys:[key,registryKey],invoker:()=>new Promise(resolve=>{accept=resolve;})});
  let settled=false;const saving=context.window.notchyDesktop.saveModuleRegistry(encoded).then(()=>{settled=true;});
  await Promise.resolve();assert.equal(settled,false);assert.equal(context.calls[0].args.value.value.key,registryKey);
  accept({ok:true});await saving;assert.equal(settled,true);
  context.localStorage.setItem(registryKey,encoded);assert.equal(context.calls.length,1,'acknowledged cache commit does not send a stale second write');
  await assert.rejects(context.window.notchyDesktop.saveModuleRegistry({}),/Invalid module/);
});

test('module registry errors stay errors and confirmed native restoration overrides stale browser cache',async()=>{
  const registryKey='notchy-community-modules-v1',confirmed='{"registryVersion":1,"modules":[]}';
  const context=fixture({keys:[registryKey],saved:{[registryKey]:'stale'},preferences:{[registryKey]:confirmed},invoker:()=>({ok:false,error:'Disk unavailable'})});
  assert.equal(context.localStorage.getItem(registryKey),confirmed);
  await assert.rejects(context.window.notchyDesktop.saveModuleRegistry(confirmed),/Disk unavailable/);
  assert.equal(context.localStorage.getItem(registryKey),confirmed);
  assert.equal(fixture({keys:[registryKey],saved:{[registryKey]:'unconfirmed'}}).localStorage.getItem(registryKey),null);
});

test('the native trial seeds a fresh origin but keeps confirmed module imports across a UI reload',()=>{
  const registryKey='notchy-community-modules-v1',initial='{"registryVersion":1,"modules":[]}',confirmed='{"registryVersion":1,"modules":[{"id":"community.example"}]}';
  const launch=fixture({development:true,keys:[registryKey],preferences:{[registryKey]:initial}});
  assert.equal(launch.localStorage.getItem(registryKey),initial,'a new process/origin starts from native profile data');
  const reload=fixture({development:true,keys:[registryKey],saved:{[registryKey]:confirmed},preferences:{[registryKey]:initial}});
  assert.equal(reload.localStorage.getItem(registryKey),confirmed,'the startup bridge snapshot must not overwrite a later acknowledged import');
  const noInitialRegistry=fixture({development:true,keys:[registryKey],saved:{[registryKey]:confirmed}});
  assert.equal(noInitialRegistry.localStorage.getItem(registryKey),confirmed,'a first import survives even when no registry existed at host startup');
  assert.equal(launch.calls.length+reload.calls.length+noInitialRegistry.calls.length,0,'restoration never writes stale startup data back to native storage');
});

test('release module restoration remains native-authoritative unless the debug flag is exactly true',()=>{
  const registryKey='notchy-community-modules-v1',confirmed='{"registryVersion":1,"modules":[]}';
  for(const development of [false,undefined,'true',1]) {
    assert.equal(fixture({development,keys:[registryKey],saved:{[registryKey]:'stale'},preferences:{[registryKey]:confirmed}}).localStorage.getItem(registryKey),confirmed);
    assert.equal(fixture({development,keys:[registryKey],saved:{[registryKey]:'stale'}}).localStorage.getItem(registryKey),null);
  }
});
test('Windows startup shows confirmed state and updates it only from native replies',async()=>{
  const context=fixture({startup:{supported:true,enabled:true},invoker:(_,args)=>({ok:true,supported:true,enabled:args.value.value})});
  assert.equal(context.window.notchyDesktop.startup.enabled,true);
  const reply=await context.window.notchyDesktop.setStartup(false);
  assert.equal(reply.ok,true);assert.equal(reply.enabled,false);assert.equal(context.window.notchyDesktop.startup.enabled,false);
  assert.equal(context.calls[0].args.value.command,'startup');assert.equal(context.calls[0].args.value.value,false);
  assert.equal(context.localStorage.values.size,0);
  const invalid=await context.window.notchyDesktop.setStartup('true');assert.equal(invalid.ok,false);assert.equal(context.calls.length,1);
  assert.equal(fixture().window.notchyDesktop.startup.supported,false);
});
test('Windows startup errors preserve the actual native registration instead of reporting a successful change',async()=>{
  const context=fixture({startup:{supported:true,enabled:false},invoker:()=>({ok:false,supported:true,enabled:false,error:'Registration refused'})});
  const reply=await context.window.notchyDesktop.setStartup(true);
  assert.equal(reply.ok,false);assert.equal(reply.enabled,false);assert.equal(context.window.notchyDesktop.startup.enabled,false);
  assert.equal(context.window.notchyDesktop.startup.error,'Registration refused');
  const failure=fixture({startup:{supported:true,enabled:true},invoker:()=>{throw new Error('Unavailable');}});
  const rejected=await failure.window.notchyDesktop.setStartup(false);
  assert.equal(rejected.ok,false);assert.equal(rejected.enabled,true);assert.equal(failure.window.notchyDesktop.startup.enabled,true);
});
