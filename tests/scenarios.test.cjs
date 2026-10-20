const test = require('node:test');
const assert = require('node:assert/strict');
const {normalizeScenarios, scenarioModulePlan, createScenarioController, moduleEditorPresentation, getModuleDefinitions} = require('../notch.js');

test('the app bootstrap cannot run hidden automatic scenarios or replace the saved module layout', () => {
  const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require.resolve('../notch.js'),'utf8');
  const begin=source.indexOf('  let scenarioController = null, scenarioPreferences ='),end=source.indexOf('  const moduleLabels =',begin);
  const saved={mode:'auto',selected:'ambience',rules:{idle:{enabled:false,scenario:'minimal'}},guards:{undo:false},lastMorningDay:'2026-10-19'};
  for (const raw of [null,JSON.stringify(saved),'invalid JSON','x'.repeat(4097)]) {
    let reads=0;const scope={normalizeScenarios,scenarioStorageKey:'notchy-scenarios-v1',window:{localStorage:{getItem(key){reads++;assert.equal(key,'notchy-scenarios-v1');return raw;},setItem(){assert.fail('Bootstrap cannot overwrite existing preferences');}}}};
    vm.runInNewContext(source.slice(begin,end)+'this.preferences=scenarioPreferences;',scope);
    assert.equal(reads,1);assert.equal(scope.preferences.mode,'manual');assert.equal(scope.preferences.selected,null);
    if(raw===JSON.stringify(saved)){const expected=normalizeScenarios(saved);assert.deepEqual(JSON.parse(JSON.stringify(scope.preferences.rules)),expected.rules);assert.deepEqual(JSON.parse(JSON.stringify(scope.preferences.guards)),expected.guards);assert.equal(scope.preferences.lastMorningDay,saved.lastMorningDay);}
  }
});

function fixture(value, initial = {}) {
  let clock = new Date(2026, 9, 14, 8).getTime(), serial = 0, state = {focusActive: false, focusRunning: false, focusPhase: 'work', focusSession: 1, musicPlaying: false, transferActive: false, ...initial}, occupied = false;
  const timers = new Map(), saves = [], changes = [];
  const controller = createScenarioController({value, now: () => clock, activity: () => state, enabled: () => ['music', 'focus', 'weather', 'shelf'], interacting: () => occupied,
    schedule: (callback, delay) => {timers.set(++serial, {callback, at: clock + delay}); return serial;}, unschedule: id => timers.delete(id), save: value => saves.push(value), changed: value => changes.push(value)});
  return {controller, saves, changes, timers, activity: value => {state = {...state, ...value}; controller.observe();}, occupied: value => {occupied = value;},
    now: () => clock, advance: amount => {const end = clock + amount; while (true) {const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; clock = due[1].at; timers.delete(due[0]); due[1].callback();} clock = end;}};
}

test('scenario preferences restore only known plans, booleans and safe persistence values', () => {
  const defaults = normalizeScenarios();
  assert.deepEqual(defaults, {mode: 'auto', rules: {work: {enabled: true, scenario: 'focus'}, break: {enabled: true, scenario: 'ambience'}, morning: {enabled: true, scenario: 'day'}, idle: {enabled: true, scenario: 'ambience'}}, guards: {undo: true, manualLock: true, interacting: true}, selected: null, manualUntil: 0, lastMorningDay: null});
  for (const value of [null, [], 'manual', 5]) assert.deepEqual(normalizeScenarios(value), defaults);
  const changed = normalizeScenarios({mode: 'manual', rules: {work: {enabled: false, scenario: 'complete'}, idle: {enabled: false, scenario: 'unknown'}}, guards: {undo: false, manualLock: false}, selected: 'minimal', manualUntil: 42, lastMorningDay: '2026-10-14', secret: 'discard'});
  assert.equal(changed.rules.work.scenario, 'complete'); assert.equal(changed.rules.idle.scenario, 'ambience'); assert.equal(changed.guards.undo, false); assert.equal(changed.guards.interacting, true);
  assert.equal(changed.selected, 'minimal'); assert.equal(changed.manualUntil, 42); assert.equal(changed.lastMorningDay, '2026-10-14'); assert(!Object.hasOwn(changed, 'secret'));
  for (const timestamp of [-1, '100', 1.5, Infinity, Number.MAX_SAFE_INTEGER]) assert.equal(normalizeScenarios({manualUntil: timestamp}).manualUntil, 0);
  for (const day of ['2026-02-30', '2026-13-01', '2026-1-01', '<script>', 20261014]) assert.equal(normalizeScenarios({lastMorningDay: day}).lastMorningDay, null);
});

