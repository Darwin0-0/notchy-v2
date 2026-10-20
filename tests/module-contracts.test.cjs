'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Layout=require('../module-contracts.js'),Tokens=require('../tokens.js');
const dimension=(width=160,height=120)=>({width,height});
const spec=(width=160,height=120)=>({min:dimension(width,height),ideal:dimension(width+40,height+40)});
const contract=(id='community.test')=>({id,layout:{full:spec(),main:spec(),side:spec(),small:spec()}});
const ownNull=value=>Object.assign(Object.create(null),value);
const clone=value=>JSON.parse(JSON.stringify(value));

test('layout contracts accept only declared presentation keys and exact bounded dimensions',()=>{
  for(const presentation of Layout.PRESENTATIONS){
    const value={[presentation]:{min:dimension(1,1),ideal:dimension(4096,4096)}};
    assert.deepEqual(Layout.normalizeLayout(value),value);
    assert.deepEqual(Layout.normalizeLayout({[presentation]:{min:dimension(4096,4096),ideal:dimension(4096,4096)}}),{[presentation]:{min:dimension(4096,4096),ideal:dimension(4096,4096)}});
  }
  for(const value of [null,undefined,[],{},'full',{scene:spec()},{rail:spec()},{unknown:spec()},{full:null},{full:[]},{full:{min:null,ideal:dimension()}},{full:{min:dimension()}},{full:{min:dimension(),ideal:dimension(),extra:1}},{full:{min:{width:1,height:1,extra:1},ideal:dimension()}}])assert.throws(()=>Layout.normalizeLayout(value),TypeError);
  for(const bad of [0,-1,4097,1.5,NaN,Infinity,-Infinity,'160',null,true,undefined])for(const member of ['min','ideal'])for(const axis of ['width','height']){
    const value={full:spec()};value.full[member][axis]=bad;
    assert.throws(()=>Layout.normalizeLayout(value),TypeError,member+'.'+axis+' rejects '+String(bad));
  }
  for(const axis of ['width','height']){const value={full:spec()};value.full.ideal[axis]=value.full.min[axis]-1;assert.throws(()=>Layout.normalizeLayout(value),TypeError);}
});

test('normalization copies plain or null-prototype data without changing caller-owned contracts',()=>{
  const value=ownNull({full:ownNull({min:ownNull(dimension()),ideal:ownNull(dimension(200,160))})}),before=clone(value),normalized=Layout.normalizeLayout(value);
  assert.deepEqual(normalized,before);assert.deepEqual(clone(value),before);assert.notEqual(normalized,value);assert.notEqual(normalized.full.min,value.full.min);
  normalized.full.min.width=1;assert.equal(value.full.min.width,160);
  const manifest={id:'community.real',layout:{side:spec(180,140)}},community=Layout.getCommunityContract(manifest);
  assert.equal(community.id,manifest.id);assert.deepEqual(community.layout,manifest.layout);community.layout.side.min.width=1;assert.equal(manifest.layout.side.min.width,180);
});

test('layout and dimension objects reject custom prototypes, symbols and hidden unknown keys',()=>{
  const invalid=[];
  const root=Object.assign(Object.create({inherited:true}),{full:spec()});invalid.push(root);
  const presentation={full:Object.assign(Object.create({inherited:true}),spec())};invalid.push(presentation);
  const dimensions={full:spec()};dimensions.full.min=Object.assign(Object.create({inherited:true}),dimension());invalid.push(dimensions);
  for(const level of ['root','presentation','dimensions']){
    const symbolic={full:spec()},hidden={full:spec()};
    const select=value=>level==='root'?value:level==='presentation'?value.full:value.full.ideal;
    select(symbolic)[Symbol('unexpected')]=1;Object.defineProperty(select(hidden),'unexpected',{value:1,enumerable:false});invalid.push(symbolic,hidden);
  }
  for(const key of ['__proto__','prototype','constructor']){const value={full:spec()};Object.defineProperty(value,key,{value:spec(),enumerable:true});invalid.push(value);}
  for(const value of invalid)assert.throws(()=>Layout.normalizeLayout(value),TypeError);
});

