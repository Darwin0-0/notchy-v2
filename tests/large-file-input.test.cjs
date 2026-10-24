const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {create: createI18n} = require('../i18n.js');
const source = fs.readFileSync(require.resolve('../notch.js'), 'utf8');
function part(start, end) {const from = source.indexOf(start), to = source.indexOf(end, from); assert(from >= 0 && to > from); return source.slice(from, to);}
const accepted = part('  function acceptedFile(', '  async function fileRequest(');
const stage = part('  async function stageFiles(', '  async function fileCommand(');
const upload = part('  async function uploadFiles(', '  async function shelfCommand(');
const textUI = part('  function textUI(', '  function languageChoice(');
const file = {name: 'large-photo.png', size: 2 * 1024 * 1024 * 1024};

test('a large file is staged and shared without a transfer byte quota; costly tools keep their processing limit', async () => {
  const i18n = createI18n(null);
  const requests = [], reactions=[], scope = {i18n,t:i18n.t,uiMessage:i18n.message,notifyGalet:value=>reactions.push(value),selectViewButton() {},setState() {},renderFiles() {},fileInput:{value:'test'},fileRequest:async (url, options) => {requests.push({url, body:options.body});return {item:{id:'a'.repeat(32),name:options.body.name,size:options.body.size}};}};
  vm.runInNewContext(`let disposed=false,fileBusy=false,fileError='',fileEpoch=0,fileItems=[],fileIndex=0,fileMode='actions',fileJob={status:'idle'};${accepted}${stage}this.api={stageFiles,getItems:()=>fileItems,getError:()=>fileError};`,scope);
  await scope.api.stageFiles([file]); assert.equal(requests.length,1); assert.equal(requests[0].body,file);
  const [record]=scope.api.getItems(); assert.equal(record.size,file.size); assert.equal(record.image,true); assert.equal(record.toolsAvailable,false); assert.equal(scope.api.getError(),'');
  assert.deepEqual(reactions,['working','received']);
  await scope.api.stageFiles(Array.from({length:21},()=>file));assert.equal(requests.length,1);assert.match(scope.api.getError(),/20 fichiers/);assert(!scope.api.getError().includes('Mo'));
  reactions.length=0;let reject;
  scope.fileRequest=()=>new Promise((_,no)=>{reject=no;});
  const pending=scope.api.stageFiles([file]);assert.deepEqual(reactions,['working'],'No success while the real request is pending.');
  reject(Error('Disk full'));await pending;assert.deepEqual(reactions,['working','error']);assert.equal(scope.api.getItems().length,1,'A failed addition preserves the previously accepted file.');
});

test('a large file can enter the Shelf while its existing count limit stays enforced', async () => {
  const i18n = createI18n(null);
  const requests=[],reactions=[],scope={i18n,t:i18n.t,uiMessage:i18n.message,notifyGalet:value=>reactions.push(value),selectViewButton() {},setState() {},renderShelf() {},menuButtons:[{dataset:{view:'tray'}}],shelfInput:{value:'test'},text() {},byId:()=>({}),shelfRequest:async (url, options)=>{requests.push({url,body:options.body});return {items:[{id:'a'.repeat(32),name:file.name,size:file.size}]};}};
  vm.runInNewContext(`let disposed=false,shelfBusy=false,shelfError='',shelfEpoch=0,shelfItems=[];function setShelf(value){shelfItems=value.items;} ${textUI}${upload} this.api={uploadFiles,setCount:n=>{shelfItems=Array.from({length:n},()=>({}));},getError:()=>shelfError};`,scope);
  await scope.api.uploadFiles([file]);assert.equal(requests.length,1);assert.equal(requests[0].body,file);
  assert.deepEqual(reactions,['working','received']);
  scope.api.setCount(20);await scope.api.uploadFiles([file]);assert.equal(requests.length,1);assert.match(scope.api.getError(),/20 fichiers/);assert(!scope.api.getError().includes('128'));
  scope.api.setCount(0);reactions.length=0;let resolve;
  scope.shelfRequest=()=>new Promise(yes=>{resolve=yes;});
  const pending=scope.api.uploadFiles([file]);assert.deepEqual(reactions,['working']);
  resolve({items:[{id:'b'.repeat(32),name:file.name,size:file.size}]});await pending;assert.deepEqual(reactions,['working','received'],'Success follows the acknowledged Shelf response.');
});
