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
 const defaults = () => ({task: '', minutes: 25, remaining: 1500, deadline: null, complete: false, sessionActive: false});
 const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
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
  state.task = typeof input.task === 'string' ? input.task.slice(0, 500) : '';
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
 return Object.freeze({defaults, restore, remaining, nextPhase, tick});
  })();

  function focusConfiguration(value = {}) {
    const result = {work: 25, rest: 5, longRest: 15, total: 4};
    for (const [key, max] of [['work', 180], ['rest', 60], ['longRest', 180], ['total', 12]]) {
      if (Number.isInteger(value?.[key]) && value[key] >= 1 && value[key] <= max) result[key] = value[key];
    }
    return result;
  }
  function focusCardValues(model, settings = focusConfiguration(), now = Date.now()) {
    const cycle = model.pomodoro, active = !cycle?.finished && (model.sessionActive || !!model.deadline);
    const paused = active && !model.deadline, breaking = cycle?.phase === 'break';
    const seconds = active ? FocusModel.remaining(model, now) : model.complete ? 0 : settings.work * 60;
    const total = cycle?.total || settings.total, completed = cycle ? Math.min(total, breaking || cycle.finished ? cycle.session : cycle.session - 1) : 0;
    const longBreak = cycle?.breakKind === 'long' || cycle?.phase === 'work' && cycle.session === total;
    const pauseMinutes = longBreak ? cycle?.longRest || settings.longRest : cycle?.rest || settings.rest;
    const badge = model.complete ? 'TERMINÉ' : paused ? 'EN PAUSE' : breaking ? cycle.breakKind === 'long' ? 'PAUSE LONGUE' : 'PAUSE' : 'FOCUS';
    const description = model.complete ? 'Cycle terminé. Prends un moment pour toi.' : paused ? 'Reprends quand tu es prêt.' : breaking ? cycle.breakKind === 'long' ? 'Une pause bien méritée avant de terminer.' : 'Fais une pause, puis retrouve ton rythme.' : 'Reste régulier et garde le rythme.';
    return {active,paused,seconds,badge,description,completed,total,pause: String(pauseMinutes).padStart(2, '0') + ':00',pauseLabel: longBreak ? 'Pause longue' : 'Pause courte',
      progress: active ? Math.min(1, Math.max(0, 1 - seconds / (model.minutes * 60))) : model.complete ? 1 : 0,
      task: typeof model.task === 'string' ? model.task.trim() : ''};
  }

  const markup = "<div id=\"focus-active\" class=\"focus-widget\"><div class=\"focus-timer-card\"><div class=\"focus-card-top\"><span class=\"focus-timer-label\">TIMER</span><div class=\"focus-card-controls\"><button id=\"focus-start\" type=\"button\" data-focus-command=\"start\" aria-label=\"Démarrer Focus\" title=\"Démarrer\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M8 5v14l11-7Z\"/></svg></button><button id=\"focus-toggle\" type=\"button\" data-focus-command=\"toggle\" aria-label=\"Mettre Focus en pause\" title=\"Pause\" hidden><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path id=\"focus-play-icon\" d=\"M6 5h4v14H6ZM14 5h4v14h-4Z\"/></svg></button><button id=\"focus-stop\" type=\"button\" data-focus-command=\"stop\" aria-label=\"Arrêter Focus\" title=\"Arrêter\" disabled><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M7 7h10v10H7Z\"/></svg></button><button id=\"focus-configure\" type=\"button\" data-focus-command=\"configure\" aria-label=\"Régler le Pomodoro\" title=\"Réglages\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M4 7h16M4 17h16M8 4v6M16 14v6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\"/></svg></button></div></div><div class=\"focus-clock-row\"><div id=\"focus-clock\" class=\"focus-clock\" role=\"timer\" aria-live=\"off\" aria-label=\"25 minutes\"></div><span class=\"focus-phase-badge\"><i aria-hidden=\"true\"></i><span id=\"focus-phase\">FOCUS</span></span></div><p id=\"focus-description\" class=\"focus-description\">Reste régulier et garde le rythme.</p><div id=\"focus-progress\" class=\"focus-progress\" role=\"progressbar\" aria-label=\"Progression de la session\" aria-valuemin=\"0\" aria-valuemax=\"100\" aria-valuenow=\"0\"><span></span></div></div><div class=\"focus-metrics\"><span class=\"focus-stat\"><small>CYCLES</small><strong id=\"focus-session\">0/4</strong></span><span id=\"focus-break-chip\" class=\"focus-stat\"><small>PAUSE</small><strong id=\"focus-break-duration\">05:00</strong></span><span id=\"focus-task-chip\" class=\"focus-stat\" hidden><small>TÂCHE</small><strong id=\"focus-task-count\"></strong></span></div></div>\n        <div id=\"focus-setup\" class=\"focus-setup\" hidden><header class=\"focus-config-heading\"><strong>Réglages Pomodoro</strong><button id=\"focus-config-back\" type=\"button\" data-focus-command=\"back\" aria-label=\"Revenir au minuteur\">Retour</button></header><label class=\"focus-duration-label\" for=\"focus-duration\">Durée de travail <strong id=\"focus-duration-value\">25 min</strong></label><div class=\"focus-ruler\"><div id=\"focus-ticks\" aria-hidden=\"true\"></div><span class=\"focus-ruler-marker\" aria-hidden=\"true\"></span><input id=\"focus-duration\" type=\"range\" min=\"1\" max=\"180\" step=\"1\" value=\"25\" aria-label=\"Durée de travail en minutes\"></div><div class=\"focus-options\"><label>Pause courte<span><input data-focus-setting=\"rest\" type=\"number\" min=\"1\" max=\"60\" value=\"5\" aria-label=\"Pause courte en minutes\"><small>min</small></span></label><label>Pause longue<span><input data-focus-setting=\"longRest\" type=\"number\" min=\"1\" max=\"180\" value=\"15\" aria-label=\"Pause longue en minutes\"><small>min</small></span></label><label>Sessions<span><input data-focus-setting=\"total\" type=\"number\" min=\"1\" max=\"12\" value=\"4\" aria-label=\"Nombre de sessions\"></span></label></div><footer class=\"focus-config-footer\"><span id=\"focus-config-status\"></span><button type=\"button\" data-focus-command=\"start\">Démarrer</button></footer></div>";
  const copy = value => JSON.parse(JSON.stringify(value));
  const time = seconds => Math.floor(Math.max(0, seconds) / 60) + ':' + String(Math.max(0, seconds) % 60).padStart(2, '0');
  function create({host, changed = () => {}, motion = true, storage, presentation = 'default', now = Date.now, setTimeout: schedule, clearTimeout: unschedule} = {}) {
    const document = host?.ownerDocument;
    if (!document) throw new TypeError('Focus nécessite un élément hôte.');
    const window = document.defaultView, reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    schedule ||= window.setTimeout.bind(window); unschedule ||= window.clearTimeout.bind(window);
    if (storage === undefined) {try {storage = window.localStorage;} catch {storage = null;}}
    let model = FocusModel.defaults(), settings = focusConfiguration(), enabled = true, hidden = false, visible = !host.hidden, disposed = false, configOpen = false, timer = 0, drag = null;
    const animations = new Set();
    try {const raw = storage?.getItem(STORAGE_KEY); if (raw && raw.length <= 8192) {const saved = JSON.parse(raw); model = FocusModel.restore(saved?.state, now()); settings = focusConfiguration(saved?.settings);}} catch {}
    host.innerHTML = markup;
    const $ = id => host.querySelector('#' + id), put = (id, value) => {const element = $(id); if (element.textContent !== value) element.textContent = value;};
    const splitClock = presentation === 'split'; host.dataset.focusPresentation = splitClock ? 'split' : 'default';
    let clockCells = [];
    if (splitClock) {
      const card = host.querySelector('.focus-timer-card'), controls = host.querySelector('.focus-card-controls');
      const details = document.createElement('div'), heading = document.createElement('div');
      details.className = 'focus-detail-card'; heading.className = 'focus-detail-heading';
      host.querySelector('.focus-timer-label').textContent = 'Session';
      heading.append(host.querySelector('.focus-timer-label'), host.querySelector('.focus-phase-badge'), $('focus-configure'));
      const cycles = document.createElement('span'), dots = document.createElement('span'), footer = document.createElement('div'), labels = document.createElement('div');
      cycles.className = 'focus-cycle-value'; dots.className = 'focus-cycle-dots'; dots.setAttribute('aria-hidden', 'true');
      $('focus-session').before(cycles); cycles.append(dots, $('focus-session'));
      host.querySelector('.focus-stat small').textContent = 'Cycles'; $('focus-break-chip').querySelector('small').textContent = 'Pause';
      const pause = document.createElement('span'); pause.className = 'focus-break-value';
      pause.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5ZM17 11h1.5a2.5 2.5 0 0 1 0 5H17"/></svg>';
      $('focus-break-duration').before(pause); pause.append($('focus-break-duration'));
      details.append(heading, $('focus-description'), host.querySelector('.focus-metrics'));
      $('focus-stop').querySelector('path').setAttribute('d', 'M8 5h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z');
      const skip = document.createElement('button'); skip.id = 'focus-skip'; skip.type = 'button'; skip.dataset.focusCommand = 'skip'; skip.setAttribute('aria-label', 'Passer à la pause');
      skip.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5.5v13l9-6.5ZM17 5.5h2.5v13H17Z"/></svg>';
      controls.prepend($('focus-stop'));
      controls.append(skip);
      labels.className = 'focus-progress-labels'; labels.innerHTML = '<span id="focus-elapsed">0:00</span><span id="focus-total">25:00</span>';
      footer.className = 'focus-progress-footer'; footer.append($('focus-progress'), labels);
      card.replaceChildren($('focus-clock'), details, controls, footer);
    }
    const active = () => !model.pomodoro?.finished && (model.sessionActive || !!model.deadline);
    const label = () => model.pomodoro?.phase === 'break' ? model.pomodoro.breakKind === 'long' ? 'Pause longue' : 'Pause courte' : 'Concentration';
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
      clock.setAttribute('aria-label', `${Math.floor(seconds / 60)} minutes ${seconds % 60} secondes`);
      if (clock.dataset.value === stamp) return;
      if (clockCells.length !== value.length) {
        stopAnimations(); clockCells = [...value].map(char => {const cell = document.createElement('span'); cell.className = char === ':' ? 'focus-colon' : 'focus-digit'; const digit = document.createElement('span'); digit.textContent = char; cell.append(digit); return cell;});
        if (splitClock) {
          const colon = value.indexOf(':'), row = (unit, cells) => {
            const line = document.createElement('span'), numbers = document.createElement('span'), label = document.createElement('span');
            line.className = 'focus-time-row'; line.dataset.unit = unit; numbers.className = 'focus-time-number'; label.className = 'focus-time-label'; label.textContent = unit === 'seconds' ? 'sec' : 'min'; label.setAttribute('aria-hidden', 'true');
            numbers.append(...cells); line.append(numbers, label); return line;
          };
          clock.replaceChildren(row('seconds', clockCells.slice(colon + 1)), row('minutes', clockCells.slice(0, colon + 1)));
        } else clock.replaceChildren(...clockCells);
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
    function summary() {const card = focusCardValues(model, settings, now()); return {...card, label: label(), running: !!model.deadline, time: time(card.seconds)};}
    function render(notify = true) {
      if (disposed) return;
      const change = FocusModel.tick(model, now()); if (change.changed) save();
      const card = summary(), {active, seconds, progress} = card;
      host.style.setProperty('--focus-progress', String(progress)); host.dataset.focusPhase = model.pomodoro?.phase || 'work';
      $('focus-setup').hidden = !configOpen; $('focus-active').hidden = configOpen;
      put('focus-phase', card.badge); put('focus-description', card.description); put('focus-session', `${card.completed}/${card.total}`); put('focus-break-duration', card.pause);
      if (splitClock) {
        const dots = host.querySelector('.focus-cycle-dots');
        if (dots.children.length !== card.total) dots.replaceChildren(...Array.from({length: card.total}, () => document.createElement('i')));
        [...dots.children].forEach((dot, index) => dot.classList.toggle('completed', index < card.completed));
        const duration = active || model.complete ? model.minutes * 60 : settings.work * 60;
        put('focus-elapsed', time(Math.max(0, duration - seconds))); put('focus-total', time(duration));
        $('focus-skip').disabled = !active || !model.pomodoro;
        const skipLabel = model.pomodoro?.phase === 'break' ? model.pomodoro.breakKind === 'long' ? 'Terminer le cycle' : 'Passer à la session suivante' : 'Passer à la pause';
        $('focus-skip').setAttribute('aria-label', skipLabel); $('focus-skip').title = skipLabel;
      }
      $('focus-break-chip').title = card.pauseLabel; $('focus-active').dataset.phase = model.pomodoro?.phase || 'work';
      $('focus-active').setAttribute('aria-label', `Minuteur Pomodoro · ${card.badge} · ${card.completed} cycles terminés sur ${card.total}`);
      $('focus-task-chip').hidden = !card.task; $('focus-task-chip').title = card.task; put('focus-task-count', card.task ? '01' : '');
      $('focus-start').hidden = active; $('focus-toggle').hidden = !active; $('focus-stop').disabled = !active && !model.complete;
      $('focus-progress').firstElementChild.style.transition = motionEnabled() ? '' : 'none';
      $('focus-progress').setAttribute('aria-valuenow', String(Math.round(progress * 100))); renderDigits(seconds);
      const paused = !model.deadline;
      $('focus-toggle').setAttribute('aria-label', paused ? 'Reprendre Focus' : 'Mettre Focus en pause');
      $('focus-play-icon').setAttribute('d', paused ? 'M8 5v14l11-7Z' : 'M6 5h4v14H6ZM14 5h4v14h-4Z');
      put('focus-config-status', active ? 'Les durées restent fixes pendant le cycle en cours.' : 'Les pauses s’enchaînent automatiquement.');
      for (const input of host.querySelectorAll('input')) input.disabled = active;
      host.querySelector('#focus-setup [data-focus-command="start"]').disabled = active;
      $('focus-duration').value = String(settings.work); $('focus-duration').setAttribute('aria-valuetext', settings.work + ' minutes'); put('focus-duration-value', settings.work + ' min');
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
        if (![...host.querySelectorAll('input')].every(input => input.reportValidity())) return false;
        settings = focusConfiguration({work: Number($('focus-duration').value), ...Object.fromEntries([...host.querySelectorAll('[data-focus-setting]')].map(input => [input.dataset.focusSetting, Number(input.value)]))});
        model = {...FocusModel.defaults(), minutes: settings.work, remaining: settings.work * 60, sessionActive: true, deadline: now() + settings.work * 60000, pomodoro: {...settings, phase: 'work', session: 1}}; configOpen = false;
      } else if (value === 'toggle' && active()) {if (model.deadline) {model.remaining = FocusModel.remaining(model, now()); model.deadline = null;} else model.deadline = now() + model.remaining * 1000;}
      else if (value === 'skip' && active() && model.pomodoro) {
        const paused = !model.deadline;
        model.deadline = null; model.remaining = 0; model.complete = true; model.sessionActive = false;
        if (FocusModel.nextPhase(model, now()) && paused) model.deadline = null;
      }
      else if (value === 'stop') model = {...FocusModel.defaults(), minutes: settings.work, remaining: settings.work * 60};
      else return false;
      stopTimer(); save(); render();
      if (value === 'start') $('focus-toggle').focus({preventScroll: true}); else if (value === 'stop' || value === 'skip' && !active()) $('focus-start').focus({preventScroll: true});
      return true;
    }
    function click(event) {const button = event.target.closest('[data-focus-command]'); if (button && host.contains(button) && !button.disabled) command(button.dataset.focusCommand);}
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
      card.querySelector('.focus-card-controls')?.remove(); for (const element of card.querySelectorAll('button,.focus-digit-old,.focus-progress-labels,.focus-cycle-dots')) element.remove();
      for (const element of card.querySelectorAll('[id],[data-focus-command]')) {element.removeAttribute('id'); element.removeAttribute('data-focus-command');}
      return card;
    }
    const ruler = $('focus-duration');
    host.addEventListener('click', click); host.addEventListener('input', input); ruler.addEventListener('wheel', wheel, {passive: false});
    ruler.addEventListener('pointerdown', pointerDown); ruler.addEventListener('pointermove', pointerMove); ruler.addEventListener('pointerup', pointerUp); ruler.addEventListener('pointercancel', pointerUp);
    document.addEventListener('visibilitychange', wake); reduced.addEventListener('change', wake);
    function dispose() {
      if (disposed) return; disposed = true; stopTimer(); stopAnimations(); drag = null;
      host.removeEventListener('click', click); host.removeEventListener('input', input); ruler.removeEventListener('wheel', wheel);
      ruler.removeEventListener('pointerdown', pointerDown); ruler.removeEventListener('pointermove', pointerMove); ruler.removeEventListener('pointerup', pointerUp); ruler.removeEventListener('pointercancel', pointerUp);
      document.removeEventListener('visibilitychange', wake); reduced.removeEventListener('change', wake);
    }
    render(false);
    return Object.freeze({render, lifecycle, summary, preview, dispose, command, getState: () => copy(model), getSettings: () => ({...settings}),
      inspect: () => ({active: active(), running: !!model.deadline, seconds: FocusModel.remaining(model, now()), phase: model.pomodoro ? {...model.pomodoro} : null, configuration: {...settings}, complete: model.complete, timerActive: !!timer, configOpen, disposed})});
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