test('accessors at every contract level are rejected without executing module code',()=>{
  for(const target of ['root','presentation','dimensions']){
    let reads=0;const value={full:spec()},object=target==='root'?value:target==='presentation'?value.full:value.full.min,key=target==='root'?'full':target==='presentation'?'min':'width';
    Object.defineProperty(object,key,{enumerable:true,get(){reads++;return target==='root'?spec():target==='presentation'?dimension():160;}});
    let error;try{Layout.normalizeLayout(value);}catch(cause){error=cause;}
    assert.equal(reads,0,target+' accessor must not execute');assert(error instanceof TypeError,target+' accessor must be rejected');
  }
});

test('the contract lookup cannot execute a manifest ID or layout accessor',()=>{
  for(const key of ['id','layout']){
    let reads=0;const manifest={id:'community.safe',layout:{full:spec()}};
    Object.defineProperty(manifest,key,{enumerable:true,get(){reads++;return key==='id'?'community.safe':{full:spec()};}});
    let error;try{Layout.getCommunityContract(manifest);}catch(cause){error=cause;}
    assert.equal(reads,0,key+' accessor must not execute');assert(error instanceof TypeError,key+' accessor must be rejected');
  }
});

test('built-in lookups return independent contracts and keep Shelf limited to its four supported formats',()=>{
  for(const id of ['music','focus','weather','shelf']){
    const first=Layout.getBuiltinContract(id),second=Layout.getBuiltinContract(id);assert.equal(first.id,id);assert.deepEqual(first,second);assert.notEqual(first,second);
    const presentation=Object.keys(first.layout)[0];first.layout[presentation].min.width=1;assert.notEqual(Layout.getBuiltinContract(id).layout[presentation].min.width,1);
  }
  for(const id of ['unknown','tasks','__proto__','constructor',null])assert.equal(Layout.getBuiltinContract(id),null);
  const shelf=Layout.getBuiltinContract('shelf');assert.equal(Layout.supports(shelf,'small'),true);assert.deepEqual(shelf.layout.small,{min:{width:196,height:104},ideal:{width:260,height:112}});for(const presentation of ['wide','tall']){assert.equal(Layout.supports(shelf,presentation),false);assert.equal(Layout.resolvePresentation(shelf,presentation,{width:4096,height:4096,allowFallback:false}),null);}
  const result=Layout.planSlots([{id:'music'},{id:'focus'},{id:'shelf'}],{width:562,height:260}).items[2];assert.equal(result.fits,false);assert.equal(result.presentation,null);assert.equal(result.reason,'insufficient-space');
});

test('six canonical cell formats preserve safe renderer aliases and exact grid spans',()=>{
  assert.deepEqual(Layout.PRESENTATIONS,['full','main','side','tall','wide','small']);
  for(const value of [Layout.PRESENTATIONS,Layout.metrics,Layout.grid,Layout.formats,...Object.values(Layout.formats)])assert(Object.isFrozen(value));
  assert.deepEqual(Layout.grid,{columns:3,rows:3,cellWidth:260,cellHeight:112,gap:16,padding:16,width:812,height:368});
  for(const [presentation,cols,rows,width,height,legacy]of [['small',1,1,260,112,'rail'],['wide',2,1,536,112,'rail'],['tall',1,2,260,240,'scene'],['side',1,3,260,368,'scene'],['main',2,3,536,368,'scene'],['full',3,3,812,368,'full']]){
    assert.deepEqual(Layout.getFormat(presentation),{cols,rows,width,height});assert.equal(Layout.legacyPresentation(presentation),legacy);
    assert.equal(width,cols*260+(cols-1)*16);assert.equal(height,rows*112+(rows-1)*16);
    const format=Layout.getFormat(presentation);format.width=0;assert.equal(Layout.getFormat(presentation).width,width);
  }
  for(const name of ['scene','rail','overlay','constructor','other',undefined]){assert.equal(Layout.legacyPresentation(name),null);assert.equal(Layout.getFormat(name),null);}
  for(const id of ['music','focus','weather'])assert.deepEqual(Layout.supportedFormats(Layout.getBuiltinContract(id)),Layout.PRESENTATIONS);
  assert.deepEqual(Layout.supportedFormats(Layout.getBuiltinContract('shelf')),['full','main','side','small']);
});