test('scenario plans only use existing enabled modules and Minimal keeps configured module order', () => {
  const enabled = ['music', 'focus', 'weather', 'shelf'], before = JSON.stringify(enabled);
  assert.deepEqual(scenarioModulePlan('focus', enabled), ['music', 'focus']); assert.deepEqual(scenarioModulePlan('ambience', enabled), ['music', 'weather']);
  assert.deepEqual(scenarioModulePlan('day', enabled), ['music', 'focus', 'weather']); assert.deepEqual(scenarioModulePlan('complete', enabled), enabled);
  assert.deepEqual(scenarioModulePlan('complete', ['focus', 'disabled', 'focus']), ['focus']); assert.deepEqual(scenarioModulePlan('focus', []), []);
  assert.deepEqual(scenarioModulePlan('__proto__', enabled), []);
  assert.deepEqual(scenarioModulePlan('minimal', enabled, {musicPlaying: true, focusActive: true}), ['music']);
  assert.deepEqual(scenarioModulePlan('minimal', ['shelf', 'music'], {focusActive: true}), ['shelf']); assert.deepEqual(scenarioModulePlan('minimal', ['weather']), ['weather']);
  assert.equal(JSON.stringify(enabled), before);
});


test('restored focus and repeated ticks never apply an automatic plan', () => {
  const f = fixture(undefined, {focusActive: true, focusRunning: true});
  assert.equal(f.controller.getPreferences().selected, null); assert.equal(f.timers.size, 0);
  f.activity({}); f.advance(100000); f.activity({});
  assert.equal(f.controller.getPreferences().selected, null); assert.equal(f.saves.length, 0); assert.equal(f.timers.size, 0);
});

test('real Focus start, resume and phase changes apply configured rules without changing activity', () => {
  const f = fixture();
  f.activity({focusActive: true, focusRunning: true}); assert.equal(f.controller.getPreferences().selected, 'focus');
  f.activity({focusPhase: 'break', focusSession: 1}); assert.equal(f.controller.getPreferences().selected, 'ambience');
  f.activity({focusRunning: false}); assert.equal(f.controller.getPreferences().selected, 'ambience');
  f.activity({focusPhase: 'work', focusRunning: true, focusSession: 2}); assert.equal(f.controller.getPreferences().selected, 'focus');
  const value = f.controller.getPreferences(); value.rules.work.scenario = 'day'; f.controller.configure(value);
  f.activity({focusRunning: false}); f.activity({focusRunning: true}); assert.equal(f.controller.getPreferences().selected, 'day');
  assert.equal(f.controller.inspect().idleScheduled, false);
});

test('manual selections keep their mode and suppress automatic changes for exactly two hours', () => {
  const f = fixture(); f.controller.pick('complete');
  assert.equal(f.controller.getPreferences().mode, 'auto'); assert.equal(f.controller.getPreferences().manualUntil, f.now() + 7200000);
  f.activity({focusActive: true, focusRunning: true}); assert.equal(f.controller.getPreferences().selected, 'complete');
  f.advance(7200000); f.activity({focusRunning: false}); f.activity({focusRunning: true}); assert.equal(f.controller.getPreferences().selected, 'focus');
  const g = fixture({mode: 'manual'}); g.controller.pick('minimal'); g.activity({focusActive: true, focusRunning: true}); g.advance(10000000);
  assert.equal(g.controller.getPreferences().selected, 'minimal'); assert.equal(g.timers.size, 0);
});

