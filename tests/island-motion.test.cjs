'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {ISLAND_CONFIG, FocusModel, activitySnapshot, createSurfaceMotion, closedBandSize, shape} = require('../notch.js');

const frame = key => {
  const state = ISLAND_CONFIG.states[key];
  return {width: state.width, height: state.height, band: state.height, radius: state.radius, progress: key === 'expanded' ? 1 : 0, shoulder:0};
};

test('real Focus boundaries keep the supplied discreet geometry without enlarging other notifications or the resting notch', () => {
  for (const kind of ['focus','break','task','cycle']) {
    const size=closedBandSize('compact',{feedback:{id:'focus',kind:'phase',boundary:{kind}}});
    assert.deepEqual(size,{width:360,band:58,radius:18,shoulder:0,progress:0});
    assert.equal(shape({...size,height:size.band},960).totalWidth,360);
  }
  assert.equal(closedBandSize('compact',{feedback:{id:'shelf',kind:'complete'}}).band,72);
  assert.equal(closedBandSize('rest',{feedback:{boundary:{kind:'cycle'}}}).band,10);
  assert(Object.isFrozen(ISLAND_CONFIG.focusPeek));
});

test('island constants preserve all three specified states and immutable motion values', () => {
  assert.deepEqual(ISLAND_CONFIG.states, {rest: {width: 128, height: 10, radius: 6}, compact: {width: 240, height: 40, radius: 10}, expanded: {width: 844, height: 464, radius: 40}});
  assert.deepEqual(ISLAND_CONFIG.layout, {header: 80, side: 16, bottom: 16, footer: 32, gap: 16, columns: 3, rows: 3});
  assert.deepEqual(ISLAND_CONFIG.activities,{widths:[240,300,360],height:42,radius:6,shoulder:8,peekScale:1,sceneHeight:464,fullHeight:464,durationDetailHeight:496,expandedHeight:464,headerTop:16,headerHeight:48,sceneTop:80,side:16,bottom:16,gap:16});
  assert(Object.isFrozen(ISLAND_CONFIG.layout));
  assert.equal(ISLAND_CONFIG.spring.stiffness, 400);
  assert.equal(ISLAND_CONFIG.spring.damping, 30);
  assert.equal(ISLAND_CONFIG.spring.mass, 1);
  assert.equal(ISLAND_CONFIG.durations.surface, 500);
  assert.equal(ISLAND_CONFIG.durations.contentExit, 150);
  assert.equal(ISLAND_CONFIG.delays.content, 80);
  assert.deepEqual(ISLAND_CONFIG.rest, {marker:4,handleWidth:28,handleHeight:2,progressLeft:14,progressWidth:70,equalizerBars:4,equalizerWidth:2,equalizerHeight:6,equalizerGap:2,equalizerInset:18});
  assert(Object.isFrozen(ISLAND_CONFIG.states.compact));
  assert(Object.isFrozen(ISLAND_CONFIG.compact.equalizerDelays));
  assert(Object.isFrozen(ISLAND_CONFIG.activities.widths));
});

test('discreet stays thin with any activity count and only hover reveals the dynamic row', () => {
  assert.deepEqual(closedBandSize('rest'), {width:128,band:10,radius:6,shoulder:0,progress:0});
  for (let count=1; count<=4; count++) {
    const activities=Array.from({length:count},(_,index)=>({id:['focus','music','transfer','file'][index]}));
    const width=[240,300,360][Math.min(count,3)-1];
    assert.deepEqual(closedBandSize('rest',{activities}), {width:128,band:10,radius:6,shoulder:0,progress:0});
    const peek=closedBandSize('compact',{activities});
    for (const [key,value] of Object.entries({width,band:42,radius:6,shoulder:8})) assert(Math.abs(peek[key]-value)<1e-9,key);
    assert.equal(peek.progress,0,'preview never becomes the central panel');
  }
  assert.deepEqual(closedBandSize('compact'), {width:240,band:40,radius:10,shoulder:0,progress:0});
  assert.deepEqual(closedBandSize('rest',{ready:true,activities:[{id:'music'}]}), {width:128,band:10,radius:6,shoulder:0,progress:0}, 'a stale introduction flag cannot override the discreet geometry');
});

test('completed work gives the surface a restrained spring pulse and can be interrupted', () => {
  const motion = createSurfaceMotion(), target = {width:594,height:324,band:48,radius:14,progress:1,shoulder:0};
  assert.equal(motion.pulse(),false);
  motion.setTarget(target,{snap:true}); motion.step(0); assert.equal(motion.pulse(),true);
  let maximum=324;
  for(let now=16;now<=600;now+=16) maximum=Math.max(maximum,motion.step(now).height);
  assert(maximum>324 && maximum<324*1.03); assert.equal(motion.isActive(),false);
  assert.equal(motion.step(620).height,324);
  motion.pulse(); const before=motion.step(636); motion.setTarget({...target,width:128,height:10,band:10,radius:6,progress:0});
  assert.equal(motion.step(636).height,before.height,'retargeting starts at the current surface');
  for(let now=652;now<=1252;now+=16) motion.step(now);
  assert.equal(motion.step(1268).height,10); assert.equal(motion.pulse(Infinity),false);
});

