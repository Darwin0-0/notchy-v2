const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const source = require('node:fs').readFileSync(require.resolve('../notch.js'), 'utf8');
const {getModuleDefinitions, homeModuleLayout, closedBandSize, moduleEditorPresentation} = require('../notch.js');

function fixture() {
  const properties = {}, targets = [];
  const home = {dataset: {}, style: {setProperty() {}}};
  const context = {
    disposed: false, state: 'open', view: 'music', queueOpen: false, fileDragging: false, editorActive: false, focusConfig: false,
    appearance: {format: 'balanced', radius: 18}, appearanceFormats: {
      compact: {width: 520, height: 180}, balanced: {width: 560, height: 196}, comfortable: {width: 620, height: 216},
    },
    window: {innerWidth: 1280, innerHeight: 800}, document: {hidden: false}, desktop: {}, desktopMaxHeight: 700,
    sizes: {open: {width: 560, band: 40, radius: 18, progress: 1}}, moduleFeedback: null,
    moduleDefinitions: Object.fromEntries(getModuleDefinitions().map(item => [item.id, item])),
    closedBandSize, homeModuleLayout, moduleEditorPresentation,
    moduleDraft: {enabled: ['music', 'focus', 'weather', 'shelf'], slots: ['music', 'focus', 'weather', 'shelf']}, modulePicked: null,
    getModuleEditorActive: () => context.editorActive, homeModuleContext: () => ({focusConfig: context.focusConfig}),
    localSendPresentation: () => null, localSendBand: () => null, musicInBand: () => false,
    isModuleEnabled: () => true, focusIsActive: () => false, homePrimary: () => 'music', getHomeSlots: () => ['music'],
    settingsNaturalPanelHeight: () => context.settingsHeight, settingsHeight: 234,
    shelfSelectionItem: () => null, weatherVisible: () => false, homeLayout: null, homeCells: new Map(),
    byId: () => home, getComputedStyle: () => ({paddingLeft: '20px', paddingRight: '20px', paddingTop: '20px', paddingBottom: '20px'}),
    menu: {hidden: false, inert: false}, notch: {style: {setProperty(name, value) {properties[name] = value;}}},
    protectLayoutResize() {}, motionEnabled: () => false, motion: {setTarget(target) {targets.push(target);}},
    paint() {}, renderLocalSend() {}, recheckCollapse() {},
  };
  const begin = source.indexOf('  function update() {'), end = source.indexOf('  function setState(', begin);
  assert(begin > 0 && end > begin);
  vm.runInNewContext(`${source.slice(begin, end)}this.run = update;`, context);
  return {context, run() {context.run(); return targets.at(-1);}, properties};
}

test('closing the music queue and changing routes release the previous larger width', () => {
  const f = fixture(), music = f.run();
  f.context.queueOpen = true;
  const queue = f.run(); assert(queue.width > music.width);
  f.context.queueOpen = false;
  assert.equal(f.run().width, music.width);
  f.context.view = 'settings';
  const settings = f.run();
  assert.equal(settings.width, 600, 'the two settings cards receive their own useful width');
  assert(settings.width < queue.width, 'settings do not retain the expanded queue width');
  assert.equal(settings.height, f.context.settingsHeight + settings.band);
  assert(settings.height < 320, 'settings use measured form content rather than a fixed oversized content area');
  f.context.view = 'nook';
  assert.equal(f.run().width, music.width, 'one home module does not inherit the queue width');
  f.context.getHomeSlots = () => ['music', 'focus', 'weather'];
  assert(f.run().width > music.width);
  f.context.getHomeSlots = () => ['music'];
  assert.equal(f.run().width, music.width, 'removing home modules also shrinks the panel');
});

test('Focus keeps the compact reference stack at every width and releases configuration dimensions', () => {
  const f = fixture(); f.context.view = 'focus';
  const wide = f.run();
  assert.equal(wide.width, 572); assert.equal(wide.height, 362 + wide.band);
  f.context.window.innerWidth = 352;
  const stacked = f.run();
  assert.equal(stacked.width, 320); assert.equal(stacked.height, wide.height);
  f.context.window.innerWidth = 640;
  f.context.focusConfig = true;
  const configuration = f.run();
  assert.equal(configuration.width, 440); assert.equal(configuration.height, 244 + configuration.band);
  f.context.focusConfig = false; f.context.desktopMaxHeight = 320;
  assert.equal(f.run().height, 312, 'a small work area caps the natural stack height');
  f.context.window.innerWidth = 1280; f.context.desktopMaxHeight = 700;
  assert.equal(f.run().height, wide.height, 'returning to a wide screen restores the compact reference stack');
});