function permutations(values,count){return count?values.flatMap((value,index)=>permutations(values.filter((_,other)=>other!==index),count-1).map(rest=>[value,...rest])):[[]];}
function assertGeometry(plan,label){
  const epsilon=1e-6;
  for(const item of plan.items){
    for(const key of ['x','y','width','height'])assert(Number.isFinite(item[key])&&item[key]>=0,label+' finite '+key);
    assert(item.x+item.width<=plan.width+epsilon,label+' stays within horizontal host bounds');assert(item.y+item.height<=plan.height+epsilon,label+' stays within vertical host bounds');
    if(item.fits){const declared=(item.contract||Layout.getBuiltinContract(item.id)).layout[item.presentation];assert(declared,label+' uses a supported presentation');assert(item.width+epsilon>=declared.min.width&&item.height+epsilon>=declared.min.height,label+' respects declared minimum');assert.deepEqual(item.min,declared.min);}
    else{assert.equal(item.presentation,null);assert.equal(item.min,null);assert(['insufficient-space','unsupported-presentation'].includes(item.reason));}
  }
  for(let a=0;a<plan.items.length;a++)for(let b=a+1;b<plan.items.length;b++){
    const first=plan.items[a],second=plan.items[b];
    assert(first.x+first.width<=second.x+epsilon||second.x+second.width<=first.x+epsilon||first.y+first.height<=second.y+epsilon||second.y+second.height<=first.y+epsilon,label+' module rectangles never overlap');
  }
}

test('one logical 844 by 464 panel owns every display scale and all module gutters',()=>{
  const {surfaceLimits,metrics}=Layout;
  assert(Object.isFrozen(surfaceLimits));assert.equal(surfaceLimits.richMinWidth,844);assert.equal(surfaceLimits.maxWidth,844);
  assert.equal(surfaceLimits.richMinWidth,metrics.mainMinWidth+metrics.sideMinWidth+metrics.gap+2*metrics.padding);
  assert.deepEqual([metrics.mainMinWidth,metrics.sideMinWidth,metrics.gap,metrics.padding,metrics.sceneHeight,metrics.radius],[536,260,16,16,368,24]);
  assert.deepEqual(Tokens.island.formats,{compact:844,balanced:844,comfortable:844});
  assert.deepEqual(Tokens.island.displayScales,{compact:.7,balanced:.85,comfortable:1});
  assert.equal(surfaceLimits.sceneHeight,464);assert.equal(surfaceLimits.labHeight,504);
  assert.equal(Tokens.island.activities.sceneTop+metrics.sceneHeight+Tokens.island.activities.bottom,464);
  assert.equal(Tokens.island.layout.columns,3);assert.equal(Tokens.island.layout.rows,3);
});

test('one module fills the six-cell wide scene and every pair follows the exact two-to-one cell split',()=>{
  for(const id of ['music','focus','weather','shelf']){
    const plan=Layout.planSlots([{id}],{width:812,height:368});assertGeometry(plan,id+' full');
    assert.deepEqual(plan.items.map(({presentation,x,y,width,height})=>[presentation,x,y,width,height]),[['full',0,0,812,368]]);
  }
  for(const ids of permutations(['music','focus','weather','shelf'],2))for(const density of ['compact','regular','unknown']){
    const entries=ids.map(id=>({id})),before=clone(entries),plan=Layout.planSlots(entries,{width:812,height:368,density});
    assertGeometry(plan,ids.join('+'));assert.equal(plan.mode,'pair');assert.equal(plan.gap,16);assert(plan.items.every(item=>item.fits));
    assert.deepEqual(plan.items.map(({presentation,x,y,width,height})=>[presentation,x,y,width,height]),[['main',0,0,536,368],['side',552,0,260,368]]);
    assert.deepEqual(entries,before);
  }
});