test('a pending automatic change waits for interaction to end and discards stale phases', () => {
  const f = fixture(); f.occupied(true); f.activity({focusActive: true, focusRunning: true});
  assert.equal(f.controller.getPreferences().selected, null); assert.deepEqual(f.controller.inspect().pending, {kind: 'work', scenario: 'focus'});
  assert.equal(f.controller.flush(), false); f.activity({focusPhase: 'break'}); assert.equal(f.controller.inspect().pending.kind, 'break');
  f.occupied(false); assert.equal(f.controller.flush(), true); assert.equal(f.controller.getPreferences().selected, 'ambience');
  const g = fixture(); g.occupied(true); g.activity({focusActive: true, focusRunning: true}); g.activity({focusActive: false, focusRunning: false});
  g.occupied(false); assert.equal(g.controller.flush(), false); assert.equal(g.controller.getPreferences().selected, null);
});

test('idle is debounced after activity ends and cancelled by Focus or a transfer', () => {
  const f = fixture(); f.activity({musicPlaying: true}); f.activity({musicPlaying: false}); f.advance(1499);
  assert.equal(f.controller.getPreferences().selected, null); f.activity({transferActive: true}); f.advance(10000); assert.equal(f.controller.getPreferences().selected, null);
  f.activity({transferActive: false}); f.advance(1500); assert.equal(f.controller.getPreferences().selected, 'ambience');
  const g = fixture(undefined, {focusActive: true, focusRunning: false}); g.activity({musicPlaying: true}); g.activity({musicPlaying: false}); g.advance(10000);
  assert.equal(g.controller.getPreferences().selected, null, 'paused active Focus keeps its place');
});

test('the morning opening uses the local day once, survives restoration and yields to Focus', () => {
  const f = fixture(); assert.equal(f.controller.morning(), true); assert.equal(f.controller.getPreferences().selected, 'day');
  const saved = f.controller.getPreferences(); assert.equal(saved.lastMorningDay, '2026-10-14'); assert.equal(f.controller.morning(), false);
  const restored = fixture(saved); assert.equal(restored.controller.morning(), false);
  f.advance(86400000); assert.equal(f.controller.morning(), true); assert.equal(f.controller.getPreferences().lastMorningDay, '2026-10-15');
  const busy = fixture(undefined, {focusActive: true}); assert.equal(busy.controller.morning(), false); assert.equal(busy.controller.getPreferences().lastMorningDay, null);
  const late = fixture(); late.advance(3 * 3600000); assert.equal(late.controller.morning(), false);
});

test('Undo restores the prior selected plan only during its five-second window', () => {
  const f = fixture(); f.activity({focusActive: true, focusRunning: true}); assert.equal(f.controller.inspect().undoAvailable, true);
  f.advance(4999); assert.equal(f.controller.undo(), true); assert.equal(f.controller.getPreferences().selected, null); assert.equal(f.controller.inspect().undoAvailable, false);
  assert.equal(f.controller.getPreferences().manualUntil, f.now() + 7200000);
  const expired = fixture(); expired.activity({focusActive: true, focusRunning: true}); expired.advance(5000);
  assert.equal(expired.controller.undo(), false); assert.equal(expired.controller.getPreferences().selected, 'focus'); assert.equal(expired.timers.size, 0);
});

test('guards remain independent and disposal cancels all scheduled work', () => {
  const f = fixture({guards: {undo: false, manualLock: false, interacting: false}}); f.occupied(true);
  f.controller.pick('complete'); assert.equal(f.controller.getPreferences().manualUntil, 0);
  f.activity({focusActive: true, focusRunning: true}); assert.equal(f.controller.getPreferences().selected, 'focus'); assert.equal(f.controller.inspect().undoAvailable, false);
  f.activity({focusActive: false, focusRunning: false}); assert.equal(f.controller.inspect().idleScheduled, true);
  f.controller.dispose(); assert.equal(f.timers.size, 0); f.advance(10000); assert.equal(f.controller.pick('day'), false);
});

