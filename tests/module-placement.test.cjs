'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {modulePlacementPlan, normalizeModules, assignModuleSlot, createActivityScene, activitySnapshot, getModuleDefinitions} = require('../notch.js');
const ModuleLayout=require('../module-contracts.js'),runtime=require('../module-runtime.js');

const ids = ['music', 'focus', 'weather', 'shelf'];

test('community placement requires an explicit valid slot and preserves all other home modules', () => {
  const source=fs.readFileSync(require.resolve('../notch.js'),'utf8'), begin=source.indexOf('  function placeCommunityModule('), end=source.indexOf('  function renderCommunityCard(',begin);
  const calls=[], scope={moduleSettings:{grid:null},Number,assignModuleSlot,normalizeModules,modulePlacementPlan,ModuleLayout,layoutContract:id=>ModuleLayout.getBuiltinContract(id),slotViewport:()=>({width:792,height:364}),t:value=>value,communityStore:{get:id=>id==='weather'?{}:null},moduleLibrary:{hide(){calls.push('hide');}},
    getModules:()=>({enabled:ids.filter(id=>id!=='weather'),slots:['music','focus','shelf']}),setModules(value){calls.push(value);},selectViewButton(){},openFromOutside(){}};
  const candidateStart=source.indexOf('  function modulePlacementCandidate('),candidateEnd=source.indexOf('  function applySlotRect(',candidateStart);
  vm.runInNewContext(source.slice(candidateStart,candidateEnd)+source.slice(begin,end)+'this.place=placeCommunityModule;',scope);
  for(const slot of [undefined,null,-1,3,'0',.5])assert.throws(()=>scope.place('weather',slot));
  assert.throws(()=>scope.place('missing',0));assert.deepEqual(calls,[]);
  scope.place('weather',1);assert.equal(calls[0],'hide');assert.deepEqual(Array.from(calls[1].slots.slice(0,3)),['music','weather','shelf']);assert(calls[1].enabled.includes('focus'));assert(calls[1].enabled.includes('weather'));
});

test('placing a community module from a custom grid opens a draft without overwriting occupied cells or committed settings',()=>{
  const source=fs.readFileSync(require.resolve('../notch.js'),'utf8'),begin=source.indexOf('  function placeCommunityModule('),end=source.indexOf('  async function changeBuiltinAvailability(',begin);
  const store=runtime.createStore();store.install(runtime.catalog[0]);
  const profile={enabled:['music','focus','weather'],slots:['music','focus','weather',null],grid:[{id:'music',presentation:'main',column:0,row:0},{id:'focus',presentation:'tall',column:2,row:0},{id:'weather',presentation:'small',column:2,row:2}]},before=structuredClone(profile),calls=[];
  const scope={Number,Set,moduleSettings:profile,moduleDraft:null,modulePicked:null,moduleMessage:'',communityStore:store,t:value=>value,moduleLibrary:{hide(){calls.push('hide');}},
    openModuleEditor(){calls.push('editor');scope.moduleDraft=structuredClone(profile);},renderModules(){calls.push('render');},
    modulePlacementCandidate(){assert.fail('a grid placement cannot be replaced through the old three-slot planner');},setModules(){assert.fail('opening a grid draft does not commit it');},selectViewButton(){assert.fail('the draft owns its navigation');},openFromOutside(){assert.fail('the editor opens its own host');}};
  vm.runInNewContext(source.slice(begin,end)+'this.place=placeCommunityModule;',scope);
  for(const destination of [undefined,null,-1,3,.5,'0'])assert.throws(()=>scope.place('community.reading',destination));
  assert.throws(()=>scope.place('community.missing',0));assert.deepEqual(calls,[]);
  scope.place('community.reading',0);assert.deepEqual(calls,['hide','editor','render']);
  assert.equal(scope.modulePicked,'community.reading');assert(scope.moduleDraft.enabled.includes('community.reading'));assert.deepEqual(scope.moduleDraft.grid,before.grid);assert.deepEqual(profile,before);
  scope.moduleDraft.grid[0].column=2;assert.deepEqual(profile,before,'a pending editor draft cannot mutate a committed placement');
  assert.equal(store.get('community.reading').state.completed,0,'placement does not reset or modify community values');
});

