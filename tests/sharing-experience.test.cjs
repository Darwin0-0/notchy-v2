'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {normalizeSharingFiles, sharingDeviceList, manualIPv4, sharingSelection, create} = require('../sharing-experience.js');

test('file actions require explicit true capabilities and never infer permission from a filename', () => {
  const source = [{id:'one',name:'image.png',size:12,canOcr:true,canSend:'true'}, {id:'two',name:'report.pdf',canConvert:1}, {id:'one',name:'duplicate'}, {name:'missing id'}, null];
  const before = structuredClone(source), files = normalizeSharingFiles(source);
  assert.equal(files.length,2); assert.equal(files[0].canOcr,true); assert.equal(files[0].canSend,false); assert.equal(files[1].canOcr,false); assert.equal(files[1].canConvert,false); assert.equal(files[1].size,null); assert.deepEqual(source,before);
  assert.deepEqual(sharingSelection(files,['two','two','gone']).map(item => item.id),['two']);
});

test('favorite identity is stable, sorted first, and an absent device remains truthfully offline', () => {
  const peers = [{id:'new',alias:'Nearby'}, {id:'usual',alias:'Current name',deviceType:'mobile'}, {id:'new',alias:'Duplicate'}, {id:'gone',alias:'Reported offline',online:false}];
  const favorites = [{id:'usual',alias:'Old name'}, {id:'absent',alias:'Saved laptop'}, 'usual'];
  const before = structuredClone({peers,favorites}), devices = sharingDeviceList({peers,favorites});
  assert.deepEqual(devices.map(item => item.id),['usual','offline:absent','new','gone']);
  assert.equal(devices[0].alias,'Current name'); assert.equal(devices[0].online,true); assert.equal(devices[1].online,false); assert.equal(devices[3].online,false);
  assert.equal(devices[1].favorite,true); assert.equal(devices[2].favorite,false); assert.deepEqual({peers,favorites},before);
});

test('manual IP accepts private or link-local canonical IPv4 with an optional valid port', () => {
  for (const address of ['192.168.1.20','10.2.3.4','172.16.0.1','172.31.255.254','169.254.1.2','192.168.1.20:53317','10.2.3.4:1','169.254.1.2:65535']) assert.equal(manualIPv4(' '+address+' '),address);
  for (const address of ['',null,'device.local','http://192.168.1.20','192.168.01.20','256.1.1.1','192.168.1','0.1.2.3','224.1.2.3','255.255.255.255','1e2.1.2.3','::1','8.8.8.8','127.0.0.1','172.15.1.2','172.32.1.2','192.167.1.2','169.253.1.2','100.64.1.2','192.168.1.20:0','192.168.1.20:65536','192.168.1.20:01','192.168.1.20:','192.168.1.20:80:90','192.168.1.20:+80']) assert.equal(manualIPv4(address),null,address);
});

function fixture() {
  const document = {activeElement:null};
  class Element {
    constructor(tag) {this.tagName=tag; this.nodeType=1; this.localName=tag; this.ownerDocument=document; this.children=[]; this.dataset={}; this.attributes={}; this.style={setProperty(key,value){this[key]=value;}}; this.listeners={}; this.className=''; this._text=''; this.value=''; this.classList={add:value=>{this.className+=' '+value;},contains:value=>this.className.split(/\s+/).includes(value),remove:value=>{this.className=this.className.split(/\s+/).filter(item=>item!==value).join(' ');}};}
    set textContent(value) {this._text=String(value); for(const child of this.children)child.parentElement=null; this.children=[];}
    get textContent() {return this._text+this.children.map(child=>child.textContent).join('');}
    setAttribute(key,value) {this.attributes[key]=String(value);}
    removeAttribute(key) {delete this.attributes[key];}
    append(...nodes) {for(const node of nodes){node.remove(); node.parentElement=this; this.children.push(node);}}
    insertBefore(node,before) {node.remove(); node.parentElement=this; const index=this.children.indexOf(before); this.children.splice(index<0?this.children.length:index,0,node);}
    replaceChildren(...nodes) {this.textContent=''; this.append(...nodes);}
    remove() {if(this.parentElement){const list=this.parentElement.children; list.splice(list.indexOf(this),1); this.parentElement=null;}}
    contains(node) {return this===node||this.children.some(child=>child.contains(node));}
    closest() {return this.dataset.sharingCommand?this:this.parentElement?.closest();}
    addEventListener(name,callback) {this.listeners[name]=callback;}
    removeEventListener(name,callback) {if(this.listeners[name]===callback)delete this.listeners[name];}
    focus() {if(!this.disabled)document.activeElement=this;}
    get firstChild() {return this.children[0];}
    get childNodes() {return this.children;}
    get isConnected() {return document.body.contains(this);}
  }
  document.createElement=tag=>new Element(tag); document.createElementNS=(namespace,tag)=>Object.assign(new Element(tag),{namespaceURI:namespace}); document.body=new Element('body');
  const host=new Element('section'); document.body.append(host);
  const all=(node,predicate)=>[...(predicate(node)?[node]:[]),...node.children.flatMap(child=>all(child,predicate))];
  const find=predicate=>all(host,predicate)[0];
  const command=(name,other=()=>true)=>find(node=>node.dataset.sharingCommand===name&&other(node));
  const click=node=>host.listeners.click?.({target:node});
  return {document,host,all,find,command,click};
}
function characterFixture() {
  const f=fixture(),characters=[];
  f.document.defaultView={NotchyGalet:{states:['idle','searching','finished','error','question','working','share-request','approval','receiving','received'],variants:{default:{},shelf:{},sharing:{}},create(host,options){
    const character={host,variant:options.variant,changes:[],disposed:false,setVariant(value){this.variant=value;},setState(value){this.state=value;this.changes.push(value);host.dataset.galetState=value;},dispose(){this.disposed=true;}};
    characters.push(character); return character;
  }}};
  return {...f,characters};
}
const file = (id,extra={}) => ({id,name:id+'.png',canOcr:true,canConvert:true,canSend:true,canOpen:true,canDownload:true,canRemove:true,...extra});
const settle = () => new Promise(resolve => setImmediate(resolve));
function shelfKey(f, target, key, extra={}) {
  const event={target,key,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...extra};
  f.host.listeners.keydown(event); return event;
}

