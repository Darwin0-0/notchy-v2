'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../notch.js'), 'utf8');
const css = fs.readFileSync(require.resolve('../notch.css'), 'utf8');
const {ISLAND_CONFIG, getModuleDefinitions, nookGridPlan, closedBandSize, openPanelLimits, normalizeAppearance, openPanelWidth, openPanelScale, shape} = require('../notch.js');
const ModuleLayout=require('../module-contracts.js');

function functionSection(begin, end, checkoutSource = source) {
  const start = checkoutSource.indexOf(begin), stop = checkoutSource.indexOf(end, start);
  assert(start > 0 && stop > start, 'fixture locates the production function boundaries');
  return checkoutSource.slice(start, stop);
}

function fixture() {
  const properties = {}, targets = [], options = [], homeProperties = {};
  const home = {dataset: {}, style: {setProperty(name, value) {homeProperties[name] = value;}}};
  const context = {
    syncCalendarLayer() {}, calendar: null, calendarHeightLimit: 0, moduleLab: null,
    ISLAND_CONFIG, ModuleLayout, closedBandSize, nookGridPlan, openPanelWidth, openPanelScale, shape, islandPage:'music',
    disposed: false, state: 'open', view: 'music', closingTo: null, fileDragging: false, editorActive: false, ia: {render() {}},
    musicActive: false, focusActive: false, transferActive: false, animations: false,
    appearance: {format: 'compact', radius: 18}, welcomeReady: false, welcomeStage: 'welcome', moduleFeedback: null,
    window: {innerWidth: 1280, innerHeight: 800, performance: {now: () => 10}, cancelAnimationFrame() {}, requestAnimationFrame: () => 1},
    document: {hidden: false}, desktop: {sendGeometry: () => Promise.resolve(null)}, desktopMaxHeight: 700,
    getModuleEditorActive: () => context.editorActive,
    getCollapsedActivities: () => context.activities || ['music','focus','transfer'].filter(id=>context[id+'Active']).map(id=>({id})),
    musicInBand: () => context.musicActive, focusIsActive: () => context.focusActive,
    isModuleEnabled: () => true, localSendBand: () => context.transferActive ? {progress: .5} : null,
    receptionGeometry: () => null,
    getHomeSlots: () => ['music'], homeCells: new Map(), homeLayout: null,
    renderHomeLayout() {home.dataset.layout=context.scene?'activities':'grid';if(context.scene)context.scene.height=368;context.homeLayout=context.scene||{mode:'grid',items:nookGridPlan(context.islandPage,['music'])};},
    byId: () => home, expandedLayer: {style: {}}, menu: {hidden: false, inert: false}, islandFooter: {hidden:false},
    notch: {dataset: {}, style: {setProperty(name, value) {properties[name] = value;}}},
    protectLayoutResize() {}, motionEnabled: () => context.animations,
    motion: {setTarget(target, option) {targets.push(target); options.push(option);}, step: () => context.sample || targets.at(-1), isActive: () => false},
    frame: 0, geometry: null, desktopPointer() {},
    surface: {setAttribute() {}}, contour: {setAttribute() {}}, bandCut: {setAttribute() {}}, panelCut: {setAttribute() {}},
    paint() {}, renderLocalSend() {}, renderCollapsedActivities() {}, renderGalet() {}, recheckCollapse() {},
  };
  const core = functionSection('  function islandCoreView() {', '  function animateIslandLayer(');
  const update = functionSection('  function update() {', '  function setState(');
  vm.runInNewContext(`${core}\n${update}\nthis.run = update;`, context);
  return {context, properties, homeProperties, targets, options,
    run() {context.run(); return targets.at(-1);},
    useProductionPaint() {
      vm.runInNewContext(functionSection('  function paint(', '  function update()') + '\nthis.paint = paint;', context);
    },
  };
}

function assertOpenSize(value, label, width = ISLAND_CONFIG.formats.balanced, height = 464, radius = 40) {
  assert.equal(value.width, width, label + ' width');
  assert.equal(value.height, height, label + ' height');
  assert.equal(value.radius, radius, label + ' bottom corners');
}

