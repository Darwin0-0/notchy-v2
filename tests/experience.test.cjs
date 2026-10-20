'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {MODULE_IDS, normalizeModuleState, modulePreviewPlan, updateModuleState, healthReadiness, create} = require('../experience.js');

test('module inputs reject unknown IDs, deduplicate and restore every omitted known module to the full order', () => {
  const input = {enabled: ['__proto__', 'tasks', 'music', 'tasks', null, 'constructor'], order: ['weather', 'weather', 'invalid', 'tasks']};
  const before = structuredClone(input), result = normalizeModuleState(input);
  assert.deepEqual(result, {enabled: ['focus', 'music'], order: ['weather', 'focus', 'music', 'shelf']});
  assert.deepEqual(input, before);
  for (const value of [null, 4, 'music', {enabled: {}, order: {}}]) assert.deepEqual(normalizeModuleState(value), {enabled: [], order: [...MODULE_IDS]});
});

test('legacy tasks and focus become one enabled module in their first saved position, preserving community modules', () => {
  assert.deepEqual(MODULE_IDS, ['music', 'focus', 'weather', 'shelf']);
  const input = {enabled: ['tasks', 'focus', 'music', 'example.notes'], order: ['tasks', 'example.notes', 'music', 'focus', 'weather', 'shelf']};
  const before = structuredClone(input), ids = [...MODULE_IDS, 'example.notes'];
  const state = normalizeModuleState(input, ids);
  assert.deepEqual(state, {enabled: ['focus', 'example.notes', 'music'], order: ['focus', 'example.notes', 'music', 'weather', 'shelf']});
  assert.deepEqual(normalizeModuleState(state, ids), state);
  assert.deepEqual(normalizeModuleState({enabled: [], order: ['tasks', 'focus']}), {enabled: [], order: ['focus', 'music', 'weather', 'shelf']});
  assert.deepEqual(input, before);
});

test('the first three enabled modules fill one full, two halves, or a left half and right quarters', () => {
  const full = modulePreviewPlan({enabled: ['music']});
  assert.deepEqual(full.items, [{id: 'music', column: 1, row: 1, columnSpan: 2, rowSpan: 2}]);
  const pair = modulePreviewPlan({enabled: ['music', 'focus']});
  assert.deepEqual(pair.items.map(item => [item.column, item.row, item.columnSpan, item.rowSpan]), [[1,1,1,2],[2,1,1,2]]);
  const triple = modulePreviewPlan({enabled: [...MODULE_IDS], order: ['tasks', 'shelf', 'weather', 'music', 'focus']});
  assert.deepEqual(triple.visible, ['focus', 'shelf', 'weather']); assert.deepEqual(triple.reserve, ['music']);
  assert.deepEqual(triple.items.map(item => [item.column, item.row, item.columnSpan, item.rowSpan]), [[1,1,1,2],[2,1,1,1],[2,2,1,1]]);
  assert.equal(triple.items.reduce((area, item) => area + item.columnSpan * item.rowSpan, 0), 4);
  assert.deepEqual(modulePreviewPlan({enabled: []}).items, []);
});

test('toggle and reorder preserve the complete order, disabled modules and reserve without mutating caller arrays', () => {
  const initial = {enabled: ['music', 'weather', 'shelf'], order: [...MODULE_IDS]}, before = structuredClone(initial);
  const enabled = updateModuleState(initial, 'tasks', 'toggle');
  assert.deepEqual(enabled.enabled, [...MODULE_IDS]); assert.deepEqual(modulePreviewPlan(enabled).reserve, ['shelf']);
  const moved = updateModuleState(enabled, 'tasks', 'up');
  assert.deepEqual(modulePreviewPlan(moved).visible, ['focus', 'music', 'weather']);
  const disabled = updateModuleState(moved, 'focus', 'toggle');
  assert.deepEqual(disabled.order, moved.order); assert(!disabled.enabled.includes('focus'));
  assert.deepEqual(updateModuleState(initial, 'music', 'up'), initial);
  assert.deepEqual(updateModuleState(initial, 'shelf', 'down'), initial);
  assert.deepEqual(updateModuleState(initial, 'bad-id', 'toggle'), initial);
  assert.deepEqual(initial, before);
});

