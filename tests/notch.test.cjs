const test = require('node:test');
const assert = require('node:assert/strict');
const {createSurfaceMotion, shape, normalizeMusic, musicPosition, spectrumLevels, closedBandSize} = require('../notch.js');

const closed = {width: 260, height: 14, band: 14, radius: 4, progress: 0};
const opened = {width: 640, height: 280, band: 32, radius: 28, progress: 1};

test('opening has a restrained rebound, stays bounded and settles all dimensions together', () => {
  const motion = createSurfaceMotion();
  motion.setTarget(closed); motion.step(0); motion.setTarget(opened);
  let peak = opened.width;
  for (let now = 16; now <= 1000; now += 16) {
    const frame = motion.step(now);
    for (const key of Object.keys(closed)) {
      const distance = opened[key] - closed[key];
      assert(Number.isFinite(frame[key]));
      assert(frame[key] >= closed[key] && frame[key] <= opened[key] + distance * .02);
    }
    assert(Math.abs((frame.width - closed.width) / 380 - (frame.height - closed.height) / 266) < .00001);
    peak = Math.max(peak, frame.width);
  }
  assert(peak > opened.width + 380 * .01 && peak < opened.width + 380 * .02);
  assert.deepEqual(motion.step(1020), opened);
  assert.equal(motion.isActive(), false);
});

test('reversing preserves the painted position and ends without a recurring clock', () => {
  const motion = createSurfaceMotion();
  motion.setTarget(closed); motion.step(0); motion.setTarget(opened);
  const before = motion.step(50);
  motion.setTarget(closed);
  assert.deepEqual(motion.step(50), before);
  const carried = motion.step(51);
  assert(carried.width > before.width, 'a reversal keeps its current momentum instead of snapping velocity');
  for (let now = 67; now <= 1000; now += 16) {
    assert(Object.values(motion.step(now)).every(Number.isFinite));
  }
  assert.deepEqual(motion.step(1020), closed);
  assert.equal(motion.isActive(), false);
  assert.equal(motion.setTarget({...opened, width: NaN}), false);
  motion.setTarget(opened, {snap: true});
  assert.deepEqual(motion.step(1030), opened);
  assert.equal(motion.isActive(), false);
  motion.setTarget(closed);
  assert.deepEqual(motion.step(1040, {snap: true}), closed);
  assert.equal(motion.isActive(), false);
  const stalled = createSurfaceMotion(), capped = createSurfaceMotion();
  for (const spring of [stalled, capped]) {spring.setTarget(closed); spring.step(0); spring.setTarget(opened);}
  assert.deepEqual(stalled.step(NaN), closed);
  assert.deepEqual(stalled.step(Infinity), closed);
  assert.deepEqual(stalled.step(10000), capped.step(50), 'a suspended frame advances by at most 50 ms');
});

test('the painted spring sends valid native geometry on every large-panel closing frame', () => {
  const source = require('node:fs').readFileSync(require.resolve('../notch.js'), 'utf8');
  const start = source.indexOf('  function paint('), end = source.indexOf('  function update(', start);
  assert(start >= 0 && end > start);
  const motion = createSurfaceMotion(), sent = [];
  motion.setTarget({...opened, height: 480, band: 40}); motion.step(0); motion.setTarget(closed);
  const node = () => ({attributes: {}, setAttribute(name, value) {this.attributes[name] = value;}});
  const scope = {
    motion, shape, document: {hidden: false}, motionEnabled: () => true, desktopPointer() {},
    window: {innerWidth: 960, cancelAnimationFrame() {}, requestAnimationFrame: () => 1},
    notch: {style: {values: {}, setProperty(name, value) {this.values[name] = value;}}},
    surface: node(), contour: node(), bandCut: node(), panelCut: node(),
    desktop: {sendGeometry(value) {
      assert(Object.values(value).filter(item => typeof item === 'number').every(Number.isFinite));
      assert(value.width >= 1 && value.width <= 1200 && value.height >= 1 && value.height <= 900);
      assert(value.band >= 0 && value.band <= value.height + .001, 'the native host rejects a band taller than its window');
      assert(value.shoulder >= 0 && value.shoulder <= value.height && value.shoulder * 2 < value.width);
      assert(value.radius >= 0 && value.radius <= Math.min(value.height, value.width - value.shoulder * 2) / 2, `invalid native radius: ${JSON.stringify(value)}`);
      assert(value.shoulder + value.radius <= value.height);
      assert.equal(parseFloat(scope.notch.style.values['--band']), value.band);
      assert.equal(scope.panelCut.attributes.transform, `translate(${-value.shoulder} ${-value.band})`);
      sent.push(value); return Promise.resolve({});
    }},
  };
  require('node:vm').runInNewContext(`let frame=0,disposed=false,geometry,desktopMaxHeight=0,state='discreet';
    ${source.slice(start, end)}this.paint=paint;`, scope);
  for (let now = 0; now <= 1000; now += 16) {
    scope.paint(now);
    const opacity = Number(scope.notch.style.values['--menu-opacity']);
    assert(opacity >= 0 && opacity <= 1);
  }
  assert(sent.some(value => value.height < 14), 'the test includes the actual closing rebound');
  assert.equal(sent.at(-1).height, 14);
  assert.equal(sent.at(-1).band, 14);
  assert.equal(motion.isActive(), false);
});

