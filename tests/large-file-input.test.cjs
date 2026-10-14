const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../notch.js'), 'utf8');
function part(start, end) {const from = source.indexOf(start), to = source.indexOf(end, from); assert(from >= 0 && to > from); return source.slice(from, to);}
const accepted = part('  function acceptedFile(', '  async function fileRequest(');
const stage = part('  async function stageFiles(', '  async function fileCommand(');
const upload = part('  async function uploadFiles(', '  async function shelfCommand(');
const file = {name: 'large-photo.png', size: 2 * 1024 * 1024 * 1024};

test('a large file is staged and shared without a transfer byte quota; costly tools keep their processing limit', async () => {
  const requests = [], scope = {selectViewButton() {},setState() {},renderFiles() {},fileInput:{value:'test'},fileRequest:async (url, options) => {requests.push({url, body:options.body});return {item:{id:'a'.repeat(32),name:options.body.name,size:options.body.size}};}};
  vm.runInNewContext(`let disposed=false,fileBusy=false,fileError='',fileEpoch=0,fileItems=[],fileIndex=0,fileMode='actions',fileJob={status:'idle'};${accepted}${stage}this.api={stageFiles,getItems:()=>fileItems,getError:()=>fileError};`,scope);
  await scope.api.stageFiles([file]); assert.equal(requests.length,1); assert.equal(requests[0].body,file);
  const [record]=scope.api.getItems(); assert.equal(record.size,file.size); assert.equal(record.image,true); assert.equal(record.toolsAvailable,false); assert.equal(scope.api.getError(),'');
  await scope.api.stageFiles(Array.from({length:21},()=>file));assert.equal(requests.length,1);assert.match(scope.api.getError(),/20 fichiers/);assert(!scope.api.getError().includes('Mo'));
});

test('a large file can enter the Shelf while its existing count limit stays enforced', async () => {
  const requests=[],scope={selectViewButton() {},setState() {},renderShelf() {},menuButtons:[{dataset:{view:'tray'}}],shelfInput:{value:'test'},text() {},byId:()=>({}),shelfRequest:async (url, options)=>{requests.push({url,body:options.body});return {items:[{id:'a'.repeat(32),name:file.name,size:file.size}]};}};
  vm.runInNewContext(`let disposed=false,shelfBusy=false,shelfError='',shelfEpoch=0,shelfItems=[];function setShelf(value){shelfItems=value.items;} ${upload} this.api={uploadFiles,setCount:n=>{shelfItems=Array.from({length:n},()=>({}));},getError:()=>shelfError};`,scope);
  await scope.api.uploadFiles([file]);assert.equal(requests.length,1);assert.equal(requests[0].body,file);
  scope.api.setCount(20);await scope.api.uploadFiles([file]);assert.equal(requests.length,1);assert.match(scope.api.getError(),/20 fichiers/);assert(!scope.api.getError().includes('128'));
});
