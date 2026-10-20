const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ISLAND_CONFIG,getModuleDefinitions,normalizeModules,assignModuleSlot,moduleEditorPresentation,FocusModel,moduleActivitySnapshot:snapshot,moduleActivityChange:change}=require('../notch.js');

test('module contracts have unique routes, bounded sizes and declared band capabilities',()=>{
 const definitions=getModuleDefinitions(); assert.equal(definitions.length,4);
 for(const key of['id','view','element'])assert.equal(new Set(definitions.map(item=>item[key])).size,4);
 for(const item of definitions){assert(item.size.minWidth>0&&item.size.minWidth<=item.size.width);assert(item.size.minHeight<=item.size.height&&item.size.height<=item.size.maxHeight);assert(['progress','status','none'].includes(item.band.discreet));assert(Array.isArray(item.band.changes));}
 for(const {id,editor,layout,size} of definitions){assert(layout.minWidth>0&&layout.minWidth<=layout.basis&&layout.basis<=layout.maxWidth);assert.equal(editor.basis,layout.basis+24);assert.equal(editor.maxWidth,layout.maxWidth+24);assert(editor.basis<=editor.maxWidth);assert.equal(editor.height,id==='focus'?180:layout.height+24);assert(editor.height<=300);assert.equal(layout.minHeight,layout.height);assert.equal(size.maxHeight,id==='focus'?420:300);assert(Number.isFinite(editor.grow)&&editor.grow>=0);}
 assert(definitions.find(item=>item.id==='focus').layout.minWidth>=definitions.find(item=>item.id==='music').layout.minWidth,'compact Focus keeps enough room for its aligned timer controls');
 assert.equal(definitions.find(item=>item.id==='shelf').view,'tray'); assert.equal(definitions.find(item=>item.id==='weather').band.discreet,'none');
 const original={height:definitions[0].size.height,basis:definitions[0].editor.basis,minimum:definitions[0].layout.minWidth};
 definitions[0].size.height=9000;definitions[0].editor.basis=9000;definitions[0].layout.minWidth=1;definitions[0].band.changes.push('invented');assert.equal(getModuleDefinitions()[0].size.height,original.height);assert.equal(getModuleDefinitions()[0].editor.basis,original.basis);assert.equal(getModuleDefinitions()[0].layout.minWidth,original.minimum);assert(!getModuleDefinitions()[0].band.changes.includes('invented'));
});

test('module editor keeps three visible destinations inside the panel and preserves the legacy reserve',()=>{
 const two={enabled:['music','shelf','focus','weather'],slots:['music','shelf',null,null]},before=JSON.stringify(two);
 const placed=moduleEditorPresentation(two),adding=moduleEditorPresentation(two,'focus');
 assert.deepEqual(placed.indices,[0,1,2]);assert.equal(placed.width,ISLAND_CONFIG.states.expanded.width);assert.equal(placed.height,368);
 assert.deepEqual(placed.slots,['music','shelf',null]);assert.deepEqual(placed.presentations,['scene','rail','rail']);
 assert.deepEqual(adding,placed,'choosing a catalogue module never grows the editor or hides another destination');
 const four=assignModuleSlot(assignModuleSlot(two,2,'focus'),3,'weather'), full=moduleEditorPresentation(four);
 assert.equal(full.width,ISLAND_CONFIG.states.expanded.width);assert.deepEqual(full.indices,[0,1,2]);assert.deepEqual(full.slots,['music','shelf','focus']);
 const moved=assignModuleSlot(four,1,'weather');assert.deepEqual(moved.slots,['music','weather','focus','shelf'],'placing the reserve swaps rather than discards the visible module');
 assert.deepEqual(moduleEditorPresentation(moved).slots,['music','weather','focus']);
 const empty=moduleEditorPresentation({enabled:[],slots:[]});assert.deepEqual(empty.indices,[0,1,2]);assert.deepEqual(empty.slots,[null,null,null]);assert.equal(empty.free,0);
 const legacy=moduleEditorPresentation({enabled:['music','focus'],slots:[null,'music',null,'focus']},'focus');assert.equal(legacy.free,0);assert.deepEqual(legacy.slots,[null,'music',null]);assert.deepEqual(legacy.presentations,['rail','scene','rail']);
 assert.equal(JSON.stringify(two),before);
});

test('base catalogue preserves supported placements, holes and deliberate empty configurations',()=>{
 const old={enabled:['music','focus','weather','files','notices','clipboard'],slots:['music','files','weather','focus']},before=JSON.stringify(old);
 assert.deepEqual(normalizeModules(old),{enabled:['music','focus','weather'],slots:['music',null,'weather','focus']});
 assert.equal(JSON.stringify(old),before);
 assert.deepEqual(normalizeModules({enabled:[],slots:[]}),{enabled:[],slots:[null,null,null,null]});
 const cleaned=normalizeModules({enabled:['shelf','shelf','unknown'],slots:['shelf','shelf','unknown','focus','music']});
 assert.deepEqual(cleaned,{enabled:['shelf'],slots:['shelf',null,null,'focus']});
 assert.deepEqual(normalizeModules().enabled,['music','focus','shelf','weather']);
 assert.deepEqual(normalizeModules().slots,['music','focus','weather',null]);
 const placed=assignModuleSlot({enabled:['weather','focus'],slots:['weather','focus',null,null]},1,'weather');assert.deepEqual(placed.slots,['focus','weather',null,null]);
 assert.deepEqual(assignModuleSlot(old,1,'notices'),normalizeModules(old));
});

