'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const runtime=require('../module-runtime.js'),source=fs.readFileSync(require.resolve('../module-library.js'),'utf8');
function fixture(options={}) {
  const document={activeElement:null},scrollRequests=[];
  const fixtureOffsets=options.cardOffsets||{};
  const key=name=>name.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
  class Element {
    constructor(tag){this.tagName=tag;this.ownerDocument=document;this.children=[];this.dataset={};this.attributes={};this.className='';this._text='';this.listeners=new Map();this.style={setProperty:(key,value)=>{this.style[key]=value;}};this.classList={add:name=>{if(!this.className.split(' ').includes(name))this.className+=' '+name;}};}
    set textContent(value){this._text=String(value);for(const child of this.children)child.parentNode=null;this.children=[];}
    get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
    get childElementCount(){return this.children.length;} get lastChild(){return this.children.at(-1);} get parentElement(){return this.parentNode;}
    append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
    prepend(...nodes){for(const node of nodes.reverse()){node.remove();node.parentNode=this;this.children.unshift(node);}}
    replaceChildren(...nodes){this.textContent='';this.append(...nodes);}
    remove(){if(this.parentNode){const list=this.parentNode.children;list.splice(list.indexOf(this),1);this.parentNode=null;}}
    setAttribute(name,value){this.attributes[name]=String(value);if(name.startsWith('data-'))this.dataset[key(name.slice(5))]=String(value);}
    getAttribute(name){return this.attributes[name]??null;} removeAttribute(name){delete this.attributes[name];}
    addEventListener(type,callback){const callbacks=this.listeners.get(type)||[];callbacks.push(callback);this.listeners.set(type,callbacks);}
    removeEventListener(type,callback){this.listeners.set(type,(this.listeners.get(type)||[]).filter(item=>item!==callback));}
    emit(type,extra={}){if(type==='click'&&this.disabled)return;const event={target:this,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra};for(const callback of [...this.listeners.get(type)||[]])callback(event);return event;}
    contains(node){return this===node||this.children.some(child=>child.contains(node));}
    focus(options){for(let node=this;node;node=node.parentNode)if(node.inert)return;if(!this.disabled){document.activeElement=this;this.lastFocusOptions=options;}}
    scrollIntoView(options){scrollRequests.push({node:this,options});let body=this.parentNode;while(body&&!body.className.split(' ').includes('module-library-body'))body=body.parentNode;if(!body)return;const rect=fixtureOffsets[this.dataset.libraryModule];if(!rect)return;if(rect.top<body.scrollTop)body.scrollTop=rect.top;else if(rect.bottom>body.scrollTop+200)body.scrollTop=rect.bottom-200;}
    matches(selector){if(selector.startsWith('.'))return this.className.split(' ').includes(selector.slice(1));const match=selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);if(match){const value=match[1].startsWith('data-')?this.dataset[key(match[1].slice(5))]:this.attributes[match[1]]??this[match[1]];return match[2]===undefined?value!==undefined:value===match[2];}return this.tagName===selector;}
    querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  }
  document.createElement=tag=>new Element(tag);document.createElementNS=(_,tag)=>new Element(tag);document.body=new Element('body');document.querySelector=selector=>selector==='meta[name="application-version"]'?{content:'0.3.9'}:document.body.querySelector(selector);if(options.galet)document.defaultView={NotchyGalet:options.galet,MutationObserver:options.MutationObserver};
  const host=new Element('section'),toolbar=new Element('div');document.body.append(host,toolbar);
  const scope={window:{NotchyModules:runtime,NotchyLayout:require('../module-contracts.js')},setTimeout,clearTimeout};vm.runInNewContext(source,scope);const store=options.store||runtime.createStore(),placed=[],opened=[],dialogs=[],installed=[],removed=[];let language='fr',closed=0;
  const builtins=[{id:'focus',bundled:true,installed:options.focusInstalled!==false,name:{fr:'Tâches & Focus',en:'Tasks & Focus'},description:{fr:'Tes tâches et leur minuteur.',en:'Your tasks and their timer.'},category:'productivity',accent:'#ff7a45',features:[{title:{fr:'Minuteur',en:'Timer'},detail:{fr:'Progression conservée.',en:'Progress is preserved.'}}],permissions:{fr:'Données locales.',en:'Local data.'}},{id:'music',bundled:true,installed:true,name:{fr:'Musique',en:'Music'},description:{fr:'Le lecteur média.',en:'The media player.'},category:'media'}];
  if(options.quickLook)builtins.push({id:'quicklook',name:'QuickLook',utility:true,bundled:false,installed:false,version:'4.5.0',category:'system',description:{fr:'Un moteur portable pour les aperçus.',en:'A portable preview engine.'},permissions:{fr:'Réseau pour installer et lecture des fichiers demandés.',en:'Network to install and read requested files.'},...options.quickLook});
  const library=scope.window.NotchyModuleLibrary.create({host,store,toolbarHost:toolbar,language:()=>language,getBuiltins:()=>builtins,getPlacements:options.getPlacements||(()=>[{index:0,id:'music',label:'Musique'},{index:1,id:null,label:''},{index:2,id:'weather',label:'Météo'}]),onPlace:(...args)=>{placed.push(args);return options.onPlace?.(...args);},onBuiltinOpen:id=>opened.push(id),onBuiltinStatus:options.onBuiltinStatus,onBuiltinSource:options.onBuiltinSource,onBuiltinInstall:async id=>{installed.push(id);const result=await options.onBuiltinInstall?.(id);if(id==='quicklook')return result;builtins.find(entry=>entry.id===id).installed=true;},onBuiltinRemove:async id=>{removed.push(id);const result=await options.onBuiltinRemove?.(id);if(id==='quicklook')return result;builtins.find(entry=>entry.id===id).installed=false;},onClose:()=>{closed++;},onDialog:file=>dialogs.push(file)});
  const all=()=>document.body.querySelectorAll('button'),find=selector=>document.body.querySelector(selector),click=selector=>{const node=find(selector);assert(node,'Missing '+selector);node.emit('click');return node;};
  library.show();return{document,host,toolbar,store,library,placed,opened,dialogs,installed,removed,find,click,scrollRequests,buttons:all,closed:()=>closed,language(value){language=value;library.refresh();},input(selector,value){const node=find(selector);assert(node);node.value=value;node.emit('input');return node;},key(value='Escape',external=false){return(external?toolbar.querySelector('header'):host).emit('keydown',{key:value});}};
}
const flush=()=>new Promise(setImmediate);
const quickLookStatus=(phase='idle',extra={})=>({supported:true,installed:phase==='installed',officeInstalled:phase==='installed',officeVersion:phase==='installed'?'6':null,phase,version:'4.5.0',downloaded:0,total:155569762,error:null,...extra});

