const test = require('node:test');
const assert = require('node:assert/strict');
const {homeModuleLayout, getModuleDefinitions} = require('../notch.js');

const ids = result => result.items.map(item => item.id);
function checkRequirements(result, width) {
  assert.ok(Number.isFinite(result.preferredWidth) && Number.isFinite(result.contentHeight));
  assert.equal(result.rowHeights.length, result.rows);
  for (const item of result.items) {
    assert.ok(item.width >= item.minWidth - 1e-8, item.id + ' keeps its readable minimum width');
    assert.ok(item.width <= item.maxWidth + 1e-8, item.id + ' stops growing after its useful maximum');
    assert.ok(item.height >= item.minHeight, item.id + ' keeps its own usable height');
    assert.ok(Number.isInteger(item.row) && item.row >= 0 && item.row < result.rows);
    assert.ok(Number.isInteger(item.column) && item.column >= 0);
  }
  for (let row = 0; row < result.rows; row++) {
    const items = result.items.filter(item => item.row === row);
    assert.deepEqual(items.map(item => item.column), items.map((_, index) => index));
    assert.equal(result.rowHeights[row], Math.max(...items.map(item => item.height)));
    const used = items.reduce((sum, item) => sum + item.width, 0) + Math.max(0, items.length - 1) * result.gap;
    assert.ok(used <= Math.max(width, result.minWidth) + 1e-8, 'each row fits the available width unless a single declared minimum cannot fit');
  }
  assert.equal(result.contentHeight, result.rowHeights.reduce((sum, height) => sum + height, 0) + Math.max(0, result.rows - 1) * result.gap);
}

test('modules receive space for their different uses instead of a rigid equal split', () => {
  const pair = homeModuleLayout(['music', 'focus'], 720);
  assert.equal(pair.mode, 'columns');
  assert.deepEqual(ids(pair), ['music', 'focus']);
  assert.ok(pair.items[1].width > pair.items[0].width, 'the combined Focus and task list receive more width than the compact player');
  assert.ok(pair.items[1].height > pair.items[0].height, 'Focus does not inherit the player height');
  checkRequirements(pair, 720);
  const reverse = homeModuleLayout(['focus', 'music'], 720);
  assert.deepEqual(ids(reverse), ['focus', 'music']);
  assert.equal(reverse.items.find(item => item.id === 'music').width, pair.items[0].width);
  assert.equal(reverse.items.find(item => item.id === 'focus').width, pair.items[1].width);
});

test('retired modules never regain layout cells through stale placements', () => {
  const saved=['music','notices','calendar','clipboard','files','calls','weather'];
  assert.deepEqual(ids(homeModuleLayout(saved,1000)),['music','weather']);
  for(const id of ['notices','calendar','clipboard','files','calls']) assert.deepEqual(homeModuleLayout([id],600).items,[]);
});

test('two modules fit at their combined minimum and stack immediately below it', () => {
  for (const modules of [['music', 'focus'], ['weather', 'focus'], ['shelf', 'music']]) {
    for (const gap of [0, 16, 32]) {
      const wide = homeModuleLayout(modules, 2000, gap);
      const minimum = wide.items.reduce((sum, item) => sum + item.minWidth, 0) + gap;
      const exact = homeModuleLayout(modules, minimum, gap);
      assert.equal(exact.mode, 'columns');
      checkRequirements(exact, minimum);
      const narrow = homeModuleLayout(modules, minimum - .01, gap);
      assert.equal(narrow.mode, 'stacked');
      assert.equal(narrow.rows, 2);
      assert.deepEqual(ids(narrow), modules);
      checkRequirements(narrow, minimum - .01);
    }
  }
});

test('three modules wrap without compressing controls and four never crowd one long row', () => {
  const triple = ['music', 'focus', 'weather'];
  const wide = homeModuleLayout(triple, 1000);
  assert.equal(wide.mode, 'columns');
  const wrapped = homeModuleLayout(triple, 650);
  assert.equal(wrapped.mode, 'wrapped');
  assert.equal(wrapped.rows, 2);
  assert.deepEqual(ids(wrapped), triple);
  checkRequirements(wrapped, 650);
  const four = homeModuleLayout(['shelf', 'music', 'focus', 'weather'], 2000);
  assert.equal(four.mode, 'wrapped');
  assert.equal(four.rows, 2);
  assert.deepEqual(four.items.map(item => item.row), [0, 0, 1, 1]);
  checkRequirements(four, 2000);
  const small = homeModuleLayout(['shelf', 'music', 'focus', 'weather'], 320);
  assert.equal(small.mode, 'stacked');
  assert.equal(small.rows, 4);
  checkRequirements(small, 320);
});

