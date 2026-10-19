const test = require('node:test');
const assert = require('node:assert/strict');
const {ISLAND_CONFIG, activitySnapshot, createSurfaceMotion, shape, normalizeMusic, musicPosition, spectrumLevels, closedBandSize} = require('../notch.js');
const {create: createI18n} = require('../i18n.js');

const closed = {...ISLAND_CONFIG.states.rest, band: ISLAND_CONFIG.states.rest.height, progress: 0, shoulder:0};
const opened = {...ISLAND_CONFIG.states.expanded, band: 0, progress: 1, shoulder:0};

test('opening has a restrained rebound, stays bounded and settles all dimensions together', () => {
  const motion = createSurfaceMotion();
  motion.setTarget(closed); motion.step(0); motion.setTarget(opened);
  let peak = opened.width;
  for (let now = 16; now < 500; now += 16) {
    const frame = motion.step(now);
    for (const key of Object.keys(closed)) {
      const distance = opened[key] - closed[key];
      assert(Number.isFinite(frame[key]));
      if (!distance) {assert.equal(frame[key],closed[key]);continue;}
      const progress = (frame[key] - closed[key]) / distance;
      assert(progress >= 0 && progress <= 1.03);
    }
    assert(Math.abs((frame.width - closed.width) / (opened.width - closed.width) - (frame.height - closed.height) / (opened.height - closed.height)) < .00001);
    peak = Math.max(peak, frame.width);
  }
  const distance = opened.width - closed.width;
  assert(peak > opened.width + distance * .027 && peak < opened.width + distance * .029);
  assert.deepEqual(motion.step(500), opened);
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
    ISLAND_CONFIG, motion, shape, calendar: null, calendarHeightLimit: 0, document: {hidden: false}, motionEnabled: () => true, desktopPointer() {},
    window: {innerWidth: 960, cancelAnimationFrame() {}, requestAnimationFrame: () => 1},
    notch: {style: {values: {}, setProperty(name, value) {this.values[name] = value;}}},
    surface: node(), contour: node(), bandCut: node(), panelCut: node(),
    desktop: {sendGeometry(value) {
      assert(Object.values(value).filter(item => typeof item === 'number').every(Number.isFinite));
      assert(value.width >= 1 && value.width <= 1200 && value.height >= 1 && value.height <= 900);
      assert(value.band >= 0 && value.band <= value.height + .001, 'the native host rejects a band taller than its window');
      assert(value.shoulder >= 0 && value.shoulder <= value.height && value.shoulder * 2 < value.width);
      assert(value.radius >= 0 && value.radius <= Math.min(value.height, (value.width - value.shoulder * 2) / 2), `invalid native radius: ${JSON.stringify(value)}`);
      assert(value.shoulder + value.radius <= value.height);
      assert.equal(parseFloat(scope.notch.style.values['--band']), value.band);
      assert.equal(scope.panelCut.attributes.transform, `translate(${-value.shoulder} ${-value.band})`);
      sent.push(value); return Promise.resolve({});
    }},
  };
  require('node:vm').runInNewContext(`let frame=0,disposed=false,geometry,desktopMaxHeight=0,state='rest';
    ${source.slice(start, end)}this.paint=paint;`, scope);
  for (let now = 0; now <= 1000; now += 16) {
    scope.paint(now);
    const opacity = Number(scope.notch.style.values['--menu-opacity']);
    assert(opacity >= 0 && opacity <= 1);
  }
  assert(sent.some(value => value.height < closed.height), 'the test includes the actual closing rebound');
  assert.equal(sent.at(-1).height, closed.height);
  assert.equal(sent.at(-1).band, closed.band);
  assert.equal(motion.isActive(), false);
});

test('the contour stays flush to the top with only rounded bottom corners in small viewports', () => {
  const reduced = shape(closed, 960);
  assert.equal(reduced.height, 10); assert.equal(reduced.radius, 6);
  assert.equal(reduced.shoulder, 0); assert.equal(reduced.totalWidth, 128);
  const narrow = shape({...opened, width: 343}, 375);
  assert.equal(narrow.shoulder, 0); assert.equal(narrow.totalWidth, 343);
  assert.equal(narrow.radius, 14); assert(!narrow.path.includes('NaN'));
  assert(narrow.path.startsWith('M0 0 H343 V'));
  assert.equal((narrow.path.match(/Q/g) || []).length, 2);
});

