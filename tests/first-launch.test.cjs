'use strict';
const {test} = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../notch.js'), 'utf8');
const key = 'notchy-minimal-welcome-v1';

function fixture(saved = new Map()) {
  const calls = [], controller = {active: false, show(mode) {this.active = true; calls.push(['show', mode]);}, hide() {this.active = false;}};
  let options;
  const context = {window: {localStorage: {getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value)}, NotchyWelcome: {create(value) {options = value; return controller;}}},
    getModuleEditorActive: () => false, closeModuleEditor: () => {}, clearModuleFeedback: () => {}, byId: () => ({}), motionEnabled: () => true, update: () => {}};
  const lifecycle = source.slice(source.indexOf('  let welcome = null;'), source.indexOf('  let moduleFeedback = null,'));
  const create = source.match(/^  welcome = window\.NotchyWelcome\.create\(.+$/m)[0];
  const firstLaunch = source.slice(source.indexOf('  let welcomeDone = false;'), source.lastIndexOf('})(typeof window'));
  vm.runInNewContext(`let disposed=false,view='nook',state='rest',welcomeStage='idle';
    const panel={scrollTop:100,scrollLeft:50};
    const selectViewButton=button=>{view=button.dataset.view;}; const setState=value=>{state=value;};
    ${lifecycle}
    ${create}
    ${firstLaunch}
    this.api={finishWelcome,showWelcome,replayWelcome,inspect:()=>({state,view,top:panel.scrollTop,left:panel.scrollLeft})};`, context);
  return {api: context.api, controller, saved, calls, options};
}

test('a new profile plays the welcome and only explicit completion persists it across launches', () => {
  const f = fixture();
  assert.equal(f.controller.active, true); assert.equal(f.api.inspect().view, 'welcome');
  assert.equal(f.api.inspect().top, 0); assert.equal(f.api.inspect().left, 0);
  f.api.finishWelcome('rest');
  assert.equal(f.saved.has(key), false, 'an outside click or Escape during the logo must not consume first launch');
  const retry = fixture(f.saved); assert.equal(retry.controller.active, true);
  retry.options.start(); assert.equal(f.saved.get(key), 'done');
  assert.equal(retry.api.inspect().state, 'rest'); assert.equal(retry.api.inspect().view, 'nook');
  const next = fixture(f.saved); assert.equal(next.controller.active, false); assert.equal(next.api.inspect().state, 'rest');
  next.api.replayWelcome(); assert.equal(next.controller.active, true, 'the settings preview is still replayable');
});

test('finishing the tutorial acknowledges the same welcome without changing other preferences', () => {
  const saved = new Map([['notchy-minimal-focus-v1', '{"deadline":12345}']]), f = fixture(saved);
  f.options.tutorialFinish();
  assert.equal(saved.get(key), 'done'); assert.equal(saved.get('notchy-minimal-focus-v1'), '{"deadline":12345}');
  assert.equal(f.controller.active, false);
});
