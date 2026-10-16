(function(root,factory){
  'use strict';
  const api=factory(root);
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.NOTCH_TOKENS=api;
})(typeof window==='object'?window:null,function(root){
  'use strict';
  const OPEN_SURFACE_SCALE = 1.35;
  const ISLAND_CONFIG = Object.freeze({
    states: Object.freeze({
      rest: Object.freeze({width: 128, height: 10, radius: 6}),
      compact: Object.freeze({width: 240, height: 40, radius: 10}),
      expanded: Object.freeze({width: 440 * OPEN_SURFACE_SCALE, height: 240 * OPEN_SURFACE_SCALE, radius: 14}),
    }),
    spring: Object.freeze({stiffness: 400, damping: 30, mass: 1,
      easing: 'linear(0, 0.0702, 0.2262, 0.4081, 0.5808, 0.7266, 0.8394, 0.9202, 0.9736, 1.0056, 1.022, 1.0279, 1.0276, 1.0239, 1.0189, 1.0138, 1.0093, 1.0057, 1.0031, 1.0013, 1.0001, 0.9995, 0.9992, 0.9992, 1)'}),
    durations: Object.freeze({surface: 500, contentEnter: 300, contentExit: 150, contentSpring: 500, navigation: 400, color: 200, progress: 250, reduced: 150}),
    delays: Object.freeze({content: 80, hover: 120, leave: 280}),
    accents: Object.freeze({music: '#F28B96', focus: '#6fe3c4', tasks: '#A6E3B4'}),
    activities: Object.freeze({widths: Object.freeze([240, 300, 360]), height: 42, radius: 6, shoulder: 8, peekScale: 1, sceneHeight: 324, expandedHeight: 324, headerTop: 8, headerHeight: 32, sceneTop: 48, side: 16, bottom: 16, gap: 8}),
    notification: Object.freeze({width: 300, height: 72, radius: 8, shoulder: 8, duration: 2200}),
    confirmation: Object.freeze({width: 220, height: 38, radius: 19, shoulder: 0}),
    completion: Object.freeze({surfaceVelocity: 120}),
    rest: Object.freeze({marker: 4, handleWidth: 28, handleHeight: 2, progressLeft: 14, progressWidth: 70, equalizerBars: 4, equalizerWidth: 2, equalizerHeight: 6, equalizerGap: 2, equalizerInset: 18}),
    welcome: Object.freeze({introWidth: 300, introHeight: 88, introRadius: 14, width: 380, height: 232, radius: 14}),
    compact: Object.freeze({coverSize: 20, coverRadius: 6, equalizerBars: 4, equalizerWidth: 3, equalizerHeight: 14,
      equalizerMinScale: .28, equalizerDuration: 900, equalizerDelays: Object.freeze([0, -150, -300, -600])}),
    expanded: Object.freeze({playSize: 40, navigationSize: 6, navigationActiveWidth: 18}),
    formats: Object.freeze({compact: 400 * OPEN_SURFACE_SCALE, balanced: 420 * OPEN_SURFACE_SCALE, comfortable: 440 * OPEN_SURFACE_SCALE}),
    layout: Object.freeze({header: 48, side: 16, bottom: 16, footer: 32, gap: 8, columns: 4, rows: 4}),
    shadow: '0 18px 40px -16px rgba(0,0,0,.45)',
  });

  const welcomeMotion=Object.freeze({entrance: 300, mascot: 420, wordmark: 360, slide: 360, exit: 180, reduced: 150, introStart: 120, introEnd: 1900, wakeAt: 300, wake: 220, curiousAt: 560, look: 220, nameAt: 780, returnAt: 1180, settle: 400, gazeX: 2, gazeY: -.5, tilt: 3, revealY:6, wordmarkX:8, wakeTilt:-2, settleY:1.5, settleTilt:1.5, easing: ISLAND_CONFIG.spring.easing});
  const palette=Object.freeze({white:'#ffffff',robotAccent:'#6FE3C5',artworkFallback:Object.freeze({base:'#202024',highlight:'#38383e',shadow:'#0a0a0d'})});
  const activity=Object.freeze({focus:'#6fe3c4',break:'#5ac8fa',long:'#bf8bff',transfer:'#8ac8ff',music:'#f28b96',tasks:'#a6e3b4',weather:'#7aa7ff',shelf:'#ffd60a'});
  const status=Object.freeze({success:'#56df86',warning:'#f0b45c',error:'#ff6b75',idle:'#b6b8c4'});
  const dur=Object.freeze({instant:120,fast:200,base:300,spring:500,exit:150,reduced:150,progress:250,card:280,check:350});
  const ease=Object.freeze({standard:'cubic-bezier(.4,0,.2,1)',out:'cubic-bezier(.2,.8,.2,1)',spring:ISLAND_CONFIG.spring.easing,island:ISLAND_CONFIG.spring.easing,progress:'linear',digits:'cubic-bezier(.22,1,.36,1)',track:'cubic-bezier(.32,.72,0,1)'});
  const stagger=Object.freeze({enter:80,step:60});
  // Compatibility dimensions keep the existing module sizing contract unchanged.
  const modules=Object.freeze({
    layouts:Object.freeze({
      music:Object.freeze({minWidth:300,basis:360,maxWidth:440,height:176,panelWidth:440}),
      focus:Object.freeze({minWidth:320,basis:360,maxWidth:420,height:264,panelWidth:404}),
      tasks:Object.freeze({minWidth:160,basis:320,maxWidth:440,height:222,panelWidth:440}),
      weather:Object.freeze({minWidth:288,basis:320,maxWidth:384,height:208,panelWidth:424}),
      shelf:Object.freeze({minWidth:300,basis:360,maxWidth:480,height:208,panelWidth:560}),
    }),
    minimum:Object.freeze({music:Object.freeze([160,154]),focus:Object.freeze([320,244]),tasks:Object.freeze([160,164]),shelf:Object.freeze([160,148]),weather:Object.freeze([168,164])}),
    metrics:Object.freeze({detailInset:30,detailMax:300,focusMax:420,editorInset:24,focusEditorHeight:180,musicGrow:1.3}),
  });
  const frames=value=>Object.freeze(value.map(frame=>Object.freeze(frame)));
  const motion=Object.freeze({
    content:Object.freeze({clearFilter:'blur(0px)',exitFilter:'blur(10px)',clearTransform:'translateY(0px) scale(1)',compactExit:'translateY(5px) scale(.9)',expandedExit:'translateY(20px) scale(.95)'}),
    reveal:frames([{opacity:.55,translate:'0 3px'},{opacity:1,translate:'0 0'}]),
    sceneFrom:Object.freeze({opacity:.88,translate:'8px 0px'}),sceneTo:Object.freeze({opacity:1,translate:'0px 0px'}),
    iconIn:frames([{opacity:0,transform:'rotate(45deg) scale(.5)'},{opacity:1,transform:'rotate(0deg) scale(1)'}]),
    iconOut:frames([{opacity:1,transform:'rotate(0deg) scale(1)'},{opacity:0,transform:'rotate(-45deg) scale(.5)'}]),
    trackCopy:frames([{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-16px)'}]),
    trackArt:frames([{opacity:1,transform:'scale(1)'},{opacity:0,transform:'scale(.85)'}]),
    completion:frames([{transform:'scale(.98)',opacity:0},{transform:'scale(1)',opacity:1}]),
    ringPulse:frames([{transform:'scale(1)'},{transform:'scale(1.035)',offset:.3},{transform:'scale(1)'}]),
    digitIn:frames([{transform:'translateY(-65%)',opacity:0},{transform:'translateY(0)',opacity:1}]),
    digitOut:frames([{transform:'translateY(0)',opacity:1},{transform:'translateY(65%)',opacity:0}]),
  });
  const css=name=>{
    if(typeof name!=='string'||!/^--[a-z][a-z0-9-]*$/.test(name))return '';
    return root?.document?.documentElement&&root.getComputedStyle?root.getComputedStyle(root.document.documentElement).getPropertyValue(name).trim():'';
  };
  return Object.freeze({activity,status,dur,ease,stagger,css,palette,welcomeMotion,motion,modules,island:ISLAND_CONFIG});
});
