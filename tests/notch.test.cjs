const test = require('node:test');
const assert = require('node:assert/strict');
const {createSurfaceMotion, shape, normalizeMusic, musicPosition, spectrumLevels} = require('../notch.js');

const closed = {width: 260, height: 14, band: 14, radius: 4, progress: 0};
const opened = {width: 640, height: 280, band: 32, radius: 28, progress: 1};

test('opening remains bounded and all dimensions move together', () => {
  const motion = createSurfaceMotion();
  motion.setTarget(closed); motion.step(0); motion.setTarget(opened);
  let previous = closed;
  for (let now = 16; now <= 640; now += 16) {
    const frame = motion.step(now);
    assert(frame.width >= previous.width && frame.width <= opened.width);
    assert(frame.height >= previous.height && frame.height <= opened.height);
    assert(Math.abs((frame.width - closed.width) / 380 - (frame.height - closed.height) / 266) < .00001);
    previous = frame;
  }
  assert.deepEqual(motion.step(660), opened);
  assert.equal(motion.isActive(), false);
});

test('reversing preserves the painted position and ends without a recurring clock', () => {
  const motion = createSurfaceMotion();
  motion.setTarget(closed); motion.step(0); motion.setTarget(opened);
  const before = motion.step(50);
  motion.setTarget(closed);
  assert.deepEqual(motion.step(50), before);
  for (let now = 66; now <= 740; now += 16) motion.step(now);
  assert.deepEqual(motion.step(750), closed);
  assert.equal(motion.isActive(), false);
  assert.equal(motion.setTarget({...opened, width: NaN}), false);
});

test('the contour keeps centered shoulders and rounded ends in small viewports', () => {
  const reduced = shape(closed, 960);
  assert.equal(reduced.height, 14); assert.equal(reduced.radius, 4);
  assert.equal(reduced.shoulder, 4.9); assert.equal(reduced.totalWidth, 269.8);
  const narrow = shape({...opened, width: 343}, 375);
  assert.equal(narrow.shoulder, 16); assert.equal(narrow.totalWidth, 375);
  assert.equal(narrow.radius, 28); assert(!narrow.path.includes('NaN'));
});

test('music keeps omitted artwork only for the same track and rejects remote or SVG covers', () => {
  const cover = 'data:image/png;base64,aGVsbG8=';
  const music = normalizeMusic({available: true, title: 'Titre', artist: 'Artiste', source: 'Spotify', cover, playing: true, duration: 180, position: 30, canToggle: true});
  assert.equal(music.cover, cover);
  assert.equal(normalizeMusic({...music, cover: undefined}, music).cover, cover);
  assert.equal(normalizeMusic({...music, title: 'Autre titre', cover: undefined}, music).cover, '');
  assert.equal(normalizeMusic({...music, cover: 'https://example.com/cover.jpg'}).cover, '');
  assert.equal(normalizeMusic({...music, cover: 'data:image/svg+xml;base64,aGVsbG8='}).cover, '');
  assert.equal(normalizeMusic(null).available, false);
  assert.equal(normalizeMusic({...music, available: false}).playing, false);
});

test('progression advances from its received timestamp, freezes in pause and stays bounded', () => {
  const music = normalizeMusic({available: true, playing: true, position: 30, duration: 180});
  assert.equal(musicPosition(music, 1500), 31.5);
  assert.equal(musicPosition({...music, playing: false}, 1500), 30);
  assert.equal(musicPosition(music, 900000), 180);
  assert.equal(musicPosition(music, -1000), 30);
  assert.equal(normalizeMusic({...music, position: Infinity}).position, 0);
  assert.equal(normalizeMusic({...music, canNext: false}).canNext, false);
});

test('seeking is available only with a confirmed native capability and a known timeline', () => {
  const value = {available: true, title: 'Titre', duration: 180, canSeek: true};
  assert.equal(normalizeMusic(value).canSeek, true);
  for (const extra of [{canSeek: 1}, {canSeek: 'true'}, {canSeek: undefined}, {duration: 0}, {duration: Infinity}, {available: false}]) {
    assert.equal(normalizeMusic({...value, ...extra}).canSeek, false);
  }
});

test('quiet real spectrum samples remain visibly dynamic without animating silence', () => {
  assert.deepEqual(spectrumLevels(Array(8).fill(0)), Array(5).fill(0));
  assert.deepEqual(spectrumLevels(Array(8).fill(.01)), Array(5).fill(0));
  const low = spectrumLevels(Array(8).fill(.03)), normal = spectrumLevels(Array(8).fill(.165));
  assert(normal.every((value, index) => value > low[index] && value <= 1));
  assert(normal.every(value => 16 * (.16 + value * .84) > 12));
  assert.deepEqual(spectrumLevels(Array(8).fill(1)), Array(5).fill(1));
  assert.equal(spectrumLevels([0, 1]), null);
  assert.equal(spectrumLevels([NaN, 0, 0, 0, 0, 0, 0, 0]), null);
});