test('native clipping follows all three display scales throughout the surface spring without double conversion',()=>{
  const f=fixture(),sent=[];
  f.context.desktop={sendGeometry:value=>{sent.push(value);return Promise.resolve(null);}};
  f.useProductionPaint();f.run();
  for(const [format,targetScale]of Object.entries(ISLAND_CONFIG.displayScales))for(const progress of [0,.25,.5,.75,1]) {
    f.context.appearance.format=format;f.context.sample={width:844,height:464,radius:40,band:80,shoulder:0,progress};f.context.paint();
    const scale=1+(targetScale-1)*progress,value=sent.at(-1);
    assert(Math.abs(Number(f.properties['--panel-scale'])-scale)<1e-12);
    for(const [key,logical]of Object.entries({width:844,height:464,radius:40,band:80,shoulder:0}))assert(Math.abs(value[key]-logical*scale)<1e-9,key+' converted once at '+format);
    assert.equal(f.context.geometry.width,844,'logical canvas remains fixed through display scaling');
  }
  f.context.state='rest';f.context.sample={width:128,height:10,radius:6,band:10,shoulder:0,progress:0};f.context.paint();
  assert.equal(sent.at(-1).width,128);assert.equal(sent.at(-1).height,10);
  f.context.view='welcome';f.context.sample={width:570,height:350,radius:38,band:0,shoulder:0,progress:1};f.context.paint();
  assert.equal(sent.at(-1).width,456,'onboarding is reduced once without changing its composition');
  assert.equal(sent.at(-1).height,280);
});

test('Module Lab reserves its controls without changing the ordinary module scene after return', () => {
  const f=fixture();f.context.view='nook';f.context.getHomeSlots=()=>['focus'];f.context.scene={mode:'activities',items:[{id:'focus'}]};
  const normal=f.run(),normalBody=Number.parseFloat(f.properties['--panel-height']);
  f.context.moduleLab={id:'focus',ids:['focus'],presentation:'full'};
  const lab=f.run();assert.equal(ModuleLayout.metrics.labInset,40);assert.equal(lab.width,normal.width);assert.equal(lab.height,normal.height+ModuleLayout.metrics.labInset);assert.equal(Number.parseFloat(f.properties['--panel-height']),normalBody+ModuleLayout.metrics.labInset);
  f.context.moduleLab=null;const returned=f.run();assert.equal(returned.height,normal.height);assert.equal(returned.width,normal.width);assert.equal(Number.parseFloat(f.properties['--panel-height']),normalBody);
});

test('every open route uses the same bounded island instead of retaining the previous layout size', () => {
  const f = fixture();
  assert.deepEqual(openPanelLimits, {width: 844, height: 464});
  for (const view of ['nook', 'music', 'focus', 'tasks', 'weather', 'tray', 'settings', 'scenarios', 'files', 'localsend']) {
    f.context.view = view;
    const height=['focus','tasks'].includes(view)?496:464;
    assertOpenSize(f.run(), view,ISLAND_CONFIG.formats.balanced,height,view==='tray'?28:40);
    assert.equal(f.context.expandedLayer.style.width, ISLAND_CONFIG.formats.balanced+'px', view + ' content width');
    assert.equal(f.context.expandedLayer.style.height, height+'px', view + ' content height');
  }
  f.context.view = 'music'; f.context.queueOpen = true;
  assertOpenSize(f.run(), 'music queue');
  f.context.queueOpen = false; f.context.view = 'focus'; f.context.focusConfig = true;
  assertOpenSize(f.run(), 'Focus configuration',ISLAND_CONFIG.formats.balanced,496);
  f.context.focusConfig = false; f.context.view = 'nook'; f.context.getHomeSlots = () => ['music', 'focus', 'weather', 'shelf'];
  assertOpenSize(f.run(), 'all available modules');
  f.context.getHomeSlots = () => ['music'];
  assertOpenSize(f.run(), 'single module after leaving a larger layout');
});

