(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) {
    root.NotchyFocus = api;
    const mountSelectedLab = () => {
      if (root.document.body?.hasAttribute('data-focus-lab') && root.document.getElementById('focus-player') && !root.notchyFocusLab) api.mountLab(root.document);
    };
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', mountSelectedLab, {once: true});
    else mountSelectedLab();
  }
})(typeof window === 'object' ? window : null, function () {
  'use strict';
  const STORAGE_KEY = 'notchy-minimal-focus-v1';
    const FocusModel = (() => {
 'use strict';
 const defaults = () => ({task: '', tasks: [], activeTaskId: null, taskPrompt: null, minutes: 25, remaining: 1500, deadline: null, complete: false, sessionActive: false});
 const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
 const taskId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value);
 const taskTitle = value => typeof value === 'string' ? value.trim().slice(0, 500) : '';
 const taskCycles = item => ({estimatedCycles: integer(item.estimatedCycles, 1, 12) ? item.estimatedCycles : 1,
  completedCycles: integer(item.completedCycles, 0, 9999) ? item.completedCycles : 0});
 const timerActive = state => !state.pomodoro?.finished && !!(state.sessionActive || state.deadline);
 function restoreTasks(input) {
  const tasks = [], seen = new Set();
  if (Array.isArray(input.tasks)) {
   for (const item of input.tasks.slice(0, 100)) {
    if (!item || typeof item !== 'object' || !taskId(item.id) || seen.has(item.id)) continue;
    const title = taskTitle(item.title); if (!title) continue;
    tasks.push({id: item.id, title, done: item.done === true, ...taskCycles(item)}); seen.add(item.id);
   }
  } else if (taskTitle(input.task)) tasks.push({id: 'legacy-task', title: taskTitle(input.task), done: false, ...taskCycles({})});
  const activeTaskId = tasks.find(item => !item.done && item.id === input.activeTaskId)?.id || (!Array.isArray(input.tasks) ? tasks[0]?.id : null) || null;
  return {tasks, activeTaskId, task: tasks.find(item => item.id === activeTaskId)?.title || ''};
 }
 function taskAction(state, action, id = '') {
  if (!state || !Array.isArray(state.tasks) || !action || typeof action !== 'object') return false;
  const item = state.tasks.find(task => task.id === action.id);
  if (action.type === 'add') {
   const title = taskTitle(action.title);
   if (!title || !taskId(id) || state.tasks.length >= 100 || state.tasks.some(task => task.id === id)) return false;
   state.tasks.push({id, title, done: false, ...taskCycles(action)});
  } else if (action.type === 'select' && item && !item.done) {state.activeTaskId = item.id; if (state.taskPrompt?.kind === 'continue') state.taskPrompt = null;}
  else if (action.type === 'unlink') {state.activeTaskId = null; state.taskPrompt = null;}
  else if (action.type === 'estimate' && item && integer(action.estimatedCycles, 1, 12)) item.estimatedCycles = action.estimatedCycles;
  else if (action.type === 'keep' && state.taskPrompt?.kind === 'cycle-complete' && state.taskPrompt.taskId === action.id) state.taskPrompt = null;
  else if ((action.type === 'toggle' && item) || (action.type === 'confirm-complete' && item && !item.done && state.taskPrompt?.kind === 'cycle-complete' && state.taskPrompt.taskId === item.id)) {
   const linked = state.activeTaskId === item.id;
   item.done = action.type === 'confirm-complete' || !item.done;
   if (state.taskPrompt?.taskId === item.id) state.taskPrompt = null;
   if (item.done && linked) {state.activeTaskId = null; if (timerActive(state)) state.taskPrompt = {kind: 'continue', taskId: item.id};}
  }
  else if (action.type === 'delete' && item) {state.tasks = state.tasks.filter(task => task.id !== item.id); if (state.activeTaskId === item.id) state.activeTaskId = null; if (state.taskPrompt?.taskId === item.id) state.taskPrompt = null;}
  else return false;
  state.task = state.tasks.find(task => task.id === state.activeTaskId && !task.done)?.title || '';
  return true;
 }
 function cycle(input) {
  if(!input||typeof input!=='object'||Array.isArray(input)||!integer(input.work,1,180)||!integer(input.rest,1,60)||!['work','break'].includes(input.phase))return null;
  const total=input.total===undefined?4:input.total,session=input.session===undefined?1:input.session,longRest=input.longRest===undefined?15:input.longRest;
  if(!integer(total,1,12)||!integer(session,1,total)||!integer(longRest,1,180))return null;
  const result={work:input.work,rest:input.rest,longRest,total,session,phase:input.phase};
  if(input.phase==='break')result.breakKind=input.breakKind==='long'&&session===total?'long':'short';
  if(input.finished===true&&result.phase==='break'&&result.breakKind==='long'&&session===total)result.finished=true;
  return result;
 }
 const phaseMinutes=p=>p.phase==='work'?p.work:p.breakKind==='long'?p.longRest:p.rest;
 function restore(input, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !integer(input.minutes, 1, 180)) return defaults();
  const state = defaults();
  Object.assign(state, restoreTasks(input));
  state.minutes = input.minutes;
  const p = cycle(input.pomodoro);
  if (p) {
   state.pomodoro = p;
   state.minutes = phaseMinutes(p);
  }
  const full = state.minutes * 60;
  state.remaining = Number.isFinite(input.remaining) && input.remaining >= 0 ? Math.min(full, Math.ceil(input.remaining)) : full;
  state.complete = input.complete === true && state.remaining === 0;
  state.sessionActive = input.sessionActive === true && !state.complete;
  if (input.deadline !== null && input.deadline !== undefined) {
   if (!Number.isFinite(input.deadline) || input.deadline <= 0 || input.deadline > now + full * 1000 + 60000) return defaults();
   state.deadline = Math.floor(input.deadline); state.sessionActive = true; state.complete = false;
  }
  if(p?.finished&&(!state.complete||state.deadline||state.sessionActive))delete p.finished;
  const prompt = input.taskPrompt, promptTask = state.tasks.find(task => task.id === prompt?.taskId);
  if (prompt && typeof prompt === 'object' && !Array.isArray(prompt) && promptTask && (prompt.kind === 'cycle-complete' && !promptTask.done || prompt.kind === 'continue' && promptTask.done)) state.taskPrompt = {kind: prompt.kind, taskId: promptTask.id};
  return state;
 }
 function remaining(state, now = Date.now()) {
  const value = state?.deadline ? Math.ceil((state.deadline - now) / 1000) : state?.remaining;
  return Number.isFinite(value) ? Math.max(0, Math.ceil(value)) : 0;
 }
 function nextPhase(state, now = Date.now()) {
  const normalized=cycle(state.pomodoro);if(!normalized||!state.complete||normalized.finished)return false;
  const p=state.pomodoro=normalized;
  if(p.phase==='break'&&p.breakKind==='long'){p.finished=true;state.deadline=null;state.remaining=0;state.complete=true;state.sessionActive=false;return false;}
  if (p.phase === 'work') {p.phase='break';p.breakKind=p.session>=p.total?'long':'short';}
  else if(p.session>=p.total){p.breakKind='long';}
  else {p.phase='work';p.session++;delete p.breakKind;}
  state.minutes = phaseMinutes(p);
  state.remaining = state.minutes * 60; state.complete = false; state.sessionActive = true;
  state.deadline = now + state.remaining * 1000;
  return true;
 }
 function tick(state,now=Date.now()){
  const result={changed:false,phaseChanged:false,finished:false,creditedCycles:[]};
  // A paused phase has no deadline. It cannot advance because wall time passed.
  if(!state.deadline&&!state.complete)return result;
  if(state.pomodoro?.finished)return result;
  for(let count=0;count<26;count++){
   const legacyBoundary=!!state.pomodoro&&state.complete&&!state.deadline;
   if(!legacyBoundary&&(!state.deadline||remaining(state,now)>0))break;
   const boundary=legacyBoundary?now:state.deadline;
   // Only a real elapsed work phase earns a task cycle; Skip also uses nextPhase.
   if (state.pomodoro?.phase === 'work') {
    const task = state.tasks?.find(task => task.id === state.activeTaskId && !task.done);
    if (task) {task.completedCycles = Math.min(9999, (task.completedCycles || 0) + 1); state.taskPrompt = {kind: 'cycle-complete', taskId: task.id}; result.creditedCycles.push({taskId: task.id, session: state.pomodoro.session});}
   }
   state.deadline=null;state.remaining=0;state.complete=true;state.sessionActive=false;result.changed=true;
   if(state.pomodoro&&nextPhase(state,boundary)){result.phaseChanged=true;continue;}
   result.finished=true;break;
  }
  return result;
 }
 return Object.freeze({defaults, restore, remaining, nextPhase, tick, taskAction});
  })();

  function focusConfiguration(value = {}) {
    const result = {work: 25, rest: 5, longRest: 15, total: 4};
    for (const [key, max] of [['work', 180], ['rest', 60], ['longRest', 180], ['total', 12]]) {
      if (Number.isInteger(value?.[key]) && value[key] >= 1 && value[key] <= max) result[key] = value[key];
    }
    return result;
  }
  function focusCardValues(model, settings = focusConfiguration(), now = Date.now(), translate = value => value) {
    const cycle = model.pomodoro, active = !cycle?.finished && (model.sessionActive || !!model.deadline);
    const paused = active && !model.deadline, breaking = cycle?.phase === 'break';
    const seconds = active ? FocusModel.remaining(model, now) : model.complete ? 0 : settings.work * 60;
    const total = cycle?.total || settings.total, completed = cycle ? Math.min(total, breaking || cycle.finished ? cycle.session : cycle.session - 1) : 0;
    const longBreak = cycle?.breakKind === 'long' || cycle?.phase === 'work' && cycle.session === total;
    const pauseMinutes = longBreak ? cycle?.longRest || settings.longRest : cycle?.rest || settings.rest;
    const badge = model.complete ? 'TERMINÉ' : paused ? 'EN PAUSE' : breaking ? cycle.breakKind === 'long' ? 'PAUSE LONGUE' : 'PAUSE' : 'FOCUS';
    const description = model.complete ? 'Cycle terminé. Prends un moment pour toi.' : paused ? 'Reprends quand tu es prêt.' : breaking ? cycle.breakKind === 'long' ? 'Lève-toi et éloigne-toi de l’écran un moment.' : 'Respire, bois un verre d’eau, puis retrouve ton rythme.' : 'Une tâche, un moment pour avancer.';
    return {active,paused,seconds,badge: translate(badge),description: translate(description),completed,total,pause: String(pauseMinutes).padStart(2, '0') + ':00',pauseLabel: translate(longBreak ? 'Pause longue' : 'Pause courte'),
      progress: active ? Math.min(1, Math.max(0, 1 - seconds / (model.minutes * 60))) : model.complete ? 1 : 0,
      task: typeof model.task === 'string' ? model.task.trim() : '', taskCount: model.tasks?.length || 0, completedTasks: model.tasks?.filter(task => task.done).length || 0};
  }

  const markup = "<div id=\"focus-active\" class=\"focus-widget\"><div class=\"focus-timer-card\"><div class=\"focus-card-top\"><span class=\"focus-timer-label\">TIMER</span><div class=\"focus-card-controls\"><button id=\"focus-start\" type=\"button\" data-focus-command=\"start\" aria-label=\"Démarrer Focus\" title=\"Démarrer\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M8 5v14l11-7Z\"/></svg></button><button id=\"focus-toggle\" type=\"button\" data-focus-command=\"toggle\" aria-label=\"Mettre Focus en pause\" title=\"Pause\" hidden><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path id=\"focus-play-icon\" d=\"M6 5h4v14H6ZM14 5h4v14h-4Z\"/></svg></button><button id=\"focus-stop\" type=\"button\" data-focus-command=\"stop\" aria-label=\"Arrêter Focus\" title=\"Arrêter\" disabled><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M7 7h10v10H7Z\"/></svg></button><button id=\"focus-configure\" type=\"button\" data-focus-command=\"configure\" aria-label=\"Régler le Pomodoro\" title=\"Réglages\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M4 7h16M4 17h16M8 4v6M16 14v6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\"/></svg></button></div></div><div class=\"focus-clock-row\"><div id=\"focus-clock\" class=\"focus-clock\" role=\"timer\" aria-live=\"off\" aria-label=\"25 minutes\"></div><span class=\"focus-phase-badge\"><i aria-hidden=\"true\"></i><span id=\"focus-phase\">FOCUS</span></span></div><p id=\"focus-description\" class=\"focus-description\">Reste régulier et garde le rythme.</p><div id=\"focus-progress\" class=\"focus-progress\" role=\"progressbar\" aria-label=\"Progression de la session\" aria-valuemin=\"0\" aria-valuemax=\"100\" aria-valuenow=\"0\"><span></span></div></div><div class=\"focus-metrics\"><span class=\"focus-stat\"><small>CYCLES</small><strong id=\"focus-session\">0/4</strong></span><span id=\"focus-break-chip\" class=\"focus-stat\"><small>PAUSE</small><strong id=\"focus-break-duration\">05:00</strong></span><span id=\"focus-task-chip\" class=\"focus-stat\" hidden><small>TÂCHE</small><strong id=\"focus-task-count\"></strong></span></div></div>\n        <div id=\"focus-setup\" class=\"focus-setup\" hidden><header class=\"focus-config-heading\"><strong>Réglages Pomodoro</strong><button id=\"focus-config-back\" type=\"button\" data-focus-command=\"back\" aria-label=\"Revenir au minuteur\">Retour</button></header><label class=\"focus-duration-label\" for=\"focus-duration\">Durée de travail <strong id=\"focus-duration-value\">25 min</strong></label><div class=\"focus-ruler\"><div id=\"focus-ticks\" aria-hidden=\"true\"></div><span class=\"focus-ruler-marker\" aria-hidden=\"true\"></span><input id=\"focus-duration\" type=\"range\" min=\"1\" max=\"180\" step=\"1\" value=\"25\" aria-label=\"Durée de travail en minutes\"></div><div class=\"focus-options\"><label>Pause courte<span><input data-focus-setting=\"rest\" type=\"number\" min=\"1\" max=\"60\" value=\"5\" aria-label=\"Pause courte en minutes\"><small>min</small></span></label><label>Pause longue<span><input data-focus-setting=\"longRest\" type=\"number\" min=\"1\" max=\"180\" value=\"15\" aria-label=\"Pause longue en minutes\"><small>min</small></span></label><label>Sessions<span><input data-focus-setting=\"total\" type=\"number\" min=\"1\" max=\"12\" value=\"4\" aria-label=\"Nombre de sessions\"></span></label></div><footer class=\"focus-config-footer\"><span id=\"focus-config-status\"></span><button type=\"button\" data-focus-command=\"start\">Démarrer</button></footer></div>";
  const copy = value => JSON.parse(JSON.stringify(value));
  const time = seconds => Math.floor(Math.max(0, seconds) / 60) + ':' + String(Math.max(0, seconds) % 60).padStart(2, '0');
  // Both Focus surfaces render the same clock value; this view owns no timer.
  function renderClock(clock, seconds, {motion = false, padded = true, track = () => {}} = {}) {
    const stamp = time(seconds), value = padded ? stamp.padStart(5, '0') : stamp;
    if (clock.dataset.value === value) return;
    const cells = [...clock.children];
    const animate = (element, frames, done = () => {}) => {
      const animation = element.animate(frames, {duration: 240, easing: 'cubic-bezier(.22,1,.36,1)'});
      track(animation); animation.finished.then(done, done);
    };
    if (cells.length !== value.length) {
      clock.replaceChildren(...[...value].map(char => {
        const cell = clock.ownerDocument.createElement('span'), digit = clock.ownerDocument.createElement('span');
        cell.className = char === ':' ? 'focus-colon' : 'focus-digit'; digit.textContent = char; cell.append(digit); return cell;
      }));
    } else [...value].forEach((char, index) => {
      const cell = cells[index], digit = cell.firstElementChild;
      if (digit.textContent === char) return;
      cell.getAnimations?.({subtree: true}).forEach(animation => animation.cancel());
      while (cell.children.length > 1) cell.lastElementChild.remove();
      const previous = digit.cloneNode(true); digit.textContent = char;
      if (motion && typeof digit.animate === 'function') {
        previous.className = 'focus-digit-old'; cell.append(previous);
        animate(previous, [{transform: 'translateY(0)', opacity: 1}, {transform: 'translateY(65%)', opacity: 0}], () => previous.remove());
        animate(digit, [{transform: 'translateY(-65%)', opacity: 0}, {transform: 'translateY(0)', opacity: 1}]);
      }
    });
    clock.dataset.value = value;
  }
  function create({host, changed = () => {}, openTasks = null, openConfiguration = null, restoreTaskFocus = null, motion = true, storage, presentation = 'default', now = Date.now, setTimeout: schedule, clearTimeout: unschedule} = {}) {
    const document = host?.ownerDocument;
    if (!document) throw new TypeError('Focus nécessite un élément hôte.');
    const window = document.defaultView, reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const i18n = window.NotchyI18n;
    const t = (source, values = {}) => i18n?.t ? i18n.t(source, values) : source.replace(/\{(\w+)\}/g, (match, key) => values[key] === undefined ? match : String(values[key]));
    schedule ||= window.setTimeout.bind(window); unschedule ||= window.clearTimeout.bind(window);
    if (storage === undefined) {try {storage = window.localStorage;} catch {storage = null;}}
    let model = FocusModel.defaults(), settings = focusConfiguration(), enabled = true, hidden = false, visible = !host.hidden, disposed = false, configOpen = false, taskPickerOpen = false, pickerSignature = '', timer = 0, drag = null, taskSignature = '', taskStatusSource = '';
    const animations = new Set();
    try {const raw = storage?.getItem(STORAGE_KEY); if (raw && raw.length <= 131072) {const saved = JSON.parse(raw); model = FocusModel.restore(saved?.state, now()); settings = focusConfiguration(saved?.settings);}} catch {}
    host.innerHTML = markup;
    const $ = id => host.querySelector('#' + id), put = (id, value) => {const element = $(id); if (element.textContent !== value) element.textContent = value;};
    const splitClock = presentation === 'split'; host.dataset.focusPresentation = splitClock ? 'split' : 'default'; host.dataset.focusTasks = 'true'; host.dataset.focusPage = 'split';
    if (splitClock) {
      const card = host.querySelector('.focus-timer-card'), controls = host.querySelector('.focus-card-controls');
      const details = document.createElement('div'), heading = document.createElement('div');
      details.className = 'focus-detail-card'; heading.className = 'focus-detail-heading';
      const sceneCaption = document.createElement('span'); sceneCaption.className = 'focus-scene-caption';
      host.querySelector('.focus-phase-badge').append(sceneCaption);
      $('focus-configure').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>';
      heading.append(host.querySelector('.focus-phase-badge'), $('focus-configure'));
      const cycles = document.createElement('span'), dots = document.createElement('span');
      cycles.className = 'focus-cycle-value'; dots.className = 'focus-cycle-dots'; dots.setAttribute('aria-hidden', 'true');
      $('focus-session').before(cycles); cycles.append(dots, $('focus-session'));
      host.querySelector('.focus-stat small').textContent = 'Cycles'; $('focus-break-chip').querySelector('small').textContent = 'Pause';
      cycles.after(host.querySelector('.focus-stat small'));
      const pause = document.createElement('span'); pause.className = 'focus-break-value';
      pause.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5ZM17 11h1.5a2.5 2.5 0 0 1 0 5H17"/></svg>';
      $('focus-break-duration').before(pause); pause.append($('focus-break-duration'));
      details.append(heading, $('focus-description'), host.querySelector('.focus-metrics'));
      $('focus-stop').querySelector('path').setAttribute('d', 'M9 6h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3Z');
      const skip = document.createElement('button'); skip.id = 'focus-skip'; skip.type = 'button'; skip.dataset.focusCommand = 'skip'; skip.setAttribute('aria-label', 'Passer à la pause');
      skip.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5.5v13l9-6.5ZM17 5.5h2.5v13H17Z"/></svg>';
      controls.prepend($('focus-stop'));
      controls.append(skip);
      const clock = $('focus-clock'), progress = $('focus-progress');
      progress.className = 'focus-progress'; progress.innerHTML = '<span></span>';
      details.append(clock, progress); card.replaceChildren(details);
      const transport = document.createElement('aside'); transport.className = 'focus-transport-pane';
      const actions = document.createElement('div'); actions.className = 'focus-task-actions';
      actions.innerHTML = '<button id="focus-task-complete" type="button" data-focus-command="complete-task" aria-label="Terminée"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg><span>Terminée</span></button><button id="focus-task-next" type="button" data-focus-command="next-task" aria-label="Suivante"><span>Suivante</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>';
      transport.append(controls, actions); $('focus-active').append(transport);
    }
    const selectedTask = document.createElement('p'); selectedTask.id = 'focus-selected-task'; selectedTask.className = 'focus-selected-task';
    $('focus-description').before(selectedTask);
    const linkTask = document.createElement('button'); linkTask.id = 'focus-task-link'; linkTask.type = 'button'; linkTask.className = 'focus-task-link'; linkTask.dataset.focusCommand = 'link-task'; selectedTask.after(linkTask);
    linkTask.setAttribute('aria-expanded', 'false'); linkTask.setAttribute('aria-controls', 'focus-task-picker');
    const sessionPane = document.createElement('div'); sessionPane.className = 'focus-session-pane';
    sessionPane.append(...$('focus-active').children);
    const tasksPane = document.createElement('section'); tasksPane.className = 'focus-tasks'; tasksPane.setAttribute('aria-label', 'Tâches du Pomodoro');
    tasksPane.innerHTML = `<header class="focus-tasks-heading"><div class="focus-tasks-title"><strong>Tâches</strong><span id="focus-tasks-count"></span></div>
      <form id="focus-task-form" class="focus-task-add"><input id="focus-task-input" type="text" maxlength="500" placeholder="Ajouter une tâche" aria-label="Nouvelle tâche" autocomplete="off"><button type="submit" aria-label="Ajouter la tâche" title="Ajouter"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></form></header>
      <div id="focus-task-list" class="focus-task-list" role="list"></div><p id="focus-task-empty" class="focus-task-empty"><span class="focus-task-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12 4.5 4.5L19 7"/></svg></span><span>Une tâche suffit pour commencer. Choisis-la, puis lance le minuteur.</span></p><p id="focus-task-status" class="focus-task-status" role="status" aria-live="polite"></p>`;
    if (splitClock) {
      const transport = sessionPane.querySelector('.focus-transport-pane'), details = sessionPane.querySelector('.focus-detail-card');
      const taskCycles = document.createElement('span'); taskCycles.id = 'focus-linked-cycles'; taskCycles.className = 'focus-linked-cycles';
      details.insertBefore(linkTask, $('focus-progress')); linkTask.after(taskCycles);
      details.querySelector('.focus-detail-heading').insertBefore(details.querySelector('.focus-metrics'), $('focus-configure'));
      $('focus-active').replaceChildren(sessionPane, tasksPane, transport);
      host.dataset.focusDesign = '22.6';
    } else $('focus-active').replaceChildren(sessionPane, tasksPane);
    const picker = document.createElement('section'); picker.id = 'focus-task-picker'; picker.className = 'focus-task-picker'; picker.hidden = true;
    picker.setAttribute('role', 'dialog'); picker.setAttribute('aria-label', 'Lier une tâche');
    picker.innerHTML = '<header><strong>Lier une tâche</strong><button type="button" data-focus-picker-close aria-label="Fermer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg></button></header><div class="focus-task-picker-list" role="listbox" aria-label="Tâches du Pomodoro"></div><button type="button" class="focus-task-manage" data-focus-picker-manage>Afficher les tâches</button>';
    $('focus-active').append(picker);
    const configActions = document.createElement('div'); configActions.className = 'focus-config-actions';
    configActions.innerHTML = '<button type="button" data-focus-command="stop" aria-label="Arrêter Focus">Arrêter</button><button type="button" data-focus-command="skip" aria-label="Passer à la prochaine phase">Passer</button>';
    $('focus-setup').querySelector('.focus-config-footer').append(configActions);
    const staticCopy = [];
    const words = document.createTreeWalker(host, 4);
    for (let node = words.nextNode(); node; node = words.nextNode()) if (node.textContent.trim()) staticCopy.push({node, source: node.textContent.trim(), leading: node.textContent.match(/^\s*/)[0], trailing: node.textContent.match(/\s*$/)[0]});
    for (const element of host.querySelectorAll('[aria-label],[title],[placeholder]')) {
      for (const attribute of ['aria-label', 'title', 'placeholder']) if (element.hasAttribute(attribute)) staticCopy.push({node: element, attribute, source: element.getAttribute(attribute)});
    }
    const translateStatic = () => {
      for (const {node, attribute, source, leading = '', trailing = ''} of staticCopy) if (attribute) node.setAttribute(attribute, t(source)); else node.textContent = leading + t(source) + trailing;
    };
    translateStatic();
    const active = () => !model.pomodoro?.finished && (model.sessionActive || !!model.deadline);
    const label = () => t(model.pomodoro?.phase === 'break' ? model.pomodoro.breakKind === 'long' ? 'Pause longue' : 'Pause courte' : 'Concentration');
    const usable = () => enabled && !hidden && !document.hidden && !disposed;
    const motionEnabled = () => (typeof motion === 'function' ? motion() : motion) !== false && !reduced.matches;
    const save = () => {try {storage?.setItem(STORAGE_KEY, JSON.stringify({state: model, settings}));} catch {}};
    function stopAnimations() {for (const animation of animations) animation.cancel(); animations.clear(); for (const old of host.querySelectorAll('.focus-digit-old')) old.remove();}
    function renderDigits(seconds) {
      const clock = $('focus-clock');
      clock.setAttribute('aria-label', t('{minutes} minutes {seconds} secondes', {minutes: Math.floor(seconds / 60), seconds: seconds % 60}));
      renderClock(clock, seconds, {padded: splitClock, motion: usable() && visible && !configOpen && host.dataset.focusPage !== 'tasks' && motionEnabled(),
        track(animation) {animations.add(animation); animation.finished.then(() => animations.delete(animation), () => animations.delete(animation));}});
    }
    function closeTaskPicker(restoreFocus = false) {
      if (!taskPickerOpen) return;
      taskPickerOpen = false; $('focus-task-picker').hidden = true; $('focus-task-link').setAttribute('aria-expanded', 'false');
      if (restoreFocus && visible && !host.hidden) $('focus-task-link').focus({preventScroll: true});
    }
    function renderTaskPicker() {
      const picker = $('focus-task-picker'); picker.hidden = !taskPickerOpen;
      $('focus-task-link').setAttribute('aria-expanded', String(taskPickerOpen));
      if (!taskPickerOpen) return;
      const signature = JSON.stringify([model.tasks, model.activeTaskId, i18n?.locale?.()]);
      if (signature === pickerSignature) return; pickerSignature = signature;
      const list = picker.querySelector('.focus-task-picker-list'), focused = document.activeElement;
      const restore = list.contains(focused) ? focused.dataset.focusPickerTask : undefined, scrollTop = list.scrollTop;
      const option = (id, title) => {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.focusPickerTask = id;
        button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String((model.activeTaskId || '') === id));
        button.textContent = title; button.title = title; return button;
      };
      list.replaceChildren(option('', t('Focus libre')), ...model.tasks.filter(task => !task.done).map(task => option(task.id, task.title)));
      list.scrollTop = scrollTop;
      if (restore !== undefined) ([...list.children].find(button => button.dataset.focusPickerTask === restore) || list.firstElementChild)?.focus({preventScroll: true});
    }
    function openTaskPicker() {
      configOpen = false; taskPickerOpen = true; pickerSignature = ''; render();
      const list = $('focus-task-picker').querySelector('.focus-task-picker-list');
      (list.querySelector('[aria-selected="true"]') || list.firstElementChild)?.focus({preventScroll: true});
    }
    function pickerKeydown(event) {
      if (!taskPickerOpen || !host.contains(event.target)) return;
      if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); closeTaskPicker(true); render(); return;}
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(event.key)) return;
      const picker = $('focus-task-picker'), options = [...picker.querySelectorAll('[data-focus-picker-task]')];
      if (event.key === 'Tab') {
        const buttons = [...picker.querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(document.activeElement);
        if (event.shiftKey && index === 0 || !event.shiftKey && index === buttons.length - 1) {event.preventDefault(); buttons[event.shiftKey ? buttons.length - 1 : 0].focus();}
        return;
      }
      event.preventDefault(); event.stopPropagation();
      const index = options.indexOf(document.activeElement), next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      options[next]?.focus();
    }
    function stopTimer() {if (timer) unschedule(timer); timer = 0;}
    function queue() {
      if (!usable() || !model.deadline) {stopTimer(); return;}
      if (!timer) timer = schedule(() => {timer = 0; render();}, Math.max(20, (model.deadline - now()) % 1000 || 1000));
    }
    function summary() {const card = focusCardValues(model, settings, now(), t); return {...card, label: label(), running: !!model.deadline, time: time(card.seconds), configOpen, taskPickerOpen};}
    function renderTasks() {
      put('focus-selected-task', model.complete ? t('Cycle terminé') : model.pomodoro?.phase === 'break' ? label() : model.task || t('À ton rythme'));
      put('focus-task-link', model.task || t('Lier une tâche'));
      $('focus-task-link').setAttribute('aria-label', model.task ? t('Changer la tâche liée : {task}', {task: model.task}) : t('Lier une tâche'));
      put('focus-task-status', t(taskStatusSource));
      put('focus-tasks-count', `${model.tasks.filter(task => task.done).length}/${model.tasks.length}`);
      $('focus-task-empty').hidden = model.tasks.length > 0;
      const limited = model.tasks.length >= 100; $('focus-task-input').disabled = limited; $('focus-task-form').querySelector('button').disabled = limited;
      const signature = JSON.stringify([model.tasks, model.activeTaskId]); if (signature === taskSignature) return; taskSignature = signature;
      const focused = document.activeElement, restore = host.contains(focused) && focused?.dataset?.focusTaskAction ? {action: focused.dataset.focusTaskAction, id: focused.dataset.taskId} : null;
      const scrollTop = $('focus-task-list').scrollTop;
      const rows = model.tasks.map(task => {
        const row = document.createElement('div'); row.className = 'focus-task-row'; row.setAttribute('role', 'listitem'); row.classList.toggle('current', task.id === model.activeTaskId); row.classList.toggle('done', task.done);
        const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'focus-task-check'; toggle.dataset.focusTaskAction = 'toggle'; toggle.dataset.taskId = task.id;
        toggle.setAttribute('role', 'checkbox'); toggle.setAttribute('aria-checked', String(task.done)); toggle.setAttribute('aria-label', t(task.done ? 'Rouvrir : {task}' : 'Terminer : {task}', {task: task.title}));
        toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
        const select = document.createElement('button'); select.type = 'button'; select.className = 'focus-task-select'; select.dataset.focusTaskAction = 'select'; select.dataset.taskId = task.id; select.textContent = task.title;
        select.title = task.title; select.disabled = task.done; select.setAttribute('aria-pressed', String(task.id === model.activeTaskId)); select.setAttribute('aria-label', t('Choisir pour Focus : {task}', {task: task.title}));
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'focus-task-remove'; remove.dataset.focusTaskAction = 'delete'; remove.dataset.taskId = task.id; remove.setAttribute('aria-label', t('Supprimer : {task}', {task: task.title}));
        remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>';
        const cycles = document.createElement('span'); cycles.className = 'focus-task-cycles'; cycles.textContent = `${task.completedCycles || 0}/${task.estimatedCycles || 1}`; cycles.title = t('{completed} sur {estimated} cycles', {completed: task.completedCycles || 0, estimated: task.estimatedCycles || 1});
        row.append(toggle, select, cycles, remove); return row;
      });
      $('focus-task-list').replaceChildren(...rows); $('focus-task-list').scrollTop = scrollTop;
      if (restore) ([...$('focus-task-list').querySelectorAll('[data-focus-task-action]')].find(button => button.dataset.taskId === restore.id && button.dataset.focusTaskAction === restore.action && !button.disabled) || $('focus-task-input')).focus({preventScroll: true});
    }
    function render(notify = true, event = null) {
      if (disposed) return;
      const change = FocusModel.tick(model, now()); if (change.changed) save();
      const card = summary(), {active, seconds, progress} = card;
      host.style.setProperty('--focus-progress', String(progress)); host.dataset.focusPhase = model.pomodoro?.phase || 'work'; host.dataset.focusComplete = String(!!model.complete);
      $('focus-setup').hidden = !configOpen; $('focus-active').hidden = configOpen;
      put('focus-phase', card.badge); put('focus-description', card.description); put('focus-session', `${card.completed}/${card.total}`); put('focus-break-duration', card.pause);
      if (splitClock) {
        const dots = host.querySelector('.focus-cycle-dots');
        if (dots.children.length !== card.total) dots.replaceChildren(...Array.from({length: card.total}, () => document.createElement('i')));
        [...dots.children].forEach((dot, index) => dot.classList.toggle('completed', index < card.completed));
        put('focus-description', model.complete ? t('Prends un moment pour toi.') : card.description);
        host.querySelector('.focus-scene-caption').textContent = (model.pomodoro?.phase === 'break' ? t('PAUSE') : t('FOCUS')) + ' · ' + t('CYCLE') + ' ' + (model.pomodoro?.session || 1) + '/' + card.total;
        const linked = model.tasks.find(task => task.id === model.activeTaskId && !task.done);
        put('focus-linked-cycles', linked ? t('{completed} sur {estimated} cycles', {completed: linked.completedCycles || 0, estimated: linked.estimatedCycles || 1}) : t('Focus libre'));
        $('focus-task-complete').disabled = !linked; $('focus-task-next').disabled = !model.tasks.some(task => !task.done && task.id !== model.activeTaskId);
        $('focus-skip').disabled = !active || !model.pomodoro;
        const skipLabel = model.pomodoro?.phase === 'break' ? model.pomodoro.breakKind === 'long' ? 'Terminer le cycle' : 'Passer à la session suivante' : 'Passer à la pause';
        $('focus-skip').setAttribute('aria-label', t(skipLabel)); $('focus-skip').title = t(skipLabel);
      }
      $('focus-break-chip').title = card.pauseLabel; $('focus-active').dataset.phase = model.pomodoro?.phase || 'work';
      host.dataset.focusBreak = model.pomodoro?.phase === 'break' ? model.pomodoro.breakKind : 'none'; renderTasks(); renderTaskPicker();
      $('focus-active').setAttribute('aria-label', t('Minuteur Pomodoro · {phase} · {completed} cycles terminés sur {total}', {phase: card.badge, completed: card.completed, total: card.total}));
      $('focus-task-chip').hidden = !card.task; $('focus-task-chip').title = card.task; put('focus-task-count', card.task ? '01' : '');
      $('focus-start').hidden = active; $('focus-toggle').hidden = !active; $('focus-stop').disabled = !active && !model.complete;
      ($('focus-progress').querySelector('.focus-session-progress') || $('focus-progress').firstElementChild).style.transition = usable() && visible && host.dataset.focusPage !== 'tasks' && motionEnabled() ? '' : 'none';
      $('focus-progress').setAttribute('aria-valuenow', String(Math.round(progress * 100)));
      $('focus-progress').setAttribute('aria-valuetext', t('{minutes} minutes {seconds} secondes', {minutes: Math.floor(seconds / 60), seconds: seconds % 60})); renderDigits(seconds);
      const paused = !model.deadline;
      $('focus-toggle').setAttribute('aria-label', t(paused ? 'Reprendre Focus' : 'Mettre Focus en pause')); $('focus-toggle').title = t(paused ? 'Reprendre' : 'Pause');
      $('focus-play-icon').setAttribute('d', paused ? 'M8 5v14l11-7Z' : 'M6 5h4v14H6ZM14 5h4v14h-4Z');
      put('focus-config-status', t(active ? 'Les durées restent fixes pendant le cycle en cours.' : 'Les pauses s’enchaînent automatiquement.'));
      for (const input of $('focus-setup').querySelectorAll('input')) input.disabled = active;
      host.querySelector('#focus-setup [data-focus-command="start"]').disabled = active;
      configActions.querySelector('[data-focus-command="stop"]').disabled = !active && !model.complete;
      configActions.querySelector('[data-focus-command="skip"]').disabled = !active || !model.pomodoro;
      $('focus-duration').value = String(settings.work); $('focus-duration').setAttribute('aria-valuetext', t('{minutes} minutes', {minutes: settings.work})); put('focus-duration-value', settings.work + ' min');
      for (const input of host.querySelectorAll('[data-focus-setting]')) input.value = settings[input.dataset.focusSetting];
      const ticks = $('focus-ticks');
      if (ticks.dataset.value !== String(settings.work)) {
        ticks.dataset.value = settings.work; ticks.replaceChildren();
        for (let minute = settings.work - 12; minute <= settings.work + 12; minute++) {const tick = document.createElement('i'); tick.className = minute % 5 === 0 ? 'major' : ''; if (minute <= settings.work) tick.classList.add('past'); if (minute < 1 || minute > 180) tick.style.visibility = 'hidden'; if (minute % 5 === 0) {const label = document.createElement('span'); label.textContent = minute; tick.append(label);} ticks.append(tick);}
      }
      queue();
      if (notify) changed({state: copy(model), settings: {...settings}, card, ...(event ? {event} : {})});
      return card;
    }
    function command(value) {
      if (disposed) return false;
      const boundary = FocusModel.tick(model, now());
      if (boundary.changed) {save(); render();}
      // A click at an expired phase must not skip the new phase a second time.
      if (value === 'skip' && boundary.changed) {if (!active()) $(configOpen ? 'focus-config-back' : 'focus-start').focus({preventScroll: true}); return true;}
      if (value === 'configure') {closeTaskPicker(); if (typeof openConfiguration === 'function') openConfiguration(); configOpen = true; stopAnimations(); render(); $('focus-config-back').focus({preventScroll: true}); return true;}
      if (value === 'back') {configOpen = false; render(); $('focus-configure').focus({preventScroll: true}); return true;}
      if (value === 'link-task') {openTaskPicker(); return true;}
      if (value === 'complete-task') {
        const initiatedHere = document.activeElement?.matches?.('#focus-task-complete,[data-scene-command="focus-complete-task"]') === true;
        const accepted = model.activeTaskId ? tasks({type: 'toggle', id: model.activeTaskId}) : false;
        if (accepted && initiatedHere) {
          if (typeof restoreTaskFocus === 'function') restoreTaskFocus();
          else if (!host.hidden && visible) $('focus-task-link').focus({preventScroll: true});
        }
        return accepted;
      }
      if (value === 'next-task') {
        const index = model.tasks.findIndex(task => task.id === model.activeTaskId);
        const ordered = [...model.tasks.slice(index + 1), ...model.tasks.slice(0, Math.max(0, index))];
        const next = ordered.find(task => !task.done && task.id !== model.activeTaskId);
        return next ? tasks({type: 'select', id: next.id}) : false;
      }
      if (value === 'start' && !active()) {
        if (![...$('focus-setup').querySelectorAll('input')].every(input => input.reportValidity())) return false;
        settings = focusConfiguration({work: Number($('focus-duration').value), ...Object.fromEntries([...host.querySelectorAll('[data-focus-setting]')].map(input => [input.dataset.focusSetting, Number(input.value)]))});
        model = {...FocusModel.defaults(), tasks: model.tasks, activeTaskId: model.activeTaskId, task: model.task, taskPrompt: model.taskPrompt, minutes: settings.work, remaining: settings.work * 60, sessionActive: true, deadline: now() + settings.work * 60000, pomodoro: {...settings, phase: 'work', session: 1}}; configOpen = false;
      } else if (value === 'toggle' && active()) {if (model.deadline) {model.remaining = FocusModel.remaining(model, now()); model.deadline = null;} else model.deadline = now() + model.remaining * 1000;}
      else if (value === 'skip' && active() && model.pomodoro) {
        const paused = !model.deadline;
        model.deadline = null; model.remaining = 0; model.complete = true; model.sessionActive = false;
        if (FocusModel.nextPhase(model, now()) && paused) model.deadline = null;
      }
      else if (value === 'stop') model = {...FocusModel.defaults(), tasks: model.tasks, activeTaskId: model.activeTaskId, task: model.task, minutes: settings.work, remaining: settings.work * 60};
      else return false;
      stopTimer(); save(); render();
      if (value === 'start') $('focus-toggle').focus({preventScroll: true}); else if (value === 'stop' || value === 'skip' && !active()) $(configOpen ? 'focus-config-back' : 'focus-start').focus({preventScroll: true});
      return true;
    }
    function tasks(action) {
      if (disposed) return false;
      const boundary = FocusModel.tick(model, now());
      const completedTask = ['toggle', 'confirm-complete'].includes(action?.type) ? model.tasks.find(task => task.id === action.id && !task.done) : null;
      const id = action?.type === 'add' ? window.crypto?.randomUUID?.() || `task-${now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` : '';
      if (!FocusModel.taskAction(model, action, id)) {if (boundary.changed) {save(); render();} return false;}
      save(); render(true, completedTask ? {kind: 'task-complete', taskId: completedTask.id, title: 'Tâche terminée', detail: completedTask.title} : null); return true;
    }
    function submitTask(event) {
      event.preventDefault(); const input = $('focus-task-input');
      if (tasks({type: 'add', title: input.value})) {input.value = ''; taskStatusSource = 'Tâche ajoutée.'; if (!input.disabled) input.focus({preventScroll: true});}
      else taskStatusSource = model.tasks.length >= 100 ? '100 tâches : retire une tâche pour en ajouter une.' : 'Écris le nom de ta tâche.';
      put('focus-task-status', t(taskStatusSource));
    }
    function click(event) {
      const option = event.target.closest('[data-focus-picker-task]');
      if (option && host.contains(option)) {const id = option.dataset.focusPickerTask; closeTaskPicker(true); tasks(id ? {type: 'select', id} : {type: 'unlink'}); return;}
      if (event.target.closest('[data-focus-picker-close]')) {closeTaskPicker(true); render(); return;}
      if (event.target.closest('[data-focus-picker-manage]')) {closeTaskPicker(); if (openTasks) openTasks(); else setPage('tasks'); return;}
      const task = event.target.closest('[data-focus-task-action]');
      if (task && host.contains(task) && !task.disabled) {tasks({type: task.dataset.focusTaskAction, id: task.dataset.taskId}); return;}
      const button = event.target.closest('[data-focus-command]'); if (button && host.contains(button) && !button.disabled) command(button.dataset.focusCommand);
    }
    function input(event) {
      if (disposed || active()) return;
      const key = event.target.id === 'focus-duration' ? 'work' : event.target.dataset.focusSetting;
      if (!key || !event.target.checkValidity()) return;
      settings = focusConfiguration({...settings, [key]: Number(event.target.value)}); save(); render();
    }
    function wheel(event) {if (disposed || active()) return; event.preventDefault(); settings.work = Math.max(1, Math.min(180, settings.work + Math.sign(event.deltaY))); save(); render();}
    function pointerDown(event) {if (disposed || active() || event.button !== 0) return; event.preventDefault(); drag = {x: event.clientX, work: settings.work, id: event.pointerId}; event.target.setPointerCapture(event.pointerId);}
    function pointerMove(event) {if (!drag || drag.id !== event.pointerId) return; const value = Math.max(1, Math.min(180, drag.work - Math.round((event.clientX - drag.x) / 8))); if (value !== settings.work) {settings.work = value; render();}}
    function pointerUp(event) {if (!drag || drag.id !== event.pointerId) return; drag = null; save();}
    function lifecycle(value = {}) {
      if (disposed) return;
      if (typeof value.enabled === 'boolean') enabled = value.enabled; if (typeof value.hidden === 'boolean') hidden = value.hidden; if (typeof value.visible === 'boolean') visible = value.visible;
      if (!usable() || !visible) closeTaskPicker();
      if (!usable() || !visible || !motionEnabled()) stopAnimations(); render();
    }
    function setPage(page) {
      if (disposed || !['focus', 'tasks', 'split'].includes(page)) return false;
      if (host.dataset.focusPage === page) return true;
      closeTaskPicker(); stopAnimations(); host.dataset.focusPage = page;
      if (page === 'tasks') configOpen = false;
      render(); return true;
    }
    const wake = () => {if (document.hidden || !motionEnabled()) stopAnimations(); render();};
    function preview() {
      const card = $('focus-active').cloneNode(true); card.removeAttribute('hidden'); card.removeAttribute('id'); card.style.setProperty('--focus-progress', String(summary().progress));
      card.classList.add('focus-preview'); card.dataset.focusPresentation = splitClock ? 'split' : 'default';
      card.dataset.focusBreak = host.dataset.focusBreak; card.dataset.focusComplete = host.dataset.focusComplete;
      card.style.setProperty('--focus-accent', model.complete || model.pomodoro?.breakKind === 'long' ? '#bf8bff' : model.pomodoro?.phase === 'break' ? '#6fe3c4' : '#5ac8fa');
      card.querySelector('.focus-tasks')?.remove(); card.querySelector('.focus-card-controls')?.remove(); for (const element of card.querySelectorAll('button,.focus-digit-old,.focus-progress-labels,.focus-cycle-dots')) element.remove();
      for (const element of card.querySelectorAll('[id],[data-focus-command]')) {element.removeAttribute('id'); element.removeAttribute('data-focus-command');}
      return card;
    }
    const ruler = $('focus-duration');
    host.addEventListener('click', click); host.addEventListener('keydown', pickerKeydown); host.addEventListener('input', input); $('focus-task-form').addEventListener('submit', submitTask); ruler.addEventListener('wheel', wheel, {passive: false});
    ruler.addEventListener('pointerdown', pointerDown); ruler.addEventListener('pointermove', pointerMove); ruler.addEventListener('pointerup', pointerUp); ruler.addEventListener('pointercancel', pointerUp);
    document.addEventListener('visibilitychange', wake); reduced.addEventListener('change', wake);
    const unsubscribeLanguage = i18n?.onChange?.(() => {if (disposed) return; translateStatic(); taskSignature = ''; render();});
    function dispose() {
      if (disposed) return; disposed = true; stopTimer(); stopAnimations(); drag = null;
      host.removeEventListener('click', click); host.removeEventListener('keydown', pickerKeydown); host.removeEventListener('input', input); $('focus-task-form').removeEventListener('submit', submitTask); ruler.removeEventListener('wheel', wheel);
      ruler.removeEventListener('pointerdown', pointerDown); ruler.removeEventListener('pointermove', pointerMove); ruler.removeEventListener('pointerup', pointerUp); ruler.removeEventListener('pointercancel', pointerUp);
      document.removeEventListener('visibilitychange', wake); reduced.removeEventListener('change', wake);
      unsubscribeLanguage?.();
    }
    render(false);
    return Object.freeze({render, lifecycle, setPage, summary, preview, dispose, command, tasks, getState: () => copy(model), getSettings: () => ({...settings}),
      inspect: () => ({page: host.dataset.focusPage, active: active(), running: !!model.deadline, seconds: FocusModel.remaining(model, now()), phase: model.pomodoro ? {...model.pomodoro} : null, configuration: {...settings}, complete: model.complete, timerActive: !!timer, configOpen, taskPickerOpen, tasksCount: model.tasks.length, activeTaskId: model.activeTaskId, disposed})});
  }
  function createTasks({host, focus, expand = () => {}} = {}) {
    const document = host?.ownerDocument;
    if (!document || !focus?.getState || !focus?.tasks) throw new TypeError('Tâches nécessite le modèle Focus partagé.');
    const i18n = document.defaultView.NotchyI18n;
    const t = (source, values = {}) => i18n?.t ? i18n.t(source, values) : source.replace(/\{(\w+)\}/g, (match, key) => values[key] === undefined ? match : String(values[key]));
    const icon = (path, filled = false) => `<svg viewBox="0 0 24 24" aria-hidden="true"${filled ? ' class="is-filled"' : ''}><path d="${path}"/></svg>`;
    const check = icon('M5 12.5l4.5 4.5L19 7.5'), plus = icon('M12 5v14M5 12h14');
    const timer = icon('M12 9.5v4l2.5 1.5M9.5 3h5M12 3v3M19.5 13.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0');
    let disposed = false, signature = '', status = '';
    host.classList.add('tasks-module');
    host.innerHTML = `<div class="tasks-list-pane"><header class="tasks-module-heading"><strong></strong><span data-tasks-count></span><button type="button" class="tasks-unlink" data-task-action="unlink"></button></header>
      <div class="tasks-module-list" role="list"></div><p class="tasks-module-empty"></p></div>
      <aside class="tasks-current"><div class="tasks-current-copy"><div class="tasks-current-caption"><span></span><small data-tasks-small-count></small></div>
      <button type="button" class="tasks-current-title" data-task-action="expand"></button><button type="button" class="tasks-cycle-dots" data-task-action="estimate"></button>
      <label class="tasks-estimate-label"><span></span><input data-tasks-estimate type="number" min="1" max="12" step="1"></label><small class="tasks-cycle-description"></small></div>
      <button type="button" class="tasks-start" data-task-action="start">${timer}<span></span></button><button type="button" class="tasks-small-add" data-task-action="expand">${plus}</button></aside>
      <form class="tasks-module-add" data-tasks-form><span aria-hidden="true">${plus}</span><input data-tasks-input type="text" maxlength="500" autocomplete="off"><button type="submit">${plus}</button></form>
      <p class="tasks-module-status" role="status" aria-live="polite"></p>`;
    const $ = selector => host.querySelector(selector), list = $('.tasks-module-list');
    function cycleDots(button, task) {
      button.replaceChildren();
      if (!task) return;
      const estimated = task.estimatedCycles || 1, completed = task.completedCycles || 0;
      for (let index = 0; index < estimated; index++) {const dot = document.createElement('i'); dot.classList.toggle('completed', index < completed); button.append(dot);}
      button.dataset.taskId = task.id;
      button.setAttribute('aria-label', t('Estimation pour {task} : {cycles} cycles. Cliquer pour ajuster.', {task: task.title, cycles: estimated}));
      button.title = t('{completed} sur {estimated} cycles', {completed, estimated});
    }
    function render() {
      if (disposed) return;
      const state = focus.getState(), selected = state.tasks.find(task => task.id === state.activeTaskId && !task.done), current = selected || state.tasks.find(task => !task.done);
      const done = state.tasks.filter(task => task.done).length, count = `${done} / ${state.tasks.length}`, presentation = host.dataset.presentation || 'full';
      host.dataset.presentation = presentation; host.dataset.taskEmpty = String(!current);
      $('.tasks-module-heading > strong').textContent = t('Tâches');
      $('[data-tasks-count]').textContent = count + (presentation === 'full' ? ' · ' + t('aujourd’hui') : '');
      $('[data-tasks-small-count]').textContent = count;
      $('.tasks-unlink').hidden = !state.activeTaskId; $('.tasks-unlink').textContent = t('Focus libre'); $('.tasks-unlink').setAttribute('aria-label', t('Continuer en Focus libre'));
      $('.tasks-current-caption > span').textContent = t(selected ? 'EN COURS' : 'PROCHAINE TÂCHE');
      $('.tasks-current-title').textContent = current?.title || t('Choisis ta prochaine tâche');
      $('.tasks-current-title').title = current?.title || '';
      cycleDots($('.tasks-current .tasks-cycle-dots'), current);
      $('.tasks-current .tasks-cycle-dots').hidden = !current;
      const estimate = $('[data-tasks-estimate]');
      if (document.activeElement !== estimate) estimate.value = String(current?.estimatedCycles || 1);
      estimate.disabled = !current; estimate.dataset.taskId = current?.id || '';
      estimate.setAttribute('aria-label', t('Cycles estimés')); $('.tasks-estimate-label > span').textContent = t('Cycles estimés');
      $('.tasks-cycle-description').textContent = current ? t('{completed} sur {estimated} cycles estimés', {completed: current.completedCycles || 0, estimated: current.estimatedCycles || 1}) : '';
      const start = $('.tasks-start'); start.disabled = !current; start.dataset.taskId = current?.id || '';
      const paused = focus.summary().paused;
      start.querySelector('span').textContent = t(paused ? 'Reprendre' : presentation === 'full' ? 'Démarrer un focus' : 'Démarrer');
      start.setAttribute('aria-label', current ? t(paused ? 'Reprendre Focus : {task}' : 'Démarrer un focus : {task}', {task: current.title}) : t('Démarrer un focus'));
      $('.tasks-small-add').setAttribute('aria-label', t('Ajouter une tâche')); $('.tasks-current-title').setAttribute('aria-label', t('Afficher les tâches'));
      const input = $('[data-tasks-input]'); input.placeholder = t('Ajouter une tâche'); input.setAttribute('aria-label', t('Nouvelle tâche')); input.disabled = state.tasks.length >= 100;
      $('[data-tasks-form] button').disabled = input.disabled; $('[data-tasks-form] button').setAttribute('aria-label', t('Ajouter la tâche'));
      $('.tasks-module-empty').hidden = state.tasks.length > 0; $('.tasks-module-empty').textContent = t('Une tâche suffit pour commencer.');
      $('.tasks-module-status').textContent = t(status);
      const next = JSON.stringify([state.tasks, state.activeTaskId, i18n?.locale?.()]);
      if (next === signature) return;
      signature = next;
      const focused = document.activeElement, restore = host.contains(focused) && focused?.dataset?.taskId ? {id: focused.dataset.taskId, action: focused.dataset.taskAction} : null;
      const scrollTop = list.scrollTop;
      list.replaceChildren(...state.tasks.map(task => {
        const row = document.createElement('div'); row.className = 'tasks-module-row'; row.dataset.taskId = task.id; row.setAttribute('role', 'listitem'); row.classList.toggle('is-current', task.id === state.activeTaskId); row.classList.toggle('is-done', task.done);
        const button = (action, className) => {const node = document.createElement('button'); node.type = 'button'; node.dataset.taskAction = action; node.dataset.taskId = task.id; node.className = className; return node;};
        const toggle = button('toggle', 'tasks-module-check'); toggle.setAttribute('role', 'checkbox'); toggle.setAttribute('aria-checked', String(task.done)); toggle.setAttribute('aria-label', t(task.done ? 'Rouvrir : {task}' : 'Terminer : {task}', {task: task.title})); toggle.innerHTML = check;
        const select = button('select', 'tasks-module-select'); select.textContent = task.title; select.title = task.title; select.disabled = task.done; select.setAttribute('aria-pressed', String(task.id === state.activeTaskId)); select.setAttribute('aria-label', t('Choisir pour Focus : {task}', {task: task.title}));
        const cycles = button('estimate', 'tasks-cycle-dots'); cycleDots(cycles, task);
        const active = document.createElement('span'); active.className = 'tasks-module-active'; active.hidden = task.id !== state.activeTaskId; active.innerHTML = timer; active.setAttribute('aria-label', t('Tâche liée à Focus'));
        const remove = button('delete', 'tasks-module-delete'); remove.setAttribute('aria-label', t('Supprimer : {task}', {task: task.title})); remove.innerHTML = icon('M7 7l10 10M17 7 7 17');
        row.append(toggle, select, cycles, active, remove); return row;
      }));
      list.scrollTop = scrollTop;
      if (restore) ([...host.querySelectorAll('[data-task-action]')].find(button => button.dataset.taskId === restore.id && button.dataset.taskAction === restore.action && !button.disabled) || input).focus({preventScroll: true});
    }
    function click(event) {
      const button = event.target.closest('[data-task-action]'); if (disposed || !button || !host.contains(button) || button.disabled) return;
      const action = button.dataset.taskAction, id = button.dataset.taskId;
      if (action === 'expand') {expand(); return;}
      if (action === 'start') {
        if (focus.tasks({type: 'select', id})) {const card = focus.summary(); if (!card.active) focus.command('start'); else if (card.paused) focus.command('toggle');}
      }
      else if (action === 'estimate') {const task = focus.getState().tasks.find(task => task.id === id); if (task) focus.tasks({type: 'estimate', id, estimatedCycles: (task.estimatedCycles || 1) % 12 + 1});}
      else focus.tasks({type: action, id});
      render();
    }
    function submit(event) {
      if (disposed) return; event.preventDefault(); const input = $('[data-tasks-input]');
      if (focus.tasks({type: 'add', title: input.value})) {input.value = ''; status = 'Tâche ajoutée.';}
      else status = focus.getState().tasks.length >= 100 ? '100 tâches : retire une tâche pour en ajouter une.' : 'Écris le nom de ta tâche.';
      render(); if (!input.disabled) input.focus({preventScroll: true});
    }
    function estimate(event) {
      const input = event.target; if (disposed || !input.matches('[data-tasks-estimate]') || !input.checkValidity()) return;
      focus.tasks({type: 'estimate', id: input.dataset.taskId, estimatedCycles: Number(input.value)}); render();
    }
    host.addEventListener('click', click); host.addEventListener('change', estimate); $('[data-tasks-form]').addEventListener('submit', submit);
    const unsubscribe = i18n?.onChange?.(render);
    render();
    return Object.freeze({render, focusInput() {$('[data-tasks-input]').focus({preventScroll: true});}, inspect: () => ({count: focus.getState().tasks.length, activeTaskId: focus.getState().activeTaskId, presentation: host.dataset.presentation, disposed}),
      dispose() {if (disposed) return; disposed = true; host.removeEventListener('click', click); host.removeEventListener('change', estimate); $('[data-tasks-form]').removeEventListener('submit', submit); unsubscribe?.();}});
  }
  function mountLab(document) {
    const window = document.defaultView, host = document.getElementById('focus-player');
    let seed = null, motion = true;
    try {seed = window.localStorage.getItem(STORAGE_KEY); const appearance = JSON.parse(window.localStorage.getItem('notchy-minimal-appearance-v1')); motion = appearance?.motion !== false;} catch {}
    const memory = {getItem: () => seed, setItem: (_key, value) => {seed = value;}};
    const focus = create({host, storage: memory, motion, presentation: 'split'}); focus.lifecycle({enabled: true, visible: true, hidden: false});
    window.notchyFocusLab = focus; window.addEventListener('pagehide', () => focus.dispose(), {once: true});
    return focus;
  }
  return {FocusModel, focusConfiguration, focusCardValues, renderClock, create, createTasks, mountLab, STORAGE_KEY};
});
