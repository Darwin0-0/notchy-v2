const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeAppearance,initialAppearance}=require('../notch.js');

test('persisted appearance cannot introduce unknown formats or invalid window geometry',()=>{
  const defaults={format:'compact',radius:18,motion:true};
  for(const value of[undefined,null,[],false,'compact',{format:'fullscreen',radius:NaN,motion:'no',foreign:true}])assert.deepEqual(normalizeAppearance(value),defaults);
  assert.deepEqual(normalizeAppearance({format:'compact',radius:1000,motion:false}),{format:'compact',radius:24,motion:false});
  assert.deepEqual(normalizeAppearance({format:'comfortable',radius:-1000}),{format:'comfortable',radius:12,motion:true});
  const input={format:'balanced',radius:15.7,motion:true};assert.deepEqual(normalizeAppearance(input),{format:'balanced',radius:16,motion:true});assert.equal(input.radius,15.7);
  assert.equal(normalizeAppearance({radius:28}).radius,24);
});

test('existing installations adopt Compact once while later explicit format choices survive restart',()=>{
  const old={format:'comfortable',radius:21,motion:false};
  const migrated=initialAppearance(old);
  assert.deepEqual(migrated,{format:'compact',radius:21,motion:false});
  assert.equal(old.format,'comfortable','migration does not mutate its input');
  assert.deepEqual(initialAppearance({...migrated,format:'balanced',compactDefault:true}),{format:'balanced',radius:21,motion:false});
  assert.deepEqual(initialAppearance(),{format:'compact',radius:18,motion:true});
});

test('changing motion immediately updates the active music subscription',()=>{
  const source=require('node:fs').readFileSync(require.resolve('../notch.js'),'utf8');
  const start=source.indexOf('  function setAppearance('),end=source.indexOf('  function appearanceInput(',start),calls=[];
  const scope={normalizeAppearance,window:{localStorage:{setItem:()=>{calls.push('saved');}}},renderAppearance:()=>calls.push('render'),islandMotionPreference:()=>calls.push('geometry'),musicLifecycle:()=>calls.push('music')};
  require('node:vm').runInNewContext(`let disposed=false,appearance=normalizeAppearance();${source.slice(start,end)}this.api={setAppearance,get motion(){return appearance.motion;}};`,scope);
  assert.equal(scope.api.setAppearance({motion:false},false),true);assert.equal(scope.api.motion,false);
  assert.deepEqual(calls,['render','geometry','music']);
  calls.length=0;scope.api.setAppearance({motion:true});assert.equal(scope.api.motion,true);
  assert.deepEqual(calls,['saved','render','geometry','music']);
});


test('appearance changes only display scale while every format keeps the same design-system canvas',()=>{
  const {openPanelWidth,openPanelScale}=require('../notch.js'),saved={radius:21,motion:false,compactDefault:true};
  for(const [format,scale]of [['compact',.7],['balanced',.85],['comfortable',1]]){
    const preference=initialAppearance({...saved,format});assert.equal(preference.format,format);assert.equal(openPanelWidth(format),844);assert.equal(openPanelWidth(format,{lab:true}),844);assert.equal(openPanelScale(format),scale);
    assert.equal(openPanelScale(format,{welcome:true}),.8,'the discreet onboarding keeps its proportions independently of panel size');
    assert.deepEqual(initialAppearance({...preference,compactDefault:true}),preference,'a restart preserves the explicit appearance choice');
  }
});
