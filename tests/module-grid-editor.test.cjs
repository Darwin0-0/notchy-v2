'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create,MODULE_IDS}=require('../experience.js'),layout=require('../module-contracts.js');
const {fixture}=require('./helpers/experience-dom.cjs');
const placement=(id,presentation,column,row)=>({id,presentation,column,row});
function editor(initial,options={}) {
  const dom=fixture();if(options.window)dom.document.defaultView=options.window;
  const changes=[],actions=[],component=create({...dom,modulesToolbarHost:dom.toolbar,layout,onModulesChange:value=>{changes.push(structuredClone(value));return options.acknowledge?.(value);},onAction:action=>actions.push(action),...options});
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
  for(const control of options){const mark=control.querySelector('svg'),format=layout.getFormat(control.dataset.gridPresentation);assert.equal(mark.children.length,9);assert.equal(mark.children.filter(cell=>cell.attributes.fill==='currentColor').length,format.cols*format.rows);assert.equal(control.attributes['aria-label'],`${control.dataset.gridPresentation} · ${format.cols} × ${format.rows} · ${format.width} × ${format.height}`);}
  const full=options.find(node=>node.dataset.gridPresentation==='full');assert.equal(full.disabled,true);f.click(f.modulesHost,full);assert.deepEqual(f.changes,[]);
  const small=options.find(node=>node.dataset.gridPresentation==='small');assert.equal(small.disabled,false);f.click(f.modulesHost,small.querySelector('rect'));
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

test('keyboard movement repacks occupied cells, rejects boundaries, restores context focus and never applies on Escape',()=>{
  const f=editor([placement('music','small',0,0),placement('weather','small',1,0)]),card=f.card('music');card.focus();
  f.event(f.modulesHost,'keydown',card,{key:'ArrowLeft'});assert.deepEqual(f.changes,[]);f.event(f.modulesHost,'keydown',card,{key:'ArrowRight'});assert.deepEqual(f.changes[0].grid,[placement('music','small',1,0),placement('weather','small',0,0)]);assert.equal(f.document.activeElement,f.card('music'));
  f.event(f.modulesHost,'keydown',f.card('music'),{key:'ArrowDown'});assert.deepEqual(f.changes[1].grid,[placement('music','small',1,1),placement('weather','small',0,0)]);
  f.event(f.modulesHost,'contextmenu',f.card('music'));assert.equal(f.modulesHost.querySelector('.experience-grid-menu').hidden,false);
  f.event(f.modulesHost,'keydown',f.document.activeElement,{key:'Escape'});assert.equal(f.modulesHost.querySelector('.experience-grid-menu').hidden,true);assert.equal(f.document.activeElement.dataset.experienceModule,'music');assert.deepEqual(f.actions,[]);
  f.event(f.modulesHost,'keydown',f.card('music'),{key:'Escape'});assert.deepEqual(f.actions,['back']);assert.equal(f.changes.length,2);f.component.dispose();
});

test('internal native drag honors the global scale, repacks occupied cells and ignores external drags',()=>{
  const f=editor([placement('music','small',0,0),placement('weather','small',1,0)]),stage=f.modulesHost.querySelector('.experience-module-grid');stage.rect={left:20,top:40,width:406,height:184};
  const transfer={setData(){},effectAllowed:'',dropEffect:''};
  f.event(f.modulesHost,'drop',stage,{clientX:170,clientY:120,dataTransfer:transfer});assert.deepEqual(f.changes,[]);
  f.event(f.modulesHost,'dragstart',f.card('music'),{dataTransfer:transfer});assert.equal(transfer.effectAllowed,'move');
  f.event(f.modulesHost,'drop',stage,{clientX:160,clientY:60,dataTransfer:transfer});assert.deepEqual(f.changes[0].grid,[placement('music','small',1,0),placement('weather','small',0,0)]);
  f.event(f.modulesHost,'dragstart',f.card('music'),{dataTransfer:transfer});f.event(f.modulesHost,'drop',stage,{clientX:154,clientY:60,dataTransfer:transfer});assert.equal(f.changes.length,1,'a nearby gutter retains the same nearest occupied anchor without a duplicate update');
  f.event(f.modulesHost,'dragstart',f.card('music'),{dataTransfer:transfer});f.event(f.modulesHost,'drop',stage,{clientX:40,clientY:120,dataTransfer:transfer});
  assert.deepEqual(f.changes[1].grid,[placement('music','small',0,1),placement('weather','small',0,0)]);assert.equal(f.document.activeElement.dataset.experienceModule,'music');f.component.dispose();
});

test('a central validator rejection keeps the draft and preview untouched; preview cleanups run only on replacement or dispose',()=>{
  let rendered=0,cleaned=0;
  const f=editor([placement('music','small',0,0)],{acknowledge:()=>false,renderModulePreview(host,assignment){rendered++;const title=host.ownerDocument.createElement('strong');title.textContent=assignment.id;host.append(title);return()=>cleaned++;}}),card=f.card('music');
  f.component.renderModules(f.props);assert.equal(rendered,1);assert.equal(cleaned,0);
  f.event(f.modulesHost,'keydown',card,{key:'ArrowRight'});assert.equal(f.changes.length,1);assert.equal(f.card('music'),card);assert.equal(cleaned,0);
  assert.equal(f.component.renderModules(f.props).grid[0].column,0);
  f.component.dispose();f.component.dispose();assert.equal(cleaned,1);assert.equal(f.modulesHost.listeners.dragstart,undefined);
});

for(const scale of [.5,.7,1])for(const id of ['music','focus'])test(`a full grid drag preserves the exact ${id==='music'?'Main centre':'Tall second-cell'} grab at scale ${scale}`,()=>{
  const input=[placement('music','main',0,0),placement('focus','tall',2,0),placement('weather','small',2,2)],before=structuredClone(input),f=editor(input),stage=f.modulesHost.querySelector('.experience-module-grid');stage.rect={left:20,top:40,width:812*scale,height:368*scale};
  const point=(x,y)=>({clientX:20+x*scale,clientY:40+y*scale}),transfer={setData(){}};
  const grab=id==='music'?{x:268,y:184}:{x:682,y:168},delta=id==='music'?276:-552;
  f.event(f.modulesHost,'dragstart',f.card(id),{dataTransfer:transfer,...point(grab.x,grab.y)});
  const over=f.event(f.modulesHost,'dragover',stage,{dataTransfer:transfer,...point(grab.x+delta,grab.y)});assert.equal(over.prevented,true);
  f.event(f.modulesHost,'drop',stage,{dataTransfer:transfer,...point(grab.x+delta,grab.y)});
  const expected=[placement('music','main',1,0),placement('focus','tall',0,0),placement('weather','small',0,2)];assert.deepEqual(f.changes[0].grid,expected);assert.equal(f.document.activeElement,f.card(id));assert.deepEqual(input,before);
  const reverse=id==='music'?{x:544,y:184}:{x:130,y:168};
  f.event(f.modulesHost,'dragstart',f.card(id),{dataTransfer:transfer,...point(reverse.x,reverse.y)});f.event(f.modulesHost,'drop',stage,{dataTransfer:transfer,...point(reverse.x-delta,reverse.y)});assert.deepEqual(f.changes[1].grid,input);f.component.dispose();
});

test('anchored drags magnetize to feasible packing through gutters while pointers outside the stage cancel',()=>{
  const input=[placement('music','main',0,0),placement('focus','tall',2,0),placement('weather','small',2,2)];
  for(const [destination,moved]of [[{clientX:20+406,clientY:40+168},false],[{clientX:20+268+130,clientY:40+168},true],[{clientX:19,clientY:40+168},false]]){
    const f=editor(input),stage=f.modulesHost.querySelector('.experience-module-grid');stage.rect={left:20,top:40,width:812,height:368};const transfer={setData(){}};
    f.event(f.modulesHost,'dragstart',f.card('focus'),{dataTransfer:transfer,clientX:20+682,clientY:40+168});f.event(f.modulesHost,'drop',stage,{dataTransfer:transfer,...destination});f.event(f.modulesHost,'dragend',f.card('focus'));
    if(moved)assert.deepEqual(f.changes[0].grid,[placement('music','main',1,0),placement('focus','tall',0,0),placement('weather','small',0,2)]);else assert.deepEqual(f.changes,[]);assert.equal(f.card('focus').dataset.dragging,undefined);f.component.dispose();
  }
});

test('crossing the native drag threshold preserves the initial pointer grab rather than its later dragstart position',()=>{
  const input=[placement('music','main',0,0),placement('focus','tall',2,0),placement('weather','small',2,2)],f=editor(input),stage=f.modulesHost.querySelector('.experience-module-grid');stage.rect={left:20,top:40,width:812,height:368};const transfer={setData(){}};
  f.event(f.modulesHost,'pointerdown',f.card('music'),{pointerId:9,button:0,clientX:288,clientY:224});
  f.event(f.modulesHost,'dragstart',f.card('music'),{dataTransfer:transfer,clientX:297,clientY:226});
  f.event(f.modulesHost,'drop',stage,{dataTransfer:transfer,clientX:564,clientY:224});
  assert.deepEqual(f.changes[0]?.grid,[placement('music','main',1,0),placement('focus','tall',0,0),placement('weather','small',0,2)]);f.component.dispose();
});

for(const scale of [.5,.7,1])for(const id of ['music','focus'])test(`WebView integer drag coordinates retain a fractional ${id} grab at scale ${scale}`,()=>{
  const input=[placement('music','main',0,0),placement('focus','tall',2,0),placement('weather','small',2,2)],f=editor(input),stage=f.modulesHost.querySelector('.experience-module-grid');stage.rect={left:20.375,top:40.625,width:812*scale,height:368*scale};const transfer={setData(){}};
  const start={clientX:stage.rect.left+(id==='music'?268:682)*scale,clientY:stage.rect.top+(id==='music'?184:168)*scale},target={clientX:Math.floor(start.clientX+(id==='music'?276:-552)*scale),clientY:Math.floor(start.clientY)};
  f.event(f.modulesHost,'pointerdown',f.card(id),{pointerId:7,button:0,...start});f.event(f.modulesHost,'dragstart',f.card(id),{dataTransfer:transfer,clientX:Math.floor(start.clientX),clientY:Math.floor(start.clientY)});
  const over=f.event(f.modulesHost,'dragover',stage,{dataTransfer:transfer,...target});assert.equal(over.prevented,true);f.event(f.modulesHost,'drop',stage,{dataTransfer:transfer,...target});
  assert.deepEqual(f.changes[0]?.grid,[placement('music','main',1,0),placement('focus','tall',0,0),placement('weather','small',0,2)]);f.component.dispose();
});

test('actual DPR1.5 native-smoke geometry accepts its integer Main and Tall drag destinations',()=>{
  for(const [id,clientX,clientY,dropX,dropY]of [['music',383.3958435,184.796875,576,184],['focus',673.18229675,139.99479675,286,139]]){
    const f=editor([placement('music','main',0,0),placement('focus','tall',2,0),placement('weather','small',2,2)]),stage=f.modulesHost.querySelector('.experience-module-grid');stage.rect={left:195.80209350585938,top:56,width:568.385437,height:257.59375};const transfer={setData(){}};
    f.event(f.modulesHost,'pointerdown',f.card(id),{pointerId:7,button:0,clientX,clientY});f.event(f.modulesHost,'dragstart',f.card(id),{dataTransfer:transfer,clientX:Math.floor(clientX),clientY:Math.floor(clientY)});f.event(f.modulesHost,'drop',stage,{dataTransfer:transfer,clientX:dropX,clientY:dropY});
    assert.deepEqual(f.changes[0]?.grid,[placement('music','main',1,0),placement('focus','tall',0,0),placement('weather','small',0,2)]);f.component.dispose();
  }
});

test('magnetic movement accepts deeper origin gutters while still cancelling pointers outside the stage',()=>{
  for(const scale of [.5,.7,1])for(const outside of [false,true]){
    const f=editor([placement('music','main',0,0),placement('focus','tall',2,0),placement('weather','small',2,2)]),stage=f.modulesHost.querySelector('.experience-module-grid');stage.rect={left:20,top:40,width:812*scale,height:368*scale};const transfer={setData(){}},start={clientX:20+268*scale,clientY:40+184*scale};
    f.event(f.modulesHost,'pointerdown',f.card('music'),{pointerId:7,button:0,...start});f.event(f.modulesHost,'dragstart',f.card('music'),{dataTransfer:transfer,...start});f.event(f.modulesHost,'drop',stage,{dataTransfer:transfer,clientX:outside?19.9:start.clientX+276*scale-1.1,clientY:start.clientY});
    if(outside)assert.deepEqual(f.changes,[]);else assert.deepEqual(f.changes[0].grid,[placement('music','main',1,0),placement('focus','tall',0,0),placement('weather','small',0,2)]);f.component.dispose();
  }
});

test('keyboard and Move menu share the size-preserving plan when all nine cells are occupied',()=>{
  const input=[placement('music','main',0,0),placement('focus','tall',2,0),placement('weather','small',2,2)],f=editor(input),expected=[placement('music','main',1,0),placement('focus','tall',0,0),placement('weather','small',0,2)];
  f.event(f.modulesHost,'keydown',f.card('music'),{key:'ArrowRight'});assert.deepEqual(f.changes[0].grid,expected);
  f.event(f.modulesHost,'keydown',f.card('music'),{key:'ArrowRight'});assert.equal(f.changes.length,1,'overflow cannot reflow modules beyond the grid');
  f.event(f.modulesHost,'keydown',f.card('music'),{key:'ArrowLeft'});assert.deepEqual(f.changes[1].grid,input);
  f.click(f.modulesHost,f.control('grid-options','focus'));f.click(f.modulesHost,f.control('move','focus'));assert.equal(f.modulesHost.querySelectorAll('.experience-grid-add').length,0,'there is no free cell in the actual user layout');
  f.click(f.modulesHost,f.card('music'));assert.deepEqual(f.changes[2].grid,expected);assert.equal(f.document.activeElement,f.card('focus'));f.component.dispose();
});

test('magnetic drag previews persistent reflow targets through gutters and drops the exact displayed plan without an early write',()=>{
  const input=[placement('music','main',0,0),placement('focus','tall',2,0),placement('weather','small',2,2)],f=editor(input),stage=f.modulesHost.querySelector('.experience-module-grid');stage.rect={left:20,top:40,width:812,height:368};const transfer={setData(){}};
  f.event(f.modulesHost,'pointerdown',f.card('music'),{pointerId:7,button:0,clientX:288,clientY:224});f.event(f.modulesHost,'dragstart',f.card('music'),{dataTransfer:transfer,clientX:297,clientY:226});
  f.event(f.modulesHost,'dragover',stage,{dataTransfer:transfer,clientX:556,clientY:224});const preview=f.modulesHost.querySelector('.experience-grid-move-preview'),primary=preview.querySelector('[data-primary="true"]');
  assert.equal(preview.hidden,false);assert.equal(primary.dataset.gridColumn,'1');assert.equal(primary.dataset.gridRow,'0');assert.deepEqual(f.changes,[]);
  assert.deepEqual(preview.children.map(node=>[node.dataset.experienceModule,node.dataset.gridColumn,node.dataset.gridRow]),[['music','1','0'],['focus','0','0'],['weather','0','2']]);assert.equal(f.card('focus').dataset.moveAffected,'true');
  f.event(f.modulesHost,'dragover',stage,{dataTransfer:transfer,clientX:558,clientY:225});assert.equal(preview.querySelector('[data-primary="true"]'),primary,'retargeting keeps the actual preview nodes');
  f.event(f.modulesHost,'drop',stage,{dataTransfer:transfer,clientX:288,clientY:224});assert.deepEqual(f.changes[0].grid,[placement('music','main',1,0),placement('focus','tall',0,0),placement('weather','small',0,2)],'release uses the plan already displayed, even without another dragover');assert.equal(preview.hidden,true);assert.equal(preview.children.length,0);assert.equal(f.card('focus').dataset.moveAffected,undefined);f.component.dispose();
});

function magneticFixture({reduced=false,motion=true}={}){
  let sequence=0,time=0;const frames=new Map(),events=new Map(),window={requestAnimationFrame(callback){frames.set(++sequence,callback);return sequence;},cancelAnimationFrame(id){frames.delete(id);},matchMedia(){return{matches:reduced};},addEventListener(type,callback){events.set(type,callback);},removeEventListener(type,callback){if(events.get(type)===callback)events.delete(type);}};
  const f=editor([placement('music','main',0,0),placement('focus','tall',2,0),placement('weather','small',2,2)],{window}),stage=f.modulesHost.querySelector('.experience-module-grid');stage.rect={left:20,top:40,width:812,height:368};f.document.body.dataset.motion=String(motion);const transfer={setData(){}};
  f.event(f.modulesHost,'pointerdown',f.card('music'),{pointerId:7,button:0,clientX:288,clientY:224});f.event(f.modulesHost,'dragstart',f.card('music'),{dataTransfer:transfer,clientX:297,clientY:226});
  const over=x=>f.event(f.modulesHost,'dragover',stage,{dataTransfer:transfer,clientX:288+x,clientY:224}),tick=()=>{time+=16;const pending=[...frames.values()];frames.clear();for(const callback of pending)callback(time);};
  return{...f,stage,frames,events,transfer,over,tick,preview:f.modulesHost.querySelector('.experience-grid-move-preview'),flush(){for(let count=0;frames.size&&count<300;count++)tick();assert.equal(frames.size,0);}};
}

test('the magnetic spring retargets persistent rectangles continuously and settles without changing the draft',()=>{
  const f=magneticFixture();f.over(268);const primary=f.preview.querySelector('[data-primary="true"]'),neighbor=f.preview.querySelector('[data-experience-module="focus"]');assert.equal(Number.parseFloat(primary.style.left),0);assert(f.frames.size);
  f.tick();const mid=Number.parseFloat(primary.style.left);assert(mid>0&&mid<100*276/812);
  f.over(0);assert.equal(f.preview.querySelector('[data-primary="true"]'),primary);assert.equal(f.preview.querySelector('[data-experience-module="focus"]'),neighbor);assert.equal(Number.parseFloat(primary.style.left),mid,'retargeting does not reset current position or velocity');f.flush();assert.equal(Number.parseFloat(primary.style.left),0);assert.deepEqual(f.changes,[]);
  f.over(268);f.document.body.dataset.motion='false';f.tick();assert.equal(Number.parseFloat(primary.style.left),100*276/812);assert.equal(f.frames.size,0,'disabling motion settles the pending spring immediately');f.component.dispose();
});

test('the actual drag preview holds its previous anchor through midpoint jitter and releases it beyond hysteresis',()=>{
  const f=magneticFixture();f.over(145);const primary=f.preview.querySelector('[data-primary="true"]');assert.equal(primary.dataset.gridColumn,'1');f.over(137);assert.equal(primary.dataset.gridColumn,'1');f.over(130);assert.equal(primary.dataset.gridColumn,'0');
  f.event(f.modulesHost,'drop',f.stage,{dataTransfer:f.transfer,clientX:418,clientY:224});assert.deepEqual(f.changes,[],'dropping the original displayed anchor is a no-op');assert.equal(f.preview.hidden,true);f.component.dispose();
});

test('a real host grid change cancels the old magnetic plan before an obsolete drop can overwrite it',()=>{
  const f=magneticFixture();f.over(268);const next=[placement('music','small',0,0),placement('focus','tall',2,0),placement('weather','small',2,2)];f.component.renderModules({...f.props,grid:next});
  assert.equal(f.preview.hidden,true);assert.equal(f.frames.size,0);f.event(f.modulesHost,'drop',f.stage,{dataTransfer:f.transfer,clientX:556,clientY:224});assert.deepEqual(f.changes,[]);assert.equal(f.card('music').dataset.gridPresentation,'small');assert.equal(f.card('music').style.gridColumn,'1 / span 1');f.component.dispose();
});

test('cosmetic host updates wait for the drag to finish and cannot destroy its source or overwrite the displayed plan',()=>{
  const f=magneticFixture();f.over(268);const source=f.card('music'),primary=f.preview.querySelector('[data-primary="true"]');f.component.renderModules({...f.props,previewRevision:1,definitions:[{id:'music',label:'Updated music'}]});
  assert.equal(f.card('music'),source);assert.equal(f.preview.querySelector('[data-primary="true"]'),primary);assert.equal(f.preview.hidden,false);assert.deepEqual(f.changes,[]);
  f.event(f.modulesHost,'drop',f.stage,{dataTransfer:f.transfer,clientX:556,clientY:224});assert.equal(f.changes.length,1);assert.equal(f.card('music').style.gridColumn,'2 / span 2');assert(f.card('music').attributes['aria-label'].includes('Updated music'));assert.equal(f.preview.hidden,true);f.component.dispose();
});

test('leaving the actual stage clears feedback without ending the drag and reentry restores the magnetic plan',()=>{
  const f=magneticFixture();f.over(268);const primary=f.preview.querySelector('[data-primary="true"]');f.event(f.modulesHost,'dragleave',f.card('music'),{relatedTarget:f.card('focus'),clientX:500,clientY:224});assert.equal(f.preview.querySelector('[data-primary="true"]'),primary);
  f.event(f.modulesHost,'dragleave',f.card('music'),{relatedTarget:f.document.body,clientX:900,clientY:224});assert.equal(f.preview.hidden,true);assert.equal(f.frames.size,0);assert.equal(f.card('music').dataset.dragging,'true');assert.deepEqual(f.changes,[]);
  f.over(268);assert.equal(f.preview.hidden,false);assert.equal(f.preview.querySelector('[data-primary="true"]').dataset.gridColumn,'1');f.event(f.modulesHost,'drop',f.stage,{dataTransfer:f.transfer,clientX:556,clientY:224});assert.equal(f.changes.length,1);assert.equal(f.card('music').style.gridColumn,'2 / span 2');f.component.dispose();assert.equal(f.modulesHost.listeners.dragleave,undefined);
});

for(const reduced of [false,true])test(`magnetic feedback has no animation frame when ${reduced?'the OS reduces motion':'app motion is disabled'}`,()=>{
  const f=magneticFixture({reduced,motion:reduced});f.over(268);assert.equal(Number.parseFloat(f.preview.querySelector('[data-primary="true"]').style.left),100*276/812);assert.equal(f.frames.size,0);assert.deepEqual(f.changes,[]);f.component.dispose();
});

for(const cancel of ['dragend','Escape','blur','outside','dispose'])test(`${cancel} removes the magnetic plan, neighbor effects and pending spring without applying it`,()=>{
  const f=magneticFixture();f.over(268);const delayed=[...f.frames.values()],card=f.card('music');assert.equal(f.preview.hidden,false);assert(f.frames.size);
  if(cancel==='Escape')f.event(f.modulesHost,'keydown',card,{key:'Escape'});else if(cancel==='blur')f.events.get('blur')();else if(cancel==='dispose')f.component.dispose();else if(cancel==='outside')f.event(f.modulesHost,'drop',f.stage,{dataTransfer:f.transfer,clientX:19,clientY:224});else f.event(f.modulesHost,'dragend',card);
  for(const callback of delayed)callback(32);assert.equal(f.preview.hidden,true);assert.equal(f.preview.children.length,0);assert.equal(f.frames.size,0);assert.equal(card.dataset.dragging,undefined);assert.equal(card.dataset.moveAffected,undefined);assert.deepEqual(f.changes,[]);assert.deepEqual(f.actions,[]);f.component.dispose();
});
