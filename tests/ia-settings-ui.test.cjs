'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const ia=require('../ia.js'),{fixture}=require('./helpers/experience-dom.cjs');
function settingsFixture(withLab=true){
  const f=fixture(),{document}=f;document.defaultView={};
  document.getElementById=id=>document.body.querySelector('#'+id);
  document.querySelector=selector=>selector==='meta[name="application-version"]'?{content:'0.3.9'}:document.body.querySelector(selector);
  const make=(id,tag='div',parent=document.body)=>{const node=document.createElement(tag);node.id=id;parent.append(node);return node;};
  const settings=make('settings-player','section'),menu=make('notch-menu','nav'),notch=make('notch'),nook=make('nook-layout');
  notch.dataset.state='open';
  for(const view of ia.PRIMARY){const control=document.createElement('button');control.dataset.view=view;menu.append(control);}
  const language=make('settings-language','select',settings),startup=make('startup-control','label',settings),startupInput=make('startup-windows','input',startup),startupStatus=make('startup-status','p',settings),replay=make('welcome-replay','button',settings),format=make('appearance-segment','div',settings),formatSelect=make('appearance-format','select',settings),radius=make('appearance-radius','input',settings),radiusValue=make('appearance-radius-value','output',settings),motion=make('appearance-motion','input',settings),essentials=make('essentials','section',settings),links=make('settings-links','div',settings);
  format.className='settings-format-segment';essentials.className='settings-essentials';links.className='settings-experience-links';
  const focus=make('settings-focus','button',essentials);focus.dataset.settingsCommand='focus';
  const scenariosButton=make('scenario-open','button',essentials);scenariosButton.dataset.settingsCommand='scenarios';
  const close=make('settings-close','button',settings);close.dataset.settingsCommand='close';
  for(const name of ['modules','scenarios','health'])make(name+'-player','section');
  const lab=withLab?make('fixture-lab','button',links):null;let launches=0;if(lab){lab.dataset.moduleLabOpen='';lab.addEventListener('click',()=>launches++);}
  language.value='en';startupInput.checked=true;motion.checked=false;radius.value='20';formatSelect.value='compact';formatSelect.hidden=true;startup.hidden=true;startupStatus.hidden=true;
  const galetCalls={created:[],active:[],motion:[],disposed:0};
  document.defaultView.NotchyGalet={create(node,options){galetCalls.created.push({node,options});return{setMotion:value=>galetCalls.motion.push(value),setActive:value=>galetCalls.active.push(value),dispose:()=>galetCalls.disposed++};}};
  const tabs=[],ui=ia.create({document,t:value=>value,onTab:id=>tabs.push(id),onRoute(){},motion:()=>false});
  const clickTab=id=>{const control=document.getElementById('ia-tab-'+id),tablist=control.parentElement;tablist.listeners.click({target:control});ui.render('settings',false);};
  ui.render('settings',false);
  return{...f,settings,menu,notch,nook,ui,lab,galetCalls,scenariosButton,launches:()=>launches,tabs,clickTab,controls:{language,startupInput,startupStatus,replay,format,formatSelect,radius,radiusValue,motion,focus,close}};
}

test('Module Lab is moved into About as the original working button instead of being detached with the old links',()=>{
  const f=settingsFixture();f.clickTab('about');const about=f.document.getElementById('ia-about');
  assert.equal(about.hidden,false);assert(about.contains(f.lab));assert.equal(f.lab.className,'ia-row');assert.equal(f.lab.dataset.moduleLabOpen,'');
  assert(f.lab.textContent.includes('Module Lab'));assert(f.lab.textContent.includes('Vérifier les modules avec leurs données réelles.'));
  f.lab.listeners.click({target:f.lab});assert.equal(f.launches(),1);
  assert.equal(f.settings.querySelector('.settings-experience-links'),null);f.ui.dispose();
});