test('downloadable QuickLook reviews permissions and credits, then installs and removes without a Nook slot',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let status=quickLookStatus(),statusCalls=0;
  const f=fixture({quickLook:{nativeAvailable:true},onBuiltinStatus:async id=>{assert.equal(id,'quicklook');statusCalls++;return status;},onBuiltinInstall:async()=>status=quickLookStatus('downloading',{downloaded:35000000}),onBuiltinRemove:async()=>status=quickLookStatus()});
  try{
    await flush();assert(f.library.openDetail('quicklook'));assert.equal(f.find('.module-library-sizes'),null);assert.equal(f.find('[data-market-place]'),null);assert.equal(f.find('[data-module-confirm]'),null);assert(!f.host.textContent.includes('Inclus dans Notchy'));assert(!f.host.textContent.includes('formats adaptatifs'));assert(f.host.textContent.includes('Paddy Xu / QL-Win'));assert(f.host.textContent.includes('GPL-3.0'));assert(f.host.textContent.includes('OfficeViewer 6'));assert(f.host.textContent.includes('Syncfusion'));assert.equal(f.host.querySelectorAll('a').find(link=>link.href==='https://github.com/QL-Win/QuickLook.Plugin.OfficeViewer/releases/tag/6')?.target,'_blank');assert(f.host.textContent.includes('155 Mo'));assert(f.host.textContent.includes('350 Mo'));
    f.click('[data-market-builtin-install="quicklook"]');await flush();assert.deepEqual(f.installed,['quicklook']);assert.equal(f.document.activeElement,f.find('.module-library-back'));assert.equal(f.find('[data-market-builtin-install]').disabled,true);assert(f.find('[data-market-utility-status]').textContent.includes('22 %'));assert.equal(f.store.list().length,0);assert.deepEqual(f.placed,[]);
    const body=f.find('.module-library-body'),progress=f.find('[data-market-utility-progress]'),statusNode=f.find('[data-market-utility-status]'),sourceLink=f.find('a');sourceLink.focus();body.scrollTop=111;
    status=quickLookStatus('downloading',{downloaded:70000000});t.mock.timers.tick(500);await flush();assert.equal(f.find('[data-market-utility-progress]'),progress);assert.equal(f.find('[data-market-utility-status]'),statusNode);assert.equal(f.document.activeElement,sourceLink);assert.equal(body.scrollTop,111);assert(statusNode.textContent.includes('44 %'));
    status=quickLookStatus('error',{error:'Download failed'});t.mock.timers.tick(500);await flush();assert(f.find('[data-market-utility-status]').textContent.includes('Download failed'));assert.equal(f.find('[data-market-builtin-install]').textContent,'Réessayer');assert.equal(f.document.activeElement,f.find('a'));assert.equal(body.scrollTop,111);
    f.click('[data-market-builtin-install]');await flush();status=quickLookStatus('installed',{downloaded:140000000});t.mock.timers.tick(500);await flush();assert.equal(f.find('[data-market-builtin-install]').textContent,'Installé');assert(f.find('[data-market-remove="quicklook"]'));assert.equal(body.scrollTop,111);const count=statusCalls;t.mock.timers.tick(5000);await flush();assert.equal(statusCalls,count,'terminal phases stop polling');
    f.click('[data-market-remove="quicklook"]');assert(f.host.textContent.includes('installation externe'));assert(!f.host.textContent.includes('retiré de Nook'));f.library.back();assert.equal(f.document.activeElement,f.find('[data-market-remove]'));f.click('[data-market-remove="quicklook"]');f.click('[data-module-remove-confirm]');await flush();assert.deepEqual(f.removed,['quicklook']);assert.equal(f.document.activeElement,f.find('.module-library-back'));assert.equal(f.find('[data-market-builtin-install]').textContent,'Obtenir');assert.equal(f.find('[data-market-remove]'),null);assert.equal(f.store.list().length,0);assert.deepEqual(f.placed,[]);
  }finally{f.library.dispose();}
});