test('Minimal stays on one configured module in manual mode and respects the interaction guard', () => {
  const f = fixture({mode: 'manual', selected: 'minimal'}), saves = f.saves.length;
  f.activity({musicPlaying: true}); assert.equal(f.changes.length, 0);
  f.activity({focusActive: true, focusRunning: true}); assert.equal(f.changes.length, 0);
  assert.equal(f.controller.getPreferences().selected, 'minimal'); assert.equal(f.saves.length, saves);
  const g = fixture({selected: 'minimal'}); g.occupied(true); g.activity({focusActive: true, focusRunning: true});
  assert.equal(g.controller.getPreferences().selected, 'minimal'); assert.equal(g.controller.inspect().pending.kind, 'work');
  assert.equal(scenarioModulePlan('minimal', ['music', 'focus'], {focusActive: true})[0], 'music');
});


test('disabled rules remain independent and cancelling idle removes its pending timer', () => {
  const f = fixture({rules: {work: {enabled: false}}});
  f.activity({focusActive: true, focusRunning: true}); assert.equal(f.controller.getPreferences().selected, null);
  f.activity({focusPhase: 'break'}); assert.equal(f.controller.getPreferences().selected, 'ambience');
  f.advance(5000); f.activity({focusActive: false, focusRunning: false}); assert.equal(f.controller.inspect().idleScheduled, true);
  const value = f.controller.getPreferences(); value.rules.idle.enabled = false; f.controller.configure(value);
  assert.equal(f.controller.inspect().idleScheduled, false); assert.equal(f.timers.size, 0);
});

test('the module editor resolves preset module IDs to saved slots and cancellation preserves both preferences', () => {
  const source = require('node:fs').readFileSync(require.resolve('../notch.js'), 'utf8');
  const begin = source.indexOf('  function openModuleEditor('), end = source.indexOf('  function moduleContextMenu(', begin);
  assert(begin > 0 && end > begin);
  for (const {id, visualSlot, slots, expectedSlot} of [
    {id: 'focus', visualSlot: '0', slots: ['music', 'focus', 'weather', null], expectedSlot: 1},
    {id: 'shelf', visualSlot: '3', slots: ['weather', 'music', null, 'focus'], expectedSlot: 2},
  ]) {
    const modules = {enabled: ['music', 'focus', 'weather', 'shelf'], slots}, before = JSON.stringify(modules);
    const scenario = fixture(); scenario.controller.pick(id === 'shelf' ? 'complete' : 'focus');
    const scenarioBefore = JSON.stringify(scenario.controller.getPreferences()), focused = [], writes = [], orderWrites = [];
    const returnFocus = {isConnected: true, tabIndex: 0, closest: () => null, focus() {}};
    const originalParent={isConnected:true,children:[]},panel={isConnected:true,children:[]},following={parentNode:originalParent};
    function insert(parent,node,before=null){
      if(node.parentNode){const previous=node.parentNode.children,index=previous.indexOf(node);if(index>=0)previous.splice(index,1);}
      const index=before?parent.children.indexOf(before):-1;parent.children.splice(index>=0?index:parent.children.length,0,node);node.parentNode=parent;
    }
    for(const parent of [originalParent,panel]){parent.append=node=>insert(parent,node);parent.insertBefore=(node,before)=>insert(parent,node,before);}
    const modulesPlayer={parentNode:originalParent,get nextSibling(){const siblings=this.parentNode.children;return siblings[siblings.indexOf(this)+1]||null;},querySelector:selector=>({focus:()=>focused.push(selector)}),contains:()=>false};
    originalParent.children.push(modulesPlayer,following);
    const context = {disposed: false, moduleLab: null, moduleEditing: false, view: 'nook', state: 'open', document: {activeElement: returnFocus}, modulePreviousView: '', modulePreviousState: '', moduleReturnFocus: null,
      moduleDraft: null, modulePicked: null, moduleMessage: '', moduleSelected: 0, moduleEditorMount:null, moduleOrderSaved:false, panel, window:{localStorage:{setItem:(key,value)=>orderWrites.push({key,value})}}, scenarioController: scenario.controller,
      moduleDefinitions: Object.fromEntries(getModuleDefinitions().map(item => [item.id, item])),
      moduleOrder:modules.enabled, moduleDraftOrder:null, configuredModuleOrder:()=>modules.slots.filter(Boolean), getModules: () => JSON.parse(before), moduleEditorLayout() {if (context.moduleEditing) context.visibleSlots = moduleEditorPresentation(context.moduleDraft, context.modulePicked).indices;}, setModules: value => writes.push(value), t: value => value,
      modulesPlayer, menu: {querySelector: () => ({focus() {}})}};
    require('node:vm').runInNewContext(`${source.slice(begin, end)}this.open = openModuleEditor; this.close = closeModuleEditor;`, context);
    assert.equal(context.open({target: {closest: () => ({dataset: {module: id, homeSlot: visualSlot}})}}), true);
    assert.equal(context.moduleSelected, expectedSlot); assert.equal(focused[0], '.experience-grid-module,.experience-grid-cell button');
    assert.equal(modulesPlayer.parentNode,panel,'the editor is mounted in the visible panel even when its original settings parent is hidden');
    assert.deepEqual(originalParent.children,[following]);
    assert(context.visibleSlots.includes(expectedSlot), 'the chosen insertion slot must be visible before it receives focus');
    assert.equal(context.close(false), true); assert.equal(context.moduleDraft, null); assert.equal(context.moduleEditing, false);
    assert.equal(writes.length, 0); assert.equal(JSON.stringify(modules), before); assert.equal(JSON.stringify(scenario.controller.getPreferences()), scenarioBefore);
    assert.equal(modulesPlayer.parentNode,originalParent,'Cancel restores the editor to its original route');assert.deepEqual(originalParent.children,[modulesPlayer,following]);assert.deepEqual(panel.children,[]);assert.equal(context.moduleEditorMount,null);assert.deepEqual(orderWrites,[]);
    assert.equal(context.open(),true);assert.equal(modulesPlayer.parentNode,panel);
    const committed=JSON.parse(JSON.stringify(context.moduleDraft));assert.equal(context.close(true),true);
    assert.equal(writes.length,1);assert.deepEqual(JSON.parse(JSON.stringify(writes[0])),committed);
    assert.equal(orderWrites.length,1);assert.equal(orderWrites[0].key,'notchy-module-order-v1');
    assert.equal(modulesPlayer.parentNode,originalParent,'Done also restores the route mount after committing the draft');assert.deepEqual(originalParent.children,[modulesPlayer,following]);assert.deepEqual(panel.children,[]);assert.equal(context.moduleEditorMount,null);
    assert.equal(JSON.stringify(modules),before,'fixture source preferences are never edited by reference');
  }
});