test('health readiness counts only verified ready checks and never treats empty or checking as success', () => {
  assert.deepEqual(healthReadiness([]), {ready: 0, total: 0, all: false, busy: false});
  assert.deepEqual(healthReadiness([{status:'ready'}, {status:'attention'}, {status:'unknown'}, {status:'busy'}]), {ready: 1, total: 4, all: false, busy: true});
  assert.deepEqual(healthReadiness([{status:'ready'}]), {ready: 1, total: 1, all: true, busy: false});
});

const {fixture} = require('./helpers/experience-dom.cjs');

test('health actions report actual caller actions, remain disabled while busy, and render untrusted detail as text', () => {
  const f = fixture(), actions = [], component = create({...f,onAction: (...args) => actions.push(args)});
  const item = {id:'fw',label:'Pare-feu',status:'attention',detail:'<img src=x onerror=alert(1)>',actionLabel:'Corriger',action:'firewall'};
  component.renderHealth({items:[item]});
  const action = f.all(f.healthHost,node => node.dataset.experienceCommand === 'health')[0];
  const detail = f.all(f.healthHost,node => node.textContent === item.detail)[0];
  assert.equal(detail.children.length, 0); f.click(f.healthHost,action); assert.equal(actions[0][0], 'firewall');
  action.focus(); component.renderHealth({items:[{...item,status:'busy'}]}); f.click(f.healthHost,action); assert.equal(actions.length,1);
  assert.equal(action.disabled,true); assert.equal(f.document.activeElement.dataset.experienceCommand,'back');
  component.renderHealth({items:[{...item,status:'ready'}]}); assert.equal(action.hidden,true); assert(f.healthHost.textContent.includes('Tout est prêt'));
  component.dispose(); f.click(f.healthHost,action); assert.equal(actions.length,1);
});

test('real grid controls retain the requested module, explicit positions and keyboard focus without interpreting labels as markup', () => {
  const f=fixture(),changes=[],actions=[],component=create({...f,onAction:action=>actions.push(action),onModulesChange:value=>changes.push(value)});
  const input={enabled:['music','weather'],order:[...MODULE_IDS],grid:[{id:'music',presentation:'small',column:0,row:0},{id:'weather',presentation:'small',column:2,row:2}],definitions:[{id:'music',label:'<b>Player</b>'}]};
  component.renderModules(input);const card=f.modulesHost.querySelector('.experience-grid-module');card.focus();
  f.event(f.modulesHost,'keydown',card,{key:'ArrowRight'});
  assert.deepEqual(changes[0].grid,[{id:'music',presentation:'small',column:1,row:0},{id:'weather',presentation:'small',column:2,row:2}]);
  assert.deepEqual(changes[0].order,[...MODULE_IDS]);assert.equal(f.document.activeElement.dataset.experienceModule,'music');
  const remove=f.all(f.modulesHost,node=>node.dataset.experienceCommand==='remove'&&node.dataset.experienceModule==='weather')[0];f.click(f.modulesHost,remove);
  assert.deepEqual(changes[1].enabled,['music']);assert.equal(changes[1].grid.length,1);
  const label=f.all(f.modulesHost,node=>node.tagName==='strong'&&node.textContent==='<b>Player</b>')[0];assert.equal(label.children.length,0);
  f.click(f.modulesHost,f.all(f.modulesHost,node=>node.dataset.experienceCommand==='done')[0]);assert.deepEqual(actions,['done']);
  assert.equal(input.grid[0].column,0,'the caller draft remains immutable');component.dispose();f.click(f.modulesHost,remove);assert.equal(changes.length,2);
});

test('unchanged health and grid snapshots preserve their mounted nodes and keyboard focus', () => {
  const f=fixture(),component=create(f),health={items:[{id:'network',label:'Réseau',status:'ready',detail:'Connected'}]},modules={enabled:['music','focus','weather'],order:[...MODULE_IDS]};
  component.renderHealth(health);component.renderModules(modules);
  const card=f.modulesHost.querySelector('.experience-grid-module'),healthCard=f.healthHost.querySelector('.experience-health-card');card.focus();
  component.renderHealth(health);component.renderModules(modules);
  assert.equal(f.modulesHost.querySelector('.experience-grid-module'),card);assert.equal(f.healthHost.querySelector('.experience-health-card'),healthCard);assert.equal(f.document.activeElement,card);
});
