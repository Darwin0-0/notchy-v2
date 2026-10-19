'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createActivityReflow} = require('../notch.js');

test('composition reflow decelerates naturally without overshoot and lands exactly', () => {
  const spring=createActivityReflow({x:240,y:30,scaleX:1.6,scaleY:1.2,opacity:.2});
  const samples=[0,16,32,100,200,400,720].map(time=>spring.sample(time));
  assert.equal(samples[0].values.x,240);
  assert(samples[0].values.x-samples[1].values.x < samples[1].values.x-samples[2].values.x,'motion accelerates out of its initial resting position');
  assert(samples[3].values.x-samples[4].values.x > samples[4].values.x-samples[5].values.x,'movement eases into the resting arrangement');
  for(let index=1;index<samples.length;index++) {
    assert(samples[index].values.x<=samples[index-1].values.x && samples[index].values.x>=0);
    assert(samples[index].values.scaleX<=samples[index-1].values.scaleX && samples[index].values.scaleX>=1);
    assert(samples[index].values.opacity>=samples[index-1].values.opacity && samples[index].values.opacity<=1);
  }
  assert.deepEqual(samples.at(-1),{values:{x:0,y:0,scaleX:1,scaleY:1,opacity:1},velocity:{x:0,y:0,scaleX:0,scaleY:0,opacity:0},done:true});
});

test('primary movement leads the two rail surfaces without a simultaneous fade', () => {
  const from={x:20,opacity:0}, now=1000;
  const springs=[0,45,90].map(delay=>createActivityReflow(from,{now,delay}));
  assert(springs[0].sample(now+30).values.opacity>0);
  assert.equal(springs[1].sample(now+30).values.opacity,0);
  assert.equal(springs[2].sample(now+30).values.opacity,0);
  assert(springs[1].sample(now+70).values.opacity>0);
  assert.equal(springs[2].sample(now+70).values.opacity,0);
  for(const spring of springs) assert.equal(spring.sample(now+820).done,true);
});

test('interrupted reflow preserves presentation velocity and does not pause for stagger', () => {
  const original=createActivityReflow({x:240,y:24,scaleX:1.8,opacity:0});
  const presentation=original.sample(140);
  const next=createActivityReflow({...presentation.values,x:presentation.values.x-80},{now:140,delay:90,velocity:presentation.velocity});
  const first=next.sample(140), following=next.sample(141);
  assert.deepEqual(first.velocity,presentation.velocity);
  assert.equal(first.values.x,presentation.values.x-80);
  assert(following.values.x<first.values.x,'the inherited movement continues immediately, even when its next destination reverses');
  assert(Math.abs((following.values.x-first.values.x)*1000-first.velocity.x)<35,'a retarget has no sudden velocity discontinuity');
  assert.equal(next.sample(900).done,true);
});

test('partial reflow inputs keep dimensions finite and default to an unchanged surface', () => {
  const sampled=createActivityReflow({x:Infinity,scaleX:NaN},{velocity:{y:Infinity}}).sample(100);
  assert.deepEqual(sampled.values,{x:0,y:0,scaleX:1,scaleY:1,opacity:1});
  assert(Object.values(sampled.velocity).every(Number.isFinite));
});
