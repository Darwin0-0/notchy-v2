const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeAppearance}=require('../notch.js');

test('persisted appearance cannot introduce unknown formats or invalid window geometry',()=>{
  const defaults={format:'balanced',radius:18,motion:true};
  for(const value of[undefined,null,[],false,'compact',{format:'fullscreen',radius:NaN,motion:'no',foreign:true}])assert.deepEqual(normalizeAppearance(value),defaults);
  assert.deepEqual(normalizeAppearance({format:'compact',radius:1000,motion:false}),{format:'compact',radius:24,motion:false});
  assert.deepEqual(normalizeAppearance({format:'comfortable',radius:-1000}),{format:'comfortable',radius:12,motion:true});
  const input={format:'balanced',radius:15.7,motion:true};assert.deepEqual(normalizeAppearance(input),{format:'balanced',radius:16,motion:true});assert.equal(input.radius,15.7);
  assert.equal(normalizeAppearance({radius:28}).radius,24);
});

test('changing motion immediately updates the active music subscription',()=>{
  const source=require('node:fs').readFileSync(require.resolve('../notch.js'),'utf8');
  const start=source.indexOf('  function setAppearance('),end=source.indexOf('  function appearanceInput(',start),calls=[];
  const scope={normalizeAppearance,window:{localStorage:{setItem:()=>{calls.push('saved');}}},renderAppearance:()=>calls.push('render'),update:()=>calls.push('geometry'),musicLifecycle:()=>calls.push('music')};
  require('node:vm').runInNewContext(`let disposed=false,appearance=normalizeAppearance();${source.slice(start,end)}this.api={setAppearance,get motion(){return appearance.motion;}};`,scope);
  assert.equal(scope.api.setAppearance({motion:false},false),true);assert.equal(scope.api.motion,false);
  assert.deepEqual(calls,['render','geometry','music']);
  calls.length=0;scope.api.setAppearance({motion:true});assert.equal(scope.api.motion,true);
  assert.deepEqual(calls,['saved','render','geometry','music']);
});