for(const extension of ['html','htm'])test('Shelf integrated '+extension+' preview stays in its source through navigation and close without QuickLook',async()=>{
  const f=fixture(),calls=[],actions=[];let market=0;
  const component=create({...f,onGetQuickLook:()=>{market++;},onAction:(command,payload)=>actions.push({command,payload}),invoke:async(command,args)=>{calls.push([command,args]);return command==='search_status'?{quickLook:{supported:true,available:false,previewVisible:false},renderedPreview:{supported:true,visible:true}}:{};}});
  try{
    component.render({files:[file('first',{name:'first.'+extension,canPreview:true}),file('second',{name:'second.'+extension.toUpperCase(),canPreview:true})],selectedIds:['first']});const row=id=>f.command('select',node=>node.dataset.sharingFile===id);
    assert.equal(shelfKey(f,row('first'),' ').defaultPrevented,true);await settle();assert.equal(component.previewTarget(),'first');assert.deepEqual(calls.filter(call=>call[0]==='shelf_preview'),[['shelf_preview',{id:'first'}]]);assert.equal(market,0);
    const previewControl=f.document.createElement('button');f.document.body.append(previewControl);previewControl.focus();
    assert.equal(component.navigatePreview(1),true);assert.equal(f.document.activeElement===previewControl,true,'Navigation keeps the reader focused while the next preview loads');await settle();assert.equal(component.previewTarget(),'second');assert.equal(f.document.activeElement===previewControl,true);assert.equal(row('second').attributes['aria-pressed'],'true');assert.deepEqual(actions.at(-1),{command:'select',payload:{id:'second',selected:true,selectedIds:['second']}});
    const sent=calls.filter(call=>call[0]==='shelf_preview').length;assert.equal(component.navigatePreview(1),true);await settle();assert.equal(f.document.activeElement===previewControl,true,'The final document cannot move focus behind the reader');assert.equal(calls.filter(call=>call[0]==='shelf_preview').length,sent);
    assert.equal(component.navigatePreview(-1),true);await settle();assert.equal(component.previewTarget(),'first');assert.equal(f.document.activeElement===previewControl,true);assert.equal(component.navigatePreview(-1),true);assert.equal(f.document.activeElement===previewControl,true);assert.equal(component.navigatePreview(5),false);
    component.stopPreview();await settle();assert.equal(component.previewTarget(),null);assert.equal(component.navigatePreview(1),false);assert.equal(row('first').attributes['aria-pressed'],'true');assert.deepEqual(calls.at(-1),['shelf_preview_close',{}]);assert.equal(market,0);assert.equal(f.command('get-quicklook').hidden,true);assert.equal(calls.some(call=>['search_quicklook_install','shelf_open'].includes(call[0])),false);
  }finally{component.dispose();}
});

test('Shelf integrated preview failures expose neutral feedback without a QuickLook Market action',async()=>{
  const f=fixture();let market=0;
  const component=create({...f,onGetQuickLook:()=>{market++;},invoke:async command=>{if(command==='search_status')return {quickLook:{available:false},renderedPreview:{supported:true}};throw Error('COM absent C:\\private\\secret '+ 'x'.repeat(1000));}});
  component.render({files:[file('one',{name:'document.html',canPreview:true})],selectedIds:['one']});shelfKey(f,f.command('select'),' ');await settle();assert.equal(component.previewTarget(),null);assert.equal(f.find(node=>node.className==='sharing-file-status').textContent,'Aperçu indisponible.');assert.equal(f.command('get-quicklook').hidden,true);f.click(f.command('get-quicklook'));assert.equal(market,0);assert(!f.host.textContent.includes('secret'));component.dispose();
});

test('Shelf tracks integrated viewer visibility independently of an absent QuickLook viewer',async t=>{
  t.mock.timers.enable({apis:['setInterval']});const f=fixture();let visible=true;
  const component=create({...f,onGetQuickLook:()=>{throw Error('Integrated formats must not open Market');},invoke:async command=>command==='search_status'?{quickLook:{available:false,previewVisible:false},renderedPreview:{supported:true,visible}}:{}});
  component.render({files:[file('one',{name:'document.html',canPreview:true})],selectedIds:['one']});shelfKey(f,f.command('select'),' ');await settle();t.mock.timers.tick(1000);await settle();assert.equal(component.previewTarget(),'one');visible=false;t.mock.timers.tick(1000);await settle();assert.equal(component.previewTarget(),null);assert.equal(f.command('select').attributes['aria-pressed'],'true');component.dispose();
});

