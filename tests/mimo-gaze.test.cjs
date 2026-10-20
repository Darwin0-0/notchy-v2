const test = require('node:test');
const assert = require('node:assert/strict');
const {attachMimo} = require('../welcome.js');

function fixture(options = {}) {
  const frames = new Map(); let clock = 0, frameId = 0;
  const eventTarget = value => Object.assign(value, {
    listeners: new Map(),
    addEventListener(type, listener) {if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener);},
    removeEventListener(type, listener) {const listeners = this.listeners.get(type); listeners?.delete(listener); if (!listeners?.size) this.listeners.delete(type);},
    fire(type, event = {}) {for (const listener of [...(this.listeners.get(type) || [])]) listener(event);}
  });
  const reduced = eventTarget({matches:!!options.reduced});
  const window = {matchMedia:() => reduced, requestAnimationFrame(callback) {const id = ++frameId; frames.set(id, callback); return id;}, cancelAnimationFrame:id => frames.delete(id)};
  const document = eventTarget({hidden:false, defaultView:window});
  const element = () => ({attributes:{}, style:{}, setAttribute(name, value) {this.attributes[name] = value;}, getAttribute(name) {return this.attributes[name];}});
  const shell = element(), features = element(), eyes = element();
  // The original intro rule applied this origin to both groups. A volume matrix
  // must explicitly neutralise that inherited center, including on an About clone.
  features.style.transformOrigin = '32px 32px';
  const mark = {...element(), ownerDocument:document, dataset:{}, style:{},
    getBoundingClientRect:() => ({left:100, top:100, width:64, height:64}),
    querySelector:selector => ({'.welcome-mimo-shell':shell, '.welcome-mimo-features':features, '.welcome-mimo-eyelids':eyes})[selector]
  };
  const scope = options.scope ? eventTarget({}) : document;
  const controller = attachMimo(mark, {...options, scope});
  const step = (milliseconds = 16) => {clock += milliseconds; const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(clock));};
  const settle = () => {for (let index = 0; frames.size && index < 200; index++) step(); assert.equal(frames.size, 0, 'the spring must stop after it settles');};
  return {frames, reduced, document, mark, shell, features, eyes, scope, controller, step, settle,
    move(x, y, extra = {}) {scope.fire('pointermove', {clientX:x, clientY:y, ...extra});}};
}

function facePolygon(d) {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g), polygons = [];
  let index = 0, polygon, x = 0, y = 0;
  const number = () => Number(tokens[index++]);
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === 'M') {x = number(); y = number(); polygon = [[x,y]]; polygons.push(polygon);}
    else if (command === 'H') {x = number(); polygon.push([x,y]);}
    else if (command === 'V') {y = number(); polygon.push([x,y]);}
    else if (command === 'C') {
      const [x1,y1,x2,y2,x3,y3] = Array.from({length:6}, number), startX = x, startY = y;
      for (let step = 1; step <= 32; step++) {const t = step / 32, u = 1 - t; polygon.push([u*u*u*startX+3*u*u*t*x1+3*u*t*t*x2+t*t*t*x3,u*u*u*startY+3*u*u*t*y1+3*u*t*t*y2+t*t*t*y3]);}
      x = x3; y = y3;
    } else assert.equal(command, 'Z', 'The actual V1 shell consists only of closed absolute cubic contours');
  }
  return polygons.at(-1);
}
function contains(polygon, [x,y]) {
  let inside = false;
  for (let index = 0, prior = polygon.length - 1; index < polygon.length; prior = index++) {
    const [x1,y1] = polygon[index], [x2,y2] = polygon[prior];
    if ((y1 > y) !== (y2 > y) && x < (x2-x1)*(y-y1)/(y2-y1)+x1) inside = !inside;
  }
  return inside;
}
function eyesInFace(f) {
  const values = value => value?.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/g)?.map(Number);
  const matrix = values(f.features.attributes.transform) || [1,0,0,1,0,0], gaze = values(f.eyes.attributes.transform) || [0,0];
  const origin = values(f.features.style.transformOrigin) || [0,0];
  const project = ([x,y]) => [matrix[0]*(x+gaze[0]-origin[0])+matrix[2]*(y+gaze[1]-origin[1])+matrix[4]+origin[0],matrix[1]*(x+gaze[0]-origin[0])+matrix[3]*(y+gaze[1]-origin[1])+matrix[5]+origin[1]];
  const face = facePolygon(f.shell.attributes.d), centers = [];
  for (const cx of [23,41]) {
    centers.push(project([cx,32]));
    for (let point = 0; point < 48; point++) {
      const angle = point / 48 * Math.PI * 2, projected = project([cx+4.5*Math.cos(angle),32+4.5*Math.sin(angle)]);
      assert(contains(face,projected), 'Every point of each projected eye stays inside the actual black face: '+JSON.stringify({projected,head:f.controller.inspect(),matrix,origin}));
    }
  }
  return {centerX:(centers[0][0]+centers[1][0])/2, centerY:(centers[0][1]+centers[1][1])/2};
}

