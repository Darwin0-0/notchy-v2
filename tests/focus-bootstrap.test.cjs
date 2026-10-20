'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../focus.js'),'utf8');

test('Focus compatibility exports data helpers without mounting another UI or subscribing to readiness',()=>{
  for(const readyState of ['loading','complete']){
    const document={readyState,addEventListener(){throw Error('The model must not own startup');},getElementById(){throw Error('The model must not look for a host');}},window={document};
    vm.runInNewContext(source,{window});
    assert.deepEqual(Object.keys(window.NotchyFocus),['FocusModel','focusConfiguration','focusCardValues','STORAGE_KEY']);
    assert.equal(window.NotchyFocus.FocusModel.defaults().minutes,25);assert.equal(window.notchyFocusLab,undefined);
  }
});

test('the browser uses the Duration constructors with the same compatibility model',()=>{
  const window={document:{}};vm.runInNewContext(source,{window});
  const model=window.NotchyFocus.FocusModel;
  const adapter=fs.readFileSync(require.resolve('../focus-duration.js'),'utf8');vm.runInNewContext(adapter,{window});
  assert.equal(window.NotchyFocus.FocusModel,model);
  assert.equal(window.NotchyFocus.create,window.NotchyDurationIntegration.create);
  assert.equal(window.NotchyFocus.createTasks,window.NotchyDurationIntegration.createTasks);
  assert.equal(typeof window.NotchyFocus.create,'function');
});