for(const extension of ['docx','pptx','xlsx']){
  test('Shelf Office '+extension+' opens Market when QuickLook is absent despite the HTML reader being available',async()=>{
    const f=fixture(),calls=[];let market=0;
    const component=create({...f,onGetQuickLook:()=>{market++;},invoke:async(command,args)=>{calls.push([command,args]);return {quickLook:{supported:true,available:false},renderedPreview:{supported:true,visible:true}};}});
    try{component.render({files:[file('office',{name:'report.'+extension,canPreview:true})],selectedIds:['office']});assert.equal(shelfKey(f,f.command('select'),' ').defaultPrevented,true);await settle();assert.equal(market,1);assert.equal(component.isPreviewing(),false);assert.equal(f.command('select').attributes['aria-pressed'],'true');assert.deepEqual(calls,[['search_status',{}]]);}
    finally{component.dispose();}
  });
  test('Shelf Office '+extension+' follows QuickLook visibility and preserves keyboard navigation and selection',async t=>{
    t.mock.timers.enable({apis:['setInterval']});const f=fixture(),calls=[],actions=[];let visible=true;
    const component=create({...f,onGetQuickLook:()=>{throw Error('Installed QuickLook must not open Market');},onAction:(command,payload)=>actions.push({command,payload}),invoke:async(command,args)=>{calls.push([command,args]);return command==='search_status'?{quickLook:{supported:true,available:true,previewVisible:visible},renderedPreview:{supported:true,visible:false}}:{};}});
    const row=id=>f.command('select',node=>node.dataset.sharingFile===id);
    try{component.render({files:[file('first',{name:'first.'+extension,canPreview:true}),file('second',{name:'second.'+extension.toUpperCase(),canPreview:true})],selectedIds:['first']});row('first').focus();assert.equal(shelfKey(f,row('first'),' ').defaultPrevented,true);await settle();assert.equal(component.previewTarget(),'first');t.mock.timers.tick(1000);await settle();assert.equal(component.isPreviewing(),true,'The HTML reader visibility cannot close an Office preview');shelfKey(f,row('first'),'ArrowRight');await settle();assert.equal(component.previewTarget(),'second');assert.equal(f.document.activeElement,row('second'));assert.deepEqual(actions.at(-1).payload.selectedIds,['second']);assert.deepEqual(calls.filter(call=>call[0]==='shelf_preview'),[['shelf_preview',{id:'first'}],['shelf_preview',{id:'second'}]]);assert.equal(shelfKey(f,row('second'),'Escape').stopped,true);await settle();assert.equal(component.isPreviewing(),false);assert.equal(row('second').attributes['aria-pressed'],'true');shelfKey(f,row('second'),' ');await settle();visible=false;t.mock.timers.tick(1000);await settle();assert.equal(component.isPreviewing(),false,'Closing QuickLook externally ends the Office preview');assert.equal(row('second').attributes['aria-pressed'],'true');}
    finally{component.dispose();}
  });
}

test('Shelf missing QuickLook opens the Market module without opening a document or external setup',async()=>{
  const f=fixture(),calls=[];let market=0;
  const component=create({...f,onGetQuickLook:()=>{market++;},invoke:async(command,args)=>{calls.push([command,args]);return {quickLook:{supported:true,available:false}};}});
  component.render({files:[file('a',{canPreview:true})],selectedIds:['a']});const row=f.command('select');shelfKey(f,row,' ');await settle();assert.equal(market,1);assert.equal(component.isPreviewing(),false);assert.deepEqual(calls,[['search_status',{}]]);component.dispose();
});

test('Shelf preview failure exposes a Market action and never routes an expired status after disposal',async()=>{
  const f=fixture();let market=0;
  const component=create({...f,onGetQuickLook:()=>{market++;},invoke:async command=>{if(command==='search_status')return {quickLook:{available:true}};throw Error('Preview failed');}});
  component.render({files:[file('a',{canPreview:true})],selectedIds:['a']});shelfKey(f,f.command('select'),' ');await settle();const get=f.command('get-quicklook');assert.equal(get.hidden,false);f.click(get);assert.equal(market,1);component.dispose();
  const other=fixture();let finish;
  const delayed=create({...other,onGetQuickLook:()=>{market++;},invoke:()=>new Promise(resolve=>finish=resolve)});delayed.render({files:[file('a',{canPreview:true})],selectedIds:['a']});shelfKey(other,other.command('select'),' ');delayed.dispose();finish({quickLook:{available:false}});await settle();assert.equal(market,1);
});

test('Shelf Space previews the selected file, arrows change the actual preview and Escape closes only the viewer first', async () => {
  const f=fixture(),calls=[],actions=[],component=create({...f,onAction:(command,payload)=>actions.push({command,payload}),invoke:async (...args)=>{calls.push(args);return {};}});
  component.render({files:[file('a',{canPreview:true}),file('b',{canPreview:true}),file('c',{canPreview:true})]});
  const row=id=>f.command('select',node=>node.dataset.sharingFile===id);
  f.click(row('a')); row('a').focus();
  assert.equal(shelfKey(f,row('a'),' ').defaultPrevented,true); await settle();
  assert.deepEqual(calls,[['shelf_preview',{id:'a'}]]); assert.equal(component.isPreviewing(),true);
  assert.equal(row('a').title,'','native tooltips must not float above the external preview');
  assert(f.all(f.host,node=>node.className==='sharing-file-name').every(node=>node.title===''));
  shelfKey(f,row('a'),' ',{repeat:true}); await settle(); assert.equal(calls.length,1);
  shelfKey(f,row('a'),'ArrowRight'); await settle();
  assert.deepEqual(calls.at(-1),['shelf_preview',{id:'b'}]); assert.equal(f.document.activeElement,row('b'));
  assert.deepEqual(actions.at(-1).payload.selectedIds,['b']);
  shelfKey(f,row('b'),'ArrowDown'); await settle(); assert.deepEqual(calls.at(-1),['shelf_preview',{id:'c'}]);
  shelfKey(f,row('c'),'ArrowDown'); await settle(); assert.equal(calls.length,3,'navigation clamps at the final file');
  shelfKey(f,row('c'),'ArrowLeft'); await settle(); assert.deepEqual(calls.at(-1),['shelf_preview',{id:'b'}]);
  assert.equal(shelfKey(f,row('b'),'Escape').stopped,true); await settle();
  assert.deepEqual(calls.at(-1),['shelf_preview_close',{}]); assert.equal(component.isPreviewing(),false);
  assert.equal(shelfKey(f,row('b'),'Escape').defaultPrevented,undefined,'a second Escape returns to the normal Notchy route');
  assert.equal(row('b').attributes['aria-pressed'],'true','closing preserves the file selection'); component.dispose();
});