test('the discreet strip stays thin while a temporary notification has its own bounded preview', () => {
  for (const activity of [{}, {music:true}, {focus:true}, {music:true,focus:true}, {transfer:true},
    {music:true,feedback:'track'}, {focus:true,feedback:'done'}, {music:true,focus:true,transfer:true,feedback:'done'}]) {
    const size = closedBandSize('rest', activity);
    assert.deepEqual(size, {width:128,band:10,radius:6,shoulder:0,progress:0});
    const contour = shape({...size,height:size.band},960);
    assert.equal(contour.height,10);
    assert.equal(contour.totalWidth,size.width);
  }
  for (const activity of [{}, {music:true}, {focus:true}, {music:true,focus:true}, {transfer:true}]) {
    const preview = closedBandSize('compact',activity);
    assert.equal(preview.width,240);
    assert.equal(preview.band,40);
    assert(preview.band >= 24,'the whole hover target remains usable');
  }
  assert.equal(closedBandSize('compact',{feedback:'done'}).band,72);
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
  const start = source.indexOf('  let layoutResizeClick'), end = source.indexOf('  function showFileChooser(', start);
  const closeStart = source.indexOf('  function outside(', end), closeEnd = source.indexOf('  function selectView(', closeStart);
  const timers = new Map(), changes = [];
  let nextTimer = 0, focused = null, now = 1000, transfer = null, documentFocused=true;
  const scope = {
    calendar:null,
    ISLAND_CONFIG, Date: {now: () => now},
    scenarioController: null,
    geometry: {width: 780, height: 480},
    window: {clearTimeout: id => timers.delete(id), setTimeout: (callback, delay) => {timers.set(++nextTimer, {callback, at: now + delay}); return nextTimer;}, queueMicrotask: callback => callback()},
    document: {hidden: false, hasFocus: () => documentFocused, get activeElement() {return focused;}},
    // The browser may retain :hover after Windows cuts the native window region.
    notch: {matches: () => true, contains: element => element?.inside === true, getBoundingClientRect: () => ({top: 0})},
    getModuleEditorActive: () => false, changes,
    localSendBand: () => transfer, desktop: null, clearModuleFeedback() {}, dismissMusicTrackFeedback() {},
  };
  require('node:vm').runInNewContext(`
    let disposed=false,state='compact',view='nook',collapseTimer=0,hoverTimer=0,collapseDeferred=false,pointerInside=true,welcomeReady=false,
      keyboardNavigation=false,closingTo=null,
      fileDialogOpen=false,fileDragging=false,seekDragging=false,queueOpen=false,queueBusy=false,queueOperation='',
      welcome=null,moduleFeedback=null,localSendContext=null,nearby={},queueState={},searchReturnView='nook',searchReturnState='rest',desktopMaxHeight=700,
      detailReturn=null,detailView='',settingsReturn=null,focusToolReturn=null,weatherPickerOpen=false,weatherInlineDetail=false;
    function setState(next) {state=next;closingTo=null;if(next==='rest')awaitingPointerEntry=false;changes.push(next);}
    function selectViewButton(button) {view=button.dataset.view;}
    function restoreFocusRoute(origin){selectViewButton({dataset:{view:origin.view}});setState('open');}
    ${source.slice(source.indexOf('  const settingsRoute ='),source.indexOf('  let calendar ='))}
    function update() {}
    ${source.slice(start, end)}${source.slice(closeStart, closeEnd)}
    ${source.slice(source.indexOf('  function searchOpening() {'), source.indexOf('  function searchClosed() {'))}
    const resume = ${source.match(/const removeResume = desktop\.onResume\((value => \{[^\n]+\})\);/)[1]};
    this.api={resume,openFromOutside,searchOpening,enter,leave,nativePointer,focusInteraction,focusDeparture,keyboardInteraction,pointerPosition,pointerInteraction,protectLayoutResize,toggleFocus,scheduleCollapse,open,outside,key,
      get state(){return state;},get view(){return view;},get pending(){return collapseTimer;},set state(value){state=value;},set view(value){view=value;},set closing(value){closingTo=value;},set dragging(value){seekDragging=value;},set dialog(value){fileDialogOpen=value;},set disposed(value){disposed=value;}};
  `, scope);
  function runDue() {
    for (const [id, timer] of [...timers]) if (timer.at <= now) {timers.delete(id); timer.callback();}
  }
  return {api: scope.api, changes, focus: element => {focused = element;}, documentFocus:value=>{documentFocused=value;},transfer: value => {transfer = value;},
    advance: milliseconds => {now += milliseconds; runDue();},
    flush: () => {if (timers.size) now = Math.max(now, ...[...timers.values()].map(timer => timer.at)); runDue();}};
}

test('pointer leave collapses even when the native host leaves CSS hover stale', () => {
  const f = interactionFixture();
  f.api.leave(); f.flush();
  assert.equal(f.api.state, 'rest');
});

test('moving the mouse away releases an input focus left behind by a click', () => {
  const f=interactionFixture();f.api.state='open';
  const input={id:'focus-task-input',inside:true,closest:selector=>selector==='input,textarea,select,[contenteditable="true"]'?{}:null};
  f.focus(input);f.api.pointerInteraction({target:input});f.api.focusInteraction();
  f.api.nativePointer({inside:false,moved:true});f.advance(279);assert.equal(f.api.state,'open');
  f.advance(1);assert.equal(f.api.state,'rest','a focused input is not proof the user is still editing it');
});

test('settings and scenario pages collapse after a real pointer departure', () => {
  for(const view of ['settings','scenarios']) {
    const f=interactionFixture();f.api.state='open';f.api.view=view;
    f.api.nativePointer({inside:false,moved:true});f.advance(280);
    assert.equal(f.api.state,'rest',view+' cannot hold the open panel by its route alone');
  }
});

test('typing stays protected until an actual mouse departure releases the editing guard', () => {
  const f=interactionFixture();f.api.state='open';
  const input={id:'focus-task-input',inside:true,closest:selector=>['input,textarea,select,[contenteditable="true"]','#notch-toggle,#notch-panel,#notch-menu,#island-footer'].includes(selector)?{}:null};
  f.focus(input);f.api.keyboardInteraction({key:'a',target:input});
  f.api.nativePointer({inside:false,moved:false});f.advance(1000);assert.equal(f.api.state,'open','stationary geometry updates cannot interrupt typing');
  f.api.nativePointer({inside:false,moved:true});f.advance(280);assert.equal(f.api.state,'rest','moving away explicitly ends editing protection');
});

test('blurring a keyboard-opened input outside the notch starts collapse without an earlier pointer departure', () => {
  const f=interactionFixture();f.api.state='rest';
  f.api.nativePointer({inside:false,moved:true});
  const input={id:'focus-task-input',inside:true,closest:selector=>['input,textarea,select,[contenteditable="true"]','#notch-toggle,#notch-panel,#notch-menu,#island-footer'].includes(selector)?{}:null};
  f.focus(input);f.api.keyboardInteraction({key:'Tab',target:input});f.api.open();
  assert.equal(f.api.state,'open');assert.equal(f.api.pending,0,'no pointer departure occurred after opening');
  f.api.focusDeparture();f.advance(1000);assert.equal(f.api.state,'open','moving focus within a real editing interaction remains protected');
  f.focus(null);f.api.focusDeparture();const timer=f.api.pending;
  f.advance(100);f.api.focusDeparture();assert.equal(f.api.pending,timer,'repeated focus events cannot restart the collapse delay');
  f.advance(179);assert.equal(f.api.state,'open');
  f.advance(1);assert.equal(f.api.state,'rest','ending the last protected interaction must not require another mouse exit');
});

test('opening search outside the island survives native geometry acknowledgement before focus arrives', () => {
  const f = interactionFixture(); f.api.state = 'rest'; f.documentFocus(false);
  f.api.nativePointer({inside: false, moved: false});
  f.api.searchOpening();
  f.api.nativePointer({inside: false, moved: false}); f.advance(1000);
  assert.equal(f.api.state, 'open', 'opening search is not a pointer departure and must survive the native focus handoff');
  f.documentFocus(true);
  f.api.nativePointer({inside: false, moved: true}); f.advance(1000);
  assert.equal(f.api.state, 'open', 'moving toward the island must not close it before its first real entry');
  f.api.nativePointer({inside: true, moved: true});
  f.api.nativePointer({inside: false, moved: true}); f.advance(279); assert.equal(f.api.state, 'open');
  f.advance(1); assert.equal(f.api.state, 'rest', 'after the first entry normal pointer departure still returns to discreet');
});

test('opening from the real desktop resume route waits for entry while DOM movement stays outside', () => {
  const f = interactionFixture(); f.api.state = 'rest'; f.api.nativePointer({inside: false, moved: false});
  f.api.resume({reason: 'open'});
  f.api.nativePointer({inside: false, moved: false});
  f.api.pointerPosition({pointerType: 'mouse', movementX: 8, movementY: -8, target: {inside: false}});
  f.advance(1000); assert.equal(f.api.state, 'open', 'the tray request stays available while the user reaches the island');
  f.api.nativePointer({inside: true, moved: true}); f.api.nativePointer({inside: false, moved: true});
  f.advance(280); assert.equal(f.api.state, 'rest');
  f.api.nativePointer({inside: true, moved: true}); f.advance(120);
  f.advance(1000); assert.equal(f.api.state, 'compact', 'later entry still previews without reopening the central panel');
});

test('an external opening releases its first-entry protection on deactivation and outside click', () => {
  for (const action of ['deactivate', 'outside']) {
    const f = interactionFixture(); f.api.state = 'rest'; f.api.nativePointer({inside: false, moved: false});
    f.api.searchOpening(); f.api.nativePointer({inside: false, moved: false}); f.advance(1000);
    assert.equal(f.api.state, 'open');
    if (action === 'deactivate') f.api.scheduleCollapse(true);
    else f.api.outside({target: {inside: false}});
    f.advance(280); assert.equal(f.api.state, 'rest', action + ' still dismisses an unopened pointer session');
  }
});

test('a stationary native geometry acknowledgement cannot wake the closed notch', () => {
  const f=interactionFixture();f.api.state='rest';f.api.nativePointer({inside:false,moved:false});
  f.api.nativePointer({inside:true,moved:false});f.advance(1000);
  assert.equal(f.api.state,'rest','region changes beneath a stationary cursor do not count as entry');
  f.api.nativePointer({inside:true,moved:true});f.advance(120);assert.equal(f.api.state,'compact','a real entry still previews normally');
});

test('DOM mouse movement outside collapses when Windows omitted the leave event', () => {
  const f=interactionFixture();f.api.state='open';
  f.api.pointerPosition({pointerType:'mouse',movementX:40,movementY:0,target:{inside:false}});
  f.advance(280);assert.equal(f.api.state,'rest');
});

test('deactivation releases a stale focused input without relying on cached pointer presence', () => {
  const f=interactionFixture();f.api.state='open';
  f.focus({id:'focus-task-input',inside:true,closest:selector=>selector==='input,textarea,select,[contenteditable="true"]'?{}:null});
  f.api.scheduleCollapse(true);f.advance(280);assert.equal(f.api.state,'rest');
});

test('losing document focus closes the panel even when a native deactivation event is missing', () => {
  const f=interactionFixture();f.api.state='open';
  f.documentFocus(false);f.api.focusDeparture();f.advance(280);assert.equal(f.api.state,'rest');
});

test('the web preview can enter again after document deactivation without a native cursor source', () => {
  const f=interactionFixture();f.api.state='open';
  f.documentFocus(false);f.api.focusDeparture();f.advance(280);assert.equal(f.api.state,'rest');
  f.documentFocus(true);f.api.enter({type:'pointerenter'});f.advance(120);
  assert.equal(f.api.state,'compact','browser-only pointer entry must not wait for a nonexistent native event');
});

test('ordinary opening returns to Nook even when LocalSend is ready or Tray was the previous view', () => {
  const f = interactionFixture(); f.api.view = 'tray'; f.transfer({stage: 'ready', direction: 'receive'});
  f.api.open(); assert.equal(f.api.view, 'nook'); assert.equal(f.api.state, 'open');
  f.api.open(); assert.equal(f.api.state, 'rest');
  f.api.view = 'focus'; f.transfer(null); f.api.open();
  assert.equal(f.api.view, 'nook'); assert.equal(f.api.state, 'open');
});

test('an actual LocalSend request or transfer retains its dedicated opening action', () => {
  const f = interactionFixture();
  for (const stage of ['consent', 'progress', 'complete', 'discovery']) {
    f.api.state = 'rest'; f.transfer({stage, direction: 'receive'}); f.api.open();
    assert.equal(f.api.view, 'localsend'); assert.equal(f.api.state, 'open');
  }
});

test('settings keep their short resize grace and then close if the pointer remains outside', () => {
  const f = interactionFixture(); f.api.state = 'open'; f.api.view = 'settings';
  f.api.pointerInteraction({target: {inside: true}}); f.api.protectLayoutResize(360, 280);
  f.api.nativePointer({inside: false, moved: false}); f.advance(649);
  assert.equal(f.api.state,'open');assert(f.api.pending);
  f.advance(1);assert.equal(f.api.state,'rest');assert.equal(f.api.pending,0);
  f.api.state='open';f.api.scheduleCollapse(true);f.advance(280);assert.equal(f.api.state,'rest','deactivation does not pin settings open');
});

test('Escape returns from Settings before collapsing; outside clicks and toggle close explicitly', () => {
  for (const close of ['escape', 'outside', 'toggle']) {
    const f = interactionFixture(); f.api.state = 'open'; f.api.view = 'settings';
    f.focus({closest:selector=>selector==='#notch-toggle,#notch-panel,#notch-menu,#island-footer'?{}:null});f.api.keyboardInteraction({key:'Tab'});
    f.api.leave(); f.flush(); assert.equal(f.api.state, 'open');
    if (close === 'escape') f.api.key({key: 'Escape', preventDefault() {}});
    else if (close === 'outside') f.api.outside({target: {inside: false}});
    else f.api.open();
    if (close === 'escape') {assert.equal(f.api.state,'open');assert.equal(f.api.view,'nook');f.api.key({key:'Escape',preventDefault(){}});}
    assert.equal(f.api.state, 'rest', close);
  }
});

test('settings close on departure and pointer reentry only previews without opening the route', () => {
  const f = interactionFixture(); f.api.state = 'open'; f.api.view = 'settings';
  f.api.nativePointer({inside: false,moved:true});
  f.advance(279); assert.equal(f.api.state, 'open'); f.advance(1); assert.equal(f.api.state, 'rest');
  f.api.view = 'settings'; f.api.nativePointer({inside: true}); f.advance(120); assert.equal(f.api.state, 'compact'); assert.equal(f.api.view,'settings','pointer entry does not activate another page');
  f.advance(10000);assert.equal(f.api.state,'compact','a preview never opens settings automatically');
  f.api.nativePointer({inside: false}); f.advance(280); assert.equal(f.api.state, 'rest');
});

test('a stale DOM entry cannot override a confirmed native cursor departure', () => {
  const f=interactionFixture();f.api.state='open';
  f.api.nativePointer({inside:false,moved:true});f.advance(100);
  f.api.enter({type:'pointerenter'});f.advance(180);
  assert.equal(f.api.state,'rest','a stale WebView boundary event cannot cancel the native exit');
  f.api.nativePointer({inside:true,moved:true});f.advance(120);assert.equal(f.api.state,'compact');
});

test('returning to the notch cancels collapse and dragging defers it until release', () => {
  const f = interactionFixture();
  f.api.leave(); f.api.enter(); f.flush();
  assert.equal(f.api.state, 'compact');
  f.api.dragging = true; f.api.leave(); f.flush();
  assert.equal(f.api.state, 'compact');
  f.api.dragging = false; f.api.focusDeparture(); f.flush();
  assert.equal(f.api.state, 'rest');
});

test('pointer hover previews details after a dwell and opens Nook only on explicit activation', () => {
  const f=interactionFixture(); f.api.state='rest'; f.api.view='tray';
  f.api.enter(); f.advance(119); assert.equal(f.api.state,'rest');
  f.api.leave(); f.advance(1000); assert.equal(f.api.state,'rest','a quick pass cancels the preview');
  f.api.enter(); f.advance(119); assert.equal(f.api.state,'rest');
  f.advance(1); assert.equal(f.api.state,'compact'); assert.equal(f.api.view,'tray');
  f.advance(10000); assert.equal(f.api.state,'compact','a long preview never opens the central panel');
  f.api.open(); assert.equal(f.api.state,'open'); assert.equal(f.api.view,'nook');
  f.api.leave(); f.advance(279); assert.equal(f.api.state,'open');
  f.advance(1); assert.equal(f.api.state,'rest');
  const changes=f.changes.length;
  f.api.disposed=true; f.api.enter(); f.advance(1000); assert.equal(f.changes.length,changes,'a disposed pointer entry cannot revive the island');
});

test('the real exit controller fades for 150 ms and cancels closing when the pointer reenters', () => {
  const source=require('node:fs').readFileSync(require.resolve('../notch.js'),'utf8');
  const setStart=source.indexOf('  function setState('), setEnd=source.indexOf('  function applyState(',setStart);
  const enterStart=source.indexOf('  function enter('), enterEnd=source.indexOf('  function leave(',enterStart);
  assert(setStart>0 && setEnd>setStart && enterStart>setEnd && enterEnd>enterStart);
  const timers=new Map(), movements=[], applied=[]; let nextTimer=0,now=0;
  const scope={ISLAND_CONFIG,movements,applied,calendar:null,document:{hidden:false},expandedLayer:{id:'expanded'},islandFooter:{inert:false},
    window:{clearTimeout:id=>timers.delete(id),setTimeout:(callback,delay)=>{timers.set(++nextTimer,{callback,at:now+delay});return nextTimer;}},
    animateIslandLayer:(node,entering)=>movements.push({id:node.id,entering}),renderIslandNavigation(){},update(){},dismissMusicTrackFeedback(){}};
  require('node:vm').runInNewContext(`let disposed=false,state='open',closingTo=null,contentExitTimer=0,hoverTimer=0,collapseTimer=0,collapseDeferred=false,pointerInside=false,keyboardNavigation=false,awaitingPointerEntry=false;
    const sizes={rest:{},compact:{},open:{}};
    function applyState(next){state=next;applied.push(next);return true;}
    ${source.slice(setStart,setEnd)}${source.slice(enterStart,enterEnd)}
    this.api={setState,enter,get state(){return state;},get closing(){return closingTo;}};`,scope);
  const advance=milliseconds=>{now+=milliseconds;for(const[id,timer]of[...timers])if(timer.at<=now){timers.delete(id);timer.callback();}};
  scope.api.setState('rest'); assert.equal(scope.api.state,'open'); assert.equal(scope.api.closing,'rest');
  assert.equal(scope.islandFooter.inert,true); assert.deepEqual(movements,[{id:'expanded',entering:false}]);
  advance(149); assert.equal(scope.api.state,'open','the shell waits for the outgoing content');
  scope.api.enter(); assert.equal(scope.api.closing,null); assert.deepEqual(movements.at(-1),{id:'expanded',entering:true});
  advance(1000); assert.equal(scope.api.state,'open'); assert.deepEqual(applied,[],'the cancelled exit cannot close the reopened island');
  scope.api.setState('rest'); advance(149); assert.equal(scope.api.state,'open');
  advance(1); assert.equal(scope.api.state,'rest'); assert.deepEqual(applied,['rest']); assert.equal(scope.api.closing,null);
  scope.api.setState('open');
  scope.calendar={isOpen:()=>true,isBusy:()=>true};
  const before=movements.length;
  assert.equal(scope.api.setState('rest'),false); assert.equal(scope.api.state,'open');
  assert.equal(movements.length,before,'saving does not start an exit that would leave the agenda logically open');
});

test('pointer reentry interrupts an already fading open panel', () => {
  const f=interactionFixture();f.api.state='open';f.api.closing='rest';
  f.api.enter();assert.equal(f.changes.at(-1),'open');
});

test('restoring mouse focus to the toggle never wakes a closed notch, keyboard focus still does', () => {
  const f = interactionFixture();
  f.api.state = 'rest'; f.api.toggleFocus();
  assert.equal(f.api.state, 'rest');
  f.api.keyboardInteraction({key: 'Tab'}); f.api.toggleFocus();
  assert.equal(f.api.state, 'compact');
  f.advance(10000); assert.equal(f.api.state,'compact','keyboard focus previews without activating');
  f.api.open(); assert.equal(f.api.state,'open','activating the focused toggle opens the panel');
});

test('applying discreet state cancels pending hover and cannot revive keyboard preview while restoring focus', () => {
  const source=require('node:fs').readFileSync(require.resolve('../notch.js'),'utf8');
  const applyStart=source.indexOf('  function applyState('),applyEnd=source.indexOf('  let layoutResizeClick',applyStart);
  const focusStart=source.indexOf('  function toggleFocus('),focusEnd=source.indexOf('  function surfaceClick(',focusStart);
  assert(applyStart>0&&applyEnd>applyStart&&focusStart>applyEnd&&focusEnd>focusStart);
  const timers=new Map(),changes=[],scope={changes};let nextTimer=0;
  for(const name of ['renderScenarios','renderMenuSelection','renderIslandNavigation','renderLiveActivities','update','musicLifecycle','renderFocus','nearbyLifecycle','filesLifecycle','weatherLifecycle','renderModuleFeedback','animateIslandLayer']) scope[name]=()=>{};
  Object.assign(scope,{calendar:null,window:{clearTimeout:id=>timers.delete(id),setTimeout:callback=>{timers.set(++nextTimer,callback);return nextTimer;}},
    document:{activeElement:{id:'focus-task-input'},body:{dataset:{}}},notch:{dataset:{}},panel:{setAttribute(){}},
    menu:{contains:()=>true},expandedLayer:{contains:()=>false},toggle:{setAttribute(){},focus(){scope.api.toggleFocus();}},
    compactContent:{},restContent:{},t:value=>value,isModuleEnabled:()=>false,getModuleEditorActive:()=>false,scenarioController:null});
  require('node:vm').runInNewContext(`
    let disposed=false,state='rest',welcomeReady=false,collapseTimer=0,collapseDeferred=true,
      keyboardNavigation=true,view='nook',layoutResizeClick=null,layoutResizeGraceUntil=0,awaitingPointerEntry=true,
      shelfLoaded=false,shelfBusy=false,fileDragging=false;
    const sizes={rest:{},compact:{},open:{}};
    function setState(next){changes.push(next);state=next;}
    let hoverTimer=window.setTimeout(()=>{if(state==='rest')setState('compact');},120);
    ${source.slice(applyStart,applyEnd)}${source.slice(focusStart,focusEnd)}
    this.api={applyState,toggleFocus,get state(){return state;},get keyboard(){return keyboardNavigation;},get awaiting(){return awaitingPointerEntry;}};
  `,scope);
  scope.api.applyState('rest');
  for(const callback of timers.values()) callback();
  assert.equal(scope.api.state,'rest');assert.equal(scope.api.keyboard,false);assert.equal(scope.api.awaiting,false);assert.deepEqual(changes,[]);
  assert.equal(timers.size,0,'the pending preview is cancelled before closed-state focus restoration');
});

test('real mouse movement outside ends the keyboard menu guard and permits discreet mode', () => {
  const f = interactionFixture();
  f.api.state = 'open';
  f.focus({closest: selector => selector === '#notch-toggle,#notch-panel,#notch-menu,#island-footer' ? {} : null});
  f.api.keyboardInteraction({key: 'Tab'}); f.api.leave(); f.flush();
  assert.equal(f.api.state, 'open');
  f.api.pointerPosition({pointerType: 'mouse', movementX: 8, movementY: 0, target: {inside: false}}); f.flush();
  assert.equal(f.api.state, 'rest');
});

test('native cursor exit collapses when Windows omits DOM leave and ignores duplicate samples', () => {
  const f = interactionFixture();
  f.api.nativePointer({inside:false}); const timer = f.api.pending;
  f.api.nativePointer({inside:false}); assert.equal(f.api.pending,timer);
  f.flush(); assert.equal(f.api.state,'rest');
  f.api.nativePointer({inside:true}); f.advance(119); assert.equal(f.api.state,'rest');
  f.advance(1); assert.equal(f.api.state,'compact');
  const changes=f.changes.length;
  for(const value of [null,true,{}, {inside:1}, {inside:'false'}, {inside:true}]) f.api.nativePointer(value);
  assert.equal(f.changes.length,changes);
  f.api.disposed=true;f.api.nativePointer({inside:false});f.flush();assert.equal(f.api.state,'compact');
});

test('a native outside acknowledgement releases an unguarded preview even if presence was already outside', () => {
  const f=interactionFixture();f.api.nativePointer({inside:false,moved:true});f.flush();
  assert.equal(f.api.state,'rest');
  f.api.state='compact';f.api.nativePointer({inside:false,moved:false});
  const timer=f.api.pending;assert(timer,'a state change outside still needs a collapse timer');
  f.advance(100);f.api.nativePointer({inside:false,moved:true});assert.equal(f.api.pending,timer,'continued movement must not postpone closure');
  f.advance(180);assert.equal(f.api.state,'rest');
});

test('native cursor exit respects keyboard focus and file dialogues until the interaction ends', () => {
  const f = interactionFixture();f.api.state='rest';
  f.api.keyboardInteraction({key:'Tab'});f.api.toggleFocus();
  f.focus({closest: selector => selector === '#notch-toggle,#notch-panel,#notch-menu,#island-footer' ? {} : null});
  f.api.nativePointer({inside:false});f.flush();assert.equal(f.api.state,'compact');
  f.api.pointerPosition({pointerType:'mouse',movementX:8,movementY:0,target:{inside:false}});f.flush();assert.equal(f.api.state,'rest');
  f.focus(null);f.api.nativePointer({inside:true});f.advance(120);assert.equal(f.api.state,'compact');f.api.open();f.api.dialog=true;
  f.api.nativePointer({inside:false});f.flush();assert.equal(f.api.state,'open');
  f.api.dialog=false;f.api.focusDeparture();f.flush();assert.equal(f.api.state,'rest');
});

test('only a confirmed native mouse movement releases the keyboard guard outside the WebView', () => {
  const f=interactionFixture();f.api.state='open';
  f.focus({closest: selector => selector === '#notch-toggle,#notch-panel,#notch-menu,#island-footer' ? {} : null});
  f.api.keyboardInteraction({key:'Tab'});
  f.api.nativePointer({inside:false,moved:false});f.flush();assert.equal(f.api.state,'open');
  f.api.nativePointer({inside:false,moved:'true'});f.flush();assert.equal(f.api.state,'open');
  f.api.nativePointer({inside:false,moved:true});const timer=f.api.pending;assert(timer);
  f.api.nativePointer({inside:false,moved:true});assert.equal(f.api.pending,timer);
  f.flush();assert.equal(f.api.state,'rest');
});

test('native cursor exit defers collapse during a drag and real entry cancels a pending collapse', () => {
  const f=interactionFixture();f.api.dragging=true;f.api.nativePointer({inside:false});f.flush();assert.equal(f.api.state,'compact');
  f.api.dragging=false;f.api.focusDeparture();assert(f.api.pending);
  f.api.nativePointer({inside:true});f.flush();assert.equal(f.api.state,'compact');
  f.api.nativePointer({inside:false});f.flush();assert.equal(f.api.state,'rest');
});

test('a shrinking route keeps its clicked point usable briefly without keeping old dimensions', () => {
  const f = interactionFixture(); f.api.state = 'open';
  f.api.pointerInteraction({target: {inside: true}}); f.api.protectLayoutResize(440, 240);
  f.api.nativePointer({inside: false, moved: false}); const timer = f.api.pending;
  f.advance(219); assert.equal(f.api.state, 'open');
  for (let index = 0; index < 4; index++) {
    f.api.nativePointer({inside: false, moved: false}); f.api.protectLayoutResize(440, 240);
    assert.equal(f.api.pending, timer, 'stationary native samples and repeated renders cannot extend the grace');
    f.advance(100);
  }
  f.advance(30); assert.equal(f.api.state, 'open');
  f.advance(1); assert.equal(f.api.state, 'rest', 'the grace expires 650 ms after the click');
});

test('only a recent real click and a smaller destination create navigation grace', () => {
  for (const mode of ['no-click', 'stale-click', 'moved-before-resize', 'expanded', 'invalid']) {
    const f = interactionFixture(); f.api.state = 'open';
    if (mode !== 'no-click') f.api.pointerInteraction({target: {inside: true}});
    if (mode === 'stale-click') f.advance(251);
    if (mode === 'moved-before-resize') f.api.pointerPosition({pointerType: 'mouse', movementX: 8, movementY: 0, target: {inside: true}});
    f.api.protectLayoutResize(mode === 'expanded' ? 800 : mode === 'invalid' ? NaN : 440, mode === 'expanded' ? 500 : 240);
    f.api.nativePointer({inside: false, moved: false}); f.advance(280);
    assert.equal(f.api.state, 'rest', mode + ' uses the ordinary collapse delay');
  }
});

test('movement toward a smaller route preserves its fixed grace, and reentry cancels collapse', () => {
  for (const movement of ['native', 'dom']) {
    const f = interactionFixture(); f.api.state = 'open';
    f.api.pointerInteraction({target: {inside: true}}); f.api.protectLayoutResize(334, 240);
    f.api.nativePointer({inside: false, moved: false}); const timer = f.api.pending;
    for (let index = 0; index < 4; index++) {
      f.advance(100);
      if (movement === 'native') f.api.nativePointer({inside: false, moved: true});
      else f.api.pointerPosition({pointerType: 'mouse', movementX: -8, movementY: 0, target: {inside: false}});
      f.api.protectLayoutResize(334, 240);
      assert.equal(f.api.pending, timer, movement + ' movement cannot shorten or prolong the existing grace');
    }
    f.advance(249); assert.equal(f.api.state, 'open'); f.advance(1); assert.equal(f.api.state, 'rest');
    f.api.nativePointer({inside: true, moved: true}); f.advance(120); assert.equal(f.api.state,'compact'); f.api.open(); f.api.nativePointer({inside: false, moved: true});
    f.advance(279); assert.equal(f.api.state, 'open'); f.advance(1); assert.equal(f.api.state, 'rest', 'later departures after explicit opening use the ordinary delay');
  }
  const entered = interactionFixture(); entered.api.state = 'open';
  entered.api.pointerInteraction({target: {inside: true}}); entered.api.protectLayoutResize(334, 240);
  entered.api.nativePointer({inside: false, moved: false}); entered.advance(100);
  entered.api.nativePointer({inside: true, moved: true}); assert.equal(entered.api.pending, 0);
  entered.advance(650); assert.equal(entered.api.state, 'open', 'reaching the resized content cancels automatic collapse');
  entered.api.nativePointer({inside: false, moved: true}); entered.advance(280); assert.equal(entered.api.state, 'rest');
});

test('expiring resize grace keeps keyboard navigation and file dialogues protected', () => {
  for (const protection of ['keyboard', 'dialog']) {
    const f = interactionFixture(); f.api.state = 'open';
    f.api.pointerInteraction({target: {inside: true}}); f.api.protectLayoutResize(334, 240);
    f.api.nativePointer({inside: false, moved: false});
    if (protection === 'dialog') f.api.dialog = true;
    else {
      f.focus({closest: selector => selector === '#notch-toggle,#notch-panel,#notch-menu,#island-footer' ? {} : null});
      f.api.keyboardInteraction({key: 'Tab'});
    }
    f.advance(650); assert.equal(f.api.state, 'open', protection + ' outlives the navigation grace');
    if (protection === 'dialog') {f.api.dialog = false; f.api.focusDeparture();}
    else {f.focus(null); f.api.focusDeparture();}
    f.advance(280); assert.equal(f.api.state, 'rest', protection + ' releases normally when finished');
  }
});

function spectrumFixture() {
  const source = require('node:fs').readFileSync(require.resolve('../notch.js'), 'utf8');
  const start = source.indexOf('  function musicSpectrumVisible('), end = source.indexOf('  function renderTime(', start);
  const subscribe = source.indexOf('  function syncStream('), subscribeEnd = source.indexOf('  async function commandMusic(', subscribe);
  const bar = () => ({style: {level: '0', setProperty(name, value) {assert.equal(name, '--level'); this.level = value;}}});
  const liveBars = Array.from({length: 5}, bar), playerBars = Array.from({length: 5}, bar), feedbackBars = Array.from({length: 5}, bar), restBars = Array.from({length: 3}, bar), sources = [];
  const railSpectrums=Array.from({length:2},()=>({dataset:{},children:Array.from({length:3},bar)}));
  const rail={querySelectorAll:selector=>{assert.equal(selector,'.activity-spectrum');return railSpectrums;}};
  class EventSource {
    constructor(url) {this.url=url;this.listeners={};this.closed=false;sources.push(this);}
    addEventListener(name, callback) {this.listeners[name]=callback;}
    close() {this.closed=true;}
  }
  const scope = {window: {EventSource}, document: {hidden: false}, spectrumLevels, liveBars, playerBars, feedbackBars, restBars,
    spectrumBars: [...liveBars, ...playerBars, ...feedbackBars, ...restBars], byId: id => id==='activity-rail'?rail:{hidden: true,querySelectorAll:()=>[]},
    isModuleEnabled: () => true, motionEnabled: () => true, builtinVisible: () => false,
    syncClock() {}, renderMusic() {}, setMusic() {}, update() {}};
  require('node:vm').runInNewContext(`let disposed=false,fileDragging=false,state='rest',view='music',homeLayout=null,music={playing:true},connectionLost=false,
    stream=null,retiringStream=null,streamSpectrum=false,musicError='';
    ${source.slice(start, end)}${source.slice(subscribe, subscribeEnd)}
    this.api={receiveSpectrum,syncStream,clearSpectrum,set state(value){state=value;},set playing(value){music.playing=value;}};`, scope);
  return {api: scope.api, liveBars, playerBars, restBars, railSpectrums, sources, scope};
}

test('real audio drives the discreet and hover spectra without a simulated loop or a second subscription', () => {
  const f = spectrumFixture(); f.api.syncStream();
  assert.equal(f.sources[0].url, '/api/music/events?spectrum=1');
  f.api.receiveSpectrum(Array(8).fill(.1));
  assert(f.liveBars.every(bar => bar.style.level === '0'));
  assert(f.playerBars.every(bar => bar.style.level === '0'));
  assert(f.restBars.every(bar => Number(bar.style.level) > 0),'the thin discreet spectrum follows the received audio');
  assert(f.railSpectrums.every(spectrum=>spectrum.dataset.signal===undefined),'a hidden rail does not claim a real audio signal');
  f.api.state = 'compact'; f.api.syncStream();
  assert.equal(f.sources.length,1,'discreet and hover share the same live audio stream');
  f.sources[0].listeners.open();
  f.sources[0].listeners.spectrum({data:JSON.stringify(Array(8).fill(.1))});
  assert(f.liveBars.every(bar => Number(bar.style.level) > 0));
  assert(f.playerBars.every(bar => bar.style.level === '0'));
  assert(f.railSpectrums.every(spectrum=>spectrum.dataset.signal==='true' && spectrum.children.every(bar=>Number(bar.style.level)>0)),'real native samples drive every visible rail spectrum');
  f.api.receiveSpectrum(Array(8).fill(0));
  assert(f.liveBars.every(bar => bar.style.level === '0'));
  assert(f.railSpectrums.every(spectrum=>spectrum.dataset.signal==='true' && spectrum.children.every(bar=>bar.style.level==='0')),'a captured silent passage stays silent rather than using the fallback loop');
  f.api.playing = false; f.api.receiveSpectrum(Array(8).fill(1));
  assert(f.liveBars.every(bar => bar.style.level === '0'));
  assert(f.railSpectrums.every(spectrum=>spectrum.children.every(bar=>bar.style.level==='0')),'paused music cannot consume new audio samples');
  f.api.clearSpectrum();assert(f.restBars.every(bar=>bar.style.level==='0'),'pause, disconnect or disabled motion also clears the discreet bars');
});

test('spectrum subscriptions switch without leaks and stop for hidden or motion-disabled content', () => {
  const f = spectrumFixture(); f.api.syncStream();
  f.sources[0].listeners.open();
  f.api.state = 'compact'; f.api.syncStream();
  assert.equal(f.sources.length,1,'opening the preview reuses its discreet audio stream');
  f.scope.builtinVisible = () => true; f.api.state = 'open'; f.api.syncStream();
  assert.equal(f.sources.length,1,'An open visible player keeps the current audio subscription');
  f.api.receiveSpectrum(Array(8).fill(.1));
  assert(f.playerBars.every(bar => Number(bar.style.level) > 0));
  assert(f.liveBars.every(bar => bar.style.level === '0'));
  f.scope.builtinVisible = () => false; f.api.clearSpectrum(); f.api.syncStream();
  assert.equal(f.sources[1].url, '/api/music/events?spectrum=0');
  f.sources[1].listeners.open(); assert.equal(f.sources[0].closed, true);
  f.api.receiveSpectrum(Array(8).fill(1));
  f.sources[0].listeners.spectrum({data:JSON.stringify(Array(8).fill(1))});
  assert(f.playerBars.every(bar => bar.style.level === '0'));
  f.api.state = 'compact'; f.api.syncStream();
  f.sources[2].listeners.open(); assert.equal(f.sources[1].closed, true);
  f.scope.motionEnabled = () => false; f.api.syncStream();
  assert.equal(f.sources[3].url, '/api/music/events?spectrum=0');
  f.sources[3].listeners.open(); assert.equal(f.sources[2].closed, true);
  f.scope.document.hidden = true; f.api.syncStream();
  assert.equal(f.sources[3].closed, true);
  assert(f.liveBars.every(bar => bar.style.level === '0'));
});

function liveBandFixture() {
  const source = require('node:fs').readFileSync(require.resolve('../notch.js'),'utf8');
  const body = (start,end) => source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
  const elements = new Map();
  const element = () => {const selectors=new Map();return {hidden:false,dataset:{},attributes:{},children:[],style:{values:{},setProperty(name,value){this.values[name]=value;},getPropertyValue(name){return this.values[name]||'';}},
    setAttribute(name,value){this.attributes[name]=value;},getAttribute(name){return this.attributes[name]??null;},removeAttribute(name){delete this.attributes[name];},querySelector(selector){if(!selectors.has(selector))selectors.set(selector,element());return selectors.get(selector);},querySelectorAll(){return[];},cloneNode(){return element();},replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);}};};
  const byId = id => {if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  const i18n = createI18n(null);
  const scope = {activitySnapshot,i18n,t:i18n.t,byId,notch:element(),document:{createElement:()=>element()},focusCardValues:()=>({completed:1,total:4}),contentAnimations:new Map(),
    animateIslandLayer(node,entering){node.inert=!entering;},
    isModuleEnabled:()=>true,motionEnabled:()=>true,text:(node,value)=>{node.textContent=value;},shelfGlyph:()=>element(),restContent:element(),toggle:element(),position:()=>30,focusLabel:()=>i18n.t('Concentration')};
  require('node:vm').runInNewContext(`
    let state='rest',fileDragging=false,connectionLost=false,music={available:true,playing:true,title:'Titre',artist:'Artiste'},
      focus={sessionActive:true,remaining:90,minutes:25,pomodoro:{phase:'work',finished:false}},focusSettings={},moduleFeedback=null,transfer=null,nearby={peers:[]},nearbyLoaded=true,fileJob={status:'idle'};
    const live=byId('music-live'),strip=byId('music-discreet-progress'),focusStrip=byId('focus-discreet-progress');
    function focusIsActive(){return focus.sessionActive;}
    function localSendBand(){return transfer;}
    function renderLocalSend(){renderLocalSendBand();}
    ${body('  function localSendCount(','  function localizedLocalSendFailure(')}
    ${body('  function localizedFeedback(','  function notifyModuleChange(')}
    ${body('  function renderModuleFeedback(','  function clearModuleFeedback(')}
    ${body('  function musicInBand(','  function homePrimary(')}
    ${body('  function renderLocalSendBand(','  function renderLocalSend(')}
    this.api={render:renderLiveActivities,set state(value){state=value;},set transfer(value){transfer=value;nearby.transfer=value?{...value,status:value.stage==='progress'?(value.direction==='receive'?'receiving':'sending'):value.stage}:null;},set feedback(value){moduleFeedback=value;},set dragging(value){fileDragging=value;},set playing(value){music.playing=value;},set musicAvailable(value){music.available=value;},set focusActive(value){focus.sessionActive=value;}};
  `,scope);
  return {api:scope.api,byId,i18n,scope};
}

