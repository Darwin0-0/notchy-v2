'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {modulePlacementPlan, normalizeModules, assignModuleSlot, createActivityScene, activitySnapshot} = require('../notch.js');

const ids = ['music', 'focus', 'weather', 'shelf'];

test('community placement requires an explicit valid slot and preserves all other home modules', () => {
  const source=fs.readFileSync(require.resolve('../notch.js'),'utf8'), begin=source.indexOf('  function placeCommunityModule('), end=source.indexOf('  function renderCommunityCard(',begin);
  const calls=[], scope={Number,assignModuleSlot,communityStore:{get:id=>id==='weather'?{}:null},moduleLibrary:{hide(){calls.push('hide');}},
    getModules:()=>({enabled:ids.filter(id=>id!=='weather'),slots:['music','focus','shelf']}),setModules(value){calls.push(value);},selectViewButton(){},openFromOutside(){}};
  vm.runInNewContext(source.slice(begin,end)+'this.place=placeCommunityModule;',scope);
  for(const slot of [undefined,null,-1,3,'0',.5])assert.throws(()=>scope.place('weather',slot));
  assert.throws(()=>scope.place('missing',0));assert.deepEqual(calls,[]);
  scope.place('weather',1);assert.equal(calls[0],'hide');assert.deepEqual(Array.from(calls[1].slots.slice(0,3)),['music','weather','shelf']);assert(calls[1].enabled.includes('focus'));assert(calls[1].enabled.includes('weather'));
});

test('each catalogue module receives its template and share from its actual placement', () => {
  for (const id of ids) {
    const enabled = ids;
    const others = ids.filter(value => value !== id);
    const single = modulePlacementPlan({enabled, slots: [id]});
    assert.deepEqual(single.items, [{id, slot: 0, index: 0, presentation: 'full', share: 100, heightShare: 1}]);
    const pair = modulePlacementPlan({enabled, slots: [id, others[0]]});
    assert.equal(pair.primary, id); assert.equal(pair.items[0].presentation, 'scene'); assert.equal(pair.items[0].share,65);
    assert.equal(pair.items[1].presentation, 'scene'); assert.equal(pair.items[1].share,35); assert.equal(pair.items[1].heightShare, 1);
    const triple = modulePlacementPlan({enabled, slots: [others[0], id, others[1]]});
    assert.deepEqual(triple.items.map(item => item.presentation), ['scene','rail','rail']);
    assert.deepEqual(triple.items.map(item => item.heightShare), [1,.5,.5]);
    assert.deepEqual(triple.items.map(item => item.share), [64,36,36]);
    assert.equal(triple.items.reduce((area,item) => area + item.share * item.heightShare,0),100);
  }
});

test('legacy Tasks and Focus merge into the active visible slot without moving other modules', () => {
  const cases = [
    [{enabled:['tasks','music'],slots:['focus','tasks','music']}, ['focus','music'], [null,'focus','music',null]],
    [{enabled:['focus','tasks','music'],slots:['tasks','music','focus']}, ['focus','music'], ['focus','music',null,null]],
    [{enabled:['focus','music'],slots:['tasks','music','focus']}, ['focus','music'], [null,'music','focus',null]],
    [{enabled:['music'],slots:['tasks','music','focus']}, ['music'], ['focus','music',null,null]],
    [{enabled:['tasks','music'],slots:[null,'tasks','music','focus']}, ['focus','music'], [null,'focus','music',null]],
  ];
  for (const [input, enabled, slots] of cases) {
    const before=structuredClone(input), result=normalizeModules(input);
    assert.deepEqual(result,{enabled,slots}); assert.deepEqual(input,before);
    assert.deepEqual(normalizeModules(result),result,'migration is idempotent');
    assert.equal(modulePlacementPlan(input).items.filter(item=>item.id==='focus').length,enabled.includes('focus')?1:0);
  }
  assert.deepEqual(assignModuleSlot({enabled:['focus','music'],slots:['focus','music']},1,'tasks').slots,['music','focus',null,null]);
});