test('rapid Shelf navigation and leaving during Invoke serialize the newest file and then close without reopening', async () => {
  const f=fixture(),calls=[]; let finish;
  const component=create({...f,invoke:(command,args)=>{calls.push([command,args]);return calls.length===1?new Promise(resolve=>finish=resolve):Promise.resolve({});}});
  component.render({files:[file('a',{canPreview:true}),file('b',{canPreview:true}),file('c',{canPreview:true})],selectedIds:['a']});
  const row=id=>f.command('select',node=>node.dataset.sharingFile===id);
  shelfKey(f,row('a'),' '); shelfKey(f,row('a'),'ArrowRight'); shelfKey(f,row('b'),'ArrowRight');
  assert.deepEqual(calls,[['shelf_preview',{id:'a'}],['shelf_preview_close',{}]],'cancellation reaches the native worker before the pending preview returns'); finish({}); await settle();
  assert.deepEqual(calls,[['shelf_preview',{id:'a'}],['shelf_preview_close',{}],['shelf_preview',{id:'c'}]],'intermediate requests do not queue old previews');
  component.stopPreview(); await settle(); assert.deepEqual(calls.at(-1),['shelf_preview_close',{}]);
  shelfKey(f,row('c'),' '); await settle(); assert.equal(component.isPreviewing(),true);
  component.dispose(); await settle(); assert.deepEqual(calls.at(-1),['shelf_preview_close',{}]);
});

test('Shelf Escape sends cancellation immediately and ignores the rejected workbook after leaving',async()=>{
  const f=fixture(),calls=[];let reject;
  const component=create({...f,invoke:(command,args)=>{calls.push([command,args]);return command==='shelf_preview'?new Promise((_,fail)=>reject=fail):Promise.resolve({});}});
  try {
    component.render({files:[file('large',{name:'large.xlsx',canPreview:true})],selectedIds:['large']});const row=f.command('select');
    shelfKey(f,row,' ');shelfKey(f,row,'Escape');
    assert.deepEqual(calls,[['shelf_preview',{id:'large'}],['shelf_preview_close',{}]],'Escape is delivered before workbook preparation completes');
    reject(Error('Cancelled obsolete workbook'));await settle();assert.equal(component.isPreviewing(),false);assert.equal(f.find(node=>node.className==='sharing-file-status').textContent,'');
    assert.equal(calls.filter(call=>call[0]==='shelf_preview_close').length,1);
  } finally {component.dispose();}
});

test('Shelf cancels obsolete failures, coalesces navigation and retries returning to the same file',async()=>{
  const f=fixture(),calls=[];let reject,close,count=0;
  const component=create({...f,invoke:(command,args)=>{calls.push([command,args]);if(command==='shelf_preview'&&++count===1)return new Promise((_,fail)=>reject=fail);if(command==='shelf_preview_close')return new Promise(resolve=>close=resolve);return Promise.resolve({});}});
  try {
    component.render({files:[file('a',{canPreview:true}),file('b',{canPreview:true})],selectedIds:['a']});const row=id=>f.command('select',node=>node.dataset.sharingFile===id);
    shelfKey(f,row('a'),' ');shelfKey(f,row('a'),'ArrowRight');shelfKey(f,row('b'),'ArrowLeft');
    assert.deepEqual(calls,[['shelf_preview',{id:'a'}],['shelf_preview_close',{}]]);
    reject(Error('Cancelled old preview'));await settle();assert.equal(calls.length,2,'The next Open awaits the outstanding native Close');close({});await settle();
    assert.deepEqual(calls.at(-1),['shelf_preview',{id:'a'}]);assert.equal(component.isPreviewing(),true);assert.equal(f.find(node=>node.className==='sharing-file-status').textContent,'');
  } finally {component.dispose();close?.({});}
});

test('Shelf checks engine availability once per preview session and refreshes it after closing',async()=>{
  const f=fixture(),calls=[];let available=true,market=0;
  const component=create({...f,onGetQuickLook:()=>{market++;},invoke:async(command,args)=>{calls.push([command,args]);return command==='search_status'?{quickLook:{available}}:{};}});
  try {
    component.render({files:[file('a',{canPreview:true}),file('b',{canPreview:true})],selectedIds:['a']});const row=id=>f.command('select',node=>node.dataset.sharingFile===id);
    shelfKey(f,row('a'),' ');await settle();shelfKey(f,row('a'),'ArrowRight');await settle();shelfKey(f,row('b'),'ArrowLeft');await settle();
    assert.equal(calls.filter(call=>call[0]==='search_status').length,1);assert.equal(calls.filter(call=>call[0]==='shelf_preview').length,3);
    component.stopPreview();await settle();available=false;shelfKey(f,row('a'),' ');await settle();
    assert.equal(calls.filter(call=>call[0]==='search_status').length,2);assert.equal(calls.filter(call=>call[0]==='shelf_preview').length,3);assert.equal(market,1);assert.equal(component.isPreviewing(),false);
  } finally {component.dispose();}
});

test('Shelf preview failures are announced, removal closes an active preview, and inputs or unsupported files keep native Space behavior', async () => {
  const f=fixture(),calls=[],component=create({...f,invoke:async (command,args)=>{calls.push([command,args]);if(args.id==='bad')throw Error('missing');return {};}});
  component.render({files:[file('a',{canPreview:true}),file('bad',{canPreview:true}),file('unsupported')],selectedIds:['bad']});
  const row=id=>f.command('select',node=>node.dataset.sharingFile===id);
  shelfKey(f,row('bad'),' '); await settle();
  assert.equal(component.isPreviewing(),false); assert(f.find(node=>node.className==='sharing-file-status').textContent.includes('QuickLook'));
  assert.equal(shelfKey(f,row('unsupported'),' ').defaultPrevented,undefined);
  assert.equal(shelfKey(f,f.command('manual-ip'),' ').defaultPrevented,undefined);
  shelfKey(f,row('bad'),' ',{ctrlKey:true}); await settle(); assert.equal(calls.length,1);
  f.click(row('a')); shelfKey(f,row('a'),' '); await settle(); assert.equal(component.isPreviewing(),true);
  component.render({files:[],selectedIds:[]}); await settle(); assert.equal(component.isPreviewing(),false); assert.deepEqual(calls.at(-1),['shelf_preview_close',{}]);
  component.dispose();
});