test('three modules use Main, Tall and Small cell formats without changing module data',()=>{
  for(const ids of permutations(['music','focus','weather'],3)){
    const entries=ids.map(id=>({id,stored:{value:42}})),before=clone(entries),plan=Layout.planSlots(entries,{width:812,height:368});
    assertGeometry(plan,ids.join('+'));assert.equal(plan.mode,'triple');assert(plan.items.every(item=>item.fits));
    assert.deepEqual(plan.items.map(({presentation,x,y,width,height})=>[presentation,x,y,width,height]),[['main',0,0,536,368],['tall',552,0,260,240],['small',552,256,260,112]]);
    assert.deepEqual(entries,before);
  }
  const shelf=Layout.planSlots([{id:'music'},{id:'shelf'},{id:'weather'}],{width:812,height:368});
  assertGeometry(shelf,'Shelf uses its declared Side arrangement in the tall allocation');assert.equal(shelf.items[1].presentation,'side');assert.equal(shelf.items[1].fallback,true);
  const smallShelf=Layout.planSlots([{id:'music'},{id:'focus'},{id:'shelf'}],{width:812,height:368}).items[2];
  assert.equal(smallShelf.fits,true);assert.equal(smallShelf.presentation,'small');assert.deepEqual([smallShelf.width,smallShelf.height],[260,112]);
});

test('each declared builtin format fits its exact design-system ideal and refuses unsupported Shelf formats',()=>{
  for(const id of ['music','focus','weather','shelf']){
    const contract=Layout.getBuiltinContract(id);
    for(const presentation of Layout.PRESENTATIONS){
      const rect=Layout.getFormat(presentation),resolved=Layout.resolvePresentation(contract,presentation,{...rect,allowFallback:false});
      if(Layout.supports(contract,presentation)){
        assert(resolved,id+' '+presentation+' fits the exact cell dimensions');assert.deepEqual(resolved.ideal,dimension(rect.width,rect.height));
        for(const size of [contract.layout[presentation].min,contract.layout[presentation].ideal])assert.equal(Layout.resolvePresentation(contract,presentation,{...size,allowFallback:false}).presentation,presentation);
        for(const axis of ['width','height']){const tooSmall={...contract.layout[presentation].min};tooSmall[axis]--;assert.equal(Layout.resolvePresentation(contract,presentation,{...tooSmall,allowFallback:false}),null);}
      }else assert.equal(resolved,null);
    }
  }
});

test('explicit layouts stay strict while legacy manifests gain every safe default cell format',()=>{
  const custom=contract(),before=clone(custom),resolved=Layout.resolvePresentation(custom,'main',{width:160,height:120});
  assert.equal(resolved.presentation,'main');assert.equal(resolved.fallback,false);resolved.min.width=1;assert.deepEqual(custom,before);
  const limited={id:'community.limited',layout:{full:spec(300,200),side:spec(144,104)}};
  assert.equal(Layout.resolvePresentation(limited,'full',{width:180,height:126}).presentation,'side');
  assert.equal(Layout.resolvePresentation(limited,'full',{width:180,height:126,allowFallback:false}),null);
  const legacy=Layout.getCommunityContract({id:'community.legacy'});assert.deepEqual(Object.keys(legacy.layout),Layout.PRESENTATIONS);
  for(const presentation of Layout.PRESENTATIONS){const format=Layout.getFormat(presentation);assert.deepEqual(legacy.layout[presentation].ideal,dimension(format.width,format.height));}
  assert.equal(Layout.resolvePresentation(limited,'wide',{width:536,height:112}),null,'an omitted Small or Wide is not invented');
  assert.equal(Layout.resolvePresentation(limited,'tall',{width:260,height:240}).presentation,'side','an old supported Side remains reachable in a tall slot');
});

