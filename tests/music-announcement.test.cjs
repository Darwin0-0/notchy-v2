'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../notch.js'),source=fs.readFileSync(require.resolve('../notch.js'),'utf8');
function section(start,end){const first=source.indexOf(start),last=source.indexOf(end,first);assert(first>=0&&last>first);return source.slice(first,last);}
function fixture() {
  const nodes=new Map(),animations=[],timers=new Map();let timer=0;
  const node=()=>({hidden:false,textContent:'',querySelector:()=>node(),querySelectorAll:()=>[],cloneNode:()=>node(),getClientRects:()=>[{}]});
  const scope={...core,disposed:false,state:'open',view:'nook',pointerInside:true,commandBusy:false,queueBusy:false,queueOpen:false,queueState:{},queueOperation:'',
    awaitingPointerEntry:false,keyboardNavigation:false,moduleLibrary:null,calendar:null,welcome:null,fileDialogOpen:false,fileDragging:false,seekDragging:false,search:null,
    localSendContext:null,nearby:{},document:{hidden:false,hasFocus:()=>true,activeElement:null},
    moduleFeedback:null,moduleFeedbackTimer:0,moduleFeedbackStageTimer:0,moduleFeedbackSequence:0,moduleFeedbackAnimations:new Set(),moduleActivityStates:new Map(),
    moduleDefinitions:Object.fromEntries(core.getModuleDefinitions().map(item=>[item.id,item])),isModuleEnabled:()=>true,
    t:value=>value,text:(target,value)=>target.textContent=value,localizedFeedback:value=>value,
    byId:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},
    window:{setTimeout(callback){timers.set(++timer,callback);return timer;},clearTimeout:id=>timers.delete(id),performance:{now:()=>10}},
    motionEnabled:()=>true,player:{hidden:false,querySelector:()=>node()},music:core.normalizeMusic({available:true,title:'Before',artist:'Artist',source:'Spotify',playing:true}),
    musicAt:0,musicError:'',connectionLost:false,seekPreview:null,seekTrack:null,scenarioController:null,
    setState(value){scope.state=value;},getModuleEditorActive:()=>false,
    renderMusic(){scope.renderedTitle=scope.music.title;},renderLiveActivities(){},renderModuleFeedback(){},renderModules(){},update(){},syncStream(){},recheckCollapse(){},
    animateModuleChange:target=>animations.push({kind:'feedback',target}),animateMusicTrack:()=>animations.push({kind:'track'}),animateMusicPlayback(){},
  };
  scope.moduleActivityStates.set('music',core.moduleActivitySnapshot('music',scope.music));
  vm.runInNewContext(section('  function clearModuleFeedback(','  function localizedFeedback(')+
    section('  function musicAnnouncementBlocked(','  function feedbackVisibility()')+
    section('  function protectedInteraction(','  function scheduleCollapse(')+
    section('  function setMusic(','  function animateMusicPlayback(')+
    'this.api={setMusic,notifyModuleChange,dismissMusicTrackFeedback,musicAnnouncementBlocked,protectedInteraction};',scope);
  const song=title=>({...scope.music,title,position:0});
  return{scope,animations,timers,nodes,api:scope.api,change:title=>scope.api.setMusic(song(title))};
}

test('three manual track changes update metadata without announcements or transitions while using Nook',()=>{
  const f=fixture();for(const title of ['Choice one','Choice two','Choice three']){f.change(title);assert.equal(f.scope.renderedTitle,title);assert.equal(f.scope.moduleFeedback,null);}
  assert.deepEqual(f.animations,[]);assert.equal(f.scope.moduleFeedbackSequence,0);assert.equal(f.nodes.get('module-feedback-announcer'),undefined);
  f.scope.pointerInside=false;f.change('Choice three');assert.equal(f.scope.moduleFeedback,null,'ignored choices are consumed, never queued for later');
  f.scope.state='rest';f.change('An external song');assert.equal(f.scope.moduleFeedback.kind,'track');assert.equal(f.scope.state,'compact');
  f.change('Another external song');assert.equal(f.scope.moduleFeedbackSequence,2,'the previous notice itself must not be treated as user interaction');
});

test('keyboard, text editing, search, dialogs, drag, module editing and pending media commands remain uninterrupted',()=>{
  const modes=[
    f=>{f.scope.keyboardNavigation=true;f.scope.document.activeElement={closest:()=>({})};},
    f=>{f.scope.view='search';},f=>{f.scope.fileDialogOpen=true;},f=>{f.scope.fileDragging=true;},f=>{f.scope.seekDragging=true;},
    f=>{f.scope.getModuleEditorActive=()=>true;},f=>{f.scope.commandBusy=true;},f=>{f.scope.queueBusy=true;},f=>{f.scope.awaitingPointerEntry=true;},
  ];
  for(const configure of modes){const f=fixture();f.scope.pointerInside=false;configure(f);for(const title of ['One','Two','Three'])f.change(title);assert.equal(f.scope.renderedTitle,'Three');assert.equal(f.scope.moduleFeedback,null);assert.deepEqual(f.animations,[]);}
});

test('interaction can dismiss an existing music announcement without clearing another module notification',()=>{
  const f=fixture();f.scope.pointerInside=false;f.scope.state='rest';f.change('External');assert(f.scope.moduleFeedback);
  f.api.dismissMusicTrackFeedback();assert.equal(f.scope.moduleFeedback,null);assert.equal(f.nodes.get('module-feedback-announcer').textContent,'');assert.equal(f.timers.size,0);
  f.scope.moduleFeedback={id:'shelf',kind:'received',title:'Received'};f.api.dismissMusicTrackFeedback();assert.equal(f.scope.moduleFeedback.id,'shelf');
});

test('a calendar opened by click remains open while its content contracts under the pointer',()=>{
  const f=fixture();f.scope.pointerInside=false;
  for(const [opened,busy,protectedValue] of [[true,true,true],[true,false,true],[false,true,false],[false,false,false]]){
    f.scope.calendar={isOpen:()=>opened,isBusy:()=>busy};
    assert.equal(!!f.api.protectedInteraction(),protectedValue,JSON.stringify({opened,busy}));
  }
  f.scope.calendar=null;assert.equal(!!f.api.protectedInteraction(),false);
});