test('Shelf detects a native viewer closed externally without letting a stale status close a newer preview', async t => {
  t.mock.timers.enable({apis:['setInterval']});
  const f=fixture(),calls=[]; let reply;
  const component=create({...f,invoke:(command,args)=>{calls.push([command,args]);return command==='search_status'?new Promise(resolve=>reply=resolve):Promise.resolve({});}});
  component.render({files:[file('a',{canPreview:true}),file('b',{canPreview:true})],selectedIds:['a']});
  const row=id=>f.command('select',node=>node.dataset.sharingFile===id);
  shelfKey(f,row('a'),' '); await settle(); t.mock.timers.tick(1000);
  shelfKey(f,row('a'),'ArrowRight'); await settle(); reply({quickLook:{previewVisible:false}}); await settle();
  assert.equal(component.isPreviewing(),true,'an old reply cannot describe the newly selected preview');
  t.mock.timers.tick(1000); reply({quickLook:{previewVisible:false}}); await settle();
  assert.equal(component.isPreviewing(),false); assert.deepEqual(calls.at(-1),['shelf_preview_close',{}]); component.dispose();
});

test('real file controls keep multi-selection and dispatch supported actions with the intended file IDs', () => {
  const f=fixture(), actions=[], component=create({...f,onAction:(command,payload)=>actions.push({command,payload})});
  component.render({files:[file('a'),file('b',{canConvert:false})],selectedIds:[],peers:[],favorites:[],available:true});
  f.click(f.command('select',node=>node.dataset.sharingFile==='a')); f.click(f.command('select',node=>node.dataset.sharingFile==='b'));
  assert.deepEqual(actions.at(-1).payload.selectedIds,['a','b']);
  f.click(f.command('download')); assert.deepEqual(actions.at(-1),{command:'download',payload:{id:null,ids:['a','b']}});
  assert.equal(f.command('convert',node=>node.dataset.sharingFile==='b').hidden,true);
  const before=actions.length; f.click(f.command('convert',node=>node.dataset.sharingFile==='b')); assert.equal(actions.length,before);
  f.click(f.command('ocr',node=>node.dataset.sharingFile==='a')); assert.deepEqual(actions.at(-1).payload,{id:'a',ids:['a']});
  f.click(f.command('select-all')); assert.deepEqual(actions.at(-1).payload.selectedIds,[]);
  f.click(f.command('select-all')); assert.deepEqual(actions.at(-1).payload.selectedIds,['a','b']);
  for(const node of f.all(f.host,node=>node.tagName==='button')) assert(!node.children.some(child=>f.all(child,node=>node.tagName==='button').length),'no button contains another button');
  component.dispose(); const count=actions.length; f.click(f.command('add')); assert.equal(actions.length,count);
});

test('offline favorites cannot send; online devices target actual identities and favorite updates are callbacks', () => {
  const f=fixture(), actions=[], component=create({...f,onAction:(command,payload)=>actions.push({command,payload})});
  component.render({files:[file('a')],selectedIds:[],peers:[{id:'online',alias:'Actual phone'}],favorites:[{id:'offline',alias:'Saved laptop'}],available:true});
  const offline=f.command('send',node=>node.dataset.sharingPeer==='offline:offline'); assert.equal(offline.disabled,true); f.click(offline); assert.equal(actions.length,0);
  f.click(f.command('send',node=>node.dataset.sharingPeer==='online')); assert.deepEqual(actions[0],{command:'send',payload:{id:'a',ids:['a'],peerId:'online'}});
  f.click(f.command('favorite',node=>node.dataset.sharingPeer==='online')); assert.equal(actions[1].payload.favorite,true); assert.equal(actions[1].payload.id,'online');
  component.render({files:[file('a'),file('blocked',{canSend:false})]}); assert.equal(f.command('send',node=>node.dataset.sharingPeer==='online').disabled,true);
});

test('stable identities reconnect to a new live ID without duplicating or losing the saved favorite', () => {
  const favorites=[{identity:'fingerprint-a',alias:'Saved phone',deviceType:'mobile'}];
  const offline=sharingDeviceList({peers:[],favorites}); assert.equal(offline[0].id,'offline:fingerprint-a'); assert.equal(offline[0].online,false);
  const peers=[{id:'new-session-id',identity:'fingerprint-a',alias:'Connected phone',deviceType:'mobile'}];
  const devices=sharingDeviceList({peers,favorites}); assert.equal(devices.length,1); assert.deepEqual(devices[0],{id:'new-session-id',identity:'fingerprint-a',alias:'Connected phone',deviceType:'mobile',online:true,favorite:true});
  const f=fixture(), actions=[], component=create({...f,onAction:(command,payload)=>actions.push({command,payload})});
  component.render({files:[file('a')],selectedIds:[],peers:[],favorites,available:true});
  const favorite=f.command('favorite'); component.render({peers}); assert.equal(f.command('favorite'),favorite,'stable identity retains its real control');
  f.click(f.command('send',node=>node.dataset.sharingPeer==='new-session-id')); assert.equal(actions[0].payload.peerId,'new-session-id');
  f.click(favorite); assert.equal(actions[1].payload.peer.identity,'fingerprint-a'); assert.equal(actions[1].payload.favorite,false);
});

