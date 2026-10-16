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
