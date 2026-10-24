'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Galet=require('../galet.js'),Renderer=require('../mimo-renderer.js');

function fixture({active=true,reduced=false,motion=true,variant='default'}={}){
  let time=100,id=0;const timers=new Map(),frames=new Map(),canvases=[];
  class Events{
    constructor(){this.listeners=new Map();}
    addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(fn);}
    removeEventListener(name,fn){this.listeners.get(name)?.delete(fn);}
    fire(name,event={}){for(const fn of [...this.listeners.get(name)||[]])fn(event);}
  }
  const query=new Events();query.matches=reduced;
  const window=new Events(),document=new Events();
  Object.assign(window,{performance:{now:()=>time},devicePixelRatio:1,innerWidth:1000,innerHeight:800,
    matchMedia:()=>query,Path2D:class{ellipse(){}},
    requestAnimationFrame:fn=>{const key=++id;frames.set(key,fn);return key;},
    cancelAnimationFrame:key=>frames.delete(key),
    setTimeout:(fn,delay)=>{const key=++id;timers.set(key,{fn,at:time+delay});return key;},
    clearTimeout:key=>timers.delete(key),getComputedStyle:el=>el.style});
  const drawing=new Proxy({createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})},{
    get:(target,key)=>key in target?target[key]:()=>{},set:(target,key,value)=>(target[key]=value,true)
  });
  const classes=new Set();
  const host=new Events();
  Object.assign(host,{ownerDocument:document,dataset:{},isConnected:true,style:{display:'inline-flex',visibility:'visible'},children:[],
    getBoundingClientRect:()=>({left:50,top:50,width:100,height:100,right:150,bottom:150}),
    classList:{add:name=>classes.add(name),remove:name=>classes.delete(name)},closest:()=>null,
    replaceChildren(...children){this.children=children;for(const child of children)child.parentElement=this;}});
  document.defaultView=window;document.hidden=false;
  document.createElement=tag=>{
    assert.equal(tag,'canvas','the host uses the exact Canvas renderer');
    const element={tagName:'CANVAS',ownerDocument:document,dataset:{},attributes:{},getContext:()=>drawing,
      setAttribute(name,value){this.attributes[name]=value;},getBoundingClientRect:host.getBoundingClientRect,
      remove(){host.children=host.children.filter(child=>child!==this);}};
    canvases.push(element);return element;
  };
  const character=Galet.create(host,{active,motion,variant});
  function advance(ms){
    const end=time+ms;
    while(time<end){
      time=Math.min(end,time+16);
      const callbacks=[...frames.values()];frames.clear();for(const fn of callbacks)fn(time);
      let ready=[...timers.entries()].filter(([,job])=>job.at<=time);
      while(ready.length){for(const [key,job]of ready){timers.delete(key);job.fn();}ready=[...timers.entries()].filter(([,job])=>job.at<=time);}
    }
  }
  return{character,host,window,document,query,advance,frames,timers,canvases,classes};
}

test('one immutable API preserves the existing Notchy event and module variant names',()=>{
  assert(Object.isFrozen(Galet));assert(Object.isFrozen(Galet.states));assert.equal(typeof Galet.create,'function');
  assert.equal('createSvg' in Galet,false,'the unused approximated SVG renderer is gone');
  assert.deepEqual(Galet.states,['idle','greet','focus','session-finished','break','task-finished','cycle-complete','share-request','receiving','received','question','error','trade-win','economic-alert','airpods','dizzy','sleeping','yawn','working','finished','thinking','searching','approval','ratelimit','reading','gain','loss','news','coding']);
  assert(Object.isFrozen(Galet.variants));
  for(const item of Object.values(Galet.variants))assert(Object.isFrozen(item));
});

test('invalid names and missing browser hosts fail without allocating a renderer',()=>{
  for(const host of [null,undefined,{}, {ownerDocument:{}},{ownerDocument:{defaultView:{}}}])assert.throws(()=>Galet.create(host),TypeError);
  for(const variant of ['unknown','__proto__','constructor','toString','',null,{},42])assert.throws(()=>Galet.create(null,{variant}),RangeError);
  const f=fixture();const canvas=f.host.children[0];
  for(const id of ['unknown','__proto__','constructor','toString','',null,{},42]){
    assert.throws(()=>f.character.setState(id),RangeError);assert.throws(()=>f.character.emote(id),RangeError);
  }
  assert.equal(f.canvases.length,1);assert.equal(f.host.children[0],canvas);f.character.dispose();
});