test('manual IP validation, error retry and Escape use the real form without inventing a connected peer', () => {
  const f=fixture(), actions=[], component=create({...f,onAction:(command,payload)=>actions.push({command,payload})}); component.render({files:[],peers:[],favorites:[],available:true});
  f.click(f.command('manual-ip')); const form=f.find(node=>node.tagName==='form'), input=f.find(node=>node.tagName==='input'); assert.equal(form.hidden,false); assert.equal(f.document.activeElement,f.command('close-ip'),'Opening the form never focuses the input.');
  const event={preventDefault(){},stopPropagation(){}}; input.value='https://example.com'; form.listeners.submit(event); assert.equal(actions.length,0); assert.equal(input.attributes['aria-invalid'],'true'); assert.equal(f.document.activeElement,f.command('close-ip'),'An invalid submission cannot autofocus the input either.');
  for(const invalid of ['8.8.8.8','127.0.0.1','192.168.1.20:65536']) {input.value=invalid;form.listeners.submit(event);assert.equal(actions.length,0);assert.equal(input.attributes['aria-invalid'],'true');}
  assert.equal(input.maxLength,21);assert(f.host.textContent.includes('Entre une adresse IP locale valide'));
  input.value='192.168.1.20'; form.listeners.submit(event); assert.deepEqual(actions[0],{command:'connect',payload:{address:'192.168.1.20'}});
  component.render({busy:true}); form.listeners.submit(event); assert.equal(actions.length,1);
  component.render({busy:false,status:{error:'Connection refused'}}); assert(f.host.textContent.includes('Connection refused')); form.listeners.submit(event); assert.equal(actions.length,2);
  input.value='192.168.1.20:53317';form.listeners.submit(event);assert.deepEqual(actions[2],{command:'connect',payload:{address:'192.168.1.20:53317'}});
  f.host.listeners.keydown({...event,key:'Escape'}); assert.equal(form.hidden,true); assert.equal(f.document.activeElement.dataset.sharingCommand,'manual-ip');
});

test('drop passes the original File objects once, prevents legacy bubbling and ignores a busy or empty drop', () => {
  const f=fixture(), actions=[], component=create({...f,onAction:(command,payload)=>actions.push({command,payload})}); component.render({files:[]});
  const incoming={name:'actual-file.pdf'}, event={dataTransfer:{types:['Files'],files:[incoming]},preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};
  f.host.listeners.drop(event); assert.equal(actions.length,1); assert.equal(actions[0].command,'add'); assert.equal(actions[0].payload.files[0],incoming); assert.equal(event.prevented,true); assert.equal(event.stopped,true);
  component.render({busy:true}); f.host.listeners.drop(event); assert.equal(actions.length,1);
  component.render({busy:false}); f.host.listeners.drop({...event,dataTransfer:{types:['Files'],files:[]}}); assert.equal(actions.length,1);
});

test('transfer progress is measured and incoming share only opens the existing consent flow', () => {
  const f=fixture(), actions=[], component=create({...f,onAction:(command,payload)=>actions.push({command,payload})});
  component.render({files:[],transfer:{id:'transfer-a',status:'sending',alias:'Phone',progress:37},available:true});
  const progress=f.find(node=>node.attributes.role==='progressbar'); assert.equal(progress.attributes['aria-valuenow'],'37'); f.click(f.command('cancel')); assert.deepEqual(actions[0],{command:'cancel',payload:{id:'transfer-a'}});
  component.render({transfer:{id:'transfer-a',status:'waiting',progress:null}}); assert.equal(progress.hidden,true); assert.equal(progress.attributes['aria-valuenow'],undefined);
  component.render({incoming:{id:'request-a',alias:'Actual sender'}}); assert.equal(f.command('cancel').hidden,true); f.click(f.command('open-transfer')); assert.equal(actions[1].command,'open-transfer');
});

test('polling unchanged files or a reconnected identity never detaches the existing list rows', () => {
  const f=fixture(), component=create(f), snapshot={files:[file('a')],selectedIds:[],peers:[{id:'session-1',identity:'stable-phone',alias:'Phone'}],favorites:[],available:true};
  component.render(snapshot); let moves=0;
  for(const list of f.all(f.host,node=>['sharing-files','sharing-devices'].includes(node.className))) {const insert=list.insertBefore.bind(list);list.insertBefore=(...args)=>{moves++;return insert(...args);};}
  const select=f.command('select');select.focus();component.render(snapshot);component.render({peers:[{id:'session-2',identity:'stable-phone',alias:'Phone'}]});
  assert.equal(moves,0); assert.equal(f.document.activeElement,select); assert(f.command('send',node=>node.dataset.sharingPeer==='session-2'));
});

test('shared empty Shelf and Devices keep one real action without nested buttons or duplicate callbacks', () => {
  const f=fixture(),actions=[],component=create({...f,onAction:(command,payload)=>actions.push({command,payload})});
  component.render({files:[],peers:[],favorites:[],available:true});
  const emptyAdd=f.find(node=>node.dataset.sharingCommand==='add'&&node.className.includes('notch-empty-action'));
  const emptyIp=f.find(node=>node.dataset.sharingCommand==='manual-ip'&&node.className.includes('notch-empty-action'));
  assert(emptyAdd&&emptyIp);assert.equal(emptyAdd.tagName,'button');assert.equal(emptyAdd.parentElement.tagName,'div');
  let stopped=0;emptyAdd.listeners.click({target:emptyAdd,stopPropagation(){stopped++;}});
  assert.equal(stopped,1);assert.deepEqual(actions,[{command:'add',payload:{}}]);
  emptyAdd.focus();component.render({files:[],peers:[]});assert.equal(f.document.activeElement,emptyAdd);
  assert.equal(f.find(node=>node===emptyAdd),emptyAdd);
  emptyIp.listeners.click({target:emptyIp,stopPropagation(){}});assert.equal(f.command('connect').parentElement.hidden,false);
  component.render({busy:true});emptyAdd.listeners.click({target:emptyAdd,stopPropagation(){}});assert.equal(actions.length,1);
  component.dispose();emptyAdd.listeners.click?.({target:emptyAdd,stopPropagation(){}});assert.equal(actions.length,1);
});