for(const officeInstalled of [false,undefined])test('an installed QuickLook engine can complete Office when its addon status is '+officeInstalled,async()=>{
  let status=quickLookStatus('installed',{officeInstalled,officeVersion:null});
  if(officeInstalled===undefined){delete status.officeInstalled;delete status.officeVersion;}
  const f=fixture({quickLook:{nativeAvailable:true},onBuiltinStatus:async()=>status,onBuiltinInstall:async()=>status=quickLookStatus('installed')});
  try{await flush();f.library.openDetail('quicklook');const launch=f.find('[data-market-builtin-install]');assert.equal(launch.disabled,false);assert.equal(launch.textContent,'Compléter Office');assert(f.find('[data-market-utility-status]').textContent.includes('Moteur installé'));assert(!f.find('[data-market-utility-status]').textContent.includes('Prêt'));assert(f.find('[data-market-remove]'));f.language('en');assert.equal(f.find('[data-market-builtin-install]').textContent,'Enable Office preview');f.click('[data-market-builtin-install]');await flush();assert.deepEqual(f.installed,['quicklook']);assert.equal(f.find('[data-market-builtin-install]').textContent,'Installed');assert.equal(f.find('[data-market-builtin-install]').disabled,true);assert(f.find('[data-market-utility-status]').textContent.includes('Ready'));assert.equal(f.store.list().length,0);assert.deepEqual(f.placed,[]);}
  finally{f.library.dispose();}
});

test('adding Office to an installed engine disables its action only while the addon is being installed',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let status=quickLookStatus('installed',{officeInstalled:false,officeVersion:null});
  const f=fixture({quickLook:{nativeAvailable:true},onBuiltinStatus:async()=>status,onBuiltinInstall:async()=>status=quickLookStatus('downloading',{installed:true,officeInstalled:false,downloaded:7657492,total:15314985})});
  try{await flush();f.library.openDetail('quicklook');f.click('[data-market-builtin-install]');await flush();assert.equal(f.find('[data-market-builtin-install]').disabled,true);assert.equal(f.find('[data-market-builtin-install]').textContent,'Installation…');assert(f.find('[data-market-utility-status]').textContent.includes('49 %'));status=quickLookStatus('installed');t.mock.timers.tick(500);await flush();assert.equal(f.find('[data-market-builtin-install]').textContent,'Installé');assert.equal(f.find('[data-market-builtin-install]').disabled,true);}
  finally{f.library.dispose();}
});

test('QuickLook utility is disabled in a web preview and never pretends to be bundled',async()=>{
  let reads=0;const f=fixture({quickLook:{nativeAvailable:false},onBuiltinStatus:()=>{reads++;}});f.library.openDetail('quicklook');await flush();assert.equal(reads,0);assert.equal(f.find('[data-market-builtin-install]').disabled,true);assert(f.host.textContent.includes('version Windows native'));f.click('[data-market-builtin-install]');assert.deepEqual(f.installed,[]);assert.equal(f.find('.module-library-sizes'),null);f.library.dispose();
});

test('native QuickLook credits request the fixed source operation using only a module ID',async()=>{
  const calls=[],f=fixture({quickLook:{nativeAvailable:true},onBuiltinSource:async(...args)=>calls.push(args)});f.library.openDetail('quicklook');assert.equal(f.find('a').emit('click').prevented,true);await flush();assert.deepEqual(calls,[['quicklook']]);assert.equal(f.store.list().length,0);f.library.dispose();
  const web=fixture({quickLook:{nativeAvailable:false},onBuiltinSource:()=>{throw Error('Native source must not run in web preview');}});web.library.openDetail('quicklook');const link=web.find('a');assert.equal(link.href,'https://github.com/QL-Win/QuickLook/tree/4.5.0');assert.equal(link.emit('click').prevented,undefined);web.library.dispose();
});

test('an owned incomplete QuickLook module is removable before a fresh installation is offered',async()=>{
  let status=quickLookStatus('error',{removable:true,error:'Module incomplet'});
  const f=fixture({quickLook:{nativeAvailable:true},onBuiltinStatus:async()=>status,onBuiltinRemove:async()=>status=quickLookStatus(),onBuiltinInstall:async()=>quickLookStatus('downloading')});
  await flush();f.library.openDetail('quicklook');assert.equal(f.find('[data-market-builtin-install]').disabled,true);assert.equal(f.find('[data-market-builtin-install]').textContent,'Installation incomplète');assert(f.find('[data-market-utility-status]').textContent.includes('Retire le module puis réessaie.'));f.click('[data-market-builtin-install]');assert.equal(f.installed.length,0);
  f.click('[data-market-remove="quicklook"]');f.click('[data-module-remove-confirm]');await flush();assert.deepEqual(f.removed,['quicklook']);assert.equal(f.find('[data-market-builtin-install]').disabled,false);assert.equal(f.find('[data-market-builtin-install]').textContent,'Obtenir');f.library.dispose();
});

test('utility polling ignores old replies after hide, resumes on show and does not rebuild Studio drafts',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let resolve,reads=0,status=quickLookStatus('downloading');const first=new Promise(done=>resolve=done);
  const f=fixture({quickLook:{nativeAvailable:true},onBuiltinStatus:async()=>++reads===1?first:status});
  f.library.openDetail('quicklook');f.library.hide();resolve(quickLookStatus('installed'));await flush();assert.equal(f.host.hidden,true);t.mock.timers.tick(1000);assert.equal(reads,1);
  f.library.show();await flush();assert(f.find('[data-market-utility-status]').textContent.includes('Téléchargement'));f.library.back();f.click('[data-module-library-tab="studio"]');const editor=f.input('.module-library-json','Draft kept while downloading');editor.focus();const body=f.find('.module-library-body');body.scrollTop=91;status=quickLookStatus('installed');t.mock.timers.tick(500);await flush();assert.equal(f.find('.module-library-json'),editor);assert.equal(f.document.activeElement,editor);assert.equal(body.scrollTop,91);assert.equal(editor.value,'Draft kept while downloading');f.library.dispose();const count=reads;t.mock.timers.tick(5000);await flush();assert.equal(reads,count);
});

