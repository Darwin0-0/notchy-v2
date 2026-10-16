'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../notch.js'), 'utf8');
const {artworkPalette, ISLAND_CONFIG} = require('../notch.js');
function section(start, end) {return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));}

test('the queue opens explicitly without changing the player and never queries a different source', () => {
  const context = {player: {hidden: false, dataset: {presentation: 'full'}}, music: {available: true, source: 'Spotify'}, queueOpen: false, moduleEditing: false,
    view: 'nook', state: 'open', document: {hidden: false}};
  vm.runInNewContext(section('  function queueVisible()', '  function queueText(') + 'this.api={queueVisible};', context);
  assert.equal(context.api.queueVisible(), false, 'a normal card does not automatically connect or fetch a queue');
  context.queueOpen=true; context.view='music'; assert.equal(context.api.queueVisible(), true);
  for (const size of ['full','scene','rail']) {context.player.dataset.presentation=size; assert.equal(context.api.queueVisible(), true);}
  context.music.source='Microsoft Edge'; assert.equal(context.api.queueVisible(), false, 'a Windows source never requests an unrelated Spotify account');
  context.music.source='Spotify'; context.player.hidden=true; assert.equal(context.api.queueVisible(), false);
  context.player.hidden=false; context.state='rest'; assert.equal(context.api.queueVisible(), false);
  context.state='open'; context.moduleEditing=true; assert.equal(context.api.queueVisible(), false);
});

test('queue tracks retain only validated durations, artwork and playable track identities', () => {
  const context = {};
  vm.runInNewContext(section('  function queueText(', '  function renderMusicQueue()') + 'this.snapshot=queueSnapshot;', context);
  const value = context.snapshot({status: 'ok', canPlay: true, items: [
    {name: 'Song', artists: ['Artist'], uri: 'spotify:track:' + 'A'.repeat(22), duration: 192000, artwork: 'data:image/png;base64,YQ=='},
    {name: 'Episode', type: 'episode', uri: 'spotify:track:' + 'B'.repeat(22), duration: -1, artwork: 'https://untrusted.invalid/cover.png'},
    {name: 'Unknown duration', uri: 'javascript:alert(1)', duration: null}, {name: 'Invalid duration', duration: 86400001}
  ]});
  assert.equal(value.canPlay, true); assert.equal(value.items[0].duration, 192000); assert.equal(value.items[0].uri, 'spotify:track:' + 'A'.repeat(22));
  assert.equal(value.items[0].artwork, 'data:image/png;base64,YQ==');
  for (const item of value.items.slice(1)) {assert.equal(item.uri, ''); assert.equal(item.duration, null); assert.equal(item.artwork, null);}
  assert.equal(context.snapshot({status: 'disconnected', items: value.items}).items.length, 0, 'no cached list is exposed as a real disconnected queue');
});

test('leaving the queue view invalidates a pending queue read and cancels its refresh timer', () => {
  const cleared = [], reads = [], context = {queueOpen: false, view: 'nook', state: 'open', moduleEditing: false, queueActive: false, queueBusy: false, queueEpoch: 3, queueTimer: 0,
    visible: true, queueVisible() {return this.visible;}, readMusicQueue(value) {reads.push(value);}, closeMusicQueue() {throw Error('An inline preview is not an explicit queue route');},
    window: {clearTimeout(value) {cleared.push(value);}}};
  context.queueVisible = () => context.visible;
  vm.runInNewContext(section('  function musicQueueLifecycle()', '  async function musicQueueCommand(') + 'this.run=musicQueueLifecycle;', context);
  context.run(); assert.deepEqual(reads, [false]); assert.equal(context.queueActive, true);
  context.queueBusy = true; context.queueTimer = 42; context.visible = false; context.run();
  assert.equal(context.queueEpoch, 4); assert.equal(context.queueBusy, false); assert.equal(context.queueActive, false); assert.equal(context.queueTimer, 0); assert.deepEqual(cleared, [42]);
});