test('the settings composition reuses every real preference control and preserves its saved value and input listener',()=>{
  const f=settingsFixture(),{controls}=f;let changes=0;controls.motion.addEventListener('change',()=>changes++);
  for(const tab of ['appearance','notch','general','about'])f.clickTab(tab);
  for(const [name,control]of Object.entries(controls))assert(f.settings.contains(control),name+' remains mounted in settings');
  assert.equal(controls.language.value,'en');assert.equal(controls.startupInput.checked,true);assert.equal(controls.motion.checked,false);assert.equal(controls.radius.value,'20');assert.equal(controls.formatSelect.value,'compact');assert.equal(controls.formatSelect.hidden,true);
  controls.motion.listeners.change({target:controls.motion});assert.equal(changes,1);assert.deepEqual(f.tabs,['appearance','notch','general','about']);f.ui.dispose();
});

test('About remains usable without an optional Lab trigger and tab routes keep exactly one visible panel',()=>{
  const f=settingsFixture(false);
  for(const tab of ['general','appearance','notch','about']){
    f.clickTab(tab);const active=f.settings.querySelectorAll('[role="tabpanel"]').filter(node=>!node.hidden);
    assert.equal(active.length,1);assert.equal(active[0].id,'ia-'+tab);assert.equal(f.settings.dataset.settingsTab,tab);
  }
  assert.equal(f.document.getElementById('ia-about').querySelector('[data-module-lab-open]'),null);f.ui.dispose();
});

test('settings refreshes leave the external grid editor visible and resume ownership when it returns',()=>{
  const f=settingsFixture(),panel=f.document.getElementById('modules-player'),parent=panel.parentElement;
  f.notch.append(panel);panel.hidden=false;
  f.ui.render('nook',false);f.ui.render('settings',false);
  assert.equal(panel.hidden,false,'settings cannot hide a panel owned by the editor');
  parent.append(panel);f.ui.render('settings',false);
  assert.equal(panel.hidden,true,'restored settings panel follows the active tab again');f.ui.dispose();
});


test('Scenarios controls leave settings while the internal scenario panel and existing state remain intact',()=>{
  const f=settingsFixture(),panel=f.document.getElementById('scenarios-player'),engine={mode:'manual',selected:'day'};panel.fixtureEngine=engine;
  assert.equal(f.document.getElementById('ia-tab-scenarios'),null);assert.equal(f.settings.querySelector('[data-settings-command="scenarios"]'),null);assert.equal(f.scenariosButton.isConnected,false);
  assert.equal(f.settings.contains(panel),false);f.clickTab('about');assert.equal(panel.fixtureEngine,engine);assert.equal(panel.isConnected,true);assert.equal(f.settings.querySelectorAll('[role="tab"]').length,6);f.ui.dispose();
});

test('About retains identity, version, tagline and both real tools while owning one Galet controller',()=>{
  const f=settingsFixture();f.clickTab('about');const about=f.document.getElementById('ia-about');
  assert(about.textContent.includes('Notchy'));assert(about.textContent.includes('VERSION 0.3.9'));assert(about.textContent.includes('Musique, focus et fichiers. Juste quand tu en as besoin.'));assert(about.querySelector('[data-settings-command="health"]'));assert(about.contains(f.lab));
  assert.equal(f.galetCalls.created.length,1);assert.equal(f.galetCalls.created[0].node,about.querySelector('.ia-about-logo'));assert.equal(f.galetCalls.created[0].options.scope,f.document);
  assert.equal(f.galetCalls.active.at(-1),true);f.clickTab('general');assert.equal(f.galetCalls.active.at(-1),false);f.clickTab('about');assert.equal(f.galetCalls.created.length,1);
  f.notch.dataset.state='compact';f.ui.render('settings',false);assert.equal(f.galetCalls.active.at(-1),false,'a hidden About panel does not keep a mascot loop alive');
  f.notch.dataset.state='open';f.ui.render('settings',false);assert.equal(f.galetCalls.active.at(-1),true);
  f.ui.dispose();f.ui.dispose();assert.equal(f.galetCalls.disposed,1);
});
