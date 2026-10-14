const test = require('node:test');
const assert = require('node:assert/strict');
const {create} = require('../welcome.js');

function fixture() {
  const frames = new Map(), animations = [], observers = [];
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
    focus() {document.activeElement = this;},
    get firstElementChild() {return this.children[0];},
    get lastElementChild() {return this.children.at(-1);},
    animate(keyframes, options) {const animation = {keyframes, options, finished: new Promise(() => {}), cancel() {this.cancelled = true;}}; animations.push(animation); return animation;}
  });
  document.createElement = makeNode; document.createElementNS = (_, tag) => makeNode(tag); document.body = makeNode('body');
  const host = makeNode('section');
  const all = node => [node, ...node.children.flatMap(all)];
  return {document, reduced, host, animations, observers, frames,
    nodes: () => all(host),
    click(command) {const node = all(host).find(node => node.dataset.welcomeCommand === command); assert(node, command); host.fire('click', {target: node});},
    flushFocus() {const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback());}
  };
}

test('Mimo greets once and the manual guide finishes after three useful steps', () => {
  const f = fixture(); let started = 0, finished = 0;
  const welcome = create({host: f.host, start: () => started++, tutorialFinish: () => finished++});
  welcome.show(); f.flushFocus();
  assert.equal(f.document.activeElement.dataset.welcomeCommand, 'start');
  assert.equal(f.animations.length, 3);
  assert(f.animations.every(animation => animation.options.duration + animation.options.delay <= 820));
  assert(f.nodes().some(node => node.attributes.viewBox === '0 0 64 84' && node.attributes['aria-hidden'] === 'true'));
  assert(f.nodes().some(node => node.attributes.class === 'welcome-mimo-laptop'));
  assert(f.animations.some(animation => animation.keyframes.some(frame => frame.transform === 'translateY(-14px) rotate(-20deg)')));
  assert(f.nodes().some(node => node.textContent === 'Notchy'));
  f.click('tutorial');
  assert(f.animations.every(animation => animation.cancelled));
  assert.equal(welcome.inspect().animating, false);
  f.click('previous'); assert.equal(welcome.inspect().step, 0);
  f.click('next'); assert.equal(welcome.inspect().step, 1);
  assert(f.nodes().some(node => node.textContent?.includes('Pomodoro')));
  f.click('next'); assert.equal(welcome.inspect().step, 2);
  assert(f.nodes().some(node => node.textContent?.includes('LocalSend')));
  f.click('finish');
  assert.equal(finished, 1); assert.equal(started, 0); assert.equal(f.host.hidden, true);
  welcome.dispose();
});

test('visibility, reduced motion and the animation preference cancel motion and deferred focus', () => {
  const f = fixture(); let motion = true;
  const welcome = create({host: f.host, motion: () => motion});
  f.reduced.matches = true; welcome.show(); assert.equal(f.animations.length, 0);
  f.reduced.matches = false; motion = false; welcome.show(); assert.equal(f.animations.length, 0);
  motion = true; f.document.hidden = true; welcome.show(); assert.equal(f.animations.length, 0);
  f.document.hidden = false; welcome.show(); assert.equal(welcome.inspect().animating, true);
  motion = false; f.observers[0].callback(); assert.equal(welcome.inspect().animating, false);
  motion = true; welcome.show(); f.reduced.matches = true; f.reduced.fire('change'); assert.equal(welcome.inspect().animating, false);
  f.reduced.matches = false; welcome.show(); f.document.hidden = true; f.document.fire('visibilitychange');
  assert.equal(welcome.inspect().animating, false); assert.equal(f.frames.size, 0);
  welcome.dispose(); welcome.dispose();
  assert.equal(f.observers[0].connected, false); assert.equal(f.host.listeners.size, 0);
  assert.equal(f.document.listeners.size, 0); assert.equal(f.reduced.listeners.size, 0);
  assert.equal(welcome.show(), false);
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
