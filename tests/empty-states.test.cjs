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
    i18n, t: i18n.t, uiMessage: i18n.message,
    dragFileCount, window: {innerWidth: 800}, notch: {contains: () => true, dataset: {}},
    byId: id => {if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id);},
    text: (node, value) => {node.textContent = value;},
    renderMusic() {}, renderLiveActivities() {}, update() {}, getModuleEditorActive: () => false,
    builtinVisible: id => id === 'shelf', uploadFiles: files => uploaded.push(files), stageFiles: files => staged.push(files)
  };
  require('node:vm').runInNewContext(`let state='discreet',view='nook',fileDragging=false,dragDepth=0,fileDragCount=null,fileDragPreviousState=null,shelfLoaded=true,shelfBusy=false;
    function setState(value){state=value;} ${source.slice(from, to)}
    this.api={fileDragOver,clearFileDrag,fileDrop,getState:()=>state,setView:value=>{view=value;}};`, scope);
  const file = {name: 'report.pdf'}, event = {target: {}, clientX: 400, clientY: 4, preventDefault() {}, dataTransfer: {types: ['Files'], items: [{kind: 'file'}], files: [file]}};
  scope.api.fileDragOver(event); assert.equal(scope.api.getState(), 'open');
  assert.equal(nodes.get('shelf-drag-title').textContent, 'Déposer 1 fichier');
  assert.equal(nodes.get('shelf-drag-preview').hidden, false);
  scope.api.clearFileDrag(); assert.equal(scope.api.getState(), 'discreet'); assert.equal(nodes.get('shelf-drag-preview').hidden, true);
  scope.api.fileDragOver(event); scope.api.fileDrop(event); assert.equal(staged.length, 1); assert.equal(uploaded.length, 0);
  scope.api.setView('tray'); scope.api.fileDragOver(event); scope.api.fileDrop(event);
  assert.equal(uploaded.length, 1); assert.equal(uploaded[0][0], file);
});
