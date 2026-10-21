'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Layout=require('../module-contracts.js');
const placement=(id,presentation,column,row)=>({id,presentation,column,row});
const full=()=>[placement('music','main',0,0),placement('focus','tall',2,0),placement('weather','small',2,2)];
function invariant(input,result,target,options){
  assert(result);assert.equal(result.placements.length,input.length);assert.deepEqual(result.placements.map(item=>[item.id,item.presentation]),input.map(item=>[item.id,item.presentation]));
  const moved=result.placements.find(item=>item.id===target.id);assert.deepEqual([moved.column,moved.row],[target.column,target.row]);
  assert(Layout.planGrid(result.placements,options).items.every(item=>item.fits));assert(result.plan.items.every(item=>item.fits));
  assert.equal(new Set(result.placements.map(item=>item.id)).size,input.length);assert.deepEqual(Layout.planGridMove(input,target,options),result,'the bounded plan is deterministic');
}

test('a full Main/Tall/Small grid moves Main right and reverses without changing any format or caller data',()=>{
  const input=full(),before=structuredClone(input),target={id:'music',column:1,row:0},result=Layout.planGridMove(input,target);invariant(input,result,target);
  assert.deepEqual(result.placements,[placement('music','main',1,0),placement('focus','tall',0,0),placement('weather','small',0,2)]);
  assert.deepEqual(input,before);assert.deepEqual(Layout.planGridMove(result.placements,{id:'music',column:0,row:0}).placements,input);
  result.placements[0].row=8;assert.deepEqual(input,before,'returned placements never alias source placements');
});

test('moving Tall left backtracks through Main and the initially noncolliding Small; a central Tall is impossible',()=>{
  const input=full(),target={id:'focus',column:0,row:0},result=Layout.planGridMove(input,target);invariant(input,result,target);
  assert.deepEqual(result.placements,[placement('music','main',1,0),placement('focus','tall',0,0),placement('weather','small',0,2)]);
  assert.equal(Layout.planGridMove(input,{id:'focus',column:1,row:0}),null);
  assert.deepEqual(Layout.planGridMove(input,{id:'focus',column:2,row:1}).placements,[input[0],placement('focus','tall',2,1),placement('weather','small',2,0)]);
});

test('the bounded search backtracks when keeping a noncolliding Wide blocks the remaining Tall',()=>{
  const input=[placement('music','small',0,0),placement('focus','wide',0,1),placement('weather','tall',2,0)],target={id:'music',column:2,row:1},result=Layout.planGridMove(input,target);invariant(input,result,target);
  assert.deepEqual(result.placements,[placement('music','small',2,1),placement('focus','wide',0,0),placement('weather','tall',1,1)]);
});

test('movement preserves all nine identities, formats and valid rectangles across every occupied Small destination',()=>{
  const ids=Array.from({length:9},(_,index)=>'community.cell-'+index),input=ids.map((id,index)=>placement(id,'small',index%3,Math.floor(index/3))),before=structuredClone(input),options={getContract:id=>Layout.getCommunityContract({id})};
  for(const id of ids)for(let row=0;row<3;row++)for(let column=0;column<3;column++)invariant(input,Layout.planGridMove(input,{id,column,row},options),{id,column,row},options);
  assert.deepEqual(input,before);
});

test('every feasible destination in mixed full grids preserves module count, formats, contracts and source anchoring',()=>{
  const profiles=[full(),[placement('music','main',0,0),placement('shelf','side',2,0)],[placement('music','wide',0,0),placement('focus','tall',2,0),placement('weather','wide',0,1),placement('shelf','small',0,2)]];
  for(const input of profiles){const before=structuredClone(input);for(const source of input)for(let row=0;row<3;row++)for(let column=0;column<3;column++){const target={id:source.id,column,row},result=Layout.planGridMove(input,target);if(result)invariant(input,result,target);}assert.deepEqual(input,before);}
});

test('movement rejects invalid targets, initial overlap, unsupported contracts and insufficient dimensions atomically',()=>{
  const input=full(),before=structuredClone(input);
  for(const target of [null,{}, {id:'unknown',column:0,row:0},...[-1,3,NaN,Infinity,1.5,'1',null,undefined].flatMap(value=>[{id:'music',column:value,row:0},{id:'music',column:0,row:value}])])assert.equal(Layout.planGridMove(input,target),null);
  for(const bad of [null,[...input,input[0]],[placement('music','main',0,0),placement('focus','small',0,0)],[placement('shelf','tall',0,0)],Array.from({length:10},(_,index)=>placement('community.bad-'+index,'small',0,0))])assert.equal(Layout.planGridMove(bad,{id:'music',column:0,row:0}),null);
  assert.equal(Layout.planGridMove(input,{id:'music',column:0,row:0},{width:10,height:10}),null);assert.deepEqual(input,before);
  const unchanged=Layout.planGridMove(input,{id:'music',column:0,row:0});assert.deepEqual(unchanged.placements,input);assert.notEqual(unchanged.placements,input);assert.notEqual(unchanged.placements[0],input[0]);
});

test('magnetic movement chooses the nearest feasible anchor through gutters while preserving every rectangle',()=>{
  const input=full(),before=structuredClone(input),result=Layout.snapGridMove(input,{id:'music',x:268,y:-.5});
  assert.deepEqual(result.target,{column:1,row:0,x:276,y:0});invariant(input,{placements:result.placements,plan:result.plan},{id:'music',column:1,row:0});assert.deepEqual(input,before);
  const tall=Layout.snapGridMove(input,{id:'focus',x:250,y:1});assert.deepEqual(tall.target,{column:0,row:0,x:0,y:0});assert.equal(tall.placements.find(item=>item.id==='focus').presentation,'tall');
});

test('magnetic hysteresis keeps a valid previous anchor through small midpoint jitter and releases it beyond the margin',()=>{
  const input=full();
  assert.equal(Layout.snapGridMove(input,{id:'music',x:139,y:0,previous:{column:0,row:0}}).target.column,0);
  assert.equal(Layout.snapGridMove(input,{id:'music',x:145,y:0,previous:{column:0,row:0}}).target.column,1);
  assert.equal(Layout.snapGridMove(input,{id:'music',x:137,y:0,previous:{column:1,row:0}}).target.column,1);
  assert.equal(Layout.snapGridMove(input,{id:'music',x:130,y:0,previous:{column:1,row:0}}).target.column,0);
  assert.equal(Layout.snapGridMove(input,{id:'focus',x:250,y:0,previous:{column:1,row:0}}).target.column,0,'an impossible previous anchor never wins');
  for(const value of [NaN,Infinity,'12',undefined])assert.equal(Layout.snapGridMove(input,{id:'music',x:value,y:0}),null);
  assert.equal(Layout.snapGridMove(input,{id:'missing',x:0,y:0}),null);
});

test('magnetic coordinates use the actual requested grid dimensions and its calculated gap',()=>{
  const input=full(),options={width:1030,height:550},plan=Layout.planGrid(input,options),pitch=(plan.width-2*plan.gap)/3+plan.gap,result=Layout.snapGridMove(input,{id:'music',x:pitch-5,y:0},options);
  assert.equal(result.target.x,pitch);assert.equal(result.target.column,1);assert.equal(result.plan.items.find(item=>item.id==='music').x,result.target.x);invariant(input,{placements:result.placements,plan:result.plan},{id:'music',column:1,row:0},options);
});
