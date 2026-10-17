(function (window) {
  'use strict';

  const NOTCH_TOKENS = typeof module === 'object' && module.exports ? require('./tokens.js') : window.NOTCH_TOKENS;
  const ISLAND_CONFIG = NOTCH_TOKENS.island;

  // An exact spring solution carries the current velocity through reversals.
  function createSurfaceMotion() {
    const keys = ['width', 'height', 'band', 'radius', 'progress', 'shoulder'];
    const values = {}, velocities = {}, target = {};
    let initialized = false, lastTime = 0, active = false, elapsed = 0;
    const {stiffness, damping, mass} = ISLAND_CONFIG.spring;
    const omega = Math.sqrt(stiffness / mass), decay = damping / (2 * mass);
    const frequency = Math.sqrt(omega * omega - decay * decay);

    function snap() {
      for (const key of keys) { values[key] = target[key]; velocities[key] = 0; }
      active = false;
    }

    function setTarget(next, {snap: immediate = false} = {}) {
      next = {shoulder: 0, ...next};
      if (!keys.every(key => Number.isFinite(next[key]))) return false;
      const changed = keys.some(key => target[key] !== next[key]);
      for (const key of keys) target[key] = next[key];
      if (changed) elapsed = 0;
      if (!initialized || immediate) { initialized = true; snap(); }
      else active = keys.some(key => Math.abs(values[key] - target[key]) > .01 || Math.abs(velocities[key]) > .1);
      return true;
    }

    function step(now, {snap: immediate = false} = {}) {
      if (!initialized) return null;
      const dt = Number.isFinite(now) ? Math.max(0, Math.min(.05, (now - lastTime) / 1000)) : 0;
      if (Number.isFinite(now)) lastTime = now;
      if (immediate) snap();
      else if (active && dt) {
        elapsed += dt;
        const attenuation = Math.exp(-decay * dt), sine = Math.sin(frequency * dt), cosine = Math.cos(frequency * dt);
        for (const key of keys) {
          const displacement = values[key] - target[key];
          const velocity = velocities[key];
          values[key] = target[key] + (displacement * cosine + (velocity + decay * displacement) / frequency * sine) * attenuation;
          velocities[key] = (velocity * cosine - (decay * velocity + omega * omega * displacement) / frequency * sine) * attenuation;
        }
        active = keys.some(key => Math.abs(values[key] - target[key]) > .01 || Math.abs(velocities[key]) > .1);
        if (!active || elapsed >= ISLAND_CONFIG.durations.surface / 1000 - 1e-9) snap();
      }
      return {...values};
    }

    function pulse(velocity = ISLAND_CONFIG.completion.surfaceVelocity) {
      if (!initialized || !Number.isFinite(velocity) || Math.abs(velocity) > 200) return false;
      velocities.height += velocity; elapsed = 0; active = true; return true;
    }
    return Object.freeze({setTarget, step, pulse, isActive: () => active});
  }

  function shape({width, height, radius, shoulder = 0}, viewportWidth) {
    const round = value => Math.round(value * 1000) / 1000;
    width = Math.max(1, round(width));
    height = Math.max(1, round(height));
    shoulder = Math.max(0, Math.min(height, round(shoulder)));
    if (Number.isFinite(viewportWidth)) width = Math.max(1, Math.min(width, round(viewportWidth - 32 - shoulder * 2)));
    const totalWidth = round(width + shoulder * 2), right = round(width + shoulder);
    radius = Math.max(0, Math.min(width / 2, height - shoulder, round(radius)));
    const bottom = round(height - radius);
    const path = shoulder ? `M0 0 H${totalWidth} C${right + shoulder * .45} 0 ${right} ${shoulder * .45} ${right} ${shoulder} V${bottom} A${radius} ${radius} 0 0 1 ${right - radius} ${height} H${shoulder + radius} A${radius} ${radius} 0 0 1 ${shoulder} ${bottom} V${shoulder} C${shoulder} ${shoulder * .45} ${shoulder * .55} 0 0 0 Z` : `M0 0 H${width} V${bottom} Q${width} ${height} ${round(width - radius)} ${height} H${radius} Q0 ${height} 0 ${bottom} V0 Z`;
    return {width: round(width), height, shoulder, radius, totalWidth, path};
  }

  function normalizeMusic(value = {}, previous = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
    const text = item => typeof item === 'string' ? item.slice(0, 240) : '';
    const title = text(value.title), artist = text(value.artist), source = text(value.source);
    const sourceId = typeof value.sourceId === 'string' ? value.sourceId.slice(0, 256) : '';
    const available = value.available === true;
    const number = item => Number.isFinite(item) ? Math.max(0, Math.min(604800, item)) : 0;
    const duration = number(value.duration);
    let cover = typeof value.cover === 'string' && value.cover.length <= 5_400_000 && /^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/]+={0,2}$/.test(value.cover) ? value.cover : '';
    if (value.cover === undefined && title === previous.title && artist === previous.artist && source === previous.source && sourceId === (previous.sourceId || '')) cover = previous.cover || '';
    return {available, title, artist, source, sourceId, cover: available ? cover : '', playing: available && value.playing === true,
      position: available ? Math.min(number(value.position), duration || 604800) : 0, duration: available ? duration : 0,
      canToggle: available && value.canToggle === true, canNext: available && value.canNext === true, canPrevious: available && value.canPrevious === true,
      canSeek: available && duration > 0 && value.canSeek === true,
      canShuffle: available && value.canShuffle === true && typeof value.shuffle === 'boolean', canRepeat: available && value.canRepeat === true && ['none', 'list', 'track'].includes(value.repeat),
      shuffle: typeof value.shuffle === 'boolean' ? value.shuffle : null, repeat: ['none', 'list', 'track'].includes(value.repeat) ? value.repeat : null,
      error: text(value.error)};
  }

  function musicPosition(music, elapsedMs) {
    const position = music.position + (music.playing ? Math.max(0, elapsedMs) / 1000 : 0);
    return Math.min(position, music.duration || 604800);
  }

  function spectrumLevels(values) {
    if (!Array.isArray(values) || values.length !== 8 || !values.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) return null;
    const bands = [Math.max(values[0], values[1]), values[2], Math.max(values[3], values[4]), values[5], Math.max(values[6], values[7])];
    // Native quiet passages need a perceptual gain, still driven by real samples.
    return bands.map(value => Math.min(1, 2 * Math.sqrt(Math.max(0, value - .01))));
  }

  function artworkColor(pixels) {
    const bins = new Map();
    for (let index = 0; index + 3 < pixels.length; index += 4) {
      const [r, g, b, alpha] = pixels.slice(index, index + 4), high = Math.max(r, g, b), low = Math.min(r, g, b);
      if (alpha < 180 || high < 45) continue;
      const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5), weight = 1 + (high - low) / 128;
      const bin = bins.get(key) || {weight: 0, r: 0, g: 0, b: 0};
      bin.weight += weight; bin.r += r * weight; bin.g += g * weight; bin.b += b * weight; bins.set(key, bin);
    }
    const dominant = [...bins.values()].sort((a, b) => b.weight - a.weight)[0];
    if (!dominant) return NOTCH_TOKENS.palette.white;
    const rgb = ['r', 'g', 'b'].map(key => Math.round(dominant[key] / dominant.weight));
    const lift = Math.max(0, 145 - Math.max(...rgb));
    return '#' + rgb.map(value => Math.min(255, value + lift).toString(16).padStart(2, '0')).join('');
  }
  function artworkPalette(accent = '') {
    if (typeof accent !== 'string' || !/^#[a-f0-9]{6}$/i.test(accent)) return {...NOTCH_TOKENS.palette.artworkFallback};
    const rgb = [1, 3, 5].map(offset => parseInt(accent.slice(offset, offset + 2), 16));
    const luminance = factor => rgb.map(value => value * factor / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0);
    const color = target => {
      let low = 0, high = 255 / Math.max(1, ...rgb);
      for (let step = 0; step < 16; step++) {const mid = (low + high) / 2; if (luminance(mid) <= target) low = mid; else high = mid;}
      return '#' + rgb.map(value => Math.floor(value * low).toString(16).padStart(2, '0')).join('');
    };
    return {base: color(.095), highlight: color(.12), shadow: color(.008)};
  }

  const openPanelLimits = Object.freeze({width: ISLAND_CONFIG.states.expanded.width, height: ISLAND_CONFIG.states.expanded.height});
  // Each module declares its content size and band behavior; the notch owns geometry.
  const moduleLayouts = NOTCH_TOKENS.modules.layouts;
  const moduleDefinitions = Object.fromEntries([
    ['music', 'Musique', 'music-player', 'music', ...NOTCH_TOKENS.modules.minimum.music, 'progress', 'spectrum', ['track'], 0],
    ['focus', 'Focus & tâches', 'focus-player', 'focus', ...NOTCH_TOKENS.modules.minimum.focus, 'progress', 'ring', ['phase', 'complete', 'task-complete'], 1],
    ['tasks', 'Tâches', 'tasks-player', 'tasks', ...NOTCH_TOKENS.modules.minimum.tasks, 'none', 'none', ['phase', 'complete', 'task-complete'], null],
    ['shelf', 'Étagère', 'shelf-player', 'tray', ...NOTCH_TOKENS.modules.minimum.shelf, 'none', 'none', ['sent', 'received', 'complete', 'kept'], null],
    ['weather', 'Météo', 'weather-player', 'weather', ...NOTCH_TOKENS.modules.minimum.weather, 'none', 'none', [], 2],
  ].map(([id, label, element, view, minWidth, minHeight, discreet, hover, changes, initialSlot]) => [id, Object.freeze({
    id, label, element, view, defaultInstalled: true, initialSlot, directOpen: ['shelf', 'weather'].includes(id),
    size: Object.freeze({width: moduleLayouts[id].panelWidth, height: moduleLayouts[id].height + NOTCH_TOKENS.modules.metrics.detailInset, minWidth, minHeight, maxHeight: id === 'focus' ? NOTCH_TOKENS.modules.metrics.focusMax : NOTCH_TOKENS.modules.metrics.detailMax}),
    layout: Object.freeze({...moduleLayouts[id], minHeight: moduleLayouts[id].height}),
    editor: Object.freeze({basis: moduleLayouts[id].basis + NOTCH_TOKENS.modules.metrics.editorInset, maxWidth: moduleLayouts[id].maxWidth + NOTCH_TOKENS.modules.metrics.editorInset, height: id === 'focus' ? NOTCH_TOKENS.modules.metrics.focusEditorHeight : moduleLayouts[id].height + NOTCH_TOKENS.modules.metrics.editorInset, grow: id === 'music' ? NOTCH_TOKENS.modules.metrics.musicGrow : 1}),
    band: Object.freeze({discreet, hover, changes: Object.freeze(changes)}),
  })]));
  function getModuleDefinitions() { return JSON.parse(JSON.stringify(Object.values(moduleDefinitions))); }

  function nookGridPlan(page, enabled = []) {
    const layouts = {
      music: [['music', 1, 1, 4, 4]],
      focus: [['focus', 1, 1, 2, 4], ['tasks', 3, 1, 2, 4]],
      tasks: [['pomodoro', 1, 1, 4, 1], ['tasks', 1, 2, 2, 3], ['shelf', 3, 2, 2, 3]],
      essential: [['weather', 1, 1, 2, 2], ['localsend', 3, 1, 2, 2], ['shelf', 1, 3, 2, 2], ['scenarios', 3, 3, 2, 2]],
    };
    const modules = Array.isArray(enabled) ? enabled : [];
    return (Object.hasOwn(layouts, page) ? layouts[page] : layouts.music).filter(([id]) => ['localsend', 'scenarios'].includes(id) || modules.includes(['tasks', 'pomodoro'].includes(id) ? 'focus' : id))
      .map(([id, column, row, columns, rows]) => ({id, column, row, columns, rows}));
  }

  function homeModuleLayout(ids, availableWidth, gap = 16, context = {}) {
    const ordered = Array.isArray(ids) ? ids.filter((id, index, list) => typeof id === 'string' && Object.hasOwn(moduleDefinitions, id) && list.indexOf(id) === index).slice(0, 4) : [];
    const placed = ordered.filter((id, index) => id !== 'shelf' || index === 0 || context?.completeScenario === true);
    const width = Number.isFinite(availableWidth) ? Math.max(0, availableWidth) : 0;
    gap = Number.isFinite(gap) ? Math.max(0, Math.min(32, gap)) : 16;
    if (!context || typeof context !== 'object' || Array.isArray(context)) context = {};
    const items = placed.map(id => {
      const definition = moduleDefinitions[id], compact = false;
      const layout = definition.layout;
      const expandedHeight = id === 'weather' && context.weatherPicker === true ? 248 : 0;
      return {id, compact, minWidth: compact ? layout.previewMinWidth : layout.minWidth,
        minHeight: Math.max(compact ? layout.previewHeight : layout.height, expandedHeight),
        basis: compact ? layout.previewBasis : layout.basis, maxWidth: compact ? layout.previewMaxWidth : layout.maxWidth};
    });
    if (context.dayScenario === true && ['music', 'focus', 'weather'].every(id => items.some(item => item.id === id)) && width >= moduleLayouts.music.minWidth + moduleLayouts.focus.minWidth + gap) {
      const columns = homeModuleLayout(['music', 'focus'], width, gap, {...context, dayScenario: false});
      const music = items.find(item => item.id === 'music'), focus = items.find(item => item.id === 'focus'), weather = items.find(item => item.id === 'weather');
      const rowHeights = [context.focusConfig === true ? 244 : focus.minHeight, weather.minHeight], totalWidth = columns.items[0].width + columns.items[1].width;
      Object.assign(music, {row: 0, column: 0, rowSpan: 2, width: columns.items[0].width, height: rowHeights[0] + rowHeights[1] + gap, share: columns.items[0].width * 100 / totalWidth});
      Object.assign(focus, {row: 0, column: 1, width: columns.items[1].width, height: rowHeights[0], minHeight: rowHeights[0], share: columns.items[1].width * 100 / totalWidth});
      Object.assign(weather, {row: 1, column: 1, width: Math.min(weather.maxWidth, columns.items[1].width), height: rowHeights[1], share: 100});
      return {items: [music, focus, weather], mode: 'day', columns: [music.share, focus.share], rows: 2, rowHeights, gap,
        preferredWidth: columns.preferredWidth, contentHeight: music.height,
        columnMinWidth: moduleLayouts.music.minWidth + moduleLayouts.focus.minWidth + gap, minWidth: Math.max(...items.map(item => item.minWidth))};
    }
    const lines = [];
    for (const item of items) {
      let line = lines.at(-1);
      if (!line || line.length >= (items.length === 4 ? 2 : 3) || line.reduce((sum, entry) => sum + entry.minWidth, 0) + line.length * gap + item.minWidth > width) lines.push(line = []);
      line.push(item);
    }
    for (const [row, line] of lines.entries()) {
      const useful = Math.max(0, width - (line.length - 1) * gap), minimum = line.reduce((sum, item) => sum + item.minWidth, 0);
      const preferred = line.reduce((sum, item) => sum + item.basis, 0), allowance = Math.max(0, useful - minimum);
      for (const item of line) item.width = preferred > useful ? item.minWidth + (preferred > minimum ? allowance * (item.basis - item.minWidth) / (preferred - minimum) : 0) : item.basis;
      let surplus = Math.max(0, useful - line.reduce((sum, item) => sum + item.width, 0));
      for (let pass = 0; pass < line.length && surplus > .01; pass++) {
        const growing = line.filter(item => item.width < item.maxWidth), weight = growing.reduce((sum, item) => sum + item.basis, 0);
        if (!weight) break;
        let allocated = 0;
        for (const item of growing) {const add = Math.min(item.maxWidth - item.width, surplus * item.basis / weight); item.width += add; allocated += add;}
        surplus -= allocated;
      }
      const total = line.reduce((sum, item) => sum + item.width, 0);
      for (const [column, item] of line.entries()) {
        if (item.id === 'focus' && context.focusConfig === true) item.minHeight = 244;
        Object.assign(item, {row, column, height: item.minHeight, share: total ? item.width * 100 / total : 100});
      }
    }
    const rowHeights = lines.map(line => Math.max(...line.map(item => item.height)));
    return {items, mode: items.length <= 1 ? 'single' : lines.length === 1 ? 'columns' : lines.every(line => line.length === 1) ? 'stacked' : 'wrapped',
      columns: lines[0]?.map(item => item.share) || [100], rows: lines.length, rowHeights, gap,
      preferredWidth: lines.length ? Math.max(...lines.map(line => line.reduce((sum, item) => sum + item.basis, 0) + (line.length - 1) * gap)) : 0,
      contentHeight: rowHeights.reduce((sum, height) => sum + height, 0) + Math.max(0, lines.length - 1) * gap,
      columnMinWidth: items.reduce((sum, item) => sum + item.minWidth, 0) + Math.max(0, items.length - 1) * gap,
      minWidth: items.length ? Math.max(...items.map(item => item.minWidth)) : 0};
  }

  // Keep supported saved placements in place; retired modules do not enter this base.
  function normalizeModules(value = {}) {
    const definitions = Object.values(moduleDefinitions), ids = definitions.map(item => item.id);
    if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
    const enabled = Array.isArray(value.enabled) ? value.enabled.filter((id, index, list) => ids.includes(id) && list.indexOf(id) === index) : definitions.filter(item => item.defaultInstalled).map(item => item.id);
    const source = Array.isArray(value.slots) ? value.slots : Array.from({length: 4}, (_, index) => definitions.find(item => item.initialSlot === index)?.id), used = new Set();
    const slots = Array.from({length: 4}, (_, index) => {
      const id = source[index];
      if (!ids.includes(id) || used.has(id)) return null;
      used.add(id); return id;
    });
    return {enabled, slots};
  }
  function assignModuleSlot(value, index, id) {
    const next = normalizeModules(value);
    if (!Number.isInteger(index) || index < 0 || index > 3 || id !== null && !Object.hasOwn(moduleDefinitions, id)) return next;
    const previous = id === null ? -1 : next.slots.indexOf(id);
    if (previous >= 0 && previous !== index) next.slots[previous] = next.slots[index];
    next.slots[index] = id; return next;
  }
  function modulePlacementPlan(value = {}) {
    const normalized = normalizeModules(value);
    const slots = normalized.slots.slice(0, 3).map(id => normalized.enabled.includes(id) ? id : null);
    const indices = slots.map((id, index) => id ? index : -1).filter(index => index >= 0), count = indices.length;
    const items = indices.map((slot, index) => ({id: slots[slot], slot, index,
      presentation: count === 1 ? 'full' : count === 3 && index ? 'rail' : 'scene',
      share: count === 1 ? 100 : 50, heightShare: count === 3 && index ? .5 : 1}));
    return {slots, indices, count, primary: items[0]?.id || null, primaryIndex: indices[0] ?? -1, items};
  }
  function moduleEditorPresentation(value, picked = null) {
    const plan = modulePlacementPlan(value), primary = plan.primaryIndex < 0 ? 0 : plan.primaryIndex;
    const presentations = Array.from({length: 3}, (_, slot) => slot === primary ? 'scene' : 'rail');
    return {slots: [...plan.slots], indices: [0, 1, 2], free: plan.slots.findIndex(id => !id), presentations,
      width: ISLAND_CONFIG.states.expanded.width, height: ISLAND_CONFIG.states.expanded.height - ISLAND_CONFIG.layout.header - ISLAND_CONFIG.layout.bottom};
  }

  const scenarioIds = Object.freeze(['focus', 'ambience', 'day', 'complete', 'minimal']);
  const scenarioRuleDefaults = Object.freeze({work: 'focus', break: 'ambience', morning: 'day', idle: 'ambience'});
  function normalizeScenarios(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
    const rules = Object.fromEntries(Object.entries(scenarioRuleDefaults).map(([key, scenario]) => [key, {
      enabled: value.rules?.[key]?.enabled !== false,
      scenario: scenarioIds.includes(value.rules?.[key]?.scenario) ? value.rules[key].scenario : scenario,
    }]));
    const day = value.lastMorningDay;
    const validDay = typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day + 'T00:00:00Z')) && new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) === day;
    return {mode: value.mode === 'manual' ? 'manual' : 'auto', rules,
      guards: Object.fromEntries(['undo', 'manualLock', 'interacting'].map(key => [key, value.guards?.[key] !== false])),
      selected: scenarioIds.includes(value.selected) ? value.selected : null,
      manualUntil: Number.isSafeInteger(value.manualUntil) && value.manualUntil >= 0 && value.manualUntil <= 8640000000000000 ? value.manualUntil : 0,
      lastMorningDay: validDay ? day : null};
  }
  function scenarioModulePlan(id, enabled, activity = {}) {
    if (!scenarioIds.includes(id)) return [];
    const available = Array.isArray(enabled) ? enabled.filter((item, index, list) => Object.hasOwn(moduleDefinitions, item) && list.indexOf(item) === index) : [];
    const plans = {focus: ['music', 'focus'], ambience: ['music', 'weather'], day: ['music', 'focus', 'weather'], complete: ['music', 'focus', 'weather', 'shelf']};
    if (id === 'minimal') return available.slice(0, 1);
    return (plans[id] || []).filter(item => available.includes(item));
  }
  function createScenarioController({value, now = () => Date.now(), schedule = setTimeout, unschedule = clearTimeout, activity = () => ({}), enabled = () => [], interacting = () => false, save = () => {}, changed = () => {}} = {}) {
    let preferences = normalizeScenarios(value), previousActivity = {...activity()}, pending = null, undoEntry = null, undoTimer = 0, idleTimer = 0, disposed = false;
    let notice = {kind: 'mode'};
    const copy = value => JSON.parse(JSON.stringify(value));
    const busy = value => value.focusActive === true || value.musicPlaying === true || value.transferActive === true;
    const locked = () => preferences.guards.manualLock && preferences.manualUntil > now();
    const announce = (layout = false) => {if (!disposed) changed({preferences: copy(preferences), notice: {...notice}, layout, undo: !!undoEntry && undoEntry.until >= now()});};
    const persist = () => save(copy(preferences));
    function clearUndo() {if (undoTimer) unschedule(undoTimer); undoTimer = 0; undoEntry = null;}
    function clearIdle() {if (idleTimer) unschedule(idleTimer); idleTimer = 0;}
    function validTrigger(kind) {
      const current = activity();
      return kind === 'idle' ? !busy(current) : kind === 'morning' ? !current.focusActive : current.focusActive === true && (current.focusPhase === 'break' ? 'break' : 'work') === kind;
    }
    function apply(id, automatic = false) {
      if (disposed || !scenarioIds.includes(id)) return false;
      if (!scenarioModulePlan(id, enabled(), activity()).length) {notice = {kind: 'empty', scenario: id}; announce(); return false;}
      pending = null;
      if (automatic && preferences.selected === id) {notice = {kind: 'mode'}; announce(); return true;}
      const prior = preferences.selected;
      clearUndo(); preferences.selected = id;
      if (!automatic) preferences.manualUntil = preferences.guards.manualLock ? Math.min(8640000000000000, now() + 7200000) : 0;
      else if (preferences.manualUntil <= now()) preferences.manualUntil = 0;
      notice = {kind: automatic ? 'automatic' : 'manual', scenario: id};
      if (automatic && preferences.guards.undo) {
        undoEntry = {selected: prior, until: now() + 5000};
        undoTimer = schedule(() => {undoTimer = 0; undoEntry = null; if (notice.kind === 'automatic') notice = {kind: 'mode'}; announce();}, 5000);
      }
      persist(); announce(true); return true;
    }
    function trigger(kind) {
      if (disposed || preferences.mode !== 'auto' || !preferences.rules[kind]?.enabled || locked() || !validTrigger(kind)) return false;
      const id = preferences.rules[kind].scenario;
      if (preferences.guards.interacting && interacting()) {pending = {kind, scenario: id}; notice = {kind: 'pending', scenario: id}; announce(); return false;}
      return apply(id, true);
    }
    function flush() {
      if (!pending || disposed || preferences.guards.interacting && interacting()) return false;
      const change = pending; pending = null;
      if (!validTrigger(change.kind)) {notice = {kind: 'mode'}; announce(); return false;}
      return trigger(change.kind);
    }
    function observe() {
      if (disposed) return;
      const current = {...activity()}, previous = previousActivity; previousActivity = current;
      if (pending && !validTrigger(pending.kind)) {pending = null; notice = {kind: 'mode'}; announce();}
      if (current.focusActive && (!previous.focusActive || !previous.focusRunning && current.focusRunning || current.focusPhase !== previous.focusPhase || current.focusSession !== previous.focusSession)) trigger(current.focusPhase === 'break' ? 'break' : 'work');
      if (busy(current)) clearIdle();
      else if (busy(previous) && preferences.mode === 'auto' && preferences.rules.idle.enabled) {
        clearIdle(); idleTimer = schedule(() => {idleTimer = 0; if (!disposed && !busy(activity())) trigger('idle');}, 1500);
      }
    }
    function morning() {
      if (disposed || preferences.mode !== 'auto' || !preferences.rules.morning.enabled || activity().focusActive) return false;
      const local = new Date(now());
      if (local.getHours() < 5 || local.getHours() >= 11) return false;
      const day = `${String(local.getFullYear()).padStart(4, '0')}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
      if (preferences.lastMorningDay === day) return false;
      preferences.lastMorningDay = day; persist(); return trigger('morning');
    }
    function configure(value) {
      if (disposed) return false;
      const prior = preferences.selected; preferences = normalizeScenarios(value);
      if (!preferences.guards.manualLock) preferences.manualUntil = 0;
      if (preferences.mode === 'manual') {pending = null; clearIdle();}
      else if (pending && !preferences.rules[pending.kind]?.enabled) pending = null;
      if (!preferences.rules.idle.enabled) clearIdle();
      if (!preferences.guards.undo) clearUndo();
      notice = {kind: 'mode'}; persist(); announce(prior !== preferences.selected); flush(); return true;
    }
    function undo() {
      if (disposed || !undoEntry || undoEntry.until < now() || !preferences.guards.undo) return false;
      preferences.selected = undoEntry.selected; pending = null; clearUndo();
      preferences.manualUntil = preferences.guards.manualLock ? Math.min(8640000000000000, now() + 7200000) : 0;
      notice = {kind: 'undone'}; persist(); announce(true); return true;
    }
    function dispose() {disposed = true; clearUndo(); clearIdle(); pending = null;}
    return Object.freeze({configure, pick: id => apply(id), trigger, observe, morning, flush, undo, dispose,
      getPreferences: () => copy(preferences), inspect: () => ({preferences: copy(preferences), pending: pending ? {...pending} : null, undoAvailable: !!undoEntry && undoEntry.until >= now(), undoUntil: undoEntry?.until || 0, idleScheduled: !!idleTimer, notice: {...notice}, disposed})});
  }

  function moduleActivitySnapshot(id, value = {}) {
    if (!value || typeof value !== 'object') value = {};
    if (id === 'music') return {available: value.available === true, title: value.title || '', artist: value.artist || '', source: value.source || '', running: value.playing === true};
    if (id === 'files') return {jobId: value.jobId || '', status: value.status || 'idle', command: value.command || '', name: value.result?.name || value.source?.name || ''};
    if (id !== 'focus') return null;
    const phase = value.pomodoro || {}, complete = value.complete === true || phase.finished === true;
    return {active: !complete && (value.sessionActive === true || !!value.deadline), running: !!value.deadline, complete, phase: phase.phase || 'work', session: phase.session || 1, total: phase.total || 4, breakKind: phase.breakKind || 'short'};
  }
  function moduleActivityChange(id, previous, next) {
    if (!previous || !next) return null;
    if (id === 'files') return previous.jobId && previous.jobId === next.jobId && previous.status === 'running' && next.status === 'complete' ? {id, kind: 'complete', title: next.command === 'ocr' ? 'Texte extrait' : 'Conversion terminée', detail: next.name || 'Le résultat est prêt'} : null;
    if (id === 'music') {
      if (!previous.available || !next.available || !(previous.title || previous.artist) || !(next.title || next.artist)) return null;
      if (['title', 'artist', 'source'].some(key => previous[key] !== next[key])) return {id, kind: 'track', title: 'Nouveau morceau', detail: next.title || next.artist};
      if (previous.running !== next.running) return {id, kind: next.running ? 'resume' : 'pause', title: next.running ? 'Musique reprise' : 'Musique en pause', detail: next.title || next.artist};
      return null;
    }
    if (id !== 'focus') return null;
    if (!previous.complete && next.complete) return {id, kind: 'complete', title: 'Cycle terminé', detail: 'Travail et pauses terminés'};
    if (previous.active && !next.active) return {id, kind: 'stop', title: 'Focus arrêté', detail: 'Prêt pour une prochaine session'};
    if (!previous.active && next.active) return {id, kind: 'start', title: 'Focus démarré', detail: `Session ${next.session} sur ${next.total}`};
    if (!next.active) return null;
    const label = next.phase === 'break' ? next.breakKind === 'long' ? 'Pause longue' : 'Pause courte' : 'Concentration';
    if (['phase', 'session', 'breakKind'].some(key => previous[key] !== next[key])) return {id, kind: 'phase', title: label, detail: `Session ${next.session} sur ${next.total}`};
    if (previous.running !== next.running) return {id, kind: next.running ? 'resume' : 'pause', title: next.running ? 'Focus repris' : 'Focus en pause', detail: label};
    return null;
  }

  const FocusAPI = typeof module === 'object' && module.exports ? require('./focus.js') : window.NotchyFocus;
  const {FocusModel, focusConfiguration, focusCardValues} = FocusAPI;

  function normalizeAppearance(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
    return {format: ['compact', 'balanced', 'comfortable'].includes(value.format) ? value.format : 'balanced',
      radius: Number.isFinite(value.radius) ? Math.max(12, Math.min(24, Math.round(value.radius))) : 18,
      motion: value.motion !== false};
  }

  function weatherNarrative(snapshot = {}) {
    const safe = (value, fallback = '') => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 300) : fallback;
    const degrees = value => Number.isFinite(value) ? Math.round(value) + '°' : '—';
    const available = Number.isFinite(snapshot.temperature), loading = snapshot.loading === true || snapshot.busy === true || snapshot.status === 'loading';
    const stale = available && (snapshot.stale === true || !!snapshot.error), forecast = snapshot.nextRain;
    const city = safe(snapshot.displayName || snapshot.city || snapshot.selectedCity?.name, snapshot.mode === 'local' ? 'Position actuelle' : 'Choisis une ville');
    let rain = 'pluie', rainQualifier = 'indisponible', rainIcon = false, forecastDescription = 'Prévision des précipitations pour les deux prochaines heures indisponible.';
    if (forecast?.available === true && forecast.periodMinutes === 120) {
      const rainKnown = Number.isFinite(forecast.rainMm) && forecast.rainMm >= 0, precipitationKnown = Number.isFinite(forecast.precipitationMm) && forecast.precipitationMm >= 0;
      if (rainKnown && forecast.rainMm > 0) { rain = 'pluie'; rainQualifier = 'prévue'; rainIcon = true; forecastDescription = 'Pluie prévue dans les deux prochaines heures.'; }
      else if (precipitationKnown && forecast.precipitationMm > 0) { rain = 'précipitations'; rainQualifier = 'prévues'; rainIcon = true; forecastDescription = 'Précipitations prévues dans les deux prochaines heures.'; }
      else if (rainKnown || precipitationKnown) { rain = rainKnown ? 'sans pluie' : 'au sec'; rainQualifier = rainKnown ? 'prévue' : ''; forecastDescription = rainKnown ? 'Pas de pluie prévue dans les deux prochaines heures.' : 'Pas de précipitations prévues dans les deux prochaines heures.'; }
    }
    if (stale) forecastDescription = 'Prévision précédente · ' + forecastDescription.replace('dans les deux prochaines heures', 'sur deux heures');
    let status = '';
    if (loading) status = available ? 'Actualisation…' : 'Chargement de la météo…';
    else if (stale) status = 'Dernières données connues · actualisation indisponible.';
    else if (!available) status = safe(snapshot.error, 'Choisis une ville ou utilise ta position actuelle.');
    return {temperature: degrees(snapshot.temperature), feelsLike: degrees(snapshot.feelsLike), city, when: stale ? 'dernier relevé' : 'maintenant', rain, rainQualifier, rainIcon, forecastDescription,
      horizon: stale ? 'prévision précédente · 2 h' : 'prochaines 2 h', loading, status, state: loading ? 'loading' : stale ? 'stale' : available ? 'ready' : 'unavailable'};
  }

  function weatherConditionPath(icon) {
    const cloud = 'M6 18h12a4 4 0 0 0 0-8 6 6 0 0 0-11-2 5 5 0 0 0-1 10Z';
    const paths = {
      sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5',
      moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z',
      cloud,
      'cloud-sun': 'M12 3v2M5 5l1.5 1.5M3 12h2m13-7-1.5 1.5M8 9a5 5 0 0 1 9 2M7 20h11a4 4 0 0 0 0-8 5 5 0 0 0-9-1 4.5 4.5 0 0 0-2 9Z',
      'cloud-moon': 'M17 3a6 6 0 0 0 4 9 6 6 0 0 1-7-1M6 20h12a4 4 0 0 0 0-8 5 5 0 0 0-9-1 4.5 4.5 0 0 0-3 9Z',
      rain: 'M6 15h12a4 4 0 0 0 0-8 6 6 0 0 0-11-2 5 5 0 0 0-1 10ZM8 18l-1 3m6-3-1 3m6-3-1 3',
      drizzle: 'M6 15h12a4 4 0 0 0 0-8 6 6 0 0 0-11-2 5 5 0 0 0-1 10ZM8 19v1m4-2v1m4 0v1',
      snow: 'M6 15h12a4 4 0 0 0 0-8 6 6 0 0 0-11-2 5 5 0 0 0-1 10ZM8 18v4m-2-2h4m6-2v4m-2-2h4',
      fog: 'M6 14h12a4 4 0 0 0 0-8 6 6 0 0 0-11-2 5 5 0 0 0-1 10ZM4 18h16M6 21h12',
      thunder: 'M6 15h12a4 4 0 0 0 0-8 6 6 0 0 0-11-2 5 5 0 0 0-1 10ZM12 14l-3 5h4l-2 4',
    };
    return Object.hasOwn(paths, icon) ? paths[icon] : cloud;
  }

  function weatherDesignValues(snapshot = {}, presentation = 'full', now = Date.now()) {
    const size = ['full', 'scene', 'rail'].includes(presentation) ? presentation : 'full';
    const validTemperature = value => Number.isFinite(value) && Math.abs(value) <= 150, available = validTemperature(snapshot.temperature);
    const today = new Date(now); if (!Number.isFinite(today.getTime()) || today.getFullYear() < 1900 || today.getFullYear() > 9999) today.setTime(Date.now());
    const date = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
    const validDate = value => {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = new Date(value + 'T12:00:00Z');
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    };
    const seenHours = new Set(), seenDays = new Set();
    const hours = available && Array.isArray(snapshot.hours) ? snapshot.hours.filter(hour => {
      const at = hour?.time;
      if (typeof at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(at) || !validDate(at.slice(0, 10)) || Number(at.slice(11, 13)) > 23 || Number(at.slice(14, 16)) > 59 || !validTemperature(hour.temperature) || seenHours.has(at)) return false;
      seenHours.add(at); return true;
    }).slice(0, {full: 6, scene: 4, rail: 2}[size]).map(hour => ({time: hour.time, temperature: Math.round(hour.temperature)})) : [];
    const days = available && size === 'full' && Array.isArray(snapshot.days) ? snapshot.days.filter(day => {
      if (!validDate(day?.date) || !validTemperature(day.min) || !validTemperature(day.max) || day.min > day.max || seenDays.has(day.date)) return false;
      seenDays.add(day.date); return true;
    }).slice(0, 3).map(day => ({date: day.date, min: Math.round(day.min), max: Math.round(day.max)})) : [];
    return {size, available, hours, days, narrative: size !== 'rail' && available, date,
      celsius: available ? Math.round(snapshot.temperature) : null, fahrenheit: available ? Math.round(snapshot.temperature * 9 / 5 + 32) : null,
      calendarTodayCount: Number.isSafeInteger(snapshot.calendarTodayCount) && snapshot.calendarTodayCount >= 0 && snapshot.calendarTodayCount <= 9999 ? snapshot.calendarTodayCount : null,
      min: validTemperature(snapshot.min) ? Math.round(snapshot.min) : null, max: validTemperature(snapshot.max) ? Math.round(snapshot.max) : null,
      rainRisk: Number.isFinite(snapshot.rainRisk) ? Math.round(Math.max(0, Math.min(100, snapshot.rainRisk))) : null};
  }

  function dragFileCount(dataTransfer) {
    const items = Array.from(dataTransfer?.items || []), count = items.filter(item => item.kind === 'file').length;
    return count || (dataTransfer?.files?.length > 0 ? dataTransfer.files.length : null);
  }

  function localSendFailureCopy(value) {
    const error = typeof value.error === 'string' ? value.error.trim().slice(0, 300) : '';
    const progress = Math.max(0, Math.min(100, Number(value.progress) || 0));
    if (value.stage === 'rejected') return {title: 'Demande refusée', detail: (value.alias || 'L’appareil') + ' a refusé le partage.', help: 'Tu peux demander un nouvel envoi.'};
    if (value.stage === 'cancelled') return {title: 'Transfert annulé', detail: 'Le transfert a été arrêté.', help: ''};
    return {title: progress > 0 ? 'Transfert interrompu à ' + Math.round(progress) + ' %' : 'Transfert impossible', detail: error || 'Vérifie que les appareils utilisent le même réseau Wi-Fi.', help: value.direction === 'receive' ? 'Relance l’envoi depuis l’appareil expéditeur.' : 'Réessayer démarre un nouvel envoi depuis le début.'};
  }

  function activitySnapshot({music = {}, focus = {}, transfer = null, file = null, now = Date.now()} = {}) {
    const activities = [], clean = value => typeof value === 'string' ? value.trim().slice(0, 240) : '';
    const clock = value => { const seconds = Math.max(0, Math.floor(Number(value) || 0)); return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0'); };
    if (!focus.pomodoro?.finished && (focus.sessionActive || focus.deadline)) {
      const seconds = FocusModel.remaining(focus, now), paused = !focus.deadline;
      activities.push({id: 'focus', label: paused || focus.pomodoro?.phase === 'break' ? 'Pause' : 'Focus', value: clock(seconds), detail: clean(focus.task), playing: !paused});
    }
    if (music.available === true) activities.push({id: 'music', label: clean(music.title) || 'Musique', value: clock(music.position), detail: clean(music.artist) || clean(music.source), playing: music.playing === true});
    if (transfer && ['incoming', 'preparing', 'waiting', 'sending', 'receiving'].includes(transfer.status)) {
      const progress = ['sending', 'receiving'].includes(transfer.status) && Number.isFinite(transfer.progress) ? Math.max(0, Math.min(1, transfer.progress / 100)) : null;
      activities.push({id: 'transfer', label: transfer.status === 'incoming' ? 'Demande de partage' : transfer.direction === 'receive' ? 'Réception' : 'Envoi', value: progress === null ? 'LocalSend' : Math.round(progress * 100) + ' %', detail: clean(transfer.alias), progress, playing: true});
    } else if (file?.status === 'running') {
      const progress = file.progress?.total > 0 && Number.isFinite(file.progress.current) ? Math.max(0, Math.min(1, file.progress.current / file.progress.total)) : null;
      activities.push({id: 'file', label: 'Fichier en cours', value: progress === null ? 'Étagère' : Math.round(progress * 100) + ' %', detail: clean(file.source?.name), progress, playing: true});
    }
    return activities.slice(0, 3);
  }

  function createActivityScene({now = Date.now, confirmation = 1600} = {}) {
    const entries = new Map();
    let order = [], serial = 0;
    const copy = () => ({primary: order[0] || null, rail: order.slice(1), items: order.map(id => ({...entries.get(id)}))});
    function update(values = [], {completed = [], interacting = null, preserveOrder = false} = {}) {
      const current = now(), active = new Map(), previousPrimary = order[0];
      for (const value of Array.isArray(values) ? values : []) {
        if (!value || !(Object.hasOwn(moduleDefinitions, value.id) || ['transfer', 'file'].includes(value.id)) || active.has(value.id)) continue;
        active.set(value.id, {...value});
        if (active.size === 3) break;
      }
      const added = [];
      for (const [id, value] of active) {
        const previous = entries.get(id), restarted = previous && (value.key !== previous.key || previous.complete);
        if (!previous || restarted) added.push(id);
        entries.set(id, {...value, started: previous && !restarted ? previous.started : ++serial, complete: false});
      }
      for (const [id, previous] of entries) {
        if (active.has(id)) continue;
        if (!previous.complete && completed.includes(id)) entries.set(id, {...previous, complete: true, progress: 1, until: current + confirmation});
        else if (!previous.complete || previous.until <= current) entries.delete(id);
      }
      order = order.filter(id => entries.has(id));
      for (const id of added) if (!order.includes(id)) order.push(id);
      // A newly started Focus earns the scene once. A deliberate rail promotion
      // remains selected on later ticks, even while that Focus keeps running.
      if (!entries.has(previousPrimary)) {
        const next = preserveOrder ? order[0] || active.keys().next().value : active.has('focus') ? 'focus' : active.has(interacting) ? interacting : [...active.keys()].sort((a, b) => entries.get(b).started - entries.get(a).started)[0];
        if (next) order = [next, ...order.filter(id => id !== next)];
      }
      if (!preserveOrder && added.includes('focus') && order[0] !== 'focus') order = ['focus', ...order.filter(id => id !== 'focus')];
      if (order.length > 3) {
        const expired = order.filter(id => entries.get(id)?.complete);
        while (order.length > 3) {const id = expired.shift() || order.at(-1); order = order.filter(value => value !== id); entries.delete(id);}
      }
      return copy();
    }
    function promote(id) {
      const index = order.indexOf(id);
      if (index < 1) return index === 0;
      [order[0], order[index]] = [order[index], order[0]];
      return true;
    }
    return Object.freeze({update, promote, inspect: copy, reset() {entries.clear(); order = []; serial = 0;}});
  }

  function closedBandSize(state, {activities = [], feedback = false} = {}) {
    if (state === 'compact' && feedback) {
      const {width, height, radius, shoulder} = feedback?.compact ? ISLAND_CONFIG.confirmation : ISLAND_CONFIG.notification;
      return {width, band: height, radius, shoulder, progress: 0};
    }
    const count = Math.min(3, activities.length);
    if (count && state === 'compact') {
      const sizes = ISLAND_CONFIG.activities, scale = sizes.peekScale;
      return {width: sizes.widths[count - 1] * scale, band: sizes.height * scale, radius: sizes.radius * scale, shoulder: sizes.shoulder * scale, progress: 0};
    }
    const size = ISLAND_CONFIG.states[state === 'compact' || state === 'compact' ? 'compact' : 'rest'];
    return {width: size.width, band: size.height, radius: size.radius, shoulder: 0, progress: 0};
  }

  if (typeof module === 'object' && module.exports) module.exports = {ISLAND_CONFIG, FocusModel, focusConfiguration, focusCardValues, weatherNarrative, weatherConditionPath, weatherDesignValues, dragFileCount, localSendFailureCopy, normalizeAppearance, normalizeModules, assignModuleSlot, modulePlacementPlan, moduleEditorPresentation, homeModuleLayout, nookGridPlan, getModuleDefinitions, openPanelLimits, normalizeScenarios, scenarioModulePlan, createScenarioController, moduleActivitySnapshot, moduleActivityChange, createSurfaceMotion, shape, normalizeMusic, musicPosition, spectrumLevels, artworkColor, artworkPalette, closedBandSize, activitySnapshot, createActivityScene};
  if (!window?.document) return;

  const document = window.document;
  const i18n = window.NotchyI18n;
  const t = (value, variables) => i18n.t(value, variables);
  const uiMessage = value => i18n.message(value);
  const renderStaticTranslations = i18n.bind(document);
  renderStaticTranslations();
  let removeLanguage = null;
  const notch = document.getElementById('notch');
  const toggle = document.getElementById('notch-toggle');
  const panel = document.getElementById('notch-panel');
  const expandedLayer = document.getElementById('island-expanded-layer');
  const islandFooter = document.getElementById('island-footer');
  const menu = document.getElementById('notch-menu');
  const menuButtons = [...menu.querySelectorAll('[data-view]')];
  let detailReturn = null, detailView = '';
  let calendar = null;
  let calendarReturnHost = null;
  const calendarInert = new Map();
  function syncCalendarLayer() {
    for (const button of panel.querySelectorAll('[data-weather-command="calendar"]')) button.setAttribute('aria-expanded', String(!!calendar?.isOpen()));
    if (calendar?.isOpen()) {
      for (const child of panel.children) if (child.id !== 'calendar-player') {
        if (!calendarInert.has(child)) calendarInert.set(child, child.inert);
        child.inert = true;
      }
    } else {
      for (const [child, inert] of calendarInert) if (child.isConnected) child.inert = inert;
      calendarInert.clear();
    }
  }
  function openCalendar(trigger) {
    if (!calendar || state !== 'open' || getModuleEditorActive()) return;
    calendarReturnHost = trigger.closest('.weather-design');
    calendar.open({trigger, keyboard:keyboardNavigation}); syncCalendarLayer();
  }
  function calendarClosed({trigger, restoreFocus}) {
    syncCalendarLayer();
    const target = calendarReturnHost?.querySelector('[data-weather-command="calendar"]') || trigger;
    calendarReturnHost = null;
    if (restoreFocus && target?.isConnected && !target.closest('[hidden],[inert]')) target.focus({preventScroll:true});
  }
  const detailBack = document.createElement('button'); detailBack.type='button'; detailBack.className='activity-detail-back'; detailBack.hidden=true; panel.prepend(detailBack);
  detailBack.addEventListener('click', () => {const origin=detailReturn; detailReturn=null; detailView=''; restoreFocusRoute(origin);});
  function renderDetailReturn() {
    detailBack.hidden = !detailReturn || view !== detailView || state !== 'open';
    detailBack.textContent = '← ' + t('Revenir à Nook'); panel.dataset.detailReturn=String(!detailBack.hidden);
  }
  const surface = document.getElementById('notch-surface');
  const contour = document.getElementById('notch-shape');
  const bandCut = document.getElementById('notch-band-cut');
  const panelCut = document.getElementById('notch-panel-cut');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motion = createSurfaceMotion();
  const sizes = {
    rest: closedBandSize('rest'),
    compact: closedBandSize('compact'),
    open: {width: ISLAND_CONFIG.states.expanded.width, band: 0, radius: ISLAND_CONFIG.states.expanded.radius, progress: 1},
  };
  let state = 'rest', view = 'nook', frame = 0, disposed = false, geometry, collapseTimer = 0, collapseDeferred = false, fileDialogOpen = false;
  let islandPage = 'music', scenarioReturnPage = null, closingTo = null, contentExitTimer = 0, hoverTimer = 0, welcomeStage = 'idle';
  const contentAnimations = new Map();
  const compactContent = document.getElementById('island-compact-content');
  const restContent = document.getElementById('island-rest-live');
  for (const [key, value] of Object.entries({spring: ISLAND_CONFIG.spring.easing, shadow: ISLAND_CONFIG.shadow, 'music-color': ISLAND_CONFIG.accents.music, 'focus-color': ISLAND_CONFIG.accents.focus, 'tasks-color': ISLAND_CONFIG.accents.tasks, 'equalizer-duration': ISLAND_CONFIG.compact.equalizerDuration + 'ms', 'navigation-duration': ISLAND_CONFIG.durations.navigation + 'ms', 'color-duration': ISLAND_CONFIG.durations.color + 'ms', 'progress-duration': ISLAND_CONFIG.durations.progress + 'ms', 'cover-size': ISLAND_CONFIG.compact.coverSize + 'px', 'cover-radius': ISLAND_CONFIG.compact.coverRadius + 'px', 'equalizer-width': ISLAND_CONFIG.compact.equalizerWidth + 'px', 'equalizer-height': ISLAND_CONFIG.compact.equalizerHeight + 'px', 'equalizer-min': ISLAND_CONFIG.compact.equalizerMinScale, 'navigation-size': ISLAND_CONFIG.expanded.navigationSize + 'px', 'navigation-active-width': ISLAND_CONFIG.expanded.navigationActiveWidth + 'px', 'play-size': ISLAND_CONFIG.expanded.playSize + 'px', 'header-height': ISLAND_CONFIG.layout.header + 'px', 'side': ISLAND_CONFIG.layout.side + 'px', 'bottom': ISLAND_CONFIG.layout.bottom + 'px', 'footer-height': ISLAND_CONFIG.layout.footer + 'px', 'gap': ISLAND_CONFIG.layout.gap + 'px', 'columns': ISLAND_CONFIG.layout.columns, 'rows': ISLAND_CONFIG.layout.rows, 'compact-width': ISLAND_CONFIG.states.compact.width + 'px', 'compact-height': ISLAND_CONFIG.states.compact.height + 'px', 'rest-width': ISLAND_CONFIG.states.rest.width + 'px', 'rest-height': ISLAND_CONFIG.states.rest.height + 'px', 'rest-marker-size': ISLAND_CONFIG.rest.marker + 'px', 'rest-handle-width': ISLAND_CONFIG.rest.handleWidth + 'px', 'rest-handle-height': ISLAND_CONFIG.rest.handleHeight + 'px', 'rest-equalizer-width': ISLAND_CONFIG.rest.equalizerWidth + 'px', 'rest-equalizer-height': ISLAND_CONFIG.rest.equalizerHeight + 'px'})) notch.style.setProperty('--island-' + key, value);
  function islandCoreView() { return !getModuleEditorActive() && ['nook', 'music', 'focus', 'tasks'].includes(view); }
  function animateIslandLayer(node, entering, compact = false) {
    if (!node) return;
    const current = getComputedStyle(node), from = {opacity: current.opacity, filter: current.filter, transform: current.transform};
    for (const animation of contentAnimations.get(node) || []) animation.cancel();
    const content = NOTCH_TOKENS.motion.content;
    const reducedMotion = !motionEnabled(), target = {opacity: entering ? '1' : '0', filter: reducedMotion || entering ? content.clearFilter : content.exitFilter, transform: reducedMotion || entering ? content.clearTransform : compact ? content.compactExit : content.expandedExit};
    node.style.pointerEvents = entering ? 'auto' : 'none'; node.inert = !entering;
    if (reducedMotion) {from.filter = target.filter = 'none'; from.transform = target.transform = 'none'; node.style.filter = 'none'; node.style.transform = 'none';}
    if (typeof node.animate !== 'function' || document.hidden) {Object.assign(node.style, target); return;}
    const delay = entering && !reducedMotion ? ISLAND_CONFIG.delays.content : 0;
    const fade = node.animate([{opacity: from.opacity, filter: from.filter}, {opacity: target.opacity, filter: target.filter}], {duration: reducedMotion ? ISLAND_CONFIG.durations.reduced : entering ? ISLAND_CONFIG.durations.contentEnter : ISLAND_CONFIG.durations.contentExit, delay, fill: 'both', easing: 'ease-out'});
    const movement = node.animate([{transform: from.transform}, {transform: target.transform}], {duration: reducedMotion ? ISLAND_CONFIG.durations.reduced : entering ? ISLAND_CONFIG.durations.contentSpring : ISLAND_CONFIG.durations.contentExit, delay, fill: 'both', easing: entering && !reducedMotion ? ISLAND_CONFIG.spring.easing : 'ease-out'});
    const animations = [fade, movement]; contentAnimations.set(node, animations);
    void Promise.all(animations.map(animation => animation.finished)).then(() => {if (contentAnimations.get(node) === animations) {Object.assign(node.style, target); for (const animation of animations) animation.cancel(); contentAnimations.delete(node);}}).catch(() => {});
  }
  function renderIslandNavigation() {
    const core = islandCoreView(); notch.dataset.islandCore = String(core); notch.dataset.islandPage = islandPage;
    notch.dataset.nookGrid = String(view === 'nook' && !getModuleEditorActive());
    islandFooter.hidden = !core; islandFooter.inert = state !== 'open' || !!closingTo;
    const page = view === 'focus' ? 'focus' : view === 'tasks' ? 'tasks' : islandPage;
    for (const button of islandFooter.querySelectorAll('[data-island-page]')) {
      const id = button.dataset.islandPage, enabled = id === 'essential' || isModuleEnabled(id) || id === 'tasks' && isModuleEnabled('focus');
      button.disabled = !enabled; button.setAttribute('aria-pressed', String(page === id)); button.style.setProperty('--tab-color', ISLAND_CONFIG.accents[id] || 'var(--ui-focus)');
    }
    focusComponent?.setPage?.(view === 'nook' ? 'split' : core ? page === 'tasks' ? 'tasks' : 'focus' : 'split');
  }
  function islandNavigation(event) {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.islandUtility) {selectViewButton({dataset: {view: button.dataset.islandUtility}}); setState('open'); return;}
    if (!button.dataset.islandPage || button.disabled) return;
    if (button.dataset.islandPage === 'music' && !musicInBand()) {islandPage = 'music'; selectViewButton({dataset: {view: 'music'}}); renderIslandNavigation(); update(); return;}
    islandPage = button.dataset.islandPage; selectViewButton({dataset: {view: 'nook'}});
    renderIslandNavigation(); update();
    if (motionEnabled() && typeof panel.animate === 'function') panel.animate([{opacity: 0}, {opacity: 1}], {duration: ISLAND_CONFIG.durations.contentExit, easing: 'ease-out'});
  }
  let homeLayout = null, pointerInside = false, keyboardNavigation = false;
  let localSendContext = null, nearbyMutation = 0, nearbyLoaded = false;
  const byId = id => document.getElementById(id);
  const desktop = window.notchyDesktop?.isDesktop ? window.notchyDesktop : null;
  let search = null, searchReturnView = 'nook', searchReturnState = 'rest', searchShortcut = 'Ctrl+K';
  let moduleLibrary = null, libraryReturnView = 'settings', libraryReturnFocus = null;
  const communityStore = window.NotchyModules.createStore({storage: window.localStorage, key: 'notchy-community-modules-v1', persist: desktop?.saveModuleRegistry ? encoded=>desktop.saveModuleRegistry(encoded) : undefined});
  const communityCards = new Map(), communityDisposers = new Map(), communitySignatures = new Map();
  function refreshCommunityDefinitions() {
    const entries = communityStore.list(), ids = entries.map(item => item.manifest.id);
    for (const id of Object.keys(moduleDefinitions)) if (moduleDefinitions[id].community && !ids.includes(id)) {
      communityDisposers.get(id)?.(); communityDisposers.delete(id); communitySignatures.delete(id);
      communityCards.get(id)?.remove(); communityCards.delete(id); delete moduleDefinitions[id];
    }
    for (const {manifest} of entries) {
      const id = manifest.id, template = moduleDefinitions.weather;
      moduleDefinitions[id] = Object.freeze({...template, id, community: true, label: manifest.name[i18n.locale()], description: manifest.description[i18n.locale()], element: 'community-module-' + id, view: 'nook', defaultInstalled: false, initialSlot: null, directOpen: false, band: Object.freeze({discreet:'none',hover:'none',changes:[]})});
      if (!communityCards.has(id)) {const card = document.createElement('article'); card.id = moduleDefinitions[id].element; card.className = 'community-module-host activity-card activity-card-secondary'; card.hidden = true; panel.append(card); communityCards.set(id, card);}
    }
  }
  refreshCommunityDefinitions();
  function showModuleLibrary() {
    if (disposed || welcome?.isActive() || view === 'localsend' && nearby.incoming) return false;
    if (view !== 'module-library') {libraryReturnView = view; libraryReturnFocus = document.activeElement;}
    if (getModuleEditorActive()) closeModuleEditor(false);
    selectViewButton({dataset:{view:'module-library'}}); openFromOutside(); moduleLibrary?.show(); return true;
  }
  function closeModuleLibrary() {
    moduleLibrary?.hide(); selectViewButton({dataset:{view:libraryReturnView === 'module-library' ? 'nook' : libraryReturnView}});
    if (libraryReturnFocus?.isConnected && !libraryReturnFocus.closest('[hidden],[inert]')) libraryReturnFocus.focus({preventScroll:true});
  }
  function placeCommunityModule(id) {
    if (!communityStore.get(id)) return;
    const next = getModules(); if (!next.enabled.includes(id)) next.enabled.push(id);
    const slot = next.slots.findIndex((item,index) => index < 3 && (!item || !next.enabled.includes(item)));
    const destination = next.slots.slice(0,3).includes(id) ? next.slots.indexOf(id) : slot >= 0 ? slot : 0;
    const result = assignModuleSlot(next, destination, id); moduleLibrary?.hide(); setModules(result); selectViewButton({dataset:{view:'nook'}}); openFromOutside();
  }
  function renderCommunityCard(id, presentation) {
    const entry = communityStore.get(id), host = communityCards.get(id); if (!entry || !host) return;
    const signature = JSON.stringify([entry, presentation, i18n.locale()]); if (communitySignatures.get(id) === signature) return;
    const active = host.contains(document.activeElement) ? document.activeElement : null, action = active?.dataset?.moduleAction;
    communityDisposers.set(id, window.NotchyModules.render(host,entry.manifest,entry.state,{presentation,language:i18n.locale(),async onAction(action,value) {
      host.setAttribute('aria-busy','true');
      try {await communityStore.performAction(id,action,value);host.querySelector('.community-module-error')?.remove();}
      catch (error) {let status=host.querySelector('.community-module-error');if(!status){status=document.createElement('p');status.className='community-module-error';status.setAttribute('role','alert');host.append(status);}status.textContent=t('Enregistrement impossible. Réessaie.');}
      finally {host.removeAttribute('aria-busy');}
    }}));
    communitySignatures.set(id, signature); if (action) host.querySelector(`[data-module-action="${action}"]`)?.focus({preventScroll:true});
  }
  function renderSearchRoute() {
    const active = view === 'search' && state === 'open';
    byId('search-player').hidden = !active;
    byId('search-toggle').setAttribute('aria-expanded', String(active));
    byId('search-toggle').title = t('Rechercher') + ' · ' + searchShortcut;
  }
  async function invokeSearch(operation, args = {}) {
    if (!desktop?.search) throw new Error('Desktop search unavailable');
    const value = await desktop.search(operation, args);
    if (value?.shortcut) {
      searchShortcut = value.shortcut.available && typeof value.shortcut.shortcut === 'string' ? value.shortcut.shortcut : 'Ctrl+K';
      byId('search-toggle').setAttribute('aria-keyshortcuts', searchShortcut.replace('Ctrl', 'Control'));
      renderSearchRoute();
    }
    return value;
  }
  function showSearch() {
    if (disposed || !search || welcome?.isActive() || fileDialogOpen || fileDragging || getModuleEditorActive()
      || view === 'localsend' && nearby.incoming) return false;
    if (search.isOpen()) return search.close();
    return search.open();
  }
  function searchOpening() {
    searchReturnView = view === 'search' ? 'nook' : view;
    searchReturnState = state === 'open' ? 'open' : 'rest';
    clearModuleFeedback(false);
    selectViewButton({dataset: {view: 'search'}}); openFromOutside();
  }
  function searchClosed() {
    if (disposed || view !== 'search') return;
    selectViewButton({dataset: {view: searchReturnView}}); setState(searchReturnState);
  }
  async function searchSend(id) {
    const result = await invokeSearch('search_stage', {id});
    if (!search?.isOpen() || view !== 'search' || disposed) return;
    if (!result?.item || typeof result.item.id !== 'string') throw new Error('File unavailable');
    search.close({restoreFocus: false, notify: false});
    shelfLoaded = false;
    selectViewButton({dataset: {view: searchReturnView}});
    openLocalSend('send', [result.item]);
  }
  let desktopMaxHeight = 700, desktopRemoveResume = null, desktopMouse = null, desktopInteractive = false;
  if (desktop) { document.documentElement.dataset.desktop = 'true'; document.body.classList.add('desktop'); }
  let appearance = normalizeAppearance();
  try { appearance = normalizeAppearance(JSON.parse(window.localStorage.getItem('notchy-minimal-appearance-v1'))); } catch {}
  function motionEnabled() { return appearance.motion && !reduced.matches; }
  function renderAppearance() {
    document.body.dataset.motion = String(motionEnabled());
    document.body.dataset.appearanceFormat = appearance.format;
    byId('appearance-format').value = appearance.format;
    for (const button of settingsPlayer.querySelectorAll('[data-appearance-format]')) button.setAttribute('aria-pressed', String(button.dataset.appearanceFormat === appearance.format)); byId('appearance-radius').value = appearance.radius;
    byId('appearance-radius-value').value = appearance.radius <= 15 ? t('Net') : appearance.radius >= 21 ? t('Doux') : t('Équilibré'); byId('appearance-motion').checked = appearance.motion;
  }
  function setAppearance(value, persist = true) {
    if (disposed) return false;
    appearance = normalizeAppearance({...appearance, ...value});
    if (persist) try { window.localStorage.setItem('notchy-minimal-appearance-v1', JSON.stringify(appearance)); } catch {}
    renderAppearance(); islandMotionPreference(); musicLifecycle(); return true;
  }
  function appearanceInput(event) {
    if (event.target.id === 'appearance-format') setAppearance({format: event.target.value});
    else if (event.target.id === 'appearance-radius') setAppearance({radius: Number(event.target.value)});
    else if (event.target.id === 'appearance-motion') setAppearance({motion: event.target.checked});
  }
  function desktopPointer(event) {
    if (!desktop || disposed) return;
    if (event) desktopMouse = {x: event.clientX, y: event.clientY};
    const hit = desktopMouse && document.elementFromPoint(desktopMouse.x, desktopMouse.y);
    const interactive = !!hit?.closest('#notch-toggle,#notch-panel,#notch-menu,#island-footer,#module-feedback-actions,#notch-surface > use,#music-hover-controls button');
    if (interactive !== desktopInteractive) { desktopInteractive = interactive; desktop.setInteractive(interactive); }
  }
  function desktopFocus(event) { if (desktop && event.target.closest('#notch')) desktop.focus(); }
  for (const [key, value] of Object.entries(ISLAND_CONFIG.rest)) notch.style.setProperty('--island-rest-' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()), value + 'px');
  const player = byId('music-player'), live = byId('music-live'), strip = byId('music-discreet-progress');
  const commands = [...notch.querySelectorAll('[data-music-command]')];

  const musicTools = document.createElement('div'); musicTools.className = 'music-queue-tools';
  musicTools.append(byId('music-source'), ...['shuffle', 'repeat'].map(command => player.querySelector(`[data-music-command="${command}"]`)));
  byId('music-queue').querySelector('.music-queue-heading').after(musicTools);
  player.querySelector('.music-controls').prepend(player.querySelector('[data-music-command="shuffle"]'));
  const musicFavorite = document.createElement('button'); musicFavorite.type='button'; musicFavorite.className='music-favorite'; musicFavorite.disabled=true;
  musicFavorite.setAttribute('aria-label',t('Les favoris ne sont pas partagés par le lecteur Windows')); musicFavorite.title=musicFavorite.getAttribute('aria-label');
  musicFavorite.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>';
  player.querySelector('.music-controls').append(musicFavorite);
  const musicEmpty = document.createElement('div'); musicEmpty.className='music-empty-reference';
  musicEmpty.innerHTML='<svg viewBox="0 0 56 56" aria-hidden="true"><rect x="10" y="24" width="6" height="16" rx="3"/><rect x="20" y="14" width="6" height="26" rx="3"/><rect x="30" y="9" width="6" height="31" rx="3"/><rect x="40" y="20" width="6" height="20" rx="3"/></svg><strong></strong><p></p><button type="button" data-music-command="open"></button>';
  player.append(musicEmpty);
  player.querySelector('.music-main').append(byId('music-queue-toggle'));
  for (const bars of notch.querySelectorAll('.music-spectrum')) {while (bars.children.length < ISLAND_CONFIG.compact.equalizerBars) bars.append(document.createElement('i')); while (bars.children.length > ISLAND_CONFIG.compact.equalizerBars) bars.lastElementChild.remove();}
  for (const bars of notch.querySelectorAll('.music-spectrum')) [...bars.children].forEach((bar, index) => bar.style.animationDelay = (ISLAND_CONFIG.compact.equalizerDelays[index] || 0) + 'ms');
  const liveBars = [...byId('music-live-spectrum').children], playerBars = [...byId('music-player-spectrum').children], feedbackBars = [...byId('module-feedback-spectrum').children];
  const restBars = [...restContent.querySelector('.rest-spectrum').children];
  const spectrumBars = [...notch.querySelectorAll('.music-spectrum i,.rest-spectrum i')];
  const coverImages = [byId('music-cover'), byId('music-live-cover')];
  let spectrumArtwork = '';
  let music = normalizeMusic(), musicAt = window.performance.now(), musicError = '';
  let stream = null, retiringStream = null, streamSpectrum = false, clock = 0, clockDelay = 0, commandBusy = false, connectionLost = false;
  const musicSeek = byId('music-seek');
  let seekPreview = null, seekTrack = null, seekDragging = false;
  const shelfPlayer = byId('shelf-player'), shelfInput = byId('shelf-input'), shelfList = byId('shelf-list');
  const selectedFiles = new Set();
  let shelfItems = [], shelfLoaded = false, shelfBusy = false, shelfError = '', shelfDownloadError = false, shelfEpoch = 0, fileDragging = false, dragDepth = 0, fileDragCount = null, fileDragPreviousState = null;
  // Original module editor: four independent previews, then the integrated palette.
  const modulesPlayer = byId('modules-player'), moduleStorageKey = 'notchy-minimal-modules-v1';
  const scenarioStorageKey = 'notchy-scenarios-v1';
  let scenarioController = null, scenarioPreferences = normalizeScenarios();
  try {const saved = window.localStorage.getItem(scenarioStorageKey); if (saved && saved.length <= 4096) scenarioPreferences = normalizeScenarios(JSON.parse(saved));} catch {}
  const moduleLabels = Object.fromEntries(Object.values(moduleDefinitions).map(item => [item.id, t(item.label)]));
  let queueOpen = false, queueClosing = false, queueActive = false, queueBusy = false, queueTimer = 0, queueEpoch = 0, queueRetryUntil = 0, queueListSignature = '';
  let queueState = {status: 'disconnected', current: null, items: [], message: ''};
  let queueNotice = '', queueOperation = '';
  const queueBackdrop = new Map();
  let experience = null, sharingExperience = null, ia = null;
  let moduleOrder = ['music', 'focus', 'weather', 'tasks', 'shelf'], moduleDraftOrder = null, moduleOrderSaved = false;
  try {const raw=window.localStorage.getItem('notchy-module-order-v1'); if (raw && raw.length < 512) {const saved=JSON.parse(raw); if (Array.isArray(saved)) {moduleOrder = window.NotchyExperience.normalizeModuleState({order:saved}).order; moduleOrderSaved=true;}}} catch {}
  let welcome = null;
  const welcomeStorageKey = 'notchy-minimal-welcome-v1';
  let welcomeReturnView = 'nook', welcomeReturnState = 'open';
  function showWelcome(mode = 'welcome') {
    if (disposed || !welcome) return false;
    if (getModuleEditorActive()) closeModuleEditor(false);
    if (view !== 'welcome') { welcomeReturnView = view; welcomeReturnState = state === 'rest' ? 'open' : state; }
    clearModuleFeedback(); selectViewButton({dataset: {view: 'welcome'}}); panel.scrollTop = 0; panel.scrollLeft = 0; setState('open'); welcome.show(mode);
    return true;
  }
  function finishWelcome(nextState = welcomeReturnState, completed = false) {
    welcome?.hide();
    if (completed) try { window.localStorage.setItem(welcomeStorageKey, 'done'); } catch {}
    selectViewButton({dataset: {view: welcomeReturnView || 'nook'}}); setState(nextState);
  }
  function replayWelcome() { showWelcome(); }
  let moduleFeedback = null, moduleFeedbackTimer = 0, moduleFeedbackSequence = 0;
  const moduleFeedbackAnimations = new Set();
  const moduleActivityStates = new Map();
  function animateModuleChange(element) {
    if (!element || !motionEnabled() || document.hidden || !element.getClientRects().length) return;
    const animation = element.animate(NOTCH_TOKENS.motion.reveal, {duration: NOTCH_TOKENS.dur.base, easing: NOTCH_TOKENS.ease.out});
    moduleFeedbackAnimations.add(animation); animation.finished.then(() => moduleFeedbackAnimations.delete(animation), () => moduleFeedbackAnimations.delete(animation));
  }
  function renderModuleFeedback() {
    const feedback = moduleFeedback && isModuleEnabled(moduleFeedback.id) ? localizedFeedback(moduleFeedback) : null;
    const closed = byId('module-feedback-live'), opened = byId('module-feedback-open');
    closed.hidden = !feedback || state !== 'compact' || fileDragging;
    opened.hidden = !feedback || state !== 'open' || fileDragging;
    const focusFeedback = feedback && ['focus', 'tasks'].includes(feedback.id);
    const done = !!feedback && (feedback.id === 'shelf' || focusFeedback && (feedback.kind === 'task-complete' || feedback.kind === 'complete' || feedback.kind === 'phase' && focus.pomodoro?.phase === 'break'));
    notch.dataset.feedback = feedback ? done ? 'done' : feedback.id === 'music' && feedback.kind === 'track' ? 'track' : 'change' : '';
    notch.dataset.feedbackCompact = String(!!feedback?.compact);
    const actions = byId('module-feedback-actions'); actions.hidden = closed.hidden || !done;
    byId('module-feedback-spectrum').hidden = closed.hidden || feedback?.id !== 'music';
    if (!feedback) return;
    for (const id of ['module-feedback-title', 'module-feedback-open-title']) text(byId(id), feedback.title);
    text(byId('module-feedback-detail'), feedback.detail);
    text(byId('module-feedback-label'), feedback?.kind === 'task-complete' ? t('Tâche terminée').toLocaleUpperCase(i18n.locale()) : done ? focusFeedback ? t('SESSION TERMINÉE') : t('C’EST PRÊT') : feedback.id === 'music' ? t('EN LECTURE') : 'FOCUS');
    if (done && focusFeedback && feedback.kind !== 'task-complete') {
      text(byId('module-feedback-title'), focus.task?.trim() || (feedback.kind === 'complete' ? t('Cycle terminé') : t('Un moment pour souffler')));
      text(byId('module-feedback-detail'), focus.pomodoro?.phase === 'break' && !focus.complete ? t('La pause a commencé') : t('Travail et pauses terminés'));
    } else if (feedback.id === 'music') { text(byId('module-feedback-title'), music.title || feedback.title); text(byId('module-feedback-detail'), music.artist || music.source); }
    const cycles = byId('module-feedback-cycles'); cycles.hidden = !done || !focusFeedback || feedback.kind === 'task-complete';
    if (!cycles.hidden) {
      const card = focusCardValues(focus, focusSettings), signature = card.completed + '/' + card.total + '/' + i18n.locale();
      if (cycles.dataset.value !== signature) { cycles.dataset.value = signature; cycles.replaceChildren(...Array.from({length: card.total}, (_, index) => { const pip = document.createElement('i'); pip.className = index < card.completed ? 'completed' : ''; return pip; })); const label = document.createElement('small'); label.textContent = t('{completed} sur {total}', {completed: card.completed, total: card.total}); cycles.append(label); }
    }
    text(actions.querySelector('[data-feedback-command="open"]'), feedback.kind === 'task-complete' ? t('Voir les tâches') : focusFeedback ? focus.complete ? t('Voir Focus') : t('Voir la pause') : t('Voir le résultat'));
    actions.querySelector('[data-feedback-command="skip"]').hidden = !focusFeedback || !focusIsActive() || focus.pomodoro?.phase !== 'break';
    notch.style.setProperty('--module-feedback-color', feedback.id === 'music' ? notch.style.getPropertyValue('--spectrum-color') || 'var(--color-fff)' : feedback.kind === 'complete' || feedback.kind === 'task-complete' ? 'var(--status-success)' : ['files', 'shelf'].includes(feedback.id) ? 'var(--activity-shelf)' : feedback.kind === 'phase' && focus.pomodoro?.phase === 'break' ? focus.pomodoro.breakKind === 'long' ? 'var(--activity-long)' : 'var(--activity-break)' : 'var(--activity-focus)');
    if (closed.dataset.sequence !== String(feedback.sequence)) {
      closed.dataset.sequence = String(feedback.sequence);
      const original = feedback.id === 'music' ? byId('music-live').querySelector('.live-art') : done ? shelfGlyph('check') : byId('focus-live').querySelector('svg');
      const icon = original.cloneNode(true); icon.removeAttribute('id'); for (const node of icon.querySelectorAll('[id]')) node.removeAttribute('id');
      if (done) { icon.replaceChildren(); icon.innerHTML = '<circle class="completion-circle" cx="12" cy="12" r="10" pathLength="1"/><path class="completion-check" d="m7 12 3.5 3.5 6.5-7" pathLength="1"/>'; }
      byId('module-feedback-icon').replaceChildren(icon);
    }
  }
  function clearModuleFeedback(render = true) {
    window.clearTimeout(moduleFeedbackTimer); moduleFeedbackTimer = 0;
    for (const animation of moduleFeedbackAnimations) animation.cancel(); moduleFeedbackAnimations.clear();
    moduleFeedback = null;
    if (render && !disposed) { renderModuleFeedback(); renderLiveActivities(); update(); recheckCollapse(); }
  }
  function localizedFeedback(value) {
    const detail = ['focus', 'tasks'].includes(value.id) && value.kind !== 'task-complete' ? value.detail.startsWith('Session ') ? t('Session {session} sur {total}', {session: focus.pomodoro?.session || 1, total: focus.pomodoro?.total || 4}) : t(value.detail) : value.detail;
    return {...value, title: t(value.title), detail};
  }
  function musicAnnouncementBlocked() {
    // The feedback's own quiet-return guard is not user interaction.
    return document.hidden || pointerInside || commandBusy || queueBusy || state === 'open' && view === 'search' || protectedInteraction({ignoreFeedback:true});
  }
  function dismissMusicTrackFeedback() {
    if (moduleFeedback?.id !== 'music' || moduleFeedback.kind !== 'track') return;
    text(byId('module-feedback-announcer'), ''); clearModuleFeedback();
  }
  function notifyModuleChange(event) {
    if (event?.id === 'files') event = {...event, id: 'shelf'};
    if (event?.id === 'focus' && !isModuleEnabled('focus') && isModuleEnabled('tasks')) event = {...event, id: 'tasks'};
    const definition = moduleDefinitions[event?.id];
    if (disposed || !definition || !isModuleEnabled(event.id) || !definition.band.changes.includes(event.kind) || document.hidden) return;
    if (event.id === 'music' && event.kind === 'track' && musicAnnouncementBlocked()) {dismissMusicTrackFeedback(); return;}
    const restoreQuiet = state === 'rest' || moduleFeedback?.restoreQuiet === true;
    clearModuleFeedback(false);
    moduleFeedback = {...event, sequence: ++moduleFeedbackSequence, restoreQuiet};
    const copy = localizedFeedback(event);
    text(byId('module-feedback-announcer'), `${t(definition.label)} · ${copy.title} · ${copy.detail}`);
    if (state === 'rest' && !protectedInteraction()) setState('compact');
    renderLiveActivities(); renderModuleFeedback();
    update();
    if (state === 'open') {
      animateModuleChange(byId('module-feedback-open'));
      const host = getModuleEditorActive() ? byId('module-catalog').querySelector(`[data-module-id="${event.id}"] .module-tile`) : byId(definition.element);
      if (event.id !== 'music' || event.kind !== 'track') animateModuleChange(host);
      animateModuleChange(byId('home-side').querySelector(`[data-module-open="${event.id}"]`));
    } else if (!byId('module-feedback-live').hidden) animateModuleChange(byId('module-feedback-live'));
    moduleFeedbackTimer = window.setTimeout(() => {
      const quiet = moduleFeedback?.restoreQuiet; clearModuleFeedback();
      if (quiet && state === 'compact' && !pointerInside && !protectedInteraction()) setState('rest');
    }, ISLAND_CONFIG.notification.duration);
  }
  function observeModuleActivity(id, value) {
    const next = moduleActivitySnapshot(id, value), previous = moduleActivityStates.get(id);
    moduleActivityStates.set(id, next);
    const event = moduleActivityChange(id, previous, next); if (event) notifyModuleChange(event);
  }
  function feedbackVisibility() {
    if (!document.hidden) return;
    clearModuleFeedback();
    settleIslandLayers();
  }
  function settleIslandLayers() {
    if (closingTo) {const next = closingTo; window.clearTimeout(contentExitTimer); closingTo = null; contentExitTimer = 0; applyState(next);}
    for (const animations of contentAnimations.values()) for (const animation of animations) animation.cancel();
    contentAnimations.clear();
    const miniControls = byId('music-hover-controls');
    for (const [node, visible, compact] of [[expandedLayer, state === 'open', false], [toggle, state !== 'open', true], [compactContent, state === 'compact', true], [restContent, state !== 'compact', true], [miniControls, miniControls.dataset.visible === 'true', true]]) {
      const simple = !motionEnabled();
      Object.assign(node.style, {opacity: visible ? '1' : '0', filter: simple || visible ? 'none' : NOTCH_TOKENS.motion.content.exitFilter, transform: simple || visible ? 'none' : compact ? NOTCH_TOKENS.motion.content.compactExit : NOTCH_TOKENS.motion.content.expandedExit, pointerEvents: visible ? 'auto' : 'none'});
      node.inert = !visible;
    }
    miniControls.style.pointerEvents = 'none'; miniControls.hidden = miniControls.dataset.visible !== 'true';
    renderIslandNavigation();
  }
  function islandMotionPreference() {settleIslandLayers(); update();}

  function feedbackCommand(event) {
    const command = event.target.closest('[data-feedback-command]')?.dataset.feedbackCommand, feedback = moduleFeedback;
    if (!command || !feedback || disposed) return;
    event.stopPropagation();
    if (command === 'skip' && ['focus', 'tasks'].includes(feedback.id)) { clearModuleFeedback(); focusComponent.command('skip'); return; }
    const id = feedback.id, target = feedback.kind === 'task-complete' ? 'tasks' : ['focus', 'tasks'].includes(id) ? 'focus' : moduleDefinitions[id].view; clearModuleFeedback(); selectViewButton({dataset: {view: target}}); setState('open');
  }
  const moduleMime = 'application/x-notchy-module';
  let moduleSettings = normalizeModules(), moduleDraft = null, moduleMessage = '', moduleEditing = false;
  let modulePicked = null, moduleSelected = 0, modulePreviousView = 'nook', modulePreviousState = 'open', moduleReturnFocus = null;
  try {
    const saved = window.localStorage.getItem(moduleStorageKey);
    if (saved && saved.length <= 8192) moduleSettings = normalizeModules(JSON.parse(saved));
  } catch {}
  if (!moduleOrderSaved) moduleOrder=[...new Set([...moduleSettings.slots.filter(Boolean),...moduleSettings.enabled,...moduleOrder])];
  function getModules() { return {enabled: [...moduleSettings.enabled], slots: [...moduleSettings.slots]}; }
  function isModuleEnabled(id) { return moduleSettings.enabled.includes(id); }
  function focusCoreEnabled() { return isModuleEnabled('focus') || isModuleEnabled('tasks'); }
  function configuredModuleOrder() {
    const ordered = moduleSettings.slots.filter(id => isModuleEnabled(id));
    return [...ordered, ...moduleSettings.enabled.filter(id => !ordered.includes(id))];
  }
  function getHomeSlots() {
    if (view === 'nook' && !getModuleEditorActive() && islandPage === 'tasks') return isModuleEnabled('tasks') || isModuleEnabled('focus') ? ['tasks', null, null] : [null, null, null];
    if (view === 'nook' && !getModuleEditorActive() && ['tasks', 'essential'].includes(islandPage)) {
      const ids = [...new Set(nookGridPlan(islandPage, moduleSettings.enabled).map(item => ['tasks', 'pomodoro'].includes(item.id) ? 'focus' : item.id).filter(id => Object.hasOwn(moduleDefinitions, id)))];
      return Array.from({length: 3}, (_, index) => ids[index] || null);
    }
    const selected = scenarioController?.getPreferences().selected;
    if (selected) return modulePlacementPlan({enabled: moduleSettings.enabled, slots: scenarioModulePlan(selected, configuredModuleOrder())}).slots;
    return modulePlacementPlan(moduleSettings).slots;
  }
  function getModuleOrder() {
    const ordered = getHomeSlots().filter(Boolean);
    return [...ordered, ...moduleSettings.enabled.filter(id => !ordered.includes(id))];
  }
  function getModuleEditorActive() { return moduleEditing; }
  function getModuleEditorSlots() {
    const value = moduleEditing && moduleDraft ? moduleDraft : moduleSettings;
    return value.slots.map(id => value.enabled.includes(id) ? id : null);
  }
  function getModuleEditorOrder() {
    const value = moduleEditing && moduleDraft ? moduleDraft : moduleSettings, ordered = getModuleEditorSlots().filter(Boolean);
    return [...ordered, ...value.enabled.filter(id => !ordered.includes(id))];
  }
  function setModules(value, persist = true) {
    if (disposed) return false;
    const previous = getModules(); moduleSettings = normalizeModules(value); moduleDraft = moduleEditing ? getModules() : null;
    activityScene.reset();
    if (persist) {view = 'nook'; islandPage = 'music';}
    moduleMessage = t('Disposition appliquée.');
    if (persist) try {
      window.localStorage.setItem(moduleStorageKey, JSON.stringify(moduleSettings)); moduleMessage = t('Disposition enregistrée.');
    } catch { moduleMessage = t('Disposition appliquée pour cette fenêtre.'); }
    if (typeof modulesChanged === 'function') modulesChanged(previous);
    if (persist && scenarioController?.getPreferences().selected) {
      const scenario = scenarioController.getPreferences(); scenario.selected = null;
      scenario.manualUntil = scenario.guards.manualLock ? Math.min(8640000000000000, Date.now() + 7200000) : 0;
      scenarioController.configure(scenario);
    }
    renderModules(); return true;
  }
  function revealModuleSelection() {
    if (disposed || !moduleEditing) return;
    const frame = modulesPlayer.querySelector(`[data-module-slot-box="${moduleSelected}"]`), scroller = byId('module-editor-frames');
    if (!frame || frame.hidden || !scroller) return;
    const bounds = frame.getBoundingClientRect(), viewport = scroller.getBoundingClientRect();
    if (bounds.left < viewport.left || bounds.right > viewport.right) frame.scrollIntoView({block: 'nearest', inline: 'center', behavior: motionEnabled() ? 'smooth' : 'instant'});
  }
  function moduleEditorLayout(opening = false, closing = false) {
    notch.dataset.moduleEditing = String(moduleEditing);
    if (typeof moduleEditorLayoutChanged === 'function') moduleEditorLayoutChanged({active: moduleEditing, opening, closing, previousView: modulePreviousView, previousState: modulePreviousState});
    renderModules();
    if (!closing) revealModuleSelection();
  }
  function openModuleEditor(event) {
    if (disposed) return false;
    if (moduleEditing) return true;
    modulePreviousView = view; modulePreviousState = state; moduleReturnFocus = document.activeElement;
    moduleDraft = getModules(); moduleDraftOrder = [...moduleOrder]; modulePicked = null; moduleMessage = ''; moduleEditing = true;
    const target = event?.target?.closest?.('[data-home-slot], [data-module-open]');
    const moduleId = target?.dataset.moduleOpen || target?.dataset.module, storedIndex = moduleDraft.slots.slice(0, 3).indexOf(moduleId);
    const index = Object.hasOwn(moduleDefinitions, moduleId || '') ? storedIndex >= 0 ? storedIndex : moduleDraft.slots.slice(0, 3).findIndex(id => !id || !moduleDraft.enabled.includes(id)) : target?.dataset.homeSlot;
    if (storedIndex < 0 && Object.hasOwn(moduleDefinitions, moduleId || '')) modulePicked = moduleId;
    moduleSelected = Number.isInteger(Number(index)) && Number(index) >= 0 && Number(index) < 3 ? Number(index) : Math.max(0, moduleDraft.slots.slice(0, 3).findIndex(Boolean));
    moduleEditorLayout(true); (modulesPlayer.querySelector('.experience-switch') || modulesPlayer.querySelector(`[data-module-slot-box="${moduleSelected}"]`))?.focus({preventScroll: true}); return true;
  }
  function closeModuleEditor(commit = false) {
    if (!moduleEditing) return false;
    const value = moduleDraft;
    if (commit && moduleDraftOrder) {moduleOrderSaved=true; moduleOrder = moduleDraftOrder.filter(id => !moduleDefinitions[id]?.community); try {window.localStorage.setItem('notchy-module-order-v1', JSON.stringify(moduleOrder));} catch {}}
    moduleDraftOrder = null; moduleEditing = false; moduleDraft = null; modulePicked = null;
    if (commit) {modulePreviousView = 'nook'; modulePreviousState = 'open'; setModules(value);} else moduleMessage = t('Changements annulés.');
    moduleEditorLayout(false, true);
    if (moduleReturnFocus?.isConnected && moduleReturnFocus.tabIndex >= 0 && !moduleReturnFocus.closest('[hidden],[inert]')) moduleReturnFocus.focus({preventScroll: true});
    else if (state === 'open') menu.querySelector('[data-view="nook"]').focus({preventScroll: true});
    else if (modulesPlayer.contains(document.activeElement)) document.activeElement.blur();
    return true;
  }
  function moduleContextMenu(event) {
    const target = event.target;
    if (['search','module-library'].includes(view) || welcome?.isActive() || !notch.contains(target) || target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])') || window.getSelection()?.toString().trim()) return false;
    event.preventDefault(); return openModuleEditor(event);
  }
  function modulePreview(host, id, template = 'main') {
    const make = (tag, className, value) => { const node = document.createElement(tag); if (className) node.className = className; if (value !== undefined) node.textContent = value; return node; };
    const glyph = name => byId('module-catalog').querySelector(`[data-module-id="${name}"] .module-tile > svg`).cloneNode(true);
    template = ['main', 'rail', 'compact'].includes(template) ? template : template === true ? 'compact' : 'main';
    host.dataset.template = template; host.dataset.module = id || ''; host.dataset.moduleId = id || ''; host.dataset.playing = String(id === 'music' ? music.playing : id === 'focus' ? !!focus.deadline : false);
    host.replaceChildren();
    if (id === 'music' && music.available) {
      const top = make('div', 'module-preview-music-top'), art = make('div', 'module-preview-art'), copy = make('div', 'module-preview-music-copy');
      if (music.cover) { const img = make('img'); img.src = music.cover; img.alt = ''; art.append(img); } else art.append(glyph('music'));
      host.dataset.musicSize = host.dataset.presentation === 'full' ? 'full' : host.dataset.presentation === 'scene' ? 'half' : host.dataset.presentation === 'rail' ? 'banner' : template === 'main' ? 'full' : template === 'rail' ? 'half' : 'banner';
      const status = make('span', 'module-preview-label', t(music.playing ? 'EN LECTURE' : 'Musique'));
      copy.append(status, make('strong', '', music.title || t('Musique')), make('small', '', music.artist || music.source)); top.append(art, copy); host.append(top);
      const elapsed = position(), timeline = make('div', 'module-preview-music-timeline'), bar = make('span', 'module-preview-progress'), fill = make('i');
      fill.style.width = (music.duration > 0 ? Math.min(1, Math.max(0, elapsed / music.duration)) * 100 : 0) + '%'; bar.append(fill);
      timeline.append(make('small', '', time(elapsed)), bar, make('small', '', music.duration > 0 ? '−' + time(Math.max(0, music.duration - elapsed)) : '—:—')); host.append(timeline);
      const controls = make('div', 'module-preview-transport');
      for (const name of ['previous', 'toggle', 'next']) { const svg = player.querySelector(`[data-music-command="${name}"] svg`)?.cloneNode(true); if (svg) { svg.removeAttribute('id'); for (const node of svg.querySelectorAll('[id]')) node.removeAttribute('id'); controls.append(svg); } }
      host.append(controls); return;
    }
    if (id === 'focus') {
      const value = focusCardValues(focus, focusSettings), heading = make('span', 'module-preview-label', t(focus.pomodoro?.phase === 'break' ? 'PAUSE' : 'FOCUS') + ' · ' + (focus.pomodoro?.session || 1) + '/' + value.total);
      host.append(heading, make('strong', 'module-preview-focus-clock', time(value.seconds).padStart(5, '0')),
        make('span', 'module-preview-focus-task', value.task || t('Focus libre')));
      const bar = make('span', 'module-preview-progress'), fill = make('i'); fill.style.width = value.progress * 100 + '%'; bar.append(fill); host.append(bar);
      const cycles = make('span', 'module-preview-focus-cycles');
      for (let index = 0; index < value.total; index++) {const dot = make('i'); dot.classList.toggle('completed', index < value.completed); cycles.append(dot);}
      host.append(cycles); return;
    }
    if (id === 'tasks') {
      const current = focus.tasks.find(task => task.id === focus.activeTaskId) || focus.tasks.find(task => !task.done);
      host.append(make('span', 'module-preview-label', t('Tâches')), make('strong', 'module-preview-task-title', current?.title || t('Ajouter une tâche')),
        make('small', 'module-preview-task-count', `${focus.tasks.filter(task => task.done).length} / ${focus.tasks.length}`)); return;
    }
    if (id === 'weather') {
      const next = localizedWeatherNarrative(getWeatherState()), row = pairs => { const line = make('p', 'module-preview-weather-line'); for (const [value, emphasized] of pairs) line.append(make(emphasized ? 'strong' : 'span', '', value)); return line; };
      const current = row([[next.temperature, true], [next.when, false]]); current.classList.add('module-preview-weather-current');
      const forecast = row([[next.rain, true], [next.rainQualifier, false]]); forecast.setAttribute('aria-label', next.forecastDescription);
      host.append(current, row([[t('à'), false], [next.city, true]]), row([[t('ressenti'), false], [next.feelsLike, true]]), forecast, make('small', 'module-preview-weather-horizon', next.horizon));
      return;
    }
    const empty = make('div', 'module-preview-empty');
    if (!id) { const add = make('span', 'module-preview-add'); add.setAttribute('aria-hidden', 'true'); add.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>'; empty.append(add, make('strong', '', t('Ajouter un module')), make('small', '', t('Choisis une icône ci-dessous'))); host.append(empty); return; }
    empty.append(glyph(id));
    if (id === 'shelf') empty.append(make('strong', '', 'Tray'), make('small', '', shelfItems.length ? localSendCount(shelfItems.length) : ''));
    else empty.append(make('strong', '', id === 'music' ? t('Musique') : t('Météo')), make('small', '', id === 'music' ? t('Aucun morceau en cours') : t('Choisir une ville')));
    host.append(empty);
  }
  function renderModules() {
    if (disposed) return;
    modulesPlayer.hidden = !moduleEditing; if (!moduleEditing || !moduleDraft) return;
    if (experience) {
      experience.renderModules({definitions: getModuleDefinitions().map(item=>item.id === 'focus' ? {...item,label:'Focus'} : item), enabled: moduleDraft.enabled, order: [...(moduleDraftOrder || moduleOrder),...communityStore.list().map(item=>item.manifest.id)]});
      byId('modules-status').textContent = moduleMessage; return;
    }
    const layout = moduleEditorPresentation(moduleDraft, modulePicked), slots = layout.slots, primary = Math.max(0, slots.findIndex(Boolean));
    byId('module-editor-frames').dataset.count = String(slots.filter(Boolean).length);
    const frames = [...modulesPlayer.querySelectorAll('[data-module-slot-box]')], focused = document.activeElement;
    const ordered = [...layout.indices.map(index => frames.find(frame => Number(frame.dataset.moduleSlotBox) === index)), ...frames.filter(frame => !layout.indices.includes(Number(frame.dataset.moduleSlotBox)))];
    if (ordered.some((frame, index) => frame !== frames[index])) {
      byId('module-editor-frames').append(...ordered);
      if (focused?.closest('[data-module-slot-box]')) focused.focus({preventScroll: true});
    }
    if (!layout.indices.includes(moduleSelected)) moduleSelected = layout.indices[0];
    for (const frame of ordered) {
      const index = Number(frame.dataset.moduleSlotBox), id = slots[index], remove = frame.querySelector('[data-module-command="remove"]');
      frame.hidden = !layout.indices.includes(index);
      frame.dataset.moduleId = id || ''; frame.draggable = !!id; frame.classList.toggle('is-selected', index === moduleSelected);
      frame.classList.toggle('is-primary', index === primary); frame.classList.toggle('is-empty', !id);
      const presentation = layout.presentations?.[index] || (index ? 'rail' : 'full'); frame.dataset.presentation = presentation;
      frame.querySelector('.module-slot-caption').textContent = String(index + 1);
      frame.setAttribute('aria-label', t('Emplacement {position} · {kind} · {module}', {position: index + 1, kind: index === primary ? t('affichage principal') : t('accès rapide'), module: id ? moduleLabels[id] : t('ajouter un module')}));
      remove.hidden = !id; remove.setAttribute('aria-label', t('Retirer {module} de cet emplacement', {module: moduleLabels[id] || t('le module')}));
      const preview = frame.querySelector('.module-preview'), previewKey = `${id || ''}/${presentation}/${index}`;
      preview.dataset.presentation = presentation;
      if (!frame.hidden) modulePreview(preview, id, index === primary ? 'main' : 'compact'); else preview.replaceChildren();
      if (preview.dataset.key && preview.dataset.key !== previewKey) animateModuleChange(preview);
      preview.dataset.key = previewKey;
      if (focused === remove && !id) frame.focus({preventScroll: true});
    }
    if (focused?.closest('[data-module-slot-box]')?.hidden) modulesPlayer.querySelector(`[data-module-slot-box="${moduleSelected}"]`)?.focus({preventScroll: true});
    for (const button of modulesPlayer.querySelectorAll('#module-catalog [data-module-id]')) {
      const id = button.dataset.moduleId, installed = slots.includes(id);
      button.title = moduleLabels[id];
      button.setAttribute('aria-pressed', String(modulePicked === id)); button.setAttribute('aria-label', t('{module} · choisir un emplacement', {module: moduleLabels[id] + (installed ? t(' · placé') : '')}));
      button.querySelector('.module-installed').hidden = !installed;
    }
    byId('modules-status').textContent = moduleMessage;
    byId('module-editor-hint').textContent = moduleMessage || t('Choisis un module, puis son emplacement.');
  }
  function placeModuleDraft(index, id) {
    if (!moduleDraft || !Number.isInteger(index) || index < 0 || index > 2 || !Object.hasOwn(moduleLabels, id)) return;
    if (!moduleDraft.enabled.includes(id)) moduleDraft.enabled.push(id);
    moduleDraft = assignModuleSlot(moduleDraft, index, id); moduleSelected = index; modulePicked = null;
    moduleMessage = t('{module} placé.', {module: moduleLabels[id]}); moduleEditorLayout();
  }
  function removeModuleDraft(index) {
    if (!Number.isInteger(index) || index < 0 || index > 2) return;
    const id = moduleDraft?.slots[index]; if (!id) return;
    moduleDraft.slots[index] = null; moduleDraft.enabled = moduleDraft.enabled.filter(item => item !== id); moduleSelected = index; modulePicked = null;
    moduleMessage = t('{module} retiré.', {module: moduleLabels[id]}); moduleEditorLayout();
  }
  function moduleCommand(event) {
    if (disposed || !moduleEditing || !moduleDraft) return;
    const button = event.target.closest('[data-module-command]');
    if (button?.dataset.moduleCommand === 'apply') { closeModuleEditor(true); return; }
    if (button?.dataset.moduleCommand === 'cancel') { closeModuleEditor(false); return; }
    if (button?.dataset.moduleCommand === 'remove') { removeModuleDraft(Number(button.closest('[data-module-slot-box]').dataset.moduleSlotBox)); return; }
    if (button?.dataset.moduleCommand === 'pick' && Object.hasOwn(moduleLabels, button.dataset.moduleId)) {
      modulePicked = button.dataset.moduleId; const existing = moduleDraft.slots.slice(0, 3).indexOf(modulePicked); if (existing >= 0) moduleSelected = existing;
      moduleMessage = t('{module} sélectionné. Choisis un emplacement.', {module: moduleLabels[modulePicked]}); moduleEditorLayout(); return;
    }
    const frame = event.target.closest('[data-module-slot-box]'); if (!frame) return;
    moduleSelected = Number(frame.dataset.moduleSlotBox);
    if (modulePicked) placeModuleDraft(moduleSelected, modulePicked); else renderModules();
  }
  function moduleDragStart(event) {
    if (disposed || !moduleEditing || !moduleDraft || !event.dataTransfer) return;
    const tile = event.target.closest('[data-module-id]'), id = tile?.dataset.moduleId;
    if (!Object.hasOwn(moduleLabels, id)) { event.preventDefault(); return; }
    event.dataTransfer.setData(moduleMime, id); event.dataTransfer.effectAllowed = 'move'; modulePicked = id;
    moduleEditorLayout();
  }
  function moduleDragOver(event) {
    if (disposed || !moduleEditing || ![...(event.dataTransfer?.types || [])].includes(moduleMime) || !event.target.closest('[data-module-slot-box]')) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
  }
  function moduleDrop(event) {
    if (disposed || !moduleEditing || !moduleDraft || ![...(event.dataTransfer?.types || [])].includes(moduleMime)) return;
    const frame = event.target.closest('[data-module-slot-box]'); if (!frame) return;
    event.preventDefault(); event.stopPropagation(); placeModuleDraft(Number(frame.dataset.moduleSlotBox), event.dataTransfer.getData(moduleMime));
  }
  function moduleEditorKey(event) {
    if (!moduleEditing || disposed) return false;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (modulePicked) { modulePicked = null; moduleMessage = t('Choix annulé.'); moduleEditorLayout(); } else closeModuleEditor(false);
      return true;
    }
    const frame = event.target.closest?.('[data-module-slot-box]');
    if (frame && event.target === frame) {
      if (['Enter', ' '].includes(event.key)) { event.preventDefault(); if (modulePicked) placeModuleDraft(Number(frame.dataset.moduleSlotBox), modulePicked); return true; }
      if (['Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); removeModuleDraft(Number(frame.dataset.moduleSlotBox)); return true; }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); const frames = [...modulesPlayer.querySelectorAll('[data-module-slot-box]')].filter(item => !item.hidden), direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
        const next = frames[(frames.indexOf(frame) + direction + frames.length) % frames.length]; moduleSelected = Number(next.dataset.moduleSlotBox); renderModules(); next.focus({preventScroll: true}); revealModuleSelection(); return true;
      }
    }
    const button = event.target.closest?.('#module-catalog [data-module-id]');
    if (button && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const buttons = [...byId('module-catalog').children], index = buttons.indexOf(button), next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length; buttons[next].focus(); return true;
    }
    return false;
  }
  function disposeModules() { experience?.dispose(); sharingExperience?.dispose(); moduleEditing = false; moduleDraft = null; modulePicked = null; modulesPlayer.hidden = true; }

  const settingsPlayer = byId('settings-player'), scenariosPlayer = byId('scenarios-player');
  let startupEnabled = desktop?.startup?.enabled === true, startupBusy = false, startupError = desktop?.startup?.error ? 'Impossible de modifier le démarrage. Réessaie.' : '';
  function renderStartupSettings() {
    byId('startup-control').hidden = desktop?.startup?.supported !== true;
    const input = byId('startup-windows'); input.checked = startupEnabled; input.disabled = startupBusy;
    const status = byId('startup-status'); status.hidden = !startupError; text(status, t(startupError));
  }
  async function startupInput(event) {
    if (disposed || event.target.id !== 'startup-windows' || startupBusy || typeof desktop?.setStartup !== 'function') return;
    const enabled = event.target.checked;
    startupBusy = true; startupError = ''; renderStartupSettings();
    try {
      const result = await desktop.setStartup(enabled);
      if (disposed) return;
      if (typeof result?.enabled === 'boolean') startupEnabled = result.enabled;
      if (result?.ok !== true) startupError = 'Impossible de modifier le démarrage. Réessaie.';
    } catch {if (!disposed) startupError = 'Impossible de modifier le démarrage. Réessaie.';}
    finally {if (!disposed) {startupBusy = false; renderStartupSettings(); if (view === 'settings') update();}}
  }
  function renderSettings() {
    settingsPlayer.hidden = view !== 'settings' || getModuleEditorActive();
    ia?.render(view,getModuleEditorActive());
    renderAppearance();
    renderSettingsConnections();
    if (view === 'settings') update();
  }
  function renderSettingsConnections() {
    renderStartupSettings(); renderExperience();
    if (view !== 'settings') return;
    const focusSummary = focusComponent.summary();
    byId('settings-focus').disabled = !focusCoreEnabled();
    text(byId('settings-focus-detail'), !focusCoreEnabled() ? t('À ajouter depuis l’accueil') : focusSummary.active ? focusLabel() + t(' en cours') : t('Tâches et durée des sessions'));
    text(byId('settings-weather-detail'), weather.selectedCity?.name || weather.city || t('Choisir une ville'));
    text(byId('settings-localsend-detail'), nearby.available ? t('Prêt à partager à proximité') : t('Ouvrir le partage'));
  }
  function settingsCommand(event) {
    const format = event.target.closest('[data-appearance-format]');
    if (!disposed && format && !format.disabled && settingsPlayer.contains(format)) {setAppearance({format: format.dataset.appearanceFormat}); return;}
    const button = event.target.closest('[data-settings-command]');
    if (disposed || !button || button.disabled || !settingsPlayer.contains(button)) return;
    if (button.dataset.settingsCommand === 'close') { setState('rest'); return; }
    if (button.dataset.settingsCommand === 'health') {selectViewButton({dataset:{view:'health'}}); void readNearby(); return;}
    if (button.dataset.settingsCommand === 'modules') {openModuleEditor(); return;}
    if (button.dataset.settingsCommand === 'library') {showModuleLibrary(); return;}
    if (button.dataset.settingsCommand === 'focus') {
      focusComponent.command('configure'); update();
    } else if (button.dataset.settingsCommand === 'weather') {
      weatherPickerOpen = true; selectViewButton({dataset: {view: 'weather'}}); renderWeather(); weatherCityInput.focus({preventScroll: true});
    } else if (button.dataset.settingsCommand === 'localsend') selectViewButton({dataset: {view: 'tray'}});
    else if (button.dataset.settingsCommand === 'scenarios') selectViewButton({dataset: {view: 'scenarios'}});
  }
  function renderExperience() {
    renderSearchRoute();
    renderDetailReturn();
    byId('module-library-player').hidden = view !== 'module-library' || state !== 'open'; moduleLibrary?.refresh();
    if (!experience || disposed) return;
    byId('health-player').hidden = view !== 'health' || moduleEditing;
    const tray = view === 'tray' && !moduleEditing;
    const nearbyFailure = nearbyError || nearby.error || '';
    notch.dataset.experienceTray = String(tray);
    byId('sharing-experience').hidden = !tray;
    if (view === 'health') {
      const positioned = !!(weather.selectedCity?.name || weather.city);
      experience.renderHealth({items: [
        {id:'network', label:t('Réseau'), status:nearbyBusy ? 'busy' : nearbyFailure ? 'error' : nearby.available ? 'ready' : 'unknown', detail:nearbyFailure ? uiMessage(nearbyFailure) : t(nearby.available ? 'LocalSend actif' : 'Partage local arrêté'), actionLabel:t('Activer'), action:'network'},
        {id:'firewall', label:t('Pare-feu'), status:'unknown', detail:t('À vérifier sur ce réseau'), actionLabel:t('Aide'), action:'firewall'},
        {id:'location', label:t('Position'), status:weatherBusy ? 'busy' : positioned ? 'ready' : 'unknown', detail:weather.selectedCity?.name || weather.city || t('Choisir une ville'), actionLabel:t('Choisir'), action:'location'},
        {id:'spotify', label:'Spotify', status:queueBusy ? 'busy' : ['ok','connected','ready'].includes(queueState.status) ? 'ready' : 'unknown', detail:t(['ok','connected','ready'].includes(queueState.status) ? 'Connecté' : 'Non connecté'), actionLabel:t('Connecter'), action:'spotify'},
        {id:'player', label:t('Lecteur'), status:music.available ? 'ready' : 'unknown', detail:music.available ? t('{player} détecté',{player:music.source || t('Lecteur Windows')}) : t('Rien en lecture'), actionLabel:t('Ouvrir'), action:'player'},
        {id:'startup', label:t('Démarrage'), status:startupBusy ? 'busy' : startupEnabled ? 'ready' : 'unknown', detail:t(startupEnabled ? 'Avec Windows' : desktop?.startup?.supported ? 'Désactivé' : 'Application de bureau requise'), actionLabel:desktop?.startup?.supported ? t('Activer') : '', action:desktop?.startup?.supported ? 'startup' : undefined}
      ]});
    }
    if (tray && sharingExperience) {
      sharingExperience.render({files:shelfItems.map(item => {const file = acceptedFile(item,'shelf'); return {...item, canOcr:(file.image || file.pdf) && file.toolsAvailable, canConvert:file.image && file.toolsAvailable, canSend:true, canOpen:true, canDownload:true, canRemove:true};}), selectedIds:[...selectedFiles], busy:shelfBusy || nearbyBusy, status:{message:uiMessage(nearbyFailure),error:!!nearbyFailure}, fileStatus:{message:shelfError,error:shelfDownloadError}, peers:nearby.peers || [], favorites:peerFavorites, available:nearby.available, transfer:nearby.transfer, incoming:nearby.incoming});
    }
  }
  async function experienceAction(action) {
    if (disposed) return;
    if (action === 'back') {if (moduleEditing) closeModuleEditor(false); else selectViewButton({dataset:{view:'settings'}}); return;}
    if (action === 'network') await nearbyRequest({command:'discover'});
    else if (action === 'location') {weatherPickerOpen = true; selectViewButton({dataset:{view:'weather'}}); weatherCityInput.focus({preventScroll:true});}
    else if (action === 'firewall') {
      let help = byId('health-player').querySelector('.experience-inline-help');
      if (!help) {help = document.createElement('p'); help.className='experience-inline-help'; help.setAttribute('role','status'); byId('health-player').append(help);}
      help.textContent=t('Autorise Notchy sur ton réseau privé dans le pare-feu Windows. Le même Wi-Fi suffit, sans internet.');
    } else if (action === 'player') await performMusicCommand({command:'open'});
    else if (action === 'startup') {byId('startup-windows').checked = true; await startupInput({target:byId('startup-windows')});}
    else if (action === 'spotify') {
      queueOpen=true; selectViewButton({dataset:{view:'music'}}); renderMusicQueue(); musicQueueLifecycle();
      const connect = byId('music-queue').querySelector('[data-music-queue-command="connect"]'); if (connect) await musicQueueCommand({target:connect});
    }
    renderExperience();
  }
  let peerFavorites = [];
  try {const saved = window.localStorage.getItem('notchy-peer-favorites-v1'); if (saved && saved.length < 20000) peerFavorites = JSON.parse(saved).filter(item => item && /^[a-f0-9]{64}$/.test(item.identity) && typeof item.alias === 'string').slice(0,32).map(item => ({identity:item.identity,alias:item.alias.slice(0,120),deviceType:item.deviceType === 'mobile' ? 'mobile' : 'desktop'}));} catch {}
  async function sharingAction(command, value = {}) {
    if (disposed || shelfBusy || nearbyBusy && !['cancel','open-transfer'].includes(command)) return;
    const item = shelfItems.find(item => item.id === value.id);
    if (command === 'add') {
      if (Array.isArray(value.files)) {const before=new Set(shelfItems.map(item=>item.id)); await uploadFiles(value.files); const added=shelfItems.filter(item=>!before.has(item.id)); if (added.length) {for (const file of added) byId('sharing-experience').querySelector('[data-sharing-file="'+file.id+'"]')?.closest('.sharing-file-row')?.classList.add('experience-drop-row'); gestureFeedback(byId('sharing-experience').querySelector('.sharing-drop'),'drop',600); notifyModuleChange({id:'shelf',kind:'kept',title:t('Fichier gardé'),detail:added[0].name,compact:true});}}
      else showFileChooser(shelfInput);
    }
    else if (command === 'select') {selectedFiles.clear(); for (const id of value.selectedIds || []) if (shelfItems.some(item => item.id === id)) selectedFiles.add(id); syncShelfSelection();}
    else if (['open','ocr','convert'].includes(command) && item) await shelfFileAction(command,item);
    else if (command === 'download') await downloadShelfFiles(shelfItems.filter(file => (value.ids || [value.id]).includes(file.id)));
    else if (command === 'remove') {selectedFiles.clear(); for (const id of value.ids || [value.id]) if (shelfItems.some(item => item.id === id)) selectedFiles.add(id); syncShelfSelection(); await shelfCommand({target:byId('shelf-remove')});}
    else if (command === 'discover') await nearbyRequest({command:'discover'});
    else if (command === 'connect') {await nearbyRequest({command:'connect',address:value.address}); if (nearbyError) gestureFeedback(byId('sharing-experience').querySelector('.sharing-ip-form'),'error');}
    else if (command === 'cancel' && nearby.transfer?.id) await nearbyRequest({command:'cancel',id:nearby.transfer.id});
    else if (command === 'open-transfer') {
      if (nearby.incoming) openLocalSend('receive',nearby.incoming);
      else if (nearby.transfer) {const transfer=nearby.transfer; localSendContext={direction:transfer.direction, source:'shelf', files:transfer.files || [], totalBytes:transfer.totalBytes, alias:transfer.alias, returnView:'tray', previousId:'', requested:true, error:''}; selectViewButton({dataset:{view:'localsend'}}); setState('open');}
    }
    else if (command === 'favorite') {
      const peer = (nearby.peers || []).find(peer => peer.id === value.id || peer.identity === value.peer?.identity);
      const identity = peer?.identity || value.peer?.identity;
      if (!/^[a-f0-9]{64}$/.test(identity || '')) return;
      peerFavorites = peerFavorites.filter(item => item.identity !== identity);
      if (value.favorite && peer) peerFavorites.push({identity,alias:peer.alias.slice(0,120),deviceType:peer.deviceType === 'mobile' ? 'mobile' : 'desktop'});
      try {window.localStorage.setItem('notchy-peer-favorites-v1',JSON.stringify(peerFavorites.slice(0,32)));} catch {}
    } else if (command === 'send') {
      const ids = Array.isArray(value.ids) ? value.ids : [...selectedFiles];
      const files = shelfItems.filter(item => ids.includes(item.id));
      if (files.length) {openLocalSend('send',files); if (value.peerId && nearby.peers?.some(peer => peer.id === value.peerId)) await localSendCommand({target:{closest:selector => selector === '[data-localsend-peer]' ? {dataset:{localsendPeer:value.peerId}} : null}});}
      else {shelfError=t('Choisis un fichier à envoyer.');}
    }
    renderExperience();
  }
  const gestureTimers = new Map();
  function renderCopyFeedback(node, done) {text(node.querySelector('span') || node,t(done ? 'Copié' : 'Copier'));}
  function gestureFeedback(node, kind, duration = 2000) {
    if (!node || disposed) return;
    const previous = gestureTimers.get(node); if (previous) {window.clearTimeout(previous.timer); node.classList.remove(previous.className);}
    const className = kind === 'error' ? 'experience-error' : kind === 'copy' ? 'experience-copy-done' : 'experience-drop-confirm';
    node.classList.add(className);
    const timer = window.setTimeout(() => {node.classList.remove(className); gestureTimers.delete(node); if (kind === 'copy' && node.isConnected) renderCopyFeedback(node,false);},duration);
    gestureTimers.set(node,{timer,className});
  }
  function settingsNaturalPanelHeight() {
    return naturalPanelHeight(settingsPlayer);
  }
  function naturalPanelHeight(element, width) {
    const previousWidth = element.style.width;
    if (Number.isFinite(width)) element.style.width = width + 'px';
    const style = getComputedStyle(element);
    const number = value => parseFloat(value) || 0;
    const height = Math.ceil([...element.children].filter(child => !child.hidden).reduce((height, child) => {
      const childStyle = getComputedStyle(child);
      return height + child.getBoundingClientRect().height + number(childStyle.marginTop) + number(childStyle.marginBottom);
    }, number(style.paddingTop) + number(style.paddingBottom)));
    if (Number.isFinite(width)) element.style.width = previousWidth;
    return height;
  }
  function scenarioActivity() {
    return {focusActive: focusIsActive(), focusRunning: !!focus.deadline, focusPhase: focus.pomodoro?.phase || 'work', focusSession: focus.pomodoro?.session || 1,
      musicPlaying: music.playing && !connectionLost, transferActive: !!nearby.incoming || nearbyBusy || ['preparing', 'waiting', 'sending', 'receiving'].includes(nearby.transfer?.status)};
  }
  function scenarioInteracting() {
    const focused = document.hasFocus() ? document.activeElement : null;
    return document.hidden || fileDialogOpen || fileDragging || seekDragging || getModuleEditorActive() || welcome?.isActive() || state === 'open' && pointerInside || state === 'open' && (['tasks','focus'].includes(view) || !!detailReturn && view === detailView) ||
      state === 'open' && (keyboardNavigation && !!focused?.closest('#notch-panel,#notch-menu,#island-footer') || !!focused?.closest('input,textarea,select,[contenteditable="true"]')) ||
      state === 'open' && view === 'localsend' && ['consent', 'waiting', 'progress'].includes(localSendPresentation()?.stage);
  }
  function scenarioLabel(id) {return t({focus: 'Focus', ambience: 'Ambiance', day: 'Journée', complete: 'Complet', minimal: 'Minimal'}[id] || 'Scénarios');}
  function renderScenarios() {
    if (!scenariosPlayer || !scenarioController) return;
    scenariosPlayer.hidden = view !== 'scenarios' || getModuleEditorActive();
    const {preferences, notice, undoAvailable} = scenarioController.inspect(), manual = preferences.mode === 'manual';
    for (const input of scenariosPlayer.querySelectorAll('[data-scenario-mode]')) input.checked = input.value === preferences.mode;
    for (const input of scenariosPlayer.querySelectorAll('[data-scenario-rule-enabled]')) {input.checked = preferences.rules[input.dataset.scenarioRuleEnabled].enabled; input.disabled = manual;}
    for (const select of scenariosPlayer.querySelectorAll('[data-scenario-rule]')) {select.value = preferences.rules[select.dataset.scenarioRule].scenario; select.disabled = manual;}
    for (const button of scenariosPlayer.querySelectorAll('[data-scenario-option]')) {
      const selected = preferences.rules[button.dataset.scenarioOption].scenario === button.value;
      button.disabled = manual; button.setAttribute('aria-checked', String(selected)); button.tabIndex = selected ? 0 : -1;
    }
    for (const input of scenariosPlayer.querySelectorAll('[data-scenario-guard]')) input.checked = preferences.guards[input.dataset.scenarioGuard];
    for (const button of scenariosPlayer.querySelectorAll('[data-scenario-pick]')) button.setAttribute('aria-pressed', String(button.dataset.scenarioPick === preferences.selected));
    const label = scenarioLabel(notice.scenario);
    const message = notice.kind === 'pending' ? t('{scenario} sera appliqué quand tu quitteras le panneau.', {scenario: label}) : notice.kind === 'empty' ? t('Aucun module disponible pour ce scénario.') :
      notice.kind === 'undone' ? t('Disposition précédente rétablie.') : notice.kind === 'automatic' || notice.kind === 'manual' ? t('{scenario} appliqué.', {scenario: label}) + (notice.kind === 'manual' && preferences.guards.manualLock && preferences.manualUntil > Date.now() ? ' ' + t('Choix manuel conservé pendant deux heures.') : '') :
      t(manual ? 'Les règles automatiques sont en pause.' : 'Les changements suivent ton activité.');
    text(byId('scenario-status'), message); byId('scenario-undo').hidden = !undoAvailable;
    const noticeElement = byId('scenario-home-notice'), home = byId('nook-layout');
    noticeElement.hidden = !(undoAvailable && state === 'open' && view === 'nook' && !getModuleEditorActive());
    home.style.height = noticeElement.hidden ? '' : 'calc(100% - var(--measure-32-px))';
    if (!noticeElement.hidden) text(byId('scenario-home-status'), t('{scenario} appliqué.', {scenario: scenarioLabel(preferences.selected)}));
  }
  function scenarioNookPage(selected) {
    return {focus:'focus',ambience:'music',day:'essential',complete:'essential',minimal:isModuleEnabled('music') ? 'music' : isModuleEnabled('focus') ? 'focus' : 'essential'}[selected] || null;
  }
  function scenarioChanged(change) {
    if (change.layout) {
      if (change.notice?.kind === 'automatic') scenarioReturnPage = islandPage;
      if (change.notice?.kind === 'undone' && scenarioReturnPage) {islandPage = scenarioReturnPage; scenarioReturnPage = null;}
      else islandPage = scenarioNookPage(change.preferences?.selected) || islandPage;
      if (change.notice?.kind === 'manual') scenarioReturnPage = null;
    }
    renderScenarios();
    if (change.layout) {renderHomeLayout(); renderMusic(); renderFocus(); renderShelf(); renderWeather(); weatherLifecycle();}
    update();
  }
  function scenarioInput(event) {
    if (disposed || !scenarioController || event.target.disabled) return;
    const value = scenarioController.getPreferences(), target = event.target;
    if (target.dataset.scenarioMode) value.mode = target.value;
    else if (target.dataset.scenarioRuleEnabled) value.rules[target.dataset.scenarioRuleEnabled].enabled = target.checked;
    else if (target.dataset.scenarioRule) value.rules[target.dataset.scenarioRule].scenario = target.value;
    else if (target.dataset.scenarioGuard) value.guards[target.dataset.scenarioGuard] = target.checked;
    else return;
    scenarioController.configure(value);
  }
  function scenarioClick(event) {
    const button = event.target.closest('[data-scenario-option],[data-scenario-pick],[data-scenario-command],#scenario-undo');
    if (disposed || !scenarioController || !button || button.disabled) return;
    if (button.dataset.scenarioOption) {
      const select = scenariosPlayer.querySelector(`[data-scenario-rule="${button.dataset.scenarioOption}"]`);
      select.value = button.value; select.dispatchEvent(new window.Event('change', {bubbles: true}));
    } else if (button.dataset.scenarioPick) scenarioController.pick(button.dataset.scenarioPick);
    else if (button.dataset.scenarioCommand === 'close') selectViewButton({dataset: {view: 'nook'}});
    else scenarioController.undo();
  }
  function scenarioKey(event) {
    const button = event.target.closest('[data-scenario-option]');
    if (!button || button.disabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...button.parentElement.querySelectorAll('[data-scenario-option]')], index = buttons.indexOf(button);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length;
    scenarioClick({target: buttons[next]}); buttons[next].focus({preventScroll: true});
  }
  function scenarioFlush() {scenarioController?.flush();}

  function shelfGlyph(kind) {
    const paths = {document: 'M14 3H6v18h12V7zM14 3v5h5M9 12h6M9 16h6', archive: 'M5 3h14v18H5zM11 3v3h2V3M11 8h2v3h-2M11 13h2v4h-2', image: 'M3 4h18v16H3zM3 17l5-6 4 4 3-3 6 6M16 8h.01', audio: 'M9 18V5l11-2v13M9 9l11-2M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6M17 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6', video: 'M3 5h18v14H3zM9 9l6 3-6 3z', file: 'M14 3H6v18h12V7zM14 3v5h5', check: 'm4 12 5 5L20 6'};
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[kind] || paths.file); svg.append(path); return svg;
  }

  const focusPlayer = byId('focus-player'), focusStrip = byId('focus-discreet-progress');
  let focus = FocusModel.defaults(), focusSettings = focusConfiguration(), tasksComponent = null;
  let focusToolReturn = null, focusConfigurationReturn = null;
  function restoreFocusRoute(origin) {
    if (!origin) return;
    // Keep keyboard interaction anchored while the old detail controls are hidden.
    if (keyboardNavigation) menu.querySelector('[data-view="nook"]')?.focus({preventScroll:true});
    if (origin.page) islandPage = origin.page;
    selectViewButton({dataset:{view:origin.view}}); setState('open');
    const control = origin.control;
    if (control?.isConnected && !control.closest('[hidden],[inert]')) control.focus({preventScroll:true});
    else (origin.view === 'tasks' ? tasksPlayer.querySelector('.tasks-start') : origin.view === 'focus' ? focusPlayer.querySelector('#focus-toggle:not([hidden]),#focus-start:not([hidden])') : menu.querySelector('[data-view="nook"]'))?.focus({preventScroll:true});
  }
  function openActivityDetail(route) {
    if (view === 'nook') {
      const origin={view,page:islandPage,control:document.activeElement};
      if (route==='focus') focusToolReturn=origin;
      else {detailReturn=origin;detailView=route;}
    }
    selectViewButton({dataset:{view:route}}); setState('open');
    const back = route === 'focus' ? focusToolBack : detailBack;
    if (!back.hidden && !back.closest('[hidden],[inert]')) back.focus({preventScroll:true});
  }
  const focusComponent = FocusAPI.create({host: focusPlayer, presentation: 'split', motion: motionEnabled, changed: syncFocus, openTasks() {
    openActivityDetail('tasks'); tasksComponent.focusInput();
  }, openConfiguration() {
    if (!focusComponent.inspect().configOpen) focusConfigurationReturn = {view,page:islandPage,control:document.activeElement};
    if (view !== 'focus') selectViewButton({dataset: {view: 'focus'}});
  }, closeConfiguration() {
    const origin = focusConfigurationReturn; focusConfigurationReturn = null;
    restoreFocusRoute(origin);
  }, restoreTaskFocus() {
    restoreFocusTaskControl();
  }});
  focus = focusComponent.getState(); focusSettings = focusComponent.getSettings();
  const tasksPlayer = byId('tasks-player');
  const focusToolBack = document.createElement('button'); focusToolBack.type='button'; focusToolBack.className='focus-tool-back'; focusToolBack.hidden=true; focusPlayer.prepend(focusToolBack);
  focusToolBack.addEventListener('click', () => {const origin=focusToolReturn; focusToolReturn=null; restoreFocusRoute(origin);});
  tasksComponent = FocusAPI.createTasks({host: tasksPlayer, focus: focusComponent, prepare(control) {
    focusToolReturn = {view,page:islandPage,control}; selectViewButton({dataset:{view:'focus'}}); setState('open'); focusComponent.command('prepare');
  }, expand() {
    openActivityDetail('tasks'); tasksComponent.focusInput();
  }});
  moduleActivityStates.set('focus', moduleActivitySnapshot('focus', focus));
  function renderFocusRouteBack() {
    focusToolBack.hidden = view !== 'focus' || !focusToolReturn || focusComponent.inspect().configOpen;
    focusToolBack.textContent = '← ' + t(focusToolReturn?.view === 'tasks' ? 'Revenir aux tâches' : 'Revenir à Nook');
    focusPlayer.dataset.focusToolReturn = String(!focusToolBack.hidden);
  }
  function focusIsActive() { return !focus.pomodoro?.finished && (focus.sessionActive || !!focus.deadline); }
  function focusLabel() { return focus.pomodoro?.phase === 'break' ? focus.pomodoro.breakKind === 'long' ? t('Pause longue') : t('Pause courte') : t('Concentration'); }
  function syncFocus(value) {
    if (disposed) return;
    const previousCompletion = focus.sessionSummary?.at;
    focus = value.state; focusSettings = value.settings;
    renderFocusRouteBack();
    const completionChanged = focus.sessionSummary && focus.sessionSummary.at !== previousCompletion;
    tasksComponent?.render();
    renderFocusTaskPrompt();
    const card = value.card;
    notch.style.setProperty('--focus-progress', String(card.progress)); notch.dataset.focusPhase = focus.pomodoro?.phase || 'work';
    text(byId('focus-live-time'), time(card.seconds));
    focusStrip.setAttribute('aria-valuenow', String(Math.round(card.progress * 100)));
    focusStrip.setAttribute('aria-valuetext', t('{phase} · {time} restantes', {phase: focusLabel(), time: time(card.seconds)}));
    observeModuleActivity('focus', focus);
    if (value.event) notifyModuleChange({id: isModuleEnabled('focus') ? 'focus' : 'tasks', ...value.event});
    scenarioController?.observe();
    renderLiveActivities(); renderHomeSummaries(); if (getModuleEditorActive()) renderModules();
    update();
    if (completionChanged && state === 'open' && ['nook','focus'].includes(view) && motionEnabled() && !document.hidden) {motion.pulse(); paint();}
  }
  function renderFocus() {
    if (!disposed) {
      if (!focusPlayer.parentElement?.classList?.contains('activity-main')) focusPlayer.dataset.presentation = 'full';
      focusComponent.lifecycle({enabled: focusCoreEnabled(), hidden: document.hidden, visible: state === 'open' && !focusPlayer.hidden && !getModuleEditorActive()});
      if (view === 'tasks') tasksPlayer.dataset.presentation = 'full';
      tasksComponent?.render();
      renderFocusRouteBack();
      renderFocusTaskPrompt();
    }
  }
  function renderFocusTaskPrompt() {
    const host = byId('focus-task-prompt'), prompt = focus.taskPrompt, task = focus.tasks.find(task => task.id === prompt?.taskId);
    host.hidden = !task || !prompt || !!focus.sessionSummary && ['nook','focus'].includes(view) || !focusCoreEnabled() || state !== 'open' || getModuleEditorActive() || fileDragging || !!nearby.incoming || focusComponent.inspect().configOpen || focusComponent.inspect().taskPickerOpen || !['nook', 'focus', 'tasks'].includes(view);
    if (host.hidden) {host.dataset.signature = ''; return;}
    host.dataset.kind = prompt.kind;
    const next = focus.tasks.find(item => !item.done), title = t(prompt.kind === 'cycle-complete' ? 'Tâche terminée ?' : 'Tâche terminée · continuer sur :');
    text(byId('focus-task-prompt-title'), title); text(byId('focus-task-prompt-detail'), task.title);
    const signature = JSON.stringify([prompt, next?.id, next?.title, task.title, i18n.locale()]);
    if (host.dataset.signature === signature) return;
    host.dataset.signature = signature;
    const actions = byId('focus-task-prompt-actions'), focused = document.activeElement;
    const restore = host.contains(focused) ? {action: focused.dataset.focusTaskPromptAction, id: focused.dataset.taskId} : null;
    const make = (action, label, id, primary = false) => {const button = document.createElement('button'); button.type = 'button'; button.dataset.focusTaskPromptAction = action; button.dataset.taskId = id; button.textContent = label; button.title = label; button.classList.toggle('is-primary', primary); return button;};
    actions.replaceChildren(...(prompt.kind === 'cycle-complete' ? [make('keep', t('Pas encore'), task.id), make('complete', t('Oui'), task.id, true)] : [...(next ? [make('select', next.title, next.id)] : []), make('free', t('Focus libre'), task.id, true)]));
    text(byId('focus-task-prompt-announcer'), title + ' ' + task.title);
    if (restore) ([...actions.children].find(button => button.dataset.focusTaskPromptAction === restore.action && button.dataset.taskId === restore.id) || actions.firstElementChild)?.focus({preventScroll: true});
  }
  function focusTaskPromptCommand(event) {
    const button = event.target.closest('[data-focus-task-prompt-action]');
    const host = byId('focus-task-prompt');
    if (disposed || !button || !host.contains(button) || button.disabled) return;
    const prompt = focus.taskPrompt, action = button.dataset.focusTaskPromptAction, id = button.dataset.taskId;
    if (!prompt) return;
    const restoreFocus = host.contains(document.activeElement);
    let accepted = false;
    if (action === 'select' && prompt.kind === 'continue') accepted = focusComponent.tasks({type: 'select', id});
    else if (id === prompt.taskId && (action === 'free' && prompt.kind === 'continue' || ['complete', 'keep'].includes(action) && prompt.kind === 'cycle-complete')) accepted = focusComponent.tasks({type: action === 'complete' ? 'confirm-complete' : action === 'free' ? 'unlink' : 'keep', id});
    if (accepted && restoreFocus) restoreFocusTaskControl();
  }
  function restoreFocusTaskControl() {
    const host = byId('focus-task-prompt');
    const targets = [...(!host.hidden ? host.querySelectorAll('button') : []), ...document.querySelectorAll('#tasks-player [data-task-action="start"],#focus-toggle,#focus-start,#focus-task-link,[data-scene-command="focus-toggle"],[data-scene-command="focus-link-task"],#notch-menu button')];
    targets.find(target => !target.disabled && !target.closest('[hidden],[inert]') && target.getClientRects().length)?.focus({preventScroll: true});
  }

  function musicInBand() { return isModuleEnabled('music') && music.available; }
  function getCollapsedActivities() {
    const transfer = nearby.incoming ? {...nearby.incoming, status: 'incoming', direction: 'receive'} : nearby.transfer;
    return activitySnapshot({music: musicInBand() ? {...music, position: position(), playing: music.playing && !connectionLost} : {}, focus: isModuleEnabled('focus') || isModuleEnabled('tasks') ? focus : {}, transfer: nearbyLoaded ? transfer : null, file: isModuleEnabled('shelf') ? fileJob : null});
  }
  function renderCollapsedActivities(activities = getCollapsedActivities()) {
    const rail = byId('activity-rail');
    const suppressed = fileDragging || state === 'compact' && !!moduleFeedback;
    notch.dataset.mediaPreview = String(state === 'compact' && !suppressed && musicInBand());
    rail.hidden = state !== 'compact' || suppressed || !activities.length;
    const mini = state === 'compact' && !suppressed && activities[0]?.id === 'music';
    const miniControls = byId('music-hover-controls'); notch.dataset.musicMini = String(mini);
    if (miniControls.dataset.visible !== String(mini)) {
      miniControls.dataset.visible = String(mini); miniControls.hidden = false;
      animateIslandLayer(miniControls, mini, true); miniControls.style.pointerEvents = 'none';
      if (!mini) {
        const animations = contentAnimations.get(miniControls) || [];
        if (!animations.length) miniControls.hidden = true;
        else void Promise.all(animations.map(animation => animation.finished)).then(() => {if (miniControls.dataset.visible === 'false') miniControls.hidden = true;}).catch(() => {});
      }
    }
    miniControls.querySelector('.music-hover-progress').setAttribute('aria-valuenow', String(Math.round((music.duration ? position() / music.duration : 0) * 100)));
    notch.dataset.activityCount = String(activities.length);
    notch.dataset.activityRail = String(!rail.hidden);
    const signature = activities.map(item => item.id).join(',');
    if (rail.dataset.signature !== signature) {
      rail.dataset.signature = signature;
      rail.replaceChildren(...activities.map((item, index) => {
        const node = document.createElement('span'); node.className = index ? 'activity-badge' : 'activity-primary'; node.dataset.activity = item.id;
        const glyph = document.createElement('span'); glyph.className = 'activity-glyph';
        if (item.id === 'music') glyph.innerHTML = '<img alt="" hidden><svg class="activity-music-note" viewBox="0 0 24 24"><path d="M9 18V5l11-2v13M9 9l11-2"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg><span class="activity-spectrum"><i></i><i></i><i></i><i></i></span>';
        else if (item.id === 'focus') glyph.innerHTML = '<svg class="activity-progress activity-focus-ring" viewBox="0 0 30 30"><circle cx="15" cy="15" r="12"/><circle class="activity-progress-fill" cx="15" cy="15" r="12" pathLength="1"/></svg>';
        else glyph.innerHTML = '<svg class="activity-progress" viewBox="0 0 30 30"><circle cx="15" cy="15" r="12"/><circle class="activity-progress-fill" cx="15" cy="15" r="12" pathLength="1"/></svg><svg class="activity-share" viewBox="0 0 24 24"><use href="#localsend-icon-share"/></svg>';
        node.append(glyph);
        if (!index) {const copy = document.createElement('span'); copy.className = 'activity-copy'; copy.innerHTML = '<strong></strong><small></small>'; const value = document.createElement('span'); value.className = 'activity-value'; node.append(copy, value); if (item.id === 'music') node.append(glyph.querySelector('.activity-spectrum').cloneNode(true));}
        return node;
      }));
    }
    const localized = item => ({label: item.id === 'music' && music.title ? item.label : t(item.label), value: item.id === 'transfer' || item.id === 'file' ? t(item.value) : item.value, detail: item.detail || (item.id === 'focus' ? focusLabel() : item.id === 'music' ? t(music.playing ? 'En lecture' : 'En pause') : 'LocalSend')});
    const labels = [];
    activities.forEach((item, index) => {
      const node = rail.children[index], copy = localized(item);
      node.dataset.playing = String(item.playing); node.dataset.indeterminate = String(item.progress === null);
      node.style.setProperty('--activity-progress', String(item.id === 'focus' ? focusCardValues(focus, focusSettings).progress : item.progress ?? 0));
      node.title = [copy.label, copy.value, copy.detail].filter(Boolean).join(' · '); labels.push(node.title);
      if (!index) {text(node.querySelector('strong'), copy.label); text(node.querySelector('small'), copy.detail); text(node.querySelector('.activity-value'), copy.value);}
      if (item.id === 'music') { const image = node.querySelector('img'), cover = !index && music.cover; image.hidden = !cover; if (cover && image.getAttribute('src') !== cover) image.src = cover; node.dataset.cover = String(!!cover); }
    });
    if (state !== 'compact' || !motionEnabled()) for (const bars of rail.querySelectorAll('.activity-spectrum')) delete bars.dataset.signal;
    if (state !== 'open' && !suppressed) toggle.setAttribute('aria-label', labels.length ? labels.join(' ; ') + ' · ' + t('Ouvrir l’encoche') : t('Ouvrir l’encoche'));
  }
  function renderLiveActivities() {
    const hasMusic = musicInBand(), hasFocus = (isModuleEnabled('focus') || isModuleEnabled('tasks')) && focusIsActive(), priority = state === 'compact' && !!moduleFeedback && isModuleEnabled(moduleFeedback.id);
    restContent.dataset.music = String(hasMusic); restContent.dataset.focus = String(hasFocus);
    restContent.dataset.active = String(hasMusic || hasFocus);
    live.hidden = !hasMusic || fileDragging || priority;
    byId('focus-live').hidden = !hasFocus || hasMusic || fileDragging || priority;
    strip.hidden = !hasMusic || state !== 'rest' || fileDragging;
    focusStrip.hidden = !hasFocus || state !== 'rest' || fileDragging;
    notch.dataset.liveCount = String(Number(hasMusic) + Number(hasFocus));
    byId('live-activities').hidden = fileDragging || priority || !(hasMusic || hasFocus);
    renderModuleFeedback();
    const transferBand = localSendBand();
    renderLocalSend();
    if (state !== 'open' && transferBand) {
      byId('live-activities').hidden = true;
      if (['progress', 'complete'].includes(transferBand.stage)) {strip.hidden = true; focusStrip.hidden = true;}
      byId('module-feedback-live').hidden = true; byId('module-feedback-actions').hidden = true;
    }
    renderCollapsedActivities();
  }
  function homePrimary() { return getModuleEditorActive() ? getModuleEditorSlots()[0] : getHomeSlots().find(Boolean) || null; }
  function homeModuleContext() { const selected = scenarioController?.getPreferences().selected; return {weatherPicker: weatherPickerOpen, focusConfig: focusComponent?.inspect().configOpen, completeScenario: selected === 'complete', dayScenario: selected === 'day'}; }
  function builtinVisible(id) {
    const definition = moduleDefinitions[id], editing = getModuleEditorActive();
    if (definition?.community) return view === 'nook' && !editing && activityScene.inspect().items.some(item=>item.id===id);
    if (id === 'files') return view === 'files' && !editing;
    if (editing && view === 'nook') return false;
    const scene = byId('nook-layout').dataset.layout === 'activities';
    const inHome = view === 'nook' && !editing && ['music', 'focus', 'tasks'].includes(id) && (['music', 'tasks'].includes(id) ? scene ? activityScene.inspect().items.some(item => item.id === id && !item.complete) : getHomeSlots().includes(id) : scene ? byId('nook-layout').dataset.primary === id && byId('nook-layout').dataset.sceneComplete !== 'true' : getHomeSlots().includes(id));
    return !!definition && (definition.directOpen && view === definition.view || id === 'focus' && view === 'focus' && focusCoreEnabled() || id === 'tasks' && isModuleEnabled('focus') && (view === 'tasks' || inHome && islandPage === 'tasks') || (editing ? getModuleEditorOrder().includes(id) : isModuleEnabled(id)) && (view === definition.view || inHome));
  }
  const homeCells = new Map();
  const activityScene = createActivityScene(), activityCards = new Map();
  let activityStage = null, activityMain = null, activitySide = null, activityExpiryTimer = 0, sceneConfigurationSignature = '';
  function sceneActivities() {
    if (focus.sessionSummary && focusCoreEnabled()) {const value=focusCardValues(focus,focusSettings); return [{id:'focus',key:'focus',label:focusLabel(),value:time(value.seconds),detail:focus.task,playing:!!focus.deadline,progress:value.progress}];}
    const configured = modulePlacementPlan({enabled: islandPage === 'tasks' && isModuleEnabled('focus') ? [...moduleSettings.enabled, 'tasks'] : moduleSettings.enabled, slots: getHomeSlots()});
    const live = new Map(getCollapsedActivities().map(item => [item.id, item]));
    const priorTransfer = activityScene.inspect().items.find(item => item.id === 'transfer');
    const confirmingTransfer = priorTransfer && nearby.transfer?.status === 'complete' && (!priorTransfer.complete || priorTransfer.until > Date.now());
    const contextual = live.get('transfer') || live.get('file');
    const currentOrder = activityScene.inspect().items.map(item => item.id);
    const ordered = [...configured.items].sort((left, right) => {
      const rank = id => currentOrder.includes(id) ? currentOrder.indexOf(id) : 3 + configured.items.findIndex(item => item.id === id);
      return rank(left.id) - rank(right.id);
    });
    const selected = (contextual || confirmingTransfer ? ordered : configured.items).slice(0, contextual || confirmingTransfer ? 2 : 3);
    const values = selected.map(({id}) => {
      const community = communityStore.get(id);
      if (community) return {id,key:id,label:community.manifest.name[i18n.locale()],value:'',detail:community.manifest.description[i18n.locale()],progress:null,playing:false};
      const card = id === 'focus' ? focusCardValues(focus, focusSettings) : null;
      if (id === 'music') return {id, key: id, label: music.title || t('Musique'), value: time(position()), detail: music.artist || music.source,
        playing: music.playing && !connectionLost, progress: music.duration ? position() / music.duration : null};
      if (id === 'focus') return {id, key: id, label: focusLabel(), value: time(card.seconds), detail: focus.task,
        playing: !!focus.deadline, progress: card.progress};
      if (id === 'tasks') return {id, key: id, label: t('Tâches'), value: `${focus.tasks.filter(task => task.done).length} / ${focus.tasks.length}`, detail: focus.task, playing: false, progress: null};
      if (id === 'weather') {const next = getWeatherSummary().narrative; return {id, key: id, label: t('Météo'), value: next.temperature, detail: next.city, progress: null, playing: false};}
      return {id, key: id, label: t('Étagère'), value: localSendCount(shelfItems.length), detail: shelfItems[0]?.name || t('Ouvrir l’Étagère'), progress: null, playing: false};
    });
    if (contextual) values.push({...contextual, key: contextual.id === 'transfer' ? nearby.incoming?.id || nearby.transfer?.id : fileJob.jobId});
    return values;
  }
  function ensureActivityStage() {
    if (activityStage) return;
    activityStage = document.createElement('div'); activityStage.className = 'activity-stage'; activityStage.id = 'activity-stage';
    activityMain = document.createElement('div'); activityMain.className = 'activity-main activity-card'; activityMain.tabIndex = -1; activityMain.setAttribute('role', 'group');
    activitySide = document.createElement('aside'); activitySide.className = 'activity-rail-cards'; activitySide.setAttribute('aria-label', t('Activités en cours'));
    activityStage.append(activityMain, activitySide);
    activityStage.addEventListener('click', activitySceneCommand);
  }
  function activitySummaryCard(id) {
    if (communityCards.has(id)) return communityCards.get(id);
    if (activityCards.has(id)) return activityCards.get(id);
    if (id === 'music') {activityCards.set(id, player); return player;}
    if (id === 'tasks') {tasksPlayer.classList.add('activity-card', 'activity-card-secondary'); activityCards.set(id, tasksPlayer); return tasksPlayer;}
    const card = document.createElement('article'); card.className = 'activity-card activity-card-secondary'; card.dataset.activity = id; card.dataset.module = id === 'transfer' ? 'localsend' : id === 'file' ? 'shelf' : id; card.setAttribute('role', 'group');
    if (id === 'focus') {
      card.classList.add('focus-summary');
      card.innerHTML = '<header class="focus-summary-heading"><button type="button" data-scene-promote="focus" class="focus-summary-phase"></button><button type="button" data-scene-command="focus-configure" class="focus-summary-configure"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg></button></header><div class="focus-summary-clock focus-clock" role="timer" aria-live="off"></div><button type="button" data-scene-command="focus-link-task" class="focus-summary-task"></button><div class="focus-summary-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span></span></div><footer class="focus-summary-controls"><button type="button" data-scene-command="focus-complete-task" class="focus-summary-done"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg></button><button type="button" data-scene-command="focus-toggle" class="focus-summary-toggle"><svg viewBox="0 0 24 24" aria-hidden="true"><path/></svg></button></footer>';
      activityCards.set(id, card); return card;
    }
    card.innerHTML = '<button type="button" class="activity-promote" data-scene-promote="' + id + '"><span class="activity-card-body"><span class="activity-card-art" aria-hidden="true"><img alt="" hidden><svg viewBox="0 0 24 24"><use href="#localsend-icon-share"/></svg></span><span class="activity-card-copy"><span class="activity-card-eyebrow"></span><strong class="activity-card-title"></strong><span class="activity-card-detail"></span></span><span class="activity-card-ring" aria-hidden="true"><svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="26"/><circle class="activity-card-ring-fill" cx="30" cy="30" r="26" pathLength="1"/></svg></span></span><span class="activity-card-value"></span></button><div class="activity-card-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span></span></div><div class="activity-card-times"><span></span><span></span></div><div class="activity-card-actions"><button type="button" class="activity-card-action"><svg viewBox="0 0 24 24" aria-hidden="true"><path/></svg></button></div><div class="activity-card-completion" role="status" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg><span></span></div>';
    const status = document.createElement('span'); status.className = 'activity-card-status-label'; card.querySelector('.activity-card-eyebrow').append(status);
    if (id === 'weather' || id === 'shelf') {
      card.classList.add('activity-module-summary');
      const preview = document.createElement('span'); preview.className = 'activity-module-preview'; card.querySelector('.activity-promote').append(preview);
      if (id === 'weather') {
        // Weather owns two distinct buttons: the date opens the agenda, the city opens forecasts.
        const previous = card.querySelector('.activity-promote'), container = document.createElement('div'); container.className = previous.className;
        container.append(...previous.childNodes); previous.replaceWith(container);
        const design = document.createElement('span'); design.className = 'weather-design'; container.append(design);
      }
      if (id === 'shelf') card.querySelector('.activity-card-art svg').innerHTML = '<path d="M3 6h7l2 3h9v11H3Z"/>';
    }
    if (id === 'music') {
      card.querySelector('.activity-card-art svg').innerHTML = '<path d="M9 18V5l11-2v13M9 9l11-2"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>';
      const spectrum = document.createElement('span'); spectrum.className = 'activity-spectrum'; spectrum.setAttribute('aria-hidden', 'true'); spectrum.innerHTML = '<i></i><i></i><i></i>'; card.querySelector('.activity-card-eyebrow').prepend(spectrum);
      for (const [command, label] of [['previous', 'Morceau précédent'], ['next', 'Morceau suivant']]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'activity-card-skip'; button.dataset.sceneCommand = 'music-' + command; button.setAttribute('aria-label', t(label));
        button.append(player.querySelector(`[data-music-command="${command}"] svg`).cloneNode(true));
        const actions = card.querySelector('.activity-card-actions'); if (command === 'previous') actions.prepend(button); else actions.append(button);
      }
    }
    card.querySelector('img').addEventListener('error', event => {event.target.hidden = true;});
    activityCards.set(id, card); return card;
  }
  function renderActivitySceneValues() {
    if (!activityStage || byId('nook-layout').dataset.layout !== 'activities') return;
    if (activityMain.dataset.activity === 'music') text(player.querySelector('.music-playing-label'), t(music.playing && !connectionLost ? 'EN LECTURE' : 'Musique'));
    const values = new Map(sceneActivities().map(item => [item.id, item]));
    for (const snapshot of activityScene.inspect().items) {
      const item = snapshot.complete ? snapshot : values.get(snapshot.id) || snapshot, card = activityCards.get(item.id);
      if (communityCards.has(item.id)) {const host=communityCards.get(item.id); if (activityStage.contains(host)) renderCommunityCard(item.id,host.dataset.presentation); continue;}
      if (!card || !activityStage.contains(card)) continue;
      if (item.id === 'music') continue; // The same live player owns every music placement.
      if (item.id === 'tasks') {tasksComponent.render(); continue;}
      if (item.id === 'focus') {renderFocusSummary(card); continue;}
      const isMusic = item.id === 'music', isFocus = item.id === 'focus', isTransfer = item.id === 'transfer', isWeather = item.id === 'weather', isShelf = item.id === 'shelf', playing = item.playing;
      const weatherCopy = isWeather ? getWeatherSummary().narrative : null;
      const transferName = isTransfer && (nearby.incoming?.files?.[0]?.name || nearby.transfer?.files?.[0]?.name || (nearby.transfer?.fileCount ? localSendCount(nearby.transfer.fileCount) : 'LocalSend'));
      const title = isMusic ? music.title || t('Aucun morceau') : isFocus ? focus.task || focusLabel() : isWeather ? weatherCopy.city : isShelf ? t('Étagère') : isTransfer ? transferName + (item.detail ? ' → ' + item.detail : '') : item.detail || t(item.label);
      const detail = isMusic ? music.artist || music.source || t('Ouvrir le lecteur') : isFocus ? t(playing ? 'En cours' : focusIsActive() ? 'Prêt à reprendre' : 'Prêt à commencer') : isWeather ? weather.condition ? t(weather.condition) : weatherCopy.status || t('conditions indisponibles') : isShelf ? shelfError || (shelfLoaded ? shelfItems.length ? shelfItems[0].name : t('Déposer des fichiers') : t('Chargement…')) : isTransfer ? nearby.transfer?.totalBytes ? localSendSize(nearby.transfer.totalBytes) : t(item.label) : fileJob.source?.name || t('Fichier en cours');
      card.dataset.complete = String(!!item.complete); card.dataset.playing = String(!!playing); card.dataset.indeterminate = String(item.progress === null);
      card.style.setProperty('--activity-progress', String(item.progress ?? 0)); card.setAttribute('aria-label', [t(item.label), detail].filter(Boolean).join(' · '));
      text(card.querySelector('.activity-card-status-label'), isMusic ? t(playing ? 'EN LECTURE' : 'Musique') : isFocus ? t(focus.pomodoro?.phase === 'break' ? 'PAUSE' : 'FOCUS') + ' · ' + t('CYCLE') + ' ' + (focus.pomodoro?.session || 1) + '/' + (focus.pomodoro?.total || focusSettings.total) : isWeather ? t('Météo') : isShelf ? t('Fichiers gardés') : isTransfer ? 'LOCALSEND · ' + t(item.label).toLocaleUpperCase(i18n.locale()) : t('Fichier en cours'));
      text(card.querySelector('.activity-card-title'), title); text(card.querySelector('.activity-card-detail'), detail);
      text(card.querySelector('.activity-card-value'), isMusic || isFocus ? '' : isWeather ? weatherCopy.temperature : isShelf ? shelfLoaded ? localSendCount(shelfItems.length) : '—' : item.value);
      const promote = card.querySelector('.activity-promote'); promote.setAttribute('aria-label', t('Afficher l’activité') + ' · ' + title + (isFocus ? ' · ' + item.value : ''));
      if (isFocus) text(card.querySelector('.activity-card-ring-time'), item.value);
      const progress = card.querySelector('.activity-card-progress'); progress.hidden = isFocus || isWeather || isShelf; progress.setAttribute('aria-label', t(isMusic ? 'Progression de la lecture' : 'Progression du transfert'));
      if (item.progress === null) progress.removeAttribute('aria-valuenow'); else progress.setAttribute('aria-valuenow', String(Math.round(item.progress * 100)));
      const times = card.querySelector('.activity-card-times'); times.hidden = !isMusic;
      if (isMusic) {text(times.children[0], time(position())); text(times.children[1], music.duration ? time(music.duration) : '—:—');}
      const image = card.querySelector('img'); image.hidden = !isMusic || !music.cover; if (!image.hidden && image.getAttribute('src') !== music.cover) image.src = music.cover;
      card.querySelector('.activity-card-art').hidden = isFocus; card.querySelector('.activity-card-ring').hidden = !isFocus;
      if (isWeather) {
        card.querySelector('.activity-card-art svg').replaceChildren(byId('weather-condition-icon').querySelector('path').cloneNode(true));
        text(card.querySelector('.activity-module-preview'), [t('ressenti') + ' ' + weatherCopy.feelsLike, weatherCopy.rain + ' ' + weatherCopy.rainQualifier].join(' · '));
        renderWeatherDesign(card.querySelector('.weather-design'), card.dataset.presentation);
      } else if (isShelf) {
        const preview = card.querySelector('.activity-module-preview'), signature = JSON.stringify(shelfItems.slice(0, 3).map(file => [file.id, file.name]));
        if (preview.dataset.files !== signature) {preview.dataset.files = signature; preview.replaceChildren(...shelfItems.slice(0, 3).map(file => {const name = document.createElement('span'); name.textContent = file.name; return name;}));}
      }
      const action = card.querySelector('.activity-card-action'), path = action.querySelector('path');
      action.dataset.sceneCommand = isFocus ? 'focus-toggle' : isMusic ? 'music-toggle' : isWeather ? 'weather-open' : isShelf ? 'shelf-open' : isTransfer ? 'transfer-cancel' : 'file-open';
      action.disabled = !!item.complete || (isMusic ? commandBusy || connectionLost || !music.canToggle : isFocus ? false : isWeather || isShelf ? false : isTransfer ? nearbyBusy || !['preparing', 'waiting', 'sending', 'receiving'].includes(nearby.transfer?.status) : fileBusy);
      action.setAttribute('aria-label', t(isMusic || isFocus ? playing ? 'Mettre en pause' : isFocus && !focusIsActive() ? 'Démarrer Focus' : 'Reprendre' : isTransfer ? 'Annuler le transfert' : 'Ouvrir'));
      if (isMusic) for (const [command, capability, label] of [['previous', 'canPrevious', 'Morceau précédent'], ['next', 'canNext', 'Morceau suivant']]) {
        const button = card.querySelector('[data-scene-command="music-' + command + '"]'); button.disabled = !!item.complete || commandBusy || connectionLost || !music[capability]; button.setAttribute('aria-label', t(label));
      }
      path.setAttribute('d', isMusic ? byId('music-play-icon').getAttribute('d') : isFocus ? playing ? 'M6 5h4v14H6ZM14 5h4v14h-4Z' : 'M8 5v14l11-7Z' : isTransfer ? 'M6 6l12 12M18 6L6 18' : 'M8 5l8 7-8 7');
      const completion = card.querySelector('.activity-card-completion'); completion.hidden = !item.complete;
      text(completion.querySelector('span'), t(isTransfer ? nearby.transfer?.direction === 'receive' ? 'Reçu' : 'Envoyé' : 'Terminé'));
    }
    activitySide.setAttribute('aria-label', t('Activités en cours'));
  }
  function renderFocusSummary(card) {
    const value = focusComponent.summary(), linked = focus.tasks.find(task => task.id === focus.activeTaskId && !task.done);
    card.dataset.complete = String(!!focus.complete); card.dataset.playing = String(!!focus.deadline);
    card.dataset.focusBreak = focus.pomodoro?.phase === 'break' ? focus.pomodoro.breakKind : 'none';
    const phase = t(focus.pomodoro?.phase === 'break' ? 'PAUSE' : 'FOCUS') + ' · ' + t('CYCLE') + ' ' + (focus.pomodoro?.session || 1) + '/' + value.total;
    text(card.querySelector('.focus-summary-phase'), phase); card.querySelector('.focus-summary-phase').setAttribute('aria-label', t('Afficher l’activité') + ' · ' + phase);
    let ring = card.querySelector('.focus-summary-reference-ring');
    if (!ring) {ring = document.createElement('div'); ring.className = 'focus-summary-reference-ring'; ring.innerHTML = '<svg viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="24"/><circle class="reference-ring-fill" cx="28" cy="28" r="24" pathLength="1"/></svg>'; card.append(ring); ring.append(card.querySelector('.focus-summary-clock')); const link = document.createElement('span'); link.className = 'focus-summary-link-label'; card.append(link);}
    ring.style.setProperty('--focus-progress', value.progress);
    text(card.querySelector('.focus-summary-link-label'), linked ? t('Tâche liée') : '');
    const clock = card.querySelector('.focus-summary-clock');
    FocusAPI.renderClock(clock, value.seconds, {motion: motionEnabled() && state === 'open' && !document.hidden});
    clock.setAttribute('aria-label', t('{minutes} minutes {seconds} secondes', {minutes: Math.floor(value.seconds / 60), seconds: value.seconds % 60}));
    const task = card.querySelector('.focus-summary-task'); text(task, linked?.title || t('Focus libre')); task.title = linked?.title || t('Focus libre');
    task.setAttribute('aria-label', t(linked ? 'Changer la tâche liée : {task}' : 'Lier une tâche', {task: linked?.title}));
    const progress = card.querySelector('.focus-summary-progress'); progress.style.setProperty('--focus-progress', value.progress); progress.setAttribute('aria-label', t('Progression de la session')); progress.setAttribute('aria-valuenow', String(Math.round(value.progress * 100)));
    card.querySelector('[data-scene-command="focus-configure"]').setAttribute('aria-label', t('Régler le Pomodoro'));
    const done = card.querySelector('.focus-summary-done'); done.disabled = !linked; done.setAttribute('aria-label', t('Terminée'));
    const toggle = card.querySelector('.focus-summary-toggle'); toggle.setAttribute('aria-label', t(value.active ? value.paused ? 'Reprendre Focus' : 'Mettre Focus en pause' : 'Démarrer Focus'));
    toggle.querySelector('path').setAttribute('d', focus.deadline ? 'M6 5h4v14H6ZM14 5h4v14h-4Z' : 'M8 5v14l11-7Z');
  }
  function renderActivityScene() {
    const home = byId('nook-layout'), eligible = view === 'nook' && !getModuleEditorActive() && islandPage !== 'essential';
    if (!eligible) return false;
    const configuration = JSON.stringify([getHomeSlots(), !!focus.sessionSummary]);
    if (configuration !== sceneConfigurationSignature) {activityScene.reset(); sceneConfigurationSignature = configuration;}
    const completed = [];
    if (isModuleEnabled('focus') && (focus.complete || focus.pomodoro?.finished)) completed.push('focus');
    if (nearby.transfer?.status === 'complete') completed.push('transfer');
    if (isModuleEnabled('shelf') && fileJob.status === 'complete') completed.push('file');
    const snapshot = activityScene.update(sceneActivities(), {completed, preserveOrder: true});
    window.clearTimeout(activityExpiryTimer); activityExpiryTimer = 0;
    const expiry = snapshot.items.filter(item => item.complete).map(item => item.until);
    if (expiry.length) activityExpiryTimer = window.setTimeout(() => {activityExpiryTimer = 0; if (!disposed) renderHomeLayout();}, Math.max(1, Math.min(...expiry) - Date.now()));
    ensureActivityStage();
    home.dataset.layout = 'activities'; home.dataset.grid = 'activities'; home.dataset.scenario = ''; home.dataset.primary = snapshot.primary || ''; home.dataset.sceneComplete = String(!!snapshot.items[0]?.complete); home.dataset.activityCount = String(snapshot.items.length);
    homeLayout = {mode: 'activities', primary: snapshot.primary, rail: [...snapshot.rail], items: snapshot.items.map((item, index) => ({id: item.id, complete: !!item.complete, presentation: snapshot.items.length === 1 ? 'full' : snapshot.items.length === 3 && index ? 'rail' : 'scene'}))};
    if (!snapshot.items.length) {
      for (const definition of Object.values(moduleDefinitions)) {const element = byId(definition.element); if (element.parentElement !== panel) panel.append(element); element.hidden = true;}
      activityStage.remove(); byId('home-main').hidden = true; byId('home-side').hidden = true; byId('home-empty').hidden = false; home.inert = false; renderMusicQueue(); musicQueueLifecycle(); return true;
    }
    const primary = snapshot.items[0], component = moduleDefinitions[primary.id] && (['music', 'focus', 'tasks'].includes(primary.id) || communityCards.has(primary.id)) && !primary.complete ? byId(moduleDefinitions[primary.id].element) : null;
    for (const definition of Object.values(moduleDefinitions)) {
      const element = byId(definition.element), parent = element === component ? activityMain : (['music', 'tasks'].includes(definition.id) || communityCards.has(definition.id)) && snapshot.rail.includes(definition.id) ? activitySide : panel;
      if (element.parentElement !== parent) parent.append(element);
      element.hidden = !builtinVisible(definition.id); element.dataset.module = definition.id;
    }
    const presentation = snapshot.items.length === 1 ? 'full' : 'scene';
    activityMain.dataset.activity = primary.id; activityMain.dataset.module = primary.id === 'transfer' ? 'localsend' : primary.id === 'file' ? 'shelf' : primary.id; activityMain.dataset.presentation = presentation;
    const primaryDescription = [primary.id === 'music' ? primary.label : t(primary.label), primary.detail].filter(Boolean).join(' · ');
    activityMain.setAttribute('aria-label', primaryDescription); activityMain.title = primaryDescription;
    const primaryContent = component || activitySummaryCard(primary.id);
    primaryContent.dataset.presentation = presentation; primaryContent.dataset.module = activityMain.dataset.module; primaryContent.dataset.activity = primary.id;
    if (primary.id === 'tasks') tasksComponent.render();
    if (activityMain.firstElementChild !== primaryContent || activityMain.children.length !== 1) activityMain.replaceChildren(primaryContent);
    for (const id of snapshot.rail) {const card = activitySummaryCard(id); card.dataset.presentation = snapshot.items.length === 2 ? 'scene' : 'rail'; card.dataset.activity = id; if (id === 'music') {card.classList.add('activity-card', 'activity-card-secondary'); card.hidden = false;} if (id === 'tasks') {card.hidden = false; tasksComponent.render();} if (card.parentElement !== activitySide) activitySide.append(card);}
    for (const card of [...activitySide.children]) if (!snapshot.rail.includes(card.dataset.activity)) card.remove();
    snapshot.rail.forEach((id, index) => {const card = activitySummaryCard(id); if (activitySide.children[index] !== card) activitySide.insertBefore(card, activitySide.children[index] || null);});
    activitySide.hidden = !snapshot.rail.length;
    if (activityStage.parentElement !== home) home.append(activityStage);
    for (const child of [...home.children]) if (![activityStage, byId('home-main'), byId('home-side'), byId('home-empty')].includes(child)) child.remove();
    byId('home-main').hidden = true; byId('home-side').hidden = true; byId('home-empty').hidden = true; home.inert = false;
    byId('music-promote').hidden = !player.parentElement?.classList?.contains('activity-rail-cards');
    renderActivitySceneValues(); renderMusicQueue(); musicQueueLifecycle(); return true;
  }
  function animateActivityPromotion() {
    if (!activityMain || state !== 'open' || document.hidden) return;
    const previous = contentAnimations.get(activityMain), current = getComputedStyle(activityMain);
    const from = previous ? {opacity: current.opacity, translate: current.translate} : NOTCH_TOKENS.motion.sceneFrom;
    for (const animation of previous || []) animation.cancel();
    contentAnimations.delete(activityMain);
    if (!motionEnabled() || typeof activityMain.animate !== 'function') return;
    const animation = activityMain.animate([from, NOTCH_TOKENS.motion.sceneTo], {duration: NOTCH_TOKENS.dur.card, easing: NOTCH_TOKENS.ease.out});
    const animations = [animation]; contentAnimations.set(activityMain, animations);
    const finish = () => {if (contentAnimations.get(activityMain) === animations) contentAnimations.delete(activityMain);};
    animation.finished.then(finish, finish);
  }
  function activitySceneCommand(event) {
    const promote = event.target.closest('[data-scene-promote]'), action = event.target.closest('[data-scene-command]');
    if (disposed || (promote || action)?.disabled) return;
    if (promote?.dataset.scenePromote) {
      const id=promote.dataset.scenePromote;
      if (id === 'transfer') {
        if (nearby.incoming) openLocalSend('receive', nearby.incoming);
        else {selectViewButton({dataset: {view: localSendContext ? 'localsend' : 'tray'}}); setState('open');}
      } else if (id === 'file') {selectViewButton({dataset: {view: 'files'}}); setState('open');}
      else if (moduleDefinitions[id]?.view && moduleDefinitions[id].view !== 'nook') {
        openActivityDetail(moduleDefinitions[id].view);
      }
      return;
    }
    if (!action) return;
    if (action.dataset.sceneCommand === 'focus-toggle') focusComponent.command(focusIsActive() ? 'toggle' : 'start');
    else if (action.dataset.sceneCommand === 'focus-complete-task') focusComponent.command('complete-task');
    else if (['focus-link-task', 'focus-configure'].includes(action.dataset.sceneCommand)) {
      if (action.dataset.sceneCommand === 'focus-link-task') {focusToolReturn={view,page:islandPage,control:document.activeElement}; selectViewButton({dataset:{view:'focus'}}); setState('open');}
      focusComponent.command(action.dataset.sceneCommand === 'focus-link-task' ? 'link-task' : 'configure');
    }
    else if (['music-toggle', 'music-previous', 'music-next'].includes(action.dataset.sceneCommand)) void performMusicCommand({command: action.dataset.sceneCommand.slice(6)});
    else if (action.dataset.sceneCommand === 'transfer-cancel' && nearby.transfer?.id) void nearbyRequest({command: 'cancel', id: nearby.transfer.id});
    else if (action.dataset.sceneCommand === 'file-open') {selectViewButton({dataset: {view: 'files'}}); setState('open');}
    else if (['weather-open', 'shelf-open'].includes(action.dataset.sceneCommand)) {selectViewButton({dataset: {view: moduleDefinitions[action.dataset.sceneCommand.split('-')[0]].view}}); setState('open');}
  }
  function renderHomeLayout({skipUpdate = false} = {}) {
    const home = byId('nook-layout'), main = byId('home-main'), side = byId('home-side'), editing = getModuleEditorActive();
    home.hidden = view !== 'nook' || editing;
    if (renderActivityScene()) {renderIslandNavigation(); renderHomeSummaries(); if (!skipUpdate) update(); return;}
    if (!home.hidden) {
      const slots = getHomeSlots(), plan = nookGridPlan(islandPage, moduleSettings.enabled);
      home.dataset.grid = islandPage; home.dataset.layout = 'grid'; home.dataset.scenario = ''; home.dataset.primary = ''; home.dataset.activityCount = '0';
      const children = [];
      for (const definition of Object.values(moduleDefinitions)) {
        const component = byId(definition.element), visible = ['music', 'focus'].includes(definition.id) && slots.includes(definition.id);
        if (component.parentElement !== (visible ? home : panel)) (visible ? home : panel).append(component);
        component.hidden = !builtinVisible(definition.id); component.dataset.module = definition.id;
        if (visible) children.push(component);
      }
      for (const item of plan) {
        home.style.setProperty('--nook-' + item.id + '-column', `${item.column} / span ${item.columns}`);
        home.style.setProperty('--nook-' + item.id + '-row', `${item.row} / span ${item.rows}`);
        if (['music', 'focus', 'tasks', 'pomodoro'].includes(item.id)) continue;
        if (!homeCells.has('grid-' + item.id)) {
          const button = document.createElement('button'); button.type = 'button'; button.dataset.moduleOpen = item.id; button.className = 'home-summary nook-grid-tile';
          button.append(document.createElement('span'), document.createElement('strong'), document.createElement('small'));
          homeCells.set('grid-' + item.id, button);
        }
        const button = homeCells.get('grid-' + item.id); button.style.gridColumn = `${item.column} / span ${item.columns}`; button.style.gridRow = `${item.row} / span ${item.rows}`; children.push(button);
      }
      // Reuse the live components, including the single timer and task list.
      for (const child of [...home.children]) if (!children.includes(child) && ![main, side, byId('home-empty')].includes(child)) child.remove();
      for (const child of children) if (child.parentElement !== home) home.append(child);
      main.hidden = true; side.hidden = true; byId('home-empty').hidden = plan.length > 0; home.inert = false;
      renderIslandNavigation(); renderHomeSummaries(); if (!skipUpdate) update(); return;
    }
    const slots = getHomeSlots(), items = homeModuleLayout(slots, 0, 16, homeModuleContext()).items;
    const placed = home.hidden ? [] : items;
    for (const definition of Object.values(moduleDefinitions)) {
      const component = byId(definition.element), item = placed.find(item => item.id === definition.id);
      let parent = panel;
      if (item && !item.compact) {
        if (!homeCells.has(item.id)) { const cell = document.createElement('div'); cell.className = 'home-module'; cell.dataset.module = item.id; homeCells.set(item.id, cell); }
        parent = homeCells.get(item.id);
      }
      if (component.parentElement !== parent) parent.append(component);
      component.hidden = !builtinVisible(definition.id); component.dataset.module = definition.id;
    }
    for (const item of placed) {
      if (!homeCells.has(item.id)) { const cell = document.createElement('div'); cell.className = 'home-module'; cell.dataset.module = item.id; homeCells.set(item.id, cell); }
      const cell = homeCells.get(item.id); cell.dataset.homeSlot = String(slots.indexOf(item.id));
      cell.style.setProperty('--module-min-width', item.minWidth + 'px'); cell.style.setProperty('--module-min-height', item.minHeight + 'px');
      if (item.compact && !cell.querySelector('[data-module-open]')) {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.moduleOpen = item.id; button.className = 'home-summary';
        const label = document.createElement('span'), value = document.createElement('strong'), detail = document.createElement('small'); label.textContent = moduleLabels[item.id]; button.append(label, value, detail); cell.replaceChildren(button);
      } else if (!item.compact) cell.querySelector('[data-module-open]')?.remove();
    }
    const primaryCell = placed[0] ? homeCells.get(placed[0].id) : null, secondaryCells = placed.slice(1).map(item => homeCells.get(item.id));
    if (main.firstElementChild !== primaryCell || main.children.length !== Number(!!primaryCell)) main.replaceChildren(...(primaryCell ? [primaryCell] : []));
    if (side.children.length !== secondaryCells.length || secondaryCells.some((cell, index) => side.children[index] !== cell)) side.replaceChildren(...secondaryCells);
    home.dataset.primary = items[0]?.id || ''; home.inert = editing;
    side.hidden = !secondaryCells.length; byId('home-empty').hidden = !!items.length || editing; main.hidden = !primaryCell;
    renderHomeSummaries();
    if (!skipUpdate) update();
  }
  function renderHomeSummaries() {
    renderActivitySceneValues();
    for (const button of byId('nook-layout').querySelectorAll('[data-module-open]')) {
      const id = button.dataset.moduleOpen;
      if (!id) continue;
      if (id === 'weather') { renderWeatherSummary(button); continue; }
      if (button.classList.contains('nook-grid-tile')) {
        text(button.querySelector('span'), t(id === 'shelf' ? 'Fichiers' : id === 'localsend' ? 'LocalSend' : 'Scénarios'));
        const transfer = nearby.transfer, ongoing = transfer && ['preparing', 'waiting', 'sending', 'receiving'].includes(transfer.status);
        text(button.querySelector('strong'), id === 'shelf' ? localSendCount(shelfItems.length) : id === 'localsend' ? nearby.incoming ? t('Proposition de réception') : ongoing ? Math.round(transfer.progress || 0) + ' %' : nearby.available ? t('Prêt à recevoir') : t('À proximité') : t(scenarioController?.getPreferences().selected ? {focus:'Focus',ambience:'Ambiance',day:'Journée',complete:'Complet',minimal:'Minimal'}[scenarioController.getPreferences().selected] : 'À ton rythme'));
        text(button.querySelector('small'), id === 'shelf' ? shelfItems[0]?.name || t('Ouvrir l’Étagère') : id === 'localsend' ? nearby.incoming?.alias || ongoing && transfer.alias || t('Envoyer ou recevoir') : t('Suivre ton activité'));
        continue;
      }
      text(button.querySelector('strong'), id === 'music' ? music.available ? music.title : t('Aucun morceau') : id === 'focus' ? focusIsActive() ? time(FocusModel.remaining(focus)) : focus.complete ? t('Terminé') : `${focusSettings.work}:00` : !shelfLoaded ? t('Fichiers gardés') : localSendCount(shelfItems.length));
      text(button.querySelector('small'), id === 'music' ? music.artist || t('Ouvrir le lecteur') : id === 'focus' ? focusIsActive() ? focusLabel() : focus.complete ? t('Cycle terminé') : t('Prêt à commencer') : t('Ouvrir l’Étagère'));
    }
  }
  function openBuiltin(event) {
    const button = event.target.closest('[data-module-open]'); if (!button || disposed) return;
    const id = button.dataset.moduleOpen, route = moduleDefinitions[id]?.view;
    if (id === 'localsend') {if (nearby.incoming) openLocalSend('receive', nearby.incoming); else {selectViewButton({dataset: {view: 'tray'}}); setState('open');} return;}
    if (id === 'scenarios') {selectViewButton({dataset: {view: 'scenarios'}}); setState('open'); return;}
    if (id === 'modules') { openModuleEditor(event); return; }
    if (route) { selectViewButton({dataset: {view: route}}); setState('open'); }
  }
  function modulesChanged(previous = {enabled: []}) {
    for (const button of menuButtons) if (button.dataset.view === 'focus' || button.dataset.view === 'tray') button.hidden = !isModuleEnabled(button.dataset.view === 'tray' ? 'shelf' : 'focus');
    const current = Object.values(moduleDefinitions).find(item => item.view === view); if (current && !isModuleEnabled(current.id)) view = 'nook';
    renderHomeLayout(); renderIslandNavigation(); musicLifecycle(); renderFocus(); renderShelf(); renderFiles(); renderWeather(); weatherLifecycle(); renderModules(); renderLiveActivities(); nearbyLifecycle();
    if (moduleFeedback && !isModuleEnabled(moduleFeedback.id)) clearModuleFeedback();
  }
  function moduleEditorLayoutChanged(change) {
    if (change.opening) view = 'nook';
    if (change.closing) {
      view = change.previousView || 'nook';
      const previous = Object.values(moduleDefinitions).find(item => item.view === view);
      if (previous && !isModuleEnabled(previous.id)) view = 'nook';
    }
    renderHomeLayout(); renderMusic(); renderFocus(); renderShelf(); renderFiles(); renderWeather(); weatherLifecycle();
    renderSettings(); renderMenuSelection();
    if (change.opening) setState('open'); else if (change.closing) setState(change.previousState || 'rest'); else update();
    renderModules();
  }

  let nearby = {status: desktop?.localSendActive === true ? 'ready' : 'off', available: desktop?.localSendActive === true, peers: [], transfer: null, incoming: null}, nearbyPeer = '', nearbyTimer = 0, nearbyBusy = false, nearbyError = '', nearbyReading = false, nearbyActionError = false;
  let nearbyIncomingShown = '', nearbyReceiveCompleted = '';
  function localSendPresentation() {
    const context = localSendContext; if (!context) return null;
    const incoming = nearby.incoming?.id === context.incomingId ? nearby.incoming : null;
    const current = nearby.transfer;
    const transfer = current && (context.incomingId ? current.id === context.incomingId : context.requested && current.id !== context.previousId && current.direction === 'send') ? current : null;
    const stage = incoming ? 'consent' : context.error || nearby.error ? 'error' : transfer?.status === 'complete' ? 'complete' : transfer?.status === 'sending' || transfer?.status === 'receiving' ? 'progress' : transfer?.status === 'preparing' || transfer?.status === 'waiting' ? 'waiting' : ['rejected','cancelled','error','pin-required'].includes(transfer?.status) ? transfer.status === 'pin-required' ? 'error' : transfer.status : context.incomingId ? 'cancelled' : context.requested ? 'waiting' : 'discovery';
    const files = context.files, count = transfer?.fileCount || files.length;
    const bytes = transfer?.totalBytes || context.totalBytes;
    return {stage, direction: context.direction, files, count, bytes, transfer, alias: incoming?.alias || transfer?.alias || context.alias || '', progress: Math.max(0, Math.min(100, Number(transfer?.progress) || 0)), error: context.error || nearby.error || transfer?.error || ''};
  }
  function localSendSize(bytes) { return new Intl.NumberFormat(i18n.locale() === 'en' ? 'en-US' : 'fr-FR', {maximumFractionDigits: 1}).format(Math.max(0, Number(bytes) || 0) / 1048576) + ' ' + t('Mo'); }
  function localSendCount(count) { return t(count === 1 ? '{count} fichier' : '{count} fichiers', {count}); }
  function localSendCompletion(count, receive) {return t(receive ? count === 1 ? '{count} fichier reçu' : '{count} fichiers reçus' : count === 1 ? '{count} fichier envoyé' : '{count} fichiers envoyés', {count});}
  function localizedLocalSendFailure(value) {
    const copy = localSendFailureCopy(value);
    return {...copy, title: !['rejected', 'cancelled'].includes(value.stage) && value.progress > 0 ? t('Transfert interrompu à {percent} %', {percent: Math.round(value.progress)}) : t(copy.title), detail: value.stage === 'rejected' ? t('{device} a refusé le partage.', {device: value.alias || t('L’appareil')}) : uiMessage(copy.detail), help: t(copy.help)};
  }
  function localSendBand() {
    const value = localSendPresentation();
    if (!nearbyLoaded || fileDragging) return null;
    if (!value) return null;
    const ownFeedback = moduleFeedback?.id === 'shelf' && ['sent','received'].includes(moduleFeedback.kind) && !!value.transfer?.id && moduleFeedback.transferId === value.transfer.id;
    if (['complete','error','cancelled','rejected'].includes(value.stage) && !ownFeedback) return null;
    return value;
  }
  function renderLocalSendBand() {
    const band = localSendBand(), live = byId('localsend-live'), progress = byId('localsend-discreet-progress'), receive = band?.direction === 'receive';
    live.hidden = state !== 'compact' || !band;
    progress.hidden = state !== 'rest' || !band || !['progress', 'complete'].includes(band.stage);
    if (!progress.hidden) {
      const ratio = band.stage === 'complete' ? 1 : band.progress / 100;
      progress.style.setProperty('--localsend-progress', String(ratio));
      progress.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    }
    if (!band) return;
    live.dataset.stage = band.stage;
    byId('localsend-live-icon').setAttribute('href', band.stage === 'ready' ? '#localsend-icon-ready' : band.stage === 'complete' ? '#localsend-icon-done' : '#localsend-icon-share');
    text(byId('localsend-live-title'), band.stage === 'ready' ? t('Prêt à recevoir') : band.stage === 'consent' ? t('Demande de partage') : band.stage === 'complete' ? localSendCompletion(band.count, receive) : band.stage === 'discovery' ? t('Partage local') : receive ? t('Réception') : t('Envoi'));
    text(byId('localsend-live-meta'), band.stage === 'progress' ? Math.round(band.progress) + ' %' : band.stage === 'discovery' ? t(nearby.peers.length === 1 ? '{count} appareil' : '{count} appareils', {count: nearby.peers.length}) : band.stage === 'complete' && receive ? t('Étagère') : 'LocalSend');
  }
  function renderLocalSend() {
    const host = byId('localsend-player'), value = localSendPresentation();
    host.hidden = view !== 'localsend' || !value;
    host.dataset.active = String(!host.hidden && state === 'open' && !document.hidden);
    host.dataset.motion = String(motionEnabled());
    renderLocalSendBand();
    if (!value) return;
    host.dataset.stage = value.stage; host.dataset.direction = value.direction;
    const receive = value.direction === 'receive', success = value.stage === 'complete', terminal = ['complete','error','cancelled','rejected'].includes(value.stage);
    const title = value.stage === 'discovery' ? t('Envoyer à…') : value.stage === 'waiting' ? value.transfer?.status !== 'waiting' ? t('Préparation de l’envoi') : t('Demande envoyée') : value.stage === 'progress' ? receive ? t('Réception de {device}', {device: value.alias}) : t('Envoi en cours') : success ? t('Terminé') : t('Transfert interrompu');
    text(byId('localsend-title'), title); text(byId('localsend-summary'), localSendCount(value.count) + ' · ' + localSendSize(value.bytes));
    byId('localsend-consent').hidden = value.stage !== 'consent';
    byId('localsend-discovery').hidden = value.stage !== 'discovery';
    byId('localsend-connection').hidden = !['waiting','progress'].includes(value.stage);
    byId('localsend-waiting').hidden = value.stage !== 'waiting';
    byId('localsend-progress').hidden = value.stage !== 'progress';
    byId('localsend-result').hidden = !terminal;
    byId('localsend-result-actions').hidden = !terminal;
    byId('localsend-file-chips').hidden = !success || !receive;
    byId('localsend-shelf').hidden = !success || !receive;
    byId('localsend-retry').hidden = receive;
    const peerAvailable = nearby.peers?.some(peer => peer.id === localSendContext.peerId);
    byId('localsend-retry').dataset.localsendCommand = peerAvailable ? 'retry' : 'discover';
    text(byId('localsend-retry'), peerAvailable ? value.stage === 'rejected' || success ? t('Renvoyer') : t('Réessayer') : t('Rechercher'));
    byId('localsend-retry').disabled = nearbyBusy || !localSendContext.files.length;
    byId('localsend-close').hidden = ['consent','waiting','progress'].includes(value.stage);
    byId('localsend-close').setAttribute('aria-label', value.stage === 'progress' || value.stage === 'waiting' ? t('Revenir au panneau, le transfert continue') : t('Fermer le partage'));
    byId('localsend-cancel').disabled = !value.transfer || !['preparing','waiting','sending','receiving'].includes(value.transfer.status);
    byId('localsend-cancel').setAttribute('aria-label', receive ? t('Annuler la réception') : t('Annuler l’envoi'));
    byId('localsend-from-icon').setAttribute('href', receive ? '#localsend-icon-phone' : '#localsend-icon-pc');
    byId('localsend-to-icon').setAttribute('href', receive ? '#localsend-icon-pc' : '#localsend-icon-phone');
    text(byId('localsend-waiting-title'), value.transfer?.status === 'waiting' ? t('En attente d’acceptation') : t('Préparation des fichiers'));
    text(byId('localsend-waiting-detail'), value.transfer?.status === 'waiting' && value.alias ? t('{device} doit accepter la demande', {device: value.alias}) : t('Connexion à l’appareil sélectionné…'));
    text(byId('localsend-file-label'), localSendCount(value.count)); text(byId('localsend-peer-label'), value.alias);
    host.style.setProperty('--localsend-progress', String(value.progress / 100));
    byId('localsend-progress-bar').setAttribute('aria-valuenow', String(Math.round(value.progress)));
    text(byId('localsend-percent'), Math.round(value.progress) + ' %');
    text(byId('localsend-bytes'), localSendSize(value.transfer?.transferredBytes || 0) + ' / ' + localSendSize(value.bytes));
    const failure = success ? null : localizedLocalSendFailure(value);
    text(byId('localsend-result-title'), success ? receive ? t('Reçu') : t('Envoyé') : failure.title);
    text(byId('localsend-result-detail'), success ? localSendCount(value.count) + ' · ' + localSendSize(value.bytes) + (receive ? t(' · Étagère') : t(' vers ') + value.alias) : failure.detail);
    text(byId('localsend-result-help'), failure?.help || ''); byId('localsend-result-help').hidden = !failure?.help;
    text(byId('localsend-result-actions').querySelector('[data-localsend-command="close"]'), receive ? t('Fermer') : t('Terminé'));
    const chips = byId('localsend-file-chips'), chipKey = JSON.stringify(value.files.map(file => file.name));
    if (chips.dataset.files !== chipKey) {
      chips.replaceChildren(...value.files.slice(0, 3).map(file => {
        const chip = document.createElement('span'); chip.className = 'localsend-file-chip'; chip.title = file.name;
        const icon = document.createElementNS('http://www.w3.org/2000/svg','svg'); icon.setAttribute('viewBox','0 0 24 24'); icon.setAttribute('aria-hidden','true'); icon.innerHTML = '<path d="M7 3h7l5 5v13H7zM14 3v5h5"/>';
        const label = document.createElement('span'); label.textContent = file.name; chip.append(icon,label); return chip;
      }));
      if (value.files.length > 3) {const more = document.createElement('span'); more.className = 'localsend-file-chip'; more.textContent = '+' + (value.files.length - 3); chips.append(more);}
      chips.dataset.files = chipKey;
    }
    const peers = nearby.peers || [], devices = byId('localsend-devices'), peerKey = JSON.stringify([i18n.locale(), peers.map(peer => [peer.id,peer.alias,peer.deviceType])]);
    if (devices.dataset.peers !== peerKey) {
      devices.replaceChildren(...peers.map(peer => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'localsend-peer'; button.dataset.localsendPeer = peer.id; button.setAttribute('aria-label', t('Envoyer à {device}', {device: peer.alias}));
        const bubble = document.createElement('span'); bubble.className = 'localsend-device';
        const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('aria-hidden','true');
        const use = document.createElementNS('http://www.w3.org/2000/svg','use'); use.setAttribute('href', peer.deviceType === 'mobile' ? '#localsend-icon-phone' : '#localsend-icon-laptop'); svg.append(use); bubble.append(svg);
        const label = document.createElement('span'); label.textContent = peer.alias; label.title = peer.alias; button.append(bubble,label); return button;
      })); devices.dataset.peers = peerKey;
    }
    for (const button of devices.children) button.disabled = nearbyBusy || !value.files.length;
    devices.hidden = !peers.length; byId('localsend-discovery-help').hidden = !!peers.length || nearbyBusy;
    byId('localsend-discover').disabled = nearbyBusy;
    text(byId('localsend-discovery-label'), nearbyBusy ? t('Recherche d’appareils à proximité…') : peers.length ? t('Choisis un appareil à proximité') : nearby.available ? t('Aucun appareil pour le moment') : t('Lancer la recherche sur le réseau local'));
    host.dataset.scanning = String(nearby.available || nearbyBusy);
  }
  function openLocalSend(direction, files, source = 'shelf') {
    const incoming = direction === 'receive' ? files : null;
    const rows = incoming ? incoming.files : files;
    localSendContext = {direction, source, files: rows.map(file => ({id:file.id,name:file.name,size:file.size})), totalBytes: incoming?.totalBytes || rows.reduce((sum,file)=>sum+(file.size||0),0), incomingId:incoming?.id, alias:incoming?.alias || '', returnView:view === 'search' ? searchReturnView : view === 'localsend' ? 'tray' : view, previousId:nearby.transfer?.id || '', peerId:'', requested:false, error:''};
    selectViewButton({dataset:{view:'localsend'}}); setState('open');
    if (incoming) byId('shelf-incoming-accept').focus({preventScroll:true});
    else if (!nearby.available) void nearbyRequest({command:'discover'});
  }
  function closeLocalSend(toShelf = false) {
    const context = localSendContext, ongoing = ['waiting','progress'].includes(localSendPresentation()?.stage);
    selectViewButton({dataset:{view:toShelf ? 'tray' : context?.returnView || 'nook'}});
    if (!ongoing) localSendContext = null;
    if (!toShelf) setState('rest');
    renderLocalSend(); renderLiveActivities(); update();
  }
  async function localSendCommand(event) {
    const peer = event.target.closest('[data-localsend-peer]'), button = event.target.closest('[data-localsend-command],#shelf-incoming-accept,#shelf-incoming-reject');
    if (disposed || !localSendContext || (peer || button)?.disabled) return;
    if (button?.id === 'shelf-incoming-accept' || button?.id === 'shelf-incoming-reject') {await nearbyCommand({target:button}); if (button.id === 'shelf-incoming-reject' && !nearby.incoming) closeLocalSend(); return;}
    const command = button?.dataset.localsendCommand;
    if (command === 'close') {closeLocalSend(); return;}
    if (command === 'shelf') {closeLocalSend(true); return;}
    if (command === 'cancel') {const transfer = localSendPresentation()?.transfer; if (transfer) await nearbyRequest({command:'cancel',id:transfer.id}); return;}
    if (command === 'discover') {localSendContext.error=''; localSendContext.requested=false; localSendContext.previousId=nearby.transfer?.id || ''; await nearbyRequest({command:'discover'}); return;}
    if (!peer && command !== 'retry' || nearbyBusy) return;
    const context = localSendContext, peerId = peer?.dataset.localsendPeer || context.peerId;
    if (!nearby.peers?.some(item => item.id === peerId)) return;
    context.peerId = peerId; context.alias = nearby.peers.find(item => item.id === peerId).alias; context.requested = true; context.previousId = nearby.transfer?.id || ''; context.error='';
    const value = {command:'share',peerId,ids:context.files.map(file=>file.id)}; if (context.source === 'files') value.source='files';
    await nearbyRequest(value);
  }
  function renderNearby() {
    if (disposed) return;
    renderExperience();
    const peers = Array.isArray(nearby.peers) ? nearby.peers.filter(peer => peer && typeof peer.id === 'string' && peer.id.length <= 128 && typeof peer.alias === 'string') : [];
    if (!peers.some(peer => peer.id === nearbyPeer)) nearbyPeer = '';
    const host = byId('shelf-nearby-peers');
    const peerKey = JSON.stringify(peers.map(peer => [peer.id, peer.alias, peer.deviceType]));
    if (host.dataset.peers !== peerKey) host.replaceChildren(...peers.map(peer => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'nearby-peer'; button.dataset.nearbyPeer = peer.id; button.setAttribute('aria-pressed', String(nearbyPeer === peer.id));
      const icon = document.createElement('span'); icon.className = 'nearby-device'; icon.setAttribute('aria-hidden', 'true');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.innerHTML = peer.deviceType === 'mobile' ? '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M10 19h4"/>' : '<rect x="4" y="3" width="16" height="12" rx="1.5"/><path d="M2 19h20M9 15v4m6-4v4"/>'; icon.append(svg);
      const label = document.createElement('span'); label.textContent = peer.alias.slice(0, 120); button.append(icon, label); return button;
    }));
    host.dataset.peers = peerKey;
    for (const button of host.children) button.setAttribute('aria-pressed', String(button.dataset.nearbyPeer === nearbyPeer));
    const incoming = nearby.incoming;
    byId('shelf-incoming').hidden = !incoming; host.hidden = !!incoming; byId('shelf-nearby').querySelector('.shelf-nearby-hint').hidden = !!incoming;
    if (incoming) {
      text(byId('shelf-incoming-sender'), incoming.alias || t('Appareil LocalSend'));
      const files = incoming.files || [], size = localSendSize(incoming.totalBytes);
      text(byId('shelf-incoming-files'), t('veut envoyer ') + localSendCount(files.length) + ' · ' + size);
      byId('shelf-incoming-files').title = files.map(file => file.name).join('\n');
    }
    for (const id of ['shelf-incoming-accept', 'shelf-incoming-reject']) byId(id).disabled = nearbyBusy || !incoming;
    const transfer = nearby.transfer, ongoing = transfer && ['preparing', 'waiting', 'sending', 'receiving'].includes(transfer.status);
    const receiving = transfer?.direction === 'receive';
    shelfPlayer.dataset.incoming = String(!!incoming || receiving && ongoing);
    textUI(byId('shelf-nearby-status'), nearbyError || nearby.error || (incoming ? t('Proposition de réception') : ongoing ? `${receiving ? t('Réception') : t('Envoi')} · ${Math.round(transfer.progress || 0)} %` : transfer?.status === 'complete' ? receiving ? t('Fichiers reçus dans l’Étagère') : t('Envoi terminé') : transfer?.status === 'cancelled' ? t('Transfert annulé') : transfer?.error || (nearby.status === 'starting' ? t('Recherche…') : nearby.available ? peers.length ? t('Choisis un appareil') : t('Prêt à recevoir · aucun appareil pour le moment') : t('Ouvre LocalSend sur ton appareil, puis recherche.'))));
    const toggle = byId('shelf-nearby-toggle'); toggle.disabled = nearbyBusy; toggle.setAttribute('aria-label', nearby.available ? t('Arrêter la recherche LocalSend') : t('Rechercher des appareils LocalSend')); toggle.setAttribute('aria-pressed', String(!!nearby.available));
    byId('shelf-transfer-cancel').hidden = !ongoing;
    text(byId('shelf-transfer-cancel'), receiving ? t('Annuler la réception') : t('Annuler l’envoi'));
    byId('shelf-share').disabled = shelfBusy || nearbyBusy || !selectedFiles.size;
    renderLocalSend(); renderHomeSummaries();
  }
  async function readNearby() {
    if (disposed || nearbyReading) return;
    nearbyReading = true;
    const mutation = nearbyMutation;
    try {
      const response = await window.fetch('/api/nearby'), value = await response.json();
      if (!response.ok) throw new Error(value.error || t('Partage indisponible.'));
      if (!disposed && mutation === nearbyMutation) {
        if (!nearbyLoaded && value.transfer?.direction === 'receive' && value.transfer.status === 'complete') nearbyReceiveCompleted = value.transfer.id;
        nearbyLoaded = true; nearby = value; if (!nearbyActionError) nearbyError = ''; renderNearby();
        scenarioController?.observe();
        if (value.incoming && value.incoming.id !== nearbyIncomingShown && !protectedInteraction()) {
          nearbyIncomingShown = value.incoming.id; openLocalSend('receive', value.incoming);
        }
        if (value.transfer?.direction === 'receive' && value.transfer.status === 'complete' && value.transfer.id !== nearbyReceiveCompleted) {
          nearbyReceiveCompleted = value.transfer.id; shelfLoaded = false; if (builtinVisible('shelf') || view === 'nook' && getHomeSlots().includes('shelf')) void loadShelf();
          notifyModuleChange({id: 'shelf', kind: 'received', transferId: value.transfer.id, title: value.transfer.fileCount > 1 ? t('Fichiers reçus') : t('Fichier reçu'), detail: value.transfer.alias || t('Dans l’Étagère')});
        }
        renderLiveActivities(); update();
      }
    } catch (error) { if (!disposed) { nearbyError = error.message || t('Partage indisponible.'); renderNearby(); } }
    finally { nearbyReading = false; if (!nearbyTimer && nearby.available && !disposed && !document.hidden) nearbyLifecycle(); }
  }
  function nearbyLifecycle() {
    window.clearTimeout(nearbyTimer); nearbyTimer = 0;
    if (disposed || document.hidden || !nearby.available && (state !== 'open' || !builtinVisible('shelf') || shelfPlayer.closest('.home-main'))) return;
    void readNearby(); nearbyTimer = window.setTimeout(nearbyLifecycle, 1500);
  }
  async function nearbyCommand(event) {
    const peer = event.target.closest('[data-nearby-peer]');
    if (peer) { nearbyPeer = peer.dataset.nearbyPeer; renderNearby(); return; }
    const button = event.target.closest('#shelf-share,#shelf-nearby-toggle,#shelf-transfer-cancel,#shelf-incoming-accept,#shelf-incoming-reject');
    if (!button || button.disabled || nearbyBusy && button.id !== 'shelf-transfer-cancel' || disposed) return;
    if (button.id === 'shelf-share') {openLocalSend('send', shelfItems.filter(item=>selectedFiles.has(item.id))); return;}
    const value = button.id === 'shelf-incoming-accept' || button.id === 'shelf-incoming-reject' ? {command: button.id === 'shelf-incoming-accept' ? 'accept' : 'reject', id: nearby.incoming?.id} : button.id === 'shelf-transfer-cancel' ? {command: 'cancel', id: nearby.transfer?.id} : button.id === 'shelf-share' ? {command: 'share', peerId: nearbyPeer, ids: [...selectedFiles]} : {command: nearby.available ? 'stop' : 'discover'};
    await nearbyRequest(value);
  }
  async function nearbyRequest(value) {
    const mutation = ++nearbyMutation;
    nearbyBusy = true; nearbyError = ''; nearbyActionError = false; renderNearby(); nearbyLifecycle();
    try {
      const response = await window.fetch('/api/nearby', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Notchy': '1'}, body: JSON.stringify(value)}), data = await response.json();
      if (disposed || mutation !== nearbyMutation) return;
      nearby = data;
      if (!response.ok || data.error) throw new Error(data.error || data.transfer?.error || t('Cette action est indisponible.'));
      if (value.command === 'share' && data.transfer?.status === 'complete') notifyModuleChange({id: value.source === 'files' ? 'files' : 'shelf', kind: 'sent', transferId: data.transfer.id, title: value.ids.length > 1 ? t('Fichiers envoyés') : t('Fichier envoyé'), detail: data.transfer.alias || t('Transfert terminé')});
    } catch (error) { if (!disposed && mutation === nearbyMutation) {nearbyActionError = true; nearbyError = error.message || t('Partage indisponible.'); if(localSendContext) localSendContext.error=nearbyError;} }
    finally { if (!disposed && mutation === nearbyMutation) { nearbyBusy = false; renderNearby(); renderLiveActivities(); update(); nearbyLifecycle(); } }
  }

  const filePlayer = byId('file-player'), fileInput = byId('file-input');
  let fileItems = [], fileIndex = 0, fileMode = 'actions', fileBusy = false, fileSending = false, fileSendPreviousTransferId = '', filePeersReading = false, fileError = '', fileJob = {status: 'idle'}, filePoll = 0, fileEpoch = 0;
  function activeFileTransfer() { const transfer = nearby.transfer; return fileSending && transfer?.id && transfer.id !== fileSendPreviousTransferId && ['preparing', 'waiting', 'sending', 'receiving'].includes(transfer.status) ? transfer : null; }
  function currentFile() { return fileItems[fileIndex] || null; }
  function acceptedFile(item, source = 'files') {
    if (!item || !/^[a-f0-9]{32}$/.test(item.id) || typeof item.name !== 'string' || !Number.isSafeInteger(item.size) || item.size < 0) throw new Error('Ce fichier est indisponible.');
    const extension = item.name.split('.').pop().toLowerCase();
    const image = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'svg'].includes(extension);
    const preview = source === 'shelf' ? `/api/shelf/${item.id}?preview=1` : `/api/files/input/${item.id}?preview=1`;
    return {id: item.id, name: item.name.slice(0, 260), size: item.size, source, image, pdf: extension === 'pdf', toolsAvailable: item.size <= 25 * 1024 * 1024, preview: item.thumbnail === preview ? preview : null};
  }
  async function fileRequest(url, options) {
    const response = await window.fetch(url, options), result = await response.json();
    if (!response.ok || result.ok === false) throw new Error(result.error || t('Cette action est indisponible.'));
    return result;
  }
  const filePost = (url, value) => fileRequest(url, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Notchy': '1'}, body: JSON.stringify(value)});
  function renderFiles() {
    if (disposed) return;
    if (view === 'nook' && !getModuleEditorActive()) {
      const compact = homeModuleLayout(getHomeSlots(), 0, 16, homeModuleContext()).items.find(item => item.id === 'files')?.compact;
      const showingSummary = !!homeCells.get('files')?.querySelector('[data-module-open]');
      if (compact !== undefined && compact !== showingSummary) renderHomeLayout();
    }
    filePlayer.hidden = !builtinVisible('files');
    const item = currentFile(), running = fileJob.status === 'running';
    byId('file-content').dataset.mode = fileMode;
    if (state !== 'open' || !filePlayer.hidden && !getModuleEditorActive()) update();
    byId('file-empty').hidden = !!item; byId('file-content').hidden = !item;
    textUI(byId('file-status'), fileError || (fileBusy && !item ? t('Préparation du fichier…') : fileBusy && fileMode === 'peers' ? t('Envoi du fichier…') : item && !item.toolsAvailable && (item.image || item.pdf) ? t('LocalSend reste disponible. OCR et conversion : 25 Mo maximum.') : ''));
    byId('file-empty').querySelector('button').disabled = fileBusy;
    if (!item) return;
    text(byId('file-name'), item.name); byId('file-name').title = item.name;
    text(byId('file-meta'), `${item.size >= 1048576 ? (item.size / 1048576).toFixed(1) + ' ' + t('Mo') : Math.ceil(item.size / 1024) + ' ' + t('Ko')}${fileItems.length > 1 ? ` · ${fileIndex + 1}/${fileItems.length}` : ''}${item.source === 'shelf' ? t(' · gardé') : ''}`);
    const image = byId('file-preview');
    byId('file-switcher').hidden = fileItems.length < 2;
    if (item.preview && image.getAttribute('src') !== item.preview) { image.src = item.preview; image.hidden = false; }
    else if (!item.preview) { image.removeAttribute('src'); image.hidden = true; }
    byId('file-placeholder').toggleAttribute('hidden', !image.hidden);
    byId('file-actions').hidden = fileMode !== 'actions';
    byId('file-preview-panel').hidden = fileMode !== 'preview';
    const largePreview = byId('file-image-preview');
    largePreview.onerror = () => { if (!disposed && fileMode === 'preview') { fileMode = 'actions'; fileError = t('L’aperçu de cette image est indisponible.'); renderFiles(); } };
    if (fileMode === 'preview' && item.preview) { if (largePreview.getAttribute('src') !== item.preview) largePreview.src = item.preview; largePreview.alt = item.name; }
    else largePreview.removeAttribute('src');
    byId('file-formats').hidden = fileMode !== 'formats'; byId('file-processing').hidden = fileMode !== 'processing';
    byId('file-result').hidden = fileMode !== 'ocr'; byId('file-complete').hidden = fileMode !== 'complete'; byId('file-peers').hidden = fileMode !== 'peers';
    for (const button of filePlayer.querySelectorAll('[data-file-command], [data-file-format]')) {
      const command = button.dataset.fileCommand;
      button.disabled = command === 'cancel' ? !running : command === 'cancel-send' ? !activeFileTransfer() : fileBusy || running && command !== 'clear';
      if (command === 'ocr') { button.disabled ||= !(item.image || item.pdf) || !item.toolsAvailable; button.title = !item.toolsAvailable ? t('OCR : 25 Mo maximum. Le partage LocalSend reste disponible.') : ''; }
      if (command === 'formats') { button.disabled ||= !item.image || !item.toolsAvailable; button.title = !item.toolsAvailable ? t('Conversion : 25 Mo maximum. Le partage LocalSend reste disponible.') : ''; }
      if (command === 'keep') button.disabled ||= item.source === 'shelf';
    }
    textUI(byId('file-processing-label'), fileJob.progress?.label || (fileJob.command === 'ocr' ? fileJob.stage === 'pdf-text' ? t('Lecture du PDF…') : t('Reconnaissance du texte…') : t('Conversion…')));
    if (fileMode === 'ocr' && byId('file-text').dataset.job !== fileJob.jobId) {
      byId('file-text').value = typeof fileJob.text === 'string' ? fileJob.text : ''; byId('file-text').dataset.job = fileJob.jobId; byId('file-text').readOnly = true;
    }
    if (fileMode === 'complete' && fileJob.result) {
      text(byId('file-complete-name'), fileJob.result.name || t('Fichier prêt'));
      const link = byId('file-download'); link.hidden = !/^\/api\/shelf\/[a-f0-9]{32}$/.test(fileJob.result.download || '');
      if (!link.hidden) { link.href = fileJob.result.download; link.download = fileJob.result.name; }
      if (fileJob.result.rasterEmbedded) textUI(byId('file-status'), t('Le SVG contient l’image ; il ne s’agit pas d’une vectorisation.'));
    }
    byId('file-send-cancel').hidden = !activeFileTransfer();
    if (fileMode === 'peers') renderFilePeers();
  }
  function renderFilePeers() {
    const host = byId('file-peer-list'), peers = Array.isArray(nearby.peers) ? nearby.peers : [];
    const key = JSON.stringify(peers.map(peer => [peer.id, peer.alias]));
    if (host.dataset.peers !== key) {
      host.dataset.peers = key;
      host.replaceChildren(...peers.filter(peer => typeof peer.id === 'string' && typeof peer.alias === 'string').map(peer => { const button = document.createElement('button'); button.type = 'button'; button.dataset.filePeer = peer.id; button.textContent = peer.alias.slice(0, 120); button.disabled = fileBusy; return button; }));
    }
    for (const button of host.children) button.disabled = fileBusy;
    if (!peers.length) textUI(byId('file-status'), fileError || nearby.error || t('Ouvre LocalSend sur ton appareil, puis recherche.'));
  }
  async function pollFileJob() {
    window.clearTimeout(filePoll); filePoll = 0;
    if (disposed || document.hidden || fileJob.status !== 'running') return;
    const epoch = fileEpoch;
    try {
      const job = await fileRequest('/api/files/tool');
      if (disposed || epoch !== fileEpoch || job.jobId !== fileJob.jobId || job.source && job.source.id !== currentFile()?.id) return;
      const previous = fileJob.status; fileJob = job; observeModuleActivity('files', job);
      if (job.status === 'complete' && previous !== 'complete') {
        fileMode = job.command === 'ocr' ? 'ocr' : 'complete'; fileError = ''; shelfLoaded = false; renderHomeSummaries();
      } else if (job.status === 'error') { fileMode = 'actions'; fileError = job.error || t('Le traitement a échoué.'); }
      else if (job.status === 'cancelled') { fileMode = 'actions'; fileError = t('Traitement annulé.'); }
      renderFiles();
      if (job.status === 'running') filePoll = window.setTimeout(pollFileJob, 500);
    } catch (error) { if (!disposed && epoch === fileEpoch) { fileError = error.message; renderFiles(); if (fileJob.status === 'running') filePoll = window.setTimeout(pollFileJob, 1000); } }
  }
  function filesLifecycle() {
    window.clearTimeout(filePoll); filePoll = 0;
    if (!disposed && !document.hidden && fileJob.status === 'running') void pollFileJob();
    else if (!disposed && !document.hidden && state === 'open' && builtinVisible('files') && fileMode === 'peers') void filePeersPoll();
  }
  async function stageFiles(files) {
    if (disposed || fileBusy || !files.length) return;
    if (files.length > 20) { fileError = t('20 fichiers maximum à la fois.'); selectViewButton({dataset: {view: 'files'}}); setState('open'); renderFiles(); return; }
    fileBusy = true; fileError = ''; selectViewButton({dataset: {view: 'files'}}); setState('open'); renderFiles();
    const added = [], epoch = ++fileEpoch;
    try {
      for (const file of files) {
        const value = await fileRequest('/api/files/input?name=' + encodeURIComponent(file.name), {method: 'POST', headers: {'Content-Type': 'application/octet-stream', 'X-Notchy': '1'}, body: file});
        if (disposed || epoch !== fileEpoch) return;
        added.push(acceptedFile(value.item));
      }
      fileItems.push(...added); fileIndex = fileItems.length - added.length; fileMode = 'actions'; fileJob = {status: 'idle'};
    } catch (error) { if (!disposed && epoch === fileEpoch) { fileItems.push(...added); if (added.length) fileIndex = fileItems.length - added.length; fileError = error.message; } }
    finally { if (!disposed && epoch === fileEpoch) { fileBusy = false; fileInput.value = ''; renderFiles(); } }
  }
  async function fileCommand(event) {
    const button = event.target.closest('[data-file-command],[data-file-format],[data-file-peer]');
    if (!button || button.disabled || disposed) return;
    const command = button.dataset.fileCommand, item = currentFile();
    if (command === 'choose') { showFileChooser(fileInput); return; }
    if (!item) return;
    if (command === 'download-result') {event.preventDefault?.(); const id=fileJob.result?.download?.match(/^\/api\/shelf\/([a-f0-9]{32})$/)?.[1]; if (id) await downloadShelfFiles([{id,name:fileJob.result.name || item.name}]); return;}
    if (command === 'formats') { fileMode = 'formats'; renderFiles(); return; }
    if (command === 'previous-file' || command === 'next-file') { fileIndex = (fileIndex + (command === 'next-file' ? 1 : fileItems.length - 1)) % fileItems.length; fileMode = 'actions'; fileJob = {status: 'idle'}; fileError = ''; renderFiles(); return; }
    if (command === 'back') { fileMode = 'actions'; fileError = ''; renderFiles(); return; }
    if (command === 'edit') { byId('file-text').readOnly = false; byId('file-text').focus(); return; }
    if (command === 'send') { fileMode = 'peers'; renderFiles(); openLocalSend('send', [item], item.source); return; }
    if (fileBusy && command !== 'cancel' && command !== 'cancel-send') return;
    fileBusy = true; fileError = ''; renderFiles();
    try {
      if (command === 'copy') {
        const value = byId('file-text').value;
        if (desktop) { const result = await desktop.copyText(value); if (!result?.ok) throw new Error(t('Le texte ne peut pas être copié.')); }
        else await window.navigator.clipboard.writeText(value);
        fileError = t('Texte copié.');
        renderCopyFeedback(button,true); gestureFeedback(button,'copy',1600);
        notifyModuleChange({id:'files',kind:'kept',title:t('Copié'),detail:'',compact:true});
      } else if (command === 'keep') {
        const value = await filePost('/api/files/keep', {id: item.id});
        fileItems[fileIndex] = acceptedFile(value.item, 'shelf'); setShelf(value); fileError = t('Gardé dans l’Étagère.');
        notifyModuleChange({id: 'files', kind: 'kept', title: t('Fichier gardé'), detail: item.name});
        try { await fileRequest('/api/files/input/' + item.id, {method: 'DELETE', headers: {'X-Notchy': '1'}}); } catch {}
      } else if (command === 'clear') {
        if (fileJob.status === 'running') await filePost('/api/files/tool/cancel', {jobId: fileJob.jobId});
        if (item.source === 'files') await fileRequest('/api/files/input/' + item.id, {method: 'DELETE', headers: {'X-Notchy': '1'}});
        fileEpoch++; fileItems.splice(fileIndex, 1); fileIndex = Math.max(0, fileIndex - 1); fileMode = 'actions'; fileJob = {status: 'idle'};
      } else if (command === 'cancel') {
        fileJob = await filePost('/api/files/tool/cancel', {jobId: fileJob.jobId}); fileMode = 'actions'; fileError = t('Traitement annulé.');
      } else if (command === 'cancel-send') {
        const transfer = activeFileTransfer(); if (!transfer) return;
        nearby = await filePost('/api/nearby', {command: 'cancel', id: transfer.id}); fileError = t('Envoi annulé.'); renderNearby();
      } else if (command === 'save') {
        const value = await filePost('/api/files/tool/save', {jobId: fileJob.jobId, text: byId('file-text').value});
        fileJob.result = value.result || value.item && {id: value.item.id, name: value.item.name, download: '/api/shelf/' + value.item.id};
        fileMode = 'complete'; shelfLoaded = false;
      } else if (command === 'discover') {
        nearby = await filePost('/api/nearby', {command: 'discover'}); renderNearby();
        window.clearTimeout(filePoll); filePoll = window.setTimeout(filePeersPoll, 1000);
      } else if (button.dataset.filePeer) {
        fileSendPreviousTransferId = nearby.transfer?.id || ''; fileSending = true; renderFiles(); void filePeersPoll();
        const value = {command: 'share', peerId: button.dataset.filePeer, ids: [item.id]}; if (item.source === 'files') value.source = 'files';
        nearby = await filePost('/api/nearby', value); if (nearby.transfer?.error) throw new Error(nearby.transfer.error); fileError = nearby.transfer?.status === 'cancelled' ? t('Envoi annulé.') : nearby.transfer?.status === 'complete' ? t('Fichier envoyé.') : t('Envoi en cours…'); renderNearby();
        if (nearby.transfer?.status === 'complete') notifyModuleChange({id: 'files', kind: 'sent', transferId: nearby.transfer.id, title: t('Fichier envoyé'), detail: item.name});
      } else if (command === 'ocr' || button.dataset.fileFormat) {
        fileJob = await filePost('/api/files/tool', {id: item.id, command: command === 'ocr' ? 'ocr' : 'convert', ...(button.dataset.fileFormat ? {format: button.dataset.fileFormat} : {})});
        moduleActivityStates.set('files', moduleActivitySnapshot('files', {...fileJob, status: 'running'}));
        if (fileJob.status === 'complete') { observeModuleActivity('files', fileJob); fileMode = fileJob.command === 'ocr' ? 'ocr' : 'complete'; shelfLoaded = false; }
        else {
        fileMode = 'processing'; void pollFileJob();
        }
      }
    } catch (error) { if (!disposed) {fileError = error.message || t('Cette action a échoué.'); if (command === 'copy') {const previous=gestureTimers.get(button); if (previous) window.clearTimeout(previous.timer); gestureTimers.delete(button); button.classList.remove('experience-copy-done'); renderCopyFeedback(button,false);}} }
    finally { if (!disposed) { if (button.dataset.filePeer) { fileSending = false; fileSendPreviousTransferId = ''; } fileBusy = fileSending; renderFiles(); } }
  }
  async function filePeersPoll() {
    window.clearTimeout(filePoll); filePoll = 0;
    if (disposed || filePeersReading || document.hidden || fileMode !== 'peers' || !builtinVisible('files') || state !== 'open') return;
    filePeersReading = true; try { await readNearby(); } finally { filePeersReading = false; }
    if (!disposed && !document.hidden && fileMode === 'peers' && builtinVisible('files') && state === 'open') { renderFiles(); filePoll = window.setTimeout(filePeersPoll, 1500); }
  }
  function fileInputChanged() { closeFileChooser(); void stageFiles([...fileInput.files]); }
  function filePreviewError() { byId('file-preview').hidden = true; byId('file-placeholder').removeAttribute('hidden'); }
  function shelfSelectionItem() { return selectedFiles.size === 1 ? shelfItems.find(item => selectedFiles.has(item.id)) || null : null; }
  function selectShelfFile(item, mode = 'actions') {
    if (!item || disposed || fileBusy || fileJob.status === 'running') return false;
    fileItems = [acceptedFile(item, 'shelf')]; fileIndex = 0; fileMode = mode; fileJob = {status: 'idle'}; fileError = '';
    selectViewButton({dataset: {view: 'files'}}); setState('open'); renderFiles(); return true;
  }
  function openShelfFile(event) {
    const id = event.target.closest('[data-shelf-id]')?.dataset.shelfId;
    selectShelfFile(shelfItems.find(item => item.id === id));
  }
  async function downloadShelfFiles(items) {
    if (!items.length || shelfBusy) return false;
    if (typeof desktop?.exportShelfItems === 'function') {
      shelfBusy = true; shelfError = ''; shelfDownloadError = false; syncShelfSelection();
      try {
        const result = await desktop.exportShelfItems(items.map(item=>item.id));
        if (!result?.ok) throw new Error(result?.error || t('Le téléchargement a échoué.'));
        if (disposed) return false;
        shelfError = t('{count} fichier(s) enregistré(s) dans Téléchargements.',{count:result.saved.length});
        if (view === 'files') {fileError=shelfError; renderFiles();}
        notifyModuleChange({id:'shelf',kind:'kept',title:t('Enregistré dans Téléchargements'),detail:'',compact:true});
        return true;
      } catch (error) {
        if (!disposed) {shelfDownloadError=true; shelfError=error.message || t('Le téléchargement a échoué.'); if (view === 'files') {fileError=shelfError; renderFiles();}}
        return false;
      } finally {if (!disposed) {shelfBusy=false; syncShelfSelection(); textUI(byId('shelf-status'),shelfError);}}
    }
    for (const item of items) { const link = document.createElement('a'); link.href = '/api/shelf/' + item.id; link.download = item.name; document.body.append(link); link.click(); link.remove(); }
    return true;
  }
  async function shelfFileAction(command, item) {
    if (!item || disposed) return;
    const file = acceptedFile(item, 'shelf');
    if (command === 'open' || command === 'reveal') {
      const nativeAction = command === 'reveal' ? desktop?.revealShelfItem : desktop?.openShelfItem;
      if (typeof nativeAction === 'function') {
        shelfBusy = true; shelfError = ''; syncShelfSelection();
        try { const result = await nativeAction(item.id); if (!result?.ok) throw new Error(result?.error || t('Le fichier ne peut pas être ouvert.')); if (!disposed) shelfError = command === 'reveal' ? t('Copie affichée dans son dossier Windows.') : t('Copie ouverte dans Windows.'); }
        catch (error) { if (!disposed) shelfError = error.message || t('Le fichier ne peut pas être ouvert.'); }
        finally { if (!disposed) { shelfBusy = false; textUI(byId('shelf-status'), shelfError); syncShelfSelection(); } }
      } else if (command === 'reveal') return;
      else if (file.preview) selectShelfFile(item, 'preview');
      else if (await downloadShelfFiles([item])) { shelfError = t('Copie téléchargée. Ouvre-la depuis tes téléchargements.'); textUI(byId('shelf-status'), shelfError); }
      return;
    }
    if (command === 'preview') { if (file.preview) selectShelfFile(item, 'preview'); return; }
    if (command === 'convert') { if (file.image) selectShelfFile(item, 'formats'); return; }
    if (command === 'ocr' && (file.image || file.pdf) && selectShelfFile(item)) await fileCommand({target: filePlayer.querySelector('[data-file-command="ocr"]')});
  }

  function syncShelfSelection() {
    renderExperience();
    shelfPlayer.dataset.hasSelection = String(selectedFiles.size > 0);
    const all = shelfItems.length > 0 && selectedFiles.size === shelfItems.length;
    const selectAll = byId('shelf-select-all');
    selectAll.disabled = shelfBusy || !shelfItems.length;
    selectAll.setAttribute('aria-pressed', String(all)); selectAll.setAttribute('aria-label', all ? t('Tout désélectionner') : t('Tout sélectionner'));
    text(byId('shelf-selection'), selectedFiles.size ? t(selectedFiles.size === 1 ? '{count} sélectionné' : '{count} sélectionnés', {count: selectedFiles.size}) : t('Aucun fichier sélectionné'));
    byId('shelf-download').disabled = shelfBusy || !selectedFiles.size; byId('shelf-remove').disabled = shelfBusy || !selectedFiles.size;
    byId('shelf-share').disabled = shelfBusy || nearbyBusy || !selectedFiles.size;
    const item = shelfSelectionItem(), file = item ? acceptedFile(item, 'shelf') : null, locked = shelfBusy || fileBusy || fileJob.status === 'running';
    shelfPlayer.dataset.singleSelection = String(!!item);
    byId('shelf-contextual').hidden = !item;
    byId('shelf-open').disabled = shelfBusy || !item;
    text(byId('shelf-open'), file && !file.image && !file.pdf ? t('Ouvrir le fichier') : t('Ouvrir'));
    byId('shelf-open').title = typeof desktop?.openShelfItem === 'function' ? t('Ouvrir dans l’application par défaut') : file?.preview ? t('Afficher l’aperçu') : t('Télécharger une copie pour l’ouvrir');
    byId('shelf-reveal').hidden = !item || typeof desktop?.revealShelfItem !== 'function'; byId('shelf-reveal').disabled = shelfBusy || !item;
    byId('shelf-preview').hidden = !file?.image; byId('shelf-preview').disabled = locked || !file?.preview;
    byId('shelf-preview').title = file?.preview ? t('Afficher l’image') : t('Aperçu indisponible pour ce format');
    byId('shelf-ocr').hidden = !(file?.image || file?.pdf); byId('shelf-ocr').disabled = locked || !(file?.image || file?.pdf) || !file?.toolsAvailable; byId('shelf-ocr').title = file && !file.toolsAvailable ? t('OCR : 25 Mo maximum. Le partage LocalSend reste disponible.') : '';
    byId('shelf-convert').hidden = !file?.image; byId('shelf-convert').disabled = locked || !file?.image || !file?.toolsAvailable; byId('shelf-convert').title = file && !file.toolsAvailable ? t('Conversion : 25 Mo maximum. Le partage LocalSend reste disponible.') : '';
    if (state === 'open' && view === 'tray' && !getModuleEditorActive()) update();
  }

  // Weather requests run only while the module or its summary is visible.
  const weatherPlayer = byId('weather-player'), weatherCityInput = byId('weather-city-input');
  let weather = {status: 'empty', mode: 'local', city: '', displayName: '', selectedCity: null, temperature: null, feelsLike: null, condition: '', icon: 'unknown', nextRain: null, rainRisk: null, error: null, stale: false};
  let weatherLoaded = false, weatherBusy = false, weatherSearchBusy = false, weatherPickerOpen = false, weatherAutomatic = false, weatherActive = false;
  let weatherError = '', weatherMessage = '', weatherLocations = [], weatherTimer = 0, weatherEpoch = 0, weatherSearchEpoch = 0, weatherController = null, weatherSearchController = null;
  function getWeatherState() { return JSON.parse(JSON.stringify({...weather, busy: weatherBusy, searchBusy: weatherSearchBusy})); }
  function localizedWeatherNarrative(snapshot) {
    const value = weatherNarrative(snapshot);
    const next = {...value};
    for (const name of ['when', 'rain', 'rainQualifier', 'horizon', 'status']) next[name] = uiMessage(value[name]);
    if (!(snapshot.displayName || snapshot.city || snapshot.selectedCity?.name) || snapshot.mode === 'local' && snapshot.displayName === 'Position actuelle') next.city = t(value.city);
    if (value.status === `Mise à jour indisponible — dernières données pour ${value.city}.`) next.status = t('Mise à jour indisponible — dernières données pour {city}.', {city: value.city});
    const previous = 'Prévision précédente · ';
    next.forecastDescription = value.forecastDescription.startsWith(previous) ? t(previous) + t(value.forecastDescription.slice(previous.length).replace('sur deux heures', 'dans les deux prochaines heures')).replace(t('dans les deux prochaines heures'), t('sur deux heures')) : t(value.forecastDescription);
    return next;
  }
  function isWeatherBusy() { return weatherBusy || weatherSearchBusy; }
  function getWeatherSummary() {
    const next = localizedWeatherNarrative({...weather, busy: weatherBusy});
    return {title: next.temperature + ' ' + next.when, detail: t('à ') + next.city, narrative: next};
  }
  function weatherFreshness(value, now = Date.now()) {
    const fetched = Number(value.fetchedAt || value.updatedAt || 0);
    if (!Number.isFinite(fetched) || fetched <= 0) return t('Mise à jour à vérifier');
    const minutes = Math.max(0, Math.floor((now - fetched) / 60000));
    return (value.stale ? t('Dernières données') + ' · ' : '') + (minutes < 1 ? t('Mis à jour à l’instant') : t('Mis à jour il y a {minutes} min', {minutes}));
  }
  function renderWeatherDesign(host, presentation, {interactive = false, calendarTodayCount = weather.calendarTodayCount} = {}) {
    const failure = (typeof weather.error === 'string' && weather.error) || (!weatherPickerOpen ? weatherError : '');
    const values = weatherDesignValues({...weather, calendarTodayCount}, presentation), next = localizedWeatherNarrative({...weather, busy: weatherBusy, error:failure || weather.error});
    const sharedFailure = !weatherBusy && !!failure && values.size !== 'rail' && !!window.NotchEmpty;
    const revealResult = host.dataset.state === 'loading' && next.state === 'ready' && !weatherError && !weather.error && !document.hidden && host.getClientRects().length > 0;
    const condition = t(weather.condition || 'Conditions indisponibles'), locale = i18n.locale() === 'en' ? 'en-GB' : 'fr-FR';
    const freshness = weatherFreshness(weather);
    const signature = JSON.stringify([values, next, condition, freshness, weather.icon, weather.isDay, locale, interactive, interactive && weatherPickerOpen, failure]);
    if (host.dataset.weatherDesign === signature) return;
    host.dataset.weatherDesign = signature; host.dataset.size = values.size; host.dataset.state = next.state;
    host.dataset.weatherView = interactive ? 'detail' : 'summary';
    const make = (className, value, tag = 'span') => {const node = document.createElement(tag); node.className = className; if (value !== undefined) node.textContent = value; return node;};
    if (!interactive) {
      const glyph = (className, path, viewBox = '0 0 24 24') => {const node = byId('weather-condition-icon').cloneNode(true); node.removeAttribute('id'); node.setAttribute('class', className); node.setAttribute('viewBox', viewBox); node.setAttribute('aria-hidden', 'true'); node.setAttribute('focusable', 'false'); node.querySelector('path').setAttribute('d', path); return node;};
      const today = new Date(values.date + 'T12:00:00'), fullDate = new Intl.DateTimeFormat(locale, {dateStyle:'full'}).format(today);
      const stack = make('weather-typography'), weekday = make('weather-typography-line weather-typography-weekday');
      weekday.append(make('', new Intl.DateTimeFormat(locale, {weekday:'long'}).format(today)), glyph('weather-typography-sky', weatherConditionPath(weather.icon)));
      const calendar = make('weather-typography-line weather-typography-date', undefined, 'button'); calendar.type = 'button'; calendar.dataset.weatherCommand = 'calendar'; calendar.dataset.hasEvents = String(values.calendarTodayCount !== null && values.calendarTodayCount > 0);
      calendar.setAttribute('aria-haspopup', 'dialog'); calendar.setAttribute('aria-controls', 'calendar-player'); calendar.setAttribute('aria-expanded', 'false');
      const appointments = values.calendarTodayCount > 0 ? t(values.calendarTodayCount === 1 ? '1 rendez-vous aujourd’hui' : '{count} rendez-vous aujourd’hui', {count:values.calendarTodayCount}) : '';
      calendar.setAttribute('aria-label', t('Ouvrir l’agenda · {date}', {date:fullDate}) + (appointments ? ' · ' + appointments : '')); calendar.title = appointments || fullDate;
      calendar.append(glyph('weather-typography-calendar', 'M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2ZM7 2v4M17 2v4M3 9h18M7 13h1m4 0h1m4 0h1M7 17h1m4 0h1m4 0h1'), make('', new Intl.DateTimeFormat(locale, {day:'numeric',month:'long'}).format(today)));
      const city = make('weather-typography-line weather-typography-city weather-design-city', next.city, 'button'); city.type = 'button'; city.dataset.weatherCommand = 'details'; city.setAttribute('aria-label', t('Voir la météo à {city}', {city:next.city})); city.title = next.city;
      const degrees = make('weather-typography-line weather-typography-degrees'); degrees.setAttribute('aria-label', t('Température en degrés Celsius et Fahrenheit'));
      degrees.append(make('weather-design-temperature', values.celsius === null ? '—°C' : values.celsius + '°C'), glyph('weather-typography-thermometer', 'M9 5a3 3 0 0 1 6 0v9.5a5 5 0 1 1-6 0ZM12 8v10M12 18h.01', '5 0 14 26'), make('weather-typography-fahrenheit', values.fahrenheit === null ? '—°F' : values.fahrenheit + '°F'));
      const description = make('weather-typography-line weather-typography-condition weather-design-condition'); description.title = condition;
      description.append(make('weather-typography-condition-label', condition), glyph('weather-typography-cloud', weatherConditionPath('cloud')));
      const fresh = make('weather-design-freshness', freshness); fresh.hidden = true;
      stack.append(weekday, calendar, city, degrees, description); host.replaceChildren(stack, fresh);
      host.dataset.condition = weather.icon || 'unknown'; host.dataset.day = String(weather.isDay !== false); host.dataset.calendarKnown = String(values.calendarTodayCount !== null); host.setAttribute('aria-busy', String(weatherBusy)); host.title = freshness;
      if (revealResult) stack.classList.add('experience-weather-result');
      return;
    }
    const heading = make('weather-design-heading'), icon = byId('weather-condition-icon').cloneNode(true); icon.removeAttribute('id');
    icon.querySelector('path').setAttribute('d', weatherConditionPath(weather.icon));
    const city = make('weather-design-city', next.city + (values.size === 'rail' ? '' : ' · ' + t(weather.isDay === false ? 'CE SOIR' : 'AUJOURD’HUI')));
    const picker = make('weather-design-picker', t('Choisir une ville'), 'button'); picker.type = 'button'; picker.id = 'weather-city-button'; picker.dataset.weatherCommand = 'picker'; picker.setAttribute('aria-label', t('Changer de ville · {city}', {city: next.city})); picker.setAttribute('aria-expanded', String(weatherPickerOpen)); picker.setAttribute('aria-controls', 'weather-picker');
    if (values.size === 'rail') heading.append(make('weather-design-eyebrow',t('MÉTÉO')));
    if (values.size !== 'rail') heading.append(icon);
    heading.append(city);
    const reading = make('weather-design-reading'), temperature = make('weather-design-temperature', next.temperature), detail = make('weather-design-detail');
    const feels = make('weather-design-feels', t('Ressenti {temperature}', {temperature: next.feelsLike}));
    const range = [values.max !== null ? t('max {temperature}°', {temperature: values.max}) : '', values.size === 'full' && values.min !== null ? t('min {temperature}°', {temperature: values.min}) : ''].filter(Boolean).join(' · ');
    const meta = make('weather-design-meta'); meta.append(feels); if (range) meta.append(make('weather-design-range', range));
    const description = make('weather-design-condition', condition);
    if (values.size === 'rail') description.prepend(icon);
    detail.append(description, meta); reading.append(temperature, detail);
    const current = make('weather-design-current'); current.append(heading, picker, reading);
    const narrative = make('weather-design-narrative');
    const words = (value, emphasis = false) => narrative.append(make(emphasis ? 'weather-design-emphasis' : '', value, emphasis ? 'strong' : 'span'));
    if (values.narrative) {
      words(next.when + t(' à ')); words(next.city, true); words(t(', il fait ')); words(next.temperature, true); words(t(' et ')); words(condition.toLocaleLowerCase(locale), true); words('.');
      if (values.max !== null) {words(t(' Aujourd’hui, jusqu’à ')); words(values.max + '°', true);}
      if (values.rainRisk !== null) {words(t(values.max !== null ? ', avec ' : ' Avec ')); words(values.rainRisk + ' %', true); words(t(' de risque de précipitations.'));} else if (values.max !== null) words('.');
      if (values.size === 'full' && Number.isFinite(weather.feelsLike)) {words(t(' Ressenti ')); words(next.feelsLike, true); words('.');}
    }
    const outlook = make('weather-design-outlook'), hourly = make('weather-design-hourly'), hours = make('weather-design-hours'); hours.setAttribute('aria-label', t('Prochaines heures'));
    for (const hour of values.hours) {const chip = make('weather-design-hour'); chip.append(make('weather-design-hour-time', locale === 'fr-FR' ? hour.time.slice(11, 13) + ' h' : hour.time.slice(11, 16)), make('', hour.temperature + '°', 'strong')); hours.append(chip);}
    hourly.append(make('weather-design-caption', t('PROCHAINES HEURES')), hours); hourly.hidden = !values.hours.length;
    const daily = make('weather-design-daily'), days = make('weather-design-days'); days.setAttribute('aria-label', t('3 jours'));
    for (const day of values.days) {
      const chip = make('weather-design-day'); chip.append(make('weather-design-day-name', new Intl.DateTimeFormat(locale, {weekday: 'short', timeZone: 'UTC'}).format(new Date(day.date + 'T12:00:00Z'))), make('', day.max + '°', 'strong'), make('weather-design-day-min', day.min + '°'));
      days.append(chip);
    }
    daily.append(make('weather-design-caption', t('3 JOURS')), days); daily.hidden = !values.days.length;
    outlook.append(hourly, daily); outlook.hidden = !values.hours.length && !values.days.length;
    const empty = make('weather-design-empty', sharedFailure ? '' : next.status || t('Choisis une ville ou utilise ta position actuelle.')); empty.hidden = values.available && !sharedFailure;
    narrative.hidden = !values.narrative; reading.hidden = !values.available;
    host.setAttribute('aria-busy', String(weatherBusy));
    host.dataset.condition = weather.icon || 'unknown'; host.dataset.day = String(weather.isDay !== false);
    const fresh = make('weather-design-freshness', freshness); fresh.hidden = !values.available || sharedFailure;
    host.replaceChildren(current, narrative, outlook, empty, fresh);
    if (sharedFailure) {
      empty.classList.add('weather-design-error');
      const since = Number.isFinite(weather.fetchedAt) && weather.fetchedAt > 0 && weather.fetchedAt <= Date.now() ? weather.fetchedAt : null;
      const view = window.NotchEmpty.show(empty, {icon:icon.cloneNode(true),title:t('Météo indisponible'),hint:uiMessage(failure),actionLabel:t('Réessayer'),since,onAction(event) {
        event.stopPropagation(); weatherCommand(event);
        byId('weather-main').querySelector('.weather-tools [data-weather-command="refresh"]')?.focus({preventScroll:true});
      }});
      view.elements.action.dataset.weatherCommand = 'refresh';
    }
    if (revealResult) for (const node of [current, narrative, outlook]) if (!node.hidden) node.classList.add('experience-weather-result');
  }
  function renderWeatherSummary(button) {
    const next = localizedWeatherNarrative({...weather, busy: weatherBusy}), key = JSON.stringify(next);
    if (button.dataset.weatherNarrative === key) return;
    button.dataset.weatherNarrative = key; button.classList.add('home-weather-summary'); button.setAttribute('aria-label', t('Météo · {city}', {city: next.city}));
    const row = pairs => {
      const line = document.createElement('p'); line.className = 'weather-summary-line';
      for (const [value, emphasized] of pairs) { const word = document.createElement(emphasized ? 'strong' : 'span'); word.textContent = value; line.append(word); }
      return line;
    };
    const current = row([[next.temperature, true], [next.when, false]]), place = row([[t('à'), false], [next.city, true]]);
    const feels = row([[t('ressenti'), false], [next.feelsLike, true]]), forecast = row([[next.rain, true], [next.rainQualifier, false]]);
    if (next.rainIcon) { const icon = byId('weather-rain-icon').cloneNode(true); icon.removeAttribute('id'); icon.removeAttribute('hidden'); icon.classList.add('weather-summary-icon'); forecast.prepend(icon); }
    const horizon = document.createElement('small'); horizon.textContent = '· 2 h'; forecast.append(horizon); forecast.setAttribute('aria-label', next.forecastDescription);
    button.replaceChildren(current, place, feels, forecast);
  }
  function weatherVisible() {
    const slots = getModuleEditorActive() ? getModuleEditorSlots() : getHomeSlots();
    return !disposed && !document.hidden && state === 'open' && (view === 'weather' || view === 'nook' && slots.includes('weather'));
  }
  function weatherNaturalPanelHeight() {
    if (weatherPlayer.hidden || byId('weather-main').hidden || getModuleEditorActive()) return 0;
    const visibleChildren = parent => [...parent.children].filter(child => !child.hidden && child.getClientRects().length);
    const padding = node => { const style = getComputedStyle(node); return parseFloat(style.paddingTop) + parseFloat(style.paddingBottom); };
    const gap = node => parseFloat(getComputedStyle(node).rowGap) || 0;
    const main = byId('weather-main'), children = visibleChildren(main);
    let height = children.reduce((sum, child) => sum + child.getBoundingClientRect().height, 0) + Math.max(0, children.length - 1) * gap(main) + padding(main);
    const status = byId('weather-status');
    if (status.textContent && status.getClientRects().length) height += status.getBoundingClientRect().height + gap(weatherPlayer);
    height += padding(weatherPlayer);
    return Math.ceil(height);
  }
  function renderWeather() {
    weather.calendarTodayCount = calendar?.todayCount ?? null;
    if (disposed) return;
    weatherPlayer.hidden = !builtinVisible('weather');
    const next = localizedWeatherNarrative({...weather, busy: weatherBusy, error: weather.error || (!weatherPickerOpen ? weatherError : '')});
    const unavailable = !Number.isFinite(weather.temperature) && !!(weather.error || weatherError);
    byId('weather-main').dataset.empty = String(unavailable); byId('weather-empty').hidden = !unavailable;
    text(byId('weather-empty-title'), weatherBusy ? t('Actualisation de la météo…') : t('Météo indisponible'));
    textUI(byId('weather-empty-detail'), weatherBusy ? t('Connexion au service météo.') : weather.error || weatherError || t('Vérifie ta connexion ou choisis une ville.'));
    const picker = byId('weather-picker'), returnFocus = !picker.hidden && !weatherPickerOpen && picker.contains(document.activeElement);
    byId('weather-main').hidden = weatherPickerOpen; picker.hidden = !weatherPickerOpen;
    byId('weather-condition-icon').querySelector('path').setAttribute('d', weatherConditionPath(weather.icon));
    renderWeatherDesign(byId('weather-design'), weatherPlayer.dataset.presentation || 'full', {interactive: true});
    byId('weather-design').hidden = unavailable;
    if (returnFocus && !weatherPlayer.hidden && state === 'open') byId('weather-city-button').focus({preventScroll: true});
    byId('weather-rain-icon').dataset.kind = next.rain === t('pluie') ? 'rain' : 'precipitation';
    byId('weather-main').dataset.state = next.state; byId('weather-main').setAttribute('aria-busy', String(next.loading));
    const fetchedAt = Number.isFinite(weather.fetchedAt) && weather.fetchedAt > 0 && weather.fetchedAt <= Date.now() ? new Intl.DateTimeFormat(i18n.locale() === 'en' ? 'en-GB' : 'fr-FR', {hour: '2-digit', minute: '2-digit'}).format(new Date(weather.fetchedAt)) : '';
    const lastUpdate = next.state === 'stale' && fetchedAt ? t(' · Dernière mise à jour : ') + fetchedAt : '';
    text(byId('weather-status'), unavailable && !weatherPickerOpen ? '' : uiMessage(weatherBusy || weatherSearchBusy ? weatherMessage : weatherError || next.status) + lastUpdate);
    for (const button of weatherPlayer.querySelectorAll('[data-weather-command="locate"],[data-weather-command="refresh"]')) button.disabled = weatherBusy;
    weatherPlayer.querySelector('button[data-weather-command="search"]').disabled = weatherSearchBusy;
    if (typeof renderHomeSummaries === 'function') renderHomeSummaries();
    if (state === 'open' && !weatherPlayer.hidden && !getModuleEditorActive()) update();
  }
  async function weatherRequest(url, options, signal) {
    const response = await window.fetch(url, {...options, signal, cache: 'no-store'}), value = await response.json();
    if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : t('La météo est indisponible.'));
    return value;
  }
  async function loadWeather(command = null, location = null) {
    if (!weatherVisible()) return;
    weatherController?.abort(); const epoch = ++weatherEpoch, controller = new AbortController(); weatherController = controller;
    if (command === 'local') desktop?.setDialogOpen?.(true);
    weatherBusy = true; weatherError = ''; weatherMessage = command === 'local' ? t('Recherche de la position actuelle…') : t('Actualisation de la météo…'); renderWeather();
    try {
      const value = await weatherRequest('/api/weather', command ? {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Notchy': '1'}, body: JSON.stringify({command, ...(location ? {location} : {})})} : {}, controller.signal);
      if (disposed || epoch !== weatherEpoch || document.hidden) return;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(t('La météo est indisponible.'));
      weather = {...value, temperature: Number.isFinite(value.temperature) ? value.temperature : null, feelsLike: Number.isFinite(value.feelsLike) ? value.feelsLike : null}; weatherLoaded = true;
      if (!Number.isFinite(weather.temperature)) weatherPickerOpen = !weather.error && weather.status !== 'error';
      else if (command === 'select' || document.activeElement !== weatherCityInput) weatherPickerOpen = false;
    } catch (error) {
      if (epoch !== weatherEpoch || error.name === 'AbortError' || disposed) return;
      weatherError = error.message || t('La météo est indisponible.'); if (!Number.isFinite(weather.temperature)) weatherPickerOpen = false;
    } finally {
      if (command === 'local') desktop?.setDialogOpen?.(false);
      if (epoch === weatherEpoch && !disposed) { weatherBusy = false; weatherController = null; renderWeather(); }
    }
    if (!command && weather.selectedCity && weatherVisible() && !getModuleEditorActive() && (!Number.isFinite(weather.temperature) || Number.isFinite(weather.fetchedAt) && Date.now() - weather.fetchedAt > 900000)) { void loadWeather('refresh'); return; }
    if (!command && !weatherAutomatic && !getModuleEditorActive() && weatherVisible() && !weather.selectedCity && !Number.isFinite(weather.temperature)) {
      weatherAutomatic = true; void loadWeather('local');
    }
  }
  async function searchWeatherCity() {
    if (!weatherVisible() || weatherSearchBusy) return;
    const query = weatherCityInput.value.trim(); if (query.length < 2) { weatherError = t('Saisis au moins deux lettres.'); renderWeather(); return; }
    weatherSearchController?.abort(); const epoch = ++weatherSearchEpoch, controller = new AbortController(); weatherSearchController = controller;
    weatherSearchBusy = true; weatherError = ''; weatherMessage = t('Recherche des villes…'); renderWeather();
    try {
      const value = await weatherRequest('/api/weather/search?q=' + encodeURIComponent(query), {}, controller.signal);
      if (disposed || epoch !== weatherSearchEpoch || document.hidden) return;
      if (value.error) throw new Error(value.error);
      weatherLocations = Array.isArray(value.locations) ? value.locations.filter(location => location && typeof location.name === 'string' && Number.isFinite(location.latitude) && Math.abs(location.latitude) <= 90 && Number.isFinite(location.longitude) && Math.abs(location.longitude) <= 180).slice(0, 8) : [];
      byId('weather-search-results').replaceChildren(...weatherLocations.map((location, index) => {
        const button = document.createElement('button'), label = document.createElement('span'), detail = document.createElement('small');
        button.type = 'button'; button.dataset.weatherCommand = 'choose'; button.dataset.weatherResult = String(index); label.textContent = location.name; detail.textContent = [location.region, location.country].filter(Boolean).join(' · '); button.append(label, detail); return button;
      }));
      if (!weatherLocations.length) weatherError = t('Aucune ville trouvée.');
    } catch (error) { if (epoch === weatherSearchEpoch && error.name !== 'AbortError' && !disposed) weatherError = error.message || t('La recherche est indisponible.'); }
    finally { if (epoch === weatherSearchEpoch && !disposed) { weatherSearchBusy = false; weatherSearchController = null; renderWeather(); } }
  }
  function weatherCommand(event) {
    if (event.type === 'submit') { event.preventDefault(); if (!disposed && !document.hidden) void searchWeatherCity(); return; }
    const button = event.target.closest('[data-weather-command]'); if (!button || disposed || document.hidden) return;
    const command = button.dataset.weatherCommand;
    if (command === 'calendar') {event.preventDefault(); openCalendar(button);}
    else if (command === 'details') {event.preventDefault(); openActivityDetail('weather');}
    else if (command === 'search') { event.preventDefault(); void searchWeatherCity(); }
    else if (command === 'picker') { weatherPickerOpen = !weatherPickerOpen; renderWeather(); if (weatherPickerOpen) weatherCityInput.focus({preventScroll: true}); }
    else if (command === 'locate') { weatherAutomatic = true; void loadWeather('local'); }
    else if (command === 'refresh') void loadWeather('refresh');
    else if (command === 'choose') { const location = weatherLocations[Number(button.dataset.weatherResult)]; if (location) { weatherPickerOpen = false; void loadWeather('select', location); } }
  }
  function weatherInput(event) {
    if (event.target !== weatherCityInput) return;
    weatherSearchController?.abort(); weatherSearchController = null; weatherSearchEpoch++; weatherSearchBusy = false; weatherLocations = []; weatherError = ''; byId('weather-search-results').replaceChildren(); renderWeather();
  }
  function weatherLifecycle() {
    const active = weatherVisible();
    if (!active) {
      window.clearInterval(weatherTimer); weatherTimer = 0; weatherController?.abort(); weatherSearchController?.abort(); weatherController = weatherSearchController = null; weatherEpoch++; weatherSearchEpoch++; weatherBusy = weatherSearchBusy = false; weatherActive = false; return;
    }
    if (!weatherActive) { weatherActive = true; if (!weatherBusy) void loadWeather(); }
    if (!weatherTimer) weatherTimer = window.setInterval(() => { if (weatherVisible() && !getModuleEditorActive() && !weatherBusy && weatherLoaded) void loadWeather('refresh'); }, 900000);
    if (weatherLoaded && !weatherAutomatic && !weatherBusy && !weatherSearchBusy && !getModuleEditorActive() && !weather.selectedCity && !Number.isFinite(weather.temperature)) { weatherAutomatic = true; void loadWeather('local'); }
    renderWeather();
  }
  function disposeWeather() {
    weatherEpoch++; weatherSearchEpoch++; weatherController?.abort(); weatherSearchController?.abort(); window.clearInterval(weatherTimer); weatherTimer = 0; weatherBusy = weatherSearchBusy = weatherActive = false;
  }

  function renderShelf() {
    shelfPlayer.hidden = !builtinVisible('shelf');
    shelfPlayer.dataset.hasFiles = String(shelfItems.length > 0);
    const available = new Set(shelfItems.map(item => item.id));
    for (const id of selectedFiles) if (!available.has(id)) selectedFiles.delete(id);
    shelfList.replaceChildren();
    for (const item of shelfItems) {
      const card = document.createElement('div'); card.className = 'shelf-item'; card.dataset.shelfId = item.id; card.dataset.kind = item.kind;
      card.addEventListener('contextmenu', event => event.stopPropagation());
      const button = document.createElement('button'); button.type = 'button'; button.dataset.shelfCommand = 'select'; button.disabled = shelfBusy;
      button.setAttribute('aria-pressed', String(selectedFiles.has(item.id))); button.setAttribute('aria-label', t('Sélectionner {file}', {file: item.name}));
      const preview = document.createElement('span'); preview.className = 'shelf-preview';
      const icon = document.createElement('span'); icon.className = 'shelf-file-icon'; icon.setAttribute('aria-hidden', 'true');
      const extension = document.createElement('span'); extension.textContent = item.name.match(/\.([a-z0-9]{1,8})$/i)?.[1] || 'FILE';
      icon.append(shelfGlyph(item.kind), extension); preview.append(icon);
      if (item.thumbnail) { const image = document.createElement('img'); image.src = item.thumbnail; image.alt = ''; image.loading = 'lazy'; image.addEventListener('error', () => image.remove(), {once: true}); preview.append(image); }
      const check = document.createElement('span'); check.className = 'shelf-check'; check.setAttribute('aria-hidden', 'true'); check.append(shelfGlyph('check')); preview.append(check);
      const name = document.createElement('span'); name.className = 'shelf-item-name'; name.textContent = item.name; name.title = item.name;
      const size = document.createElement('span'); size.className = 'shelf-item-size'; size.textContent = item.size >= 1048576 ? (item.size / 1048576).toFixed(1) + ' ' + t('Mo') : Math.ceil(item.size / 1024) + ' ' + t('Ko');
      button.append(preview, name, size); card.append(button); shelfList.append(card);
    }
    byId('shelf-drop').hidden = shelfItems.length > 0;
    shelfList.hidden = shelfItems.length === 0;
    text(byId('shelf-count'), localSendCount(shelfItems.length));
    textUI(byId('shelf-status'), shelfError);
    byId('shelf-add').disabled = shelfBusy || shelfItems.length >= 20;
    byId('shelf-drop').disabled = shelfBusy || shelfItems.length >= 20;
    syncShelfSelection();
    renderActivitySceneValues();
  }

  function setShelf(value) {
    if (!value || !Array.isArray(value.items)) throw new Error(t('L’Étagère ne répond pas correctement.'));
    shelfItems = value.items.slice(0, 20).filter(item => item && /^[a-f0-9]{32}$/.test(item.id) && typeof item.name === 'string' && Number.isSafeInteger(item.size) && item.size >= 0).map(item => ({
      id: item.id, name: item.name.slice(0, 260), size: item.size,
      kind: ['document', 'image', 'archive', 'audio', 'video'].includes(item.kind) ? item.kind : 'file',
      thumbnail: typeof item.thumbnail === 'string' && item.thumbnail === `/api/shelf/${item.id}?preview=1` ? item.thumbnail : null,
    }));
    shelfLoaded = true;
    renderShelf(); renderHomeSummaries();
  }

  async function shelfRequest(url, options) {
    const response = await window.fetch(url, options);
    const value = await response.json();
    if (!response.ok || value.error) throw new Error(value.error || t('Cette action est indisponible.'));
    return value;
  }

  async function loadShelf() {
    if (disposed || shelfBusy) return;
    const epoch = ++shelfEpoch;
    shelfBusy = true; shelfError = ''; renderShelf();
    try { const value = await shelfRequest('/api/shelf'); if (!disposed && epoch === shelfEpoch) setShelf(value); }
    catch (error) { if (!disposed && epoch === shelfEpoch) shelfError = error.message; }
    finally { if (!disposed && epoch === shelfEpoch) { shelfBusy = false; renderShelf(); } }
  }

  async function uploadFiles(files) {
    if (disposed || shelfBusy || !files.length) return;
    if (files.length + shelfItems.length > 20) {
      shelfError = t('20 fichiers maximum dans l’Étagère.'); renderShelf(); return;
    }
    const epoch = ++shelfEpoch;
    shelfBusy = true; shelfError = '';
    selectViewButton(menuButtons.find(button => button.dataset.view === 'tray')); setState('open');
    renderShelf();
    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        textUI(byId('shelf-status'), t('Ajout {current} sur {total}…', {current: index + 1, total: files.length}));
        const value = await shelfRequest('/api/shelf?name=' + encodeURIComponent(file.name), {method: 'POST', headers: {'Content-Type': 'application/octet-stream', 'X-Notchy': '1'}, body: file});
        if (disposed || epoch !== shelfEpoch) return;
        setShelf(value);
      }
    } catch (error) { if (!disposed && epoch === shelfEpoch) shelfError = error.message; }
    finally { if (!disposed && epoch === shelfEpoch) { shelfBusy = false; shelfInput.value = ''; renderShelf(); } }
  }

  async function shelfCommand(event) {
    const button = event.target.closest('[data-shelf-command]');
    if (disposed || !button || button.disabled || shelfBusy) return;
    const command = button.dataset.shelfCommand;
    if (command === 'add') { showFileChooser(shelfInput); return; }
    const id = button.closest('[data-shelf-id]')?.dataset.shelfId;
    if (command === 'select' && id) {
      if (selectedFiles.has(id)) selectedFiles.delete(id); else selectedFiles.add(id);
      button.setAttribute('aria-pressed', String(selectedFiles.has(id)));
      syncShelfSelection(); return;
    }
    if (command === 'select-all') {
      if (selectedFiles.size === shelfItems.length) selectedFiles.clear(); else for (const item of shelfItems) selectedFiles.add(item.id);
      for (const card of shelfList.children) card.querySelector('button').setAttribute('aria-pressed', String(selectedFiles.has(card.dataset.shelfId)));
      syncShelfSelection(); return;
    }
    const items = shelfItems.filter(item => selectedFiles.has(item.id));
    if (['open', 'reveal', 'preview', 'ocr', 'convert'].includes(command)) { await shelfFileAction(command, shelfSelectionItem()); return; }
    if (command === 'download') {
      await downloadShelfFiles(items);
      return;
    }
    if (command !== 'remove') return;
    const epoch = ++shelfEpoch;
    shelfBusy = true; shelfError = ''; renderShelf();
    try {
      for (const item of items) {
        const value = await shelfRequest('/api/shelf/' + item.id, {method: 'DELETE', headers: {'X-Notchy': '1'}});
        if (disposed || epoch !== shelfEpoch) return;
        selectedFiles.delete(item.id); setShelf(value);
      }
    } catch (error) { if (!disposed && epoch === shelfEpoch) shelfError = error.message; }
    finally { if (!disposed && epoch === shelfEpoch) { shelfBusy = false; renderShelf(); } }
  }

  function shelfInputChanged() { closeFileChooser(); void uploadFiles([...shelfInput.files]); }
  function hasFiles(event) { return [...(event.dataTransfer?.types || [])].includes('Files'); }
  function nearNotch(event) { return notch.contains(event.target) || event.clientY <= 44 && Math.abs(event.clientX - window.innerWidth / 2) <= 150; }
  function clearFileDrag(restore = true) {
    dragDepth = 0;
    if (!fileDragging) return;
    fileDragging = false; notch.dataset.fileDrag = 'false'; fileDragCount = null;
    const previous = fileDragPreviousState; fileDragPreviousState = null; renderFileDropPreview();
    if (restore !== false && previous && previous !== state) setState(previous); else renderMusic();
    if (restore !== false && state === 'open' && view === 'tray' && !shelfLoaded && !shelfBusy) void loadShelf();
    scenarioController?.flush();
  }
  function fileDragEnter(event) { if (hasFiles(event)) dragDepth++; }
  function renderFileDropPreview() {
    byId('shelf-drag-preview').hidden = !fileDragging;
    if (!fileDragging) return;
    text(byId('shelf-drag-title'), fileDragCount ? t(fileDragCount === 1 ? 'Déposer {count} fichier' : 'Déposer {count} fichiers', {count: fileDragCount}) : t('Déposer des fichiers'));
    text(byId('shelf-drag-detail'), view === 'tray' ? t('Relâche pour les garder dans l’Étagère.') : t('Relâche pour garder, convertir ou partager.'));
  }
  function fileDragOver(event) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (!nearNotch(event)) { event.dataTransfer.dropEffect = 'none'; clearFileDrag(); return; }
    event.dataTransfer.dropEffect = 'copy';
    if (!fileDragging) fileDragPreviousState = state;
    fileDragging = true; fileDragCount = dragFileCount(event.dataTransfer); notch.dataset.fileDrag = 'true'; renderFileDropPreview();
    if (getModuleEditorActive()) closeModuleEditor(false);
    if (state !== 'open') setState('open'); else { renderLiveActivities(); update(); }
  }
  function fileDragLeave(event) { if (hasFiles(event)) { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) clearFileDrag(); } }
  function fileDrop(event) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (!nearNotch(event)) { clearFileDrag(); return; }
    const files = [...event.dataTransfer.files];
    const toShelf = state === 'open' && view === 'tray' && builtinVisible('shelf');
    clearFileDrag(false); if (toShelf) void uploadFiles(files); else void stageFiles(files);
  }

  function text(element, value) { if (element.textContent !== value) element.textContent = value; }
  function textUI(element, value) {text(element, uiMessage(value));}
  function languageChoice(event) {
    if (event.target.matches('[data-language-choice]')) i18n.setLocale(event.target.value);
  }
  function renderLanguage() {
    calendar?.refreshLocale();
    refreshCommunityDefinitions(); moduleLibrary?.refresh();
    for(const button of document.querySelectorAll('[data-module-library]')) button.textContent=t('Bibliothèque');
    for(const button of document.querySelectorAll('[data-module-library-empty]')) button.textContent=t('Bibliothèque de modules');
    if (disposed) return;
    renderStaticTranslations();
    search?.render(); renderSearchRoute();
    musicFavorite.setAttribute('aria-label', t('Les favoris ne sont pas partagés par le lecteur Windows')); musicFavorite.title = musicFavorite.getAttribute('aria-label');
    for (const choice of document.querySelectorAll('[data-language-choice]')) choice.value = i18n.locale();
    for (const item of Object.values(moduleDefinitions)) moduleLabels[item.id] = t(item.label);
    moduleMessage = '';
    renderAppearance(); renderHomeLayout(); renderMusic(); renderMusicQueue(); renderFocus(); renderShelf(); renderFiles(); renderWeather(); renderNearby(); renderModuleFeedback(); renderModules(); renderSettings(); renderScenarios(); renderMenuSelection(); update();
  }
  function time(value) { const seconds = Math.floor(value); return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0'); }
  function position() { return musicPosition(music, connectionLost ? 0 : window.performance.now() - musicAt); }
  function musicSpectrumVisible() {
    return state !== 'open' || builtinVisible('music') || view === 'nook' && homeLayout?.mode === 'activities' && homeLayout.items.some(item => item.id === 'music' && !item.complete);
  }
  function clearSpectrum() {
    for (const bar of spectrumBars) bar.style.setProperty('--level', '0');
    for (const spectrum of [...byId('activity-rail').querySelectorAll('.activity-spectrum'), ...byId('nook-layout').querySelectorAll('.activity-spectrum')]) {
      delete spectrum.dataset.signal;
      for (const bar of spectrum.children) bar.style.setProperty('--level', '0');
    }
  }
  function receiveSpectrum(values) {
    if (disposed || document.hidden || fileDragging || !motionEnabled() || !isModuleEnabled('music') || !music.playing || connectionLost || !musicSpectrumVisible()) return;
    const levels = spectrumLevels(values); if (!levels) return;
    const bars = state === 'open' ? playerBars : state === 'compact' ? liveBars : restBars;
    bars.forEach((bar, index) => bar.style.setProperty('--level', String(levels[index])));
    const secondary = state === 'compact' ? byId('activity-rail') : state === 'open' ? byId('nook-layout') : null;
    if (secondary) for (const spectrum of secondary.querySelectorAll('.activity-spectrum')) { spectrum.dataset.signal = 'true'; [...spectrum.children].forEach((bar, index) => bar.style.setProperty('--level', String(levels[index]))); }
    if (state === 'compact' && !byId('module-feedback-spectrum').hidden) feedbackBars.forEach((bar, index) => bar.style.setProperty('--level', String(levels[index])));
  }

  function renderTime() {
    if (disposed || document.hidden) return;
    const current = seekPreview ?? position(), ratio = music.duration ? current / music.duration : 0;
    notch.dataset.seeking = String(seekDragging || seekPreview !== null);
    if (notch.style.getPropertyValue('--music-progress') !== String(ratio)) notch.style.setProperty('--music-progress', String(ratio));
    text(byId('music-elapsed'), time(current));
    text(byId('music-live-time'), time(current));
    text(byId('music-duration'), music.duration ? '−' + time(Math.max(0, music.duration - current)) : '—:—');
    musicSeek.disabled = commandBusy || connectionLost || !music.canSeek;
    musicSeek.max = String(music.duration || 100);
    musicSeek.value = String(Math.floor(current));
    musicSeek.setAttribute('aria-valuetext', t('{current} sur {total}', {current: time(current), total: time(music.duration)}));
    musicSeek.title = music.canSeek ? t('Avancer ou reculer dans le morceau') : t('Le lecteur Windows ne permet pas de déplacer la lecture');
    strip.setAttribute('aria-valuemax', String(music.duration || 100));
    strip.setAttribute('aria-valuenow', String(music.duration ? Math.floor(current) : 0));
    strip.setAttribute('aria-valuetext', t('{current} sur {total}', {current: time(current), total: time(music.duration)}));
    renderCollapsedActivities();
    renderActivitySceneValues();
  }

  function syncClock() {
    const visible = musicSpectrumVisible();
    const delay = !disposed && !document.hidden && isModuleEnabled('music') && visible && music.available && music.playing && !connectionLost ? ISLAND_CONFIG.durations.progress : 0;
    if (delay === clockDelay) return;
    window.clearInterval(clock); clock = 0; clockDelay = delay;
    if (delay) clock = window.setInterval(renderTime, delay);
  }

  function renderMusic() {
    musicEmpty.hidden=music.available;
    text(musicEmpty.querySelector('strong'),t('Rien en lecture'));
    text(musicEmpty.querySelector('p'),t('Lance un morceau dans Spotify ou un lecteur Windows.'));
    text(musicEmpty.querySelector('button'),t('Ouvrir Spotify'));
    if (disposed) return;
    player.hidden = !builtinVisible('music');
    if (!player.closest('.activity-stage')) player.dataset.presentation = 'full';
    player.classList.toggle('activity-card-secondary', player.parentElement?.classList?.contains('activity-rail-cards') === true);
    player.dataset.available = String(music.available);
    renderLiveActivities();
    byId('shelf-drop-hint').hidden = !fileDragging || state !== 'compact';
    byId('music-empty').hidden = music.available;
    byId('music-content').hidden = !music.available;
    notch.dataset.playing = String(music.playing && !connectionLost);
    for (const badge of notch.querySelectorAll('.music-provider-badge')) badge.hidden = !music.available || !/^spotify$/i.test(music.source);
    text(player.querySelector('.music-playing-label'), player.parentElement?.classList?.contains('activity-main') ? t(music.playing && !connectionLost ? 'EN LECTURE' : 'Musique') : music.source || t('EN LECTURE'));
    text(byId('music-title'), music.title || t('Titre inconnu'));
    text(byId('music-live-title'), music.title || t('Musique'));
    text(byId('music-live-artist'), music.artist || music.source);
    text(byId('music-artist'), music.artist || t('Artiste inconnu'));
    text(byId('music-source'), music.source || t('Lecteur multimédia'));
    const description = music.available ? `${music.title || t('Musique')} · ${music.artist || t('lecteur musical')}` : t('Ouvrir l’encoche');
    toggle.setAttribute('aria-label', state === 'open' ? t('Encoche ouverte') : description + (music.available ? t(' · ouvrir le lecteur') : ''));
    for (const image of coverImages) {
      image.hidden = !music.cover || image.getAttribute('src') === music.cover && image.complete && image.naturalWidth === 0;
      image.nextElementSibling.toggleAttribute('hidden', !image.hidden);
      if (music.cover && image.getAttribute('src') !== music.cover) image.src = music.cover;
      else if (!music.cover) image.removeAttribute('src');
    }
    if (spectrumArtwork !== music.cover) { spectrumArtwork = music.cover; spectrumAnalyzed = ''; notch.style.setProperty('--spectrum-color', 'var(--color-fff)'); applyArtworkPalette(); coverLoaded({target: coverImages[0]}); }
    byId('music-promote').hidden = !player.parentElement?.classList?.contains('activity-rail-cards');
    const paused = !music.playing || connectionLost;
    byId('music-toggle').setAttribute('aria-label', paused ? t('Lire') : t('Mettre en pause'));
    byId('music-play-icon').setAttribute('d', paused ? 'M8.5 4.8a1 1 0 0 0-1.5.86v12.68a1 1 0 0 0 1.5.86l10.5-6.34a1 1 0 0 0 0-1.72Z' : 'M7 5h2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM15 5h2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z');
    const miniToggle = byId('music-hover-controls').querySelector('[data-music-command="toggle"]');
    miniToggle.setAttribute('aria-label', t(paused ? 'Lire' : 'Mettre en pause')); miniToggle.querySelector('path').setAttribute('d', byId('music-play-icon').getAttribute('d'));
    byId('music-queue-toggle').hidden = !music.available;
    for (const button of commands) {
      const command = button.dataset.musicCommand;
      const capability = {toggle: 'canToggle', next: 'canNext', previous: 'canPrevious', shuffle: 'canShuffle', repeat: 'canRepeat'}[command];
      button.disabled = commandBusy || (command === 'open' ? music.available && !/^spotify$/i.test(music.source) : connectionLost || !music.available || !music[capability]);
      if (command === 'shuffle') button.setAttribute('aria-pressed', String(music.shuffle === true));
      if (command === 'repeat') { button.setAttribute('aria-pressed', String(music.repeat === 'list' || music.repeat === 'track')); button.dataset.repeat = music.repeat || 'none'; button.setAttribute('aria-label', music.repeat === 'track' ? t('Répéter ce morceau · passer sans répétition') : music.repeat === 'list' ? t('Répéter la liste · passer à un seul morceau') : t('Activer la répétition de la liste')); }
    }
    textUI(byId('music-status'), musicError || music.error || '');
    if (paused || !motionEnabled() || state === 'open' && !builtinVisible('music')) clearSpectrum();
    renderTime(); syncClock(); renderHomeSummaries(); renderMusicQueue(); musicQueueLifecycle();
  }

  function setMusic(value) {
    if (disposed) return false;
    const next = normalizeMusic(value, music), track = moduleActivityChange('music', moduleActivitySnapshot('music', music), moduleActivitySnapshot('music', next))?.kind === 'track';
    const playbackChanged = music.available && next.available && music.playing !== next.playing;
    const oldPlaybackIcon = playbackChanged && state === 'open' && motionEnabled() && !player.hidden && !document.hidden ? byId('music-play-icon').closest('svg').cloneNode(true) : null;
    if (track) { seekPreview = null; if (!seekDragging) seekTrack = null; }
    const oldCopy = track && !musicAnnouncementBlocked() && state === 'open' && !player.hidden ? player.querySelector('.music-copy').cloneNode(true) : null;
    const oldArt = oldCopy ? player.querySelector('.music-art').cloneNode(true) : null;
    music = next;
    musicAt = window.performance.now();
    musicError = ''; connectionLost = false;
    scenarioController?.observe();
    renderMusic(); observeModuleActivity('music', music); update(); syncStream(); if (oldCopy && motionEnabled()) animateMusicTrack(oldCopy, oldArt);
    if (oldPlaybackIcon) animateMusicPlayback(oldPlaybackIcon);
    if (getModuleEditorActive()) renderModules(); return true;
  }
  function animateMusicPlayback(oldIcon) {
    const icon=byId('music-play-icon').closest('svg'), button=byId('music-toggle');
    if (!icon?.animate) return;
    for (const previous of button.querySelectorAll('.experience-play-out')) {for (const animation of previous.getAnimations()) animation.cancel(); previous.remove();}
    for (const animation of icon.getAnimations()) animation.cancel();
    oldIcon.removeAttribute('id'); for (const child of oldIcon.querySelectorAll('[id]')) child.removeAttribute('id');
    oldIcon.classList.add('experience-play-out'); oldIcon.setAttribute('aria-hidden','true'); button.append(oldIcon);
    for (const [node,frames] of [[oldIcon,NOTCH_TOKENS.motion.iconOut],[icon,NOTCH_TOKENS.motion.iconIn]]) {
      const animation=node.animate(frames,{duration:NOTCH_TOKENS.dur.progress,easing:NOTCH_TOKENS.ease.out}); moduleFeedbackAnimations.add(animation);
      const finish=()=>{moduleFeedbackAnimations.delete(animation); if (node===oldIcon) oldIcon.remove();}; animation.finished.then(finish,finish);
    }
  }
  function animateMusicTrack(oldCopy, oldArt) {
    for (const [old, host, frames] of [[oldCopy, player.querySelector('.music-copy'), NOTCH_TOKENS.motion.trackCopy], [oldArt, player.querySelector('.music-art'), NOTCH_TOKENS.motion.trackArt]]) {
      for (const previous of old.querySelectorAll('.music-track-out')) previous.remove();
      old.removeAttribute('id'); for (const child of old.querySelectorAll('[id]')) child.removeAttribute('id');
      old.classList.add('music-track-out'); old.inert = true; old.setAttribute('aria-hidden', 'true'); host.append(old);
      const animation = old.animate(frames, {duration: NOTCH_TOKENS.dur.card, easing: NOTCH_TOKENS.ease.track}); moduleFeedbackAnimations.add(animation);
      const finish = () => { moduleFeedbackAnimations.delete(animation); old.remove(); }; animation.finished.then(finish, finish);
    }
    animateModuleChange(player.querySelector('.music-copy')); animateModuleChange(player.querySelector('.music-art > img'));
  }

  function syncStream() {
    if (disposed || document.hidden || !isModuleEnabled('music')) {
      stream?.close(); retiringStream?.close(); stream = null; retiringStream = null;
      clearSpectrum(); syncClock(); return;
    }
    if (typeof window.EventSource !== 'function') { musicError = t('La connexion au lecteur n’est pas disponible.'); renderMusic(); return; }
    const wantsSpectrum = !fileDragging && motionEnabled() && musicSpectrumVisible();
    if (stream && streamSpectrum === wantsSpectrum) return;
    // Keep the old subscription until the new one opens, avoiding artwork flicker.
    retiringStream?.close(); retiringStream = stream;
    let current;
    try { current = new window.EventSource('/api/music/events?spectrum=' + (wantsSpectrum ? '1' : '0')); }
    catch { retiringStream?.close(); retiringStream = null; stream = null; musicError = t('Connexion musicale indisponible.'); renderMusic(); return; }
    stream = current; streamSpectrum = wantsSpectrum;
    current.addEventListener('open', () => { if (stream === current) { retiringStream?.close(); retiringStream = null; } });
    current.addEventListener('music', event => { if (stream === current) try { setMusic(JSON.parse(event.data)); } catch {} });
    current.addEventListener('spectrum', event => { if (stream === current) try { receiveSpectrum(JSON.parse(event.data)); } catch {} });
    current.addEventListener('error', () => {
      if (disposed || stream !== current || document.hidden) return;
      music.position = position(); musicAt = window.performance.now(); connectionLost = true;
      musicError = t('Connexion au lecteur en cours…'); clearSpectrum(); renderMusic(); update();
    });
  }

  async function commandMusic(event) {
    const button = event.target.closest('[data-music-command]');
    if (!button || button.disabled || commandBusy || disposed) return;
    const ownedFocus = document.activeElement === button;
    await performMusicCommand({command: button.dataset.musicCommand});
    if (ownedFocus && !disposed && [button, document.body].includes(document.activeElement)) {
      const target = !button.disabled && !button.closest('[hidden],[inert]') && button.getClientRects().length ? button : toggle;
      if (!target.disabled && target.getClientRects().length) target.focus({preventScroll: true});
    }
  }
  async function performMusicCommand(value) {
    if (commandBusy || disposed) return;
    commandBusy = true; musicError = ''; renderMusic();
    try {
      const response = await window.fetch('/api/music', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Notchy': '1'}, body: JSON.stringify(value)});
      const data = await response.json();
      if (disposed) return;
      if (value.command === 'seek' && (music.title !== value.title || music.artist !== value.artist || music.sourceId !== value.sourceId)) return;
      if (!response.ok || data.error) throw new Error(data.error || t('Le lecteur n’a pas pu effectuer cette action.'));
      if (Object.hasOwn(data, 'available')) setMusic(data);
    } catch (error) { if (!disposed) musicError = error.message || t('Le lecteur ne répond pas.'); }
    finally { if (!disposed) { commandBusy = false; seekPreview = null; seekTrack = null; renderMusic(); recheckCollapse(); } }
  }
  function previewMusicSeek() {
    if (musicSeek.disabled || disposed) return;
    seekTrack ||= {title: music.title, artist: music.artist, sourceId: music.sourceId || ''};
    seekPreview = Math.min(music.duration, Math.max(0, Number(musicSeek.value))); renderTime();
  }
  async function commitMusicSeek() {
    if (seekTrack && (seekTrack.title !== music.title || seekTrack.artist !== music.artist || seekTrack.sourceId !== (music.sourceId || ''))) { seekPreview = null; seekTrack = null; musicError = t('Le morceau a changé. Choisis sa nouvelle position.'); renderMusic(); return; }
    if (disposed || musicSeek.disabled || seekPreview === null || !seekTrack || state !== 'open' || !builtinVisible('music')) { seekPreview = null; seekTrack = null; renderTime(); return; }
    await performMusicCommand({command: 'seek', position: seekPreview, ...seekTrack});
  }
  function startMusicSeek() { if (!musicSeek.disabled) { seekDragging = true; seekTrack = {title: music.title, artist: music.artist, sourceId: music.sourceId || ''}; } }
  function endMusicSeek(event) { if (!seekDragging) return; seekDragging = false; if (event.type === 'pointercancel') { seekPreview = null; seekTrack = null; renderTime(); } recheckCollapse(); }
  function musicLifecycle() { if (state !== 'open' || !builtinVisible('music')) { seekPreview = null; seekTrack = null; seekDragging = false; } renderMusic(); syncStream(); musicQueueLifecycle(); }
  let spectrumAnalyzed = '';
  function applyArtworkPalette(accent = '') {
    for (const [name, value] of Object.entries(artworkPalette(accent))) notch.style.setProperty('--music-card-' + name, value);
    notch.dataset.mediaArtwork = String(!!accent);
  }
  function coverLoaded(event) {
    const image = event.target;
    if (disposed || !music.cover || image.getAttribute('src') !== music.cover || !image.complete || !image.naturalWidth || spectrumAnalyzed === music.cover) return;
    try {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
      const context = canvas.getContext('2d', {willReadFrequently: true}); context.drawImage(image, 0, 0, 16, 16);
      const accent = artworkColor(context.getImageData(0, 0, 16, 16).data);
      notch.style.setProperty('--spectrum-color', accent); applyArtworkPalette(accent); spectrumAnalyzed = music.cover;
    } catch { notch.style.setProperty('--spectrum-color', 'var(--color-fff)'); applyArtworkPalette(); }
  }
  function coverError(event) { event.target.hidden = true; event.target.nextElementSibling.removeAttribute('hidden'); if (event.target.getAttribute('src') === music.cover) {notch.style.setProperty('--spectrum-color', 'var(--color-fff)'); applyArtworkPalette();} }

  function presentMusicQueue(active) {
    panel.dataset.musicQueue = String(active);
    for (const [node, inert] of queueBackdrop) node.inert = inert;
    queueBackdrop.clear();
    if (!active) return;
    const protect = node => {
      if (node === player || node.hidden) return;
      if (node.contains(player)) {for (const child of node.children) protect(child);}
      else {queueBackdrop.set(node, node.inert); node.inert = true;}
    };
    for (const child of panel.children) protect(child);
  }
  function animateMusicQueue(entering, finish) {
    const host = byId('music-queue'), running = contentAnimations.get(host), current = getComputedStyle(host);
    const simple = !motionEnabled(), exit = simple ? 'none' : 'translateX(24px)';
    const from = running || !entering ? {opacity: current.opacity, transform: simple ? 'none' : current.transform} : {opacity: '0', transform: exit};
    for (const animation of running || []) animation.cancel();
    contentAnimations.delete(host);
    const target = {opacity: entering ? '1' : '0', transform: entering || simple ? 'none' : exit};
    host.inert = !entering; host.style.pointerEvents = entering ? 'auto' : 'none';
    if (document.hidden || typeof host.animate !== 'function') {Object.assign(host.style, target); finish?.(); return;}
    const animation = host.animate([from, target], {duration: simple ? ISLAND_CONFIG.durations.reduced : 300, easing: simple ? 'linear' : ISLAND_CONFIG.spring.easing, fill: 'both'});
    const animations = [animation]; contentAnimations.set(host, animations);
    animation.finished.then(() => {
      if (contentAnimations.get(host) !== animations) return;
      Object.assign(host.style, target); animation.cancel(); contentAnimations.delete(host); finish?.();
    }, () => {});
  }
  function queueVisible() { return !player.hidden && queueOpen && ['nook','music'].includes(view) && state === 'open' && !moduleEditing && !document.hidden && (!music.available || /^spotify$/i.test(music.source)); }
  function queueText(value, max = 240) { return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, max) : ''; }
  function queueSnapshot(value) {
    const statuses = ['disconnected','connecting','connected','ok','accepted','scope-required','busy','limited','unauthorized','forbidden','offline','unavailable','error','cancelled','invalid'];
    const track = item => item && typeof item.name === 'string' ? {name: queueText(item.name), artists: Array.isArray(item.artists) ? item.artists.slice(0, 8).map(name => queueText(name, 100)).filter(Boolean) : [], type: item.type === 'episode' ? 'episode' : 'track', uri: item.type !== 'episode' && typeof item.uri === 'string' && /^spotify:track:[A-Za-z0-9]{22}$/.test(item.uri) ? item.uri : '', duration: Number.isSafeInteger(item.duration) && item.duration > 0 && item.duration <= 86400000 ? item.duration : null, artwork: typeof item.artwork === 'string' && item.artwork.length <= 355000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(item.artwork) ? item.artwork : null} : null;
    return {status: statuses.includes(value?.status) ? value.status : 'error', canPlay: value?.canPlay === true, message: queueText(value?.message, 600), current: value?.status === 'ok' ? track(value?.current) : null, items: value?.status === 'ok' && Array.isArray(value?.items) ? value.items.slice(0, 50).map(track).filter(Boolean) : [], retryAfter: Number.isFinite(value?.retryAfter) ? Math.min(300, Math.max(1, value.retryAfter)) : 0};
  }
  function renderMusicQueue() {
    const host = byId('music-queue'), systemOnly = music.available && !/^spotify$/i.test(music.source);
    host.hidden = !(queueOpen || queueClosing) || !['nook','music'].includes(view) || state !== 'open' || player.hidden || moduleEditing;
    const inline = !host.hidden; host.inert = !queueOpen; presentMusicQueue(inline);
    host.dataset.inline = String(inline); host.dataset.hasItems = String(!systemOnly && queueState.status === 'ok' && !!queueState.items.length); player.dataset.queueInline = String(inline); player.dataset.queueOpen = String(!host.hidden);
    const button = byId('music-queue-toggle'); button.setAttribute('aria-expanded', String(queueOpen)); button.setAttribute('aria-label', queueOpen ? t('Fermer À suivre') : t('Afficher À suivre'));
    if (host.hidden) return;
    host.querySelector('footer > span').textContent = t(systemOnly ? 'La lecture et les commandes restent disponibles.' : 'Lecture sur l’appareil Spotify actif');
    byId('music-queue-refresh').hidden = systemOnly;
    if (systemOnly) {
      text(byId('music-queue-status'), t('Ce lecteur ne partage pas sa file d’attente.'));
      byId('music-queue-status').hidden = false;
      for (const id of ['music-queue-connect', 'music-queue-disconnect', 'music-queue-items']) byId(id).hidden = true;
      byId('music-queue-items').replaceChildren(); queueListSignature = '';
      return;
    }
    const messages = {disconnected: t('Connecte Spotify pour afficher sa file.'), connecting: t('Autorise la connexion dans ton navigateur.'), connected: t('La file est prête à être actualisée.'), ok: t('La file est vide.'), unauthorized: t('Reconnecte Spotify pour restaurer la session.'), forbidden: t('Spotify refuse cet accès pour ce compte.'), limited: t('Spotify demande une pause avant de réessayer.'), offline: t('Spotify est momentanément indisponible.'), unavailable: t('La file Spotify est indisponible.'), error: t('Impossible de lire la file pour le moment.'), cancelled: t('Lecture annulée.'), invalid: t('Commande indisponible.')};
    textUI(byId('music-queue-status'), queueBusy ? queueOperation === 'play-track' ? t('Lecture demandée à Spotify…') : t('Chargement de la file…') : queueNotice || queueState.message || messages[queueState.status]);
    byId('music-queue-status').hidden = !queueBusy && !queueNotice && queueState.status === 'ok' && !!queueState.items.length;
    byId('music-queue-refresh').disabled = queueBusy || queueState.status === 'connecting' || Date.now() < queueRetryUntil;
    const needsPlayback = !queueState.canPlay && ['ok','connected','scope-required'].includes(queueState.status);
    byId('music-queue-connect').hidden = !needsPlayback && !['disconnected','unauthorized','forbidden','error'].includes(queueState.status);
    text(byId('music-queue-connect'), needsPlayback ? t('Autoriser la lecture Spotify') : t('Connecter Spotify'));
    byId('music-queue-connect').disabled = queueBusy;
    byId('music-queue-disconnect').hidden = !['connected','ok','limited','forbidden','offline'].includes(queueState.status);
    byId('music-queue-disconnect').disabled = queueBusy;
    const list = byId('music-queue-items'), signature = JSON.stringify([i18n.locale(), queueState.items, queueState.canPlay, inline]);
    if (queueListSignature !== signature) {
    const nodes = queueState.items.map(item => {
      const row = document.createElement('li'), itemView = document.createElement(item.uri ? 'button' : 'div'); itemView.className = 'music-queue-item';
      if (item.uri) { itemView.type = 'button'; itemView.dataset.musicQueueCommand = 'play-track'; itemView.dataset.uri = item.uri; itemView.setAttribute('aria-label', t('Lire {track} · {artists}', {track: item.name, artists: item.artists.join(' · ')})); itemView.title = t('Lire sur l’appareil Spotify actif · remplace le contexte de lecture'); }
      const art = document.createElement('span'); art.className = 'music-queue-art';
      const placeholder = () => { const glyph = player.querySelector('.cover-placeholder').cloneNode(true); glyph.removeAttribute('hidden'); return glyph; };
      if (item.artwork) { const image = document.createElement('img'); image.src = item.artwork; image.alt = ''; image.addEventListener('error', () => image.replaceWith(placeholder()), {once: true}); art.append(image); } else art.append(placeholder());
      const copy = document.createElement('span'); copy.className = 'music-queue-copy'; const title = document.createElement('strong'), artist = document.createElement('small');
      title.textContent = item.name || t('Titre indisponible'); title.title = title.textContent; artist.textContent = item.artists.join(' · ') || (item.type === 'episode' ? t('Épisode') : t('Artiste inconnu')); artist.title = artist.textContent;
      copy.append(title, artist); itemView.append(art, copy);
      if (item.duration) {const duration = document.createElement('span'); duration.className = 'music-queue-duration'; duration.textContent = time(item.duration / 1000); itemView.append(duration);}
      row.append(itemView); return row;
    });
    list.replaceChildren(...nodes); queueListSignature = signature;
    }
    list.hidden = queueState.status !== 'ok' || !queueState.items.length;
    for (const choice of list.querySelectorAll('button')) choice.disabled = queueBusy || !queueState.canPlay || Date.now() < queueRetryUntil;
  }
  function scheduleMusicQueue() {
    window.clearTimeout(queueTimer); queueTimer = 0;
    if (!queueVisible() || queueBusy) return;
    if (queueState.status === 'connecting') queueTimer = window.setTimeout(() => readMusicQueue(false), 1500);
    else if (queueState.status === 'ok' || queueState.status === 'connected') queueTimer = window.setTimeout(() => readMusicQueue(true), 15000);
    else if (queueRetryUntil > Date.now()) queueTimer = window.setTimeout(renderMusicQueue, Math.min(300000, queueRetryUntil - Date.now()));
  }
  async function readMusicQueue(refresh = false) {
    if (!queueVisible() || queueBusy || Date.now() < queueRetryUntil) return;
    const ticket = ++queueEpoch; queueBusy = true; renderMusicQueue();
    try {
      let value = desktop?.musicQueue ? await desktop.musicQueue(refresh ? 'queue' : 'status') : {status: 'unavailable', message: t('Ouvre cette vue dans l’application Windows pour connecter Spotify.')};
      if (disposed || ticket !== queueEpoch || !queueVisible()) return;
      if (!refresh && ['connected','ok'].includes(value?.status)) value = await desktop.musicQueue('queue');
      if (disposed || ticket !== queueEpoch || !queueVisible()) return;
      queueState = queueSnapshot(value); if (queueState.retryAfter) queueRetryUntil = Date.now() + queueState.retryAfter * 1000;
    } catch { if (ticket === queueEpoch) queueState = {status: 'error', current: null, items: [], message: t('La file Spotify est indisponible. Réessaie.')}; }
    finally { if (ticket === queueEpoch) { queueBusy = false; renderMusicQueue(); scheduleMusicQueue(); } }
  }
  function closeMusicQueue(animate = true, focus = true) {
    queueClosing = animate && !byId('music-queue').hidden && state === 'open' && !document.hidden;
    queueOpen = queueActive = queueBusy = false; queueNotice = queueOperation = ''; queueEpoch++; window.clearTimeout(queueTimer); queueTimer = 0;
    const finish = () => {
      queueClosing = false; renderMusicQueue(); update();
      if (focus && !byId('music-queue-toggle').closest('[hidden],[inert]')) byId('music-queue-toggle').focus({preventScroll: true});
    };
    renderMusicQueue();
    if (queueClosing) animateMusicQueue(false, finish); else finish();
  }
  function musicQueueLifecycle() {
    if (queueOpen && (!['nook','music'].includes(view) || state !== 'open' || moduleEditing || player.hidden)) { closeMusicQueue(false, false); return; }
    const active = queueVisible(); if (active === queueActive) return;
    queueActive = active;
    if (active) void readMusicQueue(false);
    else { queueEpoch++; queueBusy = false; window.clearTimeout(queueTimer); queueTimer = 0; }
  }
  async function musicQueueCommand(event) {
    const button = event.target.closest('[data-music-queue-command]'); if (!button || button.disabled || disposed) return;
    const command = button.dataset.musicQueueCommand;
    if (command === 'toggle') {
      if (queueOpen) { closeMusicQueue(); return; }
      queueClosing = false; queueOpen = true;
      setState('open'); renderMusicQueue(); update(); animateMusicQueue(true); musicQueueLifecycle(); byId('music-queue-close').focus({preventScroll: true}); return;
    }
    if (command === 'close') { closeMusicQueue(); return; }
    if (command === 'refresh') { queueNotice = ''; void readMusicQueue(true); return; }
    if (!['connect','disconnect','play-track'].includes(command) || !queueVisible() || queueBusy || !desktop?.musicQueue) return;
    const uri = button.dataset.uri;
    if (command === 'play-track' && (!queueState.canPlay || !queueState.items.some(item => item.uri && item.uri === uri))) return;
    const ticket = ++queueEpoch; queueBusy = true; queueOperation = command; queueNotice = ''; renderMusicQueue();
    try {
      let value = await desktop.musicQueue(command === 'play-track' ? {command, uri} : command);
      if (disposed || ticket !== queueEpoch || !queueVisible()) return;
      if (command === 'play-track') {
        queueNotice = queueText(value?.message, 600) || (value?.status === 'accepted' ? t('Lecture demandée à Spotify sur l’appareil actif.') : t('Spotify n’a pas pu lancer ce titre.'));
        if (value?.status === 'accepted') value = await desktop.musicQueue('queue');
      }
      if (!disposed && ticket === queueEpoch && queueVisible()) { queueRetryUntil = value?.retryAfter ? Date.now() + Math.min(300, value.retryAfter) * 1000 : 0; queueState = queueSnapshot(value); }
    }
    catch { if (ticket === queueEpoch) queueState = {status: 'error', current: null, items: [], message: t('La connexion Spotify est indisponible.')}; }
    finally { if (ticket === queueEpoch) { queueBusy = false; queueOperation = ''; renderMusicQueue(); scheduleMusicQueue(); recheckCollapse(); } }
  }

  function paint(now = window.performance.now()) {
    window.cancelAnimationFrame(frame);
    frame = 0;
    if (disposed) return;
    const value = motion.step(now, {snap: !motionEnabled() || document.hidden});
    const width = Math.max(1, Math.min(value.width, ISLAND_CONFIG.states.expanded.width * 1.03, Math.max(1, window.innerWidth - 32 - Math.max(0, value.shoulder) * 2)));
    const height = Math.min(value.height, Math.max(ISLAND_CONFIG.states.expanded.height, ISLAND_CONFIG.activities.expandedHeight) * 1.03);
    geometry = shape({...value, width, height}, window.innerWidth);
    const band = Math.max(0, Math.min(value.band, geometry.height));
    for (const [name, number] of Object.entries({width, height: geometry.height, radius: geometry.radius, band, shoulder: geometry.shoulder, 'surface-width': geometry.totalWidth})) {
      notch.style.setProperty('--' + name, number + 'px');
    }
    surface.setAttribute('viewBox', `0 0 ${geometry.totalWidth} ${geometry.height}`);
    contour.setAttribute('d', geometry.path);
    bandCut.setAttribute('transform', `translate(${-geometry.shoulder} 0)`);
    panelCut.setAttribute('transform', `translate(${-geometry.shoulder} ${-band})`);
    desktopPointer();
    if (desktop) void desktop.sendGeometry({width: geometry.totalWidth, height: geometry.height, radius: geometry.radius, shoulder: geometry.shoulder, band, state}).then(result => { if (result?.maxHeight) desktopMaxHeight = result.maxHeight; }).catch(() => {});
    notch.style.setProperty('--menu-opacity', String(Math.max(0, Math.min(1, value.progress))));
    if (motion.isActive() && !document.hidden) frame = window.requestAnimationFrame(paint);
  }

  function update() {
    if (disposed) return;
    const core = islandCoreView(), layout = ISLAND_CONFIG.layout;
    const activities = getCollapsedActivities();
    const closed = closedBandSize(state, {activities, feedback: moduleFeedback && isModuleEnabled(moduleFeedback.id) ? moduleFeedback : false});
    closed.width = Math.min(closed.width, Math.max(1, window.innerWidth - layout.side * 2 - closed.shoulder * 2));
    renderCollapsedActivities(activities);
    if (view === 'nook' && !getModuleEditorActive()) {
      const home = byId('nook-layout'), gap = layout.gap;
      renderHomeLayout({skipUpdate: true});
      if (home.dataset.layout !== 'activities') homeLayout = {mode: 'grid', items: nookGridPlan(islandPage, getHomeSlots().filter(Boolean))};
      home.style.setProperty('--home-gap', gap + 'px');
    }
    // The content has its final dimensions throughout the surface spring.
    const scene = view === 'nook' && !getModuleEditorActive() && homeLayout?.mode === 'activities', sceneLayout = ISLAND_CONFIG.activities;
    notch.dataset.activityScene = String(scene);
    islandFooter.hidden = !!ia || !core || scene;
    const activityHeight = scene ? homeLayout.items.length > 2 ? sceneLayout.expandedHeight : sceneLayout.sceneHeight : ISLAND_CONFIG.states.expanded.height;
    const welcomeSize = view === 'welcome' ? welcomeStage === 'idle' ? ISLAND_CONFIG.states.rest : welcomeStage === 'logo' ? {width: ISLAND_CONFIG.welcome.introWidth, height: ISLAND_CONFIG.welcome.introHeight} : ISLAND_CONFIG.welcome : {width: ISLAND_CONFIG.formats[appearance.format], height: activityHeight};
    const width = Math.min(welcomeSize.width, Math.max(1, window.innerWidth - layout.side * 2));
    const height = Math.max(closed.band, Math.min(welcomeSize.height, desktop ? desktopMaxHeight - 8 : window.innerHeight - 96));
    const showHeader = view !== 'welcome' && view !== 'localsend' && !fileDragging;
    const band = showHeader ? scene ? sceneLayout.sceneTop : layout.header : 0;
    const panelHeight = Math.max(0, height - band - (scene ? sceneLayout.bottom : layout.bottom) - (!ia && core && !scene ? layout.footer : 0));
    notch.style.setProperty('--island-side', (scene ? sceneLayout.side : layout.side) + 'px');
    notch.style.setProperty('--scene-gap', sceneLayout.gap + 'px');
    notch.style.setProperty('--island-header-height', layout.header + 'px');
    menu.hidden = state !== 'open' || !showHeader; menu.inert = menu.hidden || !!closingTo;
    notch.style.setProperty('--panel-height', panelHeight + 'px');
    notch.style.setProperty('--island-body-height', panelHeight + 'px');
    notch.style.setProperty('--expanded-band', band + 'px');
    notch.style.setProperty('--content-width', width + 'px');
    notch.style.setProperty('--closed-width', closed.width + 'px');
    notch.style.setProperty('--closed-height', closed.band + 'px');
    expandedLayer.style.width = width + 'px'; expandedLayer.style.height = height + 'px';
    const target = state === 'open' ? {width, height, band, shoulder: 0, radius: view === 'welcome' && welcomeStage === 'idle' ? ISLAND_CONFIG.states.rest.radius : view === 'welcome' && welcomeStage === 'logo' ? ISLAND_CONFIG.welcome.introRadius : view === 'welcome' ? ISLAND_CONFIG.welcome.radius : ISLAND_CONFIG.states.expanded.radius + (appearance.radius - 18) / 3, progress: 1} : {...closed, height: closed.band};
    protectLayoutResize(target.width, target.height);
    motion.setTarget(target, {snap: !motionEnabled() || document.hidden});
    paint(); ia?.render(view,getModuleEditorActive()); renderLocalSend(); syncCalendarLayer(); recheckCollapse();
  }

  function setState(next) {
    if (disposed || !Object.hasOwn(sizes, next)) return false;
    if (next === 'open' && closingTo) {
      window.clearTimeout(contentExitTimer); contentExitTimer = 0; closingTo = null;
      window.clearTimeout(hoverTimer); hoverTimer = 0;
      animateIslandLayer(expandedLayer, true); renderIslandNavigation(); update(); return true;
    }
    if (state === 'open' && next !== 'open' && !document.hidden) {
      if (closingTo) {closingTo = next; return true;}
      const restoreKeyboardFocus = keyboardNavigation && expandedLayer.contains(document.activeElement);
      closingTo = next; animateIslandLayer(expandedLayer, false); islandFooter.inert = true;
      contentExitTimer = window.setTimeout(() => {
        const target = closingTo; closingTo = null; contentExitTimer = 0; applyState(target);
        if (restoreKeyboardFocus && document.activeElement === document.body) toggle.focus({preventScroll: true});
      }, ISLAND_CONFIG.durations.contentExit);
      return true;
    }
    return applyState(next);
  }
  function applyState(next) {
    if (disposed || !Object.hasOwn(sizes, next)) return false;
    if (next !== 'open') calendar?.close({restoreFocus:false});
    const wasOpen = state === 'open', wasCompact = state === 'compact';
    const keyboardOpening = next === 'open' && !wasOpen && keyboardNavigation && document.activeElement === toggle;
    window.clearTimeout(collapseTimer); collapseTimer = 0; collapseDeferred = false;
    window.clearTimeout(hoverTimer); hoverTimer = 0;
    if (next !== 'open') awaitingPointerEntry = false;
    if (next === 'rest') keyboardNavigation = false;
    if (next !== 'open' || state !== 'open') {layoutResizeClick = null; layoutResizeGraceUntil = 0;}
    if (next !== 'open' && (menu.contains(document.activeElement) || expandedLayer.contains(document.activeElement) || byId('music-hover-controls').contains(document.activeElement))) toggle.focus({preventScroll: true});
    state = next;
    if (next !== 'open' && view === 'search') {
      search?.close({restoreFocus: false, notify: false});
      selectViewButton({dataset: {view: searchReturnView}});
    }
    renderScenarios();
    notch.dataset.state = next;
    document.body.dataset.notchState = next;
    toggle.setAttribute('aria-expanded', String(next === 'open'));
    toggle.tabIndex = next === 'open' && view === 'localsend' ? -1 : 0;
    toggle.setAttribute('aria-label', next === 'open' ? t('Réduire l’encoche') : t('Ouvrir l’encoche'));
    panel.setAttribute('aria-hidden', String(next !== 'open'));
    panel.inert = next !== 'open';
    menu.hidden = next !== 'open' || view === 'welcome' || view === 'localsend';
    menu.inert = menu.hidden;
    renderMenuSelection();
    renderIslandNavigation();
    renderLiveActivities();
    update();
    musicLifecycle();
    renderFocus(); nearbyLifecycle();
    filesLifecycle();
    weatherLifecycle();
    renderModuleFeedback();
    if (next === 'open' && view === 'nook' && isModuleEnabled('shelf') && !shelfLoaded && !shelfBusy && !fileDragging) void loadShelf();
    if (next === 'open' && view === 'nook' && !getModuleEditorActive()) scenarioController?.morning();
    if (wasOpen !== (next === 'open')) {
      animateIslandLayer(expandedLayer, next === 'open');
      if (keyboardOpening && !menu.hidden) menu.querySelector('button:not([hidden]):not(:disabled)')?.focus({preventScroll: true});
      animateIslandLayer(toggle, next !== 'open', true);
    }
    if (next !== 'open') {const compact = next === 'compact'; if (wasCompact !== compact || wasOpen) {animateIslandLayer(compactContent, compact, true); animateIslandLayer(restContent, !compact, true);}}
    if (next !== 'open') scenarioController?.flush();
    return true;
  }

  let layoutResizeClick = null, layoutResizeGraceUntil = 0, nativePointerPresence = null, awaitingPointerEntry = false;
  function openFromOutside() {
    if (disposed) return false;
    // A shortcut or tray activation is not a departure from the painted island.
    awaitingPointerEntry = !pointerInside; keyboardNavigation = true;
    window.clearTimeout(collapseTimer); collapseTimer = 0; collapseDeferred = false;
    const opened = setState('open'); desktop?.focus(); return opened;
  }
  function protectLayoutResize(width, height) {
    const now = Date.now(), click = layoutResizeClick;
    if (disposed || state !== 'open' || !click || click.armed || now - click.at > 250 || now < click.at || !Number.isFinite(width) || !Number.isFinite(height)) return;
    if (width >= geometry.width - .5 && height >= geometry.height - .5) return;
    click.armed = true;
    // A shrinking contour can leave the clicked control behind the cursor.
    // Give the user time to reach the new content without keeping an oversized panel.
    layoutResizeGraceUntil = click.at + 650;
    if (!pointerInside) scheduleCollapse();
  }
  function protectedInteraction({ignoreFeedback = false} = {}) {
    const focused = document.hasFocus() ? document.activeElement : null;
    const editing = focused?.id !== 'music-seek' && !!focused?.closest('input,textarea,select,[contenteditable="true"]');
    return awaitingPointerEntry || view === 'module-library' && moduleLibrary?.isBusy() || welcome?.isActive() || fileDialogOpen || fileDragging || seekDragging || getModuleEditorActive() || !ignoreFeedback && state === 'compact' && moduleFeedback?.restoreQuiet === true || state === 'open' && view === 'localsend' && !!nearby.incoming && localSendContext?.incomingId === nearby.incoming.id || queueOpen && (queueState.status === 'connecting' || queueBusy && queueOperation === 'play-track') || editing && (pointerInside || keyboardNavigation) || keyboardNavigation && state !== 'rest' && !!(focused?.closest('#notch-toggle,#notch-panel,#notch-menu,#island-footer') || focused?.closest('#music-hover-controls'));
  }
  function scheduleCollapse(deactivated = false) {
    window.clearTimeout(collapseTimer); collapseTimer = 0;
    if (deactivated) {awaitingPointerEntry = false; pointerInside = false; if (nativePointerPresence !== null) nativePointerPresence = false; keyboardNavigation = false; window.clearTimeout(hoverTimer); hoverTimer = 0;}
    if (disposed || state === 'rest') { collapseDeferred = false; layoutResizeClick = null; layoutResizeGraceUntil = 0; return; }
    collapseDeferred = protectedInteraction();
    if (collapseDeferred) return;
    collapseTimer = window.setTimeout(() => {
      collapseTimer = 0;
      if (disposed || !(deactivated || !pointerInside)) return;
      collapseDeferred = protectedInteraction();
      if (!collapseDeferred) setState('rest');
    }, Math.max(ISLAND_CONFIG.delays.leave, state === 'open' ? layoutResizeGraceUntil - Date.now() : 0));
  }
  function recheckCollapse() { scenarioController?.flush(); if (collapseDeferred && !disposed && !pointerInside && !protectedInteraction()) scheduleCollapse(); }
  function enter(event) {
    if (event && nativePointerPresence === false) return;
    pointerInside = true; awaitingPointerEntry = false; window.clearTimeout(collapseTimer); collapseTimer = 0; collapseDeferred = false;
    dismissMusicTrackFeedback();
    if (closingTo) { setState('open'); return; }
    window.clearTimeout(hoverTimer);
    if (state === 'rest') hoverTimer = window.setTimeout(() => {hoverTimer = 0; if (pointerInside && state === 'rest' && !disposed) setState('compact');}, ISLAND_CONFIG.delays.hover);
  }
  function leave() { window.clearTimeout(hoverTimer); hoverTimer = 0; pointerInside = false; scenarioController?.flush(); scheduleCollapse(); }
  function nativePointer(value) {
    const inside = value?.inside;
    if (disposed || document.hidden || typeof inside !== 'boolean') return;
    if (inside && value.moved === false && !pointerInside) return;
    nativePointerPresence = inside;
    if (value.moved === true) layoutResizeClick = null;
    if (value.moved === true && keyboardNavigation) {
      keyboardNavigation = false;
      if (!inside) { leave(); return; }
    }
    if (inside === pointerInside) {
      if (!inside && state !== 'rest' && !collapseTimer && !collapseDeferred) scheduleCollapse();
      return;
    }
    if (inside) enter(); else leave();
  }
  function toggleFocus() { if (keyboardNavigation && state === 'rest') setState('compact'); }
  function surfaceClick() { if (state !== 'open') open(); }
  function open() {
    if (closingTo) {setState('open'); return;}
    if (welcome?.isActive() && state === 'open') { finishWelcome('rest'); return; }
    if (state === 'open') { if (!getModuleEditorActive()) setState('rest'); return; }
    const transfer = localSendBand();
    selectViewButton({dataset: {view: transfer && transfer.stage !== 'ready' ? 'localsend' : 'nook'}});
    setState('open');
  }
  function focusInteraction() { if (protectedInteraction()) { dismissMusicTrackFeedback(); if (collapseTimer) collapseDeferred = true; window.clearTimeout(collapseTimer); collapseTimer = 0; } }
  function focusDeparture() {
    window.queueMicrotask(() => {
      if (!document.hasFocus()) scheduleCollapse(true);
      else if (!pointerInside && state !== 'rest' && !collapseTimer && !protectedInteraction()) scheduleCollapse();
      else recheckCollapse();
    });
  }
  function keyboardInteraction(event) { if (event.target?.closest?.('input,textarea,select,[contenteditable="true"]') || ['Tab', 'Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {keyboardNavigation = true; dismissMusicTrackFeedback(); focusInteraction();} }
  function pointerInteraction(event) {
    keyboardNavigation = false;
    if (notch.contains(event.target)) dismissMusicTrackFeedback();
    layoutResizeClick = state === 'open' && notch.contains(event.target) ? {at: Date.now(), armed: false} : null;
  }
  function pointerPosition(event) {
    // A real mouse move ends the keyboard guard without moving DOM focus.
    if (event.pointerType === 'mouse' && (event.movementX || event.movementY)) {
      const wasKeyboard = keyboardNavigation;
      keyboardNavigation = false; layoutResizeClick = null;
      if (!notch.contains(event.target)) {if (pointerInside || collapseDeferred) leave(); else if (wasKeyboard) scheduleCollapse();}
    }
  }
  function showFileChooser(input) { fileDialogOpen = true; desktop?.setDialogOpen?.(true); input.click(); }
  function closeFileChooser() { fileDialogOpen = false; desktop?.setDialogOpen?.(false); recheckCollapse(); }
  function outside(event) { if (state === 'open' && !notch.contains(event.target)) { if (welcome?.isActive()) { finishWelcome('rest'); return; } if (getModuleEditorActive()) closeModuleEditor(false); setState('rest'); } }
  function key(event) {
    if (event.defaultPrevented) return;
    if (calendar?.isOpen() && event.key === 'Escape') {event.preventDefault(); calendar.close(); return;}
    if ((event.ctrlKey || event.metaKey) && !event.altKey && (String(event.key).toLowerCase() === 'k' || !desktop && event.code === 'Space')) {
      event.preventDefault(); showSearch(); return;
    }
    if (event.key === 'Escape' && !getModuleEditorActive()) { event.preventDefault(); if (queueOpen) { event.stopImmediatePropagation(); closeMusicQueue(); } else if (welcome?.isActive()) finishWelcome('rest'); else setState('rest'); }
  }
  function selectView(event) {
    const button = event.target.closest('[data-view]');
    if (disposed || menu.hidden || !button || !menu.contains(button)) return;
    if (button.dataset.view === 'modules') {openModuleEditor(event); return;}
    if (getModuleEditorActive()) closeModuleEditor(false);
    if (button.dataset.view === 'nook') islandPage = 'music';
    selectViewButton(button);
  }
  function menuHover(event) {
    const button=event.target.closest('button[data-view]'); if (!button || button.hidden || !menu.contains(button)) return;
    const bounds=button.getBoundingClientRect(), parent=menu.getBoundingClientRect();
    menu.style.setProperty('--hover-x',(bounds.left-parent.left)+'px'); menu.style.setProperty('--hover-width',bounds.width+'px');
  }
  function selectViewButton(button) {
    if (!button) return;
    calendar?.close({restoreFocus:false});
    if (view === 'module-library' && button.dataset.view !== 'module-library') moduleLibrary?.hide();
    if (view === 'search' && button.dataset.view !== 'search') search?.close({restoreFocus: false, notify: false});
    if (view === 'welcome' && button.dataset.view !== 'welcome' && welcome?.isActive()) {
      welcome.hide();
    }
    view = button.dataset.view;
    if (view === 'music' || view === 'focus' || view === 'tasks') islandPage = view;
    renderIslandNavigation();
    toggle.tabIndex = state === 'open' && view === 'localsend' ? -1 : 0;
    byId('welcome-player').hidden = view !== 'welcome';
    menu.hidden = state !== 'open' || view === 'welcome' || view === 'localsend'; menu.inert = menu.hidden;
    panel.setAttribute('aria-label', view === 'module-library' ? t('Bibliothèque de modules') : view === 'search' ? t('Rechercher') : view === 'nook' ? t('Accueil Notchy') : t(Object.values(moduleDefinitions).find(item => item.view === view)?.label) || (view === 'welcome' ? t('Bienvenue dans Notchy') : view === 'localsend' ? t('Partage LocalSend') : view === 'files' ? t('Actions de fichier') : view === 'scenarios' ? t('Scénarios') : t('Réglages')));
    renderMenuSelection();
    renderHomeLayout();
    musicLifecycle();
    renderFocus();
    renderShelf();
    renderFiles(); filesLifecycle();
    renderWeather(); weatherLifecycle();
    renderSettings();
    renderScenarios();
    renderExperience();
    renderModules(); nearbyLifecycle();
    renderModuleFeedback();
    renderLocalSend();
    update();
    if (view === 'module-library' && !moduleLibrary?.isOpen()) moduleLibrary?.show();
    if (state === 'open' && view === 'nook' && !getModuleEditorActive()) scenarioController?.morning();
    if ((builtinVisible('shelf') || view === 'nook' && getHomeSlots().includes('shelf')) && !shelfLoaded && !shelfBusy && !fileDragging) void loadShelf();
  }
  function renderMenuSelection() {
    for (const item of menuButtons) {
      const definition = Object.values(moduleDefinitions).find(entry => entry.view === item.dataset.view);
      item.hidden = !['nook','tray','settings'].includes(item.dataset.view);
      const selected = item.dataset.view === view || item.dataset.view === 'nook' && ['music','focus','tasks','weather'].includes(view) && !getModuleEditorActive() || item.dataset.view === 'settings' && (['scenarios','health'].includes(view) || getModuleEditorActive());
      item.setAttribute('aria-pressed', String(selected)); item.setAttribute('aria-current', selected ? 'page' : 'false');
    }
  }

  notch.addEventListener('pointerenter', enter);
  menu.addEventListener('pointerover',menuHover); menu.addEventListener('focusin',menuHover);
  notch.addEventListener('pointerleave', leave);
  toggle.addEventListener('focus', toggleFocus);
  toggle.addEventListener('click', open);
  byId('search-toggle').addEventListener('click', showSearch);
  surface.addEventListener('click', surfaceClick);
  islandFooter.addEventListener('click', islandNavigation);
  menu.addEventListener('click', selectView);
  byId('welcome-replay').addEventListener('click', replayWelcome);
  byId('module-feedback-actions').addEventListener('click', feedbackCommand);
  panel.addEventListener('click', commandMusic);
  byId('music-hover-controls').addEventListener('click', commandMusic);
  byId('focus-task-prompt').addEventListener('click', focusTaskPromptCommand);
  player.addEventListener('click', musicQueueCommand);
  musicSeek.addEventListener('input', previewMusicSeek);
  musicSeek.addEventListener('change', commitMusicSeek);
  musicSeek.addEventListener('pointerdown', startMusicSeek);
  document.addEventListener('pointerup', endMusicSeek);
  document.addEventListener('pointercancel', endMusicSeek);
  document.addEventListener('focusin', focusInteraction);
  document.addEventListener('focusout', focusDeparture);
  panel.addEventListener('click', weatherCommand);
  byId('weather-player').addEventListener('input', weatherInput);
  byId('weather-player').addEventListener('submit', weatherCommand);
  document.addEventListener('visibilitychange', weatherLifecycle);
  panel.addEventListener('click', openBuiltin);
  document.addEventListener('visibilitychange', feedbackVisibility);
  modulesPlayer.addEventListener('click', moduleCommand);
  notch.addEventListener('contextmenu', moduleContextMenu);
  document.addEventListener('keydown', moduleEditorKey);
  modulesPlayer.addEventListener('dragstart', moduleDragStart);
  modulesPlayer.addEventListener('dragover', moduleDragOver);
  modulesPlayer.addEventListener('drop', moduleDrop);
  document.addEventListener('visibilitychange', musicLifecycle);
  reduced.addEventListener('change', musicLifecycle);
  for (const image of coverImages) { image.addEventListener('error', coverError); image.addEventListener('load', coverLoaded); }
  shelfPlayer.addEventListener('click', shelfCommand);
  shelfPlayer.addEventListener('click', nearbyCommand);
  byId('localsend-player').addEventListener('click', localSendCommand);
  shelfPlayer.addEventListener('dblclick', openShelfFile);
  filePlayer.addEventListener('click', fileCommand);
  fileInput.addEventListener('change', fileInputChanged);
  fileInput.addEventListener('cancel', closeFileChooser);
  shelfInput.addEventListener('cancel', closeFileChooser);
  byId('file-preview').addEventListener('error', filePreviewError);
  document.addEventListener('visibilitychange', filesLifecycle);
  document.addEventListener('visibilitychange', nearbyLifecycle);
  shelfInput.addEventListener('change', shelfInputChanged);
  document.addEventListener('dragenter', fileDragEnter);
  document.addEventListener('dragover', fileDragOver);
  document.addEventListener('dragleave', fileDragLeave);
  document.addEventListener('drop', fileDrop);
  document.addEventListener('dragend', clearFileDrag);
  settingsPlayer.addEventListener('input', appearanceInput);
  settingsPlayer.addEventListener('change', startupInput);
  settingsPlayer.addEventListener('click', settingsCommand);
  scenariosPlayer?.addEventListener('change', scenarioInput);
  scenariosPlayer?.addEventListener('click', scenarioClick);
  scenariosPlayer?.addEventListener('keydown', scenarioKey);
  byId('scenario-home-notice')?.addEventListener('click', scenarioClick);
  document.addEventListener('visibilitychange', scenarioFlush);
  document.addEventListener('pointerdown', outside);
  document.addEventListener('pointerdown', pointerInteraction, true);
  document.addEventListener('pointermove', pointerPosition, true);
  document.addEventListener('keydown', keyboardInteraction, true);
  document.addEventListener('keydown', key);
  document.addEventListener('visibilitychange', update);
  window.addEventListener('resize', update);
  reduced.addEventListener('change', islandMotionPreference);
  if (desktop) {
    desktop.setInteractive(false);
    document.addEventListener('mousemove', desktopPointer);
    document.addEventListener('pointerdown', desktopFocus);
    const removeResume = desktop.onResume(value => { if (value?.maxHeight) desktopMaxHeight = value.maxHeight; if (value?.reason === 'search') showSearch(); else if (value?.reason === 'open') openFromOutside(); else update(); });
    const removeDeactivate = desktop.onDeactivate?.(() => scheduleCollapse(true));
    const removePointer = desktop.onPointer?.(nativePointer);
    desktopRemoveResume = () => { removeResume(); removeDeactivate?.(); removePointer?.(); };
  }

  function dispose() {
    calendar?.dispose();
    moduleLibrary?.dispose(); removeCommunityChange?.(); for (const cleanup of communityDisposers.values()) cleanup();
    search?.dispose(); byId('search-toggle').removeEventListener('click', showSearch);
    ia?.dispose();
    if (disposed) return;
    disposed = true;
    window.clearTimeout(activityExpiryTimer); activityExpiryTimer = 0;
    activityStage?.removeEventListener('click', activitySceneCommand);
    window.clearTimeout(hoverTimer); hoverTimer = 0;
    window.clearTimeout(contentExitTimer); contentExitTimer = 0; closingTo = null;
    for (const animations of contentAnimations.values()) for (const animation of animations) animation.cancel(); contentAnimations.clear();
    for (const [node,entry] of gestureTimers) {window.clearTimeout(entry.timer); node.classList.remove(entry.className);} gestureTimers.clear();
    menu.removeEventListener('pointerover',menuHover); menu.removeEventListener('focusin',menuHover);
    scenarioController?.dispose();
    removeLanguage?.(); document.removeEventListener('change', languageChoice);
    queueEpoch++; queueOpen = queueActive = queueBusy = false; window.clearTimeout(queueTimer); queueTimer = 0;
    shelfEpoch++;
    fileEpoch++;
    disposeModules();
    disposeWeather();
    window.clearTimeout(nearbyTimer); nearbyTimer = 0;
    window.clearTimeout(filePoll); filePoll = 0;
    desktopRemoveResume?.();
    byId('focus-task-prompt').removeEventListener('click', focusTaskPromptCommand);
    tasksComponent?.dispose(); focusComponent.dispose(); clearModuleFeedback(false);
    welcome?.dispose();
    window.cancelAnimationFrame(frame);
    window.clearTimeout(collapseTimer); collapseTimer = 0;
    frame = 0;
    window.clearInterval(clock); clock = 0; clockDelay = 0;
    stream?.close(); retiringStream?.close(); stream = null; retiringStream = null;
    notch.removeEventListener('pointerenter', enter);
    notch.removeEventListener('pointerleave', leave);
    surface.removeEventListener('click', surfaceClick);
    toggle.removeEventListener('focus', toggleFocus);
    toggle.removeEventListener('click', open);
    islandFooter.removeEventListener('click', islandNavigation);
    menu.removeEventListener('click', selectView);
    byId('welcome-replay').removeEventListener('click', replayWelcome);
    byId('module-feedback-actions').removeEventListener('click', feedbackCommand);
    panel.removeEventListener('click', commandMusic);
    player.removeEventListener('click', musicQueueCommand);
    byId('music-hover-controls').removeEventListener('click', commandMusic);
    musicSeek.removeEventListener('input', previewMusicSeek);
    musicSeek.removeEventListener('change', commitMusicSeek);
    musicSeek.removeEventListener('pointerdown', startMusicSeek);
    document.removeEventListener('pointerup', endMusicSeek);
    document.removeEventListener('pointercancel', endMusicSeek);
    document.removeEventListener('focusin', focusInteraction);
    document.removeEventListener('focusout', focusDeparture);
    panel.removeEventListener('click', weatherCommand);
    byId('weather-player').removeEventListener('input', weatherInput);
    byId('weather-player').removeEventListener('submit', weatherCommand);
    document.removeEventListener('visibilitychange', weatherLifecycle);
    panel.removeEventListener('click', openBuiltin);
    document.removeEventListener('visibilitychange', feedbackVisibility);
    modulesPlayer.removeEventListener('click', moduleCommand);
    notch.removeEventListener('contextmenu', moduleContextMenu);
    document.removeEventListener('keydown', moduleEditorKey);
    modulesPlayer.removeEventListener('dragstart', moduleDragStart);
    modulesPlayer.removeEventListener('dragover', moduleDragOver);
    modulesPlayer.removeEventListener('drop', moduleDrop);
    document.removeEventListener('visibilitychange', musicLifecycle);
    reduced.removeEventListener('change', musicLifecycle);
    for (const image of coverImages) { image.removeEventListener('error', coverError); image.removeEventListener('load', coverLoaded); }
    shelfPlayer.removeEventListener('click', shelfCommand);
    shelfPlayer.removeEventListener('click', nearbyCommand);
    byId('localsend-player').removeEventListener('click', localSendCommand);
    shelfPlayer.removeEventListener('dblclick', openShelfFile);
    filePlayer.removeEventListener('click', fileCommand);
    fileInput.removeEventListener('change', fileInputChanged);
    fileInput.removeEventListener('cancel', closeFileChooser);
    shelfInput.removeEventListener('cancel', closeFileChooser);
    byId('file-preview').removeEventListener('error', filePreviewError);
    document.removeEventListener('visibilitychange', filesLifecycle);
    document.removeEventListener('visibilitychange', nearbyLifecycle);
    shelfInput.removeEventListener('change', shelfInputChanged);
    document.removeEventListener('dragenter', fileDragEnter);
    document.removeEventListener('dragover', fileDragOver);
    document.removeEventListener('dragleave', fileDragLeave);
    document.removeEventListener('drop', fileDrop);
    document.removeEventListener('dragend', clearFileDrag);
    settingsPlayer.removeEventListener('input', appearanceInput);
    settingsPlayer.removeEventListener('change', startupInput);
    settingsPlayer.removeEventListener('click', settingsCommand);
    scenariosPlayer?.removeEventListener('change', scenarioInput);
    scenariosPlayer?.removeEventListener('click', scenarioClick);
    scenariosPlayer?.removeEventListener('keydown', scenarioKey);
    byId('scenario-home-notice')?.removeEventListener('click', scenarioClick);
    document.removeEventListener('visibilitychange', scenarioFlush);
    document.removeEventListener('mousemove', desktopPointer);
    document.removeEventListener('pointerdown', desktopFocus);
    document.removeEventListener('pointerdown', outside);
    document.removeEventListener('pointerdown', pointerInteraction, true);
    document.removeEventListener('pointermove', pointerPosition, true);
    document.removeEventListener('keydown', keyboardInteraction, true);
    document.removeEventListener('keydown', key);
    document.removeEventListener('visibilitychange', update);
    window.removeEventListener('resize', update);
    window.removeEventListener('pagehide', dispose);
    reduced.removeEventListener('change', islandMotionPreference);
  }

  window.notchy = Object.freeze({
    setLanguage: i18n.setLocale,
    getLanguage: i18n.locale,
    setState,
    setMusic,
    setAppearance,
    getScenarios: () => scenarioController.getPreferences(),
    setScenarios: value => scenarioController.configure(value),
    selectScenario: id => scenarioController.pick(id),
    undoScenario: () => scenarioController.undo(),
    flushScenario: () => scenarioController.flush(),
    getModules,
    getModuleDefinitions,
    showWelcome,
    getWelcome: () => welcome?.inspect(),
    getModuleFeedback: () => moduleFeedback ? {...moduleFeedback} : null,
    setModules,
    getHomeSlots,
    getModuleOrder,
    isModuleEnabled,
    openModuleEditor,
    closeModuleEditor,
    getModuleEditorActive,
    getModuleEditorSlots,
    getModuleEditorOrder,
    getWeatherState,
    getCalendar: () => calendar.snapshot(),
    showHealth: () => {selectViewButton({dataset:{view:'health'}}); setState('open');},
    showSearch,
    showModuleLibrary,
    getCommunityModules: () => communityStore.list(),
    dispose,
    inspect: () => ({state, view, geometry: {...geometry}, homeLayout: homeLayout ? JSON.parse(JSON.stringify(homeLayout)) : null, scenarios: scenarioController?.inspect(), morphing: motion.isActive(), band: parseFloat(notch.style.getPropertyValue('--band')), motion: motionEnabled(), appearance: {...appearance}, desktop: !!desktop, moduleEditing: getModuleEditorActive(), musicQueue: {open: queueOpen, status: queueState.status, count: queueState.items.length, busy: queueBusy}, file: currentFile() ? {...currentFile(), mode: fileMode, status: fileJob.status, jobId: fileJob.jobId, busy: fileBusy} : null, music: {...music, position: position()}, streamActive: !!stream, clockActive: !!clock, shelfCount: shelfItems.length, shelfBusy, modules: getModules(), focus: {active: focusIsActive(), running: !!focus.deadline, seconds: FocusModel.remaining(focus), phase: focus.pomodoro ? {...focus.pomodoro} : null, configuration: {...focusSettings}, complete: focus.complete, timerActive: focusComponent.inspect().timerActive},
    }),
  });
  window.addEventListener('pagehide', dispose, {once: true});
  const hasNativeSettings = typeof window.__TAURI__?.core?.invoke === 'function' || typeof window.__TAURI__?.invoke === 'function';
  const calendarPersistence = window.NotchyCalendar.createPersistence({invoke:hasNativeSettings ? window.NotchyIA.invokeCore : undefined, storage:window.localStorage});
  calendar = window.NotchyCalendar.create({host:byId('calendar-player'),locale:i18n.locale,
    load:calendarPersistence.load, save:calendarPersistence.save,
    onClose:calendarClosed,
    onChange() {renderWeather(); syncCalendarLayer();}
  });
  void calendar.refresh();
  search = window.NotchySearch.create({host: byId('search-player'), invoke: invokeSearch, t,
    onOpen: searchOpening, onClose: searchClosed, onSend: searchSend});
  moduleLibrary = window.NotchyModuleLibrary.create({host:byId('module-library-player'), store:communityStore, language:i18n.locale, onClose:closeModuleLibrary, onPlace:placeCommunityModule,
    onBlank() {moduleLibrary.hide(); setModules({enabled:[],slots:[]}); selectViewButton({dataset:{view:'nook'}}); openFromOutside();},
    onDialog(input) {if(input) showFileChooser(input); else {closeFileChooser(); if(view==='module-library') openFromOutside();}}});
  const removeCommunityChange = communityStore.subscribe(() => {
    const previousIds=Object.values(moduleDefinitions).filter(item=>item.community).map(item=>item.id).join(',');
    refreshCommunityDefinitions(); moduleSettings=normalizeModules(moduleSettings);
    if(moduleDraft) moduleDraft=normalizeModules(moduleDraft);
    try {window.localStorage.setItem(moduleStorageKey,JSON.stringify(moduleSettings));} catch {}
    if(previousIds!==communityStore.list().map(item=>item.manifest.id).join(',')) activityScene.reset(); renderModules(); renderHomeLayout();
  });
  experience = window.NotchyExperience.create({healthHost: byId('health-player'), modulesHost: byId('modules-experience'), t, onAction: experienceAction, onModulesChange(value) {if (!moduleEditing) return; moduleDraftOrder = value.order; moduleDraft = normalizeModules({enabled: value.order.filter(id => value.enabled.includes(id)), slots: value.order.filter(id => value.enabled.includes(id)).slice(0,3)}); moduleMessage = ''; renderModules();}});
  byId('modules-experience').querySelector('.experience-heading-actions').append(modulesPlayer.querySelector('.module-editor-actions'));
  const libraryButton = document.createElement('button'); libraryButton.type='button'; libraryButton.className='experience-back'; libraryButton.textContent=t('Bibliothèque'); libraryButton.dataset.moduleLibrary=''; libraryButton.addEventListener('click',showModuleLibrary);
  byId('modules-experience').querySelector('.experience-heading-actions').prepend(libraryButton);
  const emptyLibraryButton=document.createElement('button'); emptyLibraryButton.type='button'; emptyLibraryButton.dataset.moduleLibraryEmpty=''; emptyLibraryButton.textContent=t('Bibliothèque de modules'); emptyLibraryButton.addEventListener('click',showModuleLibrary); byId('home-empty').append(emptyLibraryButton);
  sharingExperience = window.NotchySharingExperience.create({host:byId('sharing-experience'), t, onAction:sharingAction});
  ia = window.NotchyIA.create({document,t,
    onTab(tab) {if (getModuleEditorActive() && tab !== 'modules') closeModuleEditor(false); const route=tab==='general'?'settings':tab; menu.querySelector('[data-view="'+route+'"]').click();},
    onRoute: openActivityDetail,
    onNativeHealth: () => window.NotchyIA.invokeCore('health_run',{}),
    async onScan() {const result=await window.NotchyIA.invokeCore('discovery_scan',{}); if (result) await readNearby(); return result;}
  });
  welcome = window.NotchyWelcome.create({host: byId('welcome-player'), start: () => finishWelcome('rest', true), tutorialFinish: () => finishWelcome('rest', true), stageChanged: stage => {welcomeStage = stage; if (view === 'welcome') update();}, motion: motionEnabled});
  document.addEventListener('change', languageChoice);
  removeLanguage = i18n.onChange(renderLanguage);
  for (const choice of document.querySelectorAll('[data-language-choice]')) choice.value = i18n.locale();
  for (const id of Object.keys(moduleDefinitions).filter(id => !moduleDefinitions[id].community && !byId('module-catalog').querySelector(`[data-module-id="${id}"]`))) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.moduleCommand = 'pick'; button.dataset.moduleId = id; button.draggable = true;
    const tile = document.createElement('span'); tile.className = 'module-tile'; tile.append(byId(moduleDefinitions[id].element).querySelector('svg').cloneNode(true));
    tile.append(byId('module-catalog').querySelector('.module-installed').cloneNode(true)); const label = document.createElement('span'); label.className = 'module-label'; label.textContent = moduleLabels[id]; button.append(tile, label); byId('module-catalog').append(button);
  }
  scenarioController = createScenarioController({value: scenarioPreferences, activity: scenarioActivity, enabled: configuredModuleOrder, interacting: scenarioInteracting,
    schedule: window.setTimeout.bind(window), unschedule: window.clearTimeout.bind(window), changed: scenarioChanged,
    save: value => {try {window.localStorage.setItem(scenarioStorageKey, JSON.stringify(value));} catch {}}});
  islandPage = scenarioNookPage(scenarioController.getPreferences().selected) || islandPage;
  renderScenarios();
  renderAppearance(); renderHomeLayout(); renderModules(); renderFocus(); renderFiles(); renderWeather();
  setState('rest');
  void readNearby();
  renderSettings();
  let welcomeDone = false; try { welcomeDone = window.localStorage.getItem(welcomeStorageKey) === 'done'; } catch {}
  if (!welcomeDone) showWelcome();
})(typeof window === 'object' ? window : null);
