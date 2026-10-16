'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {MODULE_IDS, normalizeModuleState, modulePreviewPlan, updateModuleState, healthReadiness, create} = require('../experience.js');

test('module inputs reject unknown IDs, deduplicate and restore every omitted known module to the full order', () => {
  const input = {enabled: ['__proto__', 'tasks', 'music', 'tasks', null, 'constructor'], order: ['weather', 'weather', 'invalid', 'tasks']};
  const before = structuredClone(input), result = normalizeModuleState(input);
  assert.deepEqual(result, {enabled: ['tasks', 'music'], order: ['weather', 'tasks', 'music', 'focus', 'shelf']});
  assert.deepEqual(input, before);
  for (const value of [null, 4, 'music', {enabled: {}, order: {}}]) assert.deepEqual(normalizeModuleState(value), {enabled: [], order: [...MODULE_IDS]});
});

test('the first three enabled modules fill one full, two halves, or a left half and right quarters', () => {
  const full = modulePreviewPlan({enabled: ['music']});
  assert.deepEqual(full.items, [{id: 'music', column: 1, row: 1, columnSpan: 2, rowSpan: 2}]);
  const pair = modulePreviewPlan({enabled: ['music', 'focus']});
  assert.deepEqual(pair.items.map(item => [item.column, item.row, item.columnSpan, item.rowSpan]), [[1,1,1,2],[2,1,1,2]]);
  const triple = modulePreviewPlan({enabled: [...MODULE_IDS], order: ['tasks', 'shelf', 'weather', 'music', 'focus']});
  assert.deepEqual(triple.visible, ['tasks', 'shelf', 'weather']); assert.deepEqual(triple.reserve, ['music', 'focus']);
  assert.deepEqual(triple.items.map(item => [item.column, item.row, item.columnSpan, item.rowSpan]), [[1,1,1,2],[2,1,1,1],[2,2,1,1]]);
  assert.equal(triple.items.reduce((area, item) => area + item.columnSpan * item.rowSpan, 0), 4);
  assert.deepEqual(modulePreviewPlan({enabled: []}).items, []);
});