function interactionFixture() {
  const source = require('node:fs').readFileSync(require.resolve('../notch.js'), 'utf8');
  const start = source.indexOf('  function protectedInteraction('), end = source.indexOf('  function showFileChooser(', start);
  const timers = new Map(), changes = [];
  let nextTimer = 0, focused = null;
  const scope = {
    window: {clearTimeout: id => timers.delete(id), setTimeout: callback => {timers.set(++nextTimer, callback); return nextTimer;}, queueMicrotask: callback => callback()},
    document: {hasFocus: () => true, get activeElement() {return focused;}},
    // The browser may retain :hover after Windows cuts the native window region.
    notch: {matches: () => true, contains: element => element?.inside === true, getBoundingClientRect: () => ({top: 0})},
    getModuleEditorActive: () => false, changes,
  };
  require('node:vm').runInNewContext(`
    let disposed=false,state='hover',view='nook',collapseTimer=0,collapseDeferred=false,pointerInside=true,
      keyboardNavigation=false,keyboardPointerOutside=false,activationPoint=null,naturalOpenHeight=200,
      fileDialogOpen=false,fileDragging=false,seekDragging=false,queueOpen=false,queueBusy=false,queueOperation='',
      welcome=null,localSendContext=null,nearby={},queueState={};
    function setState(next) {state=next;changes.push(next);}
    function update() {}
    ${source.slice(start, end)}
    this.api={enter,leave,nativePointer,focusInteraction,focusDeparture,keyboardInteraction,pointerPosition,toggleFocus,
      get state(){return state;},get pending(){return collapseTimer;},set state(value){state=value;},set dragging(value){seekDragging=value;},set dialog(value){fileDialogOpen=value;},set disposed(value){disposed=value;}};
  `, scope);
  return {api: scope.api, changes, focus: element => {focused = element;}, flush: () => {const pending = [...timers.values()]; timers.clear(); for (const callback of pending) callback();}};
}

test('pointer leave collapses even when the native host leaves CSS hover stale', () => {
  const f = interactionFixture();
  f.api.leave(); f.flush();
  assert.equal(f.api.state, 'discreet');
});

test('returning to the notch cancels collapse and dragging defers it until release', () => {
  const f = interactionFixture();
  f.api.leave(); f.api.enter(); f.flush();
  assert.equal(f.api.state, 'hover');
  f.api.dragging = true; f.api.leave(); f.flush();
  assert.equal(f.api.state, 'hover');
  f.api.dragging = false; f.api.focusDeparture(); f.flush();
  assert.equal(f.api.state, 'discreet');
});

test('restoring mouse focus to the toggle never wakes a closed notch, keyboard focus still does', () => {
  const f = interactionFixture();
  f.api.state = 'discreet'; f.api.toggleFocus();
  assert.equal(f.api.state, 'discreet');
  f.api.keyboardInteraction({key: 'Tab'}); f.api.toggleFocus();
  assert.equal(f.api.state, 'hover');
});

test('real mouse movement outside ends the keyboard menu guard and permits discreet mode', () => {
  const f = interactionFixture();
  f.api.state = 'open';
  f.focus({closest: selector => selector === '#notch-toggle,#notch-panel,#notch-menu' ? {} : null});
  f.api.keyboardInteraction({key: 'Tab'}); f.api.leave(); f.flush();
  assert.equal(f.api.state, 'open');
  f.api.pointerPosition({pointerType: 'mouse', movementX: 8, movementY: 0, target: {inside: false}}); f.flush();
  assert.equal(f.api.state, 'discreet');
});

test('native cursor exit collapses when Windows omits DOM leave and ignores duplicate samples', () => {
  const f = interactionFixture();
  f.api.nativePointer({inside:false}); const timer = f.api.pending;
  f.api.nativePointer({inside:false}); assert.equal(f.api.pending,timer);
  f.flush(); assert.equal(f.api.state,'discreet');
  f.api.nativePointer({inside:true}); assert.equal(f.api.state,'hover');
  const changes=f.changes.length;
  for(const value of [null,true,{}, {inside:1}, {inside:'false'}, {inside:true}]) f.api.nativePointer(value);
  assert.equal(f.changes.length,changes);
  f.api.disposed=true;f.api.nativePointer({inside:false});f.flush();assert.equal(f.api.state,'hover');
});

test('native cursor exit respects keyboard focus and file dialogues until the interaction ends', () => {
  const f = interactionFixture();f.api.state='discreet';
  f.api.keyboardInteraction({key:'Tab'});f.api.toggleFocus();
  f.focus({closest: selector => selector === '#notch-toggle,#notch-panel,#notch-menu' ? {} : null});
  f.api.nativePointer({inside:false});f.flush();assert.equal(f.api.state,'hover');
  f.api.pointerPosition({pointerType:'mouse',movementX:8,movementY:0,target:{inside:false}});f.flush();assert.equal(f.api.state,'discreet');
  f.focus(null);f.api.nativePointer({inside:true});f.api.dialog=true;
  f.api.nativePointer({inside:false});f.flush();assert.equal(f.api.state,'hover');
  f.api.dialog=false;f.api.focusDeparture();f.flush();assert.equal(f.api.state,'discreet');
});

