const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const source = require('node:fs').readFileSync(require.resolve('../notch.js'), 'utf8');
const {getModuleDefinitions, homeModuleLayout, closedBandSize} = require('../notch.js');

function fixture() {
  const properties = {}, targets = [];
  const home = {dataset: {}, style: {setProperty() {}}};
  const context = {
    disposed: false, state: 'open', view: 'music', queueOpen: false,
    appearance: {format: 'balanced', radius: 18}, appearanceFormats: {
      compact: {width: 520, height: 180}, balanced: {width: 560, height: 196}, comfortable: {width: 620, height: 216},
    },
    window: {innerWidth: 1280, innerHeight: 800}, document: {hidden: false}, desktop: {}, desktopMaxHeight: 700,
    sizes: {open: {width: 560, band: 40, radius: 18, progress: 1}}, moduleFeedback: null,
    moduleDefinitions: Object.fromEntries(getModuleDefinitions().map(item => [item.id, item])),
    closedBandSize, homeModuleLayout, getModuleEditorActive: () => false, homeModuleContext: () => ({}),
    localSendPresentation: () => null, localSendBand: () => null, musicInBand: () => false,
    isModuleEnabled: () => true, focusIsActive: () => false, homePrimary: () => 'music', getHomeSlots: () => ['music'],
    settingsNaturalPanelHeight: () => context.settingsHeight, settingsHeight: 234,
    shelfSelectionItem: () => null, weatherVisible: () => false, homeLayout: null, homeCells: new Map(),
    byId: () => home, getComputedStyle: () => ({paddingLeft: '20px', paddingRight: '20px', paddingTop: '20px', paddingBottom: '20px'}),
    notch: {style: {setProperty(name, value) {properties[name] = value;}}},
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
  const settings = f.run(); assert(settings.width < music.width);
  assert.equal(settings.height, f.context.settingsHeight + settings.band);
  assert(settings.height < 320, 'the small settings form does not inherit a 440-pixel content area');
  f.context.view = 'nook';
  assert.equal(f.run().width, music.width, 'one home module does not inherit the queue width');
  f.context.getHomeSlots = () => ['music', 'focus', 'weather'];
  assert(f.run().width > music.width);
  f.context.getHomeSlots = () => ['music'];
  assert.equal(f.run().width, music.width, 'removing home modules also shrinks the panel');
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

test('settings measures only visible child content with its margins and outer padding', () => {
  const child = (height, margins, hidden = false) => ({hidden, margins, getBoundingClientRect: () => ({height})});
  const settingsPlayer = {children: [child(170, ['0', '18px']), child(32, ['0', '0']), child(500, ['0', '10px'], true)]};
  const context = {settingsPlayer, getComputedStyle: node => node === settingsPlayer ? {paddingTop: '10px', paddingBottom: '18px'} : {marginTop: node.margins[0], marginBottom: node.margins[1]}};
  const begin = source.indexOf('  function settingsNaturalPanelHeight() {'), end = source.indexOf('\n\n  function shelfGlyph', begin);
  assert(begin > 0 && end > begin);
  vm.runInNewContext(`${source.slice(begin, end)}this.measure = settingsNaturalPanelHeight;`, context);
  assert.equal(context.measure(), 248);
});

test('entering settings recalculates dimensions after its form becomes visible', () => {
  const calls = [], settingsPlayer = {hidden: true};
  const context = {settingsPlayer, view: 'settings', getModuleEditorActive: () => false,
    renderAppearance() {}, update() {calls.push(settingsPlayer.hidden);}};
  const begin = source.indexOf('  function renderSettings() {'), end = source.indexOf('  function settingsNaturalPanelHeight()', begin);
  vm.runInNewContext(`${source.slice(begin, end)}this.render = renderSettings;`, context);
  context.render(); assert.deepEqual(calls, [false]);
  context.view = 'music'; context.render();
  assert.equal(settingsPlayer.hidden, true); assert.deepEqual(calls, [false]);
});
