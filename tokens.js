(function(root,factory){
  'use strict';
  const api=factory(root);
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.NOTCH_TOKENS=api;
})(typeof window==='object'?window:null,function(root){
  'use strict';
  const ISLAND_CONFIG = Object.freeze({
    states: Object.freeze({
      rest: Object.freeze({width: 128, height: 10, radius: 6}),
      compact: Object.freeze({width: 240, height: 40, radius: 10}),
      expanded: Object.freeze({width: 844, height: 464, radius: 40}),
    }),
    spring: Object.freeze({stiffness: 400, damping: 30, mass: 1,
      easing: 'linear(0, 0.0702, 0.2262, 0.4081, 0.5808, 0.7266, 0.8394, 0.9202, 0.9736, 1.0056, 1.022, 1.0279, 1.0276, 1.0239, 1.0189, 1.0138, 1.0093, 1.0057, 1.0031, 1.0013, 1.0001, 0.9995, 0.9992, 0.9992, 1)'}),
    durations: Object.freeze({surface: 500, contentEnter: 300, contentExit: 150, contentSpring: 500, navigation: 400, color: 200, progress: 250, reduced: 150}),
    delays: Object.freeze({content: 80, hover: 120, leave: 280}),
    accents: Object.freeze({music: '#f08a9a', focus: '#ff7a45', tasks: '#ff7a45'}),
    activities: Object.freeze({widths: Object.freeze([240, 300, 360]), height: 42, radius: 6, shoulder: 8, peekScale: 1, sceneHeight: 464, fullHeight: 464, durationDetailHeight:496, expandedHeight: 464, headerTop: 16, headerHeight: 48, sceneTop: 80, side: 16, bottom: 16, gap: 16}),
    notification: Object.freeze({width: 300, height: 72, radius: 8, shoulder: 8, duration: 2200}),
    confirmation: Object.freeze({width: 220, height: 38, radius: 19, shoulder: 0}),
    focusPeek: Object.freeze({width: 360, height: 58, radius: 18, shoulder: 0, settleAfter: 1600, duration: 5200}),
    completion: Object.freeze({surfaceVelocity: 120}),
    rest: Object.freeze({marker: 4, handleWidth: 28, handleHeight: 2, progressLeft: 14, progressWidth: 70, equalizerBars: 4, equalizerWidth: 2, equalizerHeight: 6, equalizerGap: 2, equalizerInset: 18}),
    welcome: Object.freeze({introWidth: 460, introHeight: 128, introRadius: 38, width: 570, height: 350, radius: 38}),
    compact: Object.freeze({coverSize: 20, coverRadius: 6, equalizerBars: 4, equalizerWidth: 3, equalizerHeight: 14,
      equalizerMinScale: .28, equalizerDuration: 900, equalizerDelays: Object.freeze([0, -150, -300, -600])}),
    expanded: Object.freeze({playSize: 40, navigationSize: 6, navigationActiveWidth: 18}),
    formats: Object.freeze({compact: 844, balanced: 844, comfortable: 844}),
    displayScales: Object.freeze({compact: .7, balanced: .85, comfortable: 1}),
    compactPanel: Object.freeze({scale: .7, gap: 16}),
    layout: Object.freeze({header: 80, side: 16, bottom: 16, footer: 32, gap: 16, columns: 3, rows: 3}),
    shadow: '0 18px 40px -16px rgba(0,0,0,.45)',
  });

  const welcomeMotion=Object.freeze({entrance: 300, mascot: 420, wordmark: 360, slide: 360, exit: 180, reduced: 150, introStart: 200, introEnd: 3400, wakeAt: 300, wake: 220, curiousAt: 560, look: 220, nameAt: 780, returnAt: 1180, settle: 400, gazeX: 2, gazeY: -.5, tilt: 3, revealY:6, wordmarkX:8, wakeTilt:-2, settleY:1.5, settleTilt:1.5, easing: ISLAND_CONFIG.spring.easing});
  const palette=Object.freeze({white:'#ffffff',robotAccent:'#6ee7c4',artworkFallback:Object.freeze({base:'#202024',highlight:'#38383e',shadow:'#0a0a0d'})});
  const activity=Object.freeze({focus:'#ff7a45',break:'#86b7ff',long:'#86b7ff',transfer:'#86b7ff',music:'#f08a9a',tasks:'#ff7a45',weather:'#9db8d9',shelf:'#ff9f1c'});
  const status=Object.freeze({success:'#6ee7b7',warning:'#ff9f1c',error:'#f87171',idle:'#a1a1a6'});
  const dur=Object.freeze({instant:150,fast:200,base:350,spring:500,exit:150,reduced:150,progress:250,card:280,check:350});
  const ease=Object.freeze({standard:'cubic-bezier(.2,.8,.2,1)',out:'cubic-bezier(.2,.8,.2,1)',spring:ISLAND_CONFIG.spring.easing,island:ISLAND_CONFIG.spring.easing,progress:'linear',digits:'cubic-bezier(.22,1,.36,1)',track:'cubic-bezier(.32,.72,0,1)'});
  const stagger=Object.freeze({enter:80,step:80});
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
