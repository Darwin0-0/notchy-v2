'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Layout=require('../module-contracts.js');
const Modules=require('../module-runtime.js');
const source=fs.readFileSync(require.resolve('../notch.js'),'utf8');
function section(name,next){const start=source.indexOf('  function '+name+'('),end=source.indexOf('  function '+next+'(',start);assert(start>=0&&end>start);return source.slice(start,end);}
class Node{
  constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.style={cssText:'',values:{},setProperty(name,value){this.values[name]=value;}};this.hidden=false;this.inert=false;this.textContent='';this.replacements=0;this.classList={add:name=>{this.className=[...new Set((this.className||'').split(' ').filter(Boolean).concat(name))].join(' ');},remove:name=>{this.className=(this.className||'').split(' ').filter(value=>value!==name).join(' ');},contains:name=>(this.className||'').split(' ').includes(name)};}
  append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}
  replaceChildren(...nodes){this.replacements++;this.children=[];this.append(...nodes);}
  setAttribute(name,value){this.attributes[name]=String(value);}
}
function card(){
  const value=new Node('article');value.className='activity-card activity-card-secondary activity-module-summary';value.dataset.activity='shelf';
  const selectors=['.activity-card-status-label','.activity-card-title','.activity-card-detail','.activity-card-value','.activity-card-ring','.activity-card-progress','.activity-card-times','.activity-card-completion','img','.activity-card-art','.activity-promote','.activity-module-preview','.activity-card-action'];
  const parts=Object.fromEntries(selectors.map(selector=>[selector,new Node(selector==='img'?'img':'span')]));
  const arrow=new Node('path');parts['.activity-card-action'].querySelector=selector=>{assert.equal(selector,'path');return arrow;};
  value.querySelector=selector=>{assert(parts[selector],'the real summary selector exists: '+selector);return parts[selector];};
  value.cloneNode=deep=>{assert.equal(deep,true);return card();};value.parts=parts;value.arrow=arrow;return value;
}
function fixture({loaded=true,items=[],error=''}={}){
  const cached=card(),compact=card(),assignments=[],scope={communityStore:{get:()=>null},ModuleLayout:Layout,homeLayout:{items:[{id:'shelf',fits:false}]},communityCards:new Map(),activityCards:new Map([['shelf',cached]]),shelfItems:items,shelfLoaded:loaded,shelfError:error,
    t:value=>value,localSendCount:value=>value+' files',text:(node,value)=>{node.textContent=String(value);},document:{createElement:tag=>new Node(tag)},
    usesCompactSummary(id,assignment){assignments.push(assignment);return assignment?.fits===false;},compactModuleCard:()=>compact,
    byId(){assert.fail('Shelf preview cannot clone the Tray route');},modulePreview(){assert.fail('Shelf must use its real Nook summary');},focusComponent:{renderPreview(){assert.fail('Shelf preview cannot create a timer');}}};
  vm.runInNewContext(section('activitySummaryCard','renderShelfSummaryContents')+section('renderShelfSummaryContents','renderActivitySceneValues')+section('renderEditorPreview','renderModules')+'this.api={activitySummaryCard,renderShelfSummaryContents,renderEditorPreview};',scope);
  const host=()=>{const node=new Node();node.attachShadow=()=>{node.shadowRoot=new Node('shadow');return node.shadowRoot;};return node;};
  return {scope,api:scope.api,cached,compact,assignments,host};
}
function walk(node,predicate){if(predicate(node))return node;for(const child of node.children){const found=walk(child,predicate);if(found)return found;}return null;}

test('a new Shelf summary renders real loaded, empty, loading and error values without generic progress artifacts',()=>{
  const items=[{id:'a',name:'<img src=x onerror=alert(1)>.png'},{id:'b',name:'Second.pdf'},{id:'c',name:'Third.txt'},{id:'d',name:'Fourth.jpg'}],before=structuredClone(items),f=fixture({items}),summary=card();
  f.api.renderShelfSummaryContents(summary);
  assert.equal(summary.parts['.activity-card-title'].textContent,'Étagère');assert.equal(summary.parts['.activity-card-value'].textContent,'4 files');assert.equal(summary.parts['.activity-card-detail'].textContent,items[0].name);
  assert.deepEqual(summary.parts['.activity-module-preview'].children.map(node=>node.textContent),items.slice(0,3).map(item=>item.name));
  assert(summary.parts['.activity-module-preview'].children.every(node=>node.tagName==='span'&&node.children.length===0),'filenames are text, never rendered HTML');
  for(const selector of ['.activity-card-ring','.activity-card-progress','.activity-card-times','.activity-card-completion','img'])assert.equal(summary.parts[selector].hidden,true);
  assert.equal(summary.parts['.activity-card-art'].hidden,false);assert.equal(summary.parts['.activity-card-action'].dataset.sceneCommand,'shelf-open');assert.equal(summary.parts['.activity-card-action'].disabled,false);
  const children=[...summary.parts['.activity-module-preview'].children],replacements=summary.parts['.activity-module-preview'].replacements;f.api.renderShelfSummaryContents(summary);
  assert.equal(summary.parts['.activity-module-preview'].replacements,replacements);assert.equal(summary.parts['.activity-module-preview'].children[0],children[0],'unchanged values preserve file preview identity');assert.deepEqual(items,before);
  f.scope.shelfLoaded=false;f.api.renderShelfSummaryContents(summary);assert.equal(summary.parts['.activity-card-value'].textContent,'—');assert.equal(summary.parts['.activity-card-detail'].textContent,'Chargement…');
  f.scope.shelfLoaded=true;f.scope.shelfItems=[];f.api.renderShelfSummaryContents(summary);assert.equal(summary.parts['.activity-card-value'].textContent,'0 files');assert.equal(summary.parts['.activity-card-detail'].textContent,'Déposer des fichiers');assert.equal(summary.parts['.activity-module-preview'].children.length,0);
  f.scope.shelfError='The file cache is unavailable';f.api.renderShelfSummaryContents(summary);assert.equal(summary.parts['.activity-card-detail'].textContent,f.scope.shelfError);
});

