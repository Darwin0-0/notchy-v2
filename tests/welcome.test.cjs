const test = require('node:test');
const assert = require('node:assert/strict');
const {create} = require('../welcome.js');

function fixture() {
  const frames = new Map(), animations = [], observers = [], timers = new Map();
  let now = 0, nextTimer = 1;
  const eventTarget = value => Object.assign(value, {
    listeners: new Map(),
    addEventListener(type, listener) {this.listeners.set(type, listener);},
    removeEventListener(type) {this.listeners.delete(type);},
    fire(type, event = {}) {this.listeners.get(type)?.(event);}
  });
  const reduced = eventTarget({matches: false});
  const window = {
    matchMedia: () => reduced,
    requestAnimationFrame(callback) {const id = frames.size + 1; frames.set(id, callback); return id;},
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout(callback, delay) {const id = nextTimer++; timers.set(id, {callback, at: now + delay}); return id;},
    clearTimeout: id => timers.delete(id),
    MutationObserver: class {
      constructor(callback) {this.callback = callback; observers.push(this);}
      observe() {this.connected = true;}
      disconnect() {this.connected = false;}
    }
  };
  const document = eventTarget({hidden: false, defaultView: window});
  const makeNode = (tag, ownerDocument = document) => eventTarget({
    tagName: tag, ownerDocument, children: [], dataset: {}, style: {}, attributes: {}, classList: {add() {}},
    append(...children) {for (const child of children) {child.parent = this; this.children.push(child);}},
    replaceChildren(...children) {this.children = []; this.append(...children);},
    setAttribute(name, value) {this.attributes[name] = value;},
    contains(node) {return node === this || this.children.some(child => child.contains(node));},
    closest() {return this.dataset.welcomeCommand ? this : this.parent?.closest();},
    focus(options) {this.focusOptions = options; document.activeElement = this;},
    get firstElementChild() {return this.children[0];},
    get lastElementChild() {return this.children.at(-1);},
    animate(keyframes, options) {const animation = {target: this, keyframes, options, finished: new Promise(() => {}), cancel() {this.cancelled = true;}}; animations.push(animation); return animation;}
  });
  document.createElement = makeNode; document.createElementNS = (_, tag) => makeNode(tag); document.body = makeNode('body');
  const host = makeNode('section');
  const all = node => [node, ...node.children.flatMap(all)];
  return {document, reduced, host, animations, observers, frames, timers,
    nodes: () => all(host),
    click(command) {const node = all(host).find(node => node.dataset.welcomeCommand === command); assert(node, command); host.fire('click', {target: node});},
    flushFocus() {const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback());},
    advance(milliseconds) {const end = now + milliseconds; for (;;) {const ready = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!ready) break; now = ready[1].at; timers.delete(ready[0]); ready[1].callback();} now = end;}
  };
}