test('compact music keeps a fixed cover and equalizer without duplicate focus progress', () => {
  const f=liveBandFixture();f.api.render();
  for(const state of ['rest','compact','open']) {
    f.api.state=state;f.api.render();
    assert.equal(f.byId('live-activities').hidden,false,'The content layer owns visibility while the shell moves');
    assert.equal(f.byId('music-live').hidden,false);
    assert.equal(f.byId('focus-live').hidden,true);
    for(const id of ['music-discreet-progress','focus-discreet-progress'])assert.equal(f.byId(id).hidden,state!=='rest',id);
  }
  f.api.state='rest';f.api.playing=false;f.api.render();
  assert.equal(f.byId('music-live').hidden,false,'Paused media retains the same compact geometry');
  assert.equal(f.byId('focus-discreet-progress').hidden,false);
});

test('the real collapsed rail shows one primary activity and up to two live secondary badges', () => {
  const f=liveBandFixture();f.api.state='compact';f.api.render();const rail=f.byId('activity-rail');
  assert.equal(rail.hidden,false);assert.equal(rail.children.length,2);assert.equal(rail.children[0].dataset.activity,'focus');
  assert.equal(rail.children[0].querySelector('.activity-value').textContent,'1:30');
  assert.equal(rail.children[1].dataset.activity,'music');
  const primary=rail.children[0];f.api.playing=false;f.api.render();
  assert.equal(rail.children[0],primary,'ticks and pause do not remount the row');assert.equal(rail.children[1].dataset.playing,'false');
  f.api.transfer={stage:'progress',direction:'receive',progress:37,alias:'Phone'};f.api.render();
  assert.equal(rail.children.length,3);assert.deepEqual(rail.children.map(node=>node.dataset.activity),['focus','music','transfer']);
  assert.equal(rail.children[2].style.values['--activity-progress'],'0.37');assert(rail.children[2].title.includes('37 %'));
  assert(f.scope.toggle.attributes['aria-label'].includes('1:30'),'the toggle exposes the same real activity values');
  f.api.state='rest';f.api.render();assert.equal(rail.hidden,true,'the title, cover and badges must disappear in the thin discreet mode');
  assert.equal(f.scope.notch.dataset.activityRail,'false','the hidden rich rail cannot suppress the thin spectrum layer');
  f.api.state='compact';f.api.feedback={id:'focus',kind:'complete',title:'Cycle terminé',detail:'Travail et pauses terminés',sequence:1};f.api.render();
  assert.equal(rail.hidden,true,'transient feedback does not overlap the rail');
  f.api.feedback=null;f.api.render();assert.equal(rail.hidden,false,'the normal preview returns after transient feedback');
  f.api.state='rest';f.api.transfer=null;f.api.focusActive=false;f.api.musicAvailable=false;f.api.render();
  assert.equal(rail.hidden,true);assert.equal(f.scope.notch.dataset.activityCount,'0');
});