test('three visible slots retain holes and the fourth saved module stays enabled in reserve', () => {
  const original = {enabled: [...ids], slots: ['weather', null, 'shelf', 'focus']}, before = JSON.stringify(original);
  const plan = modulePlacementPlan(original);
  assert.deepEqual(plan.slots, ['weather', null, 'shelf']); assert.deepEqual(plan.indices, [0, 2]);
  assert.equal(plan.primaryIndex, 0); assert.equal(plan.primary, 'weather');
  assert.deepEqual(normalizeModules(original), original); assert.equal(JSON.stringify(original), before);
  const replaced = assignModuleSlot(original, 0, 'focus');
  assert.deepEqual(replaced.slots, ['focus', null, 'shelf', 'weather']); assert.deepEqual(replaced.enabled, ids);
  assert.equal(modulePlacementPlan(replaced).primary, 'focus');
  assert.deepEqual(modulePlacementPlan({enabled: [], slots: ids}).items, []);
  const loneRail = modulePlacementPlan({enabled: ids, slots: [null, null, 'weather', 'shelf']});
  assert.equal(loneRail.primaryIndex, 2); assert.equal(loneRail.items[0].presentation, 'full');
});

test('configured Weather or Shelf stays primary when Focus starts, while promotion stays temporary', () => {
  for (const primary of ['weather', 'shelf']) {
    const scene = createActivityScene();
    const values = [primary, 'music', 'focus'].map(id => ({id, key: id, playing: false}));
    scene.update(values, {preserveOrder: true}); assert.equal(scene.inspect().primary, primary);
    scene.update(values.map(item => ({...item, playing: item.id === 'focus'})), {preserveOrder: true});
    assert.equal(scene.inspect().primary, primary);
    assert(scene.promote('focus')); assert.equal(scene.inspect().primary, 'focus');
    scene.update(values, {preserveOrder: true}); assert.equal(scene.inspect().primary, 'focus');
    scene.reset(); scene.update(values, {preserveOrder: true}); assert.equal(scene.inspect().primary, primary);
  }
});

test('configured idle modules never become invented live activities in the closed band', () => {
  assert.equal(modulePlacementPlan({enabled: ids, slots: ids}).count, 3);
  assert.deepEqual(activitySnapshot({music: {available: false}, focus: {minutes: 25}, weather: {temperature: 22}, shelf: {count: 3}}), []);
});

test('a temporary transfer uses one rail and returns to the surviving configured primary', () => {
  const scene = createActivityScene(), configured = ['weather', 'focus', 'shelf'].map(id => ({id, key: id}));
  const before = structuredClone(configured);
  scene.update(configured, {preserveOrder: true}); scene.promote('shelf');
  scene.update([configured[2], configured[1], {id: 'transfer', key: 'real-transfer'}], {preserveOrder: true});
  assert.deepEqual([scene.inspect().primary, ...scene.inspect().rail], ['shelf', 'focus', 'transfer']);
  scene.promote('transfer');
  scene.update(configured, {preserveOrder: true});
  assert.equal(scene.inspect().primary, 'focus');
  assert.equal(scene.inspect().items.length, 3); assert.deepEqual(configured, before);
});

test('applying placements from Tasks or Essentials returns to Nook and clears a promoted primary', () => {
  const source = fs.readFileSync(require.resolve('../notch.js'), 'utf8');
  const begin = source.indexOf('  function setModules('), end = source.indexOf('  function revealModuleSelection(', begin);
  for (const priorPage of ['tasks', 'essential']) {
    const saved = [], scene = createActivityScene(); scene.update([{id: 'music'}, {id: 'weather'}], {preserveOrder: true}); scene.promote('weather');
    const scope = {normalizeModules, activityScene: scene, t: value => value,
      window: {localStorage: {setItem: (key, value) => saved.push(JSON.parse(value))}}, renderModules() {}, modulesChanged() {},
      scenarioController: null, moduleStorageKey: 'test', Date};
    vm.runInNewContext(`let disposed=false,moduleSettings=${JSON.stringify({enabled: ids, slots: ids})},moduleDraft=null,moduleEditing=false,moduleMessage='',view='nook',islandPage=${JSON.stringify(priorPage)};
      function getModules(){return moduleSettings;}${source.slice(begin, end)}this.apply=setModules;this.inspect=()=>({view,islandPage,moduleSettings});`, scope);
    assert.equal(scope.apply({enabled: ids, slots: ['shelf', 'weather', 'music', 'focus']}), true);
    assert.equal(scope.inspect().view, 'nook'); assert.equal(scope.inspect().islandPage, 'music');
    assert.equal(scene.inspect().primary, null); assert.equal(saved.length, 1);
    assert.deepEqual(saved[0].slots, ['shelf', 'weather', 'music', 'focus']);
  }
});