test('Market uses actual built-ins and local manifests, search and categories never invent unavailable modules',()=>{
  const f=fixture();assert.equal(f.host.querySelectorAll('[data-library-module]').length,4);assert(f.find('.module-library-featured').textContent.includes('Lecture'));
  assert(!f.host.textContent.includes('Trading'));assert(!f.host.textContent.includes('MetaTrader'));assert(!f.host.textContent.includes('AirPods'));
  f.click('[data-market-category="finance"]');assert(f.find('.module-library-empty'));assert.equal(f.host.querySelectorAll('[data-library-module]').length,0);
  f.click('[data-market-category="media"]');assert.equal(f.host.querySelectorAll('[data-library-module]').length,1);assert(f.host.textContent.includes('Musique'));
  f.click('[data-market-category="all"]');const search=f.input('[data-market-search]','taches');assert.equal(f.host.querySelectorAll('[data-library-module]').length,1);assert(f.host.textContent.includes('Tâches & Focus'));assert.equal(search.value,'taches');
  f.language('en');assert.equal(search.value,'taches');assert(f.find('.module-library-empty'));f.input('[data-market-search]','tasks');assert(f.host.textContent.includes('Tasks & Focus'));f.library.dispose();
});

test('Market empty results use Galet and release its renderer before replacement, hide and disposal',()=>{
 const created=[],f=fixture({galet:{create(host,options){const item={host,options,disposed:0,dispose(){assert(f.find('.module-library-body').contains(host),'cleanup precedes DOM replacement');this.disposed++;}};created.push(item);return item;}}});
 assert.equal(created.length,0);f.click('[data-market-category="finance"]');assert.equal(created.length,1);assert.equal(created[0].host,f.find('.module-library-empty-mimo'));assert.equal(created[0].options.active,true);assert.equal(created[0].options.scope,f.document);assert.equal(f.find('.module-library-empty').children[1].textContent,'Aucun module dans cette sélection.');
 f.click('[data-market-category="media"]');assert.equal(created[0].disposed,1);assert.equal(f.find('.module-library-empty-mimo'),null);
 f.input('[data-market-search]','does-not-exist');assert.equal(created.length,2);assert.equal(f.find('.module-library-empty').children[1].textContent,'Aucun module trouvé.');
 f.library.hide();assert.equal(created[1].disposed,1);f.library.show();assert.equal(created.length,3);f.library.dispose();assert.equal(created[2].disposed,1);f.library.dispose();assert(created.every(item=>item.disposed===1));
});

test('Market mascot follows the app motion preference and disconnects its observer when hidden',()=>{
 let changed,observed,disconnected=0;const motions=[];
 class Observer{constructor(callback){changed=callback;}observe(target,options){observed={target,options};}disconnect(){disconnected++;}}
 const f=fixture({MutationObserver:Observer,galet:{create(_host,options){motions.push(options.motion());return{dispose(){},setMotion(read){motions.push(read());}};}}});
 f.click('[data-market-category="finance"]');assert.equal(observed.target,f.document.body);assert.deepEqual(Array.from(observed.options.attributeFilter),['data-motion']);assert.deepEqual(motions,[true]);
 f.document.body.dataset.motion='false';changed();f.document.body.dataset.motion='true';changed();assert.deepEqual(motions,[true,false,true]);
 f.library.hide();assert.equal(disconnected,1);changed();assert.deepEqual(motions,[true,false,true]);f.library.dispose();assert.equal(disconnected,1);
});

test('typing multiword searches one character at a time preserves spaces and matches the complete module name',()=>{
  const f=fixture();f.language('en');
  for(const [query,id]of [['Water break','community.water'],['Tasks & Focus','focus'],['  Water break  ','community.water']]){
    const search=f.input('[data-market-search]','');let typed='';
    for(const character of query){typed+=character;f.input('[data-market-search]',search.value+character);assert.equal(search.value,typed,'Search must preserve the raw text after each input event');}
    const matches=f.host.querySelectorAll('[data-library-module]');assert.equal(matches.length,1);assert.equal(matches[0].dataset.libraryModule,id);
  }
  f.library.dispose();
});

test('module detail uses real metadata, permissions and four canonical preview sizes without installing on discovery',()=>{
  const f=fixture();f.click('[data-market-open="community.reading"]');assert.equal(f.store.list().length,0);assert.equal(f.host.dataset.marketDetail,'true');assert(f.find('.module-library-detail-main'));assert(f.find('.module-library-detail-info'));assert(f.host.textContent.includes('1.0.0'));assert(f.host.textContent.includes('aucun accès au système ou au réseau'));
  const sizes=f.find('.module-library-sizes').querySelectorAll('button');assert.equal(sizes.length,4);sizes[0].emit('click');assert.equal(f.find('.module-library-preview').dataset.size,'full');f.find('[data-module-presentation-option="side"]').emit('click');assert.equal(f.find('.module-library-preview').dataset.size,'side');f.find('[data-module-presentation-option="small"]').emit('click');assert.equal(f.find('.module-library-preview').dataset.size,'small');
  for(const control of sizes){const mark=control.querySelector('svg'),format=require('../module-contracts.js').getFormat(control.dataset.modulePresentationOption);assert.equal(mark.children.length,9);assert.equal(mark.children.filter(cell=>cell.attributes.fill==='currentColor').length,format.cols*format.rows);}
  f.library.back();assert.equal(f.host.dataset.marketDetail,'false');assert.equal(f.store.list().length,0);assert.equal(f.closed(),0);f.library.back();assert.equal(f.closed(),1);f.library.dispose();
});