test('file tools stay an internal Shelf route without becoming an installable module',()=>{
 const source=require('node:fs').readFileSync(require.resolve('../notch.js'),'utf8');
 const start=source.indexOf('  function builtinVisible('),end=source.indexOf('  const homeCells',start);
 let editing=false;
 const scope={moduleDefinitions:Object.fromEntries(getModuleDefinitions().map(item=>[item.id,item])),getModuleEditorActive:()=>editing,
  getHomeSlots:()=>[],getModuleEditorOrder:()=>[],isModuleEnabled:()=>false};
 require('node:vm').runInNewContext(`let view='files';${source.slice(start,end)}this.api={builtinVisible,set view(value){view=value;}};`,scope);
 assert.equal(scope.api.builtinVisible('files'),true);assert(!getModuleDefinitions().some(row=>row.id==='files'));
 editing=true;assert.equal(scope.api.builtinVisible('files'),false);
 editing=false;scope.api.view='nook';assert.equal(scope.api.builtinVisible('files'),false);
});

test('music clock, artwork, capabilities and reconnects never masquerade as track changes',()=>{
 const music={available:true,title:'Blue Hour',artist:'Nova Coast',source:'Spotify',playing:true,position:1};const first=snapshot('music',music);
 assert.equal(change('music',null,first),null);assert.equal(change('music',snapshot('music',{available:false}),first),null);
 assert.equal(change('music',first,snapshot('music',{...music,position:99,cover:'new artwork',duration:200,canNext:false})),null);
 const track=snapshot('music',{...music,title:'New Song'});assert.equal(change('music',first,track).kind,'track');assert.equal(change('music',track,track),null);
 const paused=snapshot('music',{...music,playing:false});assert.equal(change('music',first,paused).kind,'pause');assert.equal(change('music',paused,first).kind,'resume');
 assert.equal(change('music',first,snapshot('music',{available:false})),null);
});

test('Focus snapshots distinguish manual controls without turning clock ticks into events',()=>{
 const idle=FocusModel.defaults(),run={...idle,sessionActive:true,deadline:60000,pomodoro:{work:1,rest:1,longRest:1,total:2,phase:'work',session:1}};
 const initial=snapshot('focus',idle),running=snapshot('focus',run);assert.equal(change('focus',initial,running).kind,'start');
 assert.equal(change('focus',running,snapshot('focus',{...run,deadline:90000,remaining:27})),null);
 const paused=snapshot('focus',{...run,deadline:null,remaining:30});assert.equal(change('focus',running,paused).kind,'pause');assert.equal(change('focus',paused,running).kind,'resume');
 assert.equal(change('focus',running,initial).kind,'stop');assert.equal(change('focus',null,running),null);
});

test('manual music and Focus controls stay quiet while track changes and milestones remain visible',()=>{
 const music=getModuleDefinitions().find(item=>item.id==='music'), focus=getModuleDefinitions().find(item=>item.id==='focus');
 for(const kind of ['start','stop','pause','resume']){assert(!music.band.changes.includes(kind));assert(!focus.band.changes.includes(kind));}
 assert(music.band.changes.includes('track'));
 for(const kind of ['phase','complete','task-complete'])assert(focus.band.changes.includes(kind));
});

test('short break, next session, long break and final completion produce one meaningful cue each',()=>{
 const focus={...FocusModel.defaults(),minutes:1,remaining:60,sessionActive:true,deadline:60000,pomodoro:{work:1,rest:1,longRest:1,total:2,phase:'work',session:1}};
 let previous=snapshot('focus',focus);const results=[];
 for(const now of[60000,120000,180000,240000]){FocusModel.tick(focus,now);const next=snapshot('focus',focus);results.push(change('focus',previous,next));assert.equal(change('focus',next,snapshot('focus',focus)),null);previous=next;}
 assert.deepEqual(results.map(item=>item.kind),['phase','phase','phase','complete']);assert.equal(results[0].title,'Pause courte');assert.equal(results[1].title,'Concentration');assert.equal(results[2].title,'Pause longue');
});

test('sleep catchup reports only the final state and restoration starts with a silent baseline',()=>{
 const value={...FocusModel.defaults(),minutes:1,remaining:60,sessionActive:true,deadline:60000,pomodoro:{work:1,rest:1,longRest:1,total:2,phase:'work',session:1}};
 const previous=snapshot('focus',value);FocusModel.tick(value,240000);assert.equal(change('focus',previous,snapshot('focus',value)).kind,'complete');
 const restored=FocusModel.restore(value,240000);FocusModel.tick(restored,240000);const baseline=snapshot('focus',restored);assert.equal(change('focus',baseline,snapshot('focus',restored)),null);
});