test('file failures are announced in the Shelf without becoming a LocalSend network error', () => {
  const f=fixture(),component=create(f);component.render({files:[file('a')],peers:[],available:true,fileStatus:{message:'Fictional export failed',error:true},status:{message:''}});
  const left=f.find(node=>node.className==='sharing-file-status'),right=f.find(node=>node.className==='sharing-status');
  assert.equal(left.textContent,'Fictional export failed');assert.equal(left.parentElement.className,'sharing-shelf');assert.equal(left.hidden,false);assert.equal(left.dataset.error,'true');assert.equal(left.attributes.role,'status');
  assert.equal(right.hidden,true);component.render({status:{message:'Fictional discovery failed',error:true},fileStatus:{message:''}});
  assert.equal(left.hidden,true);assert.equal(right.textContent,'Fictional discovery failed');assert.equal(right.parentElement.className,'sharing-nearby');
});

test('reference file rows retain real names, measured sizes and explicit selection controls', () => {
  const f=fixture(),component=create(f);
  component.render({files:[file('a',{name:'real-photo.jpg',size:86016}),file('b',{name:'actual-report.pdf',size:1258291})],peers:[],available:true});
  const sizes=f.all(f.host,node=>node.className==='sharing-file-size');
  assert.equal(sizes[0].textContent,'84 Ko'); assert.match(sizes[1].textContent,/1[.,]2 Mo/);
  const rows=f.all(f.host,node=>node.className.includes('sharing-file-row'));
  assert.equal(rows[0].dataset.tone,'orange'); assert.equal(rows[1].dataset.tone,'red');
  assert.equal(f.command('select-all').textContent,'Tout'); assert(f.host.textContent.includes('2 fichiers gardés'));
  component.dispose();
});

test('balanced Tray keeps truthful header counts, a common body structure and footer actions', () => {
  const f=fixture(),component=create(f);
  try {
    component.render({files:[file('one'),file('two')],selectedIds:['one'],peers:[],available:false});
    const cards=f.host.children,headings=cards.map(card=>card.children[0]);
    assert.equal(headings[0].tagName,'header'); assert.equal(headings[1].tagName,'header');
    assert.equal(headings[0].children[0].textContent,'TRAY'); assert.equal(headings[1].children[0].textContent,'LOCALSEND');
    assert.equal(f.find(node=>node.className==='sharing-file-count').textContent,'2 fichiers gardés');
    assert.equal(f.find(node=>node.className==='sharing-file-summary').textContent,'1 sélectionné(s)');
    assert.equal(f.find(node=>node.className==='sharing-readiness').textContent,'Indisponible');
    assert.equal(cards[0].children[1].className,'sharing-card-body'); assert.equal(cards[1].children[1].className,'sharing-card-body');
    assert.equal(cards[0].children.at(-1).tagName,'footer'); assert.equal(cards[1].children.at(-2).tagName,'footer');
    assert(f.command('remove')); assert(f.command('select-all')); assert(f.command('manual-ip')); assert(f.command('discover'));
    component.render({files:[],selectedIds:[],available:true});
    assert.equal(f.find(node=>node.className==='sharing-file-count').textContent,'0 fichiers gardés');
    assert(!f.host.textContent.includes('PDF et images'),'The layout must not misrepresent the accepted file formats');
  } finally {component.dispose();}
});

test('Tray empty characters use the shared Galet renderer and retain distinct module variants', () => {
  const f=fixture(),characters=[];
  f.document.defaultView={NotchyGalet:{states:['idle'],variants:{default:{},shelf:{},sharing:{}},create(host,options){
    const instance={host,variant:options.variant,state:null,disposed:false,setVariant(value){this.variant=value;},setState(value){this.state=value;},dispose(){this.disposed=true;}};
    characters.push(instance); return instance;
  }}};
  const component=create(f);
  component.render({files:[],peers:[],available:true}); component.render({files:[],peers:[],available:true,busy:true});
  assert.equal(characters.length,2,'Polling does not create additional character renderers');
  assert.deepEqual(characters.map(character=>[character.variant,character.state]),[['shelf','idle'],['sharing','idle']]);
  assert.equal(characters[0].host.children.length,0);
  assert.equal(characters[1].host.children.length,3);
  assert(characters[1].host.children.every(node=>node.className==='sharing-mimo-ring'&&node.attributes['aria-hidden']==='true'),'Only the three reference radar rings accompany the shared renderer');
  assert.equal(f.find(node=>node.dataset.sharingCommand==='add'&&node.className.includes('notch-empty-action')).disabled,true);
  component.dispose(); assert(characters.every(character=>character.disposed));
});

test('discovery uses the same Mimo and three signal rings, without inventing discovered devices', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const f=characterFixture(),actions=[],component=create({...f,onAction:(command,payload)=>actions.push({command,payload})});
  component.render({files:[file('a')],peers:[],available:true});
  const mimo=f.characters[1],initialParent=mimo.host.parentElement;
  f.click(f.command('discover'));
  const nearby=f.find(node=>node.className==='sharing-nearby');
  assert.equal(nearby.dataset.state,'searching'); assert.equal(mimo.state,'searching'); assert.equal(mimo.host.parentElement.className,'sharing-search'); assert.equal(mimo.host.dataset.sharingPlacement,'hero');
  assert.deepEqual(component.inspect(),{searching:true,disposed:false,network:{state:'searching',placement:'hero',online:0}});
  assert.equal(mimo.host.children.filter(node=>node.className==='sharing-mimo-ring').length,3);
  assert.equal(f.all(f.host,node=>node.className==='sharing-search-radar'||node.className.includes('sharing-device-row')).length,0);
  component.render({peers:[]}); assert.equal(mimo.changes.filter(state=>state==='searching').length,1,'An unchanged network poll cannot restart the expression.');
  assert.deepEqual(actions,[{command:'discover',payload:{}}]);
  t.mock.timers.tick(6000);
  assert.equal(nearby.dataset.state,'idle'); assert.equal(mimo.state,'idle'); assert.equal(mimo.host.parentElement,initialParent); assert.equal(f.characters.length,2,'No character is recreated between placements.'); assert.equal(actions.length,1,'visual timeout never emits a network stop');
  component.dispose();
});