test('the gaze turns monotonically from left to right and never double-centres the volume projection', () => {
  const f = fixture(); let previous = -Infinity;
  for (const x of [-10000,4,36,68,100,132,164,196,228,260,10000]) {
    f.move(x,132); f.settle(); const projected = eyesInFace(f);
    assert(projected.centerX >= previous-1e-6,'Looking left cannot turn the eyes back toward the right');
    if (x<132) assert(projected.centerX<32); if (x>132) assert(projected.centerX>32);
    previous = projected.centerX;
  }
  assert.equal(f.features.style.transformOrigin,'0px 0px','The affine matrix already owns its pivot');
  f.controller.dispose();
});

test('both eyes remain confined to the actual inset through all corners, spring frames and rapid reversals', () => {
  const f = fixture();
  const sample = () => {eyesInFace(f); const state = f.controller.inspect(); assert(Math.abs(state.x)<=1+1e-6&&Math.abs(state.y)<=1+1e-6);};
  for (const [x,y] of [[10000,10000],[-10000,10000],[-10000,-10000],[10000,-10000],[132,10000],[132,-10000]]) {
    f.move(x,y); for (let frame=0;frame<180&&f.frames.size;frame++){f.step(frame%3===0?48:16);sample();} assert.equal(f.frames.size,0);
  }
  for(let frame=0;frame<240;frame++){f.move(frame%5<2?-10000:10000,frame%7<3?-10000:10000);f.step(frame%2?8:32);sample();}
  f.settle(); sample(); f.scope.fire('pointerleave');
  for(let frame=0;frame<180&&f.frames.size;frame++){f.step();sample();}
  assert.equal(f.controller.inspect().x,0); assert.equal(f.controller.inspect().y,0);
  f.reduced.matches=true; f.reduced.fire('change'); f.move(10000,10000); sample();
  assert.equal(f.frames.size,0); assert.equal(f.controller.inspect().active,false); f.controller.dispose();
});