test('the contour keeps centered shoulders and rounded ends in small viewports', () => {
  const reduced = shape(closed, 960);
  assert.equal(reduced.height, 14); assert.equal(reduced.radius, 4);
  assert.equal(reduced.shoulder, 4.9); assert.equal(reduced.totalWidth, 269.8);
  const narrow = shape({...opened, width: 343}, 375);
  assert.equal(narrow.shoulder, 16); assert.equal(narrow.totalWidth, 375);
  assert.equal(narrow.radius, 28); assert(!narrow.path.includes('NaN'));
});

test('discreet geometry stays 14 pixels with music, focus, transfers and completion feedback', () => {
  for (const activity of [{}, {music:true}, {focus:true}, {music:true,focus:true}, {transfer:true},
    {music:true,feedback:'track'}, {focus:true,feedback:'done'}, {music:true,focus:true,transfer:true,feedback:'done'}]) {
    const size = closedBandSize('discreet', activity);
    assert.deepEqual(size, {width:260,band:14,radius:4,progress:0});
    const contour = shape({...size,height:size.band},960);
    assert.equal(contour.height,14);
    assert.equal(contour.totalWidth,269.8);
  }
  for (const activity of [{}, {music:true}, {focus:true}, {music:true,focus:true}, {transfer:true}]) {
    const preview = closedBandSize('hover',activity);
    assert.equal(preview.width,closedBandSize('discreet',activity).width * 1.2);
    assert.equal(preview.band,36);
    assert(preview.band >= 24,'the whole hover target remains usable');
  }
  assert.equal(closedBandSize('hover',{feedback:'done'}).band,110);
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
    this.api={receiveSpectrum,syncStream,clearSpectrum,set state(value){state=value;},set playing(value){music.playing=value;}};`, scope);
  return {api: scope.api, liveBars, playerBars, sources, scope};
}

test('discreet music skips hidden audio capture and real samples animate only the hover spectrum', () => {
  const f = spectrumFixture(); f.api.syncStream();
  assert.equal(f.sources[0].url, '/api/music/events?spectrum=0');
  f.api.receiveSpectrum(Array(8).fill(.1));
  assert(f.liveBars.every(bar => bar.style.level === '0'));
  assert(f.playerBars.every(bar => bar.style.level === '0'));
  f.api.state = 'hover'; f.api.syncStream();
  assert.equal(f.sources[1].url, '/api/music/events?spectrum=1');
  f.sources[1].listeners.open(); assert.equal(f.sources[0].closed,true);
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
  f.api.state = 'hover'; f.api.syncStream();
  assert.equal(f.sources[1].url, '/api/music/events?spectrum=1');
  f.sources[1].listeners.open(); assert.equal(f.sources[0].closed, true);
  f.scope.builtinVisible = () => true; f.api.state = 'open'; f.api.syncStream();
  assert.equal(f.sources.length,2,'An open visible player keeps the current audio subscription');
  f.api.receiveSpectrum(Array(8).fill(.1));
  assert(f.playerBars.every(bar => Number(bar.style.level) > 0));
  assert(f.liveBars.every(bar => bar.style.level === '0'));
  f.scope.builtinVisible = () => false; f.api.clearSpectrum(); f.api.syncStream();
  assert.equal(f.sources[2].url, '/api/music/events?spectrum=0');
  f.sources[2].listeners.open(); assert.equal(f.sources[1].closed, true);
  f.api.receiveSpectrum(Array(8).fill(1));
  f.sources[1].listeners.spectrum({data:JSON.stringify(Array(8).fill(1))});
  assert(f.playerBars.every(bar => bar.style.level === '0'));
  f.api.state = 'hover'; f.api.syncStream();
  f.sources[3].listeners.open(); assert.equal(f.sources[2].closed, true);
  f.scope.motionEnabled = () => false; f.api.syncStream();
  assert.equal(f.sources[4].url, '/api/music/events?spectrum=0');
  f.sources[4].listeners.open(); assert.equal(f.sources[3].closed, true);
  f.scope.document.hidden = true; f.api.syncStream();
  assert.equal(f.sources[4].closed, true);
  assert(f.liveBars.every(bar => bar.style.level === '0'));
});

function liveBandFixture() {
  const source = require('node:fs').readFileSync(require.resolve('../notch.js'),'utf8');
  const body = (start,end) => source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
  const elements = new Map();
  const element = () => ({hidden:false,dataset:{},attributes:{},children:[],style:{values:{},setProperty(name,value){this.values[name]=value;},getPropertyValue(name){return this.values[name]||'';}},
    setAttribute(name,value){this.attributes[name]=value;},removeAttribute(){},querySelector(){return element();},querySelectorAll(){return[];},cloneNode(){return element();},replaceChildren(...children){this.children=children;},append(child){this.children.push(child);}});
  const byId = id => {if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  const scope = {byId,notch:element(),document:{createElement:()=>element()},focusCardValues:()=>({completed:1,total:4}),
    isModuleEnabled:()=>true,text:(node,value)=>{node.textContent=value;},shelfGlyph:()=>element(),localSendCount:count=>`${count} fichiers`};
  require('node:vm').runInNewContext(`
    let state='discreet',fileDragging=false,connectionLost=false,music={available:true,playing:true,title:'Titre',artist:'Artiste'},
      focus={sessionActive:true,pomodoro:{phase:'work',finished:false}},focusSettings={},moduleFeedback=null,transfer=null,nearby={peers:[]};
    const live=byId('music-live'),strip=byId('music-discreet-progress'),focusStrip=byId('focus-discreet-progress');
    function focusIsActive(){return focus.sessionActive;}
    function localSendBand(){return transfer;}
    function renderLocalSend(){renderLocalSendBand();}
    ${body('  function renderModuleFeedback(','  function clearModuleFeedback(')}
    ${body('  function musicInBand(','  function homePrimary(')}
    ${body('  function renderLocalSendBand(','  function renderLocalSend(')}
    this.api={render:renderLiveActivities,set state(value){state=value;},set transfer(value){transfer=value;},set feedback(value){moduleFeedback=value;},set dragging(value){fileDragging=value;},set playing(value){music.playing=value;}};
  `,scope);
  return {api:scope.api,byId};
}

test('discreet mode shows thin progress while rich music and the focus ring belong to hover', () => {
  const f=liveBandFixture();f.api.render();
  for(const id of ['live-activities','music-live','focus-live','module-feedback-live'])assert.equal(f.byId(id).hidden,true,id);
  for(const id of ['music-discreet-progress','focus-discreet-progress'])assert.equal(f.byId(id).hidden,false,id);
  f.api.state='hover';f.api.render();
  for(const id of ['live-activities','music-live','focus-live'])assert.equal(f.byId(id).hidden,false,id);
  assert.equal(f.byId('focus-discreet-progress').hidden,true,'The focus ring and progress bar never overlap');
  f.api.state='open';f.api.render();
  for(const id of ['live-activities','music-live','focus-live','music-discreet-progress','focus-discreet-progress'])assert.equal(f.byId(id).hidden,true,id);
  f.api.state='discreet';f.api.playing=false;f.api.render();
  assert.equal(f.byId('music-discreet-progress').hidden,true,'Paused music does not prevent reduction');
  assert.equal(f.byId('focus-discreet-progress').hidden,false);
});

test('feedback never reveals a rich card in discreet mode and transfer progress stays thin', () => {
  const f=liveBandFixture();
  f.api.feedback={id:'music',kind:'track',title:'Titre',detail:'Artiste',sequence:1};f.api.render();
  assert.equal(f.byId('module-feedback-live').hidden,true);
  assert.equal(f.byId('module-feedback-spectrum').hidden,true);
  f.api.state='hover';f.api.render();
  assert.equal(f.byId('module-feedback-live').hidden,false);
  assert.equal(f.byId('live-activities').hidden,true,'Hover feedback temporarily owns the activity content');
  f.api.state='discreet';f.api.transfer={stage:'progress',direction:'receive',progress:37};f.api.render();
  for(const id of ['live-activities','module-feedback-live','localsend-live','music-discreet-progress','focus-discreet-progress'])assert.equal(f.byId(id).hidden,true,id);
  assert.equal(f.byId('localsend-discreet-progress').hidden,false);
  assert.equal(f.byId('localsend-discreet-progress').attributes['aria-valuenow'],'37');
  assert.equal(f.byId('localsend-discreet-progress').style.values['--localsend-progress'],'0.37');
  f.api.transfer={stage:'complete',direction:'receive',count:2};f.api.render();
  assert.equal(f.byId('localsend-live').hidden,true);
  assert.equal(f.byId('localsend-discreet-progress').attributes['aria-valuenow'],'100');
  f.api.state='hover';f.api.render();
  assert.equal(f.byId('localsend-live').hidden,false);
  assert.equal(f.byId('localsend-discreet-progress').hidden,true);
  f.api.state='open';f.api.render();
  assert.equal(f.byId('localsend-live').hidden,true);
  assert.equal(f.byId('localsend-discreet-progress').hidden,true);
});
