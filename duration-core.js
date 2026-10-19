(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NotchyDurationCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const LIMITS = Object.freeze({tasks: 100, title: 500, minutes: 4320, bytes: 196608});
  const DEFAULT_SETTINGS = Object.freeze({work: 25, rest: 5, longRest: 15, interval: 4});
  const STORAGE_KEY = 'notchy.duration-module.v1';
  const copy = value => JSON.parse(JSON.stringify(value));
  const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  function settings(value = DEFAULT_SETTINGS) {
    if (!value || !integer(value.work, 1, 180) || !integer(value.rest, 1, 60) || !integer(value.longRest, 1, 180) || !integer(value.interval, 1, 12)) throw Error('Invalid Pomodoro settings');
    return {work: value.work, rest: value.rest, longRest: value.longRest, interval: value.interval};
  }
  function plan(totalMinutes, options = DEFAULT_SETTINGS) {
    if (!integer(totalMinutes, 1, LIMITS.minutes)) throw Error('Duration must be 1–' + LIMITS.minutes + ' minutes');
    const config = settings(options), result = [];
    let remaining = totalMinutes, position = 0, cycle = 0;
    while (remaining > 0) {
      cycle++;
      const work = Math.min(config.work, remaining);
      result.push({kind: 'focus', minutes: work, startMs: position * 60000, durationMs: work * 60000, cycle});
      position += work; remaining -= work;
      if (!remaining) break;
      const kind = cycle % config.interval === 0 ? 'long' : 'short';
      const rest = Math.min(kind === 'long' ? config.longRest : config.rest, remaining);
      result.push({kind, minutes: rest, startMs: position * 60000, durationMs: rest * 60000, cycle});
      position += rest; remaining -= rest;
    }
    return result;
  }
  function phase(task) {
    const segments = plan(task.totalMinutes, task.settings);
    const total = task.totalMinutes * 60000;
    const elapsed = Math.min(total, Math.max(0, task.elapsedMs));
    const current = segments.find(segment => elapsed < segment.startMs + segment.durationMs) || segments[segments.length - 1];
    const index = segments.indexOf(current), finished = elapsed >= total;
    return {segments, index, current, next: segments[index + 1] || null, finished,
      remainingMs: finished ? 0 : current.startMs + current.durationMs - elapsed,
      fraction: finished ? 1 : (elapsed - current.startMs) / current.durationMs,
      totalRemainingMs: total - elapsed, cycles: segments.filter(s => s.kind === 'focus').length};
  }
  function normalize(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.tasks) || value.tasks.length > LIMITS.tasks) throw Error('Invalid saved module state');
    const ids = new Set(), tasks = value.tasks.map(task => {
      if (!task || typeof task.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(task.id) || ids.has(task.id) || typeof task.title !== 'string' || !task.title.trim() || [...task.title].length > LIMITS.title || /[\u0000-\u001f\u007f]/.test(task.title) || !integer(task.totalMinutes, 1, LIMITS.minutes) || typeof task.done !== 'boolean' || !Number.isFinite(task.elapsedMs) || task.elapsedMs < 0 || task.elapsedMs > task.totalMinutes * 60000) throw Error('Invalid saved task');
      ids.add(task.id);
      if (task.earnedCycles !== undefined && !integer(task.earnedCycles,0,9999)) throw Error('Invalid completed focus count');
      return {id: task.id, title: task.title.trim(), totalMinutes: task.totalMinutes, done: task.done, elapsedMs: task.elapsedMs, settings: settings(task.settings), ...(task.earnedCycles > 0 ? {earnedCycles:task.earnedCycles} : {})};
    });
    if (value.activeId !== null && !ids.has(value.activeId)) throw Error('Invalid active task');
    if (value.startedAt !== null && (!Number.isFinite(value.startedAt) || value.startedAt < 0 || value.activeId === null)) throw Error('Invalid running timer');
    if (value.startedAt !== null && tasks.find(t => t.id === value.activeId).done) throw Error('Completed task cannot run');
    return {version: 1, settings: settings(value.settings), tasks, activeId: value.activeId, startedAt: value.startedAt};
  }
  function fresh() {return {version: 1, settings: {...DEFAULT_SETTINGS}, tasks: [], activeId: null, startedAt: null};}
  function materialize(state, now) {
    const result = copy(state);
    if (result.startedAt !== null) {
      const task = result.tasks.find(t => t.id === result.activeId);
      const before = task.elapsedMs;
      task.elapsedMs = Math.min(task.totalMinutes * 60000, before + Math.max(0, now - result.startedAt));
      const earned = plan(task.totalMinutes,task.settings).filter(segment=>segment.kind==='focus' && segment.startMs + segment.durationMs > before && segment.startMs + segment.durationMs <= task.elapsedMs).length;
      if (earned) task.earnedCycles = Math.min(9999,(task.earnedCycles || 0) + earned);
      result.startedAt = Math.max(now, result.startedAt);
    }
    return result;
  }
  function createStore({storage = null, key = STORAGE_KEY, load, save, now = Date.now, makeId} = {}) {
    let state = fresh(), disposed = false, loaded = false, lastRemoval = null;
    const listeners = new Set();
    const read = load || (() => storage ? storage.getItem(key) : null);
    const write = save || (encoded => {if (storage) storage.setItem(key, encoded);});
    const ready = Promise.resolve().then(read).then(encoded => {
      if (encoded !== null && encoded !== undefined) {
        if (typeof encoded !== 'string' || new TextEncoder().encode(encoded).length > LIMITS.bytes) throw Error('Invalid saved data size');
        state = normalize(JSON.parse(encoded));
      }
      loaded = true;
      return snapshot();
    });
    let queue = ready.catch(() => {});
    function snapshot() {
      if (!loaded) throw Error('Module is not ready');
      return materialize(state, now());
    }
    function commit(change, afterCommit) {
      const operation = queue.then(async () => {
        await ready;
        if (disposed) throw Error('Module is disposed');
        const next = materialize(state, now());
        change(next);
        const normalized = normalize(next), encoded = JSON.stringify(normalized);
        if (new TextEncoder().encode(encoded).length > LIMITS.bytes) throw Error('Module storage limit reached');
        await write(encoded);
        state = normalized;
        afterCommit?.();
        for (const listener of listeners) {try {listener(snapshot());} catch (error) {console.error(error);}}
        return snapshot();
      });
      queue = operation.catch(() => {});
      return operation;
    }
    const taskAt = (state, id) => {const task = state.tasks.find(t => t.id === id); if (!task) throw Error('Task does not exist'); return task;};
    return Object.freeze({ready, snapshot, subscribe(listener) {listeners.add(listener); return () => listeners.delete(listener);},
      add(title, totalMinutes) {
        const clean = typeof title === 'string' ? title.trim() : '';
        if (!clean || [...clean].length > LIMITS.title || /[\u0000-\u001f\u007f]/.test(clean)) return Promise.reject(Error('Enter a title (1–' + LIMITS.title + ' characters)'));
        return commit(next => {
          if (next.tasks.length >= LIMITS.tasks) throw Error('100 tasks maximum');
          plan(totalMinutes, next.settings);
          const id = makeId ? makeId() : globalThis.crypto?.randomUUID?.() || 'task-' + now().toString(36) + '-' + Math.random().toString(36).slice(2);
          next.tasks.push({id, title: clean, totalMinutes, settings: {...next.settings}, elapsedMs: 0, done: false});
          if (!next.activeId) next.activeId = id;
        });
      },
      update(id, title, totalMinutes, {restart = false} = {}) {return commit(next => {
        const task = taskAt(next, id), clean = typeof title === 'string' ? title.trim() : '';
        if (!clean || [...clean].length > LIMITS.title || /[\u0000-\u001f\u007f]/.test(clean)) throw Error('Enter a valid task title');
        plan(totalMinutes, task.settings);
        if (task.totalMinutes !== totalMinutes) {
          if (!restart && (task.elapsedMs > 0 || next.activeId === id && next.startedAt !== null)) throw Error('Confirm restarting this task before changing its duration');
          task.totalMinutes = totalMinutes; task.elapsedMs = 0; delete task.earnedCycles;
          if (next.activeId === id) next.startedAt = null;
        }
        task.title = clean;
      });},
      select(id) {return commit(next => {taskAt(next, id); if (next.activeId !== id) {next.activeId = id; next.startedAt = null;}});},
      toggleTimer(id) {return commit(next => {
        const task = taskAt(next, id); if (task.done) throw Error('Reopen the task before starting it');
        if (next.activeId === id && next.startedAt !== null) next.startedAt = null;
        else {next.activeId = id; if (task.elapsedMs >= task.totalMinutes * 60000) {task.elapsedMs = 0; delete task.earnedCycles;} next.startedAt = now();}
      });},
      complete(id) {return commit(next => {const task = taskAt(next, id); task.done = !task.done; if (task.done && next.activeId === id) next.startedAt = null;});},
      restart(id) {return commit(next => {const task=taskAt(next,id); task.elapsedMs=0; delete task.earnedCycles; if (next.activeId === id) next.startedAt = null;});},
      skip(id) {return commit(next => {const task = taskAt(next, id), value = phase(task); task.elapsedMs = value.current.startMs + value.current.durationMs; if (phase(task).finished && next.activeId === id) next.startedAt = null;});},
      remove(id) {
        let removal;
        return commit(next => {
          const index = next.tasks.findIndex(task => task.id === id), task = taskAt(next, id), wasActive = next.activeId === id;
          removal = {task: copy(task), index, wasActive}; next.tasks.splice(index, 1);
          if (wasActive) {next.activeId = next.tasks.find(t => !t.done)?.id || null; next.startedAt = null;}
          removal.fallbackId = next.activeId;
        }, () => {lastRemoval = removal;});
      },
      canUndoRemove() {return lastRemoval !== null;},
      undoRemove() {return commit(next => {
        if (!lastRemoval) throw Error('No deleted task to restore');
        if (next.tasks.length >= LIMITS.tasks || next.tasks.some(task => task.id === lastRemoval.task.id)) throw Error('Cannot restore this task');
        next.tasks.splice(Math.min(lastRemoval.index, next.tasks.length), 0, copy(lastRemoval.task));
        // Restoration keeps the deleted progress paused and never interrupts another running task.
        if (lastRemoval.wasActive && next.activeId === lastRemoval.fallbackId && next.startedAt === null) next.activeId = lastRemoval.task.id;
      }, () => {lastRemoval = null;});},
      configure(value) {return commit(next => {next.settings = settings(value);});},
      settle() {if (!loaded || state.startedAt === null) return Promise.resolve(null); const current = snapshot().tasks.find(t => t.id === state.activeId); if (!phase(current).finished) return Promise.resolve(null); return commit(next => {next.startedAt = null;});},
      dispose() {disposed = true; listeners.clear();}
    });
  }
  return Object.freeze({LIMITS, DEFAULT_SETTINGS, STORAGE_KEY, settings, plan, phase, normalize, fresh, materialize, createStore});
});
