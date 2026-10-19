'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ia = require('../ia.js');

test('General, Appearance, Notch and About remain local sections of the settings route', () => {
  assert.equal(ia.tabForRoute('settings'), 'general');
  for (const section of ['general', 'appearance', 'notch', 'about']) {
    assert.equal(ia.tabForRoute('settings', false, section), section);
  }
});

test('module editing selects Modules even when entered from a home or detail route', () => {
  for (const route of ['nook', 'music', 'focus', 'tasks', 'weather', 'tray', 'settings', 'scenarios', 'health']) {
    assert.equal(ia.tabForRoute(route, true, 'appearance'), 'modules', route);
  }
});

test('Scenarios and Health use their real routes instead of a stale local section', () => {
  for (const route of ['modules', 'scenarios', 'health']) {
    assert.equal(ia.tabForRoute(route, false, 'appearance'), route);
  }
});

test('leaving settings hides its tabs while preserving the requested section for a later return', () => {
  for (const route of ['nook', 'music', 'focus', 'tasks', 'weather', 'tray', 'search', 'module-library', 'localsend', 'files', 'welcome']) {
    assert.equal(ia.tabForRoute(route, false, 'appearance'), null, route);
  }
  assert.equal(ia.tabForRoute('settings', false, 'appearance'), 'appearance');
});

test('an invalid local section falls back to General without becoming a route', () => {
  for (const section of ['modules', 'scenarios', 'health', 'dock', 'overlays', '', null, undefined, {}, 'constructor', '__proto__']) {
    assert.equal(ia.tabForRoute('settings', false, section), 'general');
  }
  assert.equal(ia.tabForRoute('appearance'), null, 'a section name alone must not open settings');
});

function keyboardFixture(current) {
  const source = fs.readFileSync(require.resolve('../ia.js'), 'utf8');
  const start = source.indexOf('    function selectTab(');
  const end = source.indexOf('    async function scanNetwork(', start);
  assert(start > 0 && end > start, 'production settings keyboard handlers exist');
  const selected = [], focused = [], buttons = new Map(ia.TABS.map(id => [id, {focus: options => focused.push({id, options})}]));
  const scope = {TABS: ia.TABS, buttons, requested: current, onTab: id => selected.push(id)};
  vm.runInNewContext(source.slice(start, end) + '\nthis.handleKey=key;', scope);
  return {
    selected, focused,
    key(value, target = current) {
      let prevented = false;
      scope.handleKey({target: {dataset: {settingsTab: target}}, key: value, preventDefault() {prevented = true;}});
      return prevented;
    },
  };
}

test('vertical tab keys navigate once, focus the destination and keep scrolling stable', () => {
  const f = keyboardFixture('general');
  assert.equal(f.key('ArrowDown'), true);
  assert.deepEqual(f.selected, ['appearance']);
  assert.equal(f.focused[0].id, 'appearance');
  assert.equal(f.focused[0].options.preventScroll, true);
});

test('keyboard endpoints and wraparound reach all settings sections', () => {
  for (const [from, key, destination] of [
    ['general', 'ArrowUp', 'about'],
    ['about', 'ArrowDown', 'general'],
    ['appearance', 'Home', 'general'],
    ['notch', 'End', 'about'],
    ['modules', 'ArrowLeft', 'notch'],
    ['health', 'ArrowRight', 'about'],
  ]) {
    const f = keyboardFixture(from);
    assert.equal(f.key(key), true, key);
    assert.deepEqual(f.selected, [destination]);
    assert.equal(f.focused[0].id, destination);
  }
});

test('editing and unrelated keys are not intercepted by settings tab navigation', () => {
  const f = keyboardFixture('appearance');
  assert.equal(f.key('Tab'), false);
  assert.equal(f.key('Escape'), false);
  assert.equal(f.key('ArrowDown', null), false, 'an input without a tab identity keeps its own arrow keys');
  assert.deepEqual(f.selected, []);
  assert.deepEqual(f.focused, []);
});

test('Escape from the replayed introduction restores its open settings origin', () => {
  const source=fs.readFileSync(require.resolve('../notch.js'),'utf8');
  const finish=source.slice(source.indexOf('  function finishWelcome('),source.indexOf('  function replayWelcome('));
  const keyboard=source.slice(source.indexOf('  function key(event) {'),source.indexOf('  function selectView(event) {'));
  const calls=[];
  const scope={welcomeReturnState:'open',welcomeReturnView:'settings',calendar:null,queueOpen:false,
    desktop:null,view:'welcome',welcome:{isActive:()=>true,hide:()=>calls.push('hide')},getModuleEditorActive:()=>false,
    selectViewButton:button=>calls.push(button.dataset.view),setState:state=>calls.push(state)};
  vm.runInNewContext(finish+'\n'+keyboard+'\nthis.escape=key;',scope);
  let prevented=false;
  scope.escape({key:'Escape',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  assert.deepEqual(calls,['hide','settings','open']);
});