test('useful maximum widths prevent sparse oversized modules on very wide displays', () => {
  for (const modules of [['music'], ['focus'], ['focus', 'weather'], ['shelf', 'music'], ['music', 'focus', 'weather']]) {
    const result = homeModuleLayout(modules, 4000);
    assert.ok(result.items.every(item => item.width <= item.maxWidth));
    assert.ok(result.items.reduce((sum, item) => sum + item.width, 0) < 4000);
    checkRequirements(result, 4000);
  }
});

test('only deliberate configuration views change the affected module height', () => {
  const modules = ['music', 'weather', 'focus'];
  const normal = homeModuleLayout(modules, 1000);
  for (const [context, changed, height] of [
    [{weatherPicker: true}, 'weather', 248],
    [{focusConfig: true}, 'focus', 244],
  ]) {
    const expanded = homeModuleLayout(modules, 1000, 16, context);
    assert.equal(expanded.items.find(item => item.id === changed).height, height);
    for (const item of expanded.items.filter(item => item.id !== changed)) {
      assert.equal(item.height, normal.items.find(previous => previous.id === item.id).height);
    }
    assert.deepEqual(expanded.items.map(item => item.width), normal.items.map(item => item.width));
    checkRequirements(expanded, 1000);
  }
  const contentOnly = homeModuleLayout(modules, 1000, 16, {seconds: 7, title: 'A very long title', calendarMode: 'week', fileMode: 'actions'});
  assert.deepEqual(contentOnly, normal, 'clock ticks and text length are not layout inputs');
});

test('Focus keeps the reference stack compact rather than stretching on a wider screen', () => {
  for (const width of [320, 400, 528, 604, 720, 2000]) {
    const result = homeModuleLayout(['focus'], width);
    assert.equal(result.items[0].width, Math.min(width, 420)); assert.equal(result.items[0].height, 264);
    checkRequirements(result, width);
    const configuration = homeModuleLayout(['focus'], width, 16, {focusConfig: true});
    assert.equal(configuration.items[0].height, 244); assert.equal(configuration.items[0].width, Math.min(width, 420));
    checkRequirements(configuration, width);
  }
});

test('secondary Shelf stays in Tray while a primary Shelf keeps its own module and holes preserve order', () => {
  assert.deepEqual(ids(homeModuleLayout(['music', null, 'focus', 'shelf'], 900)), ['music', 'focus']);
  assert.deepEqual(ids(homeModuleLayout([null, 'shelf', 'weather', null], 900)), ['shelf', 'weather']);
  assert.deepEqual(ids(homeModuleLayout([null, 'focus', null, 'weather'], 900)), ['focus', 'weather']);
});

test('invalid and duplicate modules cannot add cells or mutate input or registry requirements', () => {
  const modules = ['unknown', 'shelf', 'shelf', null, 'music', 'focus', 'weather', 'calendar', 'files'];
  const before = structuredClone(modules);
  assert.deepEqual(ids(homeModuleLayout(modules, 2000)), ['shelf', 'music', 'focus', 'weather']);
  assert.deepEqual(modules, before);
  for (const invalid of [null, {}, 'music', undefined]) assert.deepEqual(homeModuleLayout(invalid, 600).items, []);
  const definitions = getModuleDefinitions();
  definitions.find(item => item.id === 'focus').layout.minWidth = 1;
  assert.ok(homeModuleLayout(['music', 'focus'], 900).items.find(item => item.id === 'focus').minWidth > 1);
});

test('invalid widths, gaps and contexts stay finite and preserve declared minimums', () => {
  for (const width of [NaN, Infinity, -1, 0, undefined]) {
    for (const context of [null, [], 'wide', false, {calendarHeight: Infinity, filesHeight: -100}]) {
      const result = homeModuleLayout(['music', 'weather', 'focus'], width, NaN, context);
      assert.equal(result.mode, 'stacked');
      assert.equal(result.gap, 16);
      checkRequirements(result, 0);
      assert.ok(result.items.every(item => Number.isFinite(item.minWidth) && item.minWidth > 0 && Number.isFinite(item.minHeight) && item.minHeight > 0));
    }
  }
  assert.equal(homeModuleLayout(['music', 'focus'], 1000, -1).gap, 0);
  assert.equal(homeModuleLayout(['music', 'focus'], 1000, 1000).gap, 32);
});