test('the restored introduction reveals the real V1 Mimo head before the welcome and useful guide', () => {
  const f = fixture(); let started = 0, finished = 0; const stages = [];
  const welcome = create({host: f.host, start: () => started++, tutorialFinish: () => finished++, stageChanged: stage => stages.push(stage)});
  welcome.show();
  assert.deepEqual(stages, ['idle']); assert.equal(welcome.inspect().blinking, false); assert.equal(f.animations.length, 0);
  f.advance(119); assert.equal(welcome.inspect().stage, 'idle'); f.advance(1);
  assert.deepEqual(stages, ['idle','logo']); assert.equal(welcome.inspect().blinking, true);
  assert(f.animations.length > 0); assert(f.animations.every(animation => animation.options.duration + animation.options.delay <= 500));
  assert(f.animations.every(animation => animation.keyframes.every(frame => !frame.filter && !frame.transform?.includes('scale'))));
  const head=f.nodes().find(node => node.attributes.viewBox === '0 0 64 64' && node.attributes['data-mimo-source'] === 'notchy-v1');
  assert(head); assert.equal(head.attributes['aria-hidden'],'true');
  const shapes=f.nodes().filter(node=>head.contains(node)&&['path','circle','rect'].includes(node.tagName));
  assert.equal(shapes.length,4); assert(!shapes.some(node=>node.tagName==='rect'),'the exact V1 shell and features have no added ears or props');
  assert(f.nodes().some(node => node.attributes['fill-rule'] === 'evenodd' && node.attributes.d === 'M25 8H39C51 8 58 16 58 28V37C58 50 51 55 39 55H25C13 55 6 50 6 37V28C6 16 13 8 25 8Z M25 12C15 12 10 18 10 28V37C10 47 15 51 25 51H39C49 51 54 47 54 37V28C54 18 49 12 39 12Z'));
  assert(f.nodes().some(node => node.attributes['aria-label'] === 'Notchy'));
  const eyes=f.nodes().filter(node => node.attributes.class === 'welcome-mimo-eye'); assert.equal(eyes.length, 2);
  assert.deepEqual(eyes.map(eye=>[eye.attributes.cx,eye.attributes.cy,eye.attributes.r,eye.attributes.fill]),[[23,32,4.5,'#ffffff'],[41,32,4.5,'#ffffff']]);
  assert(!f.nodes().some(node => node.attributes.viewBox === '0 0 40 40'));
  assert(!f.nodes().some(node => /glow|mimo-body|mimo-pc/.test(node.className)));
  assert.equal(f.host.dataset.welcomeDesign, 'mimo-head'); assert.equal(f.timers.size, 5);
  f.advance(1780); assert.deepEqual(stages,['idle','logo','welcome']); assert.equal(f.timers.size,0);
  f.flushFocus();
  assert.equal(f.document.activeElement.dataset.welcomeCommand, 'start');
  assert.deepEqual(f.document.activeElement.focusOptions, {preventScroll: true}, 'Focusing Start must not scroll the growing island and crop Mimo');
  const introAnimations = [...f.animations];
  f.click('tutorial');
  assert(introAnimations.every(animation => animation.cancelled));
  assert.equal(welcome.inspect().stage, 'tour');
  assert.equal(welcome.inspect().blinking, false);
  assert.equal(f.nodes().filter(node => node.attributes.viewBox === '0 0 150 60').length, 3);
  f.click('previous'); assert.equal(welcome.inspect().step, 0);
  f.click('next'); assert.equal(welcome.inspect().step, 1);
  assert(f.nodes().some(node => node.textContent?.includes('Pomodoro')));
  f.click('next'); assert.equal(welcome.inspect().step, 2);
  assert(f.nodes().some(node => node.textContent?.includes('LocalSend')));
  f.click('finish');
  assert.equal(finished, 1); assert.equal(started, 0); assert.equal(f.host.hidden, true);
  assert.equal(stages.at(-1), 'done'); assert.equal(welcome.inspect().animating, false);
  assert.equal(f.timers.size, 0);
  welcome.dispose();
});

test('visibility, reduced motion and the animation preference cancel motion and deferred focus', () => {
  const f = fixture(); let motion = true;
  const welcome = create({host: f.host, motion: () => motion});
  f.reduced.matches = true; welcome.show();
  assert(f.animations.every(animation => animation.options.duration === 150 && animation.options.delay === 0 && animation.keyframes.every(frame => Object.keys(frame).join() === 'opacity')));
  f.reduced.matches = false; motion = false; f.observers[0].callback(); welcome.show();
  assert(f.animations.every(animation => animation.options.duration === 150));
  const beforeHidden = f.animations.length;
  motion = true; f.document.hidden = true; f.document.fire('visibilitychange'); welcome.show(); assert.equal(f.animations.length, beforeHidden); assert.equal(f.frames.size, 0);
  f.document.hidden = false; welcome.hide(); welcome.show(); f.advance(120); assert.equal(welcome.inspect().animating, true);
  const beforePreference = [...f.animations]; motion = false; f.observers[0].callback(); assert(beforePreference.every(animation => animation.cancelled));
  assert(f.animations.slice(beforePreference.length).every(animation => animation.options.duration === 150 && animation.keyframes.every(frame => Object.keys(frame).join() === 'opacity')));
  motion = true; welcome.hide(); welcome.show(); f.advance(120); const beforeReduced = [...f.animations]; f.reduced.matches = true; f.reduced.fire('change'); assert(beforeReduced.every(animation => animation.cancelled));
  assert.equal(welcome.inspect().stage, 'welcome'); assert.equal(f.timers.size, 0);
  f.reduced.matches = false; welcome.hide(); welcome.show(); f.advance(120); f.document.hidden = true; f.document.fire('visibilitychange');
  assert.equal(welcome.inspect().animating, false); assert.equal(f.frames.size, 0);
  assert.equal(f.timers.size, 0); assert.equal(f.host.dataset.welcomeMotion, 'false');
  welcome.dispose(); welcome.dispose();
  assert.equal(f.observers[0].connected, false); assert.equal(f.host.listeners.size, 0);
  assert.equal(f.document.listeners.size, 0); assert.equal(f.reduced.listeners.size, 0);
  assert.equal(welcome.show(), false);
});

