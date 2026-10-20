'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create,MODULE_IDS}=require('../experience.js'),layout=require('../module-contracts.js');
const {fixture}=require('./helpers/experience-dom.cjs');
const placement=(id,presentation,column,row)=>({id,presentation,column,row});
function editor(initial,options={}) {
  const dom=fixture(),changes=[],actions=[],component=create({...dom,modulesToolbarHost:dom.toolbar,layout,onModulesChange:value=>{changes.push(structuredClone(value));return options.acknowledge?.(value);},onAction:action=>actions.push(action),...options});
  const props={enabled:initial.map(item=>item.id),order:[...MODULE_IDS],grid:initial,...options.props};component.renderModules(props);
  const control=(action,id)=>dom.all(dom.modulesHost,node=>node.dataset.experienceCommand===action&&(!id||node.dataset.experienceModule===id))[0];
  const card=id=>dom.all(dom.modulesHost,node=>node.className==='experience-grid-module'&&node.dataset.experienceModule===id)[0];
  return{...dom,component,changes,actions,props,control,card};
}

test('the editor renders all nine cells and the same canonical spans and pixel badges as the live layout engine',()=>{
  const f=editor([placement('focus','main',0,0),placement('music','tall',2,0)]);
  assert.equal(f.modulesHost.querySelector('.experience-grid-cells').children.length,9);
  assert.equal(f.card('focus').style.gridColumn,'1 / span 2');assert.equal(f.card('focus').style.gridRow,'1 / span 3');
  assert(f.card('focus').textContent.includes('main · 2 × 3 · 536 × 368'));
  assert(f.card('music').textContent.includes('tall · 1 × 2 · 260 × 240'));
  const free=f.control('add');assert.equal(free.dataset.gridColumn,'2');assert.equal(free.dataset.gridRow,'2');
  assert(f.toolbar.textContent.includes('Modifier le panneau'));assert(f.toolbar.textContent.includes('Terminé'));
  assert.equal(f.modulesHost.querySelector('.experience-editor-toolbar'),null,'the toolbar does not consume an extra grid row');
  const done=f.toolbar.querySelector('button');f.click(f.toolbar,done);assert.deepEqual(f.actions,['done']);f.component.dispose();assert.equal(f.toolbar.children.length,0);
});

test('resize menus expose only declared formats and disable overlaps without moving any neighboring module',()=>{
  const input=[placement('focus','main',0,0),placement('music','tall',2,0)],f=editor(input),before=structuredClone(input);
  f.click(f.modulesHost,f.control('grid-options','focus'));
  const options=f.modulesHost.querySelector('.experience-grid-menu').querySelectorAll('button').filter(node=>node.dataset.gridPresentation);
  assert.deepEqual(options.map(node=>node.dataset.gridPresentation),layout.supportedFormats(layout.getBuiltinContract('focus')));
  const full=options.find(node=>node.dataset.gridPresentation==='full');assert.equal(full.disabled,true);f.click(f.modulesHost,full);assert.deepEqual(f.changes,[]);
  const small=options.find(node=>node.dataset.gridPresentation==='small');assert.equal(small.disabled,false);f.click(f.modulesHost,small);
  assert.deepEqual(f.changes[0].grid,[placement('focus','small',0,0),placement('music','tall',2,0)]);assert.deepEqual(input,before);
  assert.equal(f.document.activeElement.dataset.experienceModule,'focus');f.component.dispose();
});

test('invalid host grids, duplicate IDs, unsupported formats and tenth modules retain the last valid draft',()=>{
  const f=editor([placement('music','small',0,0)]),original=f.card('music'),before=structuredClone(f.props);
  for(const grid of [[placement('music','small',3,0)],[placement('music','small',0,0),placement('music','small',1,0)],[placement('music','full',0,0),placement('weather','small',2,2)],[placement('shelf','tall',1,1)],null]) {
    const result=f.component.renderModules({...f.props,grid});assert.deepEqual(result.grid,before.grid);assert.equal(f.card('music'),original);assert.deepEqual(f.changes,[]);
  }
  const ids=Array.from({length:9},(_,index)=>`sample.module-${String.fromCharCode(97+index)}`),definitions=ids.map(id=>({id,label:id,contract:{id,layout:{small:{min:{width:240,height:104},ideal:{width:260,height:112}}}}})),grid=ids.map((id,index)=>placement(id,'small',index%3,Math.floor(index/3)));
  f.component.renderModules({enabled:ids,order:ids,grid,definitions});assert.equal(f.modulesHost.querySelector('.experience-grid-cards').children.length,9);
  const result=f.component.renderModules({enabled:ids,order:ids,grid:[...grid,placement('music','small',0,0)],definitions});assert.deepEqual(result.grid,grid);assert.equal(f.modulesHost.querySelector('.experience-grid-cards').children.length,9);f.component.dispose();
});

