'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {size,fileKind,expiration,meter,create}=require('../reception.js');

test('reception keeps the reference surface budgets across quiet, hover and opened states',()=>{
  const stages=['consent','waiting','progress','complete','cancelled','rejected','error'];
  for(const stage of stages){
    assert.deepEqual(size('rest',stage),{width:220,height:36});
    assert.deepEqual(size('compact',stage),{width:360,height:58});
    const opened=size('open',stage);
    assert.equal(opened.width,520);assert(opened.height>=132&&opened.height<=262);
    assert(opened.height>size('compact',stage).height,'opening must make the real actions reachable');
  }
  assert.deepEqual(size('open','consent','summary'),{width:520,height:176});
  assert.deepEqual(size('open','consent','list'),{width:520,height:262});
  assert.deepEqual(size('open','progress'),{width:520,height:132});
  assert.deepEqual(size('open','complete'),{width:520,height:176});
  assert.deepEqual(size('open','consent','summary'),size('open','consent'),'closing file detail restores its original budget');
});

test('dedicated reception geometry applies only to its active route and cannot resize unrelated modules',()=>{
  const source=fs.readFileSync(require.resolve('../notch.js'),'utf8'),start=source.indexOf('  function receptionGeometry() {'),end=source.indexOf('  function renderLocalSend() {',start);
  assert(start>0&&end>start);
  const value={direction:'receive',stage:'consent',files:[{name:'one.png'},{name:'two.pdf'}]};
  const scope={view:'localsend',state:'rest',receptionDetail:'summary',window:{NotchyReception:{size}},localSendPresentation:()=>value,localSendBand:()=>value};
  require('node:vm').runInNewContext(source.slice(start,end)+'this.measure=receptionGeometry;',scope);
  assert.deepEqual(scope.measure(),{width:220,height:36});scope.state='compact';assert.deepEqual(scope.measure(),{width:360,height:58});
  scope.state='open';assert.deepEqual(scope.measure(),{width:520,height:176});scope.receptionDetail='list';assert.equal(scope.measure().height,262);
  value.files=[{name:'single.png'}];assert.equal(scope.measure().height,176,'single-file preview cannot retain the batch list height');
  value.stage='progress';assert.equal(scope.measure().height,132);
  for(const route of ['nook','tasks','music','weather','tray','search','settings']){scope.view=route;assert.equal(scope.measure(),null,route);}
  scope.view='localsend';value.direction='send';assert.equal(scope.measure(),null,'outgoing shares retain their existing design');
  value.direction='receive';scope.state='rest';scope.localSendBand=()=>null;assert.equal(scope.measure(),null,'a retired reception cannot leave a large quiet surface behind');
});

test('request lifetime follows the supplied backend deadline, including elapsed and future clocks',()=>{
  const incoming={createdAt:10000,expiresAt:30000},before=structuredClone(incoming);
  assert.equal(expiration(incoming,0),1);assert.equal(expiration(incoming,10000),1);
  assert.equal(expiration(incoming,15000),.75);assert.equal(expiration(incoming,20000),.5);
  assert.equal(expiration(incoming,30000),0);assert.equal(expiration(incoming,40000),0);
  assert.deepEqual(incoming,before,'displaying the deadline cannot extend or rewrite network consent');
  assert.equal(expiration({createdAt:10000,expiresAt:11000},10500),.5,'duration is not a hardcoded mockup timeout');
});

test('a missing or invalid deadline never displays an invented countdown',()=>{
  for(const incoming of [null,{}, {createdAt:10000}, {expiresAt:30000}, {createdAt:null,expiresAt:30000},
    {createdAt:'',expiresAt:30000},{createdAt:10000,expiresAt:null},{createdAt:10000,expiresAt:10000},
    {createdAt:30000,expiresAt:10000},{createdAt:NaN,expiresAt:30000},{createdAt:10000,expiresAt:Infinity}]){
    assert.equal(expiration(incoming,20000),null,JSON.stringify(incoming));
  }
});