test('community placement simulation rejects unsupported formats and preserves another module that currently fits',()=>{
  const source=fs.readFileSync(require.resolve('../notch.js'),'utf8'),definitions=Object.fromEntries(getModuleDefinitions().map(definition=>[definition.id,definition]));
  const mainOnly=structuredClone(runtime.catalog[0]);mainOnly.id='community.main-only';mainOnly.layout={main:{min:{width:240,height:180},ideal:{width:356,height:260}}};
  const tall=structuredClone(runtime.catalog[1]);tall.id='community.tall';tall.layout={full:{min:{width:180,height:200},ideal:{width:440,height:260}},main:{min:{width:180,height:200},ideal:{width:360,height:260}},side:{min:{width:144,height:200},ideal:{width:260,height:368}},tall:{min:{width:144,height:200},ideal:{width:260,height:240}}};
  for(const manifest of [mainOnly,tall])definitions[manifest.id]={id:manifest.id,community:true,contract:runtime.getLayoutContract(runtime.validateManifest(manifest))};
  const width=ModuleLayout.surfaceLimits.richMinWidth-ModuleLayout.metrics.padding*2;
  const scope={moduleDefinitions:definitions,ModuleLayout,slotViewport:()=>({width,height:260}),layoutContract:id=>definitions[id]?.contract};
  const coreStart=source.indexOf('  function normalizeModules('),coreEnd=source.indexOf('  function moduleEditorPresentation(',coreStart),candidateStart=source.indexOf('  function modulePlacementCandidate('),candidateEnd=source.indexOf('  function applySlotRect(',candidateStart);
  vm.runInNewContext(source.slice(coreStart,coreEnd)+source.slice(candidateStart,candidateEnd)+'this.candidate=modulePlacementCandidate;',scope);
  const original={enabled:['music','focus','community.main-only'],slots:['music','focus',null,null]},before=JSON.stringify(original);
  const denied=scope.candidate(original,1,'community.main-only');assert.equal(denied.available,false);assert.equal(denied.reason,'unsupported-presentation');assert.equal(JSON.stringify(original),before);
  const accepted=scope.candidate(original,0,'community.main-only');assert.equal(accepted.available,true);assert.equal(accepted.value.slots[0],'community.main-only');assert(accepted.value.enabled.includes('music'));assert.equal(JSON.stringify(original),before);
  const withTall={enabled:['music','community.tall','focus'],slots:['music','community.tall',null,null]},tallBefore=JSON.stringify(withTall);
  assert.equal(ModuleLayout.planSlots([{id:'music'},{id:'community.tall'}],{width,height:260,getContract:scope.layoutContract}).items[1].fits,true);
  const breakingOther=scope.candidate(withTall,2,'focus');assert.equal(breakingOther.available,false);assert.equal(breakingOther.reason,'insufficient-space');assert.equal(JSON.stringify(withTall),tallBefore);
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

test('Module Lab placeholders enter a scene only through the current explicit allowlist',()=>{
  const scene=createActivityScene(),first='module-lab-empty-1',second='module-lab-empty-2';
  const values=[{id:'music',key:'music'},{id:first,key:first},{id:'unrelated-module',key:'unknown'},{id:second,key:second}],before=structuredClone(values);
  scene.update(values,{preserveOrder:true});assert.deepEqual(scene.inspect().items.map(item=>item.id),['music']);assert.equal(scene.promote(first),false);
  scene.update(values,{preserveOrder:true,allowedIds:[first,second]});assert.deepEqual(scene.inspect().items.map(item=>item.id),['music',first,second]);assert.equal(scene.inspect().items.some(item=>item.id==='unrelated-module'),false);
  assert.equal(scene.promote(first),true);assert.equal(scene.inspect().primary,first);
  scene.update(values,{preserveOrder:true});assert.deepEqual(scene.inspect().items.map(item=>item.id),['music']);assert.equal(scene.promote(first),false);assert.deepEqual(values,before);
  const ordinary=createActivityScene();ordinary.update(values,{preserveOrder:true});assert.deepEqual(ordinary.inspect().items.map(item=>item.id),['music']);
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