test('hiding an unfinished introduction cannot reopen it later', () => {
  const f = fixture(), stages = []; const welcome = create({host: f.host, stageChanged: stage => stages.push(stage)});
  welcome.show(); f.advance(120); welcome.hide(); f.advance(5000);
  assert.deepEqual(stages, ['idle','logo']); assert.equal(f.timers.size, 0); assert.equal(f.frames.size, 0);
  assert.equal(f.host.hidden, true); assert.equal(welcome.isActive(), false);
  assert(f.animations.every(animation => animation.cancelled));
  welcome.dispose();
});

test('Escape returns from the guide to Discover without dismissing the welcome', () => {
  const f = fixture(); const welcome = create({host: f.host, motion: false});
  welcome.show('tutorial');
  let prevented = false, stopped = false;
  f.host.fire('keydown', {key: 'Escape', preventDefault() {prevented = true;}, stopPropagation() {stopped = true;}});
  f.flushFocus();
  assert.equal(welcome.inspect().page, 'welcome'); assert.equal(welcome.isActive(), true);
  assert.equal(f.document.activeElement.dataset.welcomeCommand, 'tutorial');
  assert.equal(prevented, true); assert.equal(stopped, true);
  welcome.hide(); assert.equal(f.frames.size, 0); welcome.dispose();
});

test('locale renders never restart Mimo and the blink is active only on the visible welcome', () => {
  const f = fixture(); let locale = 'fr', changed;
  f.document.defaultView.NotchyI18n = {t:value => value,locale:()=>locale,onChange(callback){changed=callback;return()=>{changed=null;};}};
  const welcome = create({host:f.host}); welcome.show(); f.advance(1900); const entranceCount=f.animations.length;
  locale='en'; changed(); welcome.show();
  assert.equal(f.animations.length,entranceCount); assert.equal(welcome.inspect().blinking,true);
  f.document.hidden=true; f.document.fire('visibilitychange'); assert.equal(welcome.inspect().blinking,false);
  f.document.hidden=false; f.document.fire('visibilitychange'); assert.equal(welcome.inspect().blinking,true);
  assert.equal(f.animations.length,entranceCount,'visibility restores the eyes without replaying the entrance');
  f.click('tutorial'); assert.equal(welcome.inspect().blinking,false);
  welcome.hide(); assert.equal(welcome.inspect().blinking,false); welcome.dispose(); assert.equal(changed,null);
});

test('intro renders preserve one staged sequence and reduced motion cancels its pending reveal', () => {
  const f=fixture();let changed;
  f.document.defaultView.NotchyI18n={t:value=>value,locale:()=> 'fr',onChange(callback){changed=callback;}};
  const stages=[],welcome=create({host:f.host,stageChanged:stage=>stages.push(stage)});
  welcome.show();welcome.show();changed();assert.equal(f.timers.size,2);
  f.advance(120);const animations=f.animations.length;changed();welcome.show();assert.equal(f.animations.length,animations);assert.equal(f.timers.size,5);
  f.reduced.matches=true;f.reduced.fire('change');assert.equal(welcome.inspect().stage,'welcome');assert.equal(f.timers.size,0);assert.equal(welcome.inspect().blinking,false);
  f.advance(5000);assert.deepEqual(stages,['idle','logo','welcome']);
  welcome.dispose();
});

