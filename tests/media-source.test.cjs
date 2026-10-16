'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const {normalizeMusic} = require('../notch.js');
const source = fs.readFileSync(require.resolve('../notch.js'), 'utf8');

test('Windows source identity is preserved and artwork never crosses between different players', () => {
  const track = normalizeMusic({available:true,title:'Song',artist:'Artist',source:'Microsoft Edge',sourceId:'edge-a',cover:'data:image/png;base64,YQ=='});
  assert.equal(track.source,'Microsoft Edge'); assert.equal(track.sourceId,'edge-a');
  assert.equal(normalizeMusic({...track,cover:undefined},track).cover,track.cover);
  assert.equal(normalizeMusic({...track,sourceId:'edge-b',cover:undefined},track).cover,'');
  assert.equal(normalizeMusic({available:true,title:'Unknown source'}).source,'');
  assert.equal(normalizeMusic({sourceId:'a'.repeat(300)}).sourceId.length,256);
});

function fixture(music) {
  const nodes = new Map(), badges=[{},{}];
  const node = id => {if(!nodes.has(id))nodes.set(id,{hidden:false,disabled:false,dataset:{},setAttribute(key,value){this[key]=value;},getAttribute(key){return this[key]??null;},closest(){return null;},classList:{toggle(){}},querySelector(){return node(id+'-child');},querySelectorAll(){return [];},replaceChildren(){}});return nodes.get(id);};
  const commands=['open','toggle','next','previous','shuffle','repeat'].map(command=>({...node('command-'+command),dataset:{musicCommand:command}}));
  const scope={musicEmpty:node('music-empty-reference'),music:normalizeMusic(music),disposed:false,player:node('player'),live:{},notch:{dataset:{},querySelectorAll:()=>badges},
    builtinVisible:()=>true,renderLiveActivities(){},byId:node,fileDragging:false,state:'open',t:value=>value,text:(target,value)=>target.textContent=value,
    textUI:(target,value)=>target.textContent=value,toggle:node('toggle'),coverImages:[],spectrumArtwork:'',musicError:'',connectionLost:false,commandBusy:false,commands,
    clearSpectrum(){},renderTime(){},syncClock(){},renderHomeSummaries(){},musicQueueLifecycle(){},motionEnabled:()=>true,
    queueOpen:true,view:'music',moduleEditing:false,document:{hidden:false},queueBusy:false,queueOperation:'',queueNotice:'',queueState:{status:'disconnected',canPlay:false,items:[]},queueRetryUntil:0,
    queueListSignature:'',i18n:{locale:()=> 'en'},Date,desktop:{musicQueue:async()=>{throw Error('A system player must not request Spotify');}}};
  const renderStart=source.indexOf('  function renderMusic()'),renderEnd=source.indexOf('  function setMusic(',renderStart);
  const queueStart=source.indexOf('  function queueVisible()'),queueEnd=source.indexOf('  function scheduleMusicQueue(',queueStart);
  vm.runInNewContext(source.slice(renderStart,renderEnd)+source.slice(queueStart,queueEnd)+'this.api={renderMusic,renderMusicQueue,queueVisible};',scope);
  return {scope,nodes,badges,commands,node};
}

test('a non-Spotify session has its own label and Windows controls without a Spotify badge or launcher', () => {
  const f=fixture({available:true,title:'Video',source:'Microsoft Edge',canToggle:true,canNext:false}); f.scope.api.renderMusic();
  assert.equal(f.node('music-source').textContent,'Microsoft Edge'); assert(f.badges.every(badge=>badge.hidden));
  assert.equal(f.node('player-child').textContent,'Microsoft Edge','the application stays visible in the main player, where the source button is hidden');
  assert.equal(f.commands.find(button=>button.dataset.musicCommand==='open').disabled,true);
  assert.equal(f.commands.find(button=>button.dataset.musicCommand==='toggle').disabled,false);
  assert.equal(f.commands.find(button=>button.dataset.musicCommand==='next').disabled,true);
  f.scope.music=normalizeMusic({available:true,source:'Spotify',canToggle:true}); f.scope.api.renderMusic();
  assert(f.badges.every(badge=>!badge.hidden)); assert.equal(f.commands[0].disabled,false);
  f.scope.music=normalizeMusic({available:true}); f.scope.api.renderMusic();
  assert.equal(f.node('music-source').textContent,'Lecteur multimédia'); assert(f.badges.every(badge=>badge.hidden));
});

test('a system player cannot query or display an unrelated Spotify queue or request account setup', () => {
  const f=fixture({available:true,source:'VLC'}); f.scope.api.renderMusicQueue();
  assert.equal(f.scope.api.queueVisible(),false);
  assert.equal(f.node('music-queue-status').textContent,'Ce lecteur ne partage pas sa file d’attente.');
  assert.equal(f.node('music-queue-status').hidden,false);
  for(const id of ['music-queue-connect','music-queue-disconnect','music-queue-items','music-queue-refresh'])assert.equal(f.node(id).hidden,true,id);
  f.scope.music=normalizeMusic({available:true,source:'Spotify'}); assert.equal(f.scope.api.queueVisible(),true);
  f.scope.api.renderMusicQueue(); assert.equal(f.node('music-queue-connect').hidden,false);
  assert.equal(f.node('music-queue-refresh').hidden,false);
});

test('switching from Spotify to a system player removes old queue commands and reveals the correct explanation', () => {
  const f=fixture({available:true,source:'VLC'}); let cleared=0;
  f.scope.queueState={status:'ok',canPlay:true,items:[{name:'Private Spotify title'}]};
  f.scope.queueListSignature='old-spotify-list';
  f.node('music-queue-items').replaceChildren=()=>cleared++;
  f.scope.api.renderMusicQueue();
  assert.equal(f.node('music-queue').dataset.hasItems,'false');
  assert.equal(f.node('music-queue-status').hidden,false);
  assert.equal(f.node('music-queue-status').textContent,'Ce lecteur ne partage pas sa file d’attente.');
  assert.equal(f.node('music-queue-items').hidden,true); assert.equal(cleared,1); assert.equal(f.scope.queueListSignature,'');
  assert.equal(f.scope.api.queueVisible(),false);
});

test('a seek gesture stays attached to its initial player even when the other player has the same song', async () => {
  const sent=[], scope={music:{title:'Same song',artist:'Same artist',sourceId:'first-player',duration:180},musicSeek:{disabled:false,value:'40'},disposed:false,state:'open',seekPreview:null,seekTrack:null,seekDragging:false,musicError:'',
    t:value=>value,renderTime(){},renderMusic(){},recheckCollapse(){},builtinVisible:()=>true,performMusicCommand:async value=>sent.push(value)};
  const start=source.indexOf('  function previewMusicSeek()'),end=source.indexOf('  function musicLifecycle(',start);
  vm.runInNewContext(source.slice(start,end)+'this.api={startMusicSeek,previewMusicSeek,commitMusicSeek};',scope);
  scope.api.startMusicSeek();scope.api.previewMusicSeek();scope.music={...scope.music,sourceId:'second-player'};
  scope.musicSeek.value='50';scope.api.previewMusicSeek();await scope.api.commitMusicSeek();
  assert.equal(sent.length,0,'a player switch during drag cannot seek the replacement session');assert(scope.musicError);
  scope.api.startMusicSeek();scope.api.previewMusicSeek();await scope.api.commitMusicSeek();
  assert.equal(sent.length,1);assert.equal(sent[0].sourceId,'second-player');assert.equal(sent[0].position,50);
});
