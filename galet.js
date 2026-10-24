(function (root) {
  'use strict';
  const Renderer=root.NotchyMimoRenderer || (typeof module==='object'&&module.exports?require('./mimo-renderer.js'):null);
  const DEFINITIONS=Object.freeze([
    ['idle','Repos'],['greet','Salue'],['focus','Focus en cours'],['session-finished','Session terminée'],
    ['break','Pause'],['task-finished','Tâche terminée'],['cycle-complete','Cycle complet'],
    ['share-request','Demande de partage'],['receiving','Réception en cours'],['received','Fichier reçu'],
    ['question','Question'],['error','Erreur'],['trade-win','Trade gagnant'],['economic-alert','Annonce éco imminente'],
    ['airpods','AirPods connectés'],['dizzy','Trop de clics'],['sleeping','Veille'],['yawn','Bâille'],
    ['working','Travaille'],['finished','Terminé'],['thinking','Réfléchit'],['searching','Cherche'],
    ['approval','Attend ton feu vert'],['ratelimit','Limite atteinte'],['reading','Lecture'],
    ['gain','Gain'],['loss','Perte'],['news','Actualités'],['coding','Code']
  ].map(([id,label])=>Object.freeze({id,label})));
  const BY_ID=Object.fromEntries(DEFINITIONS.map(value=>[value.id,value]));
  const VARIANTS=Object.freeze(Object.fromEntries([
    ['default','Neutre',null],['focus','Focus','#FF7A45'],['music','Musique','#F08A9A'],
    ['shelf','Étagère','#FF9F1C'],['sharing','Partage','#86B7FF'],['weather','Météo','#9DB8D9'],
    ['search','Recherche','#66CFE5'],['market','Market','#FFAB6E']
  ].map(([id,label,color])=>[id,Object.freeze({id,label,color,tint:color ? .72 : 0})])));
  const NEUTRAL=new Set(['idle','greet','yawn','sleeping']);
  // Existing Notchy event names use the supplied Canvas engine, never a second drawing implementation.
  const ALIASES={
    greet:{state:'idle',eye:'happy',emote:'happy'},
    focus:{state:'working',col:'#FF7A45',badge:['dots','#FF7A45']},
    'session-finished':{state:'finished'},break:{state:'sleeping',col:'#86B7FF',tint:.72},
    'task-finished':{state:'finished'},'cycle-complete':{state:'finished',emote:'proud'},
    'share-request':{state:'approval'},receiving:{state:'working'},
    received:{state:'finished',emote:'surprised'},'trade-win':{state:'finished',emote:'love'},
    'economic-alert':{state:'approval'},airpods:{state:'idle',col:'#86B7FF',tint:.72,eye:'wink',badge:null,emote:'wink'},
    yawn:{state:'idle',eye:'tired',emote:'yawn'}
  };
  const EMOTES=Object.freeze({love:'love',surprised:'surprised',proud:'proud',wink:'wink',yawn:'yawn',happy:'happy',greet:'happy'});
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const rgb=color=>color.match(/[a-f\d]{2}/gi).map(value=>parseInt(value,16));
  const out=t=>1-Math.pow(1-t,3),inOut=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
  function validate(id){if(typeof id!=='string'||!Object.hasOwn(BY_ID,id))throw new RangeError('Réaction Galet inconnue : '+String(id));}
  function validateVariant(id){if(typeof id!=='string'||!Object.hasOwn(VARIANTS,id))throw new RangeError('Variante Galet inconnue : '+String(id));}

  function create(host,{active=true,motion=true,scope,variant='default'}={}){
    validateVariant(variant);
    const document=host?.ownerDocument,window=document?.defaultView;
    if(!host||!document?.createElement||!window?.requestAnimationFrame||!Renderer?.create)throw new TypeError('Galet nécessite un élément hôte dans une fenêtre.');
    scope||=document;
    if(typeof scope.addEventListener!=='function')throw new TypeError('Le scope Galet doit recevoir des événements.');
    const now=()=>window.performance?.now?.()??Date.now(),reducedQuery=window.matchMedia('(prefers-reduced-motion: reduce)');
    const canvas=document.createElement('canvas');canvas.className='notchy-galet-mark';canvas.setAttribute('role','img');
    const bot=Renderer.create(canvas,{now,schedule:window.setTimeout.bind(window),cancel:window.clearTimeout.bind(window),dpr:window.devicePixelRatio||1});
    if(!bot.x)throw new TypeError('Le rendu Mimo nécessite un contexte Canvas 2D.');
    const state={current:'idle',idle:null,transient:null,emote:null,enabled:!!active,motion,variant,visible:false,
      disposed:false,intersection:true,frame:0,timers:new Map(),clicks:[],look:{x:0,y:0},
      pointer:{x:0,y:0,time:-Infinity},lastActivity:now(),lastScheduled:0};
    const listeners=[];let intersection=null,resize=null,mutation=null;
    const listen=(target,event,callback,options)=>{target.addEventListener(event,callback,options);listeners.push(()=>target.removeEventListener(event,callback,options));};
    const motionEnabled=()=>(typeof state.motion==='function'?state.motion():state.motion)!==false;
    const visibleId=()=>state.transient?.id||state.idle||state.current;
    const allowed=()=>state.visible&&!state.disposed&&!reducedQuery.matches;
    const baseAnim=bot.anim.bind(bot),baseRoll=bot.roll.bind(bot),baseEmit=bot.emit.bind(bot);
    bot.anim=(property,...args)=>{if(reducedQuery.matches||(!motionEnabled()&&(property==='ox'||property==='roll')))return;baseAnim(property,...args);};
    bot.roll=(...args)=>{if(motionEnabled()&&!reducedQuery.matches)baseRoll(...args);};
    bot.emit=(...args)=>{if(!reducedQuery.matches)baseEmit(...args);};

    function cancelTimer(key){const timer=state.timers.get(key);if(timer!==undefined)window.clearTimeout(timer);state.timers.delete(key);}
    function later(key,callback,delay){
      cancelTimer(key);if(!state.visible)return;
      state.timers.set(key,window.setTimeout(()=>{state.timers.delete(key);if(!state.disposed&&state.visible)callback();},delay));
    }
    function cancelReactionCallbacks(){
      bot.cancelPending();
      bot._bk=bot.badge?[bot.badge,bot.badgeCol].join():'none';
    }
    function clearTransient(){
      const interrupted=!!(state.transient||state.emote);
      for(const key of ['emote','dizzy','idle-return'])cancelTimer(key);
      state.transient=state.emote=null;bot.eyeOv=null;bot.ovUntil=0;
      if(interrupted)cancelReactionCallbacks();
      return interrupted;
    }
    function stopFrame(){if(state.frame)window.cancelAnimationFrame(state.frame);state.frame=0;}
    function queueFrame(){if(!state.frame&&allowed())state.frame=window.requestAnimationFrame(tick);}
    function config(id){
      const alias=ALIASES[id],canonical=alias?.state||id;
      let cfg=Renderer.STATES[canonical];
      if(alias){const {state:ignored,emote:unused,...changes}=alias;cfg={...cfg,...changes};}
      if(NEUTRAL.has(id)&&state.variant!=='default')cfg={...cfg,col:VARIANTS[state.variant].color,tint:VARIANTS[state.variant].tint};
      return {canonical,cfg,emote:alias?.emote};
    }
    function settle(){
      bot.cancelPending();bot.tw=[];bot.lock={};bot.parts=[];
      const cfg=bot.cfg;
      Object.assign(bot.s,{yaw:0,pitch:0,roll:0,tilt:cfg.tilt||0,open:1,sx:1,sy:1,oy:0,ox:0,tint:cfg.tint,blush:0,es:1,badgeS:1});
      Object.assign(bot.tg,bot.s);bot.col=bot.colT.slice();
      bot.badge=cfg.badge?.[0]||null;bot.badgeCol=cfg.badge?.[1]||'#fff';bot._bk=cfg.badge?cfg.badge.join():'none';
    }
    function render(replay=false){
      if(state.disposed)return;
      const id=visibleId(),next=config(id);
      if(replay||bot.state!==next.canonical)bot.setState(next.canonical,replay);
      bot.cfg=next.cfg;bot.colT=rgb(next.cfg.col);bot.tg.tint=next.cfg.tint;bot.tg.tilt=next.cfg.tilt||0;bot.setBadge(next.cfg.badge);
      if(replay&&next.emote&&allowed())bot.emote(next.emote,2000);
      if(!state.visible||reducedQuery.matches)settle();
      canvas.setAttribute('aria-label','Mimo : '+BY_ID[id].label);canvas.dataset.reaction=id;
      host.dataset.galetState=id;host.dataset.galetActive=String(state.visible);host.dataset.galetReduced=String(reducedQuery.matches);host.dataset.galetVariant=state.variant;
      bot.draw();queueFrame();
    }
    function tick(){
      state.frame=0;if(!visibleNow()||!allowed()){refresh();return;}
      const time=now(),t=time/1000;
      if(time-state.pointer.time<2600){
        const r=canvas.getBoundingClientRect();
        state.look.x=clamp((state.pointer.x-r.left-r.width/2)/260,-1,1);
        state.look.y=clamp((state.pointer.y-r.top-r.height/2)/260,-1,1);
      }else{
        const seed=.3,g=.5+.5*Math.sin(t*.23+seed);
        state.look.x=Math.sin(t*.41+seed)*.55*g;state.look.y=Math.sin(t*.33+seed*1.9)*.3*g;
      }
      bot.look.x=state.look.x;bot.look.y=state.look.y;bot.update();bot.draw();queueFrame();
    }
    function visibleNow(){
      if(state.disposed||!state.enabled||document.hidden||!state.intersection||!host.isConnected||host.closest?.('[hidden],[inert]'))return false;
      const style=window.getComputedStyle(host),b=host.getBoundingClientRect();
      return style.display!=='none'&&style.visibility!=='hidden'&&style.visibility!=='collapse'&&b.width>0&&b.height>0&&b.bottom>0&&b.right>0&&b.top<window.innerHeight&&b.left<window.innerWidth;
    }
    function scheduleIdle(){
      cancelTimer('idle-yawn');cancelTimer('idle-sleep');if(!state.visible||state.current!=='idle')return;
      const idleFor=Math.max(0,now()-state.lastActivity);
      later('idle-yawn',()=>{if(state.current!=='idle'||state.transient||state.emote)return;state.idle='yawn';render(true);later('idle-return',()=>{if(state.idle==='yawn'){state.idle=null;render();}},2000);},Math.max(0,300000-idleFor));
      later('idle-sleep',()=>{if(state.current==='idle'){clearTransient();state.idle='sleeping';render(true);}},Math.max(0,600000-idleFor));
    }
    function activity(){
      const time=now();state.lastActivity=time;
      if(state.idle){state.idle=null;cancelTimer('idle-return');render();}
      if(time-state.lastScheduled>1000){state.lastScheduled=time;scheduleIdle();}
    }
    function setState(id){
      if(state.disposed)return;validate(id);if(state.current===id&&!state.transient&&!state.idle)return;
      clearTransient();state.current=id;state.idle=null;state.clicks=[];render(true);scheduleIdle();
    }
    function emote(id){
      if(state.disposed)return;
      if(typeof id!=='string'||!Object.hasOwn(EMOTES,id))throw new RangeError('Émote Galet inconnue : '+String(id));
      if(!state.visible)return;
      if(state.emote){cancelReactionCallbacks();bot.setBadge(bot.cfg.badge);}
      cancelTimer('emote');state.emote={id,until:now()+2000};
      if(reducedQuery.matches){bot.eyeOv=Renderer.EMOTES[EMOTES[id]].eye;bot.ovUntil=now()+2000;bot.draw();}
      else{bot.emote(EMOTES[id],2000);queueFrame();}
      later('emote',()=>{state.emote=null;bot.eyeOv=null;bot.ovUntil=0;bot.draw();queueFrame();},2000);
    }
    function refresh(){
      if(state.disposed)return;const next=visibleNow();
      if(next===state.visible){if(allowed())queueFrame();else stopFrame();return;}
      state.visible=next;
      if(!next){
        stopFrame();const interrupted=clearTransient();cancelTimer('idle-yawn');cancelTimer('idle-sleep');
        if(interrupted)render();
        bot.pauseScheduled();state.look.x=state.look.y=0;state.clicks=[];host.dataset.galetActive='false';
      }
      else{bot.last=now();bot.resumeScheduled();host.dataset.galetActive='true';if(reducedQuery.matches){settle();bot.draw();}else queueFrame();}
      scheduleIdle();
    }
    function setActive(value){if(!state.disposed){state.enabled=!!value;refresh();}}
    function setMotion(value){
      if(state.disposed)return;state.motion=value;
      if(!motionEnabled()){bot.tw=bot.tw.filter(t=>t.p!=='roll'&&t.p!=='ox');delete bot.lock.roll;delete bot.lock.ox;bot.s.roll=bot.tg.roll=bot.s.ox=bot.tg.ox=0;}
      bot.draw();queueFrame();
    }
    function setVariant(value){
      if(state.disposed)return false;validateVariant(value);if(state.variant===value)return false;
      state.variant=value;const next=config(visibleId());bot.cfg=next.cfg;bot.colT=rgb(next.cfg.col);bot.tg.tint=next.cfg.tint;
      if(!state.visible||reducedQuery.matches){bot.col=bot.colT.slice();bot.s.tint=bot.tg.tint;}
      host.dataset.galetVariant=value;bot.draw();queueFrame();return true;
    }
    function pointer(event){
      if(!state.visible||event.pointerType==='touch'||!Number.isFinite(event.clientX)||!Number.isFinite(event.clientY))return;
      state.pointer={x:event.clientX,y:event.clientY,time:now()};activity();queueFrame();
    }
    function click(){
      if(!state.visible)return;activity();const time=now();state.clicks=state.clicks.filter(v=>time-v<=2000);state.clicks.push(time);
      if(state.clicks.length<4){
        bot.anim('sy',[[motionEnabled()?.78:.92,70,out],[motionEnabled()?1.1:1.04,130,out],[1,170,inOut]]);
        bot.anim('sx',[[motionEnabled()?1.16:1.06,70,out],[motionEnabled()?.95:.98,130,out],[1,170,inOut]]);queueFrame();return;
      }
      clearTransient();state.clicks=[];state.transient={id:'dizzy',until:time+2600};render(true);later('dizzy',()=>{state.transient=null;render(true);},2600);
    }
    function inspect(){
      return {state:state.current,variant:state.variant,visible:visibleId(),expression:bot.eyeOv||bot.cfg.eye,emote:state.emote?{...state.emote}:null,
        active:state.visible,enabled:state.enabled,drawn:!!canvas,motionEnabled:motionEnabled(),reduced:reducedQuery.matches,disposed:state.disposed,
        animating:!!state.frame,rafActive:!!state.frame,eyeFadeActive:false,pendingTimers:[...state.timers.keys()],
        motion:{state:visibleId(),canonical:bot.state,expression:bot.eyeOv||bot.cfg.eye,s:{...bot.s},color:bot.col.slice(),targetColor:bot.colT.slice(),badge:bot.badge,badgeColor:bot.badgeCol,
          config:{...bot.cfg,badge:bot.cfg.badge?.slice()||null},tweens:bot.tw.map(t=>t.p),jobs:bot.pendingCount(),parts:bot.parts.length,active:allowed()},
        look:{...state.look},clickCount:state.clicks.length};
    }
    function dispose(){
      if(state.disposed)return;state.disposed=true;stopFrame();bot.dispose();
      for(const timer of state.timers.values())window.clearTimeout(timer);state.timers.clear();
      for(const unlisten of listeners)unlisten();intersection?.disconnect();mutation?.disconnect();resize?.disconnect();
      canvas.remove();host.classList.remove('notchy-galet');for(const key of ['galetState','galetActive','galetReduced','galetVariant'])delete host.dataset[key];
    }
    host.classList.add('notchy-galet');host.replaceChildren(canvas);render();
    listen(scope,'pointermove',pointer,{passive:true});listen(scope,'keydown',activity);listen(host,'click',click);
    listen(document,'visibilitychange',refresh);listen(window,'resize',refresh);
    listen(reducedQuery,'change',()=>{stopFrame();host.dataset.galetReduced=String(reducedQuery.matches);if(reducedQuery.matches)settle();bot.draw();queueFrame();});
    intersection=typeof window.IntersectionObserver==='function'?new window.IntersectionObserver(entries=>{state.intersection=entries.at(-1)?.isIntersecting!==false;refresh();}):null;intersection?.observe(host);
    resize=typeof window.ResizeObserver==='function'?new window.ResizeObserver(refresh):null;resize?.observe(host);
    mutation=typeof window.MutationObserver==='function'?new window.MutationObserver(refresh):null;
    if(mutation)for(let element=host;element;element=element.parentElement)mutation.observe(element,{attributes:true,attributeFilter:['hidden','inert','style','class']});
    refresh();return Object.freeze({setState,emote,setActive,setMotion,setVariant,lookAt:pointer,refresh,dispose,inspect});
  }
  const api=Object.freeze({create,variants:VARIANTS,states:Object.freeze(DEFINITIONS.map(v=>v.id))});
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.NotchyGalet=api;
})(typeof window!=='undefined'?window:globalThis);