test('installation waits for acknowledged persistence and prevents Back, toolbar Escape or duplicate installs while pending',async()=>{
  const writes=[],store=runtime.createStore({persist:encoded=>new Promise(resolve=>writes.push({encoded,resolve}))}),f=fixture({store});f.click('[data-market-open="community.reading"]');const confirm=f.click('[data-module-confirm]');await flush();assert.equal(writes.length,1);assert.equal(store.list().length,0);assert(f.library.isBusy());assert.equal(f.host.attributes['aria-busy'],'true');
  confirm.emit('click');f.library.back();f.key('Escape',true);assert.equal(f.closed(),0);assert(f.find('[data-module-confirm]'));assert.equal(writes.length,1);writes[0].resolve();await flush();await flush();assert.equal(store.list().length,1);assert(!f.library.isBusy());assert.equal(f.find('[data-module-library-tab="installed"]').attributes['aria-current'],'page');assert(f.host.textContent.includes('Module prêt à être placé'));f.library.dispose();
});

test('failed install preserves the explicit review and remains retryable without fabricated success',async()=>{
  let fail=true;const store=runtime.createStore({persist:async()=>{if(fail)throw Error('Disk unavailable');}}),f=fixture({store});f.click('[data-market-open="community.water"]');f.click('[data-module-confirm]');await flush();assert.equal(store.list().length,0);assert(!f.library.isBusy());assert(f.find('.module-library-status').textContent.includes('Disk unavailable'));assert(f.find('[data-module-confirm]'));
  fail=false;f.click('[data-module-confirm]');await flush();assert.equal(store.list().length,1);assert(!f.find('.module-library-status').textContent.includes('Disk unavailable'));f.library.dispose();
});

test('built-in Open dispatches only the real ID and cannot install it as a community module',async()=>{
  const f=fixture();f.click('[data-market-open="focus"]');assert.equal(f.find('[data-module-confirm]'),null);assert(f.host.textContent.includes('Données locales.'));f.click('[data-market-builtin-open="focus"]');await flush();assert.deepEqual(f.opened,['focus']);assert.equal(f.store.list().length,0);f.library.dispose();
});

test('placement requires a selected slot and explicit confirmation; cancellation leaves the layout untouched',async()=>{
  const store=runtime.createStore();store.install(runtime.catalog[0]);const f=fixture({store});f.click('[data-module-library-tab="installed"]');f.click('[data-market-open="community.reading"]');f.click('[data-market-place="community.reading"]');assert.equal(f.find('[data-module-placement-confirm]').disabled,true);f.click('[data-module-placement-confirm]');assert.deepEqual(f.placed,[]);f.click('[data-module-placement-slot="0"]');assert(f.find('[data-module-placement-confirm]').textContent.includes('Remplacer Musique par Lecture'));f.library.back();assert.deepEqual(f.placed,[]);assert(f.find('[data-market-place="community.reading"]'));
  f.click('[data-market-place="community.reading"]');f.click('[data-module-placement-slot="1"]');f.click('[data-module-placement-confirm]');await flush();assert.deepEqual(f.placed,[['community.reading',1]]);f.library.dispose();
});

test('failed placement keeps its selection and actual error instead of silently changing the scene',async()=>{
  const store=runtime.createStore();store.install(runtime.catalog[0]);const f=fixture({store,onPlace:()=>Promise.reject(Error('Placement unavailable'))});f.click('[data-market-open="community.reading"]');f.click('[data-market-place="community.reading"]');f.click('[data-module-placement-slot="2"]');f.click('[data-module-placement-confirm]');await flush();assert(f.find('.module-library-status').textContent.includes('Placement unavailable'));assert.equal(f.find('[data-module-placement-slot="2"]').attributes['aria-pressed'],'true');assert.equal(store.list().length,1);f.library.dispose();
});

test('host-denied placement is unavailable in the UI and a later denial prevents any mutation',async()=>{
  const store=runtime.createStore();store.install(runtime.catalog[0]);const before=JSON.stringify(store.snapshot());let available=true;
  const f=fixture({store,getPlacements(id){assert.equal(id,'community.reading');return[{index:0,id:'music',label:'Musique',available:false,reason:'unsupported-presentation'},{index:1,id:null,label:'',available,reason:'insufficient-space'},{index:2,id:'weather',label:'Météo',available:false,reason:{fr:'La météo ne tiendrait plus.',en:'Weather would no longer fit.'}}];}});
  f.click('[data-market-open="community.reading"]');f.click('[data-market-place="community.reading"]');
  const unsupported=f.find('[data-module-placement-slot="0"]');assert.equal(unsupported.disabled,true);assert(unsupported.textContent.includes('Format non pris en charge'));unsupported.emit('click');
  assert.equal(f.find('[data-module-placement-confirm]').disabled,true);assert.deepEqual(f.placed,[]);assert.equal(f.document.activeElement.dataset.modulePlacementSlot,'1');
  assert(f.find('[data-module-placement-slot="2"]').textContent.includes('La météo ne tiendrait plus.'));
  f.click('[data-module-placement-slot="1"]');assert.equal(f.find('[data-module-placement-confirm]').disabled,false);available=false;
  f.click('[data-module-placement-confirm]');await flush();assert.deepEqual(f.placed,[]);assert.equal(JSON.stringify(store.snapshot()),before);assert.equal(f.find('[data-module-placement-confirm]').disabled,true);assert(f.find('.module-library-status').textContent.includes('Espace insuffisant'));assert(f.find('[data-module-placement-slot="1"]'));assert.equal(f.document.activeElement.dataset.modulePlacementCancel,'');
  f.library.back();assert(f.find('[data-market-place="community.reading"]'));assert.equal(JSON.stringify(store.snapshot()),before);f.library.dispose();
});