test('the sixteen canonical states retain every supplied eye, color, badge and behavior flag',()=>{
  const f=fixture(),canvas=f.host.children[0];
  for(const [id,cfg]of Object.entries(Renderer.STATES)){
    f.character.setState(id);f.advance(350);
    const snapshot=f.character.inspect();
    assert.equal(snapshot.motion.canonical,id);assert.deepEqual(snapshot.motion.config,cfg,id);
    assert.equal(snapshot.expression,cfg.eye,id);
    assert.equal(f.host.children[0],canvas,'state changes keep one Canvas and animation engine');
    assert.equal(f.canvases.length,1);
    assert(Object.values(snapshot.motion.s).every(Number.isFinite),id+' geometry stays finite');
  }
  f.character.dispose();
});

test('dizzy uses the actual supplied spiral eyes and two-turn roll rather than a lookalike image',()=>{
  const f=fixture();f.character.setState('dizzy');f.advance(300);
  const snapshot=f.character.inspect();
  assert.equal(snapshot.expression,'spiral');assert(snapshot.motion.tweens.includes('roll'));assert.notEqual(snapshot.motion.s.roll,0);
  assert.deepEqual(snapshot.motion.config,Renderer.STATES.dizzy);f.character.dispose();
});

test('HTML file drag coordinates use the same gaze without a synthetic pointer event or greeting',()=>{
  const f=fixture();
  f.character.lookAt({clientX:900,clientY:500});f.advance(200);
  assert(f.character.inspect().look.x>0);assert(f.character.inspect().look.y>0);
  assert.equal(f.character.inspect().state,'idle');assert.equal(f.character.inspect().emote,null);
  f.character.lookAt({clientX:-500,clientY:-500});f.advance(200);
  assert(f.character.inspect().look.x<0);assert(f.character.inspect().look.y<0);
  f.character.setActive(false);f.character.lookAt({clientX:900,clientY:500});
  assert.deepEqual(f.character.inspect().look,{x:0,y:0});f.character.dispose();
});

test('emotes are two-second overlays without changing the current state, tint or badge',()=>{
  const f=fixture();
  for(const base of ['focus','error','reading'])for(const [id,emote]of Object.entries(Renderer.EMOTES)){
    f.character.setState(base);f.advance(400);const before=f.character.inspect();
    f.character.emote(id);let snapshot=f.character.inspect();
    assert.equal(snapshot.state,base);assert.equal(snapshot.emote.id,id);assert.equal(snapshot.expression,emote.eye);
    assert.deepEqual(snapshot.motion.config,before.motion.config);
    f.advance(2100);snapshot=f.character.inspect();
    assert.equal(snapshot.emote,null);assert.equal(snapshot.state,base);assert.equal(snapshot.expression,before.motion.config.eye);
    assert.equal(f.canvases.length,1);
  }
  f.character.dispose();
});

test('module tints apply only to neutral states and cannot mutate canonical states or semantic events',()=>{
  const f=fixture({variant:'music'});assert.deepEqual(f.character.inspect().motion.targetColor,[240,138,154]);
  for(const id of ['focus','working','error','receiving','break','reading','gain','loss','news']){
    f.character.setState(id);const before=f.character.inspect();f.character.setVariant('weather');const after=f.character.inspect();
    assert.deepEqual(after.motion.config,before.motion.config,id);f.character.setVariant('music');
  }
  f.character.setState('focus');f.character.setState('working');
  assert.deepEqual(f.character.inspect().motion.config,Renderer.STATES.working,'orange alias never contaminates blue working');
  f.character.setState('idle');f.character.setVariant('default');assert.deepEqual(f.character.inspect().motion.config,Renderer.STATES.idle);
  f.character.dispose();
});

test('gaze follows the supplied clamped pointer direction then wanders; hovering never greets',()=>{
  const f=fixture();f.character.setState('focus');
  f.document.fire('pointermove',{clientX:-10000,clientY:-10000});f.advance(32);
  assert.deepEqual(f.character.inspect().look,{x:-1,y:-1});
  f.document.fire('pointermove',{clientX:10000,clientY:10000});f.advance(32);
  assert.deepEqual(f.character.inspect().look,{x:1,y:1});
  for(let i=0;i<12;i++)f.host.fire('pointerenter');
  assert.equal(f.character.inspect().state,'focus');assert.equal(f.character.inspect().emote,null);
  f.advance(2700);const look=f.character.inspect().look;assert(Math.abs(look.x)<=.55&&Math.abs(look.y)<=.3);
  f.character.dispose();
});

