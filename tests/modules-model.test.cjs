const {test}=require('node:test');
const assert=require('node:assert/strict');
const {getModuleDefinitions,normalizeModules,assignModuleSlot,moduleEditorPresentation,FocusModel,moduleActivitySnapshot:snapshot,moduleActivityChange:change}=require('../notch.js');

test('module contracts have unique routes, bounded sizes and declared band capabilities',()=>{
 const definitions=getModuleDefinitions(); assert.equal(definitions.length,4);
 for(const key of['id','view','element'])assert.equal(new Set(definitions.map(item=>item[key])).size,4);
 for(const item of definitions){assert(item.size.minWidth>0&&item.size.minWidth<=item.size.width);assert(item.size.minHeight<=item.size.height&&item.size.height<=item.size.maxHeight);assert(['progress','status','none'].includes(item.band.discreet));assert(Array.isArray(item.band.changes));}
 for(const {id,editor,layout,size} of definitions){assert(layout.minWidth>0&&layout.minWidth<=layout.basis&&layout.basis<=layout.maxWidth);assert.equal(editor.basis,layout.basis+24);assert.equal(editor.maxWidth,layout.maxWidth+24);assert(editor.basis<=editor.maxWidth&&editor.maxWidth<=size.width+24);assert.equal(editor.height,layout.height+24);assert(editor.height<=300);assert.equal(layout.minHeight,layout.height);assert.equal(size.maxHeight,id==='focus'?420:300);assert(Number.isFinite(editor.grow)&&editor.grow>=0);}
 assert(definitions.find(item=>item.id==='focus').editor.basis>definitions.find(item=>item.id==='music').editor.basis,'the combined Focus and tasks module declares more width than the compact player');
 assert.equal(definitions.find(item=>item.id==='shelf').view,'tray'); assert.equal(definitions.find(item=>item.id==='weather').band.discreet,'none');
 const original={height:definitions[0].size.height,basis:definitions[0].editor.basis,minimum:definitions[0].layout.minWidth};
 definitions[0].size.height=9000;definitions[0].editor.basis=9000;definitions[0].layout.minWidth=1;definitions[0].band.changes.push('invented');assert.equal(getModuleDefinitions()[0].size.height,original.height);assert.equal(getModuleDefinitions()[0].editor.basis,original.basis);assert.equal(getModuleDefinitions()[0].layout.minWidth,original.minimum);assert(!getModuleDefinitions()[0].band.changes.includes('invented'));
});

test('gallery grows with placed modules and reveals just one free insertion target without rewriting slots',()=>{
 const two={enabled:['music','shelf','focus','weather'],slots:['music','shelf',null,null]},before=JSON.stringify(two);
 const placed=moduleEditorPresentation(two),adding=moduleEditorPresentation(two,'focus');
 assert.deepEqual(placed.indices,[0,1]);assert(placed.width>=700&&placed.width<=880);
 assert.deepEqual(adding.indices,[0,1,2]);assert(adding.width>placed.width&&adding.width<=880);
 const four=assignModuleSlot(assignModuleSlot(two,2,'focus'),3,'weather');assert.equal(moduleEditorPresentation(four).width,880);assert.equal(moduleEditorPresentation(four,'music').indices.length,4);
 assert.deepEqual(moduleEditorPresentation({enabled:[],slots:[]}).indices,[0]);assert.equal(moduleEditorPresentation({enabled:['music'],slots:[null,'music',null,null]},'focus').free,2);
 assert.equal(moduleEditorPresentation({enabled:['music','focus'],slots:['music',null,null,'focus']},'weather').free,1);assert.equal(JSON.stringify(two),before);
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
  getHomeSlots:()=>[],homeModuleLayout:()=>({items:[]}),homeModuleContext:()=>({}),getModuleEditorOrder:()=>[],isModuleEnabled:()=>false};
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

test('Focus deadlines and seconds do not trigger feedback while pause, resume, start and stop do',()=>{
 const idle=FocusModel.defaults(),run={...idle,sessionActive:true,deadline:60000,pomodoro:{work:1,rest:1,longRest:1,total:2,phase:'work',session:1}};
 const initial=snapshot('focus',idle),running=snapshot('focus',run);assert.equal(change('focus',initial,running).kind,'start');
 assert.equal(change('focus',running,snapshot('focus',{...run,deadline:90000,remaining:27})),null);
 const paused=snapshot('focus',{...run,deadline:null,remaining:30});assert.equal(change('focus',running,paused).kind,'pause');assert.equal(change('focus',paused,running).kind,'resume');
 assert.equal(change('focus',running,initial).kind,'stop');assert.equal(change('focus',null,running),null);
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