test('the module editor respects the screen and a file drop temporarily uses only its own surface', () => {
  const f = fixture(); f.context.editorActive = true;
  assert.equal(f.run().width, 880);
  f.context.window.innerWidth = 430;
  const editor = f.run(); assert.equal(editor.width, 398); assert(editor.height <= f.context.desktopMaxHeight - 8);
  f.context.fileDragging = true;
  const drop = f.run();
  assert.equal(drop.width, 360); assert.equal(drop.height, 160); assert.equal(drop.band, 0);
  assert.equal(f.context.menu.hidden, true); assert.equal(f.context.menu.inert, true);
  f.context.fileDragging = false; f.context.editorActive = false; f.context.window.innerWidth = 1280;
  const restored = f.run();
  assert.equal(restored.width, 440); assert.equal(f.context.menu.hidden, false); assert.equal(f.context.menu.inert, false);
});

test('welcome keeps its language selector inside one surface and releases its dimensions on exit', () => {
  const f = fixture(); f.context.queueOpen = true;
  const queue = f.run(); f.context.view = 'welcome';
  const welcome = f.run();
  assert.equal(welcome.width, 320); assert.equal(welcome.height, 246); assert.equal(welcome.band, 0);
  assert.equal(f.context.menu.hidden, true); assert.equal(f.context.menu.inert, true);
  f.context.view = 'settings';
  const settings = f.run();
  assert.equal(settings.width, 600); assert.equal(settings.height, f.context.settingsHeight + settings.band);
  assert.equal(f.context.menu.hidden, false); assert.equal(f.context.menu.inert, false);
  f.context.view = 'music';
  assert.equal(f.run().width, queue.width, 'an existing queue remains a route-specific preference');
  f.context.queueOpen = false;
  assert.equal(f.run().width, 440, 'leaving welcome never retains the wider previous route');
});

test('settings height follows its content and every panel remains within the screen bounds', () => {
  const f = fixture(); f.context.view = 'settings';
  const short = f.run(); f.context.settingsHeight += 50;
  assert.equal(f.run().height, short.height + 50);
  f.context.settingsHeight = 1200;
  assert.equal(f.run().height, f.context.desktopMaxHeight - 8);
  f.context.view = 'music'; f.context.queueOpen = true; f.context.window.innerWidth = 600;
  const narrow = f.run(); assert(narrow.width <= 600 - 80); assert(narrow.height >= 410);
  f.context.state = 'discreet';
  const closed = f.run(); assert.equal(closed.width, 260); assert.equal(closed.height, 10);
});

test('settings measures visible child content, margins and padding with either checkout line ending', () => {
  const child = (height, margins, hidden = false) => ({hidden, margins, getBoundingClientRect: () => ({height})});
  const settingsPlayer = {style: {width: '360px'}, children: [child(170, ['0', '18px']), child(32, ['0', '0']), child(500, ['0', '10px'], true)]};
  const context = {settingsPlayer, getComputedStyle: node => node === settingsPlayer ? {paddingTop: '10px', paddingBottom: '18px'} : {marginTop: node.margins[0], marginBottom: node.margins[1]}};
  for (const lineEnding of ['\n', '\r\n']) {
    const checkoutSource = source.replace(/\r?\n/g, lineEnding);
    const begin = checkoutSource.indexOf('  function settingsNaturalPanelHeight() {'), end = checkoutSource.indexOf('  function shelfGlyph', begin);
    assert(begin > 0 && end > begin);
    vm.runInNewContext(`${checkoutSource.slice(begin, end)}this.measure = settingsNaturalPanelHeight;`, context);
    assert.equal(context.measure(), 248);
  }
});

test('entering settings recalculates dimensions after its form becomes visible', () => {
  const calls = [], settingsPlayer = {hidden: true};
  const context = {settingsPlayer, view: 'settings', getModuleEditorActive: () => false,
    renderAppearance() {}, renderSettingsConnections() {}, update() {calls.push(settingsPlayer.hidden);}};
  const begin = source.indexOf('  function renderSettings() {'), end = source.indexOf('  function renderSettingsConnections()', begin);
  vm.runInNewContext(`${source.slice(begin, end)}this.render = renderSettings;`, context);
  context.render(); assert.deepEqual(calls, [false]);
  context.view = 'music'; context.render();
  assert.equal(settingsPlayer.hidden, true); assert.deepEqual(calls, [false]);
});