test('readable narrow fallbacks never overlap or claim a fit below a declared minimum',()=>{
  let checked=0;
  for(const density of ['compact','regular'])for(const count of [1,2,3])for(const ids of permutations(['music','focus','weather','shelf'],count))for(const width of [196,280,358,426,535,568,792,812]){
    const entries=ids.map(id=>({id})),before=clone(entries),plan=Layout.planSlots(entries,{width,height:368,density});assertGeometry(plan,ids.join('+')+' at '+width);assert.equal(plan.items.length,count);assert.deepEqual(entries,before);checked++;
  }
  assert.equal(checked,640);
  for(const width of [0,1,-1,NaN,Infinity])for(const height of [0,1,72,NaN,Infinity])assertGeometry(Layout.planSlots([{id:'music'},{id:'focus'},{id:'weather'}],{width,height}),'tiny host '+width+'x'+height);
  const entries=[{id:'music',marker:'first'},{id:'music',marker:'second'},null,{id:'focus'},{missing:true},{id:'weather'},{id:'shelf'}],plan=Layout.planSlots(entries,{width:562,height:260});
  assert.deepEqual(plan.items.map(item=>item.id),['music','focus','weather']);assert.equal(plan.items[0].marker,'first');assert.equal(Layout.planSlots(null,{width:562}).items.length,0);
});

test('pair fallback thresholds are derived from real module minima and explicit Lab formats stay strict',()=>{
  for(const secondary of ['focus','weather']){
    const entries=[{id:'music'},{id:secondary}],minimum=Layout.getBuiltinContract(secondary).layout.small.min.width,boundary=minimum*3+32;
    const fit=Layout.planSlots(entries,{width:boundary,height:368}),below=Layout.planSlots(entries,{width:boundary-.001,height:368});
    assertGeometry(fit,'exact pair minimum');assert.equal(fit.mode,'pair');assert(fit.items.every(item=>item.fits));
    assertGeometry(below,'below pair minimum');assert.equal(below.mode,'compact-stack');assert(below.items.every(item=>item.fits));assert.equal(below.items[1].height,112);
  }
  const entries=[{id:'music'},{id:'weather'}],forced={id:'weather',presentation:'full'},plan=Layout.planSlots(entries,{width:812,height:368,forced});
  assertGeometry(plan,'forced full refusal');assert.equal(plan.items[1].fits,false);assert.equal(plan.items[1].presentation,null);assert.equal(plan.items[1].reason,'insufficient-space');
  assert.deepEqual(forced,{id:'weather',presentation:'full'});
});

test('the editor and Lab share all six exact cell allocations and report remaining cells',()=>{
  for(const id of ['music','focus','weather'])for(const presentation of Layout.PRESENTATIONS){
    const entries=[{id,presentation,column:0,row:0}],before=clone(entries),plan=Layout.planGrid(entries),format=Layout.getFormat(presentation);
    assertGeometry(plan,id+' '+presentation+' grid');assert.equal(plan.mode,'grid');assert.equal(plan.items[0].fits,true);
    assert.deepEqual([plan.items[0].width,plan.items[0].height],[format.width,format.height]);assert.equal(plan.freeCells.length,9-format.cols*format.rows);assert.deepEqual(entries,before);
  }
  const entries=[{id:'focus',presentation:'main',column:0,row:0},{id:'music',presentation:'tall',column:2,row:0},{id:'weather',presentation:'small',column:2,row:2}],plan=Layout.planGrid(entries);
  assertGeometry(plan,'approved grid');assert.deepEqual(plan.freeCells,[]);assert(plan.items.every(item=>item.fits));
  const wide=Layout.planGrid([{id:'weather',presentation:'wide',column:1,row:2}]);assertGeometry(wide,'bottom wide');assert.deepEqual([wide.items[0].x,wide.items[0].y,wide.items[0].width,wide.items[0].height],[276,256,536,112]);
  const narrow=Layout.planGrid(entries,{width:400,height:240});assertGeometry(narrow,'bounded grid below minimum');assert(narrow.items.some(item=>!item.fits));
  const shelf=Layout.planGrid([{id:'shelf',presentation:'small'}]).items[0];assert.equal(shelf.fits,true);assert.deepEqual([shelf.width,shelf.height],[260,112]);for(const presentation of ['wide','tall']){const unsupported=Layout.planGrid([{id:'shelf',presentation}]).items[0];assert.equal(unsupported.fits,false);assert.equal(unsupported.reason,'unsupported-presentation');}
});