test('editor selection scrolls only an offscreen frame and honours disabled motion', () => {
  const source = require('node:fs').readFileSync(require.resolve('../notch.js'), 'utf8');
  const begin = source.indexOf('  function revealModuleSelection('), end = source.indexOf('  function moduleEditorLayout(', begin);
  assert(begin > 0 && end > begin);
  let bounds = {left: 430, right: 982}, motion = true;
  const scrolls = [], frame = {hidden: false, getBoundingClientRect: () => bounds, scrollIntoView: value => scrolls.push(value)};
  const context = {disposed: false, moduleEditing: true, moduleSelected: 1, modulesPlayer: {querySelector: () => frame},
    byId: () => ({getBoundingClientRect: () => ({left: 20, right: 850})}), motionEnabled: () => motion};
  require('node:vm').runInNewContext(`${source.slice(begin, end)}this.reveal = revealModuleSelection;`, context);
  context.reveal(); assert.equal(scrolls.length, 1); assert.equal(scrolls[0].behavior, 'smooth'); assert.equal(scrolls[0].inline, 'center');
  bounds = {left: 100, right: 652}; context.reveal(); assert.equal(scrolls.length, 1, 'a visible selection never starts recurrent scrolling');
  motion = false; bounds = {left: -10, right: 542}; context.reveal(); assert.equal(scrolls.length, 2); assert.equal(scrolls[1].behavior, 'instant');
  frame.hidden = true; context.reveal(); assert.equal(scrolls.length, 2);
  frame.hidden = false; context.moduleEditing = false; context.reveal(); assert.equal(scrolls.length, 2);
});
