'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const tokens = require('../tokens.js');
const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'tokens.css'), 'utf8');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('the browser and Node receive the same immutable motion and activity contract', () => {
  const documentElement = {}, window = {document:{documentElement},getComputedStyle(node) {assert.equal(node,documentElement);return {getPropertyValue:name=>name==='--activity-focus'?' #6fe3c4 ':''};}};
  vm.runInNewContext(read('tokens.js'), {window});
  assert.deepEqual(JSON.parse(JSON.stringify(window.NOTCH_TOKENS)),JSON.parse(JSON.stringify(tokens)));
  assert.equal(window.NOTCH_TOKENS.css('--activity-focus'),'#6fe3c4');
  for(const invalid of ['color','--',null,'--x);color:red','--Activity']) assert.equal(window.NOTCH_TOKENS.css(invalid),'');
  for(const value of [tokens,tokens.activity,tokens.status,tokens.dur,tokens.ease,tokens.stagger,tokens.island,tokens.island.spring]) assert(Object.isFrozen(value));
});

test('an activity is never confused with a result and each CSS identity matches JavaScript', () => {
  for(const [name,color] of Object.entries(tokens.activity)) {
    if(name==='music') {assert(css.includes('--activity-music: var(--spectrum-color,'));continue;}
    assert.match(css,new RegExp(`--activity-${name}:\\s*${color};`,'i'));
    assert(!Object.values(tokens.status).includes(color),name+' must not reuse a status identity');
  }
  for(const [name,color] of Object.entries(tokens.status)) assert.match(css,new RegExp(`--status-${name}:\\s*${color};`,'i'));
  assert.notEqual(tokens.activity.focus,tokens.activity.break);
  assert.notEqual(tokens.activity.focus,tokens.activity.transfer);
  assert.notEqual(tokens.activity.break,tokens.activity.transfer);
});

test('the island consumes the shared physical spring and progress duration directly', () => {
  const {ISLAND_CONFIG} = require('../notch.js');
  assert.equal(ISLAND_CONFIG,tokens.island);
  assert.deepEqual([ISLAND_CONFIG.spring.stiffness,ISLAND_CONFIG.spring.damping,ISLAND_CONFIG.spring.mass],[400,30,1]);
  assert.equal(ISLAND_CONFIG.durations.progress,tokens.dur.progress);
  assert.equal(tokens.dur.progress,250);
  assert.deepEqual(ISLAND_CONFIG.states.expanded,{width:594,height:324,radius:14});
  assert.equal(tokens.css('--activity-focus'),'','Node does not invent a browser computed style');
});

test('all exact palette and geometry references resolve to the shared stylesheet', () => {
  const declared = new Set([...css.matchAll(/--([\w-]+)\s*:/g)].map(match=>match[1]));
  for(const file of fs.readdirSync(root).filter(name=>name.endsWith('.css')&&name!=='tokens.css')) {
    const source=read(file);
    for(const match of source.matchAll(/var\(--((?:measure|color|time)-[\w-]+)/g)) assert(declared.has(match[1]),`${file}: missing --${match[1]}`);
    assert(!/var\([^)]*\)-(?:out|in)\b/.test(source),`${file}: a converted ease keyword must remain valid CSS`);
  }
});

test('live CSS and script states share one vocabulary and no active design version flag', () => {
  for(const file of fs.readdirSync(root).filter(name=>/\.(?:css|js)$/.test(name)&&!name.startsWith('tokens.'))) {
    const source=read(file);
    assert(!/data-state="(?:discreet|hover)"/.test(source),file+' has an obsolete rendered state');
    assert(!/data-(?:focus|music)-design|dataset\.(?:focusDesign|musicDesign)/.test(source),file+' has an obsolete design flag');
  }
  const source=read('notch.css');
  for(const name of ['focus-strip > span','music-strip-fill','localsend-strip > span']) {
    const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    assert(new RegExp(escaped+'[^{}]*\\{[^}]*var\\(--dur-progress\\)').test(source),name+' retains a common progress transition');
  }
});
