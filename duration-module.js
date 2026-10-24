(function (root) {
  'use strict';
  // Motion and reference geometry are intentionally adjustable in one place.
  const MOTION = Object.freeze({check: 130, strike: 310, strikeDelay: 110, settle: 70, reorder: 460, stagger: 56, split: 520, nudge: 10, easing: 'cubic-bezier(.32,.72,0,1)'});
  const SIZES = Object.freeze({quarter: {width: 220, height: 120, radius: 28}, half: {width: 440, height: 120, radius: 28}, details: {width: 440, height: 180, radius: 32}, full: {width: 440, height: 240, radius: 34}});
  const ACCENT = '#ff7a45';
  const CLOCKS = new WeakMap();
  function updateClock(element, value, {motion = true} = {}) {
    value=String(value);let clock=CLOCKS.get(element);const intact=clock?.cells.every(item=>item.cell.parentNode===element);if(intact&&clock.value===value)return false;
    for(const animation of clock?.animations||[])animation.cancel();
    if(!intact)clock=null;
    const previous=clock?.value||'',direction=Number(value.replace(':',''))<Number(previous.replace(':',''))?1:-1,doc=element.ownerDocument;
    if(!clock||clock.cells.length!==value.length){
      const cells=Array.from(value,character=>{const cell=doc.createElement('span'),digit=doc.createElement('span');cell.className=character===':'?'nd-clock-separator':'nd-clock-cell';digit.className='nd-clock-digit';digit.textContent=character;cell.append(digit);return{cell,digit,character};});
      element.replaceChildren(...cells.map(item=>item.cell));clock={cells,animations:[],digits:Math.max(clock?.digits||0,value.replace(':','').length)};
    }
    clock.animations=[];clock.digits=Math.max(clock.digits,value.replace(':','').length);element.style.setProperty('--nd-clock-columns',clock.digits);
    element.setAttribute('role','timer');element.setAttribute('aria-live','off');element.setAttribute('aria-label',value);
    for(let index=0;index<clock.cells.length;index++){
      const item=clock.cells[index],character=value[index];if(item.character===character)continue;
      const old=item.character;item.character=character;item.digit.textContent=character;
      if(motion&&previous&&character!==':'&&item.digit.animate){
        const outgoing=doc.createElement('span');outgoing.className='nd-clock-digit nd-clock-digit-out';outgoing.textContent=old;outgoing.setAttribute('aria-hidden','true');item.cell.prepend(outgoing);
        const leave=outgoing.animate([{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY('+direction*.25+'em)'}],{duration:260,easing:'cubic-bezier(.2,.8,.2,1)'});
        const enter=item.digit.animate([{opacity:0,transform:'translateY('+direction*-.25+'em)'},{opacity:1,transform:'translateY(0)'}],{duration:260,easing:'cubic-bezier(.2,.8,.2,1)'});
        leave.onfinish=leave.oncancel=()=>outgoing.remove();clock.animations.push(leave,enter);
      }
    }
    clock.value=value;CLOCKS.set(element,clock);return true;
  }
  const RECOVERY_OWNERS = new WeakMap();
  const base = document.currentScript?.src ? new URL('.', document.currentScript.src).href : './';
  const PATHS = Object.freeze({plus:'M12 5v14M5 12h14',check:'M5 12.5l4.5 4.5L19 7.5',pencil:'M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1zM14.5 6.5l3 3',back:'M15 5l-7 7 7 7',down:'M6 9l6 6 6-6',up:'M6 15l6-6 6 6',reset:'M5 12a7 7 0 1 0 2.1-5M5 4.5V9h4.5',settings:'M4 8h16M4 16h16M9 5.6v4.8M15 13.6v4.8',close:'M6 6l12 12M6 18L18 6'});
  const EN = Object.freeze({
    'Tâches':'Tasks','Nouvelle tâche':'New task','Aucune tâche':'No tasks','Tout est fait':'All done',
    'Session terminée':'Session complete','On reprend ?':'Ready to focus?','Cycle terminé':'Cycle complete','Tâche terminée':'Task complete','Durée terminée':'Time complete',
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
    'Créer une tâche pour commencer':'Create a task to begin','Enregistrer la tâche':'Save task','restante':'remaining','restantes':'remaining','Active':'Active',
    'Suivante':'Next','Ensuite':'Up next','Restant':'Remaining','sur':'of','aucune pause':'no breaks','pause':'break','pauses':'breaks','longue':'long break','longues':'long breaks'
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
    if(options.preview===true){host.inert=true;surface.dataset.preview='true';}
    let storage;
    try {storage = win.localStorage;} catch {storage = null;}
    const ownStore = !options.store, store = options.store || Core.createStore({storage, ...options.persistence});
    let recoveryTimer=null,recoveryVersion=0;
    const recoveryToken={clear(){win.clearTimeout(recoveryTimer);recoveryTimer=null;recoveryVersion++;status.querySelector('[data-command=undo-remove]')?.remove();status.querySelector('.nd-recovery-message')?.remove();}};
    let language = options.language === 'en' ? 'en' : 'fr', size = SIZES[options.size] ? options.size : 'full';
    let view = ['timer','pomodoro'].includes(options.view) ? 'timer' : 'tasks', previousView = 'tasks', settingsReturn = 'tasks', settingsSize=size, disposed=false, busy=false, settling=false, interval, context, previousPhase=null;
    let viewToken=0, renderedPlan='', taskListReturn=null, feedback=null, feedbackTimer=null, boundary=null, emptyGalet=null;
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
      svg.append(path);
      if(name==='settings')for(const [x,y]of [[9,8],[15,16]]){const circle=doc.createElementNS(svg.namespaceURI,'circle');circle.setAttribute('cx',x);circle.setAttribute('cy',y);circle.setAttribute('r','2.4');circle.setAttribute('fill','var(--surface-control,#202024)');svg.append(circle);}
      return svg;
    }
    function button(command, label, glyph, className='nd-icon', pixels=14) {
      const element=node('button',className);element.type='button';element.dataset.command=command;element.setAttribute('aria-label',t(label));element.title=t(label);if(glyph)element.append(icon(glyph,pixels));return element;
    }
    function motionEnabled() {return doc.body?.dataset.motion!=='false'&&!reduced.matches;}
    function syncMotionPreference() {
      if(disposed)return;const enabled=motionEnabled();surface.dataset.motion=String(enabled);emptyGalet?.setMotion(motionEnabled);if(enabled)return;
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
    function selected(state) {return state.tasks.find(task=>task.id===state.activeId&&!task.done)||state.tasks.find(task=>!task.done)||state.tasks[0]||null;}
    function planSignature(state) {const task=selected(state);return task?task.id+':'+task.totalMinutes+':'+JSON.stringify(task.settings):'';}
    function error(message) {status.textContent=t(message);recovery();}
    function recovery() {
      const existing=status.querySelector('[data-command=undo-remove]');
      if(!store.canUndoRemove?.()||RECOVERY_OWNERS.get(store)!==recoveryToken){recoveryToken.clear();if(RECOVERY_OWNERS.get(store)===recoveryToken)RECOVERY_OWNERS.delete(store);return;}if(existing)return;
      if(!status.textContent)status.append(node('span','nd-recovery-message',t('Tâche supprimée.')));const undo=button('undo-remove','Annuler la suppression',null,'nd-undo');undo.textContent=t('Annuler');status.append(undo);
    }
    function removeTask(id) {return store.remove(id).then(result=>{if(disposed)return result;RECOVERY_OWNERS.get(store)?.clear();RECOVERY_OWNERS.set(store,recoveryToken);const version=++recoveryVersion;recoveryTimer=win.setTimeout(()=>{if(disposed||version!==recoveryVersion||RECOVERY_OWNERS.get(store)!==recoveryToken)return;RECOVERY_OWNERS.delete(store);recoveryToken.clear();},5000);return result;});}
    function setSize(next) {if(!SIZES[next])throw Error('Unknown module size');size=next;surface.style.removeProperty('width');surface.style.removeProperty('height');surface.dataset.size=size;if(options.embedded!==true)options.onResize?.({...SIZES[size],size});}
    function closeMenu(){context?.remove();context=null;}
    function cleanView(){emptyGalet?.dispose();emptyGalet=null;clearCompletion();closeMenu();for(const timer of timers.values())win.clearTimeout(timer);timers.clear();for(const animation of rowAnimations.values())animation.cancel();rowAnimations.clear();rows.clear();screen.replaceChildren();}
    function changeView(next) {viewToken++;view=next;if(options.embedded!==true&&['tasks','create-title','create-duration','settings'].includes(view))setSize('full');status.textContent='';draw();options.onViewChange?.({view,size});}
    function rememberTaskList(id,command) {taskListReturn={id,command,scroll:$('.nd-list')?.scrollTop||0};}
    function returnToTasks() {changeView('tasks');const list=$('.nd-list');if(list&&taskListReturn)list.scrollTop=taskListReturn.scroll;const row=rows.get(taskListReturn?.id);(row?.querySelector(taskListReturn?.command==='play'?'.nd-row-play':'.nd-title-button')||$('[data-command=add]'))?.focus({preventScroll:true});}
    function header(focus=false,parent=screen,details=false,inlineAdd=true) {
      const bar=node('header','nd-header'+(focus?' nd-focus-header':'')),heading=details?button('open-details','Tâches',null,'nd-heading'):node('div','nd-heading');
      heading.append(node('span','nd-kicker',t('Tâches')),node('span','nd-count'));bar.append(heading);
      const actions=node('div','nd-header-actions');actions.append(button('settings','Modifier les réglages','settings'));if(inlineAdd)actions.append(button('add','Ajouter une tâche','plus','nd-icon accent'));bar.append(actions);parent.append(bar);
    }
    function empty() {
      header();const content=node('div','nd-empty'),message=node('div','nd-empty-content'),art=node('div','nd-empty-art');
      art.innerHTML='<svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><circle class="nd-empty-rays" cx="32" cy="32" r="31" stroke="#3a3a3d" stroke-width="2" stroke-dasharray="3 5"/><path d="M22 26h2m5 0h13M22 37h2m5 0h13" stroke="#8e8e93" stroke-width="2" stroke-linecap="round"/></svg>';
      const add=button('add','Nouvelle tâche','plus','nd-primary');add.append(node('span','',t('Nouvelle tâche')));
      message.append(art,node('h2','',t('Aucune tâche')),node('p','',t('Elles seront découpées en sessions Pomodoro.')));content.append(message,add);screen.append(content);
      if(typeof win.NotchyGalet?.create==='function'){
        art.querySelector('path')?.remove();const mascot=node('span','nd-empty-mimo');mascot.setAttribute('aria-hidden','true');art.append(mascot);
        emptyGalet=win.NotchyGalet.create(mascot,{variant:'focus',motion:motionEnabled,active:options.preview!==true,scope:doc});
      }
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
      const moduleLayout=surface.dataset?.modulePresentation;
      const visibleTasks=!moduleLayout&&view==='timer'&&size==='details'?state.tasks.filter(task=>task.id!==selected(state)?.id):state.tasks;
      for(const task of visibleTasks){let row=rows.get(task.id);if(!row)row=makeRow(task,list);
        const done=row.classList.contains('is-done');row.classList.toggle('is-done',task.done);row.classList.toggle('is-running',state.activeId===task.id&&state.startedAt!==null);
        row.querySelector('.nd-radio').setAttribute('aria-checked',String(task.done));row.querySelector('.nd-radio').setAttribute('aria-label',t(task.done?'Rouvrir la tâche':'Terminer la tâche')+': '+task.title);
        const title=row.querySelector('.nd-title-button');title.setAttribute('aria-label',t('Focus')+': '+task.title);
        title.title=task.title;title.querySelector('.nd-title').textContent=task.title;
        const signature=task.totalMinutes+':'+JSON.stringify(task.settings);if(row.dataset.plan!==signature){row.querySelector('.nd-segments').replaceWith(segmentBar(task));row.dataset.plan=signature;}
        const progress=Core.phase(task),started=task.elapsedMs>0||state.activeId===task.id&&state.startedAt!==null;
        const fullTimer=['full','main'].includes(moduleLayout)||view==='timer'&&size==='full',active=state.activeId===task.id&&!task.done;
        row.classList.toggle('is-active',active);
        row.querySelector('.nd-time-value').textContent=fullTimer?active?t('Active')+' · '+progress.current.cycle+'/'+progress.cycles:totalLabel(task.totalMinutes):started&&!task.done?clock(progress.remainingMs):totalLabel(task.totalMinutes);
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
    function moduleRing(presentation) {
      const element=node('div','nd-ring nd-module-ring'),circumference=2*Math.PI*44,stroke=6;
      element.innerHTML='<svg viewBox="0 0 100 100" fill="none" aria-hidden="true"><circle cx="50" cy="50" r="44" stroke="#202024" stroke-width="'+stroke+'"/><circle class="nd-ring-progress" cx="50" cy="50" r="44" stroke-width="'+stroke+'" stroke-linecap="round" stroke-dasharray="'+circumference+'" stroke-dashoffset="'+circumference+'"/></svg>';
      element.dataset.circumference=circumference;return element;
    }
    function moduleView(state) {
      const presentation=surface.dataset.modulePresentation,task=selected(state),layout=node('div','nd-module nd-module-'+presentation);
      if(!state.tasks.length&&!['small','wide'].includes(presentation)){empty();return;}
      screen.append(layout);
      if(presentation==='small'||presentation==='wide'){
        const copy=button(task?'open-details':'add',task?'Tâches':'Nouvelle tâche',null,'nd-module-small-copy');
        copy.append(node('span','nd-mini-clock',task?'':clock(state.settings.work*60000)),node('span','nd-module-small-title',task?'':t('Nouvelle tâche')));
        const dial=node('div','nd-module-small-ring');dial.append(moduleRing(presentation),button(task?'toggle':'add',task?'Lancer le Pomodoro':'Nouvelle tâche',task?'play':'plus','nd-control nd-toggle',18));
        layout.append(copy,dial);
        if(presentation==='wide'&&task){
          const next=node('section','nd-module-upnext'),row=button('detail','Focus',null,'nd-upnext-task');row.append(node('span','nd-upnext-title'),node('span','nd-upnext-duration'));next.append(node('span','nd-upnext-kicker',t('Ensuite')),row);layout.append(next);
        }
        if(presentation==='wide')layout.append(button('settings','Modifier les réglages','settings'));
      }else{
        const timer=node('section','nd-module-timer'),heading=node('header','nd-timer-heading'),title=button('open-details','Tâches',null,'nd-selected-title');
        const chevron=node('span','nd-title-chevron','›');chevron.setAttribute('aria-hidden','true');
        title.append(node('span','nd-dot'),node('span','nd-selected-name',task.title),chevron);heading.append(title,node('span','nd-session-badge'));
        const dial=moduleRing(presentation),text=node('div','nd-ring-text');text.append(node('div','nd-clock'),node('div','nd-phase'));dial.append(text);
        const controls=node('div','nd-controls');controls.append(button('restart','Recommencer','reset','nd-control'),button('toggle','Lancer le Pomodoro','play','nd-control nd-toggle',18),button('skip','Passer à l’étape suivante','skip','nd-control',16));
        timer.append(heading,dial,controls);layout.append(timer);
        if(presentation==='side'){
          const next=node('section','nd-module-upnext'),row=button('detail','Focus',null,'nd-upnext-task');row.append(node('span','nd-upnext-title'),node('span','nd-upnext-duration'));
          next.append(node('span','nd-upnext-kicker',t('Ensuite')),row);timer.append(next);
        }else if(presentation!=='tall'){
          const listPanel=node('section','nd-module-tasks'),list=node('div','nd-list nd-focus-list nd-module-list');
          list.setAttribute('role','list');list.setAttribute('aria-label',t('Tâches'));header(true,listPanel,presentation==='main',presentation!=='full');listPanel.append(list);
          if(presentation==='full'){const add=button('add','Nouvelle tâche','plus','nd-module-add');add.append(node('span','',t('Nouvelle tâche')));listPanel.append(add);}
          layout.append(node('div','nd-divider'),listPanel);
        }
      }
      updateRows(state);updateTimer(state);
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
      if(!['timer','pomodoro'].includes(view)&&surface.dataset?.canonicalView!=='true')return;const task=selected(state);if(!task)return;const p=Core.phase(task),running=state.activeId===task.id&&state.startedAt!==null;
      const holding=boundary&&boundary.kind!=='task'&&boundary.stage==='message';
      surface.style.setProperty('--nd-phase',holding?boundary.from==='focus'?ACCENT:'#86b7ff':p.finished?'#4fd88a':p.current.kind==='focus'?ACCENT:'#86b7ff');
      surface.dataset.phase=p.finished?'complete':p.current.kind;
      for(const clockElement of screen.querySelectorAll('.nd-clock,.nd-mini-clock'))updateClock(clockElement,clock(holding?0:p.remainingMs),{motion:motionEnabled()});
      for(const title of screen.querySelectorAll('.nd-mini-title,.nd-selected-name,.nd-selected-title span:last-child:not(.nd-title-chevron)')){title.textContent=task.title;title.title=task.title;}
      const smallTitle=$('.nd-module-small-title');if(smallTitle){smallTitle.textContent=holding?t(boundary.title):task.title+' · '+p.current.cycle+'/'+p.cycles;smallTitle.title=holding?boundary.detail:task.title;}
      const upcomingTask=$('.nd-upnext-task');if(upcomingTask){const nextTask=state.tasks.find(item=>!item.done&&item.id!==task.id);upcomingTask.disabled=!nextTask;upcomingTask.dataset.id=nextTask?.id||'';upcomingTask.querySelector('.nd-upnext-title').textContent=nextTask?.title||t('Tout est fait');upcomingTask.querySelector('.nd-upnext-duration').textContent=nextTask?totalLabel(nextTask.totalMinutes):'';upcomingTask.setAttribute('aria-label',nextTask?t('Focus')+': '+nextTask.title:t('Tout est fait'));}
      const phase=$('.nd-phase');if(phase)phase.textContent=holding?t(boundary.title):phaseLabel(p)+' · '+p.current.cycle+'/'+p.cycles;
      const badge=$('.nd-session-badge');if(badge){badge.textContent=phaseLabel(p)+' · '+p.current.cycle+'/'+p.cycles;badge.dataset.complete=String(p.finished);}
      const miniPhase=$('.nd-mini-phase-text');if(miniPhase)miniPhase.textContent=phaseLabel(p)+(size==='details'||size==='quarter'?' '+p.current.cycle+'/'+p.cycles:'');
      for(const circle of screen.querySelectorAll('.nd-ring-progress')){const r=circle.closest('.nd-ring');circle.style.strokeDashoffset=Number(r.dataset.circumference)*(holding?1:p.fraction);}
      const play=$('[data-command=toggle]');if(play){play.setAttribute('aria-label',t(running?'Mettre en pause':'Lancer le Pomodoro'));const old=play.querySelector(':scope > svg');if(old)old.replaceWith(icon(running?'pause':'play',18));else play.replaceChildren(icon(running?'pause':'play',16));play.disabled=task.done;}
      const next=$('.nd-next-label');if(next)next.textContent=p.next?(p.next.kind==='focus'?t('Focus'):p.next.kind==='long'?t('Pause longue'):t('Pause'))+' '+p.next.minutes+' min':t('Terminé');
      const label=$('.nd-session-label');if(label)label.textContent=p.current.cycle+' '+t('sur')+' '+p.cycles;
      const remaining=$('.nd-remaining-label');if(remaining){const minutes=Math.ceil(p.totalRemainingMs/60000);remaining.textContent=totalLabel(minutes)+' '+t(minutes===1?'restante':'restantes');}
      const dots=$('.nd-dots');if(dots){dots.replaceChildren();for(let i=0;i<Math.min(p.cycles,12);i++){const dot=node('i',i<p.current.cycle?'is-past':'');dots.append(dot);}}
    }
    function phaseTransition(previous,state,now) {
      if(!previous||previous.activeId!==state.activeId||previous.startedAt===null)return null;
      const before=previous.tasks.find(task=>task.id===state.activeId),after=state.tasks.find(task=>task.id===state.activeId);
      if(!before||!after||before.done||after.done)return null;
      const first=Core.phase(before),last=Core.phase(after);
      if(first.finished||first.index===last.index&&first.finished===last.finished)return null;
      const expected=Core.phase(Core.materialize(previous,now).tasks.find(task=>task.id===state.activeId));
      if(expected.index!==last.index||expected.finished!==last.finished)return null;
      return {kind:last.finished?'complete':last.current.kind==='focus'?'resume':last.current.kind==='long'?'cycle':'session',task:after,phase:last,from:first.current.kind};
    }
    function clearCompletion() {
      win.clearTimeout(feedbackTimer);feedback?.remove();feedback=null;feedbackTimer=null;boundary=null;delete surface.dataset.boundary;delete surface.dataset.boundaryStage;
    }
    function announceCompletion(kind,title,detail='',event=null) {
      clearCompletion();boundary={kind,title,detail,from:event?.from||'focus',stage:'message'};surface.dataset.boundary=kind;surface.dataset.boundaryStage='message';
      feedback=node('div',kind==='task'?'nd-completion':'nd-boundary');feedback.dataset.kind=kind;feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
      if(kind==='task'){
        const chip=node('div','nd-completion-chip');chip.append(icon('check',14),node('strong','',t(title)));feedback.append(chip);surface.append(feedback);
      }else{
        const dial=$('.nd-module-ring')||$('.nd-ring');if(!dial){clearCompletion();return;}
        const pulse=node('span','nd-boundary-pulse');pulse.setAttribute('aria-hidden','true');feedback.append(pulse);
        if(kind==='cycle'||kind==='complete'){
          if(kind==='cycle'){
            const segments=doc.createElementNS('http://www.w3.org/2000/svg','svg'),count=event.task.settings.interval,circumference=2*Math.PI*44;segments.setAttribute('viewBox','0 0 100 100');segments.setAttribute('aria-hidden','true');segments.classList.add('nd-boundary-segments');
            for(let index=0;index<count;index++){const circle=doc.createElementNS(segments.namespaceURI,'circle');for(const [key,value]of Object.entries({cx:50,cy:50,r:44,fill:'none',stroke:ACCENT,'stroke-width':6,'stroke-linecap':'round','stroke-dasharray':(circumference/count-8)+' '+circumference,transform:'rotate('+(index*360/count-84)+' 50 50)'}))circle.setAttribute(key,value);circle.style.setProperty('--segment-delay',index*120+'ms');segments.append(circle);}feedback.append(segments);
          }
          const check=icon('check',64);check.classList.add('nd-boundary-check');check.querySelector('path').setAttribute('pathLength','1');feedback.append(check,node('strong','nd-boundary-title',t(title)),node('span','nd-boundary-detail',detail));
        }
        const particles=node('div','nd-completion-particles');particles.setAttribute('aria-hidden','true');if(motionEnabled())for(let i=0;i<9;i++){const particle=node('i',''),angle=i*Math.PI*2/9;particle.style.setProperty('--particle-x',Math.round(Math.cos(angle)*70)+'px');particle.style.setProperty('--particle-y',Math.round(Math.sin(angle)*70)+'px');particle.style.setProperty('--particle-delay',i%3*25+'ms');particles.append(particle);}feedback.append(particles);dial.append(feedback);updateTimer(store.snapshot());
      }
      feedbackTimer=win.setTimeout(()=>{
        if(kind==='task'){clearCompletion();return;}feedback?.remove();feedback=null;boundary.stage='next';surface.dataset.boundaryStage='next';updateTimer(store.snapshot());feedbackTimer=win.setTimeout(()=>{clearCompletion();updateTimer(store.snapshot());},1200);
      },kind==='task'?1800:kind==='cycle'||kind==='complete'?3200:1800);
    }
    function notifyPhase(state) {
      if(options.preview===true)return;
      const event=phaseTransition(previousPhase,state,Date.now());previousPhase=state;if(!event)return;
      const titles={session:'Session terminée',resume:'On reprend ?',cycle:'Cycle terminé',complete:'Durée terminée'},detail=event.kind==='cycle'?t('Pause longue')+' · '+event.phase.current.minutes+' min':event.kind==='session'?(language==='fr'?'Pause de ':'Break for ')+event.phase.current.minutes+' min':event.kind==='resume'?(language==='fr'?'Retour au focus':'Return to focus'):event.task.title;
      if(!view.startsWith('create')&&view!=='settings')announceCompletion(event.kind,titles[event.kind],detail,event);
      try{options.onPhaseChange?.({kind:event.kind,task:{...event.task},phase:{...event.phase.current},finished:event.phase.finished,detail});}catch(cause){options.onError?.(cause);}
    }
    function restoreSettings(){view=settingsReturn;setSize(settingsSize);status.textContent='';draw();options.onViewChange?.({view,size});$('[data-command=settings]')?.focus({preventScroll:true});}
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
      const nativeScroll=['settings','create-title','create-duration','pomodoro'].includes(view)&&(width<SIZES.full.width||height<SIZES.full.height);
      if(surface.dataset.modulePresentation&&['settings','create-title','create-duration'].includes(view)){
        const minimum=view==='settings'?336:288;
        surface.dataset.nativeScroll=String(height<minimum);screen.style.width=width+'px';screen.style.height=Math.max(height,minimum)+'px';screen.style.left=screen.style.top='0px';screen.style.transform='none';return;
      }
      if(surface.dataset.nativeScroll==='true'&&!nativeScroll)surface.scrollLeft=surface.scrollTop=0;
      surface.dataset.nativeScroll=String(nativeScroll);
      if(nativeScroll){screen.style.width=SIZES.full.width+'px';screen.style.height=SIZES.full.height+'px';screen.style.left=screen.style.top='0px';screen.style.transform='none';return;}
      if(surface.dataset.canonicalView==='true'){screen.style.width=width+'px';screen.style.height=height+'px';screen.style.left=screen.style.top='0px';screen.style.transform='none';return;}
      if(surface.dataset.emptyCard==='true'){screen.style.width=width+'px';screen.style.height=height+'px';screen.style.left=screen.style.top='0px';screen.style.transform='none';return;}
      const canvas=view==='timer'||view==='tasks'&&size==='quarter'?SIZES[size]:SIZES.full,content=['tasks','timer','pomodoro'].includes(view);
      let scale=Math.min(width/canvas.width,height/canvas.height,content?1.35:Infinity);
      if(content)scale=Math.max(1,scale);
      const trim=content?(canvas===SIZES.quarter?0:canvas===SIZES.half?4:canvas===SIZES.details?2:12):0;
      // Keep the reference's internal rhythm; let its list fill the slot from the top.
      screen.style.width=(content?width/scale:canvas.width)+'px';screen.style.height=(content?height/scale+trim:canvas.height)+'px';
      screen.style.left=(content?0:(width-canvas.width*scale)/2)+'px';screen.style.top=(content?-trim*scale:(height-canvas.height*scale)/2)+'px';
      screen.style.transform='scale('+scale+')';
    }
    function draw() {
      if(disposed)return;cleanView();screen.classList.remove('nd-solo');surface.lang=language;surface.setAttribute('aria-label',language==='fr'?'Tâches et Pomodoro':'Tasks and Pomodoro');
      const state=store.snapshot();surface.dataset.view=view;surface.dataset.empty=String(!state.tasks.length&&(view==='tasks'||!!surface.dataset.modulePresentation&&view==='timer'));renderedPlan=planSignature(state);
      surface.dataset.canonicalView=String(!!surface.dataset.modulePresentation&&['tasks','timer'].includes(view));
      if(surface.dataset.canonicalView==='true')moduleView(state);
      else if(view==='tasks'){if(!state.tasks.length)empty();else{header();const list=node('div','nd-list');list.setAttribute('role','list');list.setAttribute('aria-label',t('Tâches'));screen.append(list);updateRows(state);}}
      else if(view==='timer')timerView(state);
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
      if(boundary&&command!=='complete'){clearCompletion();updateTimer(store.snapshot());}
      if(command==='open-details'){options.onRequestDetails?.();}
      else if(command==='add'){previousView=view;draft={title:'',h:'1',m:'30',split:false};changeView('create-title');$('[name=title]').focus();}
      else if(command==='edit-task'){const task=store.snapshot().tasks.find(task=>task.id===id);if(!task)return;previousView=view;draft={id,title:task.title,h:String(Math.floor(task.totalMinutes/60)),m:String(task.totalMinutes%60),split:false,restartRequired:false};changeView('create-duration');$('[name=title]').focus();}
      else if(command==='cancel-create')restoreEditor();
      else if(command==='confirm-title')confirmTitle();
      else if(command==='edit-duration'){draft.title=$('[name=title]').value;setDurationEditing(true);$('[name=h]').focus();}
      else if(command==='confirm-duration')finishDuration(false);
      else if(command==='save-task')finishDuration(true);
      else if(command==='complete'){const completing=!store.snapshot().tasks.find(task=>task.id===id)?.done;act(()=>store.complete(id),()=>{const state=store.snapshot();updateRows(state);updateTimer(state);if(completing)announceCompletion('task','Tâche terminée');});}
      else if(command==='play'){const state=store.snapshot(),pausing=state.activeId===id&&state.startedAt!==null,token=viewToken;rememberTaskList(id,command);act(()=>store.toggleTimer(id),()=>{if(!pausing&&viewToken===token){changeView('timer');$('[data-command=toggle]')?.focus({preventScroll:true});}});}
      else if(command==='detail'){rememberTaskList(id,command);const token=viewToken;act(()=>store.select(id),()=>{if(viewToken!==token)return;if(surface.dataset.canonicalView!=='true')changeView('timer');$('[data-command=toggle]')?.focus({preventScroll:true});});}
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
    function onContext(event) {const row=event.target.closest('.nd-row');if(!row&&!event.target.closest('.nd-context'))return;event.preventDefault();event.stopPropagation();if(row)openMenu(row);}
    if(options.preview!==true){screen.addEventListener('click',onClick);screen.addEventListener('input',onInput);screen.addEventListener('submit',onSubmit);screen.addEventListener('keydown',onKey);screen.addEventListener('contextmenu',onContext);status.addEventListener('click',onClick);}
    const stopWatchingMotion=watchMotionPreference();
    setSize(size);screen.append(node('div','nd-loading',t('Chargement…')));
    const unsubscribe=store.subscribe(state=>{if(disposed)return;notifyPhase(state);if(view.startsWith('create')||view==='settings')return;const emptyChanged=surface.dataset.canonicalView==='true'?(surface.dataset.empty==='true')!==!state.tasks.length:view==='tasks'&&Boolean($('.nd-empty'))===Boolean(state.tasks.length);if(emptyChanged||surface.dataset.canonicalView!=='true'&&['timer','pomodoro'].includes(view)&&renderedPlan!==planSignature(state))draw();else{updateRows(state);updateTimer(state);recovery();}});
    const ready=store.ready.then(()=>{if(disposed)return;draw();notifyPhase(store.snapshot());if(options.preview!==true)interval=win.setInterval(()=>{if(disposed)return;const state=store.snapshot();notifyPhase(state);if(!view.startsWith('create')&&view!=='settings'){updateRows(state);updateTimer(state);}if(state.startedAt!==null&&!settling){const current=selected(state);if(current&&Core.phase(current).finished){settling=true;act(()=>store.settle()).finally(()=>{settling=false;});}}},1000);return api;}).catch(cause=>{error('Impossible de charger les tâches. Les données sont conservées.');options.onError?.(cause);throw cause;});
    const api=Object.freeze({ready,store,constants:{MOTION,SIZES,ACCENT},
      setLanguage(value){language=value==='en'?'en':'fr';draw();},
      cancelEdit(){viewToken++;if(['settings','create-title','create-duration','pomodoro'].includes(view)){view=options.view==='tasks'?'tasks':'timer';draw();}},
      fit,
      showSettings(){settingsReturn=view;settingsSize=size;changeView('settings');},
      startCreate(){previousView=view;draft={title:'',h:'0',m:String(store.snapshot().settings.work),split:false};changeView('create-title');$('[name=title]').focus();},
      setPresentation(value){setSize(({rail:'quarter',scene:'details',full:'full'})[value]||value);draw();},
      setModulePresentation(value){if(value!==null&&!['full','main','side','small','wide','tall'].includes(value))throw Error('Unknown module presentation');if((surface.dataset.modulePresentation||null)===value)return false;if(value)surface.dataset.modulePresentation=value;else delete surface.dataset.modulePresentation;if(['tasks','timer'].includes(view))draw();else fit();return true;},
      showTasks(){returnToTasks();},showTimer(id){return act(()=>id?store.select(id):Promise.resolve(),()=>changeView('timer'));},showPomodoro(id){return api.showTimer(id);},
      inspect(){return {view,size,modulePresentation:surface.dataset.modulePresentation||null,language,disposed,state:store.snapshot()};},
      dispose(){if(disposed)return;disposed=true;stopWatchingMotion();unsubscribe();win.clearInterval(interval);win.clearTimeout(feedbackTimer);feedback?.remove();recoveryToken.clear();cleanView();screen.removeEventListener('click',onClick);screen.removeEventListener('input',onInput);screen.removeEventListener('submit',onSubmit);screen.removeEventListener('keydown',onKey);screen.removeEventListener('contextmenu',onContext);status.removeEventListener('click',onClick);if(RECOVERY_OWNERS.get(store)===recoveryToken)RECOVERY_OWNERS.delete(store);if(ownStore)store.dispose();link.remove();surface.remove();}
    });return api;
  }
  root.NotchyDuration=Object.freeze({mount,MOTION,SIZES,ACCENT,updateClock});
})(globalThis);