test('activity selection uses real Focus, paused media and one transfer without changing their data', () => {
  const focus={...FocusModel.defaults(),sessionActive:true,remaining:1122,minutes:25,task:'Read the reference'};
  const music={available:true,title:'Real track',artist:'Real artist',position:42,playing:false};
  const transfer={status:'receiving',direction:'receive',progress:37,alias:'Phone'};
  const file={status:'running',source:{name:'Real document.pdf'},progress:{current:1,total:4}};
  const input={focus,music,transfer,file,now:1000}, before=structuredClone(input);
  const values=activitySnapshot(input);
  assert.deepEqual(values.map(item=>item.id),['focus','music','transfer']);
  assert.equal(values[0].value,'18:42'); assert.equal(values[0].detail,focus.task); assert.equal(values[0].playing,false);
  assert.equal(values[1].label,music.title); assert.equal(values[1].detail,music.artist); assert.equal(values[1].value,'0:42'); assert.equal(values[1].playing,false);
  assert.equal(values[2].progress,.37); assert.equal(values[2].value,'37 %'); assert.equal(values[2].detail,transfer.alias);
  assert.deepEqual(input,before);
  const running=activitySnapshot({focus:{...focus,deadline:1123000},now:1000})[0];
  assert.equal(running.value,'18:42'); assert.equal(running.playing,true);
});

test('idle services do not create an activity and file progress is measured only when available', () => {
  for (const status of ['idle','ready','discovery','complete','cancelled','rejected','error']) assert.deepEqual(activitySnapshot({transfer:{status}}),[]);
  assert.deepEqual(activitySnapshot({focus:{...FocusModel.defaults(),complete:true},music:{available:false},file:{status:'complete'}}),[]);
  assert.deepEqual(activitySnapshot({focus:{sessionActive:true,pomodoro:{finished:true}}}),[]);
  for (const status of ['incoming','preparing','waiting']) assert.equal(activitySnapshot({transfer:{status,progress:80}})[0].progress,null,'preparation cannot claim transferred bytes');
  const file={status:'running',source:{name:'Report.pdf'},progress:{current:2,total:8}};
  const measured=activitySnapshot({file})[0]; assert.equal(measured.id,'file'); assert.equal(measured.progress,.25); assert.equal(measured.detail,'Report.pdf');
  assert.equal(activitySnapshot({file:{...file,progress:null}})[0].progress,null,'conversion with no measured progress stays indeterminate');
  assert.equal(activitySnapshot({file,transfer:{status:'receiving',progress:120}})[0].id,'transfer','a transfer replaces the file activity rather than duplicating it');
  assert.equal(activitySnapshot({transfer:{status:'sending',progress:120}})[0].progress,1);
  assert.equal(activitySnapshot({transfer:{status:'sending',progress:-20}})[0].progress,0);
  assert.equal(activitySnapshot({transfer:{status:'sending',progress:Infinity}})[0].progress,null);
});

test('size and bottom corners share the exact 400/30/1 spring, rebound gently and finish in half a second', () => {
  for (const [from, to] of [['compact', 'expanded'], ['expanded', 'compact']]) {
    const start = frame(from), end = frame(to), motion = createSurfaceMotion();
    motion.setTarget(start); motion.step(0); motion.setTarget(end);
    let max = 0;
    for (let now = 1; now <= 500; now++) {
      const value = motion.step(now), relative = (value.width - start.width) / (end.width - start.width);
      max = Math.max(max, relative);
      for (const key of ['height', 'band', 'radius', 'progress']) {
        const sameSpring = (value[key] - start[key]) / (end[key] - start[key]);
        assert(Math.abs(sameSpring - relative) < 1e-10, key + ' must share the size spring');
      }
    }
    assert(max > 1.027 && max < 1.029, 'rebound should be about 2.8% in either direction');
    assert.deepEqual(motion.step(500), end);
    assert.equal(motion.isActive(), false);
  }
});

