'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {getModuleDefinitions,ISLAND_CONFIG}=require('../notch.js');
const source=fs.readFileSync(require.resolve('../notch.js'),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
function fixture({motion=true}={}){
 const timers=new Map(),nodes=new Map();let nextTimer=0,now=0,collapseChecks=0;
 const node=()=>({hidden:false,querySelector:()=>node(),getClientRects:()=>[]});
 const scope={disposed:false,document:{hidden:false},state:'rest',view:'localsend',pointerInside:false,fileDragging:false,nearbyLoaded:true,
  nearby:{transfer:{id:'receive-1',direction:'receive',status:'receiving',fileCount:3,totalBytes:30,progress:50}},
  localSendContext:{incomingId:'receive-1',direction:'receive',files:[{name:'one.png'},{name:'two.png'},{name:'three.png'}],totalBytes:30},
  moduleFeedback:null,moduleFeedbackTimer:0,moduleFeedbackSequence:0,moduleFeedbackAnimations:new Set(),moduleActivityStates:new Map(),
  moduleDefinitions:Object.fromEntries(getModuleDefinitions().map(value=>[value.id,value])),ISLAND_CONFIG,
  isModuleEnabled:()=>true,motionEnabled:()=>motion,t:value=>value,text:(target,value)=>target.textContent=value,
  localizedFeedback:value=>value,byId:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},
  window:{setTimeout(callback,delay){const id=++nextTimer;timers.set(id,{callback,at:now+delay});return id;},clearTimeout:id=>timers.delete(id)},
  protectedInteraction:()=>scope.state==='compact'&&scope.moduleFeedback?.restoreQuiet===true,musicAnnouncementBlocked:()=>false,dismissMusicTrackFeedback(){},
  setState:value=>scope.state=value,renderLiveActivities(){},renderModuleFeedback(){},update(){},animateModuleChange(){},getModuleEditorActive:()=>false,
  recheckCollapse(){collapseChecks++;},settleIslandLayers(){}};
 vm.runInNewContext(section('  function localSendPresentation()','  function localSendSize(')+section('  function localSendBand()','  function renderLocalSendBand(')+
  section('  function clearModuleFeedback(','  function localizedFeedback(')+section('  function notifyModuleChange(','  function observeModuleActivity(')+section('  function feedbackVisibility()','  function settleIslandLayers(')+'this.api={localSendBand,notifyModuleChange,feedbackVisibility};',scope);
 return {scope,api:scope.api,advance(ms){now+=ms;for(const [id,value] of [...timers])if(value.at<=now){timers.delete(id);value.callback();}},collapseChecks:()=>collapseChecks};
}
test('a completed LocalSend transfer cannot replace later music or unrelated Shelf feedback',()=>{
 const f=fixture();assert.equal(f.api.localSendBand().stage,'progress');
 f.scope.nearby.transfer.status='complete';
 f.api.notifyModuleChange({id:'shelf',kind:'received',transferId:'receive-1',title:'Fichiers reçus',detail:'Phone'});
 assert.equal(f.api.localSendBand().stage,'complete');assert.equal(f.scope.state,'compact');
 f.advance(ISLAND_CONFIG.notification.duration);assert.equal(f.api.localSendBand(),null);assert.equal(f.scope.state,'rest');
 for(const event of [{id:'music',kind:'track',title:'New song',detail:'Artist'},{id:'shelf',kind:'kept',title:'Saved',detail:''},
   {id:'shelf',kind:'received',transferId:'another-transfer',title:'Other received files',detail:''}]){
  f.api.notifyModuleChange(event);assert.equal(f.api.localSendBand(),null,'old completion must stay retired');
 }
 f.scope.nearby.transfer.status='receiving';assert.equal(f.api.localSendBand().stage,'progress','active transfer progress keeps its priority');
 assert.equal(f.scope.localSendContext.files.length,3,'the notification lifecycle never removes received files');
});
test('transfer completion expires with reduced motion and hiding feedback releases deferred collapse',()=>{
 const f=fixture({motion:false});f.scope.nearby.transfer.status='complete';
 f.api.notifyModuleChange({id:'shelf',kind:'received',transferId:'receive-1',title:'Fichiers reçus',detail:'Phone'});
 f.advance(ISLAND_CONFIG.notification.duration-1);assert.equal(f.api.localSendBand().stage,'complete');
 f.advance(1);assert.equal(f.scope.moduleFeedback,null);assert.equal(f.scope.state,'rest');
 f.api.notifyModuleChange({id:'shelf',kind:'received',transferId:'receive-1',title:'Fichiers reçus',detail:'Phone'});
 const before=f.collapseChecks();f.scope.document.hidden=true;f.api.feedbackVisibility();
 assert.equal(f.api.localSendBand(),null);assert.equal(f.scope.moduleFeedback,null);assert(f.collapseChecks()>before,'clearing the notification must release its collapse guard');
 f.scope.document.hidden=false;f.api.notifyModuleChange({id:'music',kind:'track',title:'Resumed song',detail:'Artist'});assert.equal(f.api.localSendBand(),null);
});
test('a track-change notification captures the new artwork rather than the previous DOM cover',()=>{
 const {normalizeMusic,moduleActivityChange,moduleActivitySnapshot}=require('../notch.js');
 let renderedCover='data:image/png;base64,b2xk',announcedCover='';
 const scope={disposed:false,normalizeMusic,moduleActivityChange,moduleActivitySnapshot,music:{available:true,title:'Old song',cover:renderedCover},state:'rest',
  motionEnabled:()=>false,document:{hidden:false},player:{hidden:true},window:{performance:{now:()=>0}},scenarioController:null,musicAt:0,musicError:'',connectionLost:false,seekDragging:false,seekPreview:null,seekTrack:null,
  observeModuleActivity(){announcedCover=renderedCover;},renderMusic(){renderedCover=scope.music.cover;},update(){},syncStream(){},getModuleEditorActive:()=>false,musicAnnouncementBlocked:()=>false};
 vm.runInNewContext(section('  function setMusic(','  function animateMusicPlayback(')+'this.run=setMusic;',scope);
 const nextCover='data:image/png;base64,bmV3';scope.run({available:true,title:'New song',cover:nextCover});
 assert.equal(announcedCover,nextCover,'feedback must receive the current image after rendering the new media snapshot');
});
