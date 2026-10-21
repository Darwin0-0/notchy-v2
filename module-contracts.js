(function(root,factory){
  'use strict';
  const api=factory(typeof module==='object'&&module.exports?require('./tokens.js'):root.NOTCH_TOKENS);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.NotchyLayout=api;
})(typeof window==='object'?window:null,function(Tokens){
  'use strict';
  const VERSION=2, PRESENTATIONS=Object.freeze(['full','main','side','tall','wide','small']);
  const grid=Object.freeze({columns:3,rows:3,cellWidth:260,cellHeight:112,gap:16,padding:16,width:812,height:368});
  const formats=Object.freeze(Object.fromEntries(Object.entries({small:[1,1],wide:[2,1],tall:[1,2],side:[1,3],main:[2,3],full:[3,3]}).map(([name,[cols,rows]])=>[name,Object.freeze({cols,rows,width:cols*grid.cellWidth+(cols-1)*grid.gap,height:rows*grid.cellHeight+(rows-1)*grid.gap})])));
  const metrics=Object.freeze({gap:grid.gap,pairGap:grid.gap,padding:grid.padding,
    pairMainShare:formats.main.width/(grid.width-grid.gap),tripleMainShare:formats.main.width/(grid.width-grid.gap),mainMinWidth:536,sideMinWidth:260,compactMainMinWidth:252,compactGap:grid.gap,smallMinHeight:112,compactHeight:112,
    canvasInset:24,compactPadding:16,modulePadding:24,labInset:40,radius:24,sceneHeight:grid.height});
  const surfaceLimits=Object.freeze({richMinWidth:grid.width+grid.padding*2,maxWidth:Tokens.island.states.expanded.width,sceneHeight:Tokens.island.activities.sceneHeight,fullHeight:Tokens.island.activities.fullHeight,labHeight:Tokens.island.activities.sceneHeight+metrics.labInset,fullLabHeight:Tokens.island.activities.fullHeight+metrics.labInset});
  const getFormat=presentation=>Object.hasOwn(formats,presentation)?{...formats[presentation]}:null;
  const copy=value=>JSON.parse(JSON.stringify(value));
  function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
  function object(value){return !!value&&typeof value==='object'&&!Array.isArray(value);}
  function exact(value,keys){return object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));}
  function normalizeLayout(value){
    function inert(input,depth=0){
      if(depth>8)throw new TypeError('Module layout is too deep');
      if(input===null||typeof input!=='object')return;
      const proto=Object.getPrototypeOf(input);
      if(proto!==Object.prototype&&proto!==null)throw new TypeError('Module layout must contain plain objects');
      for(const key of Reflect.ownKeys(input)){
        if(typeof key!=='string'||['__proto__','constructor','prototype'].includes(key))throw new TypeError('Invalid module layout key');
        const descriptor=Object.getOwnPropertyDescriptor(input,key);
        if(!descriptor||!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))throw new TypeError('Module layout needs enumerable data properties');
        inert(descriptor.value,depth+1);
      }
    }
    inert(value);
    if(!object(value)||!Object.keys(value).length||Object.keys(value).some(key=>!PRESENTATIONS.includes(key)))throw new TypeError('Unknown or empty module layout');
    const result={};
    for(const key of PRESENTATIONS){
      if(!Object.hasOwn(value,key))continue;
      const presentation=value[key];
      if(!exact(presentation,['min','ideal']))throw new TypeError('A presentation needs min and ideal dimensions');
      for(const size of [presentation.min,presentation.ideal])if(!exact(size,['width','height'])||Object.values(size).some(number=>!Number.isInteger(number)||number<1||number>4096))throw new TypeError('Invalid module dimensions');
      if(presentation.ideal.width<presentation.min.width||presentation.ideal.height<presentation.min.height)throw new TypeError('Ideal dimensions cannot be smaller than the minimum');
      result[key]={min:{...presentation.min},ideal:{...presentation.ideal}};
    }
    return result;
  }
  const size=(w,h,iw,ih)=>({min:{width:w,height:h},ideal:{width:iw,height:ih}});
  const builtin=freeze({
    music:{id:'music',layout:{full:size(160,154,812,368),main:size(160,154,536,368),side:size(222,128,260,368),tall:size(222,128,260,240),wide:size(300,64,536,112),small:size(144,64,260,112)}},
    focus:{id:'focus',layout:{full:size(640,304,812,368),main:size(500,304,536,368),side:size(220,304,260,368),tall:size(220,220,260,240),wide:size(500,104,536,112),small:size(196,88,260,112)}},
    weather:{id:'weather',layout:{full:size(640,354,812,368),main:size(500,354,536,368),side:size(220,220,260,368),tall:size(220,220,260,240),wide:size(500,104,536,112),small:size(196,104,260,112)}},
    shelf:{id:'shelf',layout:{full:size(200,148,812,368),main:size(184,148,536,368),side:size(144,104,260,368),small:size(196,104,260,112)}}
  });
  const defaultCommunity=freeze({full:size(160,180,812,368),main:size(160,164,536,368),side:size(144,164,260,368),tall:size(144,164,260,240),wide:size(128,104,536,112),small:size(128,104,260,112)});
  function getBuiltinContract(id){return Object.hasOwn(builtin,id)?copy(builtin[id]):null;}
  function getCommunityContract(manifest){
    if(!object(manifest)||![Object.prototype,null].includes(Object.getPrototypeOf(manifest)))throw new TypeError('A plain module manifest is required');
    for(const key of Reflect.ownKeys(manifest)){
      const descriptor=Object.getOwnPropertyDescriptor(manifest,key);
      if(typeof key!=='string'||['__proto__','constructor','prototype'].includes(key)||!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))throw new TypeError('A manifest must contain only JSON data');
    }
    const id=Object.getOwnPropertyDescriptor(manifest,'id')?.value,layout=Object.getOwnPropertyDescriptor(manifest,'layout')?.value;
    if(typeof id!=='string')throw new TypeError('A module ID is required');
    return {id,layout:layout===undefined?copy(defaultCommunity):normalizeLayout(layout)};
  }
  function supports(contract,presentation){return PRESENTATIONS.includes(presentation)&&object(contract?.layout)&&Object.hasOwn(contract.layout,presentation);}
  function legacyPresentation(presentation){return presentation==='full'?'full':['small','wide'].includes(presentation)?'rail':['main','side','tall'].includes(presentation)?'scene':null;}
  function supportedFormats(contract){return PRESENTATIONS.filter(presentation=>supports(contract,presentation));}
  function resolvePresentation(contract,requested,{width,height,allowFallback=true}={}){
    if(!PRESENTATIONS.includes(requested)||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return null;
    const fallback={full:['full','main','side','tall','wide','small'],main:['main','side','tall','wide','small'],side:['side','tall','small'],tall:['tall','side','small'],wide:['wide','small'],small:['small']};
    const candidates=allowFallback?fallback[requested]:[requested];
    for(const presentation of candidates){
      if(!supports(contract,presentation))continue;
      const spec=contract.layout[presentation];
      if(width+1e-6<spec.min.width||height+1e-6<spec.min.height)continue;
      return {presentation,legacyPresentation:legacyPresentation(presentation),fits:true,min:{...spec.min},ideal:{...spec.ideal},fallback:presentation!==requested};
    }
    return null;
  }
  function resolveDurationLayouts({width,height}={}){
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return null;
    const timer=width>=440&&height>=240?'full':width>=440&&height>=180?'details':width>=440&&height>=120?'half':width>=220&&height>=120?'quarter':null;
    return timer?{tasks:width>=440&&height>=240?'full':'quarter',timer}:null;
  }
  // This is the only place that allocates home geometry. Module renderers
  // receive an assignment; no module can enlarge or promote its own slot.
  function planSlots(entries,{width,height=metrics.sceneHeight,density='regular',getContract=getBuiltinContract,forced=null}={}){
    const source=Array.isArray(entries)?entries.filter((entry,index,list)=>object(entry)&&typeof entry.id==='string'&&list.findIndex(value=>value?.id===entry.id)===index).slice(0,3):[];
    const w=Number.isFinite(width)?Math.max(0,width):0,h=Number.isFinite(height)?Math.max(0,height):0;
    const compactDensity=density==='compact',mainMinimum=compactDensity?metrics.compactMainMinWidth:metrics.mainMinWidth,fixedSideWidth=metrics.sideMinWidth;
    const count=source.length,gap=Math.min(metrics.gap,w/4,h/4),requestedRoles=count===1?['full']:count===2?['main','side']:['main','tall','small'];
    const contracts=source.map(entry=>entry.contract||getContract(entry.id)),pairSideWidth=Math.max(0,(w-2*gap)/3),pairMainWidth=Math.max(0,w-gap-pairSideWidth);
    const pairFits=count===2&&source.every((entry,index)=>resolvePresentation(contracts[index],forced?.id===entry.id?forced.presentation:requestedRoles[index],{width:index===0?pairMainWidth:pairSideWidth,height:h,allowFallback:forced?.id!==entry.id}));
    const narrow=count===2?!pairFits:count>1&&w<mainMinimum+fixedSideWidth+gap;
    const sideWidth=count>1?(narrow?w:count===2?pairSideWidth:Math.min(w-gap-mainMinimum,fixedSideWidth)):0;
    const mainWidth=count===1||narrow?w:Math.max(0,w-gap-sideWidth);
    // Narrow windows keep the primary card readable and companions reachable,
    // rather than stacking rich cards beneath the native window's bounds.
    const compactHeight=narrow&&count>1?Math.min(metrics.compactHeight,Math.max(0,(h-gap*(count-1))/count)):0;
    const mainHeight=narrow?Math.max(0,h-(count-1)*(compactHeight+gap)):h;
    const lastContract=count===3?contracts[2]:null;
    const smallHeight=count===3&&!narrow?Math.min(Math.max(0,h-gap),lastContract?.layout?.small?.ideal.height||metrics.compactHeight):0;
    const sideHeight=Math.max(0,h-gap-smallHeight);
    const items=source.map((entry,index)=>{
      const slot=index===0?'main':index===1?'side':'small',requested=forced?.id===entry.id?forced.presentation:narrow&&index>0?'small':requestedRoles[index];
      const rect=index===0?{x:0,y:0,width:mainWidth,height:mainHeight}:narrow?{x:0,y:mainHeight+gap+(index-1)*(compactHeight+gap),width:w,height:compactHeight}:count===2?{x:mainWidth+gap,y:0,width:sideWidth,height:h}:{x:mainWidth+gap,y:index===1?0:sideHeight+gap,width:sideWidth,height:index===1?sideHeight:smallHeight};
      const contract=contracts[index],resolved=resolvePresentation(contract,requested,{width:rect.width,height:rect.height,allowFallback:forced?.id!==entry.id});
      const presentation=resolved?.presentation||null;
      return {...entry,...rect,slot,requested,presentation,legacyPresentation:resolved?.legacyPresentation||legacyPresentation(requested),fits:!!resolved,fallback:!!resolved?.fallback,reason:resolved?(resolved.fallback?'space-fallback':null):supports(contract,requested)?'insufficient-space':'unsupported-presentation',min:resolved?.min||null,ideal:resolved?.ideal||null,compact:!!resolved&&presentation==='small'&&!['focus','weather'].includes(entry.id)&&rect.height<104,duration:resolveDurationLayouts(rect)};
    });
    return {version:VERSION,width:w,height:h,gap,mode:narrow?'compact-stack':count===1?'full':count===2?'pair':'triple',items};
  }
  // Editor and Lab use the same cell spans as the live module canvas. Invalid
  // arrangements are rejected before their saved placement can be changed.
  function planGrid(entries,{width=grid.width,height=grid.height,getContract=getBuiltinContract}={}){
    if(!Array.isArray(entries)||entries.length>grid.columns*grid.rows)throw new TypeError('A grid needs at most nine module placements');
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<0||height<0)throw new TypeError('Invalid grid dimensions');
    const gap=Math.min(grid.gap,width/4,height/4),cellWidth=Math.max(0,(width-gap*2)/grid.columns),cellHeight=Math.max(0,(height-gap*2)/grid.rows),occupied=new Set(),ids=new Set();
    const items=entries.map((entry,index)=>{
      if(!object(entry)||typeof entry.id!=='string'||!entry.id||ids.has(entry.id))throw new TypeError('Grid module IDs must be unique');
      ids.add(entry.id);
      const {presentation,column=0,row=0}=entry,format=getFormat(presentation);
      if(!format||!Number.isInteger(column)||!Number.isInteger(row)||column<0||row<0||column+format.cols>grid.columns||row+format.rows>grid.rows)throw new RangeError('The module format must fit inside the grid');
      for(let y=row;y<row+format.rows;y++)for(let x=column;x<column+format.cols;x++){
        const key=y*grid.columns+x;if(occupied.has(key))throw new RangeError('Module cells overlap');occupied.add(key);
      }
      const rect={x:column*(cellWidth+gap),y:row*(cellHeight+gap),width:format.cols*cellWidth+(format.cols-1)*gap,height:format.rows*cellHeight+(format.rows-1)*gap};
      const contract=entry.contract||getContract(entry.id),resolved=resolvePresentation(contract,presentation,{...rect,allowFallback:false});
      return {...entry,...rect,column,row,cols:format.cols,rows:format.rows,slot:index===0?'main':index===1?'side':'small',requested:presentation,presentation:resolved?.presentation||null,legacyPresentation:legacyPresentation(presentation),fits:!!resolved,fallback:false,reason:resolved?null:supports(contract,presentation)?'insufficient-space':'unsupported-presentation',min:resolved?.min||null,ideal:resolved?.ideal||null,compact:false,duration:resolveDurationLayouts(rect)};
    });
    const freeCells=[];for(let row=0;row<grid.rows;row++)for(let column=0;column<grid.columns;column++)if(!occupied.has(row*grid.columns+column))freeCells.push({column,row});
    return {version:VERSION,width,height,gap,mode:'grid',items,freeCells};
  }
  // A move anchors one module and repacks the same rectangles. Resize and Add
  // still use strict planGrid validation, so a gesture cannot change a format.
  function planGridMove(entries,target,options={}){
    try{
      if(!object(target)||typeof target.id!=='string'||!Number.isInteger(target.column)||!Number.isInteger(target.row))return null;
      const contracts=new Map(),lookup=options.getContract||getBuiltinContract;
      const settings={...options,getContract(id){if(!contracts.has(id))contracts.set(id,lookup(id));return contracts.get(id);}};
      const original=planGrid(entries,settings),source=original.items.find(item=>item.id===target.id);
      if(!source||original.items.some(item=>!item.fits)||target.column<0||target.row<0||target.column+source.cols>grid.columns||target.row+source.rows>grid.rows)return null;
      const maskFor=(column,row,cols,rows)=>{let mask=0;for(let y=row;y<row+rows;y++)for(let x=column;x<column+cols;x++)mask|=1<<(y*grid.columns+x);return mask;};
      const vacated=maskFor(source.column,source.row,source.cols,source.rows),remaining=original.items.filter(item=>item.id!==source.id).map((item,index)=>({...item,index}));
      remaining.sort((a,b)=>b.cols*b.rows-a.cols*a.rows||a.index-b.index);
      const choices=remaining.map(item=>{
        const positions=[];for(let row=0;row+item.rows<=grid.rows;row++)for(let column=0;column+item.cols<=grid.columns;column++)positions.push({column,row,mask:maskFor(column,row,item.cols,item.rows)});
        positions.sort((a,b)=>Math.abs(a.column-item.column)+Math.abs(a.row-item.row)-Math.abs(b.column-item.column)-Math.abs(b.row-item.row)||Number(!!(b.mask&vacated))-Number(!!(a.mask&vacated))||a.row-b.row||a.column-b.column);
        return positions;
      });
      const chosen=new Map([[source.id,{column:target.column,row:target.row}]]),failed=new Set();
      function place(index,occupied){
        if(index===remaining.length)return true;
        const key=index+':'+occupied;if(failed.has(key))return false;
        for(const position of choices[index])if(!(position.mask&occupied)){
          chosen.set(remaining[index].id,position);
          if(place(index+1,occupied|position.mask))return true;
        }
        chosen.delete(remaining[index].id);failed.add(key);return false;
      }
      // At most nine levels and 512 occupancy masks per level, even for nine Small modules.
      if(!place(0,maskFor(target.column,target.row,source.cols,source.rows)))return null;
      const placements=entries.map(entry=>({...entry,column:chosen.get(entry.id).column,row:chosen.get(entry.id).row})),plan=planGrid(placements,settings);
      return plan.items.every(item=>item.fits)?{placements,plan}:null;
    }catch{return null;}
  }
  // Pointer origins use logical grid units; a small hold margin avoids target flicker.
  function snapGridMove(entries,target,options={}){
    try{
      if(!object(target)||!Number.isFinite(target.x)||!Number.isFinite(target.y))return null;
      const contracts=new Map(),lookup=options.getContract||getBuiltinContract,settings={...options,getContract(id){if(!contracts.has(id))contracts.set(id,lookup(id));return contracts.get(id);}};
      const original=planGrid(entries,settings),source=original.items.find(item=>item.id===target.id);
      if(!source||original.items.some(item=>!item.fits))return null;
      const candidates=[],pitchX=(original.width-original.gap*2)/grid.columns+original.gap,pitchY=(original.height-original.gap*2)/grid.rows+original.gap;
      for(let row=0;row+source.rows<=grid.rows;row++)for(let column=0;column+source.cols<=grid.columns;column++){
        const result=planGridMove(entries,{id:target.id,column,row},settings);if(!result)continue;
        const x=column*pitchX,y=row*pitchY;
        candidates.push({...result,target:{column,row,x,y},distance:Math.hypot(target.x-x,target.y-y)});
      }
      candidates.sort((a,b)=>a.distance-b.distance||a.target.row-b.target.row||a.target.column-b.target.column);
      const best=candidates[0];if(!best)return null;
      const previous=target.previous||source,held=candidates.find(item=>item.target.column===previous.column&&item.target.row===previous.row);
      return held&&held.distance<=best.distance+original.gap/2?held:best;
    }catch{return null;}
  }
  function applyTokens(host){if(!host?.style)return;const padding=['small','wide'].includes(host.dataset?.modulePresentation)?metrics.compactPadding:['side','tall'].includes(host.dataset?.modulePresentation)?20:metrics.modulePadding;for(const [name,value]of Object.entries({'--slot-main-min-width':metrics.mainMinWidth,'--slot-side-width':metrics.sideMinWidth,'--slot-small-min-height':metrics.smallMinHeight,'--module-padding':padding,'--module-lab-inset':metrics.labInset,'--module-canvas-inset':metrics.canvasInset,'--module-compact-padding':metrics.compactPadding,'--gap-between-modules':metrics.gap,'--radius-module':metrics.radius}))host.style.setProperty(name,value+'px');}
  function clearHost(host){if(!host?.dataset)return;for(const key of ['moduleSlot','modulePresentation','moduleReason','moduleCols','moduleRows','moduleColumn','moduleRow','durationTasks','durationTimer','slotFits'])delete host.dataset[key];}
  function applyHost(host,assignment){
    if(!host?.dataset||!assignment)return false;
    host.dataset.moduleSlot=assignment.slot;host.dataset.modulePresentation=assignment.presentation||'unavailable';host.dataset.moduleId=assignment.id;host.dataset.slotFits=String(assignment.fits!==false);
    for(const [key,value]of Object.entries({moduleCols:assignment.cols,moduleRows:assignment.rows,moduleColumn:assignment.column,moduleRow:assignment.row}))if(Number.isInteger(value))host.dataset[key]=String(value);else delete host.dataset[key];
    host.dataset.presentation=assignment.legacyPresentation||legacyPresentation(assignment.presentation)||'rail';
    if(assignment.reason)host.dataset.moduleReason=assignment.reason;else delete host.dataset.moduleReason;
    const duration=assignment.duration||resolveDurationLayouts(assignment);
    if(duration){host.dataset.durationTasks=duration.tasks;host.dataset.durationTimer=duration.timer;}else{delete host.dataset.durationTasks;delete host.dataset.durationTimer;}
    applyTokens(host);return true;
  }
  return Object.freeze({VERSION,PRESENTATIONS,grid,formats,getFormat,supportedFormats,metrics,surfaceLimits,normalizeLayout,getBuiltinContract,getCommunityContract,supports,legacyPresentation,resolvePresentation,resolveDurationLayouts,planSlots,planGrid,planGridMove,snapGridMove,applyTokens,applyHost,clearHost});
});
