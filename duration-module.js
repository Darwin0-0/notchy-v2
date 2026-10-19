(function (root) {
  'use strict';
  // Motion and reference geometry are intentionally adjustable in one place.
  const MOTION = Object.freeze({check: 130, strike: 310, strikeDelay: 110, settle: 70, reorder: 460, stagger: 56, split: 520, nudge: 10, easing: 'cubic-bezier(.32,.72,0,1)'});
  const SIZES = Object.freeze({quarter: {width: 220, height: 120, radius: 28}, half: {width: 440, height: 120, radius: 28}, details: {width: 440, height: 180, radius: 32}, full: {width: 440, height: 240, radius: 34}});
  const ACCENT = '#ff7a45';
  const RECOVERY_OWNERS = new WeakMap();
  const base = document.currentScript?.src ? new URL('.', document.currentScript.src).href : './';
  const PATHS = Object.freeze({plus:'M12 5v14M5 12h14',check:'M5 12.5l4.5 4.5L19 7.5',pencil:'M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1zM14.5 6.5l3 3',back:'M15 5l-7 7 7 7',down:'M6 9l6 6 6-6',up:'M6 15l6-6 6 6',reset:'M3 12a9 9 0 1 0 3-6.7M3 4v5h5',settings:'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',close:'M6 6l12 12M6 18L18 6'});
  const EN = Object.freeze({
    'Tâches':'Tasks','Nouvelle tâche':'New task','Aucune tâche':'No tasks','Tout est fait':'All done',
    'Elles seront découpées en sessions Pomodoro.':'They will be divided into Pomodoro sessions.',
    'Ajouter une tâche':'Add task','Titre de la tâche':'Task title','Valider le titre':'Confirm title','Retour':'Back',
    'Modifier la durée':'Edit duration','Valider la durée':'Confirm duration','Heures':'Hours','Minutes':'Minutes',
    'Annuler':'Cancel','Continuer':'Continue','Ajouter':'Add','Ajouter la tâche':'Add task','En cours':'In progress','En pause':'Paused','Enregistrer':'Save','Réglages Pomodoro':'Pomodoro settings',
    'Focus':'Focus','Pause':'Break','Pause longue':'Long break','Terminé':'Finished','Lancer le Pomodoro':'Start Pomodoro',
    'Mettre en pause':'Pause','Reprendre':'Resume','Recommencer':'Restart','Passer à l’étape suivante':'Skip to next phase',
    'Terminer la tâche':'Complete task','Rouvrir la tâche':'Reopen task','Supprimer la tâche':'Delete task',
    'Modifier la tâche':'Edit task','Annuler la suppression':'Undo deletion','Tâche supprimée.':'Task deleted.',
    'Réglages des nouvelles tâches':'Defaults for new tasks','Les tâches existantes gardent leurs réglages et leur progression.':'Existing tasks keep their settings and progress.',
    'Pauses comprises':'Breaks included','Recommencer et enregistrer':'Restart and save',
    'Nouvelle durée : progression remise à zéro, minuteur en pause.':'New duration: progress resets and the timer pauses.',
    'Développer':'Expand','Réduire':'Reduce','Durée de travail':'Focus duration','Pause courte':'Short break','Sessions':'Sessions',
    'Modifier les réglages':'Edit settings','Chargement…':'Loading…','Impossible de charger les tâches. Les données sont conservées.':'Cannot load tasks. Saved data has been preserved.',
    'Impossible d’enregistrer. Réessaie.':'Could not save. Try again.','Écris le titre de la tâche.':'Enter a task title.',
    'Choisis une durée entre 1 minute et 23 h 59.':'Choose a duration between 1 minute and 23 h 59.',
    'Créer une tâche pour commencer':'Create a task to begin','Enregistrer la tâche':'Save task','restante':'remaining','restantes':'remaining',
    'Suivante':'Next','Restant':'Remaining','sur':'of','aucune pause':'no breaks','pause':'break','pauses':'breaks','longue':'long break','longues':'long breaks'
  });
  function mount(host, options = {}) {
    if (!host?.ownerDocument) throw Error('A host element is required');
    if (host.shadowRoot?.querySelector('.nd-island')) throw Error('This host already contains a duration module');
    const Core = root.NotchyDurationCore;
    if (!Core) throw Error('Load duration-core.js before duration-module.js');
    const doc = host.ownerDocument, win = doc.defaultView;
    const shadow = host.shadowRoot || host.attachShadow({mode:'open'});
    const link = doc.createElement('link'); link.rel = 'stylesheet'; link.href = new URL('duration-module.css', base).href;
    const surface = doc.createElement('section'); surface.className = 'nd-island';
    surface.dataset.embedded = String(options.embedded === true); surface.style.setProperty('--nd-accent', ACCENT);
    surface.style.setProperty('--nd-fast', MOTION.check + 'ms');surface.style.setProperty('--nd-normal', MOTION.strike + 'ms');surface.style.setProperty('--nd-reorder', MOTION.reorder + 'ms');surface.style.setProperty('--nd-check-delay', MOTION.strikeDelay + 'ms');surface.style.setProperty('--nd-nudge', MOTION.nudge + 'px');
    const screen = doc.createElement('div'); screen.className = 'nd-screen';
    const status = doc.createElement('div'); status.className='nd-status'; status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    surface.append(screen,status); shadow.append(link,surface);
    let storage;
    try {storage = win.localStorage;} catch {storage = null;}
    const ownStore = !options.store, store = options.store || Core.createStore({storage, ...options.persistence});
    const recoveryToken={clear(){if(status.querySelector('[data-command=undo-remove]'))status.replaceChildren();}};
    let language = options.language === 'en' ? 'en' : 'fr', size = SIZES[options.size] ? options.size : 'full';
    let view = ['timer','pomodoro'].includes(options.view) ? options.view : 'tasks', previousView = 'tasks', settingsReturn = 'tasks', settingsSize=size, disposed=false, busy=false, settling=false, interval, context, previousPhase=null;
    let viewToken=0, renderedPlan='', taskListReturn=null;
    let draft = {title:'',h:'1',m:'30',split:false}, rows = new Map(), timers = new Map(), rowAnimations = new Map();
    const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
    const t = value => language === 'en' ? EN[value] || value : value;
    const $ = selector => screen.querySelector(selector);
    const pad = value => String(value).padStart(2,'0');
    const clock = ms => {const seconds=Math.ceil(Math.max(0,ms)/1000);return pad(Math.floor(seconds/60))+':'+pad(seconds%60);};
    const totalLabel = minutes => minutes>=60 ? Math.floor(minutes/60)+'h'+pad(minutes%60) : minutes+' min';
    function node(tag, className, text) {const element=doc.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;}
    function icon(name, pixels=16) {
      const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width',pixels);svg.setAttribute('height',pixels);svg.setAttribute('aria-hidden','true');
      const path=doc.createElementNS(svg.namespaceURI,'path');
      if(name==='play'||name==='pause'||name==='skip') {svg.setAttribute('fill','currentColor');path.setAttribute('d',name==='play'?'M7 4.5v15l13-7.5z':name==='pause'?'M7 4h3.6v16H7zM13.4 4H17v16h-3.6z':'M5 5l9 7-9 7zM16 5h3v14h-3z');}
      else {svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','2.2');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');path.setAttribute('d',PATHS[name] || PATHS.plus);}
      svg.append(path);return svg;
    }
    function button(command, label, glyph, className='nd-icon', pixels=14) {
      const element=node('button',className);element.type='button';element.dataset.command=command;element.setAttribute('aria-label',t(label));element.title=t(label);if(glyph)element.append(icon(glyph,pixels));return element;
    }
    function motionEnabled() {return doc.body?.dataset.motion!=='false'&&!reduced.matches;}
    function syncMotionPreference() {
      if(disposed)return;const enabled=motionEnabled();surface.dataset.motion=String(enabled);if(enabled)return;
      for(const animation of rowAnimations.values())animation.cancel();rowAnimations.clear();
      for(const timer of timers.values())win.clearTimeout(timer);timers.clear();
      for(const row of rows.values())row.classList.remove('is-completing');
      for(const animation of surface.getAnimations?.({subtree:true})||[])animation.cancel();
      if(rows.size)reorder(store.snapshot(),false);
    }
    function watchMotionPreference() {
      const observer=typeof win.MutationObserver==='function'?new win.MutationObserver(syncMotionPreference):null;
      if(observer&&doc.body)observer.observe(doc.body,{attributes:true,attributeFilter:['data-motion']});
      reduced.addEventListener?.('change',syncMotionPreference);syncMotionPreference();
      return ()=>{observer?.disconnect();reduced.removeEventListener?.('change',syncMotionPreference);};
    }
    function selected(state) {return state.tasks.find(task=>task.id===state.activeId)||state.tasks.find(task=>!task.done)||state.tasks[0]||null;}
    function planSignature(state) {const task=selected(state);return task?task.id+':'+task.totalMinutes+':'+JSON.stringify(task.settings):'';}
    function error(message) {status.textContent=t(message);recovery();}
    function recovery() {
      const existing=status.querySelector('[data-command=undo-remove]');
      if(!store.canUndoRemove?.()||RECOVERY_OWNERS.get(store)!==recoveryToken){if(existing)status.replaceChildren();return;}if(existing)return;
      if(!status.textContent)status.append(node('span','',t('Tâche supprimée.')));const undo=button('undo-remove','Annuler la suppression',null,'nd-undo');undo.textContent=t('Annuler');status.append(undo);
    }
    function removeTask(id) {return store.remove(id).then(result=>{RECOVERY_OWNERS.get(store)?.clear();RECOVERY_OWNERS.set(store,recoveryToken);return result;});}
    function setSize(next) {if(!SIZES[next])throw Error('Unknown module size');size=next;surface.style.removeProperty('width');surface.style.removeProperty('height');surface.dataset.size=size;options.onResize?.({...SIZES[size],size});}
    function closeMenu(){context?.remove();context=null;}
    function cleanView(){closeMenu();for(const timer of timers.values())win.clearTimeout(timer);timers.clear();for(const animation of rowAnimations.values())animation.cancel();rowAnimations.clear();rows.clear();screen.replaceChildren();}
    function changeView(next) {viewToken++;view=next;if(options.embedded!==true&&['tasks','create-title','create-duration','settings'].includes(view))setSize('full');status.textContent='';draw();options.onViewChange?.({view,size});}
    function rememberTaskList(id,command) {taskListReturn={id,command,scroll:$('.nd-list')?.scrollTop||0};}
    function returnToTasks() {changeView('tasks');const list=$('.nd-list');if(list&&taskListReturn)list.scrollTop=taskListReturn.scroll;const row=rows.get(taskListReturn?.id);(row?.querySelector(taskListReturn?.command==='play'?'.nd-row-play':'.nd-title-button')||$('[data-command=add]'))?.focus({preventScroll:true});}
    function header(focus=false) {
      const bar=node('header','nd-header'+(focus?' nd-focus-header':'')),heading=node('div','nd-heading');
      heading.append(node('span','nd-kicker',t('Tâches')),node('span','nd-count'));bar.append(heading);
      const actions=node('div','nd-header-actions');actions.append(button('settings','Modifier les réglages','settings'),button('add','Ajouter une tâche','plus','nd-icon accent'));bar.append(actions);screen.append(bar);
    }
    function empty() {
      header();const content=node('div','nd-empty'),art=node('div','nd-empty-art');
      art.innerHTML='<svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><circle cx="32" cy="32" r="31" stroke="#3a3a3d" stroke-width="2" stroke-dasharray="3 5"/><path d="M22 26h2m5 0h13M22 37h2m5 0h13" stroke="#8e8e93" stroke-width="2" stroke-linecap="round"/></svg>';
      const add=button('add','Nouvelle tâche','plus','nd-primary');add.append(node('span','',t('Nouvelle tâche')));
      content.append(art,node('h2','',t('Aucune tâche')),node('p','',t('Elles seront découpées en sessions Pomodoro.')),add);screen.append(content);
    }
    function segmentBar(task, preview=false) {
      const bar=node('div','nd-segments');bar.setAttribute('aria-hidden','true');
      let index=0;for(const segment of Core.plan(task.totalMinutes,task.settings)){
        const piece=node('span','nd-segment');piece.dataset.kind=segment.kind;piece.style.setProperty('--weight',segment.minutes);piece.style.setProperty('--nd-delay',Math.min(index++,6)*28+'ms');
        const fill=node('span','nd-segment-fill');fill.dataset.start=segment.startMs;fill.dataset.duration=segment.durationMs;fill.style.width=preview?'100%':'0%';piece.append(fill);bar.append(piece);
      }return bar;
    }
    function makeRow(task, container) {
      const row=node('div','nd-row');row.dataset.id=task.id;row.setAttribute('role','listitem');row.classList.toggle('is-done',task.done);
      row.dataset.plan=task.totalMinutes+':'+JSON.stringify(task.settings);
      const toggle=button('complete',task.done?'Rouvrir la tâche':'Terminer la tâche','check','nd-radio',12);toggle.setAttribute('role','checkbox');toggle.dataset.id=task.id;
      const title=button('detail','Focus',null,'nd-title-button');title.dataset.id=task.id;title.title=task.title;title.append(node('span','nd-title',task.title),icon('back',10));title.lastChild.classList.add('nd-row-chevron');
      const time=node('div','nd-row-time'),value=node('span','nd-time-value'),kind=node('small','nd-row-kind');time.append(value,kind);
      const play=button('play','Lancer le Pomodoro','play','nd-row-play',12);play.dataset.id=task.id;
      row.append(toggle,title,segmentBar(task),time,play);container.append(row);rows.set(task.id,row);return row;
    }
    function reorder(state, animate) {
      const list=$('.nd-list');if(!list||timers.size)return;
      const before=new Map([...rows].map(([id,row])=>[id,{top:row.getBoundingClientRect().top,opacity:Number(win.getComputedStyle(row).opacity)}]));
      const ordered=[...state.tasks.filter(task=>!task.done),...state.tasks.filter(task=>task.done)];
      const scroll=list.scrollTop,focused=list.contains(shadow.activeElement)?shadow.activeElement:null;
      let index=0;for(const task of ordered){const row=rows.get(task.id);if(!row)continue;if(list.children[index]!==row)list.insertBefore(row,list.children[index]||null);index++;}
      if(focused?.isConnected&&!focused.disabled&&shadow.activeElement!==focused)focused.focus({preventScroll:true});
      list.scrollTop=scroll;
      if(!animate)return;
      const ratio=list.offsetHeight>0?list.getBoundingClientRect().height/list.offsetHeight:1,scale=Number.isFinite(ratio)&&ratio>0?ratio:1;
      let moving=0;for(const task of ordered){
        const row=rows.get(task.id);if(!row)continue;
        const current=rowAnimations.get(task.id);current?.cancel();rowAnimations.delete(task.id);
        if(!motionEnabled())continue;
        const presentation=before.get(task.id),delta=(presentation?.top||0)-row.getBoundingClientRect().top,opacity=Number.isFinite(presentation?.opacity)?presentation.opacity:1;
        if(Math.abs(delta)>.5||opacity<.999){
          const delay=Math.min(moving++*MOTION.stagger,120)+(task.done?56:0);
          const frames=[{transform:'translateY('+(delta/scale)+'px)',opacity,offset:0}];
          if(task.done&&Math.abs(delta)>.5)frames.push({opacity:Math.min(opacity,.12),offset:.18},{opacity:.12,offset:.72});
          frames.push({transform:'translateY(0)',opacity:1,offset:1});
          const animation=row.animate(frames,{duration:MOTION.reorder+(task.done?60:0),delay,easing:MOTION.easing,fill:'both'});
          rowAnimations.set(task.id,animation);
          animation.onfinish=()=>{if(rowAnimations.get(task.id)===animation){rowAnimations.delete(task.id);animation.cancel();}};
          animation.oncancel=()=>{if(rowAnimations.get(task.id)===animation)rowAnimations.delete(task.id);};
        }
      }
    }
    function updateRows(state) {
      const list=$('.nd-list');if(!list)return;
      const visibleTasks=view==='timer'&&size==='details'?state.tasks.filter(task=>task.id!==selected(state)?.id):state.tasks;
      for(const task of visibleTasks){let row=rows.get(task.id);if(!row)row=makeRow(task,list);
        const done=row.classList.contains('is-done');row.classList.toggle('is-done',task.done);row.classList.toggle('is-running',state.activeId===task.id&&state.startedAt!==null);
        row.querySelector('.nd-radio').setAttribute('aria-checked',String(task.done));row.querySelector('.nd-radio').setAttribute('aria-label',t(task.done?'Rouvrir la tâche':'Terminer la tâche')+': '+task.title);
        const title=row.querySelector('.nd-title-button');title.setAttribute('aria-label',t('Focus')+': '+task.title);
        title.title=task.title;title.querySelector('.nd-title').textContent=task.title;
        const signature=task.totalMinutes+':'+JSON.stringify(task.settings);if(row.dataset.plan!==signature){row.querySelector('.nd-segments').replaceWith(segmentBar(task));row.dataset.plan=signature;}
        const progress=Core.phase(task),started=task.elapsedMs>0||state.activeId===task.id&&state.startedAt!==null;
        const fullTimer=view==='timer'&&size==='full',active=state.activeId===task.id&&!task.done;
        row.classList.toggle('is-active',active);
        row.querySelector('.nd-time-value').textContent=fullTimer?active?t(state.startedAt!==null?'En cours':'En pause'):totalLabel(task.totalMinutes):started&&!task.done?clock(progress.remainingMs):totalLabel(task.totalMinutes);
        row.querySelector('.nd-row-kind').textContent=!fullTimer&&started&&!task.done?phaseLabel(progress):'';
        const play=row.querySelector('.nd-row-play'),running=state.activeId===task.id&&state.startedAt!==null;play.replaceChildren(icon(running?'pause':'play',12));play.setAttribute('aria-label',t(running?'Mettre en pause':'Lancer le Pomodoro')+': '+task.title);play.disabled=task.done;
        for(const fill of row.querySelectorAll('.nd-segment-fill'))fill.style.width=(task.done?100:Math.max(0,Math.min(100,(task.elapsedMs-Number(fill.dataset.start))/Number(fill.dataset.duration)*100)))+'%';
        if(task.done!==done){win.clearTimeout(timers.get(task.id));timers.delete(task.id);row.classList.remove('is-completing');
          if(task.done&&motionEnabled()){void row.offsetWidth;row.classList.add('is-completing');timers.set(task.id,win.setTimeout(()=>{timers.delete(task.id);row.classList.remove('is-completing');if(!disposed)reorder(store.snapshot(),true);},MOTION.strikeDelay+MOTION.strike+MOTION.settle));}
          else reorder(state,true);
        }
      }
      for(const [id,row] of rows)if(!visibleTasks.some(task=>task.id===id)){win.clearTimeout(timers.get(id));timers.delete(id);rowAnimations.get(id)?.cancel();rowAnimations.delete(id);row.remove();rows.delete(id);}
      if(!timers.size)reorder(state,false);
      const remaining=state.tasks.filter(task=>!task.done).length;
      const count=$('.nd-count');if(count)count.textContent=remaining?remaining+' '+t(remaining===1?'restante':'restantes'):t('Tout est fait');
      const add=$('[data-command=add]');if(add)add.disabled=state.tasks.length>=Core.LIMITS.tasks;
    }
    function ring(sizePx) {
      const element=node('div','nd-ring'),radius=sizePx===132?58:sizePx===116?52:28,center=sizePx/2,circumference=2*Math.PI*radius,stroke=sizePx===132?8:sizePx===116?7:5;
      element.innerHTML='<svg viewBox="0 0 '+sizePx+' '+sizePx+'" fill="none" aria-hidden="true"><circle cx="'+center+'" cy="'+center+'" r="'+radius+'" stroke="#1b1b1f" stroke-width="'+stroke+'"/><circle class="nd-ring-progress" cx="'+center+'" cy="'+center+'" r="'+radius+'" stroke-width="'+stroke+'" stroke-linecap="round" stroke-dasharray="'+circumference+'"/></svg>';
      element.dataset.circumference=circumference;return element;
    }
    function timerView(state) {
      const task=selected(state);if(!task){view='tasks';if(options.embedded!==true)setSize('full');empty();return;}
      if(size==='full'){
        const title=button('tasks','Tâches',null,'nd-selected-title');title.append(node('span','nd-dot'),node('span','',task.title));screen.append(title);
        const r=ring(116),content=node('div','nd-ring-text');content.append(node('div','nd-clock'),node('div','nd-phase'));r.append(content);screen.append(r);
        const controls=node('div','nd-controls');controls.append(button('restart','Recommencer','reset','nd-control'),button('toggle','Lancer le Pomodoro','play','nd-control nd-toggle',16),button('skip','Passer à l’étape suivante','skip','nd-control',13));screen.append(controls,node('div','nd-divider'));header(true);
        const list=node('div','nd-list nd-focus-list');list.setAttribute('role','list');list.setAttribute('aria-label',t('Tâches'));screen.append(list);
      }else{
        const play=button('toggle','Lancer le Pomodoro',null,'nd-mini-ring');play.append(ring(64),icon('play',18));screen.append(play);
        const phase=node('div','nd-mini-phase');phase.append(node('span','nd-dot'),node('span','nd-mini-phase-text'));const title=button('tasks','Tâches',null,'nd-mini-title');title.textContent=task.title;title.title=task.title;screen.append(phase,node('div','nd-mini-clock'),title);
        const upcoming=node('div','nd-upcoming');upcoming.append(node('div','nd-dots'),node('span','nd-session-label'),node('strong','nd-next-label'),node('small','nd-remaining-label'));screen.append(upcoming,button('skip','Passer à l’étape suivante','skip','nd-control nd-mini-skip',15),button('settings','Modifier les réglages','settings','nd-mini-edit',14));
        if(size==='details'){screen.append(node('div','nd-details-divider'));const list=node('div','nd-list nd-details-list');list.setAttribute('role','list');list.setAttribute('aria-label',t('Tâches'));screen.append(list);}
      }
      updateTimer(state);updateRows(state);
    }
    function phaseLabel(value) {return t(value.finished?'Terminé':value.current.kind==='focus'?'Focus':value.current.kind==='long'?'Pause longue':'Pause');}
    function updateTimer(state) {
      if(!['timer','pomodoro'].includes(view))return;const task=selected(state);if(!task)return;const p=Core.phase(task),running=state.activeId===task.id&&state.startedAt!==null;
      surface.style.setProperty('--nd-phase',p.current.kind==='focus'?ACCENT:'#8b8b96');
      for(const clockElement of screen.querySelectorAll('.nd-clock,.nd-mini-clock'))clockElement.textContent=clock(p.remainingMs);
      for(const title of screen.querySelectorAll('.nd-mini-title,.nd-solo-title,.nd-selected-title span:last-child')){title.textContent=task.title;title.title=task.title;}
      const phase=$('.nd-phase');if(phase)phase.textContent=view==='pomodoro'?t('Restant').toLowerCase():phaseLabel(p)+' · '+p.current.cycle+'/'+p.cycles;
      const soloPhase=$('.nd-solo-phase');if(soloPhase)soloPhase.textContent=phaseLabel(p);
      const miniPhase=$('.nd-mini-phase-text');if(miniPhase)miniPhase.textContent=phaseLabel(p)+(size==='details'||size==='quarter'?' '+p.current.cycle+'/'+p.cycles:'');
      for(const circle of screen.querySelectorAll('.nd-ring-progress')){const r=circle.closest('.nd-ring');circle.style.strokeDashoffset=Number(r.dataset.circumference)*p.fraction;}
      for(const fill of screen.querySelectorAll('.nd-solo-segments .nd-segment-fill'))fill.style.width=Math.max(0,Math.min(100,(task.elapsedMs-Number(fill.dataset.start))/Number(fill.dataset.duration)*100))+'%';
      const play=$('[data-command=toggle]');if(play){play.setAttribute('aria-label',t(running?'Mettre en pause':'Lancer le Pomodoro'));const old=play.querySelector(':scope > svg');if(old)old.replaceWith(icon(running?'pause':'play',18));else play.replaceChildren(icon(running?'pause':'play',16));play.disabled=task.done;}
      const next=$('.nd-next-label');if(next)next.textContent=p.next?(p.next.kind==='focus'?t('Focus'):p.next.kind==='long'?t('Pause longue'):t('Pause'))+' '+p.next.minutes+' min':t('Terminé');
      const label=$('.nd-session-label');if(label)label.textContent=p.current.cycle+' '+t('sur')+' '+p.cycles;
      const remaining=$('.nd-remaining-label');if(remaining){const minutes=Math.ceil(p.totalRemainingMs/60000);remaining.textContent=totalLabel(minutes)+' '+t(minutes===1?'restante':'restantes');}
      const dots=$('.nd-dots');if(dots){dots.replaceChildren();for(let i=0;i<Math.min(p.cycles,12);i++){const dot=node('i',i<p.current.cycle?'is-past':'');dots.append(dot);}}
    }
    function notifyPhase(state) {
      const task=selected(state);if(!task){previousPhase=null;return;}const p=Core.phase(task),signature=task.id+':'+p.index+':'+p.finished;
      if(previousPhase&&previousPhase!==signature&&state.startedAt!==null){try{options.onPhaseChange?.({task:{...task},phase:{...p.current},finished:p.finished});}catch(cause){options.onError?.(cause);}}previousPhase=signature;
    }
    function restoreSettings(){view=settingsReturn;setSize(settingsSize);status.textContent='';draw();options.onViewChange?.({view,size});$('[data-command=settings]')?.focus({preventScroll:true});}
    function soloView(state) {
      const task=selected(state);if(!task){view='tasks';empty();return;}screen.classList.add('nd-solo');
      const top=node('header','nd-solo-header'),back=button('tasks','Tâches','back','');back.append(node('span','',t('Tâches')));top.append(back,node('span','nd-session-label'));screen.append(top);
      const r=ring(132),content=node('div','nd-ring-text');content.append(node('div','nd-clock'),node('div','nd-phase'));r.append(content);screen.append(r);
      const info=node('div','nd-solo-info'),pill=node('div','nd-solo-pill');pill.append(node('span','nd-dot'),node('span','nd-solo-phase'));info.append(pill,node('div','nd-solo-title',task.title),node('div','nd-next-label'));
      const controls=node('div','nd-controls');controls.append(button('restart','Recommencer','reset','nd-control'),button('toggle','Lancer le Pomodoro','play','nd-control nd-toggle',18),button('skip','Passer à l’étape suivante','skip','nd-control'),button('settings','Modifier les réglages','settings','nd-mini-edit',14));info.append(controls);screen.append(info);
      const segments=segmentBar(task);segments.classList.add('nd-solo-segments');screen.append(segments);const footer=node('div','nd-solo-footer');footer.append(node('span','nd-remaining-label'),node('span','',task.settings.work+' · '+task.settings.rest+' · '+task.settings.longRest));screen.append(footer);updateTimer(state);
    }
    function durationView() {
      const wrap=node('div','nd-create'+(draft.id?' is-editing-task':'')),top=node('div','nd-create-top');
      const cancel=button('cancel-create','Annuler',null,'nd-kicker');cancel.textContent=t(draft.id?'Modifier la tâche':'Nouvelle tâche');top.append(cancel);
      const original=draft.id?store.snapshot().tasks.find(task=>task.id===draft.id):null,config=original?.settings||store.snapshot().settings;
      const rule=node('div','nd-rule');rule.title='Pomodoro '+config.work+' · '+config.rest+' · '+config.longRest;rule.append(node('span','nd-dot'),node('span','',t('Pauses comprises')));top.append(rule);wrap.append(top);
      const field=node('div','nd-title-field');field.append(node('span',''));
      const input=node('input','');input.name='title';input.maxLength=Core.LIMITS.title;input.value=draft.title;input.placeholder=t('Titre de la tâche');input.setAttribute('aria-label',t('Titre de la tâche'));field.append(input);
      if(view==='create-title'){field.append(button('confirm-title','Valider le titre','check','nd-icon accent'));wrap.append(field);const help=node('div','nd-next-title');help.append(node('span','',language==='fr'?'Ensuite : durée estimée et sessions Pomodoro.':'Next: estimated duration and Pomodoro sessions.'));wrap.append(help);}
      else{
        wrap.append(field);
        const duration=node('div','nd-duration'+(draft.split?' is-editing':''));duration.innerHTML='<svg width="0" height="0" aria-hidden="true"><defs><filter id="nd-goo" x="-20%" y="-80%" width="140%" height="260%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="2" result="b"/><feColorMatrix in="b" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 22 -10"/></filter></defs></svg><div class="nd-duration-bg"><i></i><i></i><i></i></div>';
        for(const [name,label,unit,cls] of [['h','Heures','Hr.','nd-hours'],['m','Minutes','Min.','nd-minutes']]){const number=node('input',cls);number.name=name;number.inputMode='numeric';number.pattern='[0-9]*';number.maxLength=2;number.value=draft[name];number.readOnly=!draft.split;number.tabIndex=draft.split?0:-1;number.setAttribute('aria-label',t(label));duration.append(number,node('span','nd-unit '+cls+'-unit',unit));}
        duration.append(button('edit-duration','Modifier la durée',null,'nd-duration-open'),button(draft.split?'confirm-duration':'edit-duration',draft.split?'Valider la durée':'Modifier la durée',draft.split?'check':'pencil','nd-duration-action',24));wrap.append(duration);
        wrap.append(...durationPreview(config,original));
      }screen.append(wrap);
    }
    function durationPreview(config,original) {
      const preview=node('div','nd-plan-preview'),footer=node('div','nd-create-footer');if(!draft.split){const total=draftMinutes();if(total){const task={totalMinutes:total,settings:config},plan=Core.plan(total,task.settings);preview.append(segmentBar(task,true));const summary=node('div','nd-plan-summary');const focusMinutes=plan.filter(s=>s.kind==='focus').reduce((sum,s)=>sum+s.minutes,0);summary.append(node('strong','',totalLabel(total)),node('span','',totalLabel(focusMinutes)+' focus · '+totalLabel(total-focusMinutes)+' '+t('pauses')));footer.append(summary);draft.restartRequired=!!original&&original.totalMinutes!==total&&(original.elapsedMs>0||store.snapshot().activeId===original.id&&store.snapshot().startedAt!==null);if(draft.restartRequired)preview.append(node('p','nd-edit-notice',t('Nouvelle durée : progression remise à zéro, minuteur en pause.')));}}
      const saveLabel=draft.id?(draft.restartRequired?'Recommencer et enregistrer':'Enregistrer la tâche'):'Ajouter la tâche',save=button('save-task',saveLabel,null,'nd-primary');save.textContent=t(saveLabel);save.disabled=busy;footer.append(save);footer.hidden=preview.hidden=draft.split;return [preview,footer];
    }
    function refreshDurationPreview() {
      const state=store.snapshot(),original=draft.id?state.tasks.find(task=>task.id===draft.id):null;
      const [preview,footer]=durationPreview(original?.settings||state.settings,original);
      $('.nd-plan-preview')?.replaceWith(preview);$('.nd-create-footer')?.replaceWith(footer);
    }
    function draftMinutes() {const h=Number(draft.h),m=Number(draft.m),total=h*60+m;if(!/^\d{1,2}$/.test(draft.h)||!/^\d{1,2}$/.test(draft.m)||m>59||total<1)return null;if(h>23&&(!draft.id||total!==store.snapshot().tasks.find(task=>task.id===draft.id)?.totalMinutes))return null;return total;}
    function setDurationEditing(editing) {
      draft.split=editing;const duration=$('.nd-duration');duration.classList.toggle('is-editing',editing);
      for(const input of duration.querySelectorAll('input')){input.readOnly=!editing;input.tabIndex=editing?0:-1;}
      const action=duration.querySelector('.nd-duration-action');action.dataset.command=editing?'confirm-duration':'edit-duration';action.setAttribute('aria-label',t(editing?'Valider la durée':'Modifier la durée'));action.replaceChildren(icon(editing?'check':'pencil',24));
      $('.nd-plan-preview').hidden=editing;$('.nd-create-footer').hidden=editing;
    }
    function settingsView() {
      const form=node('form','nd-settings'),bar=node('header','');bar.append(node('span','nd-kicker',t('Réglages des nouvelles tâches')));const back=button('settings-back','Retour',null,'');back.textContent=t('Retour');bar.append(back);form.append(bar,node('p','nd-settings-note',t('Les tâches existantes gardent leurs réglages et leur progression.')));
      const grid=node('div','nd-settings-grid'),config=store.snapshot().settings;
      for(const [key,label,max] of [['work','Durée de travail',180],['rest','Pause courte',60],['longRest','Pause longue',180],['interval','Sessions',12]]){const labelElement=node('label','',t(label)+(key==='interval'?'':' (min)'));const input=node('input','');input.name=key;input.type='number';input.required=true;input.min='1';input.max=String(max);input.step='1';input.value=config[key];labelElement.append(input);grid.append(labelElement);}
      form.append(grid);const footer=node('footer',''),save=button('save-settings','Enregistrer',null,'nd-primary');save.textContent=t('Enregistrer');save.type='submit';footer.append(save);form.append(footer);screen.append(form);
    }
    function fit() {
      const box=host.getBoundingClientRect(),width=Math.max(0,host.clientWidth||box.width),height=Math.max(0,host.clientHeight||box.height);
      surface.style.width=width+'px';surface.style.height=height+'px';
      if(options.embedded!==true||!width||!height)return;
      surface.dataset.emptyCard=String(surface.dataset.empty==='true'&&height>=210);
      if(surface.dataset.emptyCard==='true'){screen.style.width=width+'px';screen.style.height=height+'px';screen.style.left=screen.style.top='0px';screen.style.transform='none';return;}
      const canvas=view==='timer'||view==='tasks'&&size==='quarter'?SIZES[size]:SIZES.full,content=['tasks','timer','pomodoro'].includes(view);
      let scale=Math.min(width/canvas.width,height/canvas.height,content?1.35:Infinity);
      if(view==='tasks'&&size!=='quarter')scale=Math.max(scale,Math.min(.9,width/320));
      const trim=content?(canvas===SIZES.quarter?0:canvas===SIZES.half?4:canvas===SIZES.details?2:12):0;
      // Keep the reference's internal rhythm; let its list fill the slot from the top.
      screen.style.width=(content?width/scale:canvas.width)+'px';screen.style.height=(content?height/scale+trim:canvas.height)+'px';
      screen.style.left=(content?0:(width-canvas.width*scale)/2)+'px';screen.style.top=(content?-trim*scale:(height-canvas.height*scale)/2)+'px';
      screen.style.transform='scale('+scale+')';
    }
    function draw() {
      if(disposed)return;cleanView();screen.classList.remove('nd-solo');surface.lang=language;surface.setAttribute('aria-label',language==='fr'?'Tâches et Pomodoro':'Tasks and Pomodoro');
      const state=store.snapshot();surface.dataset.view=view;surface.dataset.empty=String(view==='tasks'&&!state.tasks.length);renderedPlan=planSignature(state);
      if(view==='tasks'){if(!state.tasks.length)empty();else{header();const list=node('div','nd-list');list.setAttribute('role','list');list.setAttribute('aria-label',t('Tâches'));screen.append(list);updateRows(state);}}
      else if(view==='timer')timerView(state);
      else if(view==='pomodoro')soloView(state);
      else if(view==='settings')settingsView();
      else durationView();
      recovery();
      if(options.embedded===true)fit();
    }
    async function act(operation, after) {
      if(disposed)return;status.textContent='';
      try {await operation();if(disposed)return;if(after)after();else{const state=store.snapshot();updateRows(state);updateTimer(state);}recovery();}
      catch(cause){if(!disposed){error('Impossible d’enregistrer. Réessaie.');options.onError?.(cause);}}
    }
    function confirmTitle() {draft.title=$('[name=title]').value.trim();if(!draft.title){error('Écris le titre de la tâche.');$('[name=title]').focus();return;}changeView('create-duration');$('[data-command=edit-duration]')?.focus({preventScroll:true});}
    function restoreEditor() {const id=draft.id;changeView(previousView);const target=id?(rows.get(id)?.querySelector('.nd-title-button')||$('[data-command=toggle]')):null;(target||$('[data-command=add]'))?.focus({preventScroll:true});}
    function finishDuration(save) {
      draft.title=$('[name=title]').value.trim();const minutes=draftMinutes();
      if(!draft.title){error('Écris le titre de la tâche.');return;}if(!minutes){error('Choisis une durée entre 1 minute et 23 h 59.');return;}
      draft.h=String(Math.floor(minutes/60));draft.m=String(minutes%60);setDurationEditing(false);
      $('[name=h]').value=draft.h;$('[name=m]').value=draft.m;
      if(save){if(busy)return;const state=store.snapshot(),original=draft.id?state.tasks.find(task=>task.id===draft.id):null;
        if(original&&original.totalMinutes!==minutes&&(original.elapsedMs>0||state.activeId===original.id&&state.startedAt!==null)&&!draft.restartRequired){draw();$('[data-command=save-task]')?.focus({preventScroll:true});return;}
        busy=true;const saveButton=$('[data-command=save-task]');if(saveButton)saveButton.disabled=true;const submissionView=viewToken;act(()=>draft.id?store.update(draft.id,draft.title,minutes,{restart:draft.restartRequired===true}):store.add(draft.title,minutes),()=>{busy=false;if(submissionView!==viewToken)return;restoreEditor();}).finally(()=>{busy=false;const retry=$('[data-command=save-task]');if(retry)retry.disabled=false;});}
      else {refreshDurationPreview();$('[data-command=save-task]')?.focus({preventScroll:true});}
    }
    function onClick(event) {
      const b=event.target.closest('button[data-command]');if(!b||b.disabled)return;const command=b.dataset.command,id=b.dataset.id;closeMenu();
      if(command==='add'){previousView=view;draft={title:'',h:'1',m:'30',split:false};changeView('create-title');$('[name=title]').focus();}
      else if(command==='edit-task'){const task=store.snapshot().tasks.find(task=>task.id===id);if(!task)return;previousView=view;draft={id,title:task.title,h:String(Math.floor(task.totalMinutes/60)),m:String(task.totalMinutes%60),split:false,restartRequired:false};changeView('create-duration');$('[name=title]').focus();}
      else if(command==='cancel-create')restoreEditor();
      else if(command==='confirm-title')confirmTitle();
      else if(command==='edit-duration'){draft.title=$('[name=title]').value;setDurationEditing(true);$('[name=h]').focus();$('[name=h]').select();}
      else if(command==='confirm-duration')finishDuration(false);
      else if(command==='save-task')finishDuration(true);
      else if(command==='complete')act(()=>store.complete(id));
      else if(command==='play'){const state=store.snapshot(),pausing=state.activeId===id&&state.startedAt!==null,token=viewToken;rememberTaskList(id,command);act(()=>store.toggleTimer(id),()=>{if(!pausing&&viewToken===token){changeView('timer');$('[data-command=toggle]')?.focus({preventScroll:true});}});}
      else if(command==='detail'){rememberTaskList(id,command);const token=viewToken;act(()=>store.select(id),()=>{if(viewToken!==token)return;view='pomodoro';if(options.embedded!==true)setSize('full');draw();options.onViewChange?.({view,size});$('[data-command=toggle]')?.focus();});}
      else if(command==='tasks')returnToTasks();
      else if(command==='settings'){settingsReturn=view;settingsSize=size;changeView('settings');$('input')?.focus();}
      else if(command==='settings-back'){restoreSettings();}
      else if(command==='toggle'||command==='skip'||command==='restart'){const current=selected(store.snapshot());if(current)act(()=>command==='toggle'?store.toggleTimer(current.id):command==='skip'?store.skip(current.id):store.restart(current.id));}
      else if(command==='remove')act(()=>removeTask(id),()=>{if(!store.snapshot().tasks.length)changeView('tasks');else draw();});
      else if(command==='undo-remove')act(()=>store.undoRemove(),draw);
    }
    function onInput(event) {if(event.target.name==='title'){draft.title=event.target.value;return;}if(['h','m'].includes(event.target.name)){draft[event.target.name]=event.target.value.replace(/\D/g,'').slice(0,2);event.target.value=draft[event.target.name];}}
    function onSubmit(event) {if(!event.target.matches('.nd-settings'))return;event.preventDefault();if(!event.target.reportValidity())return;const config=Object.fromEntries(['work','rest','longRest','interval'].map(key=>[key,Number(event.target.elements[key].value)]));act(()=>store.configure(config),restoreSettings);}
    function onKey(event) {
      if(context&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();const items=[...context.querySelectorAll('[role=menuitem]')],index=items.indexOf(shadow.activeElement);items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowUp'?-1:1)+items.length)%items.length]?.focus();return;}
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(context){const id=context.firstChild.dataset.id;closeMenu();rows.get(id)?.querySelector('.nd-title-button')?.focus({preventScroll:true});return;}if(view==='settings'){restoreSettings();return;}if(view.startsWith('create')){restoreEditor();return;}if(['timer','pomodoro'].includes(view)){returnToTasks();return;}}
      if(event.key==='Enter'&&event.target.matches('input')&&!event.target.closest('form')){event.preventDefault();if(view==='create-title')confirmTitle();else if(view==='create-duration')finishDuration(!draft.split);}
      if(event.key==='F2'&&['timer','pomodoro'].includes(view)){settingsReturn=view;settingsSize=size;changeView('settings');}
      if((event.key==='ContextMenu'||event.shiftKey&&event.key==='F10')&&event.target.closest('.nd-row')){event.preventDefault();openMenu(event.target.closest('.nd-row'));}
    }
    function openMenu(row) {closeMenu();context=node('div','nd-context');context.setAttribute('role','menu');for(const [command,label]of [['edit-task','Modifier la tâche'],['remove','Supprimer la tâche']]){const action=button(command,label,null,'');action.dataset.id=row.dataset.id;action.textContent=t(label);action.setAttribute('role','menuitem');context.append(action);}screen.append(context);context.firstChild.focus();}
    function onContext(event) {const row=event.target.closest('.nd-row');if(!row)return;event.preventDefault();openMenu(row);}
    screen.addEventListener('click',onClick);screen.addEventListener('input',onInput);screen.addEventListener('submit',onSubmit);screen.addEventListener('keydown',onKey);screen.addEventListener('contextmenu',onContext);
    status.addEventListener('click',onClick);
    const stopWatchingMotion=watchMotionPreference();
    setSize(size);screen.append(node('div','nd-loading',t('Chargement…')));
    const unsubscribe=store.subscribe(state=>{if(disposed)return;notifyPhase(state);if(view.startsWith('create')||view==='settings')return;if(view==='tasks'&&Boolean($('.nd-empty'))===Boolean(state.tasks.length)||['timer','pomodoro'].includes(view)&&renderedPlan!==planSignature(state))draw();else{updateRows(state);updateTimer(state);recovery();}});
    const ready=store.ready.then(()=>{if(disposed)return;draw();notifyPhase(store.snapshot());interval=win.setInterval(()=>{if(disposed)return;const state=store.snapshot();notifyPhase(state);if(!view.startsWith('create')&&view!=='settings'){updateRows(state);updateTimer(state);}if(state.startedAt!==null&&!settling){const current=selected(state);if(current&&Core.phase(current).finished){settling=true;act(()=>store.settle()).finally(()=>{settling=false;});}}},1000);return api;}).catch(cause=>{error('Impossible de charger les tâches. Les données sont conservées.');options.onError?.(cause);throw cause;});
    const api=Object.freeze({ready,store,constants:{MOTION,SIZES,ACCENT},
      setLanguage(value){language=value==='en'?'en':'fr';draw();},
      cancelEdit(){viewToken++;if(['settings','create-title','create-duration','pomodoro'].includes(view)){view=options.view==='tasks'?'tasks':'timer';draw();}},
      fit,
      showSettings(){settingsReturn=view;settingsSize=size;changeView('settings');},
      startCreate(){previousView=view;draft={title:'',h:'0',m:String(store.snapshot().settings.work),split:false};changeView('create-title');$('[name=title]').focus();},
      setPresentation(value){setSize(({rail:'quarter',scene:'details',full:'full'})[value]||value);draw();},
      showTasks(){returnToTasks();},showTimer(id){return act(()=>id?store.select(id):Promise.resolve(),()=>changeView('timer'));},showPomodoro(id){return act(()=>id?store.select(id):Promise.resolve(),()=>{view='pomodoro';if(options.embedded!==true)setSize('full');draw();});},
      inspect(){return {view,size,language,disposed,state:store.snapshot()};},
      dispose(){if(disposed)return;disposed=true;stopWatchingMotion();unsubscribe();win.clearInterval(interval);cleanView();screen.removeEventListener('click',onClick);screen.removeEventListener('input',onInput);screen.removeEventListener('submit',onSubmit);screen.removeEventListener('keydown',onKey);screen.removeEventListener('contextmenu',onContext);status.removeEventListener('click',onClick);if(RECOVERY_OWNERS.get(store)===recoveryToken)RECOVERY_OWNERS.delete(store);if(ownStore)store.dispose();link.remove();surface.remove();}
    });return api;
  }
  root.NotchyDuration=Object.freeze({mount,MOTION,SIZES,ACCENT});
})(globalThis);