test('remove is confirmed separately, Back preserves module data, and explicit removal returns to the catalog',async()=>{
  const store=runtime.createStore();store.install(runtime.catalog[0]);store.performAction('community.reading','advance');const f=fixture({store});f.click('[data-market-open="community.reading"]');f.click('[data-market-remove="community.reading"]');assert.equal(store.get('community.reading').state.completed,1);f.library.back();assert.equal(store.get('community.reading').state.completed,1);f.click('[data-market-remove="community.reading"]');f.click('[data-module-remove-confirm]');await flush();assert.equal(store.get('community.reading'),null);assert.equal(f.host.dataset.marketDetail,'false');f.library.dispose();
});

test('Studio blank island and preview actions stay isolated from installed module state',()=>{
  const store=runtime.createStore();store.install(runtime.catalog[0]);store.performAction('community.reading','advance');const f=fixture({store}),before=JSON.stringify(store.snapshot());f.click('[data-module-library-tab="studio"]');f.click('[data-module-sandbox="open"]');assert(f.find('[data-module-sandbox-frame]'));f.click('[data-module-sandbox="example"]');f.click('[data-module-action="advance"]');assert.equal(JSON.stringify(store.snapshot()),before);f.click('[data-module-sandbox="back"]');assert(f.find('.module-library-json'));assert.equal(JSON.stringify(store.snapshot()),before);f.library.dispose();
});

test('Studio retains an uncommitted runtime text draft through hidden formats, locale and unrelated real actions',()=>{
  const f=fixture(),before=JSON.stringify(f.store.snapshot());f.click('[data-module-library-tab="studio"]');f.click('[data-module-sandbox="open"]');f.click('[data-module-sandbox="example"]');
  const frame=f.find('[data-module-sandbox-frame]');f.input('[data-module-field="title"]','Uncommitted Studio title');
  f.click('[data-module-presentation-option="small"]');assert.equal(f.find('[data-module-field="title"]'),null);assert.equal(f.find('[data-module-sandbox-frame]'),frame);
  f.click('[data-module-action="advance"]');f.language('en');f.click('[data-module-presentation-option="full"]');
  assert.equal(f.find('[data-module-sandbox-frame]'),frame);assert.equal(f.find('[data-module-field="title"]').value,'Uncommitted Studio title');assert(f.find('[data-module-sandbox-frame]').textContent.includes('1 / 12'));
  assert.equal(JSON.stringify(f.store.snapshot()),before,'the installed registry is never a draft store');f.click('[data-module-sandbox="back"]');f.click('[data-module-sandbox="open"]');f.click('[data-module-sandbox="example"]');
  assert.equal(f.find('[data-module-field="title"]').value,'','a newly requested blank island is a new isolated session');f.library.dispose();
});

test('a main-only community module remains previewable while unsupported presentations stay disabled',()=>{
  const manifest=JSON.parse(JSON.stringify(runtime.catalog[0]));manifest.layout={main:{min:{width:240,height:180},ideal:{width:356,height:260}}};
  const store=runtime.createStore();store.install(manifest);store.performAction(manifest.id,'advance');const before=JSON.stringify(store.snapshot()),f=fixture({store});
  assert.equal(f.find('.module-library-featured-preview').children[0].dataset.modulePresentation,'main');
  f.click('[data-market-open="community.reading"]');assert.equal(f.find('.module-library-preview').dataset.size,'main');assert(f.find('.module-library-facts').textContent.includes('1 format adaptatif'));
  for(const size of ['full','side','small']){const control=f.find(`[data-module-presentation-option="${size}"]`);assert.equal(control.disabled,true);control.emit('click');assert.equal(f.find('.module-library-preview').dataset.size,'main');}
  f.click('[data-module-presentation-option="main"]');assert.equal(f.document.activeElement.dataset.modulePresentationOption,'main');assert.equal(JSON.stringify(store.snapshot()),before);
  f.library.back();assert.equal(JSON.stringify(store.snapshot()),before);f.library.dispose();
});

test('Studio tests a main-only draft with real actions and restores the unchanged editor on Back',()=>{
  const manifest=JSON.parse(JSON.stringify(runtime.catalog[0]));manifest.layout={main:{min:{width:240,height:180},ideal:{width:356,height:260}}};
  const store=runtime.createStore();store.install(runtime.catalog[1]);const before=JSON.stringify(store.snapshot()),f=fixture({store}),draft=JSON.stringify(manifest,null,2);
  f.click('[data-module-library-tab="studio"]');f.input('.module-library-json',draft);f.click('[data-module-sandbox="open"]');f.click('[data-module-sandbox="example"]');
  assert.equal(f.find('[data-module-sandbox-frame]').dataset.size,'main');assert.equal(f.find('[data-module-presentation-option="small"]').disabled,true);
  f.click('[data-module-action="advance"]');assert(f.find('[data-module-sandbox-frame]').textContent.includes('1 / 12'));assert.equal(f.document.activeElement.dataset.moduleAction,'advance');
  f.click('[data-module-sandbox="back"]');assert.equal(f.find('.module-library-json').value,draft);assert.equal(f.document.activeElement.dataset.moduleSandbox,'open');assert.equal(JSON.stringify(store.snapshot()),before);f.library.dispose();
});

