'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const {moduleEditorPresentation} = require('../notch.js');
const source = fs.readFileSync(require.resolve('../notch.js'), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test('editor preview roles follow the actual primary even when saved slots have holes or are empty', () => {
  for (const slots of [[null,null,'music'],[null,'music','focus'],['focus',null,'music'],[null,null,null]]) {
    const calls=[], frames=Array.from({length:3},(_,index)=>{
      const children=new Map(), classes=new Set();
      return {dataset:{moduleSlotBox:String(index)},classes,classList:{toggle(name,value){value?classes.add(name):classes.delete(name);}},setAttribute(){},
        querySelector(selector){if(!children.has(selector))children.set(selector,{dataset:{},replaceChildren(){},setAttribute(){}});return children.get(selector);}};
    });
    const nodes=new Map(), scope={experience:null,disposed:false,moduleEditing:true,moduleDraft:{enabled:['music','focus'],slots},modulePicked:null,moduleSelected:0,
      moduleEditorPresentation,moduleLabels:{music:'Music',focus:'Focus'},moduleMessage:'',document:{activeElement:null},t:value=>value,animateModuleChange(){},
      modulesPlayer:{querySelectorAll:selector=>selector==='[data-module-slot-box]'?frames:[]},
      byId(id){if(!nodes.has(id))nodes.set(id,{dataset:{},append(){}});return nodes.get(id);},
      modulePreview(host,id,template){calls.push({id,template,presentation:host.dataset.presentation});}};
    vm.runInNewContext(section('  function renderModules()', '  function placeModuleDraft(')+'this.run=renderModules;',scope); scope.run();
    const primary=Math.max(0,slots.findIndex(Boolean));
    assert.deepEqual(frames.filter(frame=>frame.classes.has('is-primary')).map(frame=>Number(frame.dataset.moduleSlotBox)),[primary]);
    for(let index=0;index<3;index++) {
      assert.equal(calls[index].template,index===primary?'main':'compact');
      assert.equal(calls[index].presentation,index===primary?'scene':'rail');
    }
  }
});

test('a music preview uses its projected presentation rather than a physical slot template', () => {
  const node=()=>({dataset:{},style:{},children:[],append(...children){this.children.push(...children);},replaceChildren(){this.children=[];}});
  const scope={document:{createElement:node},music:{available:true,playing:false,cover:'data:image/png;base64,YQ==',title:'Actual song',artist:'Actual artist',duration:180},
    player:{querySelector:()=>null},position:()=>45,time:value=>String(value),t:value=>value};
  vm.runInNewContext(section('  function modulePreview(', '  function renderModules()')+'this.run=modulePreview;',scope);
  for(const [presentation,expected,template] of [['scene','half','main'],['full','full','compact'],['rail','banner','main']]) {
    const host=node();host.dataset.presentation=presentation;scope.run(host,'music',template);
    assert.equal(host.dataset.musicSize,expected);assert.equal(host.dataset.template,template);
    const top=host.children[0],copy=top.children[1];
    assert.equal(copy.children[1].textContent,'Actual song');assert.equal(copy.children[2].textContent,'Actual artist');
    assert.equal(host.children[1].children[1].children[0].style.width,'25%');
  }
});