test('all formats preserve installer layout coordinates inside the uniformly reduced surface', () => {
  const f = fixture();
  assert.deepEqual(ISLAND_CONFIG.formats, {compact:844,balanced:844,comfortable:844});
  assert.equal(openPanelScale('compact'),.7);
  for (const [format,width] of Object.entries(ISLAND_CONFIG.formats)) {
    f.context.appearance.format=format;
    for (const view of ['nook','focus','tasks','settings','weather','tray','localsend']) {
      const detail=['focus','tasks'].includes(view),height=detail?496:464;
      const expectedWidth=width;
      f.context.view=view; assertOpenSize(f.run(),format + ' ' + view,expectedWidth,height,view==='tray'?28:40);
      assert.equal(f.context.expandedLayer.style.width,expectedWidth + 'px');
      assert.equal(f.context.expandedLayer.style.height,height+'px');
    }
    f.context.window.innerWidth=390;
    assert.equal(f.run().width,358/openPanelScale(format),'the visible scaled surface keeps its screen margins');
    f.context.window.innerWidth=1280;
    assertOpenSize(f.run(),'restored ' + format,width,464);
  }
});

test('Compact temporarily gives Module Lab the rich surface and returns to its saved width', () => {
  const f=fixture();f.context.appearance.format='compact';f.context.view='nook';
  assertOpenSize(f.run(),'compact home',844,464);
  f.context.scene={mode:'activities',items:[{id:'focus'}]};
  f.context.moduleLab={id:'focus',ids:['focus'],presentation:'full'};
  assertOpenSize(f.run(),'rich lab',844,504);
  f.context.moduleLab=null;f.context.scene=null;
  assertOpenSize(f.run(),'compact return',844,464);
});

test('the production slot budget fits Compact companions and preserves the native rich Lab budget',()=>{
  const context={ISLAND_CONFIG,ModuleLayout,openPanelWidth,openPanelScale,moduleLab:null,appearance:{format:'compact'},getHomeSlots:()=>['music','focus','weather'],window:{innerWidth:1280,innerHeight:800},desktop:true,desktopMaxHeight:700};
  vm.runInNewContext(functionSection('  function slotViewport(', '  function planHomeSlots(')+'\nthis.viewport=slotViewport;',context);
  const budget=context.viewport();
  assert.equal(budget.width,812);assert.equal(budget.height,368);assert.equal(budget.density,'regular');
  let plan=ModuleLayout.planSlots(['music','focus','weather'].map(id=>({id})),budget);
  assert(plan.items.every(item=>item.fits));assert.equal(plan.mode,'triple');
  context.window.innerWidth=422;
  const narrow=context.viewport();assert.equal(narrow.width,390/.7-32);assert.equal(narrow.height,368);
  plan=ModuleLayout.planSlots(['music','focus','weather'].map(id=>({id})),narrow);
  assert.equal(plan.mode,'compact-stack');
  context.window.innerWidth=1280;context.moduleLab={ids:['focus']};
  const lab=context.viewport();assert.equal(lab.width,812);assert.equal(lab.height,368);assert.equal(lab.density,'regular');
});
test('the weekly agenda expands for appointments and returns to its original home scene', () => {
  const f=fixture(); let opened=true;
  f.context.view='nook'; f.context.calendar={isOpen:()=>opened,preferredHeight:228};
  f.context.scene={mode:'activities',items:[{id:'music'},{id:'weather'}]};
  assert.equal(f.run().height,324);
  assert.equal(f.properties['--panel-height'],'228px');
  assert.equal(f.context.notch.dataset.activityScene,'false');
  f.context.calendar.preferredHeight=346;
  assert.equal(f.run().height,442);
  assert.equal(f.context.calendarHeightLimit,442);
  f.useProductionPaint(); f.context.motion.isActive=()=>true;
  f.context.sample={width:ISLAND_CONFIG.formats.balanced,height:390,band:80,shoulder:0,radius:14,progress:1};
  opened=false; f.run(); f.context.paint();
  assert.equal(f.context.geometry.height,390,'closing retains the moving calendar height until the surface settles');
  assert.equal(f.properties['--calendar-body-height'],'294px');
  f.context.motion.isActive=()=>false;
  f.context.sample={...f.context.sample,height:464}; f.context.paint();
  assert.equal(f.context.calendarHeightLimit,0);
});

