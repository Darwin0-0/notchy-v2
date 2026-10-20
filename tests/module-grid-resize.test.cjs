'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create,MODULE_IDS}=require('../experience.js'),layout=require('../module-contracts.js');
const {fixture}=require('./helpers/experience-dom.cjs');
const placement=(id,presentation,column,row)=>({id,presentation,column,row});
function editor(initial,options={}){
  const f=fixture(),changes=[],actions=[],captures=[],released=[],windowEvents=new Map(),captured=new Set();
  f.document.defaultView={addEventListener:(name,handler)=>windowEvents.set(name,handler),removeEventListener:(name,handler)=>{if(windowEvents.get(name)===handler)windowEvents.delete(name);}};
  f.modulesHost.setPointerCapture=id=>{captured.add(id);captures.push(id);};f.modulesHost.hasPointerCapture=id=>captured.has(id);f.modulesHost.releasePointerCapture=id=>{captured.delete(id);released.push(id);};
  const component=create({...f,modulesToolbarHost:f.toolbar,layout,onModulesChange:value=>{changes.push(structuredClone(value));return options.acknowledge?.(value);},onAction:value=>actions.push(value),...options});
  const props={enabled:initial.map(item=>item.id),order:[...MODULE_IDS],grid:structuredClone(initial)};component.renderModules(props);
  const card=id=>f.modulesHost.querySelectorAll('.experience-grid-module').find(node=>node.dataset.experienceModule===id),handle=id=>card(id).querySelector('.experience-grid-resize');
  const stage=f.modulesHost.querySelector('.experience-module-grid'),ghost=f.modulesHost.querySelector('.experience-grid-resize-preview');
  const pointer=(type,target,extra={})=>f.event(f.modulesHost,type,target,{pointerId:7,button:0,clientX:200,clientY:80,...extra});
  return{...f,changes,actions,captures,released,windowEvents,component,props,card,handle,stage,ghost,pointer};
}

test('resize captures its pointer and previews continuous dimensions before committing one declared format',()=>{
  let rendered=0,cleaned=0;const initial=[placement('music','small',0,0),placement('weather','small',2,2)],before=structuredClone(initial);
  const f=editor(initial,{renderModulePreview(host,item){rendered++;host.append(host.ownerDocument.createElement('strong'));return()=>cleaned++;}});
  f.stage.rect={left:20,top:40,width:406,height:184};const original=f.card('music'),neighbor=f.card('weather');
  const down=f.pointer('pointerdown',f.handle('music'));assert.equal(down.prevented,true);assert.equal(down.stopped,true);assert.deepEqual(f.captures,[7]);
  f.pointer('pointermove',f.modulesHost,{clientX:220});const firstWidth=Number.parseFloat(f.ghost.style.width);
  assert.equal(f.ghost.hidden,false);assert.equal(f.ghost.dataset.blocked,'false');assert.equal(f.changes.length,0);assert.equal(f.card('music'),original);assert.equal(f.card('weather'),neighbor);
  f.pointer('pointermove',f.modulesHost,{clientX:230});assert(Number.parseFloat(f.ghost.style.width)>firstWidth,'ghost follows sub-cell motion instead of jumping only between formats');
  assert.equal(rendered,2);assert.equal(cleaned,0,'preview content remains mounted throughout a gesture');
  f.pointer('pointermove',f.modulesHost,{clientX:338});assert(f.ghost.textContent.startsWith('wide'));
  f.pointer('pointerup',f.modulesHost,{clientX:338});
  assert.equal(f.changes.length,1);assert.deepEqual(f.changes[0].grid,[placement('music','wide',0,0),initial[1]]);assert.deepEqual(f.changes[0].enabled,initial.map(item=>item.id));
  assert.deepEqual(initial,before);assert.equal(f.ghost.hidden,true);assert.deepEqual(f.released,[7]);assert.equal(f.stage.dataset.resizing,undefined);
  assert.equal(f.document.activeElement,f.handle('music'));assert.equal(cleaned,2);f.component.dispose();
});

test('an occupied target remains blocked instead of moving the neighbor or choosing a different format',()=>{
  const initial=[placement('music','small',0,0),placement('weather','side',1,0)],f=editor(initial),neighbor=f.card('weather');
  f.pointer('pointerdown',f.handle('music'));f.pointer('pointermove',f.modulesHost,{clientX:476});
  assert.equal(f.ghost.dataset.blocked,'true');assert.equal(f.ghost.textContent,'Espace occupé');assert.equal(f.changes.length,0);
  f.pointer('pointerup',f.modulesHost,{clientX:476});assert.equal(f.changes.length,0);assert.equal(f.card('weather'),neighbor);assert.equal(f.card('music').dataset.gridPresentation,'small');
  assert(f.modulesHost.textContent.includes('Les cellules nécessaires ne sont pas libres.'));assert.equal(f.ghost.hidden,true);f.component.dispose();
});