test('JSON import enforces byte caps and parsing, ignores a late read after closing, and never executes imported content',async()=>{
  const f=fixture(),file=f.find('input');assert.equal(file.type,'file');file.files=[{size:runtime.limits.manifestBytes+1,text:async()=>{assert.fail('Oversized data must not be read');}}];file.emit('change');await flush();assert(f.find('.module-library-status').textContent.includes('limite'));assert.equal(f.store.list().length,0);
  file.files=[{size:2,text:async()=>'{!'}];file.emit('change');await flush();assert.equal(f.store.list().length,0);assert(f.find('.module-library-status').textContent.startsWith('Impossible'));
  let release;file.files=[{size:2,text:()=>new Promise(resolve=>{release=resolve;})}];file.emit('change');f.library.hide();release(JSON.stringify(runtime.catalog[0]));await flush();assert.equal(f.store.list().length,0);assert.equal(f.library.isOpen(),false);f.library.show();assert.equal(f.host.dataset.marketDetail,'false');f.library.dispose();
});

test('external Market toolbar follows visibility and disposes its listeners with the library',()=>{
  const f=fixture(),head=f.toolbar.querySelector('header'),oldBack=f.find('.module-library-back');assert.equal(head.hidden,false);f.library.hide();assert.equal(head.hidden,true);f.library.show();assert.equal(head.hidden,false);f.key('Escape',true);assert.equal(f.closed(),1);f.library.dispose();assert.equal(f.toolbar.childElementCount,0);oldBack.emit('click');assert.equal(f.closed(),1);f.library.show();assert.equal(f.library.isOpen(),false);
});

test('a valid imported module is text-only and still requires explicit installation; executable permissions remain rejected',async()=>{
  const f=fixture(),file=f.find('input'),manifest=JSON.parse(JSON.stringify(runtime.catalog[0]));manifest.id='community.safe-import';manifest.name.fr='<img src=x onerror=alert(1)>';
  const encoded=JSON.stringify(manifest);file.files=[{size:Buffer.byteLength(encoded),text:async()=>encoded}];file.emit('change');await flush();const title=f.find('.module-library-detail-title');assert.equal(title.textContent,manifest.name.fr);assert.equal(title.childElementCount,0);assert.equal(f.store.list().length,0);assert(f.find('[data-module-confirm]'));
  manifest.permissions=['filesystem'];const rejected=JSON.stringify(manifest);file.files=[{size:Buffer.byteLength(rejected),text:async()=>rejected}];file.emit('change');await flush();assert.equal(f.store.list().length,0);assert(f.find('.module-library-status').textContent.startsWith('Impossible'));assert.equal(f.find('.module-library-detail-title').textContent,manifest.name.fr);f.library.dispose();
});

test('imported upgrades keep saved module progress and do not replace it before Update is confirmed',async()=>{
  const store=runtime.createStore();store.install(runtime.catalog[0]);store.performAction('community.reading','advance');const f=fixture({store}),file=f.find('input'),manifest=JSON.parse(JSON.stringify(runtime.catalog[0]));manifest.version='1.0.1';const encoded=JSON.stringify(manifest);file.files=[{size:Buffer.byteLength(encoded),text:async()=>encoded}];file.emit('change');await flush();assert.equal(store.get(manifest.id).manifest.version,'1.0.0');assert.equal(f.find('[data-module-confirm]').textContent,'Mettre à jour');f.click('[data-module-confirm]');await flush();assert.equal(store.get(manifest.id).manifest.version,'1.0.1');assert.equal(store.get(manifest.id).state.completed,1);f.library.dispose();
});

test('disabled bundled modules remain available in the catalog, use Installer and wait for acknowledged activation',async()=>{
  let release;const f=fixture({focusInstalled:false,onBuiltinInstall:()=>new Promise(resolve=>{release=resolve;})});assert.equal(f.find('[data-market-open="focus"]').textContent,'Installer');f.click('[data-module-library-tab="installed"]');assert.equal(f.find('[data-market-open="focus"]'),null);f.click('[data-module-library-tab="discover"]');f.click('[data-market-open="focus"]');assert.equal(f.find('[data-market-builtin-open]'),null);const confirm=f.click('[data-market-builtin-install="focus"]');assert(f.library.isBusy());assert.deepEqual(f.installed,['focus']);assert.equal(f.store.list().length,0);confirm.emit('click');f.key('Escape',true);assert.equal(f.closed(),0);assert.deepEqual(f.installed,['focus']);release();await flush();assert(!f.library.isBusy());assert.equal(f.host.dataset.marketDetail,'false');assert(f.find('[data-market-open="focus"]').textContent.includes('Installé'));assert.equal(f.store.list().length,0);f.click('[data-module-library-tab="installed"]');assert(f.find('[data-market-open="focus"]'));f.library.dispose();
});