test('hidden, offscreen and disabled hosts stop animation work and cancel emotes',()=>{
  const f=fixture();f.character.setState('gain');f.character.emote('love');f.advance(32);
  f.document.hidden=true;f.document.fire('visibilitychange');assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
  assert.equal(f.character.inspect().active,false);assert.equal(f.character.inspect().emote,null);
  f.document.hidden=false;f.document.fire('visibilitychange');assert.equal(f.character.inspect().active,true);
  f.host.style.display='none';f.character.refresh();assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
  f.host.style.display='inline-flex';f.character.refresh();f.character.setActive(false);assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
  f.character.setActive(true);assert(f.frames.size>0);f.character.dispose();assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
  assert.equal(f.host.children.length,0);assert.equal(f.character.inspect().disposed,true);
});

test('system reduced motion is static; the app setting removes rolls and shakes only',()=>{
  const f=fixture({reduced:true});
  for(const id of ['dizzy','finished','error','coding']){
    f.character.setState(id);const snapshot=f.character.inspect();
    assert.equal(f.frames.size,0);assert.deepEqual(snapshot.motion.tweens,[]);assert.equal(snapshot.motion.parts,0);
    assert.equal(snapshot.motion.s.roll,0);assert.equal(snapshot.motion.s.ox,0);
  }
  f.character.emote('love');assert.equal(f.character.inspect().expression,'heart');assert.equal(f.frames.size,0);f.advance(2100);assert.equal(f.character.inspect().emote,null);
  f.query.matches=false;f.query.fire('change');f.character.setMotion(false);
  for(const id of ['dizzy','error','finished']){
    f.character.setState(id);f.advance(32);const snapshot=f.character.inspect();
    assert(!snapshot.motion.tweens.includes('roll'));assert(!snapshot.motion.tweens.includes('ox'));
    assert.equal(snapshot.motion.s.roll,0);assert.equal(snapshot.motion.s.ox,0);
  }
  assert(f.frames.size>0,'subtle gaze and color transitions remain active');f.character.dispose();
});

test('four clicks trigger dizzy temporarily and restore the real state',()=>{
  const f=fixture();f.character.setState('working');
  for(let index=0;index<4;index++){f.host.fire('click');f.advance(100);}
  assert.equal(f.character.inspect().visible,'dizzy');assert.equal(f.character.inspect().state,'working');
  f.advance(2700);assert.equal(f.character.inspect().visible,'working');assert.equal(f.character.inspect().expression,'pill');
  f.character.dispose();
});

test('hiding during dizzy reconciles the real state before resuming',()=>{
  const f=fixture();f.character.setState('focus');
  for(let index=0;index<4;index++){f.host.fire('click');f.advance(50);}
  assert.equal(f.character.inspect().visible,'dizzy');
  f.character.setActive(false);
  let snapshot=f.character.inspect();
  assert.equal(snapshot.visible,'focus');assert.equal(snapshot.motion.canonical,'working');assert.equal(snapshot.expression,'pill');
  assert.equal(snapshot.motion.jobs,0);assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
  f.advance(3000);f.character.setActive(true);f.advance(800);snapshot=f.character.inspect();
  assert.equal(snapshot.motion.canonical,'working');assert.equal(snapshot.expression,'pill');
  assert.equal(snapshot.motion.s.roll,0);f.character.dispose();
});

test('a cancelled yawn cannot change the restored, new-state or replacement-emote eyes later',()=>{
  for(const interruption of ['hidden','state','emote']){
    const f=fixture();f.character.setState('working');f.advance(150);f.character.emote('yawn');f.advance(100);
    if(interruption==='hidden'){f.character.setActive(false);f.advance(1000);f.character.setActive(true);}
    else if(interruption==='state')f.character.setState('error');
    else f.character.emote('love');
    f.advance(900);const snapshot=f.character.inspect();
    assert.equal(snapshot.expression,interruption==='hidden'?'pill':interruption==='state'?'flat':'heart',interruption);
    assert.equal(snapshot.motion.badge,interruption==='state'?'dot':'dots','the pending semantic badge is preserved');
    assert.equal(snapshot.motion.badgeColor,snapshot.motion.config.badge[1]);
    f.character.dispose();
  }
});