test('a blocked resize can recover into a free direction within the same gesture',()=>{
  const initial=[placement('music','small',0,0),placement('weather','side',1,0)],f=editor(initial);
  f.pointer('pointerdown',f.handle('music'));f.pointer('pointermove',f.modulesHost,{clientX:476});assert.equal(f.ghost.dataset.blocked,'true');
  f.pointer('pointermove',f.modulesHost,{clientX:200,clientY:208});assert.equal(f.ghost.dataset.blocked,'false');assert(f.ghost.textContent.startsWith('tall'));
  f.pointer('pointerup',f.modulesHost,{clientX:200,clientY:208});assert.deepEqual(f.changes[0].grid,[placement('music','tall',0,0),initial[1]]);f.component.dispose();
});

test('small accidental movement and a foreign pointer cannot resize or end the captured gesture',()=>{
  const f=editor([placement('music','small',0,0)]),handle=f.handle('music');
  f.pointer('pointerdown',handle);f.pointer('pointermove',f.modulesHost,{clientX:203,clientY:83});assert.equal(f.ghost.hidden,true);
  f.pointer('pointermove',f.modulesHost,{pointerId:99,clientX:476});f.pointer('pointerup',f.modulesHost,{pointerId:99,clientX:476});
  assert.equal(f.ghost.hidden,true);assert.deepEqual(f.released,[]);assert.equal(f.changes.length,0);
  f.pointer('pointerup',f.modulesHost,{clientX:203,clientY:83});assert.deepEqual(f.released,[7]);assert.equal(f.changes.length,0);f.component.dispose();
});

for(const pointerType of ['mouse','touch'])test('a simple '+pointerType+' tap opens the real format menu without changing the grid',()=>{
  const f=editor([placement('music','small',0,0),placement('weather','side',1,0)]);
  f.pointer('pointerdown',f.handle('music'),{pointerType});f.pointer('pointerup',f.modulesHost,{pointerType});
  const menu=f.modulesHost.querySelector('.experience-grid-menu'),choices=menu.querySelectorAll('button').filter(node=>node.dataset.gridPresentation);
  assert.equal(menu.hidden,false);assert.equal(f.changes.length,0);assert.deepEqual(f.released,[7]);
  assert.equal(choices.find(node=>node.dataset.gridPresentation==='small').attributes['aria-checked'],'true');
  assert.equal(choices.find(node=>node.dataset.gridPresentation==='wide').disabled,true,'menu respects the same real neighbor collision');
  assert(menu.contains(f.document.activeElement));assert.equal(f.ghost.hidden,true);f.component.dispose();
});

for(const cancellation of ['Escape','pointercancel','lostpointercapture','blur','dispose'])test(cancellation+' discards only the resize preview and never commits its pending grid',()=>{
  const initial=[placement('music','small',0,0),placement('weather','small',2,2)],f=editor(initial),card=f.card('music');
  f.pointer('pointerdown',f.handle('music'));f.pointer('pointermove',f.modulesHost,{clientX:476});assert.equal(f.ghost.hidden,false);
  if(cancellation==='Escape')f.event(f.modulesHost,'keydown',f.handle('music'),{key:'Escape'});
  else if(cancellation==='blur')f.windowEvents.get('blur')();
  else if(cancellation==='dispose')f.component.dispose();
  else f.pointer(cancellation,f.modulesHost);
  assert.equal(f.changes.length,0);assert.equal(f.ghost.hidden,true);assert.equal(card.dataset.resizing,undefined);assert.deepEqual(f.actions,[]);
  f.pointer('pointerup',f.modulesHost,{clientX:476});assert.equal(f.changes.length,0,'a delayed release cannot revive a cancelled gesture');
  f.component.dispose();assert.equal(f.windowEvents.has('blur'),false);assert.equal(f.modulesHost.listeners.pointerdown,undefined);
});