test('a rejected bundled installation retains its review and real disabled status until a successful retry',async()=>{
  let failing=true;const f=fixture({focusInstalled:false,onBuiltinInstall:async()=>{if(failing)throw Error('Native settings unavailable');}});f.click('[data-market-open="focus"]');f.click('[data-market-builtin-install="focus"]');await flush();assert(f.find('.module-library-status').textContent.includes('Native settings unavailable'));assert(f.find('[data-market-builtin-install="focus"]'));assert.equal(f.find('[data-market-remove="focus"]'),null);failing=false;f.click('[data-market-builtin-install="focus"]');await flush();assert(f.find('[data-market-open="focus"]').textContent.includes('Installé'));assert.equal(f.store.list().length,0);f.library.dispose();
});

test('bundled removal is a separate confirmation and preserves module data when cancelled or applied',async()=>{
  const store=runtime.createStore();store.install(runtime.catalog[0]);store.performAction('community.reading','advance');const original=JSON.stringify(store.snapshot()),f=fixture({store});f.click('[data-market-open="focus"]');f.click('[data-market-remove="focus"]');assert(f.host.textContent.includes('Ses réglages et ses données restent'));assert.deepEqual(f.removed,[]);f.library.back();assert.deepEqual(f.removed,[]);assert(f.find('[data-market-builtin-open="focus"]'));f.click('[data-market-remove="focus"]');f.click('[data-module-remove-confirm]');await flush();assert.deepEqual(f.removed,['focus']);assert.equal(f.host.dataset.marketDetail,'false');assert.equal(f.find('[data-market-open="focus"]').textContent,'Installer');assert.equal(JSON.stringify(store.snapshot()),original);f.click('[data-module-library-tab="installed"]');assert.equal(f.find('[data-market-open="focus"]'),null);f.click('[data-module-library-tab="discover"]');f.click('[data-market-open="focus"]');f.click('[data-market-builtin-install="focus"]');await flush();assert.equal(JSON.stringify(store.snapshot()),original);assert(f.find('[data-market-open="focus"]').textContent.includes('Installé'));f.library.dispose();
});

test('failed bundled removal keeps the confirmation retryable and never claims the module was removed',async()=>{
  let failing=true;const f=fixture({onBuiltinRemove:async()=>{if(failing)throw Error('Profile write failed');}});f.click('[data-market-open="focus"]');f.click('[data-market-remove="focus"]');f.click('[data-module-remove-confirm]');await flush();assert(f.find('.module-library-status').textContent.includes('Profile write failed'));assert(f.find('[data-module-remove-confirm]'));assert(!f.library.isBusy());f.library.back();assert(f.find('[data-market-builtin-open="focus"]'));failing=false;f.click('[data-market-remove="focus"]');f.click('[data-module-remove-confirm]');await flush();assert.equal(f.find('[data-market-open="focus"]').textContent,'Installer');f.library.dispose();
});

test('detail keeps both black preview tiles backed by actual local fields or built-in feature metadata',()=>{
  const store=runtime.createStore();store.install(runtime.catalog[0]);store.performAction('community.reading','advance');const f=fixture({store});f.click('[data-market-open="community.reading"]');const previews=f.find('.module-library-detail-previews');assert.equal(previews.childElementCount,2);const summary=f.find('.module-library-detail-summary');assert(summary.textContent.includes('Chapitres lus1'));assert(summary.textContent.includes('Objectif de chapitres12'));assert(!summary.textContent.includes('+335'));f.library.back();f.click('[data-market-open="focus"]');assert.equal(f.find('.module-library-detail-previews').childElementCount,2);assert(f.find('.module-library-detail-summary').textContent.includes('Minuteur'));assert(f.find('.module-library-detail-summary').textContent.includes('Progression conservée'));f.library.dispose();
});


test('opening a bottom card starts its detail at the top and Back reveals that same card before restoring focus',()=>{
  const f=fixture({cardOffsets:{music:{top:420,bottom:540}}}),body=f.find('.module-library-body');
  body.scrollTop=380;f.click('[data-market-open="music"]');assert.equal(body.scrollTop,0);assert(f.find('.module-library-detail-title'));
  body.scrollTop=90;f.library.back();
  const card=f.find('[data-library-module="music"]');assert.equal(f.scrollRequests.at(-1).node,card);assert.equal(JSON.stringify(f.scrollRequests.at(-1).options),JSON.stringify({block:'nearest',inline:'nearest',behavior:'instant'}));
  assert.equal(body.scrollTop,340,'the returned bottom card is fully inside the 200px viewport');assert(card.contains(f.document.activeElement));assert.equal(f.document.activeElement.lastFocusOptions.preventScroll,true);f.library.dispose();
});

test('new community and tab routes reset scrolling while preview changes, locale refresh and Studio typing keep the current position',()=>{
  const f=fixture(),body=f.find('.module-library-body');body.scrollTop=270;f.click('[data-market-open="community.reading"]');assert.equal(body.scrollTop,0);
  body.scrollTop=67;f.click('[data-module-presentation-option="side"]');assert.equal(body.scrollTop,67);f.language('en');assert.equal(body.scrollTop,67);
  f.library.back();body.scrollTop=180;f.click('[data-module-library-tab="studio"]');assert.equal(body.scrollTop,0);
  body.scrollTop=75;f.input('.module-library-json','Uncommitted manifest draft');assert.equal(body.scrollTop,75);f.language('fr');assert.equal(body.scrollTop,75);assert.equal(f.find('.module-library-json').value,'Uncommitted manifest draft');
  f.library.hide();body.scrollTop=100;f.library.show();assert.equal(body.scrollTop,0);assert.equal(f.find('.module-library-json').value,'Uncommitted manifest draft');f.library.dispose();
});