test('adding to a free cell enables one real module only after its declared format fits; removing it preserves other placements',()=>{
  const f=editor([placement('focus','main',0,0),placement('music','tall',2,0)]);
  f.click(f.modulesHost,f.control('add'));
  assert.equal(f.control('add-module','shelf').disabled,false,'Shelf now supports the last free Small cell');
  f.click(f.modulesHost,f.control('add-module','shelf'));
  assert.deepEqual(f.changes[0].grid,[placement('focus','main',0,0),placement('music','tall',2,0),placement('shelf','small',2,2)]);
  assert(f.changes[0].enabled.includes('shelf'));assert.equal(f.modulesHost.querySelectorAll('.experience-grid-module').length,3);
  f.click(f.modulesHost,f.control('remove','shelf'));assert.deepEqual(f.changes[1].grid,f.props.grid);assert(!f.changes[1].enabled.includes('shelf'));f.component.dispose();
});

test('Shelf resize choices come from its four-format contract and retain Wide and Tall restrictions',()=>{
 const f=editor([placement('shelf','side',0,0)]);f.click(f.modulesHost,f.control('grid-options','shelf'));const options=f.modulesHost.querySelector('.experience-grid-menu').querySelectorAll('button').filter(node=>node.dataset.gridPresentation);assert.deepEqual(options.map(node=>node.dataset.gridPresentation),['full','main','side','small']);assert(!options.some(node=>['wide','tall'].includes(node.dataset.gridPresentation)));const small=options.find(node=>node.dataset.gridPresentation==='small');assert.equal(small.disabled,false);f.click(f.modulesHost,small);assert.deepEqual(f.changes[0].grid,[placement('shelf','small',0,0)]);f.component.dispose();
});

test('keyboard movement rejects collisions and boundaries, context options restore focus, and Escape never applies a draft',()=>{
  const f=editor([placement('music','small',0,0),placement('weather','small',1,0)]),card=f.card('music');card.focus();
  f.event(f.modulesHost,'keydown',card,{key:'ArrowLeft'});f.event(f.modulesHost,'keydown',card,{key:'ArrowRight'});assert.deepEqual(f.changes,[]);assert.equal(f.document.activeElement,card);
  f.event(f.modulesHost,'keydown',card,{key:'ArrowDown'});assert.deepEqual(f.changes[0].grid,[placement('music','small',0,1),placement('weather','small',1,0)]);
  f.event(f.modulesHost,'contextmenu',f.card('music'));assert.equal(f.modulesHost.querySelector('.experience-grid-menu').hidden,false);
  f.event(f.modulesHost,'keydown',f.document.activeElement,{key:'Escape'});assert.equal(f.modulesHost.querySelector('.experience-grid-menu').hidden,true);assert.equal(f.document.activeElement.dataset.experienceModule,'music');assert.deepEqual(f.actions,[]);
  f.event(f.modulesHost,'keydown',f.card('music'),{key:'Escape'});assert.deepEqual(f.actions,['back']);assert.equal(f.changes.length,1);f.component.dispose();
});

test('internal native drag honors the global scale and rejects external drags, cell gaps, occupied cells and overflow',()=>{
  const f=editor([placement('music','small',0,0),placement('weather','small',1,0)]),stage=f.modulesHost.querySelector('.experience-module-grid');stage.rect={left:20,top:40,width:406,height:184};
  const transfer={setData(){},effectAllowed:'',dropEffect:''};
  f.event(f.modulesHost,'drop',stage,{clientX:170,clientY:120,dataTransfer:transfer});assert.deepEqual(f.changes,[]);
  f.event(f.modulesHost,'dragstart',f.card('music'),{dataTransfer:transfer});assert.equal(transfer.effectAllowed,'move');
  f.event(f.modulesHost,'drop',stage,{clientX:160,clientY:60,dataTransfer:transfer});assert.deepEqual(f.changes,[],'the neighboring card cannot be displaced');
  f.event(f.modulesHost,'dragstart',f.card('music'),{dataTransfer:transfer});f.event(f.modulesHost,'drop',stage,{clientX:154,clientY:60,dataTransfer:transfer});assert.deepEqual(f.changes,[],'a grid gutter is not a target cell');
  f.event(f.modulesHost,'dragstart',f.card('music'),{dataTransfer:transfer});f.event(f.modulesHost,'drop',stage,{clientX:40,clientY:120,dataTransfer:transfer});
  assert.deepEqual(f.changes[0].grid,[placement('music','small',0,1),placement('weather','small',1,0)]);assert.equal(f.document.activeElement.dataset.experienceModule,'music');f.component.dispose();
});

test('a central validator rejection keeps the draft and preview untouched; preview cleanups run only on replacement or dispose',()=>{
  let rendered=0,cleaned=0;
  const f=editor([placement('music','small',0,0)],{acknowledge:()=>false,renderModulePreview(host,assignment){rendered++;const title=host.ownerDocument.createElement('strong');title.textContent=assignment.id;host.append(title);return()=>cleaned++;}}),card=f.card('music');
  f.component.renderModules(f.props);assert.equal(rendered,1);assert.equal(cleaned,0);
  f.event(f.modulesHost,'keydown',card,{key:'ArrowRight'});assert.equal(f.changes.length,1);assert.equal(f.card('music'),card);assert.equal(cleaned,0);
  assert.equal(f.component.renderModules(f.props).grid[0].column,0);
  f.component.dispose();f.component.dispose();assert.equal(cleaned,1);assert.equal(f.modulesHost.listeners.dragstart,undefined);
});