test('only a confirmed native mouse movement releases the keyboard guard outside the WebView', () => {
  const f=interactionFixture();f.api.state='open';
  f.focus({closest: selector => selector === '#notch-toggle,#notch-panel,#notch-menu' ? {} : null});
  f.api.keyboardInteraction({key:'Tab'});
  f.api.nativePointer({inside:false,moved:false});f.flush();assert.equal(f.api.state,'open');
  f.api.nativePointer({inside:false,moved:'true'});f.flush();assert.equal(f.api.state,'open');
  f.api.nativePointer({inside:false,moved:true});const timer=f.api.pending;assert(timer);
  f.api.nativePointer({inside:false,moved:true});assert.equal(f.api.pending,timer);
  f.flush();assert.equal(f.api.state,'discreet');
});

test('native cursor exit defers collapse during a drag and real entry cancels a pending collapse', () => {
  const f=interactionFixture();f.api.dragging=true;f.api.nativePointer({inside:false});f.flush();assert.equal(f.api.state,'hover');
  f.api.dragging=false;f.api.focusDeparture();assert(f.api.pending);
  f.api.nativePointer({inside:true});f.flush();assert.equal(f.api.state,'hover');
  f.api.nativePointer({inside:false});f.flush();assert.equal(f.api.state,'discreet');
});

function spectrumFixture() {
  const source = require('node:fs').readFileSync(require.resolve('../notch.js'), 'utf8');
  const start = source.indexOf('  function clearSpectrum('), end = source.indexOf('  function renderTime(', start);
  const subscribe = source.indexOf('  function syncStream('), subscribeEnd = source.indexOf('  async function commandMusic(', subscribe);
  const bar = () => ({style: {level: '0', setProperty(name, value) {assert.equal(name, '--level'); this.level = value;}}});
  const liveBars = Array.from({length: 5}, bar), playerBars = Array.from({length: 5}, bar), feedbackBars = Array.from({length: 5}, bar), sources = [];
  class EventSource {
    constructor(url) {this.url=url;this.listeners={};this.closed=false;sources.push(this);}
    addEventListener(name, callback) {this.listeners[name]=callback;}
    close() {this.closed=true;}
  }
  const scope = {window: {EventSource}, document: {hidden: false}, spectrumLevels, liveBars, playerBars, feedbackBars,
    spectrumBars: [...liveBars, ...playerBars, ...feedbackBars], byId: () => ({hidden: true}),
    isModuleEnabled: () => true, motionEnabled: () => true, builtinVisible: () => false,
    syncClock() {}, renderMusic() {}, setMusic() {}, update() {}};
  require('node:vm').runInNewContext(`let disposed=false,fileDragging=false,state='discreet',music={playing:true},connectionLost=false,
    stream=null,retiringStream=null,streamSpectrum=false,musicError='';
    ${source.slice(start, end)}${source.slice(subscribe, subscribeEnd)}
    this.api={receiveSpectrum,syncStream,set state(value){state=value;},set playing(value){music.playing=value;}};`, scope);
  return {api: scope.api, liveBars, playerBars, sources, scope};
}

test('discreet music subscribes to real audio and updates its visible spectrum', () => {
  const f = spectrumFixture(); f.api.syncStream();
  assert.equal(f.sources[0].url, '/api/music/events?spectrum=1');
  f.api.receiveSpectrum(Array(8).fill(.1));
  assert(f.liveBars.every(bar => Number(bar.style.level) > 0));
  assert(f.playerBars.every(bar => bar.style.level === '0'));
  f.api.receiveSpectrum(Array(8).fill(0));
  assert(f.liveBars.every(bar => bar.style.level === '0'));
  f.api.playing = false; f.api.receiveSpectrum(Array(8).fill(1));
  assert(f.liveBars.every(bar => bar.style.level === '0'));
});

test('spectrum subscriptions switch without leaks and stop for hidden or motion-disabled content', () => {
  const f = spectrumFixture(); f.api.syncStream();
  f.sources[0].listeners.open();
  f.api.state = 'open'; f.api.syncStream();
  assert.equal(f.sources[1].url, '/api/music/events?spectrum=0');
  f.sources[1].listeners.open(); assert.equal(f.sources[0].closed, true);
  f.api.state = 'hover'; f.api.syncStream();
  f.sources[2].listeners.open(); assert.equal(f.sources[1].closed, true);
  f.scope.motionEnabled = () => false; f.api.syncStream();
  assert.equal(f.sources[3].url, '/api/music/events?spectrum=0');
  f.sources[3].listeners.open(); assert.equal(f.sources[2].closed, true);
  f.scope.document.hidden = true; f.api.syncStream();
  assert.equal(f.sources[3].closed, true);
  assert(f.liveBars.every(bar => bar.style.level === '0'));
});