test('Mimo wakes, looks toward the revealed name and settles before the welcome without owning the blink', () => {
  const f=fixture(),welcome=create({host:f.host});
  const find=name=>f.nodes().find(node=>node.attributes.class===name||node.className===name);
  welcome.show(); f.advance(120); assert.equal(welcome.inspect().beat,'wake');
  const features=find('welcome-mimo-features'),eyelids=find('welcome-mimo-eyelids'),mascot=find('welcome-mascot'),wordmark=find('welcome-wordmark');
  assert.match(mascot.style.transform,/translateX\(54px\)/);
  f.advance(300);assert.equal(welcome.inspect().beat,'awake');
  const waking=f.animations.find(animation=>animation.target===eyelids);assert.equal(waking.options.duration,220);
  assert.equal(waking.keyframes[0].transform,'scaleY(.12)');assert.equal(waking.keyframes[1].transform,'scaleY(1)');
  assert(!f.animations.some(animation=>animation.target.attributes.class==='welcome-mimo-eye'),'individual eye transforms remain owned by the continuous blink');
  f.advance(260);assert.equal(welcome.inspect().beat,'curious');assert.equal(features.style.transform,'translate(2px,-0.5px)');
  assert.match(mascot.style.transform,/rotate\(3deg\)/);
  f.advance(220);assert.equal(welcome.inspect().beat,'name');assert.equal(mascot.style.transform,'');
  assert(f.animations.some(animation=>animation.target===wordmark&&animation.keyframes[0].opacity===0&&animation.keyframes.at(-1).opacity===1));
  f.advance(400);assert.equal(welcome.inspect().beat,'ready');assert.equal(features.style.transform,'');
  assert(f.animations.some(animation=>animation.target===mascot&&animation.keyframes.some(frame=>frame.transform==='translateY(1.5px) rotate(1.5deg)')));
  f.advance(599);assert.equal(welcome.inspect().stage,'logo');f.advance(1);assert.equal(welcome.inspect().stage,'welcome');
  assert(f.animations.every(animation=>animation.options.duration+animation.options.delay<=500));
  welcome.dispose();
});

test('closing at any narrative beat cancels every remaining gesture and resets the face pose', () => {
  for(const elapsed of [120,420,680,900,1300]) {
    const f=fixture(),stages=[],welcome=create({host:f.host,stageChanged:stage=>stages.push(stage)});welcome.show();f.advance(elapsed);
    const count=stages.length;welcome.hide();f.advance(5000);
    assert.equal(stages.length,count);assert.equal(f.timers.size,0);assert.equal(f.frames.size,0);assert.equal(welcome.inspect().blinking,false);
    assert(f.animations.every(animation=>animation.cancelled));
    for(const node of f.nodes().filter(node=>['welcome-mimo-features','welcome-mimo-eyelids'].includes(node.attributes.class)||node.className==='welcome-mascot'))assert.equal(node.style.transform,'');
    welcome.dispose();
  }
});

test('a rapidly reversed guide transition starts from the current rendered value', () => {
  const f = fixture(); f.document.defaultView.getComputedStyle=()=>({opacity:'.43',transform:'matrix(1, 0, 0, 1, 8, 0)'});
  const welcome=create({host:f.host}); welcome.show('tutorial'); const first=f.animations[0];
  f.click('next'); assert.equal(first.cancelled,true);
  assert(f.animations.some(animation=>animation.keyframes[0].opacity==='.43'&&animation.keyframes[0].transform==='matrix(1, 0, 0, 1, 8, 0)'));
  f.click('previous'); assert.equal(welcome.inspect().step,0);
  assert(f.animations.every(animation=>animation.options.duration+animation.options.delay<=500));
  welcome.dispose(); assert(f.animations.every(animation=>animation.cancelled));
});
