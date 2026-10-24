'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const Renderer=require('../mimo-renderer.js');

function fixture(){
  let time=0,serial=0;const jobs=new Map();
  const canvas={getContext:()=>({})};
  const bot=Renderer.create(canvas,{now:()=>time,random:()=>.5,dpr:1,
    schedule(callback,delay){const token=++serial;jobs.set(token,{callback,due:time+delay});return token;},
    cancel(token){jobs.delete(token);}});
  function advance(ms){const end=time+ms;while(true){const next=[...jobs.entries()].sort((a,b)=>a[1].due-b[1].due)[0];if(!next||next[1].due>end)break;time=next[1].due;jobs.delete(next[0]);next[1].callback();}time=end;}
  return {bot,canvas,jobs,advance};
}

test('the drawing and motion block remains byte-for-byte the supplied Mimo reference',()=>{
  const source=fs.readFileSync(require.resolve('../mimo-renderer.js'),'utf8').replaceAll('\r\n','\n');
  const core=source.split('// BEGIN EXACT REFERENCE\n')[1]?.split('// END EXACT REFERENCE')[0].trim();
  assert(core,'Reference boundaries must remain explicit.');
  assert.equal(crypto.createHash('sha256').update(core).digest('hex'),'61a0048e0ed3cd1c89a80e486fd098d25ccaad196938409cf374578da02c9bbe');
  assert(Object.isFrozen(Renderer));assert(Object.isFrozen(Renderer.STATES));assert(Object.isFrozen(Renderer.EMOTES));
  assert.deepEqual(Object.keys(Renderer.STATES),['idle','working','finished','error','dizzy','thinking','searching','approval','question','ratelimit','sleeping','reading','gain','loss','news','coding']);
});

test('source badge and particle callbacks pause with the hidden renderer and resume with their remaining delays',()=>{
  const f=fixture();f.bot.setState('finished',true);assert.equal(f.bot.pendingCount(),2);
  f.advance(60);f.bot.pauseScheduled();assert.equal(f.jobs.size,0);f.advance(5000);
  assert.equal(f.bot.badge,null);assert.equal(f.bot.parts.length,0);
  f.bot.resumeScheduled();f.advance(39);assert.equal(f.bot.badge,null);
  f.advance(1);assert.equal(f.bot.badge,'dot');assert.equal(f.bot.badgeCol,'#34D399');
  f.advance(400);assert.equal(f.bot.parts.length,5);assert.equal(f.bot.pendingCount(),0);
  f.bot.dispose();
});

test('the source engine keeps the same body, semantic state, tint and badge while an emote overlays its eyes',()=>{
  const f=fixture();f.bot.setState('reading',true);f.advance(100);
  const original={cfg:f.bot.cfg,colT:f.bot.colT,badge:f.bot.badge,state:f.bot.state};
  f.bot.emote('love',2000);assert.equal(f.bot.eyeOv,'heart');
  assert.equal(f.bot.cfg,original.cfg);assert.equal(f.bot.colT,original.colT);assert.equal(f.bot.badge,original.badge);assert.equal(f.bot.state,original.state);
  f.advance(2001);f.bot.update();assert.equal(f.bot.eyeOv,null);assert.equal(f.bot.state,'reading');f.bot.dispose();
});

test('disposal cancels late source callbacks and cannot affect another canvas instance',()=>{
  const a=fixture(),b=fixture();a.bot.emote('yawn',2000);b.bot.setState('working',true);
  assert.equal(a.bot.pendingCount(),1);a.bot.dispose();a.bot.dispose();a.advance(1000);
  assert.equal(a.bot.pendingCount(),0);assert.equal(a.jobs.size,0);assert.equal(a.bot.parts.length,0);
  b.advance(100);assert.equal(b.bot.badge,'dots');assert.equal(b.bot.state,'working');
  b.bot.cancelPending();assert.equal(b.bot.pendingCount(),0);b.bot.dispose();
  assert.throws(()=>Renderer.create(null),TypeError);
  assert.throws(()=>Renderer.create({getContext:()=>null}),TypeError);
  assert.throws(()=>Renderer.create({getContext:()=>({})},{dpr:-1}),TypeError);
});