test('discovery cancellation and a real peer result preserve truthful actions and counts', () => {
  const f=fixture(),actions=[],component=create({...f,onAction:(command,payload)=>actions.push({command,payload})});
  component.render({files:[file('a'),file('b')],peers:[],available:true}); f.click(f.command('discover')); f.click(f.command('stop'));
  assert.deepEqual(actions.map(action=>action.command),['discover','stop']);
  f.click(f.command('discover'));
  component.render({selectedIds:['a'],peers:[{id:'real-phone',alias:'Actual phone',deviceType:'mobile'}]});
  const nearby=f.find(node=>node.className==='sharing-nearby'); assert.equal(nearby.dataset.state,'found');
  assert.equal(f.command('stop').hidden,true); assert.equal(f.find(node=>node.className==='sharing-device-summary').textContent,'1 appareil trouvé · 1 fichier prêt à envoyer');
  assert.equal(f.find(node=>node.className==='sharing-device-action').textContent,'Envoyer');
  f.click(f.command('send',node=>node.dataset.sharingPeer==='real-phone'));
  assert.deepEqual(actions.at(-1),{command:'send',payload:{id:'a',ids:['a'],peerId:'real-phone'}});
  component.dispose();
});

test('a discovery failure ends the scan and Mimo reacts without creating a device', () => {
  const f=characterFixture(),component=create(f); component.render({files:[],peers:[],available:true}); f.click(f.command('discover'));
  component.render({status:{message:'Actual network failure',error:true}});
  assert.equal(f.find(node=>node.className==='sharing-nearby').dataset.state,'idle');
  assert.equal(f.characters[1].state,'error');
  assert.equal(f.find(node=>node.className==='sharing-status').textContent,'Actual network failure');
  assert.equal(f.all(f.host,node=>node.className.includes('sharing-device-row')).length,0);
  f.click(f.command('discover')); assert.equal(f.find(node=>node.className==='sharing-nearby').dataset.state,'searching','retry clears only the previous displayed failure');
  assert.equal(f.characters[1].state,'searching');
  component.dispose();
});

test('reduced motion and hidden Tray pause its signal rings, and disposal releases the listener', () => {
  const f=fixture(); let listener=null;
  const preference={matches:true,addEventListener(name,callback){listener=callback;},removeEventListener(){listener=null;}};
  f.document.defaultView={matchMedia:()=>preference};
  const component=create(f),rings=f.all(f.host,node=>node.className==='sharing-mimo-ring');
  component.render({files:[],peers:[],available:true}); f.click(f.command('discover'));
  assert(rings.every(ring=>ring.style.animationPlayState==='paused'));
  preference.matches=false; listener(); assert(rings.every(ring=>ring.style.animationPlayState==='running'));
  f.host.hidden=true; listener(); assert(rings.every(ring=>ring.style.animationPlayState==='paused'));
  f.host.hidden=false; f.document.body.dataset.motion='false'; listener(); assert(rings.every(ring=>ring.style.animationPlayState==='paused'));
  component.dispose(); assert.equal(listener,null);
});

test('real peer arrival celebrates once, then preserves its Mimo in the header without replaying on polls', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const f=characterFixture(),component=create(f),mimo=f.characters[1];
  component.render({files:[],peers:[],available:true}); f.click(f.command('discover'));
  const peers=[{id:'session-1',identity:'phone-fingerprint',alias:'Real phone'}];
  component.render({peers}); assert.equal(mimo.state,'finished'); assert.equal(mimo.host.parentElement.tagName,'h2'); assert.equal(mimo.host.dataset.sharingPlacement,'inline');
  assert.deepEqual(component.inspect().network,{state:'finished',placement:'inline',online:1});
  component.render({peers}); assert.equal(mimo.changes.filter(value=>value==='finished').length,1);
  t.mock.timers.tick(2000); assert.equal(mimo.state,'idle');
  component.render({peers:[{...peers[0],id:'session-2'}]}); assert.equal(mimo.state,'idle','Reconnection with the same identity does not pretend a new device was found.');
  component.dispose(); t.mock.timers.tick(6000); assert(f.characters.every(character=>character.disposed));
});

test('Mimo follows real consent, transfer, completion and IP validation without fabricated success', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const f=characterFixture(),component=create(f),mimo=f.characters[1];
  component.render({files:[],peers:[],available:true});
  component.render({incoming:{id:'actual-request'}}); assert.equal(mimo.state,'share-request');
  component.render({incoming:null,transfer:{id:'actual-transfer',status:'waiting'}}); assert.equal(mimo.state,'approval');
  component.render({transfer:{id:'actual-transfer',status:'receiving'}}); assert.equal(mimo.state,'receiving');
  component.render({transfer:{id:'actual-transfer',status:'complete',direction:'receive'}}); assert.equal(mimo.state,'received');
  t.mock.timers.tick(2000); assert.equal(mimo.state,'idle');
  component.render({transfer:{id:'failed-transfer',status:'error'}}); assert.equal(mimo.state,'error');
  component.render({transfer:null}); f.click(f.command('manual-ip')); assert.equal(mimo.state,'question'); assert.equal(mimo.host.parentElement.parentElement.tagName,'form');
  const form=f.find(node=>node.tagName==='form'),input=f.find(node=>node.tagName==='input'); input.value='invalid'; form.listeners.submit({preventDefault(){},stopPropagation(){}}); assert.equal(mimo.state,'error');
  f.click(f.command('close-ip')); assert.equal(mimo.state,'idle'); assert.equal(mimo.host.parentElement.className.includes('sharing-device-empty'),true);
  component.dispose();
});