test('the rail releases its sampled spectrum when preview ends or motion is disabled', () => {
  const f=liveBandFixture();f.api.state='compact';f.api.render();
  const spectrum={dataset:{signal:'true'}};
  f.byId('activity-rail').querySelectorAll=selector=>{assert.equal(selector,'.activity-spectrum');return[spectrum];};
  f.api.render();assert.equal(spectrum.dataset.signal,'true','ongoing hover retains its received native signal');
  f.scope.motionEnabled=()=>false;f.api.render();assert.equal(spectrum.dataset.signal,undefined,'motion settings take effect immediately');
  spectrum.dataset.signal='true';f.scope.motionEnabled=()=>true;f.api.state='rest';f.api.render();
  assert.equal(spectrum.dataset.signal,undefined,'collapsed mode cannot retain stale hover capture');
});

test('feedback never reveals a rich card in discreet mode and transfer progress stays thin', () => {
  const f=liveBandFixture();
  f.api.feedback={id:'music',kind:'track',title:'Titre',detail:'Artiste',sequence:1};f.api.render();
  assert.equal(f.byId('module-feedback-live').hidden,true);
  assert.equal(f.byId('module-feedback-spectrum').hidden,true);
  f.api.state='compact';f.api.render();
  assert.equal(f.byId('module-feedback-live').hidden,false);
  assert.equal(f.byId('live-activities').hidden,true,'Hover feedback temporarily owns the activity content');
  f.api.state='rest';f.api.transfer={stage:'progress',direction:'receive',progress:37};f.api.render();
  for(const id of ['live-activities','module-feedback-live','localsend-live','music-discreet-progress','focus-discreet-progress'])assert.equal(f.byId(id).hidden,true,id);
  assert.equal(f.byId('localsend-discreet-progress').hidden,false);
  assert.equal(f.byId('localsend-discreet-progress').attributes['aria-valuenow'],'37');
  assert.equal(f.byId('localsend-discreet-progress').style.values['--localsend-progress'],'0.37');
  f.api.transfer={stage:'complete',direction:'receive',count:2};f.api.render();
  assert.equal(f.byId('localsend-live').hidden,true);
  assert.equal(f.byId('localsend-discreet-progress').attributes['aria-valuenow'],'100');
  f.api.state='compact';f.api.render();
  assert.equal(f.byId('localsend-live').hidden,false);
  assert.equal(f.byId('localsend-discreet-progress').hidden,true);
  f.api.state='open';f.api.render();
  assert.equal(f.byId('localsend-live').hidden,true);
  assert.equal(f.byId('localsend-discreet-progress').hidden,true);
});