test('Mimo keeps the V1 silhouette, turns its inset face and eyes toward the pointer, and stops at rest', () => {
  const f = fixture(), neutral = f.shell.attributes.d;
  assert.equal(f.frames.size, 0); assert.equal(f.controller.inspect().animating, false);
  f.move(260, 260); assert.equal(f.frames.size, 1); f.step();
  const first = f.controller.inspect(); assert(first.x > 0 && first.x < 1); assert(first.y > 0 && first.y < 1);
  assert.notEqual(f.shell.attributes.d, neutral); assert.match(f.features.attributes.transform, /^matrix\(/);
  assert.match(f.eyes.attributes.transform, /^translate\(/); assert.match(f.mark.style.transform, /rotate\(.+deg\)/);
  f.settle(); assert.equal(f.controller.inspect().x, 1); assert.equal(f.controller.inspect().y, 1);
  assert.equal(f.controller.inspect().animating, false); assert.equal(f.mark.dataset.mimoActive, 'true');
  assert.notEqual(f.shell.attributes.d, neutral, 'the inset reveals the shell flank instead of only sliding two eyes');
  f.controller.dispose(); assert.equal(f.shell.attributes.d, neutral); assert.equal(f.mark.style.transform, '');
});

test('a reversal keeps the live head pose and velocity instead of snapping to its new target', () => {
  const f = fixture(); f.move(260, 132); for (let i = 0; i < 6; i++) f.step();
  const before = f.controller.inspect().x; f.move(4, 132);
  assert.equal(f.controller.inspect().x, before, 'input retargets the spring without replacing its current pose');
  assert.equal(f.controller.inspect().targetX, -1); f.step(); assert(f.controller.inspect().x > -1);
  f.settle(); assert.equal(f.controller.inspect().x, -1); f.controller.dispose();
});

test('leaving the surface eases the head back while keyboard input makes the mascot immediately neutral', () => {
  const f = fixture(), neutral = f.shell.attributes.d; f.move(260, 4); f.settle();
  f.scope.fire('pointerleave'); assert.equal(f.controller.inspect().targetX, 0); assert.equal(f.frames.size, 1);
  f.settle(); assert.equal(f.shell.attributes.d, neutral); assert.equal(f.eyes.attributes.transform, '');
  f.move(4, 260); f.step(); assert.notEqual(f.shell.attributes.d, neutral);
  f.scope.fire('keydown', {key:'Tab'}); assert.equal(f.frames.size, 0); assert.equal(f.shell.attributes.d, neutral);
  f.controller.dispose();
});

test('a hidden welcome or About panel removes pointer handlers and cancels its pending frame', () => {
  const f = fixture({active:false}); assert.equal(f.scope.listeners.has('pointermove'), false);
  f.move(260, 260); assert.equal(f.frames.size, 0);
  f.controller.setActive(true); assert.equal(f.scope.listeners.has('pointermove'), true);
  f.move(260, 260); f.step(); f.controller.setActive(false);
  assert.equal(f.frames.size, 0); assert.equal(f.scope.listeners.has('pointermove'), false);
  assert.equal(f.scope.listeners.has('keydown'), false); assert.equal(f.mark.dataset.mimoActive, 'false');
  f.controller.setActive(true); assert.equal(f.frames.size, 0, 'opening does not start an idle animation loop');
  assert.equal(f.controller.inspect().x, 0); f.controller.dispose();
});

test('reduced motion and a disabled animation preference keep the real head static and remove pointer work', () => {
  let motion = true; const f = fixture({motion:() => motion}), neutral = f.shell.attributes.d;
  f.move(260, 260); f.step(); f.reduced.matches = true; f.reduced.fire('change');
  assert.equal(f.frames.size, 0); assert.equal(f.shell.attributes.d, neutral); assert.equal(f.scope.listeners.has('pointermove'), false);
  f.reduced.matches = false; f.reduced.fire('change'); f.move(260, 4); f.step();
  motion = false; f.controller.refresh(); assert.equal(f.frames.size, 0); assert.equal(f.shell.attributes.d, neutral);
  assert.equal(f.mark.dataset.mimoActive, 'false'); motion = true; f.controller.refresh();
  assert.equal(f.frames.size, 0); assert.equal(f.scope.listeners.has('pointermove'), true); f.controller.dispose();
});

test('window visibility cancels motion and resumes input without replaying the last pointer gesture', () => {
  const f = fixture(), neutral = f.shell.attributes.d; f.move(260, 260); f.step();
  f.document.hidden = true; f.document.fire('visibilitychange'); assert.equal(f.frames.size, 0);
  assert.equal(f.shell.attributes.d, neutral); assert.equal(f.controller.inspect().active, false);
  f.document.hidden = false; f.document.fire('visibilitychange'); assert.equal(f.controller.inspect().active, true);
  assert.equal(f.frames.size, 0); assert.equal(f.controller.inspect().targetX, 0); f.controller.dispose();
});

test('touch, invalid coordinates and a zero-size mascot never start pointer animation', () => {
  const f = fixture(); f.move(260, 260, {pointerType:'touch'}); f.move(NaN, 260); f.move(260, Infinity);
  f.mark.getBoundingClientRect = () => ({left:0, top:0, width:0, height:0}); f.move(260, 260);
  assert.equal(f.frames.size, 0); assert.equal(f.controller.inspect().x, 0); f.controller.dispose();
});

test('a scoped controller disposes every listener once and cannot be restarted', () => {
  const f = fixture({scope:true}); assert.equal(f.document.listeners.has('pointermove'), false);
  f.move(260, 260); f.controller.dispose(); f.controller.dispose(); f.controller.setActive(true); f.controller.refresh();
  assert.equal(f.frames.size, 0); assert.equal(f.scope.listeners.size, 0); assert.equal(f.document.listeners.size, 0);
  assert.equal(f.reduced.listeners.size, 0); assert.equal(f.controller.inspect().disposed, true); assert.equal(f.mark.dataset.mimoActive, 'false');
});