test('file illustrations use case-insensitive local extensions and unknown files remain documents',()=>{
  for(const name of ['photo.jpg','PHOTO.JPEG','a.b.PnG','picture.webp','capture.heic','photo.avif','animated.gif','scan.tiff'])assert.equal(fileKind(name),'image',name);
  for(const name of ['export.zip','package.7z','backup.TAR','archive.tar.gz'])assert.equal(fileKind(name),'archive',name);
  for(const name of ['', 'png','README','notes.pdf','image.png.exe','archive.zip.txt','folder.'])assert.equal(fileKind(name),'document',name);
});

const receiving=(id,bytes,extra={})=>({id,status:'receiving',transferredBytes:bytes,...extra});
test('a transfer rate needs two measured byte samples and never advances on a timer alone',()=>{
  const sample=meter();
  assert.equal(sample(receiving('one',0),1000),null);
  assert.equal(sample(receiving('one',0),2000),null);
  assert.equal(sample(receiving('one',4096),3000),2048);
  assert.equal(sample(receiving('one',4096),3500),2048,'a recent measurement can remain briefly visible');
  assert.equal(sample(receiving('one',4096),6001),null,'stalled samples cannot keep claiming a live speed');
  assert.equal(sample(receiving('one',8192),7000),1024,'the next rate is based on actual elapsed bytes and time');
});

test('rate samples reset across transfer identities, byte counter restarts and backward clocks',()=>{
  const sample=meter();sample(receiving('one',0),1000);assert.equal(sample(receiving('one',1000),2000),1000);
  assert.equal(sample(receiving('two',50000),3000),null,'a new sender cannot borrow the last transfer rate');
  assert.equal(sample(receiving('two',51000),4000),1000);
  assert.equal(sample(receiving('two',0),5000),null,'a restarted byte counter establishes a new baseline');
  assert.equal(sample(receiving('two',1000),6000),1000);
  assert.equal(sample(receiving('two',2000),5500),null,'clock corrections cannot yield a negative speed');
  assert.equal(sample(receiving('two',2500),6000),1000);
});

test('measurement noise, malformed bytes and terminal states cannot fabricate a reception rate',()=>{
  const sample=meter();sample(receiving('one',0),1000);
  assert.equal(sample(receiving('one',100),1100),null,'short sampling intervals are not extrapolated');
  assert.equal(sample(receiving('one',500),1500),1000);
  for(const bytes of [-1,NaN,Infinity,undefined,null,''])assert.equal(sample(receiving('one',bytes),1600),null);
  for(const status of ['preparing','complete','cancelled','rejected','error','sending']){
    assert.equal(sample(receiving('one',1000,{status}),2000),null,status);
    assert.equal(sample(receiving('one',2000),3000),null,'terminal or unrelated activity discards the baseline');
  }
  assert.equal(sample(null,4000),null);assert.equal(sample(receiving('new',10),5000),null);
});

function renderFixture(){
  const {document}=require('./helpers/experience-dom.cjs').fixture(),nodes=new Map();
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
  for(const match of html.matchAll(/<([a-z][\w-]*)\b[^>]*\bid="([^"]+)"[^>]*>/gi)){
    const node=document.createElement(match[1]);node.id=match[2];node.namespaceURI='http://www.w3.org/1999/xhtml';nodes.set(node.id,node);
  }
  document.getElementById=id=>{assert(nodes.has(id),'renderer uses a real document element: '+id);return nodes.get(id);};
  const card=document.getElementById('reception-card');
  for(const node of nodes.values())if(node!==card&&/^(?:reception-|localsend-consent$|shelf-incoming)/.test(node.id))card.append(node);
  for(const _ of html.matchAll(/class="reception-stack"/g)){const stack=document.createElement('button');stack.className='reception-stack';card.append(stack);}
  const t=(value,params={})=>value.replace(/\{(\w+)\}/g,(_,key)=>params[key]??'{'+key+'}');
  const formatSize=value=>String(value)+' B';
  const component=create({document,t,formatSize,motion:()=>false});
  return{document,component,node:id=>document.getElementById(id)};
}
const offer=(extra={})=>({stage:'consent',alias:'Actual phone',count:2,bytes:30,progress:null,files:[{name:'one.png',size:10},{name:'two.pdf',size:20}],...extra});

