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
 const defaults = () => ({task: '', tasks: [], activeTaskId: null, minutes: 25, remaining: 1500, deadline: null, complete: false, sessionActive: false});
 const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
 const taskId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value);
 const taskTitle = value => typeof value === 'string' ? value.trim().slice(0, 500) : '';
 function restoreTasks(input) {
  const tasks = [], seen = new Set();
  if (Array.isArray(input.tasks)) {
   for (const item of input.tasks.slice(0, 100)) {
    if (!item || typeof item !== 'object' || !taskId(item.id) || seen.has(item.id)) continue;
    const title = taskTitle(item.title); if (!title) continue;
    tasks.push({id: item.id, title, done: item.done === true}); seen.add(item.id);
   }
  } else if (taskTitle(input.task)) tasks.push({id: 'legacy-task', title: taskTitle(input.task), done: false});
  const activeTaskId = tasks.find(item => !item.done && item.id === input.activeTaskId)?.id || (!Array.isArray(input.tasks) ? tasks[0]?.id : null) || null;
  return {tasks, activeTaskId, task: tasks.find(item => item.id === activeTaskId)?.title || ''};
 }
 function taskAction(state, action, id = '') {
  if (!state || !Array.isArray(state.tasks) || !action || typeof action !== 'object') return false;
  const item = state.tasks.find(task => task.id === action.id);
  if (action.type === 'add') {
   const title = taskTitle(action.title);
   if (!title || !taskId(id) || state.tasks.length >= 100 || state.tasks.some(task => task.id === id)) return false;
   state.tasks.push({id, title, done: false}); if (!state.activeTaskId) state.activeTaskId = id;
  } else if (action.type === 'select' && item && !item.done) state.activeTaskId = item.id;
  else if (action.type === 'toggle' && item) {item.done = !item.done; if (item.done && state.activeTaskId === item.id) state.activeTaskId = null;}
  else if (action.type === 'delete' && item) {state.tasks = state.tasks.filter(task => task.id !== item.id); if (state.activeTaskId === item.id) state.activeTaskId = null;}
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
  const result={changed:false,phaseChanged:false,finished:false};
  // A paused phase has no deadline. It cannot advance because wall time passed.
  if(!state.deadline&&!state.complete)return result;
  if(state.pomodoro?.finished)return result;
  for(let count=0;count<26;count++){
   const legacyBoundary=!!state.pomodoro&&state.complete&&!state.deadline;
   if(!legacyBoundary&&(!state.deadline||remaining(state,now)>0))break;
   const boundary=legacyBoundary?now:state.deadline;
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
  function create({host, changed = () => {}, motion = true, storage, presentation = 'default', now = Date.now, setTimeout: schedule, clearTimeout: unschedule} = {}) {
    const document = host?.ownerDocument;
    if (!document) throw new TypeError('Focus nécessite un élément hôte.');
    const window = document.defaultView, reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const i18n = window.NotchyI18n;
    const t = (source, values = {}) => i18n?.t ? i18n.t(source, values) : source.replace(/\{(\w+)\}/g, (match, key) => values[key] === undefined ? match : String(values[key]));
    schedule ||= window.setTimeout.bind(window); unschedule ||= window.clearTimeout.bind(window);
    if (storage === undefined) {try {storage = window.localStorage;} catch {storage = null;}}
    let model = FocusModel.defaults(), settings = focusConfiguration(), enabled = true, hidden = false, visible = !host.hidden, disposed = false, configOpen = false, timer = 0, drag = null, taskSignature = '', taskStatusSource = '';
    const animations = new Set();
    try {const raw = storage?.getItem(STORAGE_KEY); if (raw && raw.length <= 131072) {const saved = JSON.parse(raw); model = FocusModel.restore(saved?.state, now()); settings = focusConfiguration(saved?.settings);}} catch {}
    host.innerHTML = markup;
    const $ = id => host.querySelector('#' + id), put = (id, value) => {const element = $(id); if (element.textContent !== value) element.textContent = value;};
    const splitClock = presentation === 'split'; host.dataset.focusPresentation = splitClock ? 'split' : 'default'; host.dataset.focusTasks = 'true';
    let clockCells = [];
    if (splitClock) {
      const card = host.querySelector('.focus-timer-card'), controls = host.querySelector('.focus-card-controls');
      const details = document.createElement('div'), heading = document.createElement('div');
      details.className = 'focus-detail-card'; heading.className = 'focus-detail-heading';
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
      const clock = $('focus-clock'), ring = $('focus-progress'), face = document.createElement('div'), side = document.createElement('div');
      ring.className = 'focus-session-ring'; face.className = 'focus-ring-face'; side.className = 'focus-timer-side';
      ring.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="focus-session-track" cx="50" cy="50" r="42"/><circle class="focus-session-progress" cx="50" cy="50" r="42" pathLength="1" transform="rotate(-90 50 50)"/></svg><span id="focus-complete-indicator" class="focus-complete-indicator" aria-hidden="true" hidden><svg viewBox="0 0 24 24"><path d="m5 12 4.5 4.5L19 7"/></svg></span>';
      const ringLabel = document.createElement('span'); ringLabel.id = 'focus-ring-phase'; ringLabel.className = 'focus-ring-phase';
      face.append(clock, ringLabel); ring.append(face); side.append(ring, controls);
      card.replaceChildren(details, side);
    }
    const selectedTask = document.createElement('p'); selectedTask.id = 'focus-selected-task'; selectedTask.className = 'focus-selected-task';
    $('focus-description').before(selectedTask);
    const sessionPane = document.createElement('div'); sessionPane.className = 'focus-session-pane';
    sessionPane.append(...$('focus-active').children);
    const tasksPane = document.createElement('section'); tasksPane.className = 'focus-tasks'; tasksPane.setAttribute('aria-label', 'Tâches du Pomodoro');
    tasksPane.innerHTML = `<header class="focus-tasks-heading"><div class="focus-tasks-title"><strong>Tâches</strong><span id="focus-tasks-count"></span></div>
      <form id="focus-task-form" class="focus-task-add"><input id="focus-task-input" type="text" maxlength="500" placeholder="Ajouter une tâche" aria-label="Nouvelle tâche" autocomplete="off"><button type="submit" aria-label="Ajouter la tâche" title="Ajouter"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></form></header>
      <div id="focus-task-list" class="focus-task-list" role="list"></div><p id="focus-task-empty" class="focus-task-empty"><span class="focus-task-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12 4.5 4.5L19 7"/></svg></span><span>Une tâche suffit pour commencer. Choisis-la, puis lance le minuteur.</span></p><p id="focus-task-status" class="focus-task-status" role="status" aria-live="polite"></p>`;
    $('focus-active').replaceChildren(sessionPane, tasksPane);
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
    function animate(element, frames, done = () => {}) {
      const animation = element.animate(frames, {duration: 240, easing: 'cubic-bezier(.22,1,.36,1)'}); animations.add(animation);
      animation.finished.then(() => {animations.delete(animation); done();}, () => {animations.delete(animation); done();});
    }
    function renderDigits(seconds) {
      const clock = $('focus-clock'), stamp = time(seconds), value = splitClock ? stamp.padStart(5, '0') : stamp;
      clock.setAttribute('aria-label', t('{minutes} minutes {seconds} secondes', {minutes: Math.floor(seconds / 60), seconds: seconds % 60}));
      if (clock.dataset.value === stamp) return;
      if (clockCells.length !== value.length) {
        stopAnimations(); clockCells = [...value].map(char => {const cell = document.createElement('span'); cell.className = char === ':' ? 'focus-colon' : 'focus-digit'; const digit = document.createElement('span'); digit.textContent = char; cell.append(digit); return cell;});
        clock.replaceChildren(...clockCells);
      } else [...value].forEach((char, index) => {
        const cell = clockCells[index], digit = cell.firstElementChild;
        if (digit.textContent === char) return;
        cell.getAnimations({subtree: true}).forEach(animation => animation.cancel());
        while (cell.children.length > 1) cell.lastElementChild.remove();
        const previous = digit.cloneNode(true); digit.textContent = char;
        if (usable() && visible && !configOpen && motionEnabled()) {
          previous.className = 'focus-digit-old'; cell.append(previous);
          animate(previous, [{transform: 'translateY(0)', opacity: 1}, {transform: 'translateY(65%)', opacity: 0}], () => previous.remove());
          animate(digit, [{transform: 'translateY(-65%)', opacity: 0}, {transform: 'translateY(0)', opacity: 1}]);
        }
      });
      clock.dataset.value = stamp;
    }
    function stopTimer() {if (timer) unschedule(timer); timer = 0;}
    function queue() {
      if (!usable() || !model.deadline) {stopTimer(); return;}
      if (!timer) timer = schedule(() => {timer = 0; render();}, Math.max(20, (model.deadline - now()) % 1000 || 1000));
    }
    function summary() {const card = focusCardValues(model, settings, now(), t); return {...card, label: label(), running: !!model.deadline, time: time(card.seconds), configOpen};}
    function renderTasks() {
      put('focus-selected-task', model.complete ? t('Cycle terminé') : model.pomodoro?.phase === 'break' ? label() : model.task || t('À ton rythme'));
      put('focus-task-status', t(taskStatusSource));
      put('focus-tasks-count', `${model.tasks.filter(task => task.done).length}/${model.tasks.length}`);
      $('focus-task-empty').hidden = model.tasks.length > 0;
      const limited = model.tasks.length >= 100; $('focus-task-input').disabled = limited; $('focus-task-form').querySelector('button').disabled = limited;
      const signature = JSON.stringify([model.tasks, model.activeTaskId]); if (signature === taskSignature) return; taskSignature = signature;
      const focused = document.activeElement, restore = host.contains(focused) && focused?.dataset?.focusTaskAction ? {action: focused.dataset.focusTaskAction, id: focused.dataset.taskId} : null;
      const rows = model.tasks.map(task => {
        const row = document.createElement('div'); row.className = 'focus-task-row'; row.setAttribute('role', 'listitem'); row.classList.toggle('current', task.id === model.activeTaskId); row.classList.toggle('done', task.done);
        const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'focus-task-check'; toggle.dataset.focusTaskAction = 'toggle'; toggle.dataset.taskId = task.id;
        toggle.setAttribute('role', 'checkbox'); toggle.setAttribute('aria-checked', String(task.done)); toggle.setAttribute('aria-label', t(task.done ? 'Rouvrir : {task}' : 'Terminer : {task}', {task: task.title}));
        toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
        const select = document.createElement('button'); select.type = 'button'; select.className = 'focus-task-select'; select.dataset.focusTaskAction = 'select'; select.dataset.taskId = task.id; select.textContent = task.title;
        select.title = task.title; select.disabled = task.done; select.setAttribute('aria-pressed', String(task.id === model.activeTaskId)); select.setAttribute('aria-label', t('Choisir pour Focus : {task}', {task: task.title}));
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'focus-task-remove'; remove.dataset.focusTaskAction = 'delete'; remove.dataset.taskId = task.id; remove.setAttribute('aria-label', t('Supprimer : {task}', {task: task.title}));
        remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>';
        row.append(toggle, select, remove); return row;
      });
      $('focus-task-list').replaceChildren(...rows);
      if (restore) ([...$('focus-task-list').querySelectorAll('[data-focus-task-action]')].find(button => button.dataset.taskId === restore.id && button.dataset.focusTaskAction === restore.action && !button.disabled) || $('focus-task-input')).focus({preventScroll: true});
    }
    function render(notify = true) {
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
        put('focus-ring-phase', model.complete ? card.badge : model.pomodoro?.phase === 'break' ? t('PAUSE') : t('FOCUS'));
        $('focus-complete-indicator').hidden = !model.complete;
        $('focus-skip').disabled = !active || !model.pomodoro;
        const skipLabel = model.pomodoro?.phase === 'break' ? model.pomodoro.breakKind === 'long' ? 'Terminer le cycle' : 'Passer à la session suivante' : 'Passer à la pause';
        $('focus-skip').setAttribute('aria-label', t(skipLabel)); $('focus-skip').title = t(skipLabel);
      }
      $('focus-break-chip').title = card.pauseLabel; $('focus-active').dataset.phase = model.pomodoro?.phase || 'work';
      host.dataset.focusBreak = model.pomodoro?.phase === 'break' ? model.pomodoro.breakKind : 'none'; renderTasks();
      $('focus-active').setAttribute('aria-label', t('Minuteur Pomodoro · {phase} · {completed} cycles terminés sur {total}', {phase: card.badge, completed: card.completed, total: card.total}));
      $('focus-task-chip').hidden = !card.task; $('focus-task-chip').title = card.task; put('focus-task-count', card.task ? '01' : '');
      $('focus-start').hidden = active; $('focus-toggle').hidden = !active; $('focus-stop').disabled = !active && !model.complete;
      ($('focus-progress').querySelector('.focus-session-progress') || $('focus-progress').firstElementChild).style.transition = usable() && visible && motionEnabled() ? '' : 'none';
      $('focus-progress').setAttribute('aria-valuenow', String(Math.round(progress * 100)));
      $('focus-progress').setAttribute('aria-valuetext', t('{minutes} minutes {seconds} secondes', {minutes: Math.floor(seconds / 60), seconds: seconds % 60})); renderDigits(seconds);
      const paused = !model.deadline;
      $('focus-toggle').setAttribute('aria-label', t(paused ? 'Reprendre Focus' : 'Mettre Focus en pause')); $('focus-toggle').title = t(paused ? 'Reprendre' : 'Pause');
      $('focus-play-icon').setAttribute('d', paused ? 'M8 5v14l11-7Z' : 'M6 5h4v14H6ZM14 5h4v14h-4Z');
      put('focus-config-status', t(active ? 'Les durées restent fixes pendant le cycle en cours.' : 'Les pauses s’enchaînent automatiquement.'));
      for (const input of $('focus-setup').querySelectorAll('input')) input.disabled = active;
      host.querySelector('#focus-setup [data-focus-command="start"]').disabled = active;
      $('focus-duration').value = String(settings.work); $('focus-duration').setAttribute('aria-valuetext', t('{minutes} minutes', {minutes: settings.work})); put('focus-duration-value', settings.work + ' min');
      for (const input of host.querySelectorAll('[data-focus-setting]')) input.value = settings[input.dataset.focusSetting];
      const ticks = $('focus-ticks');
      if (ticks.dataset.value !== String(settings.work)) {
        ticks.dataset.value = settings.work; ticks.replaceChildren();
        for (let minute = settings.work - 12; minute <= settings.work + 12; minute++) {const tick = document.createElement('i'); tick.className = minute % 5 === 0 ? 'major' : ''; if (minute <= settings.work) tick.classList.add('past'); if (minute < 1 || minute > 180) tick.style.visibility = 'hidden'; if (minute % 5 === 0) {const label = document.createElement('span'); label.textContent = minute; tick.append(label);} ticks.append(tick);}
      }
      queue();
      if (notify) changed({state: copy(model), settings: {...settings}, card});
      return card;
    }
    function command(value) {
      if (disposed) return false;
      const boundary = FocusModel.tick(model, now());
      // A click at an expired phase must not skip the new phase a second time.
      if (value === 'skip' && boundary.changed) {stopTimer(); save(); render(); if (!active()) $('focus-start').focus({preventScroll: true}); return true;}
      if (value === 'configure') {configOpen = true; stopAnimations(); render(); $('focus-config-back').focus({preventScroll: true}); return true;}
      if (value === 'back') {configOpen = false; render(); $('focus-configure').focus({preventScroll: true}); return true;}
      if (value === 'start' && !active()) {
        if (![...$('focus-setup').querySelectorAll('input')].every(input => input.reportValidity())) return false;
        settings = focusConfiguration({work: Number($('focus-duration').value), ...Object.fromEntries([...host.querySelectorAll('[data-focus-setting]')].map(input => [input.dataset.focusSetting, Number(input.value)]))});
        model = {...FocusModel.defaults(), tasks: model.tasks, activeTaskId: model.activeTaskId, task: model.task, minutes: settings.work, remaining: settings.work * 60, sessionActive: true, deadline: now() + settings.work * 60000, pomodoro: {...settings, phase: 'work', session: 1}}; configOpen = false;
      } else if (value === 'toggle' && active()) {if (model.deadline) {model.remaining = FocusModel.remaining(model, now()); model.deadline = null;} else model.deadline = now() + model.remaining * 1000;}
      else if (value === 'skip' && active() && model.pomodoro) {
        const paused = !model.deadline;
        model.deadline = null; model.remaining = 0; model.complete = true; model.sessionActive = false;
        if (FocusModel.nextPhase(model, now()) && paused) model.deadline = null;
      }
      else if (value === 'stop') model = {...FocusModel.defaults(), tasks: model.tasks, activeTaskId: model.activeTaskId, task: model.task, minutes: settings.work, remaining: settings.work * 60};
      else return false;
      stopTimer(); save(); render();
      if (value === 'start') $('focus-toggle').focus({preventScroll: true}); else if (value === 'stop' || value === 'skip' && !active()) $('focus-start').focus({preventScroll: true});
      return true;
    }
    function tasks(action) {
      if (disposed) return false;
      const id = action?.type === 'add' ? window.crypto?.randomUUID?.() || `task-${now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` : '';
      if (!FocusModel.taskAction(model, action, id)) return false;
      save(); render(); return true;
    }
    function submitTask(event) {
      event.preventDefault(); const input = $('focus-task-input');
      if (tasks({type: 'add', title: input.value})) {input.value = ''; taskStatusSource = 'Tâche ajoutée.'; if (!input.disabled) input.focus({preventScroll: true});}
      else taskStatusSource = model.tasks.length >= 100 ? '100 tâches : retire une tâche pour en ajouter une.' : 'Écris le nom de ta tâche.';
      put('focus-task-status', t(taskStatusSource));
    }
    function click(event) {
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
    function pointerDown(event) {if (disposed || active() || event.button !== 0) return; event.preventDefault(); drag = {x: event.clientX, work: settings.work, id: event.pointerId}; event.target.setPointerCapture(event.pointerId); event.target.focus({preventScroll: true});}
    function pointerMove(event) {if (!drag || drag.id !== event.pointerId) return; const value = Math.max(1, Math.min(180, drag.work - Math.round((event.clientX - drag.x) / 8))); if (value !== settings.work) {settings.work = value; render();}}
    function pointerUp(event) {if (!drag || drag.id !== event.pointerId) return; drag = null; save();}
    function lifecycle(value = {}) {
      if (disposed) return;
      if (typeof value.enabled === 'boolean') enabled = value.enabled; if (typeof value.hidden === 'boolean') hidden = value.hidden; if (typeof value.visible === 'boolean') visible = value.visible;
      if (!usable() || !visible || !motionEnabled()) stopAnimations(); render();
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
    host.addEventListener('click', click); host.addEventListener('input', input); $('focus-task-form').addEventListener('submit', submitTask); ruler.addEventListener('wheel', wheel, {passive: false});
    ruler.addEventListener('pointerdown', pointerDown); ruler.addEventListener('pointermove', pointerMove); ruler.addEventListener('pointerup', pointerUp); ruler.addEventListener('pointercancel', pointerUp);
    document.addEventListener('visibilitychange', wake); reduced.addEventListener('change', wake);
    const unsubscribeLanguage = i18n?.onChange?.(() => {if (disposed) return; translateStatic(); taskSignature = ''; render();});
    function dispose() {
      if (disposed) return; disposed = true; stopTimer(); stopAnimations(); drag = null;
      host.removeEventListener('click', click); host.removeEventListener('input', input); $('focus-task-form').removeEventListener('submit', submitTask); ruler.removeEventListener('wheel', wheel);
      ruler.removeEventListener('pointerdown', pointerDown); ruler.removeEventListener('pointermove', pointerMove); ruler.removeEventListener('pointerup', pointerUp); ruler.removeEventListener('pointercancel', pointerUp);
      document.removeEventListener('visibilitychange', wake); reduced.removeEventListener('change', wake);
      unsubscribeLanguage?.();
    }
    render(false);
    return Object.freeze({render, lifecycle, summary, preview, dispose, command, tasks, getState: () => copy(model), getSettings: () => ({...settings}),
      inspect: () => ({active: active(), running: !!model.deadline, seconds: FocusModel.remaining(model, now()), phase: model.pomodoro ? {...model.pomodoro} : null, configuration: {...settings}, complete: model.complete, timerActive: !!timer, configOpen, tasksCount: model.tasks.length, activeTaskId: model.activeTaskId, disposed})});
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
  return {FocusModel, focusConfiguration, focusCardValues, create, mountLab, STORAGE_KEY};
});
