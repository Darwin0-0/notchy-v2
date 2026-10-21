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
const file = (id,extra={}) => ({id,name:id+'.png',canOcr:true,canConvert:true,canSend:true,canOpen:true,canDownload:true,canRemove:true,...extra});
const settle = () => new Promise(resolve => setImmediate(resolve));
function shelfKey(f, target, key, extra={}) {
  const event={target,key,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...extra};
  f.host.listeners.keydown(event); return event;
}

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
  assert.equal(calls.length,1); finish({}); await settle();
  assert.deepEqual(calls,[['shelf_preview',{id:'a'}],['shelf_preview',{id:'c'}]],'intermediate requests do not queue old previews');
  component.stopPreview(); await settle(); assert.deepEqual(calls.at(-1),['shelf_preview_close',{}]);
  shelfKey(f,row('c'),' '); await settle(); assert.equal(component.isPreviewing(),true);
  component.dispose(); await settle(); assert.deepEqual(calls.at(-1),['shelf_preview_close',{}]);
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
  f.click(f.command('manual-ip')); const form=f.find(node=>node.tagName==='form'), input=f.find(node=>node.tagName==='input'); assert.equal(form.hidden,false); assert.equal(f.document.activeElement,input);
  const event={preventDefault(){},stopPropagation(){}}; input.value='https://example.com'; form.listeners.submit(event); assert.equal(actions.length,0); assert.equal(input.attributes['aria-invalid'],'true');
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

test('discovery uses the supplied anonymous radar and ends its visual scan without stopping the listener', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture(),actions=[],component=create({...f,onAction:(command,payload)=>actions.push({command,payload})});
  component.render({files:[file('a')],peers:[],available:true});
  f.click(f.command('discover'));
  const nearby=f.find(node=>node.className==='sharing-nearby'),radar=f.find(node=>node.attributes.class==='sharing-search-radar');
  assert.equal(nearby.dataset.state,'searching'); assert.equal(radar.attributes.viewBox,'0 0 330 200');
  for(const timing of ['dur="3s"','dur="4s"','dur="6s"','begin="0s"','begin="1s"','begin="2s"']) assert(radar.innerHTML.includes(timing));
  assert(!/Pixel|MacBook|<text/.test(radar.innerHTML),'discovery cannot fabricate found device aliases');
  assert.deepEqual(actions,[{command:'discover',payload:{}}]);
  t.mock.timers.tick(6000);
  assert.equal(nearby.dataset.state,'idle'); assert.equal(actions.length,1,'visual timeout never emits a network stop');
  component.dispose();
});

test('discovery cancellation and a real peer result replace the radar with truthful actions and counts', () => {
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

test('a discovery failure ends the radar and remains visible without creating a device', () => {
  const f=fixture(),component=create(f); component.render({files:[],peers:[],available:true}); f.click(f.command('discover'));
  component.render({status:{message:'Actual network failure',error:true}});
  assert.equal(f.find(node=>node.className==='sharing-nearby').dataset.state,'idle');
  assert.equal(f.find(node=>node.className==='sharing-status').textContent,'Actual network failure');
  assert.equal(f.all(f.host,node=>node.className.includes('sharing-device-row')).length,0);
  f.click(f.command('discover')); assert.equal(f.find(node=>node.className==='sharing-nearby').dataset.state,'searching','retry clears only the previous displayed failure');
  component.dispose();
});

test('reduced motion pauses the SVG timeline and switching the preference resumes only an active scan', () => {
  const f=fixture(); let listener=null,paused=0,resumed=0,time=null;
  const preference={matches:true,addEventListener(name,callback){listener=callback;},removeEventListener(){listener=null;}};
  f.document.defaultView={matchMedia:()=>preference};
  const component=create(f),radar=f.find(node=>node.attributes.class==='sharing-search-radar');
  radar.pauseAnimations=()=>paused++; radar.unpauseAnimations=()=>resumed++; radar.setCurrentTime=value=>{time=value;};
  component.render({files:[],peers:[],available:true}); f.click(f.command('discover'));
  assert(paused>0); assert.equal(resumed,0); assert.equal(time,0);
  preference.matches=false; listener(); assert.equal(resumed,1);
  f.document.body.dataset.motion='false'; listener(); assert(paused>1); assert.equal(resumed,1);
  component.dispose(); assert.equal(listener,null);
});
