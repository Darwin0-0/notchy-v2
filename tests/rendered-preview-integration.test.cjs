'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../notch.js'),'utf8');
const begin=source.indexOf('  async function invokeSearch('),end=source.indexOf('  function showSearch()',begin);
assert(begin>0&&end>begin);
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
function fixture(){
  const calls=[],pending=[],active={search:'a',shelf:'b'};
  const scope={disposed:false,galetSearchPending:0,renderGalet(){},renderedEpoch:{search:0,shelf:0},renderedPreview:{show:(value,owner)=>calls.push(['show',owner,value.name]),hide:owner=>calls.push(['hide',owner])},
    desktop:{search:(op,args)=>{const task=deferred();pending.push({op,args,...task});return task.promise;}},
    search:{isPreviewing:()=>!!active.search,previewTarget:()=>active.search,stopPreview:()=>calls.push(['stop','search']),navigatePreview:direction=>calls.push(['navigate','search',direction])},sharingExperience:{isPreviewing:()=>!!active.shelf,previewTarget:()=>active.shelf,stopPreview:()=>calls.push(['stop','shelf']),navigatePreview:direction=>calls.push(['navigate','shelf',direction])}};
  const helperBegin=source.indexOf('  function renderedPreviewClosed('),helperEnd=begin;
  vm.runInNewContext(source.slice(helperBegin,helperEnd)+source.slice(begin,end)+'this.invoke=invokeSearch;',scope);
  return{scope,calls,pending,active};
}
test('a delayed Search Close cannot invalidate the newer Shelf rendered preview',async()=>{
  const f=fixture(),search=f.scope.invoke('search_preview',{id:'a'});
  f.active.search=null;
  const shelf=f.scope.invoke('shelf_preview',{id:'b'});
  f.pending[0].resolve({rendered:{name:'old.html',url:'/rendered-preview/'+ 'a'.repeat(32)}});await search;
  const close=f.scope.invoke('search_preview_close',{});
  f.pending[2].resolve({ok:true,closed:false});await close;
  f.pending[1].resolve({rendered:{name:'current.docx',url:'/rendered-preview/'+ 'b'.repeat(32)}});await shelf;
  assert.deepEqual(f.calls,[['hide','search'],['show','shelf','current.docx']]);
});
test('a superseded file acknowledgement and a disposed host never open a stale document',async()=>{
  const f=fixture(),old=f.scope.invoke('search_preview',{id:'a'});
  f.active.search='c';const current=f.scope.invoke('search_preview',{id:'c'});
  f.pending[1].resolve({rendered:{name:'current.xlsx'}});await current;
  f.pending[0].resolve({rendered:{name:'old.html'}});await old;
  assert.deepEqual(f.calls,[['show','search','current.xlsx']]);
  const disposed=f.scope.invoke('shelf_preview',{id:'b'});f.scope.disposed=true;
  f.pending[2].resolve({rendered:{name:'late.pptx'}});await disposed;
  assert.equal(f.calls.length,1);
});

test('rendered preview close and arrow controls stay with their Search or Shelf owner',()=>{
  const f=fixture();
  f.scope.renderedPreviewNavigate(1,'search');f.scope.renderedPreviewNavigate(-1,'shelf');
  f.scope.renderedPreviewClosed('search');f.scope.renderedPreviewClosed('shelf');
  assert.deepEqual(f.calls,[['navigate','search',1],['navigate','shelf',-1],['stop','search'],['stop','shelf']]);
});