test('LocalSend discovery cannot hide the discreet music and Focus progress bars', () => {
  const f=liveBandFixture();f.api.state='rest';f.api.transfer={stage:'discovery',direction:'send'};f.api.render();
  assert.equal(f.byId('music-discreet-progress').hidden,false);
  assert.equal(f.byId('focus-discreet-progress').hidden,false);
  assert.equal(f.byId('localsend-discreet-progress').hidden,true,'discovery has no measured progress');
});

test('Focus completion feedback preserves French defaults and refreshes cycle text when the language changes', () => {
  const f=liveBandFixture(); f.api.state='compact';
  f.api.feedback={id:'focus',kind:'complete',title:'Cycle terminé',detail:'Travail et pauses terminés',sequence:1};
  f.api.render();
  const cycles=f.byId('module-feedback-cycles');
  assert.equal(f.i18n.locale(),'fr'); assert.equal(cycles.hidden,false);
  assert.equal(cycles.children.at(-1).textContent,'1 sur 4');
  assert.equal(f.byId('module-feedback-title').textContent,'Cycle terminé');
  f.i18n.setLocale('en'); f.api.render();
  assert.equal(cycles.children.at(-1).textContent,'1 of 4');
  assert.equal(f.byId('module-feedback-title').textContent,'Cycle complete');
  assert.equal(f.byId('module-feedback-live').hidden,false);
  f.api.state='rest'; f.api.render();
  assert.equal(f.byId('module-feedback-live').hidden,true);
});