test('grid edits reject overlap, duplicate identities, invalid spans and out-of-bounds coordinates before mutation',()=>{
  const stable=[{id:'music',presentation:'main',column:0,row:0}],before=clone(stable);
  for(const entry of [{id:'weather',presentation:'side',column:1,row:0},{id:'music',presentation:'side',column:2,row:0},{id:'weather',presentation:'full',column:1,row:0},{id:'weather',presentation:'small',column:3,row:0},{id:'weather',presentation:'small',column:2,row:3},{id:'weather',presentation:'small',column:-1,row:0},{id:'weather',presentation:'small',column:2,row:1.5},{id:'weather',presentation:'overlay',column:2,row:0}]){
    assert.throws(()=>Layout.planGrid([...stable,entry]),/overlap|unique|fit inside/);assert.deepEqual(stable,before);
  }
  for(const input of [null,{},[null],Array.from({length:10},(_,i)=>({id:'x'+i,presentation:'small'}))])assert.throws(()=>Layout.planGrid(input),TypeError);
  for(const width of [-1,NaN,Infinity,'812'])assert.throws(()=>Layout.planGrid([],{width}),TypeError);
  assertGeometry(Layout.planGrid([]),'empty grid');assert.equal(Layout.planGrid([]).freeCells.length,9);
});

test('central Duration policy preserves form canvas boundaries independently of the six host formats',()=>{
  for(const [width,height,tasks,timer]of [[220,120,'quarter','quarter'],[439,260,'quarter','quarter'],[440,120,'quarter','half'],[440,179,'quarter','half'],[440,180,'quarter','details'],[440,239,'quarter','details'],[440,240,'full','full'],[536,368,'full','full']])assert.deepEqual(Layout.resolveDurationLayouts({width,height}),{tasks,timer});
  for(const geometry of [{width:219,height:260},{width:220,height:119},{width:440,height:119},{width:0,height:200},{width:200,height:NaN},{width:-1,height:1},{width:Infinity,height:260},{width:354,height:0},{}])assert.equal(Layout.resolveDurationLayouts(geometry),null);
});

test('applying and clearing grid assignments replaces old geometry metadata without changing unrelated state',()=>{
  const tokens={},host={dataset:{unrelated:'kept',durationTasks:'full',durationTimer:'full',moduleReason:'old'},style:{setProperty:(name,value)=>{tokens[name]=value;}}};
  const assignment=Layout.planGrid([{id:'focus',presentation:'tall',column:2,row:1}]).items[0];
  assert.equal(Layout.applyHost(host,assignment),true);assert.equal(host.dataset.moduleSlot,'main');assert.equal(host.dataset.modulePresentation,'tall');assert.equal(host.dataset.moduleId,'focus');assert.equal(host.dataset.slotFits,'true');assert.equal(host.dataset.presentation,'scene');assert.equal(host.dataset.durationTasks,'quarter');assert.equal(host.dataset.durationTimer,'quarter');assert.equal(host.dataset.moduleReason,undefined);
  assert.deepEqual([host.dataset.moduleColumn,host.dataset.moduleRow,host.dataset.moduleCols,host.dataset.moduleRows],['2','1','1','2']);
  assert.equal(tokens['--module-canvas-inset'],'24px');assert.equal(tokens['--module-compact-padding'],'16px');assert.equal(tokens['--gap-between-modules'],'16px');assert.equal(tokens['--radius-module'],'24px');
  Layout.applyHost(host,{id:'shelf',slot:'small',presentation:null,fits:false,reason:'unsupported-presentation',width:0,height:0});
  assert.equal(host.dataset.modulePresentation,'unavailable');assert.equal(host.dataset.slotFits,'false');assert.equal(host.dataset.moduleReason,'unsupported-presentation');assert.equal(host.dataset.durationTasks,undefined);assert.equal(host.dataset.durationTimer,undefined);assert.equal(host.dataset.moduleCols,undefined);
  Layout.clearHost(host);for(const name of ['moduleSlot','modulePresentation','moduleReason','moduleCols','moduleRows','moduleColumn','moduleRow','durationTasks','durationTimer','slotFits'])assert.equal(host.dataset[name],undefined);assert.equal(host.dataset.unrelated,'kept');
  assert.equal(Layout.applyHost(null,{}),false);assert.doesNotThrow(()=>Layout.clearHost(null));
});
