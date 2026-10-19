(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports) module.exports=factory(require('./duration-core.js'),require('./focus.js'));
  if(root?.document){const api=factory(root.NotchyDurationCore,root.NotchyFocus);root.NotchyDurationIntegration=api;root.NotchyFocus=Object.freeze({...root.NotchyFocus,create:api.create,createTasks:api.createTasks});}
})(typeof window==='object'?window:null,function(Core,Legacy){
  'use strict';
  const KEY='notchy-minimal-focus-v1',copy=value=>JSON.parse(JSON.stringify(value));
  function configuration(value={}){const s=Legacy.focusConfiguration(value);return {work:s.work,rest:s.rest,longRest:s.longRest,interval:s.total};}
  function durationForCycles(count,s){let total=0;for(let i=1;i<=count;i++){total+=s.work;if(i<count)total+=i%s.interval===0?s.longRest:s.rest;}return Math.min(Core.LIMITS.minutes,total);}
  function migrate(saved,now=Date.now()){
    if(saved?.durationModule?.version===1)return Core.normalize(saved.durationModule);
    const next=Core.fresh(),config=configuration(saved?.settings),model=Legacy.FocusModel.restore({...Legacy.FocusModel.defaults(),...saved?.state},now);next.settings=config;
    next.tasks=model.tasks.map(task=>({id:task.id,title:task.title,totalMinutes:durationForCycles(task.estimatedCycles||1,config),settings:{...config},elapsedMs:0,done:task.done,...(task.completedCycles>0?{earnedCycles:task.completedCycles}:{})}));
    const active=!!(model.sessionActive||model.deadline)&&!model.pomodoro?.finished;
    next.activeId=next.tasks.find(task=>task.id===model.activeTaskId&&!task.done)?.id||next.tasks.find(task=>!task.done)?.id||null;
    if(active){
      let task=next.tasks.find(t=>t.id===model.activeTaskId&&!t.done);
      if(!task){task={id:'duration-free-session',title:model.task||'Focus libre',totalMinutes:config.work,settings:{...config},elapsedMs:0,done:false};next.tasks.push(task);}
      const cycle=model.pomodoro,settings=cycle?configuration({...cycle,total:cycle.total}):{...config,work:model.minutes};
      task.settings=settings;task.totalMinutes=durationForCycles(Math.max(cycle?.total||1,cycle?.session||1),settings)+(cycle?settings.longRest:0);
      const segments=Core.plan(task.totalMinutes,settings),segment=segments.find(item=>item.cycle===(cycle?.session||1)&&item.kind===(cycle?.phase==='break'?cycle.breakKind==='long'?'long':'short':'focus'))||segments[0];
      const remaining=model.deadline?model.deadline-now:Legacy.FocusModel.remaining(model,now)*1000;
      task.elapsedMs=Math.min(task.totalMinutes*60000,segment.startMs+Math.max(0,segment.durationMs-remaining));next.activeId=task.id;next.startedAt=model.deadline?now:null;
    }
    return Core.normalize(next);
  }
  function project(state,now=Date.now()){
    const task=state.tasks.find(t=>t.id===state.activeId),p=task?Core.phase(task):null,config=state.settings,model=Legacy.FocusModel.defaults();
    model.tasks=state.tasks.map(t=>({id:t.id,title:t.title,done:t.done,estimatedCycles:Core.phase(t).cycles,completedCycles:t.earnedCycles||0}));
    model.activeTaskId=task&&!task.done?task.id:null;model.task=task?.title||'';model.minutes=p?p.current.minutes:config.work;model.remaining=p?Math.ceil(p.remainingMs/1000):config.work*60;
    model.sessionActive=!!task&&!task.done&&!p.finished&&(state.startedAt!==null||task.elapsedMs>0);model.deadline=model.sessionActive&&state.startedAt!==null?now+p.remainingMs:null;model.complete=!!p?.finished;
    if(p)model.pomodoro={work:task.settings.work,rest:task.settings.rest,longRest:task.settings.longRest,total:p.cycles,session:p.current.cycle,phase:p.current.kind==='focus'?'work':'break',...(p.current.kind!=='focus'?{breakKind:p.current.kind==='long'?'long':'short'}:{}),...(p.finished?{finished:true}:{})};
    return {state:model,settings:{work:config.work,rest:config.rest,longRest:config.longRest,total:config.interval}};
  }
  function persistence(win){
    let original=null;const invoke=win.NotchyIA?.invokeCore,native=typeof win.__TAURI__?.core?.invoke==='function'||typeof win.__TAURI__?.invoke==='function';
    return {
      async load(){
        const snapshot=native?await invoke('settings_get',{}):null;
        if(native&&(!snapshot||typeof snapshot!=='object'))throw Error('Cannot load native Focus preferences');
        const text=native?(Object.hasOwn(snapshot,KEY)?JSON.stringify(snapshot[KEY]):null):win.localStorage.getItem(KEY);
        if(text!==null&&text!==undefined&&(typeof text!=='string'||new TextEncoder().encode(text).length>262144))throw Error('Existing task profile exceeds its storage cap');
        original=text?JSON.parse(text):null;
        if(original!==null&&(!original||typeof original!=='object'||Array.isArray(original)))throw Error('Invalid existing task data');
        return JSON.stringify(migrate(original));
      },
      async save(encoded){
        const duration=Core.normalize(JSON.parse(encoded)),legacy=project(duration),envelope={...legacy,durationModule:duration,...(original?{legacyBackup:original.legacyBackup||original}:{} )};
        if(new TextEncoder().encode(JSON.stringify(envelope)).length>262144)throw Error('Task profile exceeds its existing storage cap');
        if(native){const reply=await invoke('settings_set',{patch:{[KEY]:envelope}});const acknowledged=Core.normalize(reply?.[KEY]?.durationModule);if(JSON.stringify(acknowledged)!==JSON.stringify(duration))throw Error('Native task save was not acknowledged');}
        else win.localStorage.setItem(KEY,JSON.stringify(envelope));
      }
    };
  }
  function presentationForPlacement({width,height}={}){
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return null;
    if(width<240)return 'quarter';
    return height<155?'half':height<210?'details':'full';
  }
  function resizeView(host,component){
    const width=host.clientWidth,height=host.clientHeight;if(!width||!height)return;
    const current=component.inspect();
    if(!['settings','create-title','create-duration','pomodoro'].includes(current.view)){
      const size=current.view==='tasks'&&height<155?'quarter':presentationForPlacement({presentation:host.dataset.presentation,width,height});
      if(size&&current.size!==size)component.setPresentation(size);
    }
    component.fit();
  }
  function elapsedPhaseEvent(previous,current,now){
    if(!previous||previous.startedAt===null||previous.activeId!==current.activeId)return null;
    const before=previous.tasks.find(task=>task.id===previous.activeId),after=current.tasks.find(task=>task.id===current.activeId);
    if(!before||!after||before.done||after.done)return null;
    const first=Core.phase(before),last=Core.phase(after);
    if(first.finished||first.index===last.index&&first.finished===last.finished)return null;
    // A persisted settle may already have stopped the clock. Derive the boundary
    // from real elapsed time so that manual skips and restarts stay silent.
    const expected=Core.phase(Core.materialize(previous,now).tasks.find(task=>task.id===current.activeId));
    if(expected.index!==last.index||expected.finished!==last.finished)return null;
    return {kind:last.finished?'complete':'phase',title:last.finished?'Session terminée':last.current.kind==='focus'?'Concentration':'Pause',detail:after.title};
  }
  function create(options={}){
    const host=options.host,win=host.ownerDocument.defaultView,doc=host.ownerDocument;
    const store=Core.createStore(persistence(win)),views=new Set(),mount=doc.createElement('div');mount.className='duration-mount';host.append(mount);host.dataset.durationModule='true';
    let disposed=false,loaded=false,enabled=true,emitting=false,routeLeaving=false,tick=null,previousObservation=null;
    const editing=new Set(),viewStates=new Map();
    function editView(kind,view){
      const deep=['settings','create-title','create-duration'].includes(view),wasOpen=editing.has(kind),previous=viewStates.get(kind);viewStates.set(kind,view);
      if(deep)editing.add(kind);else editing.delete(kind);
      host.dataset.focusConfig=String(editing.size>0);
      if(routeLeaving)return;
      if(deep&&!wasOpen||view==='pomodoro'&&previous!=='pomodoro'){if(options.openDuration)options.openDuration(kind);else options.openConfiguration?.();}
      if(!deep&&wasOpen&&!editing.size)options.closeConfiguration?.();
    }
    function leaveView(kind,component){routeLeaving=true;try{component.cancelEdit();editView(kind,'timer');}finally{routeLeaving=false;}}
    let initial=Core.fresh();try{initial=migrate(JSON.parse(win.localStorage.getItem(KEY)||'null'));}catch{}
    const state=()=>loaded?store.snapshot():copy(initial),locale=()=>win.NotchyI18n?.locale()||'fr';
    let renderedLanguage=locale();
    const component=win.NotchyDuration.mount(mount,{store,embedded:true,view:'tasks',language:renderedLanguage,onViewChange({view}){editView('focus',view);resize();}});views.add(component);
    function summary(){const value=project(state());return Legacy.focusCardValues(value.state,value.settings,Date.now(),source=>win.NotchyI18n?.t(source)||source);}
    function emit(){if(!loaded||disposed||emitting)return;emitting=true;try{const current=state(),value=project(current),card=Legacy.focusCardValues(value.state,value.settings),event=elapsedPhaseEvent(previousObservation,current,Date.now());host.dataset.durationEmpty=String(!current.tasks.length);previousObservation=current;options.changed?.({...value,card,event});}finally{emitting=false;}}
    function resize(){if(!disposed&&loaded)resizeView(host,component);}
    const observer=new win.ResizeObserver(resize);observer.observe(host);
    const unsubscribe=store.subscribe(()=>{resize();emit();});const languageUnsubscribe=win.NotchyI18n?.onChange(()=>{const language=locale();if(language===renderedLanguage)return;renderedLanguage=language;for(const view of views)view.setLanguage(language);});
    const ready=store.ready.then(async()=>{loaded=true;await component.ready;const saved=store.snapshot(),active=saved.tasks.find(task=>task.id===saved.activeId&&!task.done);if(active&&(saved.startedAt!==null||active.elapsedMs>0))await component.showTimer();resize();win.setTimeout(emit,0);tick=win.setInterval(emit,1000);return true;}).catch(error=>{console.error('Duration module:',error);return false;});
    const run=operation=>{void ready.then(ok=>ok&&operation()).catch(error=>console.error('Duration operation:',error));return true;};
    function command(value){
      if(['prepare','configure','pause-edit'].includes(value))return run(()=>component.showSettings());
      if(value==='back')return run(()=>component.showTimer());
      if(value==='link-task')return run(()=>component.showTasks());
      return run(async()=>{let s=store.snapshot(),task=s.tasks.find(t=>t.id===s.activeId&&!t.done)||s.tasks.find(t=>!t.done);
        if(!task){component.startCreate();return;}
        if(['start','toggle','pause'].includes(value)){if(value==='pause'&&s.startedAt===null||value==='start'&&s.startedAt!==null&&s.activeId===task.id)return;await store.toggleTimer(task.id);if(value!=='pause')await component.showTimer();}
        else if(value==='stop')await store.restart(task.id);
        else if(value==='skip')await store.skip(task.id);
        else if(value==='complete-task')await store.complete(task.id);
      });
    }
    const controller=Object.freeze({durationStore:store,ready,component,views,editView,leaveView,
      getState:()=>project(state()).state,getSettings:()=>project(state()).settings,summary,
      command,tasks(action){return run(async()=>{if(['toggle','confirm-complete'].includes(action.type))await store.complete(action.id);else if(action.type==='select')await store.select(action.id);else if(action.type==='delete')await store.remove(action.id);else if(action.type==='add')await store.add(action.title,state().settings.work);});},
      leaveRoute(){leaveView('focus',component);},render:resize,preview:summary,setPage(){},lifecycle(value={}){enabled=value.enabled!==false;resize();},
      inspect:()=>({replacement:'duration-module',active:summary().active,running:state().startedAt!==null,seconds:summary().seconds,configOpen:editing.size>0,taskPickerOpen:false,timerActive:!!tick&&enabled,disposed,loaded}),
      dispose(){if(disposed)return;disposed=true;observer.disconnect();unsubscribe();languageUnsubscribe?.();win.clearInterval(tick);for(const view of views)view.dispose();store.dispose();mount.remove();}
    });
    win.notchyDuration=controller;return controller;
  }
  function createTasks({host,focus}={}){
    if(!host?.ownerDocument||!focus?.durationStore)throw new TypeError('A task host and shared Focus store are required');
    const doc=host.ownerDocument,win=doc.defaultView,mount=doc.createElement('div');mount.className='duration-mount';host.append(mount);host.dataset.durationModule='true';
    let disposed=false,loaded=false;
    const component=win.NotchyDuration.mount(mount,{store:focus.durationStore,embedded:true,view:'tasks',language:win.NotchyI18n?.locale()||'fr',onViewChange({view}){focus.editView('tasks',view);render();}});
    focus.views.add(component);
    function render(){if(!disposed&&loaded)resizeView(host,component);}
    const observer=new win.ResizeObserver(render);observer.observe(host);
    const ready=focus.ready.then(async ok=>{if(!ok||disposed)return false;await component.ready;loaded=true;render();return true;});
    return Object.freeze({ready,component,render,focusInput(){void ready.then(ok=>ok&&component.startCreate());},leaveRoute(){focus.leaveView('tasks',component);},inspect:()=>({unified:true,loaded,disposed,...component.inspect()}),dispose(){if(disposed)return;disposed=true;observer.disconnect();focus.views.delete(component);focus.leaveView('tasks',component);component.dispose();mount.remove();}});
  }
  return Object.freeze({KEY,migrate,project,persistence,presentationForPlacement,create,createTasks});
});