test('header, content, bottom inset and core navigation share one explicit height budget', () => {
  const f = fixture();
  for (const view of ['nook', 'music', 'focus', 'tasks', 'weather', 'tray', 'settings', 'scenarios', 'files']) {
    f.context.view = view;
    const value = f.run(), core = ['nook', 'music', 'focus', 'tasks'].includes(view);
    assert.equal(value.band, 80, view + ' header');
    assert.equal(f.context.menu.hidden, false, view + ' header remains reachable');
    assert.equal(f.context.menu.inert, false, view + ' header remains interactive');
    const body = parseFloat(f.properties['--panel-height']);
    assert.equal(body, ['focus','tasks'].includes(view)?400:368, view + ' body');
    assert.equal(f.properties['--island-body-height'], body + 'px');
    assert.equal(body + value.band + 16, value.height, view + ' content fits without a parallel footer navigation');
    assert.equal(f.context.islandFooter.hidden,true);
  }
  f.context.view = 'nook'; f.context.editorActive = true;
  f.context.homeLayout = {mode:'activities',items:[{id:'music'},{id:'focus'},{id:'weather'}]};
  assert.equal(f.run().band, 80);
  assert.equal(f.run().height,464,'the editor never inherits the previous three-card scene height');
  assert.equal(f.properties['--island-header-height'],'80px','navigation keeps its common header height while editing');
  assert.equal(f.properties['--panel-height'], '368px', 'the module editor does not reserve core navigation');
});

test('stored corner preferences map to restrained radii shared by the painted and native surface', () => {
  const f = fixture(), sent = [];
  f.context.desktop = {sendGeometry(value) {sent.push(value); return Promise.resolve(null);}};
  f.useProductionPaint();
  for (const [preference, radius] of [[12,38],[18,40],[24,42]]) {
    f.context.appearance = normalizeAppearance({radius: preference});
    for (const view of ['nook','music','focus','tasks','weather','tray','settings','scenarios','files','localsend']) {
      f.context.view = view;
      const routeRadius=view==='tray'?radius-12:radius;
      assert.equal(f.run().radius, routeRadius, view + ' selected corner style');
      assert.equal(Number.parseFloat(f.properties['--radius']), routeRadius, view + ' CSS follows the painted contour');
      assert.equal(sent.at(-1).radius, routeRadius*.7, view + ' native hit region follows the scaled painted contour');
      assert.equal(sent.at(-1).shoulder, 0, view + ' open surface keeps its top corners square');
      assert.equal(f.context.appearance.radius, preference, 'rendering does not rewrite the stored preference');
    }
  }
});