test('toggle and reorder preserve the complete order, disabled modules and reserve without mutating caller arrays', () => {
  const initial = {enabled: ['music', 'focus', 'weather', 'shelf'], order: [...MODULE_IDS]}, before = structuredClone(initial);
  const enabled = updateModuleState(initial, 'tasks', 'toggle');
  assert.deepEqual(enabled.enabled, [...MODULE_IDS]); assert.deepEqual(modulePreviewPlan(enabled).reserve, ['tasks', 'shelf']);
  const moved = updateModuleState(enabled, 'tasks', 'up');
  assert.deepEqual(modulePreviewPlan(moved).visible, ['music', 'focus', 'tasks']);
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

// Minimal DOM surface for exercising the real delegated controls without a browser dependency.
function fixture() {
  const document = {activeElement: null};
  class Element {
    constructor(tag) {this.tagName = tag; this.ownerDocument = document; this.children = []; this.dataset = {}; this.attributes = {}; this.style = {setProperty(key,value) {this[key] = value;}}; this.listeners = {}; this.className = ''; this._text = ''; this.classList = {add: value => {this.className += ' ' + value;}};}
    set textContent(value) {this._text = String(value); for (const child of this.children) child.parentElement = null; this.children = [];}
    get textContent() {return this._text + this.children.map(child => child.textContent).join('');}
    setAttribute(key,value) {this.attributes[key] = String(value);}
    removeAttribute(key) {delete this.attributes[key];}
    append(...nodes) {for (const node of nodes) {node.remove(); node.parentElement = this; this.children.push(node);}}
    insertBefore(node,before) {node.remove(); node.parentElement=this; const index=this.children.indexOf(before); this.children.splice(index<0?this.children.length:index,0,node);}
    prepend(...nodes) {for (const node of nodes.reverse()) {node.remove(); node.parentElement = this; this.children.unshift(node);}}
    replaceChildren(...nodes) {this.textContent = ''; this.append(...nodes);}
    remove() {if (this.parentElement) {const list = this.parentElement.children; list.splice(list.indexOf(this),1); this.parentElement = null;}}
    contains(node) {return this === node || this.children.some(child => child.contains(node));}
    closest() {return this.dataset.experienceCommand ? this : this.parentElement?.closest();}
    addEventListener(name, callback) {this.listeners[name] = callback;}
    removeEventListener(name, callback) {if (this.listeners[name] === callback) delete this.listeners[name];}
    focus() {if (!this.disabled) document.activeElement = this;}
    get isConnected() {return document.body.contains(this);}
    cloneNode(deep) {const clone = new Element(this.tagName); clone.className = this.className; clone.textContent = this._text; Object.assign(clone.attributes,this.attributes); if(deep) clone.append(...this.children.map(child => child.cloneNode(true))); return clone;}
  }
  document.createElement = tag => new Element(tag); document.createElementNS = (_,tag) => new Element(tag); document.body = new Element('body');
  const healthHost = new Element('section'), modulesHost = new Element('section'); document.body.append(healthHost, modulesHost);
  const all = (node, predicate) => [...(predicate(node) ? [node] : []), ...node.children.flatMap(child => all(child,predicate))];
  const click = (host,node) => host.listeners.click?.({target:node});
  return {document,healthHost,modulesHost,all,click};
}

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

test('real module controls emit normalized changes and retain usable keyboard focus at reorder boundaries', () => {
  const f = fixture(), changes = [], actions = [], component = create({...f,onAction: action => actions.push(action),onModulesChange: value => changes.push(value)});
  component.renderModules({enabled:['music','focus','weather','tasks'],order:[...MODULE_IDS],definitions:[{id:'music',label:'<b>Player</b>'}]});
  const control = (id,command) => f.all(f.modulesHost,node => node.dataset.experienceModule === id && node.dataset.experienceCommand === command)[0];
  const move = control('focus','up'); move.focus(); f.click(f.modulesHost,move);
  assert.deepEqual(changes[0].order,['focus','music','weather','tasks','shelf']); assert.equal(move.disabled,true);
  assert.equal(f.document.activeElement,control('focus','toggle'));
  f.click(f.modulesHost,control('music','toggle')); assert.deepEqual(changes[1].enabled,['focus','weather','tasks']);
  const label = f.all(f.modulesHost,node => node.tagName === 'strong' && node.textContent === '<b>Player</b>')[0]; assert.equal(label.children.length,0);
  assert(f.modulesHost.textContent.includes('3 modules visibles'));
  f.click(f.modulesHost,f.all(f.modulesHost,node => node.dataset.experienceCommand === 'back')[0]); assert.deepEqual(actions,['back']);
  component.dispose(); f.click(f.modulesHost,control('tasks','toggle')); assert.equal(changes.length,2);
});

test('unchanged health and module snapshots do not detach rows or replay their entry animation', () => {
  const f=fixture(), component=create(f), health={items:[{id:'network',label:'Réseau',status:'ready',detail:'Connected'}]}, modules={enabled:['music','focus','weather'],order:[...MODULE_IDS]};
  component.renderHealth(health); component.renderModules(modules);
  let moves=0;
  for(const host of [f.healthHost,f.modulesHost]) for(const list of f.all(host,node=>['experience-health-grid','experience-module-list'].includes(node.className))) {const insert=list.insertBefore.bind(list);list.insertBefore=(...args)=>{moves++;return insert(...args);};}
  const toggle=f.all(f.modulesHost,node=>node.dataset.experienceCommand==='toggle')[0]; toggle.focus();
  component.renderHealth(health); component.renderModules(modules);
  assert.equal(moves,0); assert.equal(f.document.activeElement,toggle);
});