test('consent renders real filenames as text and enables acceptance only for a real pending request',()=>{
  const f=renderFixture(),name='<img src=x onerror=alert(1)>.png',files=[{name,size:10}],value=offer({files,count:1,bytes:10});
  f.component.render(value);assert.equal(f.node('shelf-incoming-accept').disabled,true);
  f.component.render(value,{incoming:{id:'request-one',files},detail:'list'});
  assert.equal(f.node('shelf-incoming-accept').disabled,false);
  assert(f.node('shelf-incoming-files').textContent.startsWith(name));assert(f.node('shelf-incoming-files').textContent.endsWith('10 B'));
  assert.equal(f.node('reception-files').children[0].children[1].textContent,name,'received names are never interpreted as markup');
  assert.equal(f.node('reception-files').children[0].children[1].children.length,0);
  f.component.render(value,{incoming:{id:'request-one'},busy:true});assert.equal(f.node('shelf-incoming-accept').disabled,true);
});

test('waiting for bytes is indeterminate and only real measured progress becomes a percentage',()=>{
  const f=renderFixture();
  f.component.render(offer({stage:'waiting',progress:null,transfer:{id:'one',status:'waiting'}}));
  assert(!/%|NaN|Infinity/.test(f.node('reception-counter').textContent),'connection setup cannot claim a made-up percentage');
  assert.equal(f.node('reception-progress').attributes['aria-valuenow'],undefined,'unknown progress is announced as indeterminate');
  f.component.render(offer({stage:'progress',progress:37,transfer:receiving('one',11)}));
  assert.equal(f.node('reception-counter').textContent,'37 %');assert.equal(f.node('reception-progress').attributes['aria-valuenow'],'37');
  assert.equal(Number(f.node('reception-progress').style['--reception-progress']),.37);assert.equal(f.node('reception-bytes').textContent,'11 B / 30 B');
  assert.equal(f.node('reception-rate').textContent,'','the first reception sample cannot invent a speed');
});

test('interrupted transfers preserve completed files and never offer a nonexistent received folder',()=>{
  const f=renderFixture();
  f.component.render(offer({stage:'cancelled',transfer:{id:'one',status:'cancelled',completedFileCount:0}}));
  assert.equal(f.node('reception-shelf').dataset.localsendCommand,'done');assert.equal(f.node('reception-reveal').hidden,true);
  assert(f.node('reception-result-detail').textContent.includes('Aucun fichier complet reçu'));
  f.component.render(offer({stage:'error',transfer:{id:'one',status:'error',completedFileCount:1,receivedBytes:10}}),{canReveal:true});
  assert.equal(f.node('reception-shelf').dataset.localsendCommand,'shelf');assert.equal(f.node('reception-reveal').hidden,false);
  assert.equal(f.node('reception-reveal').dataset.localsendCommand,'reveal');assert(f.node('reception-result-detail').textContent.includes('1 fichier(s) conservé(s)'));
  f.component.render(offer({stage:'complete',progress:100,transfer:{id:'one',status:'complete',completedFileCount:2}}),{canReveal:false});
  assert.equal(f.node('reception-result').dataset.success,'true');assert.equal(f.node('reception-result-title').textContent,'2 fichiers reçus');
  assert.equal(f.node('reception-reveal').dataset.localsendCommand,'shelf','without a reveal capability the actual Shelf is the available action');
});