test('host validation rejection preserves the original placement and mounted preview after release',()=>{
  let cleaned=0;const f=editor([placement('music','small',0,0)],{acknowledge:()=>false,renderModulePreview:()=>()=>cleaned++}),card=f.card('music');
  f.pointer('pointerdown',f.handle('music'));f.pointer('pointermove',f.modulesHost,{clientX:476});f.pointer('pointerup',f.modulesHost,{clientX:476});
  assert.equal(f.changes.length,1);assert.equal(f.changes[0].grid[0].presentation,'wide');assert.equal(f.card('music'),card);assert.equal(card.dataset.gridPresentation,'small');assert.equal(cleaned,0);
  assert.equal(f.ghost.hidden,true);assert(f.modulesHost.textContent.includes('La disposition n’a pas été modifiée.'));f.component.dispose();
});

test('arrow keys on the resize handle choose a supported free size, preserve its origin and keep keyboard focus',()=>{
  const initial=[placement('music','small',0,0),placement('weather','small',2,2)],f=editor(initial);
  for(const [key,size]of [['ArrowRight','wide'],['ArrowLeft','small'],['ArrowDown','tall'],['ArrowDown','side'],['ArrowUp','tall'],['ArrowUp','small']]){
    f.event(f.modulesHost,'keydown',f.handle('music'),{key});assert.equal(f.changes.at(-1).grid[0].presentation,size);assert.deepEqual(f.changes.at(-1).grid[1],initial[1]);assert.equal(f.changes.at(-1).grid[0].column,0);assert.equal(f.changes.at(-1).grid[0].row,0);assert.equal(f.document.activeElement,f.handle('music'));
  }
  const count=f.changes.length;f.event(f.modulesHost,'keydown',f.handle('music'),{key:'ArrowUp'});assert.equal(f.changes.length,count);f.component.dispose();
});

test('mixed keyboard input during a captured resize cannot commit before release or defeat Escape cancellation',()=>{
  const f=editor([placement('music','small',0,0)]);
  f.pointer('pointerdown',f.handle('music'));f.pointer('pointermove',f.modulesHost,{clientX:476});
  for(const key of ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' ','Delete','Backspace']){
    const event=f.event(f.modulesHost,'keydown',f.handle('music'),{key});
    assert.equal(event.prevented,true,key);assert.equal(event.stopped,true,key);assert.equal(f.changes.length,0,'the captured pointer gesture owns the pending resize until release');
    assert.equal(f.ghost.hidden,false);assert.equal(f.modulesHost.querySelector('.experience-grid-menu').hidden,true);
  }
  f.click(f.modulesHost,f.handle('music'));
  assert.equal(f.modulesHost.querySelector('.experience-grid-menu').hidden,true,'a browser-generated button click cannot open a menu during pointer capture');
  f.event(f.modulesHost,'keydown',f.handle('music'),{key:'Escape'});assert.equal(f.changes.length,0);assert.equal(f.card('music').dataset.gridPresentation,'small');assert.deepEqual(f.actions,[]);f.component.dispose();
});

test('Tab cancels the pending pointer resize while preserving ordinary keyboard navigation',()=>{
  const f=editor([placement('music','small',0,0)]);
  f.pointer('pointerdown',f.handle('music'));f.pointer('pointermove',f.modulesHost,{clientX:476});
  const event=f.event(f.modulesHost,'keydown',f.handle('music'),{key:'Tab'});
  assert.equal(event.prevented,undefined,'browser Tab navigation stays available');assert.equal(f.changes.length,0);assert.equal(f.ghost.hidden,true);assert.deepEqual(f.released,[7]);
  f.pointer('pointerup',f.modulesHost,{clientX:476});assert.equal(f.changes.length,0);assert.equal(f.modulesHost.querySelector('.experience-grid-menu').hidden,true);f.component.dispose();
});

test('keyboard resize keeps the other axis when a supported free format permits it',()=>{
  const f=editor([placement('music','small',0,0)]);
  for(const [key,presentation]of [['ArrowRight','wide'],['ArrowDown','main'],['ArrowLeft','side'],['ArrowUp','tall'],['ArrowUp','small']]){
    f.event(f.modulesHost,'keydown',f.handle('music'),{key});assert.equal(f.changes.at(-1).grid[0].presentation,presentation);
  }
  f.component.dispose();
});

test('resize keyboard collisions and internal drag starts never initiate a file transfer',()=>{
  const input=[placement('music','small',0,0),placement('weather','side',1,0)],f=editor(input);
  f.event(f.modulesHost,'keydown',f.handle('music'),{key:'ArrowRight'});assert.equal(f.changes.length,0);
  let payloads=0;const drag=f.event(f.modulesHost,'dragstart',f.handle('music'),{dataTransfer:{setData(){payloads++;}}});assert.equal(drag.prevented,true);assert.equal(payloads,0);
  assert.deepEqual(f.actions,[]);f.component.dispose();
});
