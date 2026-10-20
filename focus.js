(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) root.NotchyFocus = api;
})(typeof window === 'object' ? window : null, function () {
  'use strict';
  const STORAGE_KEY = 'notchy-minimal-focus-v1';
    const FocusModel = (() => {
 'use strict';
 const defaults = () => ({task: '', tasks: [], activeTaskId: null, taskPrompt: null, sessionSummary: null, minutes: 25, remaining: 1500, deadline: null, complete: false, sessionActive: false});
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
  if(input.chosenBreak===true&&input.phase==='break'){result.chosenBreak=true;result.breakKind=input.breakKind==='long'?'long':'short';}
  if(input.finished===true&&result.phase==='break'&&(result.breakKind==='long'||result.chosenBreak)&&session===total)result.finished=true;
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
  const completed = input.sessionSummary;
  if (p && completed && typeof completed === 'object' && !Array.isArray(completed) && Number.isFinite(completed.at) && completed.at > 0 && completed.at <= now + 60000 && integer(completed.session, 1, p.total) && completed.total === p.total && completed.minutes === p.work && integer(completed.completedCycles, 0, 9999) && integer(completed.estimatedCycles, 0, 12)) {
   state.sessionSummary = {at: completed.at, session: completed.session, total: p.total, minutes: p.work, taskId: taskId(completed.taskId) ? completed.taskId : null, title: taskTitle(completed.title), completedCycles: completed.completedCycles, estimatedCycles: completed.estimatedCycles};
  }
  return state;
 }
 function remaining(state, now = Date.now()) {
  const value = state?.deadline ? Math.ceil((state.deadline - now) / 1000) : state?.remaining;
  return Number.isFinite(value) ? Math.max(0, Math.ceil(value)) : 0;
 }
 function nextPhase(state, now = Date.now()) {
  const normalized=cycle(state.pomodoro);if(!normalized||!state.complete||normalized.finished)return false;
  const p=state.pomodoro=normalized;
  if(p.phase==='break'&&p.chosenBreak){if(p.session>=p.total){p.finished=true;state.deadline=null;state.remaining=0;state.complete=true;state.sessionActive=false;return false;}delete p.chosenBreak;p.phase='work';p.session++;delete p.breakKind;}
  else if(p.phase==='break'&&p.breakKind==='long'){p.finished=true;state.deadline=null;state.remaining=0;state.complete=true;state.sessionActive=false;return false;}
  else if (p.phase === 'work') {p.phase='break';p.breakKind=p.session>=p.total?'long':'short';}
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
    if(!legacyBoundary)state.sessionSummary={at:boundary,session:state.pomodoro.session,total:state.pomodoro.total,minutes:state.pomodoro.work,taskId:task?.id||null,title:task?.title||'',completedCycles:task?.completedCycles||0,estimatedCycles:task?.estimatedCycles||0};
   }
   state.deadline=null;state.remaining=0;state.complete=true;state.sessionActive=false;result.changed=true;
   if(state.pomodoro&&nextPhase(state,boundary)){result.phaseChanged=true;continue;}
   result.finished=true;break;
  }
  return result;
 }
 function completionChoice(state, choice, now = Date.now()) {
  if(!state?.sessionSummary||!['short','long','continue'].includes(choice)||!cycle(state.pomodoro))return false;
  tick(state,now);
  const p=state.pomodoro, wasWork=p.phase==='work'&&!p.finished;
  if(choice==='continue'){p.session=wasWork?p.session:p.session>=p.total?1:p.session+1;p.phase='work';delete p.breakKind;delete p.chosenBreak;}
  else {p.phase='break';p.breakKind=choice;p.chosenBreak=true;}
  delete p.finished;state.minutes=phaseMinutes(p);state.remaining=state.minutes*60;state.deadline=now+state.remaining*1000;state.complete=false;state.sessionActive=true;state.sessionSummary=null;return true;
 }
 function dismissCompletion(state){if(!state?.sessionSummary)return false;state.sessionSummary=null;return true;}
 function adjustConfiguration(state, input, now = Date.now()) {
  const p = cycle(state?.pomodoro);
  if (!p || p.finished || state.deadline || !state.sessionActive || state.complete) return {ok:false, reason:'pause'};
  if (!input || !integer(input.work,1,180) || !integer(input.rest,1,60) || !integer(input.longRest,1,180) || !integer(input.total,p.session,12)) return {ok:false, reason:'settings'};
  const next = {...p, work:input.work, rest:input.rest, longRest:input.longRest, total:input.total};
  const elapsed = Math.max(0, state.minutes * 60 - remaining(state, now)), minutes = phaseMinutes(next);
  if (minutes * 60 <= elapsed) return {ok:false, reason:'duration'};
  state.pomodoro = next; state.minutes = minutes; state.remaining = minutes * 60 - elapsed;
  state.sessionSummary = null;
  return {ok:true};
 }
 return Object.freeze({defaults, restore, remaining, nextPhase, tick, taskAction, completionChoice, dismissCompletion, adjustConfiguration});
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
      task: typeof model.task === 'string' ? model.task.trim() : '', totalSeconds: (active ? model.minutes : settings.work) * 60, completion: model.sessionSummary ? {...model.sessionSummary, work:cycle.work,rest:cycle.rest,longRest:cycle.longRest,recommended:model.sessionSummary.session===model.sessionSummary.total?'long':'short'} : null, taskCount: model.tasks?.length || 0, completedTasks: model.tasks?.filter(task => task.done).length || 0};
  }

  return {FocusModel, focusConfiguration, focusCardValues, STORAGE_KEY};
});