test('the open navigation keeps the same header height and side inset across scenes, routes and the editor', () => {
  const f = fixture();
  const assertHeader = label => {
    f.run();
    assert.equal(f.properties['--island-header-height'], '80px', label + ' header height');
    assert.equal(f.properties['--island-side'], '16px', label + ' side inset');
    assert.equal(f.context.menu.hidden, false, label + ' navigation visible');
    assert.equal(f.context.menu.inert, false, label + ' navigation interactive');
  };
  f.context.view = 'nook';
  for (let count = 1; count <= 3; count++) {
    f.context.scene = {mode: 'activities', items: ['music','focus','weather'].slice(0,count).map(id => ({id}))};
    assertHeader(count + ' placed modules');
  }
  f.context.editorActive = true; assertHeader('editor');
  f.context.editorActive = false;
  for (const view of ['music','focus','tasks','weather','tray','settings','scenarios','files']) {
    f.context.view = view; assertHeader(view);
  }
  assert.match(css, /\.notch\s+#notch-menu\s*\{[^}]*height:\s*var\(--island-header-height,var\(--measure-48-px\)\);[^}]*padding:\s*var\(--space-8\)\s+var\(--island-side,var\(--space-20\)\);/, 'navigation uses one stable position for every open route through shared tokens');
});

test('welcome, LocalSend and a file drop share the island without an unrelated header', () => {
  const f = fixture();
  f.context.view = 'welcome';
  for (const [stage, width, height, radius] of [['idle',160,12.5,7.5], ['logo',460,128,38], ['welcome',570,350,38], ['tutorial',570,350,38]]) {
    f.context.welcomeStage = stage;
    const value = f.run();
    assert.equal(value.width,width,stage); assert.equal(value.height,height,stage); assert.equal(value.radius,radius,stage); assert.equal(value.band,0,stage);
    if(stage==='idle') {assert.equal(value.width*.8,128);assert.equal(value.height*.8,10);assert.equal(value.radius*.8,6);}
    assert.equal(f.properties['--panel-height'], Math.max(0,height - 16) + 'px',stage);
    assert.equal(f.context.menu.hidden, true); assert.equal(f.context.menu.inert, true);
  }
  f.context.view = 'localsend'; const localSend = f.run();
  assertOpenSize(localSend,'LocalSend'); assert.equal(localSend.band,0);
  assert.equal(f.properties['--panel-height'],'448px');
  f.context.view = 'tray'; f.context.editorActive = true; f.context.fileDragging = true;
  const drop = f.run(); assertOpenSize(drop, 'file drop',844,464,28); assert.equal(drop.band, 0);
  assert.equal(f.properties['--panel-height'], '448px');
  assert.equal(f.context.menu.hidden, true); assert.equal(f.context.menu.inert, true);
  f.context.fileDragging = false; f.context.editorActive = false; f.context.view = 'settings';
  assertOpenSize(f.run(), 'settings after drop');
  assert.equal(f.context.menu.hidden, false); assert.equal(f.context.menu.inert, false);
});

test('long auxiliary content scrolls inside its fixed body instead of growing the surface', () => {
  const f = fixture();
  f.context.settingsNaturalPanelHeight = f.context.naturalPanelHeight = () => {throw new Error('open geometry must not follow auxiliary content length');};
  f.context.getHomeSlots = () => getModuleDefinitions().map(item => item.id);
  for (const view of ['settings', 'scenarios', 'files', 'tray', 'weather', 'localsend']) {
    f.context.view = view;
    assertOpenSize(f.run(), view,844,464,view==='tray'?28:40);
    assert(parseFloat(f.properties['--panel-height']) <= 448);
  }
  f.context.editorActive = true;
  assertOpenSize(f.run(), 'module editor');
  assert.match(css, /\.notch\s+#notch-panel\s*\{[^}]*overflow:\s*auto\s*;/, 'the auxiliary panel owns scrolling');
  assert.match(css, /\.notch\[data-island-core="false"\]\s+#notch-panel\s*>\s*section\s*\{[^}]*height:\s*auto\s*;[^}]*overflow:\s*visible\s*;/, 'auxiliary sections can expose content beyond their viewport');
});

test('narrow and short work areas cap every route and restore the common size on a larger screen', () => {
  const f = fixture();
  f.context.window.innerWidth = 320; f.context.window.innerHeight = 300; f.context.desktop = null;
  for (const view of ['nook', 'music', 'focus', 'tasks', 'settings', 'scenarios', 'weather', 'tray', 'files', 'welcome', 'localsend']) {
    f.context.view = view;
    const value = f.run();
    const scale=openPanelScale(f.context.appearance.format,{welcome:view==='welcome'});
    assert.equal(value.width, 288/scale, view + ' preserves the two visible side margins');
    assert.equal(value.height, 204/scale, view + ' stays within the short browser viewport');
    assert.equal(f.context.expandedLayer.style.width, 288/scale+'px');
    assert.equal(f.context.expandedLayer.style.height, 204/scale+'px');
    assert(parseFloat(f.properties['--panel-height']) >= 0);
  }
  f.context.desktop = {sendGeometry: () => Promise.resolve(null)}; f.context.desktopMaxHeight = 188;
  assert.equal(f.run().height, 180/.7, 'the scaled native work area reserves its safety inset');
  f.context.window.innerWidth = 2560; f.context.window.innerHeight = 1440; f.context.desktopMaxHeight = 1400;
  assertOpenSize(f.run(), 'restored display');
});

test('real activities choose the hover row and every return to discreet stays thin', () => {
  const f = fixture(); f.context.state = 'rest';
  let value = f.run();
  assert.equal(value.width, 128); assert.equal(value.height, 10); assert.equal(value.band, 10); assert.equal(value.radius,6);
  assert.equal(f.properties['--closed-width'], '128px'); assert.equal(f.properties['--closed-height'], '10px');
  for (const activity of ['musicActive', 'focusActive', 'transferActive']) {
    f.context[activity] = true; value = f.run();
    assert.equal(value.width,128,activity);assert.equal(value.height,10,activity);assert.equal(value.band,10,activity);assert.equal(value.shoulder,0,activity);
    f.context[activity] = false;
  }
  f.context.state='compact'; value=f.run(); assert.equal(value.width,240); assert.equal(value.height,40); assert.equal(value.radius,10);
  f.context.state='rest'; value=f.run(); assert.equal(value.width,128); assert.equal(value.height,10);
  assert.equal(f.context.menu.hidden, true); assert.equal(f.context.menu.inert, true);
  f.context.state = 'open'; assertOpenSize(f.run(), 'reopened');
  f.context.closingTo = 'rest'; f.run();
  assert.equal(f.context.menu.hidden, false); assert.equal(f.context.menu.inert, true, 'the exiting layer must not accept clicks');
});

test('home layout uses the shared side inset and gap without widening the single-content surface', () => {
  const f = fixture(); f.context.view = 'nook';
  let value = f.run();
  assertOpenSize(value, 'home');
  assert.equal(f.homeProperties['--home-gap'], '16px');
  assert.equal(f.context.homeLayout.mode,'grid');
  assert.deepEqual(f.context.homeLayout.items,nookGridPlan('music',['music']),'home uses its full grid composition without a legacy module width');
  f.context.window.innerWidth = 352;
  value = f.run(); assert.equal(value.width, 320/.7);
  assert.deepEqual(f.context.homeLayout.items,nookGridPlan('music',['music']),'a smaller screen retains cell positions without enlarging the shell');
  assert.equal(f.context.expandedLayer.style.width, 320/.7+'px');
});

test('one, two and three placed modules keep the final reference scene height', () => {
  const f=fixture();f.context.view='nook';f.context.scene={mode:'activities',items:[{id:'focus'},{id:'music'},{id:'transfer'}]};
  let value=f.run();assert.equal(value.width,ISLAND_CONFIG.formats.balanced);assert.equal(value.height,464);assert.equal(f.properties['--island-body-height'],'368px');
  assert.equal(value.band,80);assert.equal(f.properties['--island-side'],'16px');assert.equal(f.context.islandFooter.hidden,true);
  f.context.scene.items.pop();assert.equal(f.run().height,464,'one rail card keeps the reference scene height');assert.equal(f.properties['--island-body-height'],'368px');
  f.context.scene.items.push({id:'transfer'});f.context.view='settings';assert.equal(f.run().height,464,'settings keep their existing size');assert.equal(f.properties['--island-side'],'16px');assert.equal(f.context.notch.dataset.activityScene,'false');
  f.context.view='nook';f.context.state='rest';assert.equal(f.run().height,10,'activity count cannot enlarge discreet mode');
  f.context.state='open';f.context.desktopMaxHeight=300;assert.equal(f.run().height,292/.7,'the scaled scene still fits the work area');
});

test('content keeps its final width while the shell spring expands, rebounds and settles', () => {
  const f = fixture(); f.context.animations = true; f.useProductionPaint();
  f.run();
  for (const [width, height] of [[128, 10], [300, 120], [580, 332], [ISLAND_CONFIG.formats.balanced, 464]]) {
    f.context.sample = {width, height, band: 48, radius: 30, progress: .7,shoulder:0};
    f.context.paint();
    assert.equal(f.context.expandedLayer.style.width, ISLAND_CONFIG.formats.balanced+'px', 'layout width must not follow the animated contour');
    assert.equal(f.context.expandedLayer.style.height, '464px');
    assert.equal(f.properties['--content-width'], ISLAND_CONFIG.formats.balanced+'px');
    assert.equal(parseFloat(f.properties['--width']), width);
  }
  assert.equal(f.options.at(-1).snap, false);
});

test('paint permits a gentle rebound of at most three percent and still respects a narrow viewport', () => {
  const f = fixture(); f.context.animations = true; f.useProductionPaint();
  f.context.sample = {width: 1200, height: 700, band: 48, radius: 30, progress: 2,shoulder:0};
  f.run();
  assert(Math.abs(parseFloat(f.properties['--width']) - ISLAND_CONFIG.states.expanded.width * 1.03) < 1e-6);
  assert(Math.abs(parseFloat(f.properties['--height']) - ISLAND_CONFIG.activities.durationDetailHeight * 1.03) < 1e-6);
  assert.equal(f.properties['--menu-opacity'], '1');
  f.context.window.innerWidth = 352; f.run();
  assert(Math.abs(parseFloat(f.properties['--width'])*.7-320)<.001, 'the rebound cannot cross the screen margins');
  assert.equal(f.context.expandedLayer.style.width, 320/.7+'px');
});

test('native activity geometry includes its painted ears without exceeding the work area', () => {
  const f=fixture(),sent=[];f.context.desktop={sendGeometry:value=>{sent.push(value);return Promise.resolve(null);}};f.useProductionPaint();
  for (const viewport of [320,960]) for (let count=1;count<=3;count++) for (const state of ['rest','compact']) {
    f.context.window.innerWidth=viewport;f.context.state=state;
    f.context.activities=Array.from({length:count},(_,index)=>({id:['focus','music','transfer'][index]}));
    f.run();const value=sent.at(-1), scale=state==='compact'?ISLAND_CONFIG.activities.peekScale:1;
    assert(Math.abs(value.width-(parseFloat(f.properties['--width'])+2*value.shoulder))<1e-7,'Windows receives the full painted width');
    assert(value.width<=viewport-32+1e-7,'ears stay inside the same screen margins');
    assert.equal(value.shoulder,state==='compact'?8*scale:0);assert(Math.abs(value.height-(state==='compact'?42*scale:10))<1e-7);
    assert(value.radius+value.shoulder<=value.height+1e-7);
    if(viewport===960)assert.equal(value.width,state==='compact'?[240,300,360][count-1]*scale+16*scale:128);
  }
});

test('hidden documents and reduced motion snap to the same geometry rather than changing layout', () => {
  const f = fixture();
  f.context.animations = false; assertOpenSize(f.run(), 'reduced motion'); assert.equal(f.options.at(-1).snap, true);
  f.context.animations = true; f.context.document.hidden = true;
  assertOpenSize(f.run(), 'hidden document'); assert.equal(f.options.at(-1).snap, true);
  f.context.document.hidden = false;
  assertOpenSize(f.run(), 'animated document'); assert.equal(f.options.at(-1).snap, false);
  const calls = f.targets.length; f.context.disposed = true; f.run();
  assert.equal(f.targets.length, calls, 'disposed components do not schedule geometry changes');
});

test('natural height measures visible content, margins and padding with either checkout line ending', () => {
  const child = (height, margins, hidden = false) => ({hidden, margins, getBoundingClientRect: () => ({height})});
  const settingsPlayer = {style: {width: '360px'}, children: [child(170, ['0', '18px']), child(32, ['0', '0']), child(500, ['0', '10px'], true)]};
  const context = {settingsPlayer, getComputedStyle: node => node === settingsPlayer ? {paddingTop: '10px', paddingBottom: '18px'} : {marginTop: node.margins[0], marginBottom: node.margins[1]}};
  for (const lineEnding of ['\n', '\r\n']) {
    const checkoutSource = source.replace(/\r?\n/g, lineEnding);
    const functions = functionSection('  function settingsNaturalPanelHeight() {', '  function shelfGlyph', checkoutSource);
    vm.runInNewContext(`${functions}\nthis.measure = settingsNaturalPanelHeight; this.measureAt = naturalPanelHeight;`, context);
    assert.equal(context.measure(), 248);
    assert.equal(context.measureAt(settingsPlayer, 440), 248);
    assert.equal(settingsPlayer.style.width, '360px', 'temporary measurement width is restored');
  }
});

test('entering settings recalculates dimensions after its form becomes visible', () => {
  const calls = [], settingsPlayer = {hidden: true};
  const context = {settingsPlayer, view: 'settings', ia: null, getModuleEditorActive: () => false,
    renderAppearance() {}, renderSettingsConnections() {}, update() {calls.push(settingsPlayer.hidden);}};
  const functions = functionSection('  function renderSettings() {', '  function renderSettingsConnections()');
  vm.runInNewContext(`${functions}\nthis.render = renderSettings;`, context);
  context.render(); assert.deepEqual(calls, [false]);
  context.view = 'music'; context.render();
  assert.equal(settingsPlayer.hidden, true); assert.deepEqual(calls, [false]);
});