test('real cover palettes stay opaque, distinct and readable even for a white cover', () => {
  const luminance = hex => {
    const [r,g,b]=[1,3,5].map(offset=>parseInt(hex.slice(offset,offset+2),16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
    return .2126*r+.7152*g+.0722*b;
  };
  const palettes=['#ffffff','#ff0000','#00ff00','#0000ff','#f28b96','#dfb53d'].map(artworkPalette);
  for(const palette of palettes) for(const value of Object.values(palette)) {
    assert.match(value,/^#[a-f0-9]{6}$/);
    assert((luminance('#f0f0f5')+.05)/(luminance(value)+.05)>=4.5,`${value} must keep the artist readable`);
  }
  assert.notDeepEqual(palettes[1],palettes[3]);
  const redCover = artworkPalette('#913838');
  assert(luminance(redCover.base) > .09, 'a darker real cover keeps a visible colour wash');
  assert(luminance(redCover.base) <= .095); assert(luminance(redCover.highlight) <= .12);
  for(const invalid of ['',null,123,{},'#fff','url(untrusted)']) assert.deepEqual(artworkPalette(invalid),{base:'#202024',highlight:'#38383e',shadow:'#0a0a0d'});
});

test('the shared preview backdrop uses decoded artwork and clears on cover reset or failure', () => {
  const values = new Map(), notch = {dataset: {}, style: {setProperty: (name, value) => values.set(name, value)}};
  const context = {notch, artworkPalette};
  vm.runInNewContext(section('  function applyArtworkPalette(', '  function coverLoaded(') + 'this.apply=applyArtworkPalette;', context);
  context.apply('#265faf');
  assert.equal(notch.dataset.mediaArtwork, 'true');
  const blue = values.get('--music-card-base');
  context.apply('#b91f32');
  assert.notEqual(values.get('--music-card-base'), blue, 'the current cover replaces the previous palette');
  context.apply();
  assert.equal(notch.dataset.mediaArtwork, 'false', 'missing or failed artwork cannot retain the previous backdrop');
});

test('real hover controls delegate one native command and ignore unavailable capabilities', async () => {
  const sent=[], scope={disposed:false,commandBusy:false,document:{activeElement:null},performMusicCommand:async value=>sent.push(value.command)};
  vm.runInNewContext(section('  async function commandMusic(', '  async function performMusicCommand(')+'this.run=commandMusic;',scope);
  for(const command of ['previous','toggle','next']) await scope.run({target:{closest:()=>({disabled:false,dataset:{musicCommand:command}})}});
  assert.deepEqual(sent,['previous','toggle','next']);
  await scope.run({target:{closest:()=>({disabled:true,dataset:{musicCommand:'next'}})}});
  scope.commandBusy=true; await scope.run({target:{closest:()=>({disabled:false,dataset:{musicCommand:'toggle'}})}});
  assert.equal(sent.length,3);
});

test('native hit testing accepts the three hover buttons but leaves transparent padding click-through', () => {
  const changes=[], scope={desktop:{setInteractive:value=>changes.push(value)},disposed:false,desktopMouse:null,desktopInteractive:false,
    document:{elementFromPoint:()=>scope.hit}};
  vm.runInNewContext(section('  function desktopPointer(', '  function desktopFocus(')+'this.run=desktopPointer;',scope);
  const hit = selector => ({closest: selectors => selectors.split(',').includes(selector) ? {} : null});
  for (const command of ['previous','toggle','next']) {
    scope.hit=hit('#music-hover-controls button'); scope.run({clientX:10,clientY:10});
    assert.equal(scope.desktopInteractive,true,command);
    scope.hit=hit('#music-hover-controls'); scope.run(); assert.equal(scope.desktopInteractive,false,'transparent padding');
  }
  scope.hit=hit('#notch-surface > use'); scope.run(); assert.equal(scope.desktopInteractive,true,'the black silhouette remains interactive');
  assert.deepEqual(changes,[true,false,true,false,true,false,true]);
});

test('music commands restore their initiating keyboard control after busy state without stealing outside focus', async () => {
  const focused=[], body={}, outside={}, scope={disposed:false,commandBusy:false,document:{activeElement:null,body},toggle:{disabled:false,getClientRects:()=>[{}],focus(){focused.push('toggle');}}};
  const button={disabled:false,dataset:{musicCommand:'toggle'},closest:()=>null,getClientRects:()=>[{}],focus(){focused.push('button');scope.document.activeElement=this;}};
  let pending;
  scope.performMusicCommand=()=>{button.disabled=true;scope.document.activeElement=body;return new Promise(resolve=>pending=()=>{button.disabled=false;resolve();});};
  vm.runInNewContext(section('  async function commandMusic(', '  async function performMusicCommand(')+'this.run=commandMusic;',scope);
  const event={target:{closest:()=>button}};
  scope.document.activeElement=button; let operation=scope.run(event); pending(); await operation; assert.deepEqual(focused,['button']);
  scope.document.activeElement=button; operation=scope.run(event); scope.document.activeElement=outside; pending(); await operation; assert.deepEqual(focused,['button'],'an outside focus change remains owned by the user');
  scope.document.activeElement=button; operation=scope.run(event); button.closest=()=>({inert:true}); pending(); await operation; assert.deepEqual(focused,['button','toggle'],'a hidden or inert mini does not receive focus');
});

test('closing the secondary queue returns to the exact prior Nook page and a visible trigger', () => {
  const selected=[], focused=[], scope={queueOpen:true,queueActive:true,queueBusy:false,queueNotice:'',queueOperation:'',queueEpoch:2,queueTimer:4,
    queueReturnView:'nook',queueReturnPage:'focus',view:'music',islandPage:'music',window:{clearTimeout(){}},renderMusicQueue(){},update(){},
    selectViewButton(button){selected.push([button.dataset.view,scope.islandPage]);scope.view=button.dataset.view;},
    byId:()=>({closest:()=>null,focus:()=>focused.push('queue-trigger')})};
  vm.runInNewContext(section('  function closeMusicQueue(', '  function musicQueueLifecycle(')+'this.run=closeMusicQueue;',scope);
  scope.run(); assert.deepEqual(selected,[['nook','focus']]); assert.deepEqual(focused,['queue-trigger']);
  assert.equal(scope.queueOpen,false); assert.equal(scope.queueBusy,false); assert.equal(scope.queueEpoch,3);
});

test('the hover transport shares the compact content choreography and becomes inert on exit', () => {
  const effects=[], scope={ISLAND_CONFIG,NOTCH_TOKENS:require('../tokens.js'),contentAnimations:new Map(),document:{hidden:false},motionEnabled:()=>true,
    getComputedStyle:()=>({opacity:'0',filter:'blur(10px)',transform:'translateY(5px) scale(.9)'})};
  const node={style:{},animate(frames,options){const effect={frames,options,cancelled:false,cancel(){this.cancelled=true;},finished:new Promise(()=>{})};effects.push(effect);return effect;}};
  vm.runInNewContext(section('  function animateIslandLayer(', '  function renderIslandNavigation(')+'this.run=animateIslandLayer;',scope);
  scope.run(node,true,true); assert.equal(node.inert,false);
  assert.deepEqual(effects.map(effect=>[effect.options.duration,effect.options.delay]),[[300,80],[500,80]]);
  scope.run(node,false,true); assert.equal(node.inert,true); assert.equal(node.style.pointerEvents,'none');
  assert(effects.slice(0,2).every(effect=>effect.cancelled),'interrupting cancels the previous layer animation');
  assert.deepEqual(effects.slice(2).map(effect=>[effect.options.duration,effect.options.delay]),[[150,0],[150,0]]);
  scope.motionEnabled=()=>false; scope.run(node,true,true);
  assert(effects.slice(4).every(effect=>effect.options.duration===150&&effect.options.delay===0));
  assert.equal(effects[5].frames[1].transform,'none'); assert.equal(effects[4].frames[1].filter,'none');
});