test('reversing during expansion preserves the current frame and velocity, while reduced motion snaps safely', () => {
  const motion = createSurfaceMotion(), start = frame('compact'), end = frame('expanded');
  motion.setTarget(start); motion.step(0); motion.setTarget(end);
  const before = motion.step(50);
  motion.setTarget(start);
  assert.deepEqual(motion.step(50), before, 'retargeting must not jump');
  assert(motion.step(51).width > before.width, 'opening momentum must be carried into reversal');
  assert.equal(motion.setTarget({...end, width: NaN}), false);
  for (let now = 52; now <= 551; now++) assert(Object.values(motion.step(now)).every(Number.isFinite));
  assert.deepEqual(motion.step(551), start);
  motion.setTarget(end); assert.deepEqual(motion.step(552, {snap: true}), end);
  assert.equal(motion.isActive(), false);
  motion.setTarget(start, {snap: true}); assert.deepEqual(motion.step(553), start);
  const legacy={...start};delete legacy.shoulder;
  motion.setTarget(legacy,{snap:true});assert.deepEqual(motion.step(554),start,'legacy geometry without ears normalizes to zero shoulder');
  assert.equal(motion.setTarget({...start,shoulder:NaN}),false);
});

test('ears share the size spring and every closing or opening contour stays valid and bounded', () => {
  const row={...closedBandSize('compact',{activities:[{id:'focus'},{id:'music'},{id:'transfer'}]})};row.height=row.band;
  const open={...frame('expanded'),band:48};
  for (const [start,end] of [[open,row],[row,frame('rest')],[row,open]]) {
    const motion=createSurfaceMotion();motion.setTarget(start);motion.step(0);motion.setTarget(end);
    for (let now=1;now<=500;now++) {
      const value=motion.step(now), relative=(value.width-start.width)/(end.width-start.width);
      for (const key of ['height','band','radius','progress','shoulder']) {
        const distance=end[key]-start[key];
        if (distance) assert(Math.abs((value[key]-start[key])/distance-relative)<1e-9,key+' follows the same spring');
      }
      for (const viewport of [320,375,960]) {
        const contour=shape(value,viewport);
        assert(contour.width>=1 && contour.height>=1);
        assert(contour.totalWidth<=viewport-32+1e-7);
        assert(contour.shoulder>=0 && contour.radius>=0);
        assert(contour.shoulder+contour.radius<=contour.height+1e-7);
        assert(contour.radius<=contour.width/2+1e-7);
        assert(!contour.path.includes('NaN'));
      }
    }
    assert.deepEqual(motion.step(500),end);assert.equal(motion.isActive(),false);
  }
});

test('plain states keep straight top corners while activity rows add painted ears', () => {
  for (const state of Object.values(ISLAND_CONFIG.states)) {
    const value = shape(state, 1920);
    assert.equal(value.shoulder, 0);
    assert.equal(value.totalWidth, state.width);
    assert.equal(value.radius, state.radius);
    assert(value.path.startsWith('M0 0 H' + state.width + ' V'));
    assert.equal((value.path.match(/Q/g) || []).length, 2);
    assert(value.path.endsWith('V0 Z'));
  }
  const tiny = shape({width: 240, height: -2, radius: -1}, 320);
  assert.equal(tiny.height, 1);
  assert.equal(tiny.radius, 0);
  assert(!tiny.path.includes('NaN'));
  const activity=closedBandSize('compact',{activities:[{id:'focus'}]});
  const ears=shape({...activity,height:activity.band},960);
  assert.equal(ears.width,240);assert.equal(ears.totalWidth,256);assert.equal(ears.shoulder,8);assert.equal(ears.radius,6);
  assert.equal((ears.path.match(/C/g)||[]).length,2,'preview keeps the smaller painted ears');
  assert.equal((ears.path.match(/A6 6/g)||[]).length,2,'lower corners use the reduced circular radius');
});

test('preview reduces both lower corners and shoulders without changing the cubic shape or screen margins', () => {
  const row=closedBandSize('compact',{activities:[{id:'focus'}]});
  const preview=shape({...row,height:row.band},960);
  assert.equal(preview.shoulder,8); assert.equal(preview.radius,6); assert.equal(preview.height,42);
  const cubic=[...preview.path.matchAll(/C([^A-Za-z]+)/g)].map(match=>match[1].trim().split(/\s+/).map(Number));
  assert.equal(cubic.length,2);
  assert(Math.abs(cubic[0][0]-(preview.width+preview.shoulder*1.45))<1e-9);
  assert(Math.abs(cubic[0][3]-preview.shoulder*.45)<1e-9);
  assert(Math.abs(cubic[1][2]-preview.shoulder*.55)<1e-9);
  assert.equal((preview.path.match(/A6 6/g)||[]).length,2);
  const narrow=shape({...row,height:row.band},240);
  assert.equal(narrow.totalWidth,208); assert.equal(narrow.shoulder,8); assert.equal(narrow.radius,6);
  assert.equal((narrow.path.match(/C/g)||[]).length,2); assert.equal((narrow.path.match(/A/g)||[]).length,2);
  assert(!narrow.path.includes('Q'),'clamping the width must not substitute another curve');
});