test('editor snapshots use the same real Shelf summary in Full, Main, Side and Small without moving its live host or starting services',()=>{
  for(const presentation of ['full','main','side','small']){
    const items=[{id:'actual',name:'Existing report.pdf'}],f=fixture({items}),format=Layout.getFormat(presentation),assignment={id:'shelf',presentation,legacyPresentation:Layout.legacyPresentation(presentation),slot:'main',fits:true,width:format.width,height:format.height},host=f.host();
    assert.equal(f.api.activitySummaryCard('shelf'),f.compact,'the fixture includes an incompatible previous home placement');
    const previousCached=JSON.stringify({dataset:f.cached.dataset,parts:Object.fromEntries(Object.entries(f.cached.parts).map(([name,node])=>[name,node.textContent]))});
    const dispose=f.api.renderEditorPreview(host,assignment);assert.equal(host.inert,true);assert.equal(f.assignments.at(-1),assignment,'the requested valid editor format overrides stale home layout');
    const copy=walk(host.shadowRoot,node=>node!==f.cached&&node.className?.includes('activity-module-summary'));assert(copy);assert.equal(copy.inert,true);assert.equal(copy.hidden,false);assert.equal(copy.dataset.modulePresentation,presentation);assert.equal(copy.parts['.activity-card-value'].textContent,'1 files');assert.equal(copy.parts['.activity-module-preview'].children[0].textContent,'Existing report.pdf');
    assert.equal(copy.parentNode.className,'activity-main activity-card');assert.equal(copy.parentNode.parentNode.className,'activity-stage');assert.equal(copy.parentNode.parentNode.dataset.slotEngine,'1');assert.equal(copy.parentNode.parentNode.parentNode.id,'nook-layout');
    assert.equal(copy.parentNode.style.values['--slot-x'],'0px');assert.equal(copy.parentNode.style.values['--slot-y'],'0px');assert.equal(copy.parentNode.style.values['--slot-width'],'100%');assert.equal(copy.parentNode.style.values['--slot-height'],'100%');
    assert.equal(copy.style.values['--module-padding'],presentation==='small'?'16px':presentation==='side'?'20px':'24px');
    assert.equal(JSON.stringify({dataset:f.cached.dataset,parts:Object.fromEntries(Object.entries(f.cached.parts).map(([name,node])=>[name,node.textContent]))}),previousCached,'rendering a snapshot does not mutate the live source');assert.equal(f.cached.parentNode,undefined);assert.deepEqual(items,[{id:'actual',name:'Existing report.pdf'}]);
    dispose();assert.equal(host.shadowRoot.children.length,0,'disposing a snapshot removes its shadow content');
  }
});


test('community editor snapshots delegate their real manifest and state to the common inert renderer without saving actions',()=>{
  for(const manifest of Modules.catalog){
    const store=Modules.createStore();store.install(manifest);const initial=JSON.stringify(store.snapshot()),f=fixture(),host=f.host(),calls=[];let disposed=0;
    f.scope.communityStore=store;f.scope.i18n={locale:()=> 'en'};
    f.scope.window={NotchyModules:{render(node,actualManifest,state,options){calls.push({node,manifest:actualManifest,state,options});return()=>{disposed++;};}}};
    const assignment={id:manifest.id,presentation:'tall',legacyPresentation:'scene',slot:'side',fits:true,width:260,height:240},cleanup=f.api.renderEditorPreview(host,assignment),call=calls[0];
    assert.equal(calls.length,1);assert.equal(call.node,host);assert.equal(host.inert,true);assert(host.classList.contains('community-module-host'));
    assert.equal(call.manifest.name.en,manifest.name.en);assert.equal(call.manifest.id,manifest.id);assert.equal(call.options.presentation,'tall');assert.equal(call.options.language,'en');assert.deepEqual(call.state,store.get(manifest.id).state);
    for(const action of manifest.actions)call.options.onAction(action.id,1);assert.equal(JSON.stringify(store.snapshot()),initial,'the preview action dispatcher never changes community state');
    cleanup();assert.equal(disposed,1);assert.equal(host.classList.contains('community-module-host'),false);assert.equal(JSON.stringify(store.snapshot()),initial);
  }
});
