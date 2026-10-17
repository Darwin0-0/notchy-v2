'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const {durationMinutes, focusPlan, focusConfiguration, FocusModel} = require('../focus.js');

test('hour/minute duration input accepts exact supported durations and rejects malformed or out-of-range input', () => {
  for (const [hours, minutes, total] of [['0','1',1],['0','25',25],['1','30',90],['2','59',179],['3','0',180],[0,59,59]]) assert.equal(durationMinutes(hours,minutes),total);
  for (const [hours, minutes] of [['0','0'],['3','1'],['4','0'],['1','60'],['','25'],['0',''],['-1','30'],['0','2.5'],[null,25],[{},25],[0,Infinity]]) assert.equal(durationMinutes(hours,minutes),null);
});

function inputFixture(running = false) {
  const source = fs.readFileSync(require.resolve('../focus.js'),'utf8'), start = source.indexOf('    function input(event)'), end = source.indexOf('    function confirmDuration()',start);
  const model = FocusModel.restore({minutes:25,remaining:900,sessionActive:true,deadline:running?910000:null,pomodoro:{work:25,rest:5,longRest:15,total:4,session:2,phase:'work'},tasks:[{id:'task',title:'Keep my task',estimatedCycles:4,completedCycles:2}],activeTaskId:'task'},10000);
  const controls = {hours:{value:'1',dataset:{focusDurationPart:'hours'},checkValidity:()=>true},minutes:{value:'30',dataset:{focusDurationPart:'minutes'},validation:'',setCustomValidity(value){this.validation=value;},checkValidity(){return !this.validation;}}};
  const scope = {disposed:false,active:()=>true,model,durationMinutes,focusConfiguration,configOpen:true,configurationDraft:{work:25,rest:5,longRest:15,total:4},configurationError:'',t:value=>value,
    $(id){return controls[id==='focus-duration-hours'?'hours':'minutes'];},editingSettings(){return scope.configurationDraft;},render(){scope.rendered=(scope.rendered||0)+1;},save(){throw new Error('An input draft must not save the running model');}};
  vm.runInNewContext(source.slice(start,end)+'this.input=input;',scope);
  return {scope,controls,model,before:JSON.stringify(model)};
}

test('editing valid hours and minutes changes only the paused settings draft, never its elapsed time or task credits', () => {
  const f=inputFixture();f.scope.input({target:f.controls.minutes});
  assert.equal(f.scope.configurationDraft.work,90);assert.equal(f.scope.configurationDraft.total,4);assert.equal(f.scope.rendered,1);
  assert.equal(JSON.stringify(f.model),f.before);
});

test('invalid combined duration leaves the draft unchanged and a corrected value clears the validity error', () => {
  const f=inputFixture();f.controls.hours.value='3';f.scope.input({target:f.controls.hours});
  assert.equal(f.scope.configurationDraft.work,25);assert.match(f.controls.minutes.validation,/180/);assert.equal(f.scope.rendered,undefined);
  f.controls.minutes.value='0';f.scope.input({target:f.controls.minutes});
  assert.equal(f.scope.configurationDraft.work,180);assert.equal(f.controls.minutes.validation,'');assert.equal(JSON.stringify(f.model),f.before);
});

test('hour/minute edits are ignored while a real session is running', () => {
  const f=inputFixture(true);f.scope.input({target:f.controls.hours});
  assert.equal(f.scope.configurationDraft.work,25);assert.equal(f.scope.rendered,undefined);assert.equal(JSON.stringify(f.model),f.before);
});

test('duration preview follows the real cycle order, totals and final long break without fabricated segments', () => {
  const plan=focusPlan({work:25,rest:5,longRest:15,total:4});
  assert.equal(plan.minutes,130);assert.equal(plan.cycles,4);assert.equal(plan.segments.length,8);
  assert.deepEqual(plan.segments.map(segment=>segment.kind),['work','short','work','short','work','short','work','long']);
  assert.deepEqual(plan.segments.map(segment=>segment.minutes),[25,5,25,5,25,5,25,15]);
  assert.deepEqual(focusPlan({work:1,rest:1,longRest:2,total:1}),{cycles:1,minutes:3,segments:[{kind:'work',minutes:1},{kind:'long',minutes:2}]});
});
