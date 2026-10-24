const test = require('node:test');
const assert = require('node:assert/strict');
const {dragFileCount, localSendFailureCopy} = require('../notch.js');
const {create: createI18n} = require('../i18n.js');

test('a protected drag counts exposed file items and keeps an unknown count unknown', () => {
  assert.equal(dragFileCount({items: [{kind: 'file'}, {kind: 'string'}, {kind: 'file'}], files: []}), 2);
  assert.equal(dragFileCount({items: [], files: [{name: 'one.pdf'}]}), 1);
  assert.equal(dragFileCount({items: [], files: []}), null);
  assert.equal(dragFileCount({items: [{kind: 'string'}], files: []}), null);
  assert.equal(dragFileCount(null), null);
});

test('an interrupted transfer reports its actual progress and offers a fresh retry, never invented resumption', () => {
  const failure = localSendFailureCopy({stage: 'error', direction: 'send', progress: 62.4, error: 'La connexion a été perdue.'});
  assert.equal(failure.title, 'Transfert interrompu à 62 %');
  assert.equal(failure.detail, 'La connexion a été perdue.');
  assert.match(failure.help, /depuis le début/);
  assert(!JSON.stringify(failure).includes('2 fichiers sur 3'));
  assert.match(localSendFailureCopy({stage: 'error', direction: 'receive', progress: 0}).help, /expéditeur/);
  assert.equal(localSendFailureCopy({stage: 'error', progress: NaN}).title, 'Transfert impossible');
});

test('refusal and cancellation remain distinct from network failures', () => {
  assert.equal(localSendFailureCopy({stage: 'rejected', alias: 'Téléphone'}).detail, 'Téléphone a refusé le partage.');
  assert.equal(localSendFailureCopy({stage: 'cancelled'}).title, 'Transfert annulé');
  assert.equal(localSendFailureCopy({stage: 'cancelled'}).help, '');
});

test('the file drop preview opens temporarily, restores the previous state and preserves the real destination', () => {
  const source = require('node:fs').readFileSync(require.resolve('../notch.js'), 'utf8');
  const from = source.indexOf('  function hasFiles('), to = source.indexOf('  function text(', from);
  assert(from >= 0 && to > from);
  const nodes = new Map(), uploaded = [], staged = [];
  const i18n = createI18n(null);
  const scope = {
    scenarioController: null,
    i18n, t: i18n.t, uiMessage: i18n.message,
    dragFileCount, document:{hidden:false},galet:null,galetPlacement:null,galetCatchAnimations:[],galetCatchGhost:null, window: {innerWidth: 800}, notch: {contains: () => true, dataset: {}},
    byId: id => {if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id);},
    text: (node, value) => {node.textContent = value;},
    renderMusic() {}, renderLiveActivities() {}, update() {}, getModuleEditorActive: () => false,
    builtinVisible: id => id === 'shelf', uploadFiles: files => uploaded.push(files), stageFiles: files => staged.push(files)
  };
  require('node:vm').runInNewContext(`let state='rest',view='nook',fileDragging=false,dragDepth=0,fileDragCount=null,fileDragPreviousState=null,shelfLoaded=true,shelfBusy=false,nearbyBusy=false,fileBusy=false;
    function setState(value){state=value;} ${source.slice(from, to)}
    this.api={fileDragOver,clearFileDrag,fileDrop,getState:()=>state,setView:value=>{view=value;},setBusy:(shelf,nearby,files)=>{shelfBusy=shelf;nearbyBusy=nearby;fileBusy=files;}};`, scope);
  let stopped=0;
  const file = {name: 'report.pdf'}, event = {target: {}, clientX: 400, clientY: 4, preventDefault() {}, stopPropagation() {stopped++;}, dataTransfer: {types: ['Files'], items: [{kind: 'file'}], files: [file]}};
  scope.api.fileDragOver(event); assert.equal(scope.api.getState(), 'open');
  assert.equal(nodes.get('shelf-drag-title').textContent, 'Déposer 1 fichier');
  assert.equal(nodes.get('shelf-drag-preview').hidden, false);
  scope.api.clearFileDrag(); assert.equal(scope.api.getState(), 'rest'); assert.equal(nodes.get('shelf-drag-preview').hidden, true);
  scope.api.fileDragOver(event); scope.api.fileDrop(event); assert.equal(staged.length, 1); assert.equal(uploaded.length, 0);
  scope.api.setView('tray'); scope.api.fileDragOver(event); scope.api.fileDrop(event);
  assert.equal(uploaded.length, 1); assert.equal(uploaded[0][0], file);
  assert.equal(stopped,5,'The central owner consumes hover/drop once, before a nested Tray target can duplicate the upload.');
  for(const [view,busy] of [['tray',[true,false,false]],['tray',[false,true,false]],['files',[false,false,true]]]) {
    scope.api.setView(view);scope.api.setBusy(...busy);
    scope.api.fileDragOver(event);scope.api.fileDrop(event);
    assert.equal(event.dataTransfer.dropEffect,'none');
    assert.equal(nodes.get('shelf-drag-preview').hidden,true,'A busy destination cannot advertise a file catch.');
    assert.equal(uploaded.length,1);assert.equal(staged.length,1,'Busy rejects without a second action.');
  }
});

test('the file catch returns from its painted centre at the real display scale and releases both animations',()=>{
  const source=require('node:fs').readFileSync(require.resolve('../notch.js'),'utf8');
  const start=source.indexOf('  function cancelGaletCatch() {'),end=source.indexOf('  function clearFileDrag(',start);
  const animations=[],ghosts=[];let enabled=true;
  const animate=(frames,options)=>{const job={frames,options,cancelled:0,cancel(){this.cancelled++;this.oncancel?.();}};animations.push(job);return job;};
  const document={hidden:false,createElement(){const ghost={style:{},setAttribute(){},append(){},animate,removed:0,remove(){this.removed++;}};ghosts.push(ghost);return ghost;}};
  const scope={document,ISLAND_CONFIG:require('../notch.js').ISLAND_CONFIG,galetPlacement:'header',state:'open',motionEnabled:()=>enabled,
    galet:{mount:{animate,offsetWidth:40,getBoundingClientRect:()=>({left:100,top:20,width:20,height:20})}},notch:{offsetWidth:200,getBoundingClientRect:()=>({left:50,top:0,width:200}),append() {}}};
  require('node:vm').runInNewContext(`let galetCatchAnimations=[],galetCatchGhost=null;${source.slice(start,end)}this.api={animateGaletCatch,cancelGaletCatch};`,scope);
  const event={clientX:260,clientY:180},origin={left:200,top:120,width:60,height:60};
  scope.api.animateGaletCatch(event,origin);
  assert.equal(animations.length,2);assert.equal(animations[0].frames[0].transform,'translate(240px,240px) scale(3)');
  assert.equal(animations[0].options.duration,420);assert.equal(animations[1].options.duration,360);
  assert.equal(ghosts[0].style.left,'210px');assert.equal(ghosts[0].style.top,'180px','The ghost follows its own parent scale while the returning mascot is still scaled by the opening layer.');
  scope.api.cancelGaletCatch();assert.equal(ghosts[0].removed,1);assert(animations.every(job=>job.cancelled===1));
  enabled=false;scope.api.animateGaletCatch(event,origin);assert.equal(animations.length,2,'Reduced motion creates no flying object or return animation.');
  enabled=true;document.hidden=true;scope.api.animateGaletCatch(event,origin);assert.equal(animations.length,2,'A hidden app cannot start deferred gesture motion.');
});
