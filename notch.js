(function (window) {
  'use strict';

  // A lightly underdamped spring keeps reversal momentum with about 1.5% rebound.
  function createSurfaceMotion() {
    const keys = ['width', 'height', 'band', 'radius', 'progress'];
    const values = {}, velocities = {}, target = {};
    let initialized = false, lastTime = 0, active = false;

    function snap() {
      for (const key of keys) { values[key] = target[key]; velocities[key] = 0; }
      active = false;
    }

    function setTarget(next, {snap: immediate = false} = {}) {
      if (!keys.every(key => Number.isFinite(next[key]))) return false;
      for (const key of keys) target[key] = next[key];
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
        const omega = 34, damping = .8, decay = omega * damping;
        const frequency = omega * Math.sqrt(1 - damping * damping);
        const attenuation = Math.exp(-decay * dt), sine = Math.sin(frequency * dt), cosine = Math.cos(frequency * dt);
        for (const key of keys) {
          const displacement = values[key] - target[key];
          const velocity = velocities[key];
          values[key] = target[key] + (displacement * cosine + (velocity + decay * displacement) / frequency * sine) * attenuation;
          velocities[key] = (velocity * cosine - (decay * velocity + omega * omega * displacement) / frequency * sine) * attenuation;
        }
        active = keys.some(key => Math.abs(values[key] - target[key]) > .01 || Math.abs(velocities[key]) > .1);
        if (!active) snap();
      }
      return {...values};
    }

    return Object.freeze({setTarget, step, isActive: () => active});
  }

  function shape({width, height, radius}, viewportWidth) {
    const round = value => Math.round(value * 1000) / 1000;
    height = Math.max(1, round(height));
    const shoulder = round(Math.min(24, height * .35, Math.max(0, (viewportWidth - width) / 2)));
    radius = Math.max(0, Math.min(round(width) / 2, height / 2, round(radius)));
    const right = round(shoulder + width), totalWidth = round(width + shoulder * 2);
    const bottom = round(height - radius);
    const path = `M0 0 H${totalWidth} Q${right} 0 ${right} ${shoulder} V${bottom} Q${right} ${height} ${round(right - radius)} ${height} H${round(shoulder + radius)} Q${shoulder} ${height} ${shoulder} ${bottom} V${shoulder} Q${shoulder} 0 0 0 Z`;
    return {width: round(width), height, shoulder, radius, totalWidth, path};
  }

  function normalizeMusic(value = {}, previous = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
    const text = item => typeof item === 'string' ? item.slice(0, 240) : '';
    const title = text(value.title), artist = text(value.artist), source = text(value.source);
    const available = value.available === true;
    const number = item => Number.isFinite(item) ? Math.max(0, Math.min(604800, item)) : 0;
    const duration = number(value.duration);
    let cover = typeof value.cover === 'string' && value.cover.length <= 5_400_000 && /^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/]+={0,2}$/.test(value.cover) ? value.cover : '';
    if (value.cover === undefined && title === previous.title && artist === previous.artist && source === previous.source) cover = previous.cover || '';
    return {available, title, artist, source, cover: available ? cover : '', playing: available && value.playing === true,
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
    if (!dominant) return '#ffffff';
    const rgb = ['r', 'g', 'b'].map(key => Math.round(dominant[key] / dominant.weight));
    const lift = Math.max(0, 145 - Math.max(...rgb));
    return '#' + rgb.map(value => Math.min(255, value + lift).toString(16).padStart(2, '0')).join('');
  }

  // Each module declares its content size and band behavior; the notch owns geometry.
  const moduleLayouts = {
    music: {minWidth: 300, basis: 360, maxWidth: 440, height: 176, panelWidth: 440},
    focus: {minWidth: 252, basis: 280, maxWidth: 336, height: 184, panelWidth: 400},
    weather: {minWidth: 288, basis: 320, maxWidth: 384, height: 208, panelWidth: 424},
    shelf: {minWidth: 300, basis: 360, maxWidth: 480, height: 208, panelWidth: 560},
  };
  const moduleDefinitions = Object.freeze(Object.fromEntries([
    ['music', 'Musique', 'music-player', 'music', 160, 154, 'progress', 'spectrum', ['track', 'pause', 'resume'], 0],
    ['focus', 'Focus', 'focus-player', 'focus', 180, 160, 'progress', 'ring', ['start', 'stop', 'pause', 'resume', 'phase', 'complete'], 1],
    ['shelf', 'Étagère', 'shelf-player', 'tray', 160, 148, 'none', 'none', ['sent', 'received', 'complete', 'kept'], null],
    ['weather', 'Météo', 'weather-player', 'weather', 168, 164, 'none', 'none', [], 2],
  ].map(([id, label, element, view, minWidth, minHeight, discreet, hover, changes, initialSlot]) => [id, Object.freeze({
    id, label, element, view, defaultInstalled: true, initialSlot, directOpen: ['shelf', 'weather'].includes(id),
    size: Object.freeze({width: moduleLayouts[id].panelWidth, height: moduleLayouts[id].height + 30, minWidth, minHeight, maxHeight: 300}),
    layout: Object.freeze({...moduleLayouts[id], minHeight: moduleLayouts[id].height}),
    editor: Object.freeze({basis: moduleLayouts[id].basis + 24, maxWidth: moduleLayouts[id].maxWidth + 24, height: moduleLayouts[id].height + 24, grow: id === 'music' ? 1.3 : 1}),
    band: Object.freeze({discreet, hover, changes: Object.freeze(changes)}),
  })])));
  function getModuleDefinitions() { return JSON.parse(JSON.stringify(Object.values(moduleDefinitions))); }

  function homeModuleLayout(ids, availableWidth, gap = 16, context = {}) {
    const ordered = Array.isArray(ids) ? ids.filter((id, index, list) => typeof id === 'string' && Object.hasOwn(moduleDefinitions, id) && list.indexOf(id) === index).slice(0, 4) : [];
    const placed = ordered.filter((id, index) => id !== 'shelf' || index === 0);
    const width = Number.isFinite(availableWidth) ? Math.max(0, availableWidth) : 0;
    gap = Number.isFinite(gap) ? Math.max(0, Math.min(32, gap)) : 16;
    if (!context || typeof context !== 'object' || Array.isArray(context)) context = {};
    const items = placed.map(id => {
      const definition = moduleDefinitions[id], compact = false;
      const layout = definition.layout;
      const expandedHeight = id === 'weather' && context.weatherPicker === true ? 248 : id === 'focus' && context.focusConfig === true ? 224 : 0;
      return {id, compact, minWidth: compact ? layout.previewMinWidth : layout.minWidth,
        minHeight: Math.max(compact ? layout.previewHeight : layout.height, expandedHeight),
        basis: compact ? layout.previewBasis : layout.basis, maxWidth: compact ? layout.previewMaxWidth : layout.maxWidth};
    });
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
      for (const [column, item] of line.entries()) Object.assign(item, {row, column, height: item.minHeight, share: total ? item.width * 100 / total : 100});
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
  function moduleEditorPresentation(value, picked = null) {
    const normalized = normalizeModules(value), slots = normalized.slots.map(id => normalized.enabled.includes(id) ? id : null);
    const filled = slots.map((id, index) => id ? index : -1).filter(index => index >= 0), last = filled.at(-1) ?? -1;
    let free = slots.findIndex((id, index) => !id && index > last);
    if (free < 0) free = slots.findIndex(id => !id);
    const selecting = Object.hasOwn(moduleDefinitions, picked || ''), indices = [...filled];
    if (free >= 0 && (selecting || !filled.length)) indices.push(free);
    const widths = indices.map(index => moduleDefinitions[slots[index] || (selecting ? picked : '')]?.editor.basis || 180);
    return {slots, indices, free, height: Math.max(184, ...indices.map(index => moduleDefinitions[slots[index] || (selecting ? picked : '')]?.editor.height || 184)), width: Math.min(880, Math.max(620, widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * 12 + 46))};
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

  function closedBandSize(state, {music = false, focus = false, transfer = false, feedback = null} = {}) {
    if (state === 'discreet') return {width: 260, band: 14, radius: 4, progress: 0};
    let size = {width: 312, band: 36, radius: 12, progress: 0};
    if (feedback === 'done') size = {width: 440, band: 110, radius: 18, progress: 0};
    if (feedback === 'track') size = {width: 312, band: 44, radius: 12, progress: 0};
    if (transfer) size = {width: 312, band: 36, radius: 12, progress: 0};
    return size;
  }

  if (typeof module === 'object' && module.exports) module.exports = {FocusModel, focusConfiguration, focusCardValues, weatherNarrative, normalizeAppearance, normalizeModules, assignModuleSlot, moduleEditorPresentation, homeModuleLayout, getModuleDefinitions, moduleActivitySnapshot, moduleActivityChange, createSurfaceMotion, shape, normalizeMusic, musicPosition, spectrumLevels, artworkColor, closedBandSize};
  if (!window?.document) return;

  const document = window.document;
  const notch = document.getElementById('notch');
  const toggle = document.getElementById('notch-toggle');
  const panel = document.getElementById('notch-panel');
  const menu = document.getElementById('notch-menu');
  const menuButtons = [...menu.querySelectorAll('[data-view]')];
  const surface = document.getElementById('notch-surface');
  const contour = document.getElementById('notch-shape');
  const bandCut = document.getElementById('notch-band-cut');
  const panelCut = document.getElementById('notch-panel-cut');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motion = createSurfaceMotion();
  const sizes = {
    discreet: closedBandSize('discreet'),
    hover: closedBandSize('hover'),
    open: {width: 560, band: 40, radius: 18, progress: 1},
  };
  let state = 'discreet', view = 'nook', frame = 0, disposed = false, geometry, collapseTimer = 0, collapseDeferred = false, fileDialogOpen = false;
  let homeLayout = null, openWidth = 0, pointerInside = false, keyboardNavigation = false, activationPoint = null, naturalOpenHeight = 0;
  let localSendContext = null, nearbyMutation = 0, nearbyLoaded = false;
  const byId = id => document.getElementById(id);
  const desktop = window.notchyDesktop?.isDesktop ? window.notchyDesktop : null;
  let desktopMaxHeight = 700, desktopRemoveResume = null, desktopMouse = null, desktopInteractive = false;
  if (desktop) { document.documentElement.dataset.desktop = 'true'; document.body.classList.add('desktop'); }
  let appearance = normalizeAppearance();
  try { appearance = normalizeAppearance(JSON.parse(window.localStorage.getItem('notchy-minimal-appearance-v1'))); } catch {}
  const appearanceFormats = {compact: {width: 520, height: 180}, balanced: {width: 560, height: 196}, comfortable: {width: 620, height: 216}};
  function motionEnabled() { return appearance.motion && !reduced.matches; }
  function renderAppearance() {
    document.body.dataset.motion = String(motionEnabled());
    document.body.dataset.appearanceFormat = appearance.format;
    byId('appearance-format').value = appearance.format; byId('appearance-radius').value = appearance.radius;
    byId('appearance-radius-value').value = appearance.radius; byId('appearance-motion').checked = appearance.motion;
  }
  function setAppearance(value, persist = true) {
    if (disposed) return false;
    if (value.format && value.format !== appearance.format) openWidth = 0;
    appearance = normalizeAppearance({...appearance, ...value});
    if (persist) try { window.localStorage.setItem('notchy-minimal-appearance-v1', JSON.stringify(appearance)); } catch {}
    renderAppearance(); update(); musicLifecycle(); return true;
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
    const interactive = !!hit?.closest('#notch-toggle,#notch-panel,#notch-menu,#module-feedback-actions');
    if (interactive !== desktopInteractive) { desktopInteractive = interactive; desktop.setInteractive(interactive); }
  }
  function desktopFocus(event) { if (desktop && event.target.closest('#notch')) desktop.focus(); }
  const player = byId('music-player'), live = byId('music-live'), strip = byId('music-discreet-progress');
  const commands = [...panel.querySelectorAll('[data-music-command]')];
  const spectrumBars = [...notch.querySelectorAll('.music-spectrum i')];
  const liveBars = [...byId('music-live-spectrum').children], playerBars = [...byId('music-player-spectrum').children], feedbackBars = [...byId('module-feedback-spectrum').children];
  const coverImages = [byId('music-cover'), byId('music-live-cover')];
  let spectrumArtwork = '';
  let music = normalizeMusic(), musicAt = window.performance.now(), musicError = '';
  let stream = null, retiringStream = null, streamSpectrum = false, clock = 0, clockDelay = 0, commandBusy = false, connectionLost = false;
  const musicSeek = byId('music-seek');
  let seekPreview = null, seekTrack = null, seekDragging = false;
  const shelfPlayer = byId('shelf-player'), shelfInput = byId('shelf-input'), shelfList = byId('shelf-list');
  const selectedFiles = new Set();
  let shelfItems = [], shelfLoaded = false, shelfBusy = false, shelfError = '', shelfEpoch = 0, fileDragging = false, dragDepth = 0;
  // Original module editor: four independent previews, then the integrated palette.
  const modulesPlayer = byId('modules-player'), moduleStorageKey = 'notchy-minimal-modules-v1';
  const moduleLabels = Object.fromEntries(Object.values(moduleDefinitions).map(item => [item.id, item.label]));
  let queueOpen = false, queueReturnView = 'music', queueActive = false, queueBusy = false, queueTimer = 0, queueEpoch = 0, queueRetryUntil = 0, queueListSignature = '';
  let queueState = {status: 'disconnected', current: null, items: [], message: ''};
  let queueNotice = '', queueOperation = '';
  let welcome = null;
  const welcomeStorageKey = 'notchy-minimal-welcome-v1';
  let welcomeReturnView = 'nook', welcomeReturnState = 'open';
  function showWelcome(mode = 'welcome') {
    if (disposed || !welcome) return false;
    if (getModuleEditorActive()) closeModuleEditor(false);
    if (view !== 'welcome') { welcomeReturnView = view; welcomeReturnState = state === 'discreet' ? 'open' : state; }
    clearModuleFeedback(); selectViewButton({dataset: {view: 'welcome'}}); setState('open'); welcome.show(mode);
    return true;
  }
  function finishWelcome(nextState = welcomeReturnState) {
    welcome?.hide();
    try { window.localStorage.setItem(welcomeStorageKey, 'done'); } catch {}
    selectViewButton({dataset: {view: welcomeReturnView || 'nook'}}); setState(nextState);
  }
  function replayWelcome() { showWelcome(); }
  let moduleFeedback = null, moduleFeedbackTimer = 0, moduleFeedbackSequence = 0;
  const moduleFeedbackAnimations = new Set();
  const moduleActivityStates = new Map();
  function animateModuleChange(element) {
    if (!element || !motionEnabled() || document.hidden || !element.getClientRects().length) return;
    const animation = element.animate([{opacity: .55, translate: '0 3px'}, {opacity: 1, translate: '0 0'}], {duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)'});
    moduleFeedbackAnimations.add(animation); animation.finished.then(() => moduleFeedbackAnimations.delete(animation), () => moduleFeedbackAnimations.delete(animation));
  }
  function renderModuleFeedback() {
    const feedback = moduleFeedback && isModuleEnabled(moduleFeedback.id) ? moduleFeedback : null;
    const closed = byId('module-feedback-live'), opened = byId('module-feedback-open');
    closed.hidden = !feedback || state !== 'hover' || fileDragging;
    opened.hidden = !feedback || state !== 'open' || fileDragging;
    const done = !!feedback && (feedback.id === 'shelf' || feedback.id === 'focus' && (feedback.kind === 'complete' || feedback.kind === 'phase' && focus.pomodoro?.phase === 'break'));
    notch.dataset.feedback = feedback ? done ? 'done' : feedback.id === 'music' && feedback.kind === 'track' ? 'track' : 'change' : '';
    const actions = byId('module-feedback-actions'); actions.hidden = closed.hidden || !done;
    byId('module-feedback-spectrum').hidden = closed.hidden || feedback?.id !== 'music';
    if (!feedback) return;
    for (const id of ['module-feedback-title', 'module-feedback-open-title']) text(byId(id), feedback.title);
    text(byId('module-feedback-detail'), feedback.detail);
    text(byId('module-feedback-label'), done ? feedback.id === 'focus' ? 'SESSION TERMINÉE' : 'C’EST PRÊT' : feedback.id === 'music' ? 'EN LECTURE' : 'FOCUS');
    if (done && feedback.id === 'focus') {
      text(byId('module-feedback-title'), focus.task?.trim() || (feedback.kind === 'complete' ? 'Cycle terminé' : 'Un moment pour souffler'));
      text(byId('module-feedback-detail'), focus.pomodoro?.phase === 'break' && !focus.complete ? 'La pause a commencé' : 'Travail et pauses terminés');
    } else if (feedback.id === 'music') { text(byId('module-feedback-title'), music.title || feedback.title); text(byId('module-feedback-detail'), music.artist || music.source); }
    const cycles = byId('module-feedback-cycles'); cycles.hidden = !done || feedback.id !== 'focus';
    if (!cycles.hidden) {
      const card = focusCardValues(focus, focusSettings), signature = card.completed + '/' + card.total;
      if (cycles.dataset.value !== signature) { cycles.dataset.value = signature; cycles.replaceChildren(...Array.from({length: card.total}, (_, index) => { const pip = document.createElement('i'); pip.className = index < card.completed ? 'completed' : ''; return pip; })); const label = document.createElement('small'); label.textContent = `${card.completed} sur ${card.total}`; cycles.append(label); }
    }
    text(actions.querySelector('[data-feedback-command="open"]'), feedback.id === 'focus' ? focus.complete ? 'Voir Focus' : 'Voir la pause' : 'Voir le résultat');
    actions.querySelector('[data-feedback-command="skip"]').hidden = feedback.id !== 'focus' || !focusIsActive() || focus.pomodoro?.phase !== 'break';
    notch.style.setProperty('--module-feedback-color', feedback.id === 'music' ? notch.style.getPropertyValue('--spectrum-color') || '#ffffff' : ['files', 'shelf'].includes(feedback.id) ? '#76d6aa' : feedback.kind === 'phase' && focus.pomodoro?.phase === 'break' ? '#62e7ad' : '#78cecc');
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
    if (render && !disposed) { renderModuleFeedback(); renderLiveActivities(); update(); }
  }
  function notifyModuleChange(event) {
    if (event?.id === 'files') event = {...event, id: 'shelf'};
    const definition = moduleDefinitions[event?.id];
    if (disposed || !definition || !isModuleEnabled(event.id) || !definition.band.changes.includes(event.kind) || document.hidden) return;
    const restoreQuiet = state === 'discreet' || moduleFeedback?.restoreQuiet === true;
    clearModuleFeedback(false);
    moduleFeedback = {...event, sequence: ++moduleFeedbackSequence, restoreQuiet};
    text(byId('module-feedback-announcer'), `${definition.label} · ${event.title} · ${event.detail}`);
    if (state === 'discreet' && !protectedInteraction()) setState('hover');
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
      if (quiet && state === 'hover' && !pointerInside && !protectedInteraction()) setState('discreet');
    }, 2800);
  }
  function observeModuleActivity(id, value) {
    const next = moduleActivitySnapshot(id, value), previous = moduleActivityStates.get(id);
    moduleActivityStates.set(id, next);
    const event = moduleActivityChange(id, previous, next); if (event) notifyModuleChange(event);
  }
  function feedbackVisibility() { if (document.hidden) clearModuleFeedback(); }
  function feedbackCommand(event) {
    const command = event.target.closest('[data-feedback-command]')?.dataset.feedbackCommand, feedback = moduleFeedback;
    if (!command || !feedback || disposed) return;
    event.stopPropagation();
    if (command === 'skip' && feedback.id === 'focus') { clearModuleFeedback(); focusComponent.command('skip'); return; }
    const id = feedback.id; clearModuleFeedback(); selectViewButton({dataset: {view: moduleDefinitions[id].view}}); setState('open');
  }
  const moduleMime = 'application/x-notchy-module';
  let moduleSettings = normalizeModules(), moduleDraft = null, moduleMessage = '', moduleEditing = false;
  let modulePicked = null, moduleSelected = 0, modulePreviousView = 'nook', modulePreviousState = 'open', moduleReturnFocus = null;
  try {
    const saved = window.localStorage.getItem(moduleStorageKey);
    if (saved && saved.length <= 8192) moduleSettings = normalizeModules(JSON.parse(saved));
  } catch {}
  function getModules() { return {enabled: [...moduleSettings.enabled], slots: [...moduleSettings.slots]}; }
  function isModuleEnabled(id) { return moduleSettings.enabled.includes(id); }
  function getHomeSlots() { return moduleSettings.slots.map(id => isModuleEnabled(id) ? id : null); }
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
    moduleMessage = 'Disposition appliquée.';
    if (persist) try {
      window.localStorage.setItem(moduleStorageKey, JSON.stringify(moduleSettings)); moduleMessage = 'Disposition enregistrée.';
    } catch { moduleMessage = 'Disposition appliquée pour cette fenêtre.'; }
    if (typeof modulesChanged === 'function') modulesChanged(previous);
    renderModules(); return true;
  }
  function moduleEditorLayout(opening = false, closing = false) {
    notch.dataset.moduleEditing = String(moduleEditing);
    if (typeof moduleEditorLayoutChanged === 'function') moduleEditorLayoutChanged({active: moduleEditing, opening, closing, previousView: modulePreviousView, previousState: modulePreviousState});
    renderModules();
  }
  function openModuleEditor(event) {
    if (disposed) return false;
    if (moduleEditing) return true;
    modulePreviousView = view; modulePreviousState = state; moduleReturnFocus = document.activeElement;
    moduleDraft = getModules(); modulePicked = null; moduleMessage = ''; moduleEditing = true;
    const target = event?.target?.closest?.('[data-home-slot], [data-module-open]');
    const index = target?.dataset.homeSlot ?? moduleDraft.slots.indexOf(target?.dataset.moduleOpen);
    moduleSelected = Number.isInteger(Number(index)) && Number(index) >= 0 && Number(index) < 4 ? Number(index) : Math.max(0, moduleDraft.slots.findIndex(Boolean));
    moduleEditorLayout(true); modulesPlayer.querySelector(`[data-module-slot-box="${moduleSelected}"]`).focus({preventScroll: true}); return true;
  }
  function closeModuleEditor(commit = false) {
    if (!moduleEditing) return false;
    const value = moduleDraft; moduleEditing = false; moduleDraft = null; modulePicked = null;
    if (commit) setModules(value); else moduleMessage = 'Changements annulés.';
    moduleEditorLayout(false, true);
    if (moduleReturnFocus?.isConnected && moduleReturnFocus.tabIndex >= 0 && !moduleReturnFocus.closest('[hidden],[inert]')) moduleReturnFocus.focus({preventScroll: true});
    else if (state === 'open') menu.querySelector('[data-view="nook"]').focus({preventScroll: true});
    else if (modulesPlayer.contains(document.activeElement)) document.activeElement.blur();
    return true;
  }
  function moduleContextMenu(event) {
    const target = event.target;
    if (welcome?.isActive() || !notch.contains(target) || target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])') || window.getSelection()?.toString().trim()) return false;
    event.preventDefault(); return openModuleEditor(event);
  }
  function modulePreview(host, id, compact = false) {
    const make = (tag, className, value) => { const node = document.createElement(tag); if (className) node.className = className; if (value !== undefined) node.textContent = value; return node; };
    const glyph = name => byId('module-catalog').querySelector(`[data-module-id="${name}"] .module-tile > svg`).cloneNode(true);
    const providerBadge = art => { if (!/spotify/i.test(music.source)) return; const badge = make('span', 'music-provider-badge'); badge.setAttribute('aria-label', 'Spotify'); const logo = make('img'); logo.src = '/spotify.ico'; logo.alt = ''; badge.append(logo); art.append(badge); };
    host.replaceChildren();
    if (compact) {
      const icon = make('span', 'module-preview-compact-icon'), copy = make('div', 'module-preview-compact-copy');
      let title = id ? moduleLabels[id] : 'Ajouter', detail = 'Libre';
      if (id) icon.append(glyph(id)); else icon.textContent = '+';
      if (id === 'music') {
        title = music.available ? music.title || 'Musique' : 'Musique'; detail = music.available ? music.artist || music.source : 'Aucun morceau en cours';
        if (music.cover) { const image = make('img'); image.src = music.cover; image.alt = ''; icon.replaceChildren(image); }
        if (music.available) providerBadge(icon);
      } else if (id === 'focus') { const value = focusCardValues(focus, focusSettings); title = time(value.seconds); detail = focusIsActive() ? focusLabel() : focus.complete ? 'Cycle terminé' : 'Focus · Prêt à commencer'; }
      else if (id === 'shelf') detail = shelfLoaded ? `${shelfItems.length} fichier${shelfItems.length === 1 ? '' : 's'}` : 'Chargement…';
      else if (id === 'weather') { const value = weatherNarrative(getWeatherState()); title = Number.isFinite(weather.temperature) ? `${value.temperature} · ${value.city}` : 'Météo'; detail = weather.condition || 'Choisir une ville'; }
      const name = make('strong', '', title), subtitle = make('small', '', detail); name.title = title; subtitle.title = detail;
      copy.append(name, subtitle); host.append(icon, copy); return;
    }
    if (id === 'music' && music.available) {
      const top = make('div', 'module-preview-music-top'), art = make('div', 'module-preview-art'), copy = make('div', 'module-preview-music-copy');
      if (music.cover) { const img = make('img'); img.src = music.cover; img.alt = ''; art.append(img); } else art.append(glyph('music'));
      providerBadge(art);
      const spectrum = byId('music-player-spectrum').cloneNode(true); spectrum.removeAttribute('id');
      copy.append(make('strong', '', music.title || 'Musique'), make('small', '', music.artist || '')); top.append(art, copy, spectrum); host.append(top);
      const elapsed = position(), timeline = make('div', 'module-preview-music-timeline'), bar = make('span', 'module-preview-progress'), fill = make('i');
      fill.style.width = (music.duration > 0 ? Math.min(1, Math.max(0, elapsed / music.duration)) * 100 : 0) + '%'; bar.append(fill);
      timeline.append(make('small', '', time(elapsed)), bar, make('small', '', music.duration > 0 ? '−' + time(Math.max(0, music.duration - elapsed)) : '—:—')); host.append(timeline);
      const controls = make('div', 'module-preview-transport');
      for (const name of ['previous', 'toggle', 'next']) { const svg = player.querySelector(`[data-music-command="${name}"] svg`)?.cloneNode(true); if (svg) { svg.removeAttribute('id'); for (const node of svg.querySelectorAll('[id]')) node.removeAttribute('id'); controls.append(svg); } }
      host.append(controls); return;
    }
    if (id === 'weather') {
      const next = weatherNarrative(getWeatherState()), row = pairs => { const line = make('p', 'module-preview-weather-line'); for (const [value, emphasized] of pairs) line.append(make(emphasized ? 'strong' : 'span', '', value)); return line; };
      const current = row([[next.temperature, true], [next.when, false]]); current.classList.add('module-preview-weather-current');
      const forecast = row([[next.rain, true], [next.rainQualifier, false]]); forecast.setAttribute('aria-label', next.forecastDescription);
      host.append(current, row([['à', false], [next.city, true]]), row([['ressenti', false], [next.feelsLike, true]]), forecast, make('small', 'module-preview-weather-horizon', next.horizon));
      return;
    }
    if (id === 'focus') { host.append(focusComponent.preview()); return; }
    const empty = make('div', 'module-preview-empty');
    if (!id) { empty.append(make('span', 'module-preview-add', '+'), make('strong', '', 'Ajouter un module'), make('small', '', 'Choisis une icône ci-dessous')); host.append(empty); return; }
    empty.append(glyph(id));
    if (id === 'shelf') empty.append(make('strong', '', 'Tray'), make('small', '', shelfItems.length ? `${shelfItems.length} fichier${shelfItems.length > 1 ? 's' : ''}` : ''));
    else empty.append(make('strong', '', id === 'music' ? 'Musique' : 'Météo'), make('small', '', id === 'music' ? 'Aucun morceau en cours' : 'Choisir une ville'));
    host.append(empty);
  }
  function renderModules() {
    if (disposed) return;
    modulesPlayer.hidden = !moduleEditing; if (!moduleEditing || !moduleDraft) return;
    const layout = moduleEditorPresentation(moduleDraft, modulePicked), slots = layout.slots, primary = Math.max(0, slots.findIndex(Boolean));
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
      const preferred = moduleDefinitions[id || modulePicked]?.editor || {basis: 180, maxWidth: 260, height: 156, grow: 1};
      for (const [name, value] of Object.entries(preferred)) frame.style.setProperty(`--slot-${name}`, name === 'grow' ? String(value) : `${value}px`);
      frame.querySelector('.module-slot-caption').textContent = String(index + 1);
      frame.setAttribute('aria-label', `Emplacement ${index + 1} · ${index === primary ? 'affichage principal' : 'accès rapide'} · ${id ? moduleLabels[id] : 'ajouter un module'}`);
      remove.hidden = !id; remove.setAttribute('aria-label', `Retirer ${moduleLabels[id] || 'le module'} de cet emplacement`);
      const preview = frame.querySelector('.module-preview'), previewKey = `${id || ''}/${index === primary}`;
      if (!frame.hidden) modulePreview(preview, id, false); else preview.replaceChildren();
      if (preview.dataset.key && preview.dataset.key !== previewKey) animateModuleChange(preview);
      preview.dataset.key = previewKey;
      if (focused === remove && !id) frame.focus({preventScroll: true});
    }
    if (focused?.closest('[data-module-slot-box]')?.hidden) modulesPlayer.querySelector(`[data-module-slot-box="${moduleSelected}"]`)?.focus({preventScroll: true});
    for (const button of modulesPlayer.querySelectorAll('#module-catalog [data-module-id]')) {
      const id = button.dataset.moduleId, installed = slots.includes(id);
      button.title = moduleLabels[id];
      button.setAttribute('aria-pressed', String(modulePicked === id)); button.setAttribute('aria-label', `${moduleLabels[id]}${installed ? ' · placé' : ''} · choisir un emplacement`);
      button.querySelector('.module-installed').hidden = !installed;
    }
    byId('modules-status').textContent = moduleMessage;
    byId('module-editor-hint').textContent = moduleMessage || 'Choisis un module, puis son emplacement.';
  }
  function placeModuleDraft(index, id) {
    if (!moduleDraft || !Object.hasOwn(moduleLabels, id)) return;
    if (!moduleDraft.enabled.includes(id)) moduleDraft.enabled.push(id);
    moduleDraft = assignModuleSlot(moduleDraft, index, id); moduleSelected = index; modulePicked = null;
    moduleMessage = `${moduleLabels[id]} placé.`; moduleEditorLayout();
  }
  function removeModuleDraft(index) {
    const id = moduleDraft?.slots[index]; if (!id) return;
    moduleDraft.slots[index] = null; moduleDraft.enabled = moduleDraft.enabled.filter(item => item !== id); moduleSelected = index; modulePicked = null;
    moduleMessage = `${moduleLabels[id]} retiré.`; moduleEditorLayout();
  }
  function moduleCommand(event) {
    if (disposed || !moduleEditing || !moduleDraft) return;
    const button = event.target.closest('[data-module-command]');
    if (button?.dataset.moduleCommand === 'apply') { closeModuleEditor(true); return; }
    if (button?.dataset.moduleCommand === 'cancel') { closeModuleEditor(false); return; }
    if (button?.dataset.moduleCommand === 'remove') { removeModuleDraft(Number(button.closest('[data-module-slot-box]').dataset.moduleSlotBox)); return; }
    if (button?.dataset.moduleCommand === 'pick' && Object.hasOwn(moduleLabels, button.dataset.moduleId)) {
      modulePicked = button.dataset.moduleId; const existing = moduleDraft.slots.indexOf(modulePicked); if (existing >= 0) moduleSelected = existing;
      moduleMessage = `${moduleLabels[modulePicked]} sélectionné. Choisis un emplacement.`; moduleEditorLayout(); return;
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
      if (modulePicked) { modulePicked = null; moduleMessage = 'Choix annulé.'; moduleEditorLayout(); } else closeModuleEditor(false);
      return true;
    }
    const frame = event.target.closest?.('[data-module-slot-box]');
    if (frame && event.target === frame) {
      if (['Enter', ' '].includes(event.key)) { event.preventDefault(); if (modulePicked) placeModuleDraft(Number(frame.dataset.moduleSlotBox), modulePicked); return true; }
      if (['Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); removeModuleDraft(Number(frame.dataset.moduleSlotBox)); return true; }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); const frames = [...modulesPlayer.querySelectorAll('[data-module-slot-box]')].filter(item => !item.hidden), direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
        const next = frames[(frames.indexOf(frame) + direction + frames.length) % frames.length]; moduleSelected = Number(next.dataset.moduleSlotBox); renderModules(); next.focus(); return true;
      }
    }
    const button = event.target.closest?.('#module-catalog [data-module-id]');
    if (button && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const buttons = [...byId('module-catalog').children], index = buttons.indexOf(button), next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length; buttons[next].focus(); return true;
    }
    return false;
  }
  function disposeModules() { moduleEditing = false; moduleDraft = null; modulePicked = null; modulesPlayer.hidden = true; }

  const settingsPlayer = byId('settings-player');
  function renderSettings() {
    settingsPlayer.hidden = view !== 'settings' || getModuleEditorActive();
    renderAppearance();
  }

  function shelfGlyph(kind) {
    const paths = {document: 'M14 3H6v18h12V7zM14 3v5h5M9 12h6M9 16h6', archive: 'M5 3h14v18H5zM11 3v3h2V3M11 8h2v3h-2M11 13h2v4h-2', image: 'M3 4h18v16H3zM3 17l5-6 4 4 3-3 6 6M16 8h.01', audio: 'M9 18V5l11-2v13M9 9l11-2M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6M17 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6', video: 'M3 5h18v14H3zM9 9l6 3-6 3z', file: 'M14 3H6v18h12V7zM14 3v5h5', check: 'm4 12 5 5L20 6'};
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[kind] || paths.file); svg.append(path); return svg;
  }

  const focusPlayer = byId('focus-player'), focusStrip = byId('focus-discreet-progress');
  let focus = FocusModel.defaults(), focusSettings = focusConfiguration();
  const focusComponent = FocusAPI.create({host: focusPlayer, presentation: 'split', motion: motionEnabled, changed: syncFocus});
  focus = focusComponent.getState(); focusSettings = focusComponent.getSettings();
  moduleActivityStates.set('focus', moduleActivitySnapshot('focus', focus));
  function focusIsActive() { return !focus.pomodoro?.finished && (focus.sessionActive || !!focus.deadline); }
  function focusLabel() { return focus.pomodoro?.phase === 'break' ? focus.pomodoro.breakKind === 'long' ? 'Pause longue' : 'Pause courte' : 'Concentration'; }
  function syncFocus(value) {
    if (disposed) return;
    focus = value.state; focusSettings = value.settings;
    const card = value.card;
    notch.style.setProperty('--focus-progress', String(card.progress)); notch.dataset.focusPhase = focus.pomodoro?.phase || 'work';
    text(byId('focus-live-time'), time(card.seconds));
    focusStrip.setAttribute('aria-valuenow', String(Math.round(card.progress * 100)));
    focusStrip.setAttribute('aria-valuetext', focusLabel() + ' · ' + time(card.seconds) + ' restantes');
    observeModuleActivity('focus', focus);
    renderLiveActivities(); renderHomeSummaries(); if (getModuleEditorActive()) renderModules();
    update();
  }
  function renderFocus() {
    if (!disposed) focusComponent.lifecycle({enabled: isModuleEnabled('focus'), hidden: document.hidden, visible: state === 'open' && !focusPlayer.hidden && !getModuleEditorActive()});
  }

  function musicInBand() { return isModuleEnabled('music') && music.available && (state === 'hover' || music.playing && !connectionLost); }
  function renderLiveActivities() {
    const hasMusic = musicInBand(), hasFocus = isModuleEnabled('focus') && focusIsActive(), priority = state === 'hover' && !!moduleFeedback && isModuleEnabled(moduleFeedback.id);
    live.hidden = state !== 'hover' || !hasMusic || fileDragging || priority;
    byId('focus-live').hidden = state !== 'hover' || !hasFocus || fileDragging || priority;
    strip.hidden = state === 'open' || !hasMusic || fileDragging || priority;
    focusStrip.hidden = state !== 'discreet' || !hasFocus || fileDragging;
    notch.dataset.liveCount = String(Number(hasMusic) + Number(hasFocus));
    byId('live-activities').hidden = state !== 'hover' || fileDragging || priority || !(hasMusic || hasFocus);
    renderModuleFeedback();
    const transferBand = localSendBand();
    renderLocalSend();
    if (state !== 'open' && transferBand) {
      byId('live-activities').hidden = true; strip.hidden = true; focusStrip.hidden = true;
      byId('module-feedback-live').hidden = true; byId('module-feedback-actions').hidden = true;
    }
  }
  function homePrimary() { return getModuleEditorActive() ? getModuleEditorSlots()[0] : getHomeSlots().find(Boolean) || null; }
  function homeModuleContext() { return {weatherPicker: weatherPickerOpen, focusConfig: focusComponent?.inspect().configOpen}; }
  function builtinVisible(id) {
    const definition = moduleDefinitions[id], editing = getModuleEditorActive();
    if (id === 'files') return view === 'files' && !editing;
    if (editing && view === 'nook') return false;
    const inHome = view === 'nook' && !editing && homeModuleLayout(getHomeSlots(), 0, 16, homeModuleContext()).items.some(item => item.id === id && !item.compact);
    return !!definition && (definition.directOpen && view === definition.view || (editing ? getModuleEditorOrder().includes(id) : isModuleEnabled(id)) && (view === definition.view || inHome));
  }
  const homeCells = new Map();
  function renderHomeLayout() {
    const home = byId('nook-layout'), main = byId('home-main'), side = byId('home-side'), editing = getModuleEditorActive();
    home.hidden = view !== 'nook' || editing;
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
    update();
  }
  function renderHomeSummaries() {
    for (const button of byId('nook-layout').querySelectorAll('[data-module-open]')) {
      const id = button.dataset.moduleOpen;
      if (!id) continue;
      if (id === 'weather') { renderWeatherSummary(button); continue; }
      text(button.querySelector('strong'), id === 'music' ? music.available ? music.title : 'Aucun morceau' : id === 'focus' ? focusIsActive() ? time(FocusModel.remaining(focus)) : focus.complete ? 'Terminé' : `${focusSettings.work}:00` : !shelfLoaded ? 'Fichiers gardés' : `${shelfItems.length} fichier${shelfItems.length === 1 ? '' : 's'}`);
      text(button.querySelector('small'), id === 'music' ? music.artist || 'Ouvrir le lecteur' : id === 'focus' ? focusIsActive() ? focusLabel() : focus.complete ? 'Cycle terminé' : 'Prêt à commencer' : 'Ouvrir l’Étagère');
    }
  }
  function openBuiltin(event) {
    const button = event.target.closest('[data-module-open]'); if (!button || disposed) return;
    const id = button.dataset.moduleOpen, route = moduleDefinitions[id]?.view;
    if (id === 'modules') { openModuleEditor(event); return; }
    if (route) { selectViewButton({dataset: {view: route}}); setState('open'); }
  }
  function modulesChanged(previous = {enabled: []}) {
    for (const button of menuButtons) if (button.dataset.view === 'focus' || button.dataset.view === 'tray') button.hidden = !isModuleEnabled(button.dataset.view === 'tray' ? 'shelf' : 'focus');
    const current = Object.values(moduleDefinitions).find(item => item.view === view); if (current && !isModuleEnabled(current.id)) view = 'nook';
    renderHomeLayout(); musicLifecycle(); renderFocus(); renderShelf(); renderFiles(); renderWeather(); weatherLifecycle(); renderModules(); renderLiveActivities(); nearbyLifecycle();
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
    if (change.opening) setState('open'); else if (change.closing) setState(change.previousState || 'discreet'); else update();
    renderModules();
  }

  let nearby = {status: desktop?.localSendActive === true ? 'ready' : 'off', available: desktop?.localSendActive === true, peers: [], transfer: null, incoming: null}, nearbyPeer = '', nearbyTimer = 0, nearbyBusy = false, nearbyError = '', nearbyReading = false;
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
  function localSendSize(bytes) { return new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 1}).format(Math.max(0, Number(bytes) || 0) / 1048576) + ' Mo'; }
  function localSendCount(count) { return count + ' fichier' + (count === 1 ? '' : 's'); }
  function localSendBand() {
    const value = localSendPresentation();
    if (!nearbyLoaded || fileDragging) return null;
    const ready = nearby.available && !(isModuleEnabled('music') && music.available && music.playing && !connectionLost) && !(isModuleEnabled('focus') && focusIsActive()) && !moduleFeedback;
    if (!value) return ready ? {stage:'ready', direction:'receive'} : null;
    if (['complete','error','cancelled','rejected'].includes(value.stage) && !moduleFeedback) return null;
    return value;
  }
  function renderLocalSendBand() {
    const band = localSendBand(), live = byId('localsend-live'), progress = byId('localsend-discreet-progress'), receive = band?.direction === 'receive';
    live.hidden = state !== 'hover' || !band;
    progress.hidden = state !== 'discreet' || !band || !['progress', 'complete'].includes(band.stage);
    if (!progress.hidden) {
      const ratio = band.stage === 'complete' ? 1 : band.progress / 100;
      progress.style.setProperty('--localsend-progress', String(ratio));
      progress.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    }
    if (!band) return;
    live.dataset.stage = band.stage;
    byId('localsend-live-icon').setAttribute('href', band.stage === 'ready' ? '#localsend-icon-ready' : band.stage === 'complete' ? '#localsend-icon-done' : '#localsend-icon-share');
    text(byId('localsend-live-title'), band.stage === 'ready' ? 'Prêt à recevoir' : band.stage === 'consent' ? 'Demande de partage' : band.stage === 'complete' ? localSendCount(band.count) + (receive ? band.count === 1 ? ' reçu' : ' reçus' : band.count === 1 ? ' envoyé' : ' envoyés') : band.stage === 'discovery' ? 'Partage local' : receive ? 'Réception' : 'Envoi');
    text(byId('localsend-live-meta'), band.stage === 'progress' ? Math.round(band.progress) + ' %' : band.stage === 'discovery' ? nearby.peers.length + ' appareil' + (nearby.peers.length === 1 ? '' : 's') : band.stage === 'complete' && receive ? 'Étagère' : 'LocalSend');
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
    const title = value.stage === 'discovery' ? 'Envoyer à…' : value.stage === 'waiting' ? value.transfer?.status !== 'waiting' ? 'Préparation de l’envoi' : 'Demande envoyée' : value.stage === 'progress' ? receive ? 'Réception de ' + value.alias : 'Envoi en cours' : success ? 'Terminé' : 'Transfert interrompu';
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
    byId('localsend-retry').disabled = nearbyBusy || !nearby.peers?.some(peer => peer.id === localSendContext.peerId) || !localSendContext.files.length;
    byId('localsend-close').hidden = ['consent','waiting','progress'].includes(value.stage);
    byId('localsend-close').setAttribute('aria-label', value.stage === 'progress' || value.stage === 'waiting' ? 'Revenir au panneau, le transfert continue' : 'Fermer le partage');
    byId('localsend-cancel').disabled = !value.transfer || !['preparing','waiting','sending','receiving'].includes(value.transfer.status);
    byId('localsend-cancel').setAttribute('aria-label', receive ? 'Annuler la réception' : 'Annuler l’envoi');
    byId('localsend-from-icon').setAttribute('href', receive ? '#localsend-icon-phone' : '#localsend-icon-pc');
    byId('localsend-to-icon').setAttribute('href', receive ? '#localsend-icon-pc' : '#localsend-icon-phone');
    text(byId('localsend-waiting-title'), value.transfer?.status === 'waiting' ? 'En attente d’acceptation' : 'Préparation des fichiers');
    text(byId('localsend-waiting-detail'), value.transfer?.status === 'waiting' && value.alias ? value.alias + ' doit accepter la demande' : 'Connexion à l’appareil sélectionné…');
    text(byId('localsend-file-label'), localSendCount(value.count)); text(byId('localsend-peer-label'), value.alias);
    host.style.setProperty('--localsend-progress', String(value.progress / 100));
    byId('localsend-progress-bar').setAttribute('aria-valuenow', String(Math.round(value.progress)));
    text(byId('localsend-percent'), Math.round(value.progress) + ' %');
    text(byId('localsend-bytes'), localSendSize(value.transfer?.transferredBytes || 0) + ' / ' + localSendSize(value.bytes));
    text(byId('localsend-result-title'), success ? receive ? 'Reçu' : 'Envoyé' : value.stage === 'cancelled' ? 'Annulé' : value.stage === 'rejected' ? 'Refusé' : 'Transfert impossible');
    text(byId('localsend-result-detail'), success ? localSendCount(value.count) + ' · ' + localSendSize(value.bytes) + (receive ? ' · Étagère' : ' vers ' + value.alias) : value.error || (value.stage === 'rejected' ? 'L’appareil a refusé la demande.' : 'Le transfert n’a pas été terminé.'));
    text(byId('localsend-result-actions').querySelector('[data-localsend-command="close"]'), receive ? 'Fermer' : 'Terminé');
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
    const peers = nearby.peers || [], devices = byId('localsend-devices'), peerKey = JSON.stringify(peers.map(peer => [peer.id,peer.alias,peer.deviceType]));
    if (devices.dataset.peers !== peerKey) {
      devices.replaceChildren(...peers.map(peer => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'localsend-peer'; button.dataset.localsendPeer = peer.id; button.setAttribute('aria-label', 'Envoyer à ' + peer.alias);
        const bubble = document.createElement('span'); bubble.className = 'localsend-device';
        const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('aria-hidden','true');
        const use = document.createElementNS('http://www.w3.org/2000/svg','use'); use.setAttribute('href', peer.deviceType === 'mobile' ? '#localsend-icon-phone' : '#localsend-icon-laptop'); svg.append(use); bubble.append(svg);
        const label = document.createElement('span'); label.textContent = peer.alias; label.title = peer.alias; button.append(bubble,label); return button;
      })); devices.dataset.peers = peerKey;
    }
    for (const button of devices.children) button.disabled = nearbyBusy || !value.files.length;
    byId('localsend-discover').disabled = nearbyBusy;
    text(byId('localsend-discovery-label'), nearbyBusy ? 'Recherche d’appareils à proximité…' : peers.length ? 'Choisis un appareil à proximité' : nearby.available ? 'Aucun appareil pour le moment' : 'Lancer la recherche sur le réseau local');
    host.dataset.scanning = String(nearby.available || nearbyBusy);
  }
  function openLocalSend(direction, files, source = 'shelf') {
    const incoming = direction === 'receive' ? files : null;
    const rows = incoming ? incoming.files : files;
    localSendContext = {direction, source, files: rows.map(file => ({id:file.id,name:file.name,size:file.size})), totalBytes: incoming?.totalBytes || rows.reduce((sum,file)=>sum+(file.size||0),0), incomingId:incoming?.id, alias:incoming?.alias || '', returnView:view === 'localsend' ? 'tray' : view, previousId:nearby.transfer?.id || '', peerId:'', requested:false, error:''};
    selectViewButton({dataset:{view:'localsend'}}); setState('open');
    if (incoming) byId('shelf-incoming-accept').focus({preventScroll:true});
    else if (!nearby.available) void nearbyRequest({command:'discover'});
  }
  function closeLocalSend(toShelf = false) {
    const context = localSendContext, ongoing = ['waiting','progress'].includes(localSendPresentation()?.stage);
    selectViewButton({dataset:{view:toShelf ? 'tray' : context?.returnView || 'nook'}});
    if (!ongoing) localSendContext = null;
    if (!toShelf) setState('discreet');
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
    if (command === 'discover') {localSendContext.error=''; await nearbyRequest({command:'discover'}); return;}
    if (!peer && command !== 'retry' || nearbyBusy) return;
    const context = localSendContext, peerId = peer?.dataset.localsendPeer || context.peerId;
    if (!nearby.peers?.some(item => item.id === peerId)) return;
    context.peerId = peerId; context.alias = nearby.peers.find(item => item.id === peerId).alias; context.requested = true; context.previousId = nearby.transfer?.id || ''; context.error='';
    const value = {command:'share',peerId,ids:context.files.map(file=>file.id)}; if (context.source === 'files') value.source='files';
    await nearbyRequest(value);
  }
  function renderNearby() {
    if (disposed) return;
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
      text(byId('shelf-incoming-sender'), incoming.alias || 'Appareil LocalSend');
      const files = incoming.files || [], size = localSendSize(incoming.totalBytes);
      text(byId('shelf-incoming-files'), 'veut envoyer ' + localSendCount(files.length) + ' · ' + size);
      byId('shelf-incoming-files').title = files.map(file => file.name).join('\n');
    }
    for (const id of ['shelf-incoming-accept', 'shelf-incoming-reject']) byId(id).disabled = nearbyBusy || !incoming;
    const transfer = nearby.transfer, ongoing = transfer && ['preparing', 'waiting', 'sending', 'receiving'].includes(transfer.status);
    const receiving = transfer?.direction === 'receive';
    shelfPlayer.dataset.incoming = String(!!incoming || receiving && ongoing);
    text(byId('shelf-nearby-status'), nearbyError || nearby.error || (incoming ? 'Proposition de réception' : ongoing ? `${receiving ? 'Réception' : 'Envoi'} · ${Math.round(transfer.progress || 0)} %` : transfer?.status === 'complete' ? receiving ? 'Fichiers reçus dans l’Étagère' : 'Envoi terminé' : transfer?.status === 'cancelled' ? 'Transfert annulé' : transfer?.error || (nearby.status === 'starting' ? 'Recherche…' : nearby.available ? peers.length ? 'Choisis un appareil' : 'Prêt à recevoir · aucun appareil pour le moment' : 'Ouvre LocalSend sur ton appareil, puis recherche.')));
    const toggle = byId('shelf-nearby-toggle'); toggle.disabled = nearbyBusy; toggle.setAttribute('aria-label', nearby.available ? 'Arrêter la recherche LocalSend' : 'Rechercher des appareils LocalSend'); toggle.setAttribute('aria-pressed', String(!!nearby.available));
    byId('shelf-transfer-cancel').hidden = !ongoing;
    text(byId('shelf-transfer-cancel'), receiving ? 'Annuler la réception' : 'Annuler l’envoi');
    byId('shelf-share').disabled = shelfBusy || nearbyBusy || !selectedFiles.size;
    renderLocalSend();
  }
  async function readNearby() {
    if (disposed || nearbyReading) return;
    nearbyReading = true;
    const mutation = nearbyMutation;
    try {
      const response = await window.fetch('/api/nearby'), value = await response.json();
      if (!response.ok) throw new Error(value.error || 'Partage indisponible.');
      if (!disposed && mutation === nearbyMutation) {
        if (!nearbyLoaded && value.transfer?.direction === 'receive' && value.transfer.status === 'complete') nearbyReceiveCompleted = value.transfer.id;
        nearbyLoaded = true; nearby = value; nearbyError = ''; renderNearby();
        if (value.incoming && value.incoming.id !== nearbyIncomingShown && !protectedInteraction()) {
          nearbyIncomingShown = value.incoming.id; openLocalSend('receive', value.incoming);
        }
        if (value.transfer?.direction === 'receive' && value.transfer.status === 'complete' && value.transfer.id !== nearbyReceiveCompleted) {
          nearbyReceiveCompleted = value.transfer.id; shelfLoaded = false; if (builtinVisible('shelf')) void loadShelf();
          notifyModuleChange({id: 'shelf', kind: 'received', title: value.transfer.fileCount > 1 ? 'Fichiers reçus' : 'Fichier reçu', detail: value.transfer.alias || 'Dans l’Étagère'});
        }
        renderLiveActivities(); update();
      }
    } catch (error) { if (!disposed) { nearbyError = error.message || 'Partage indisponible.'; renderNearby(); } }
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
    nearbyBusy = true; nearbyError = ''; renderNearby(); nearbyLifecycle();
    try {
      const response = await window.fetch('/api/nearby', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Notchy': '1'}, body: JSON.stringify(value)}), data = await response.json();
      if (disposed || mutation !== nearbyMutation) return;
      nearby = data;
      if (!response.ok || data.error) throw new Error(data.error || data.transfer?.error || 'Cette action est indisponible.');
      if (value.command === 'share' && data.transfer?.status === 'complete') notifyModuleChange({id: value.source === 'files' ? 'files' : 'shelf', kind: 'sent', title: value.ids.length > 1 ? 'Fichiers envoyés' : 'Fichier envoyé', detail: data.transfer.alias || 'Transfert terminé'});
    } catch (error) { if (!disposed && mutation === nearbyMutation) {nearbyError = error.message || 'Partage indisponible.'; if(localSendContext) localSendContext.error=nearbyError;} }
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
    if (!response.ok || result.ok === false) throw new Error(result.error || 'Cette action est indisponible.');
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
    if (state === 'open' && !filePlayer.hidden && !getModuleEditorActive()) update();
    byId('file-empty').hidden = !!item; byId('file-content').hidden = !item;
    text(byId('file-status'), fileError || (fileBusy && !item ? 'Préparation du fichier…' : fileBusy && fileMode === 'peers' ? 'Envoi du fichier…' : item && !item.toolsAvailable && (item.image || item.pdf) ? 'LocalSend reste disponible. OCR et conversion : 25 Mo maximum.' : ''));
    byId('file-empty').querySelector('button').disabled = fileBusy;
    if (!item) return;
    text(byId('file-name'), item.name); byId('file-name').title = item.name;
    text(byId('file-meta'), `${item.size >= 1048576 ? (item.size / 1048576).toFixed(1) + ' Mo' : Math.ceil(item.size / 1024) + ' Ko'}${fileItems.length > 1 ? ` · ${fileIndex + 1}/${fileItems.length}` : ''}${item.source === 'shelf' ? ' · gardé' : ''}`);
    const image = byId('file-preview');
    byId('file-switcher').hidden = fileItems.length < 2;
    if (item.preview && image.getAttribute('src') !== item.preview) { image.src = item.preview; image.hidden = false; }
    else if (!item.preview) { image.removeAttribute('src'); image.hidden = true; }
    byId('file-placeholder').toggleAttribute('hidden', !image.hidden);
    byId('file-actions').hidden = fileMode !== 'actions';
    byId('file-preview-panel').hidden = fileMode !== 'preview';
    const largePreview = byId('file-image-preview');
    largePreview.onerror = () => { if (!disposed && fileMode === 'preview') { fileMode = 'actions'; fileError = 'L’aperçu de cette image est indisponible.'; renderFiles(); } };
    if (fileMode === 'preview' && item.preview) { if (largePreview.getAttribute('src') !== item.preview) largePreview.src = item.preview; largePreview.alt = item.name; }
    else largePreview.removeAttribute('src');
    byId('file-formats').hidden = fileMode !== 'formats'; byId('file-processing').hidden = fileMode !== 'processing';
    byId('file-result').hidden = fileMode !== 'ocr'; byId('file-complete').hidden = fileMode !== 'complete'; byId('file-peers').hidden = fileMode !== 'peers';
    for (const button of filePlayer.querySelectorAll('[data-file-command], [data-file-format]')) {
      const command = button.dataset.fileCommand;
      button.disabled = command === 'cancel' ? !running : command === 'cancel-send' ? !activeFileTransfer() : fileBusy || running && command !== 'clear';
      if (command === 'ocr') { button.disabled ||= !(item.image || item.pdf) || !item.toolsAvailable; button.title = !item.toolsAvailable ? 'OCR : 25 Mo maximum. Le partage LocalSend reste disponible.' : ''; }
      if (command === 'formats') { button.disabled ||= !item.image || !item.toolsAvailable; button.title = !item.toolsAvailable ? 'Conversion : 25 Mo maximum. Le partage LocalSend reste disponible.' : ''; }
      if (command === 'keep') button.disabled ||= item.source === 'shelf';
    }
    text(byId('file-processing-label'), fileJob.progress?.label || (fileJob.command === 'ocr' ? fileJob.stage === 'pdf-text' ? 'Lecture du PDF…' : 'Reconnaissance du texte…' : 'Conversion…'));
    if (fileMode === 'ocr' && byId('file-text').dataset.job !== fileJob.jobId) {
      byId('file-text').value = typeof fileJob.text === 'string' ? fileJob.text : ''; byId('file-text').dataset.job = fileJob.jobId; byId('file-text').readOnly = true;
    }
    if (fileMode === 'complete' && fileJob.result) {
      text(byId('file-complete-name'), fileJob.result.name || 'Fichier prêt');
      const link = byId('file-download'); link.hidden = !/^\/api\/shelf\/[a-f0-9]{32}$/.test(fileJob.result.download || '');
      if (!link.hidden) { link.href = fileJob.result.download; link.download = fileJob.result.name; }
      if (fileJob.result.rasterEmbedded) text(byId('file-status'), 'Le SVG contient l’image ; il ne s’agit pas d’une vectorisation.');
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
    if (!peers.length) text(byId('file-status'), fileError || nearby.error || 'Ouvre LocalSend sur ton appareil, puis recherche.');
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
      } else if (job.status === 'error') { fileMode = 'actions'; fileError = job.error || 'Le traitement a échoué.'; }
      else if (job.status === 'cancelled') { fileMode = 'actions'; fileError = 'Traitement annulé.'; }
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
    if (files.length > 20) { fileError = '20 fichiers maximum à la fois.'; selectViewButton({dataset: {view: 'files'}}); setState('open'); renderFiles(); return; }
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
        if (desktop) { const result = await desktop.copyText(value); if (!result?.ok) throw new Error('Le texte ne peut pas être copié.'); }
        else await window.navigator.clipboard.writeText(value);
        fileError = 'Texte copié.';
      } else if (command === 'keep') {
        const value = await filePost('/api/files/keep', {id: item.id});
        fileItems[fileIndex] = acceptedFile(value.item, 'shelf'); setShelf(value); fileError = 'Gardé dans l’Étagère.';
        notifyModuleChange({id: 'files', kind: 'kept', title: 'Fichier gardé', detail: item.name});
        try { await fileRequest('/api/files/input/' + item.id, {method: 'DELETE', headers: {'X-Notchy': '1'}}); } catch {}
      } else if (command === 'clear') {
        if (fileJob.status === 'running') await filePost('/api/files/tool/cancel', {jobId: fileJob.jobId});
        if (item.source === 'files') await fileRequest('/api/files/input/' + item.id, {method: 'DELETE', headers: {'X-Notchy': '1'}});
        fileEpoch++; fileItems.splice(fileIndex, 1); fileIndex = Math.max(0, fileIndex - 1); fileMode = 'actions'; fileJob = {status: 'idle'};
      } else if (command === 'cancel') {
        fileJob = await filePost('/api/files/tool/cancel', {jobId: fileJob.jobId}); fileMode = 'actions'; fileError = 'Traitement annulé.';
      } else if (command === 'cancel-send') {
        const transfer = activeFileTransfer(); if (!transfer) return;
        nearby = await filePost('/api/nearby', {command: 'cancel', id: transfer.id}); fileError = 'Envoi annulé.'; renderNearby();
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
        nearby = await filePost('/api/nearby', value); if (nearby.transfer?.error) throw new Error(nearby.transfer.error); fileError = nearby.transfer?.status === 'cancelled' ? 'Envoi annulé.' : nearby.transfer?.status === 'complete' ? 'Fichier envoyé.' : 'Envoi en cours…'; renderNearby();
        if (nearby.transfer?.status === 'complete') notifyModuleChange({id: 'files', kind: 'sent', title: 'Fichier envoyé', detail: item.name});
      } else if (command === 'ocr' || button.dataset.fileFormat) {
        fileJob = await filePost('/api/files/tool', {id: item.id, command: command === 'ocr' ? 'ocr' : 'convert', ...(button.dataset.fileFormat ? {format: button.dataset.fileFormat} : {})});
        moduleActivityStates.set('files', moduleActivitySnapshot('files', {...fileJob, status: 'running'}));
        if (fileJob.status === 'complete') { observeModuleActivity('files', fileJob); fileMode = fileJob.command === 'ocr' ? 'ocr' : 'complete'; shelfLoaded = false; }
        else {
        fileMode = 'processing'; void pollFileJob();
        }
      }
    } catch (error) { if (!disposed) fileError = error.message || 'Cette action a échoué.'; }
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
  function downloadShelfFiles(items) {
    for (const item of items) { const link = document.createElement('a'); link.href = '/api/shelf/' + item.id; link.download = item.name; document.body.append(link); link.click(); link.remove(); }
  }
  async function shelfFileAction(command, item) {
    if (!item || disposed) return;
    const file = acceptedFile(item, 'shelf');
    if (command === 'open' || command === 'reveal') {
      const nativeAction = command === 'reveal' ? desktop?.revealShelfItem : desktop?.openShelfItem;
      if (typeof nativeAction === 'function') {
        shelfBusy = true; shelfError = ''; syncShelfSelection();
        try { const result = await nativeAction(item.id); if (!result?.ok) throw new Error(result?.error || 'Le fichier ne peut pas être ouvert.'); if (!disposed) shelfError = command === 'reveal' ? 'Copie affichée dans son dossier Windows.' : 'Copie ouverte dans Windows.'; }
        catch (error) { if (!disposed) shelfError = error.message || 'Le fichier ne peut pas être ouvert.'; }
        finally { if (!disposed) { shelfBusy = false; text(byId('shelf-status'), shelfError); syncShelfSelection(); } }
      } else if (command === 'reveal') return;
      else if (file.preview) selectShelfFile(item, 'preview');
      else { downloadShelfFiles([item]); shelfError = 'Copie téléchargée. Ouvre-la depuis tes téléchargements.'; text(byId('shelf-status'), shelfError); }
      return;
    }
    if (command === 'preview') { if (file.preview) selectShelfFile(item, 'preview'); return; }
    if (command === 'convert') { if (file.image) selectShelfFile(item, 'formats'); return; }
    if (command === 'ocr' && (file.image || file.pdf) && selectShelfFile(item)) await fileCommand({target: filePlayer.querySelector('[data-file-command="ocr"]')});
  }

  function syncShelfSelection() {
    shelfPlayer.dataset.hasSelection = String(selectedFiles.size > 0);
    const all = shelfItems.length > 0 && selectedFiles.size === shelfItems.length;
    const selectAll = byId('shelf-select-all');
    selectAll.disabled = shelfBusy || !shelfItems.length;
    selectAll.setAttribute('aria-pressed', String(all)); selectAll.setAttribute('aria-label', all ? 'Tout désélectionner' : 'Tout sélectionner');
    text(byId('shelf-selection'), selectedFiles.size ? `${selectedFiles.size} sélectionné${selectedFiles.size === 1 ? '' : 's'}` : 'Aucun fichier sélectionné');
    byId('shelf-download').disabled = shelfBusy || !selectedFiles.size; byId('shelf-remove').disabled = shelfBusy || !selectedFiles.size;
    byId('shelf-share').disabled = shelfBusy || nearbyBusy || !selectedFiles.size;
    const item = shelfSelectionItem(), file = item ? acceptedFile(item, 'shelf') : null, locked = shelfBusy || fileBusy || fileJob.status === 'running';
    shelfPlayer.dataset.singleSelection = String(!!item);
    byId('shelf-contextual').hidden = !item;
    byId('shelf-open').disabled = shelfBusy || !item;
    text(byId('shelf-open'), file && !file.image && !file.pdf ? 'Ouvrir le fichier' : 'Ouvrir');
    byId('shelf-open').title = typeof desktop?.openShelfItem === 'function' ? 'Ouvrir dans l’application par défaut' : file?.preview ? 'Afficher l’aperçu' : 'Télécharger une copie pour l’ouvrir';
    byId('shelf-reveal').hidden = !item || typeof desktop?.revealShelfItem !== 'function'; byId('shelf-reveal').disabled = shelfBusy || !item;
    byId('shelf-preview').hidden = !file?.image; byId('shelf-preview').disabled = locked || !file?.preview;
    byId('shelf-preview').title = file?.preview ? 'Afficher l’image' : 'Aperçu indisponible pour ce format';
    byId('shelf-ocr').hidden = !(file?.image || file?.pdf); byId('shelf-ocr').disabled = locked || !(file?.image || file?.pdf) || !file?.toolsAvailable; byId('shelf-ocr').title = file && !file.toolsAvailable ? 'OCR : 25 Mo maximum. Le partage LocalSend reste disponible.' : '';
    byId('shelf-convert').hidden = !file?.image; byId('shelf-convert').disabled = locked || !file?.image || !file?.toolsAvailable; byId('shelf-convert').title = file && !file.toolsAvailable ? 'Conversion : 25 Mo maximum. Le partage LocalSend reste disponible.' : '';
    if (state === 'open' && view === 'tray' && !getModuleEditorActive()) update();
  }

  // Weather requests run only while the module or its summary is visible.
  const weatherPlayer = byId('weather-player'), weatherCityInput = byId('weather-city-input');
  let weather = {status: 'empty', mode: 'local', city: '', displayName: '', selectedCity: null, temperature: null, feelsLike: null, condition: '', icon: 'unknown', nextRain: null, rainRisk: null, error: null, stale: false};
  let weatherLoaded = false, weatherBusy = false, weatherSearchBusy = false, weatherPickerOpen = false, weatherAutomatic = false, weatherActive = false;
  let weatherError = '', weatherMessage = '', weatherLocations = [], weatherTimer = 0, weatherEpoch = 0, weatherSearchEpoch = 0, weatherController = null, weatherSearchController = null;
  function getWeatherState() { return JSON.parse(JSON.stringify({...weather, busy: weatherBusy, searchBusy: weatherSearchBusy})); }
  function isWeatherBusy() { return weatherBusy || weatherSearchBusy; }
  function getWeatherSummary() {
    const next = weatherNarrative({...weather, busy: weatherBusy});
    return {title: next.temperature + ' ' + next.when, detail: 'à ' + next.city, narrative: next};
  }
  function renderWeatherSummary(button) {
    const next = weatherNarrative({...weather, busy: weatherBusy}), key = JSON.stringify(next);
    if (button.dataset.weatherNarrative === key) return;
    button.dataset.weatherNarrative = key; button.classList.add('home-weather-summary'); button.setAttribute('aria-label', 'Météo · ' + next.city);
    const row = pairs => {
      const line = document.createElement('p'); line.className = 'weather-summary-line';
      for (const [value, emphasized] of pairs) { const word = document.createElement(emphasized ? 'strong' : 'span'); word.textContent = value; line.append(word); }
      return line;
    };
    const current = row([[next.temperature, true], [next.when, false]]), place = row([['à', false], [next.city, true]]);
    const feels = row([['ressenti', false], [next.feelsLike, true]]), forecast = row([[next.rain, true], [next.rainQualifier, false]]);
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
    if (disposed) return;
    weatherPlayer.hidden = !builtinVisible('weather');
    const next = weatherNarrative({...weather, busy: weatherBusy, error: weather.error || (!weatherPickerOpen ? weatherError : '')});
    text(byId('weather-city'), next.city);
    byId('weather-city-button').title = 'Changer de ville'; byId('weather-city-button').setAttribute('aria-label', 'Changer de ville · ' + next.city);
    byId('weather-city-button').setAttribute('aria-expanded', String(weatherPickerOpen));
    const picker = byId('weather-picker'), returnFocus = !picker.hidden && !weatherPickerOpen && picker.contains(document.activeElement);
    byId('weather-main').hidden = weatherPickerOpen; byId('weather-picker').hidden = !weatherPickerOpen;
    if (returnFocus && !weatherPlayer.hidden && state === 'open') byId('weather-city-button').focus({preventScroll: true});
    text(byId('weather-temperature'), next.temperature); text(byId('weather-feels'), next.feelsLike); text(byId('weather-now'), next.when);
    text(byId('weather-condition'), typeof weather.condition === 'string' && weather.condition ? weather.condition.toLocaleLowerCase('fr-FR') : 'conditions indisponibles');
    text(byId('weather-heading-label'), next.city + ' · ' + (weather.isDay === false ? 'CE SOIR' : 'AUJOURD’HUI'));
    const day = Number.isFinite(weather.max) ? ` Aujourd’hui, jusqu’à ${Math.round(weather.max)}°` : '';
    text(byId('weather-day-detail'), day + (Number.isFinite(weather.rainRisk) ? `${day ? ', avec' : ' Avec'} ${Math.round(Math.max(0, Math.min(100, weather.rainRisk)))} % de risque de précipitations.` : day ? '.' : ''));
    const conditionPaths = {moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z', sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5', cloud: 'M6 18h12a4 4 0 0 0 0-8 6 6 0 0 0-11-2 5 5 0 0 0-1 10Z'};
    byId('weather-condition-icon').querySelector('path').setAttribute('d', conditionPaths[weather.icon] || conditionPaths.cloud);
    const hours = Array.isArray(weather.hours) ? weather.hours.filter(hour => Number.isFinite(hour?.temperature) && typeof hour.time === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(hour.time)).slice(0, 3) : [];
    const hourSignature = JSON.stringify(hours.map(hour => [hour.time, hour.temperature]));
    if (byId('weather-hours').dataset.value !== hourSignature) { byId('weather-hours').dataset.value = hourSignature; byId('weather-hours').replaceChildren(...hours.map(hour => { const chip = document.createElement('span'), label = document.createElement('span'), temperature = document.createElement('strong'); label.textContent = hour.time.slice(11, 13) + ' h'; temperature.textContent = Math.round(hour.temperature) + '°'; chip.append(label, temperature); return chip; })); }
    byId('weather-hours').hidden = !hours.length;
    text(byId('weather-rain'), next.rain); text(byId('weather-rain-label'), next.rainQualifier); text(byId('weather-horizon'), next.horizon);
    byId('weather-rain-icon').toggleAttribute('hidden', !next.rainIcon); byId('weather-rain-icon').dataset.kind = next.rain === 'pluie' ? 'rain' : 'precipitation';
    byId('weather-forecast').setAttribute('aria-label', next.forecastDescription); byId('weather-main').dataset.state = next.state; byId('weather-main').setAttribute('aria-busy', String(next.loading));
    text(byId('weather-status'), weatherBusy || weatherSearchBusy ? weatherMessage : weatherError || next.status);
    for (const button of weatherPlayer.querySelectorAll('[data-weather-command="locate"],[data-weather-command="refresh"]')) button.disabled = weatherBusy;
    weatherPlayer.querySelector('button[data-weather-command="search"]').disabled = weatherSearchBusy;
    if (typeof renderHomeSummaries === 'function') renderHomeSummaries();
    if (state === 'open' && !weatherPlayer.hidden && !getModuleEditorActive()) update();
  }
  async function weatherRequest(url, options, signal) {
    const response = await window.fetch(url, {...options, signal, cache: 'no-store'}), value = await response.json();
    if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : 'La météo est indisponible.');
    return value;
  }
  async function loadWeather(command = null, location = null) {
    if (!weatherVisible()) return;
    weatherController?.abort(); const epoch = ++weatherEpoch, controller = new AbortController(); weatherController = controller;
    if (command === 'local') desktop?.setDialogOpen?.(true);
    weatherBusy = true; weatherError = ''; weatherMessage = command === 'local' ? 'Recherche de la position actuelle…' : 'Actualisation de la météo…'; renderWeather();
    try {
      const value = await weatherRequest('/api/weather', command ? {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Notchy': '1'}, body: JSON.stringify({command, ...(location ? {location} : {})})} : {}, controller.signal);
      if (disposed || epoch !== weatherEpoch || document.hidden) return;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('La météo est indisponible.');
      weather = {...value, temperature: Number.isFinite(value.temperature) ? value.temperature : null, feelsLike: Number.isFinite(value.feelsLike) ? value.feelsLike : null}; weatherLoaded = true;
      if (!Number.isFinite(weather.temperature)) weatherPickerOpen = true;
      else if (command === 'select' || document.activeElement !== weatherCityInput) weatherPickerOpen = false;
    } catch (error) {
      if (epoch !== weatherEpoch || error.name === 'AbortError' || disposed) return;
      weatherError = error.message || 'La météo est indisponible.'; if (!Number.isFinite(weather.temperature)) weatherPickerOpen = true;
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
    const query = weatherCityInput.value.trim(); if (query.length < 2) { weatherError = 'Saisis au moins deux lettres.'; renderWeather(); return; }
    weatherSearchController?.abort(); const epoch = ++weatherSearchEpoch, controller = new AbortController(); weatherSearchController = controller;
    weatherSearchBusy = true; weatherError = ''; weatherMessage = 'Recherche des villes…'; renderWeather();
    try {
      const value = await weatherRequest('/api/weather/search?q=' + encodeURIComponent(query), {}, controller.signal);
      if (disposed || epoch !== weatherSearchEpoch || document.hidden) return;
      if (value.error) throw new Error(value.error);
      weatherLocations = Array.isArray(value.locations) ? value.locations.filter(location => location && typeof location.name === 'string' && Number.isFinite(location.latitude) && Math.abs(location.latitude) <= 90 && Number.isFinite(location.longitude) && Math.abs(location.longitude) <= 180).slice(0, 8) : [];
      byId('weather-search-results').replaceChildren(...weatherLocations.map((location, index) => {
        const button = document.createElement('button'), label = document.createElement('span'), detail = document.createElement('small');
        button.type = 'button'; button.dataset.weatherCommand = 'choose'; button.dataset.weatherResult = String(index); label.textContent = location.name; detail.textContent = [location.region, location.country].filter(Boolean).join(' · '); button.append(label, detail); return button;
      }));
      if (!weatherLocations.length) weatherError = 'Aucune ville trouvée.';
    } catch (error) { if (epoch === weatherSearchEpoch && error.name !== 'AbortError' && !disposed) weatherError = error.message || 'La recherche est indisponible.'; }
    finally { if (epoch === weatherSearchEpoch && !disposed) { weatherSearchBusy = false; weatherSearchController = null; renderWeather(); } }
  }
  function weatherCommand(event) {
    if (event.type === 'submit') { event.preventDefault(); if (!disposed && !document.hidden) void searchWeatherCity(); return; }
    const button = event.target.closest('[data-weather-command]'); if (!button || disposed || document.hidden) return;
    const command = button.dataset.weatherCommand;
    if (command === 'search') { event.preventDefault(); void searchWeatherCity(); }
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
      button.setAttribute('aria-pressed', String(selectedFiles.has(item.id))); button.setAttribute('aria-label', 'Sélectionner ' + item.name);
      const preview = document.createElement('span'); preview.className = 'shelf-preview';
      const icon = document.createElement('span'); icon.className = 'shelf-file-icon'; icon.setAttribute('aria-hidden', 'true');
      const extension = document.createElement('span'); extension.textContent = item.name.match(/\.([a-z0-9]{1,8})$/i)?.[1] || 'FILE';
      icon.append(shelfGlyph(item.kind), extension); preview.append(icon);
      if (item.thumbnail) { const image = document.createElement('img'); image.src = item.thumbnail; image.alt = ''; image.loading = 'lazy'; image.addEventListener('error', () => image.remove(), {once: true}); preview.append(image); }
      const check = document.createElement('span'); check.className = 'shelf-check'; check.setAttribute('aria-hidden', 'true'); check.append(shelfGlyph('check')); preview.append(check);
      const name = document.createElement('span'); name.className = 'shelf-item-name'; name.textContent = item.name; name.title = item.name;
      const size = document.createElement('span'); size.className = 'shelf-item-size'; size.textContent = item.size >= 1048576 ? (item.size / 1048576).toFixed(1) + ' Mo' : Math.ceil(item.size / 1024) + ' Ko';
      button.append(preview, name, size); card.append(button); shelfList.append(card);
    }
    byId('shelf-drop').hidden = shelfItems.length > 0;
    shelfList.hidden = shelfItems.length === 0;
    text(byId('shelf-count'), `${shelfItems.length} fichier${shelfItems.length === 1 ? '' : 's'}`);
    text(byId('shelf-status'), shelfError);
    byId('shelf-add').disabled = shelfBusy || shelfItems.length >= 20;
    byId('shelf-drop').disabled = shelfBusy || shelfItems.length >= 20;
    syncShelfSelection();
  }

  function setShelf(value) {
    if (!value || !Array.isArray(value.items)) throw new Error('L’Étagère ne répond pas correctement.');
    shelfItems = value.items.slice(0, 20).filter(item => item && /^[a-f0-9]{32}$/.test(item.id) && typeof item.name === 'string' && Number.isSafeInteger(item.size) && item.size >= 0).map(item => ({
      id: item.id, name: item.name.slice(0, 260), size: item.size,
      kind: ['document', 'image', 'archive', 'audio', 'video'].includes(item.kind) ? item.kind : 'file',
      thumbnail: typeof item.thumbnail === 'string' && item.thumbnail === `/api/shelf/${item.id}?preview=1` ? item.thumbnail : null,
    }));
    shelfLoaded = true;
    renderShelf();
  }

  async function shelfRequest(url, options) {
    const response = await window.fetch(url, options);
    const value = await response.json();
    if (!response.ok || value.error) throw new Error(value.error || 'Cette action est indisponible.');
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
      shelfError = '20 fichiers maximum dans l’Étagère.'; renderShelf(); return;
    }
    const epoch = ++shelfEpoch;
    shelfBusy = true; shelfError = '';
    selectViewButton(menuButtons.find(button => button.dataset.view === 'tray')); setState('open');
    renderShelf();
    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        text(byId('shelf-status'), `Ajout ${index + 1} sur ${files.length}…`);
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
      downloadShelfFiles(items);
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
    fileDragging = false; notch.dataset.fileDrag = 'false';
    if (state === 'hover') setState('discreet'); else renderMusic();
    if (restore !== false && state === 'open' && view === 'tray' && !shelfLoaded && !shelfBusy) void loadShelf();
  }
  function fileDragEnter(event) { if (hasFiles(event)) dragDepth++; }
  function fileDragOver(event) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (!nearNotch(event)) { event.dataTransfer.dropEffect = 'none'; clearFileDrag(); return; }
    event.dataTransfer.dropEffect = 'copy';
    fileDragging = true; notch.dataset.fileDrag = 'true';
    if (state !== 'open') setState('hover');
    else { renderLiveActivities(); if (getModuleEditorActive()) closeModuleEditor(false); }
  }
  function fileDragLeave(event) { if (hasFiles(event)) { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) clearFileDrag(); } }
  function fileDrop(event) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (!nearNotch(event)) { clearFileDrag(); return; }
    const files = [...event.dataTransfer.files];
    const toShelf = state === 'open' && builtinVisible('shelf') && !!event.target.closest('#shelf-player');
    clearFileDrag(false); if (toShelf) void uploadFiles(files); else void stageFiles(files);
  }

  function text(element, value) { if (element.textContent !== value) element.textContent = value; }
  function time(value) { const seconds = Math.floor(value); return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0'); }
  function position() { return musicPosition(music, connectionLost ? 0 : window.performance.now() - musicAt); }
  function clearSpectrum() { for (const bar of spectrumBars) bar.style.setProperty('--level', '0'); }
  function receiveSpectrum(values) {
    if (disposed || document.hidden || fileDragging || !motionEnabled() || !isModuleEnabled('music') || !music.playing || connectionLost || !(state === 'hover' || state === 'open' && builtinVisible('music'))) return;
    const levels = spectrumLevels(values); if (!levels) return;
    const bars = state === 'open' ? playerBars : liveBars;
    bars.forEach((bar, index) => bar.style.setProperty('--level', String(levels[index])));
    if (state === 'hover' && !byId('module-feedback-spectrum').hidden) feedbackBars.forEach((bar, index) => bar.style.setProperty('--level', String(levels[index])));
  }

  function renderTime() {
    if (disposed || document.hidden) return;
    const current = seekPreview ?? position(), ratio = music.duration ? current / music.duration : 0;
    if (notch.style.getPropertyValue('--music-progress') !== String(ratio)) notch.style.setProperty('--music-progress', String(ratio));
    text(byId('music-elapsed'), time(current));
    text(byId('music-live-time'), time(current));
    text(byId('music-duration'), music.duration ? time(music.duration) : '—:—');
    musicSeek.disabled = commandBusy || connectionLost || !music.canSeek;
    musicSeek.max = String(music.duration || 100);
    musicSeek.value = String(Math.floor(current));
    musicSeek.setAttribute('aria-valuetext', `${time(current)} sur ${time(music.duration)}`);
    musicSeek.title = music.canSeek ? 'Avancer ou reculer dans le morceau' : 'Le lecteur Windows ne permet pas de déplacer la lecture';
    strip.setAttribute('aria-valuemax', String(music.duration || 100));
    strip.setAttribute('aria-valuenow', String(music.duration ? Math.floor(current) : 0));
    strip.setAttribute('aria-valuetext', `${time(current)} sur ${time(music.duration)}`);
  }

  function syncClock() {
    const visible = state !== 'open' || builtinVisible('music');
    const delay = !disposed && !document.hidden && isModuleEnabled('music') && visible && music.available && music.playing && !connectionLost ? motionEnabled() ? 250 : 1000 : 0;
    if (delay === clockDelay) return;
    window.clearInterval(clock); clock = 0; clockDelay = delay;
    if (delay) clock = window.setInterval(renderTime, delay);
  }

  function renderMusic() {
    if (disposed) return;
    player.hidden = !builtinVisible('music');
    renderLiveActivities();
    byId('shelf-drop-hint').hidden = !fileDragging || state !== 'hover';
    byId('music-empty').hidden = music.available;
    byId('music-content').hidden = !music.available;
    notch.dataset.playing = String(music.playing && !connectionLost);
    for (const badge of notch.querySelectorAll('.music-provider-badge')) badge.hidden = !music.available || !/spotify/i.test(music.source || 'Spotify');
    text(byId('music-title'), music.title || 'Titre inconnu');
    text(byId('music-live-title'), music.title || 'Musique');
    text(byId('music-live-artist'), music.artist || music.source);
    text(byId('music-artist'), music.artist || 'Artiste inconnu');
    text(byId('music-source'), music.source || 'Spotify');
    const description = music.available ? `${music.title || 'Musique'} · ${music.artist || 'lecteur musical'}` : 'Ouvrir l’encoche';
    toggle.setAttribute('aria-label', state === 'open' ? 'Encoche ouverte' : description + (music.available ? ' · ouvrir le lecteur' : ''));
    for (const image of coverImages) {
      image.hidden = !music.cover || image.getAttribute('src') === music.cover && image.complete && image.naturalWidth === 0;
      image.nextElementSibling.toggleAttribute('hidden', !image.hidden);
      if (music.cover && image.getAttribute('src') !== music.cover) image.src = music.cover;
      else if (!music.cover) image.removeAttribute('src');
    }
    if (spectrumArtwork !== music.cover) { spectrumArtwork = music.cover; spectrumAnalyzed = ''; notch.style.setProperty('--spectrum-color', '#ffffff'); coverLoaded({target: coverImages[0]}); }
    const paused = !music.playing || connectionLost;
    byId('music-toggle').setAttribute('aria-label', paused ? 'Lire' : 'Mettre en pause');
    byId('music-play-icon').setAttribute('d', paused ? 'M8 5v14l11-7Z' : 'M6 5h4v14H6ZM14 5h4v14h-4Z');
    for (const button of commands) {
      const command = button.dataset.musicCommand;
      const capability = {toggle: 'canToggle', next: 'canNext', previous: 'canPrevious', shuffle: 'canShuffle', repeat: 'canRepeat'}[command];
      button.disabled = commandBusy || command !== 'open' && (connectionLost || !music.available || !music[capability]);
      if (command === 'shuffle') button.setAttribute('aria-pressed', String(music.shuffle === true));
      if (command === 'repeat') { button.setAttribute('aria-pressed', String(music.repeat === 'list' || music.repeat === 'track')); button.dataset.repeat = music.repeat || 'none'; button.setAttribute('aria-label', music.repeat === 'track' ? 'Répéter ce morceau · passer sans répétition' : music.repeat === 'list' ? 'Répéter la liste · passer à un seul morceau' : 'Activer la répétition de la liste'); }
    }
    text(byId('music-status'), musicError || music.error || '');
    if (paused || !motionEnabled() || state === 'open' && !builtinVisible('music')) clearSpectrum();
    renderTime(); syncClock(); renderHomeSummaries();
  }

  function setMusic(value) {
    if (disposed) return false;
    const next = normalizeMusic(value, music), track = moduleActivityChange('music', moduleActivitySnapshot('music', music), moduleActivitySnapshot('music', next))?.kind === 'track';
    if (track) { seekPreview = null; if (!seekDragging) seekTrack = null; }
    const oldCopy = track && state === 'open' && !player.hidden ? player.querySelector('.music-copy').cloneNode(true) : null;
    const oldArt = oldCopy ? player.querySelector('.music-art').cloneNode(true) : null;
    music = next;
    musicAt = window.performance.now();
    musicError = ''; connectionLost = false;
    observeModuleActivity('music', music);
    renderMusic(); update(); if (oldCopy && motionEnabled()) animateMusicTrack(oldCopy, oldArt); if (getModuleEditorActive()) renderModules(); return true;
  }
  function animateMusicTrack(oldCopy, oldArt) {
    for (const [old, host, frames] of [[oldCopy, player.querySelector('.music-copy'), [{opacity: 1, transform: 'translateY(0)'}, {opacity: 0, transform: 'translateY(-16px)'}]], [oldArt, player.querySelector('.music-art'), [{opacity: 1, transform: 'scale(1)'}, {opacity: 0, transform: 'scale(.85)'}]]]) {
      for (const previous of old.querySelectorAll('.music-track-out')) previous.remove();
      old.removeAttribute('id'); for (const child of old.querySelectorAll('[id]')) child.removeAttribute('id');
      old.classList.add('music-track-out'); old.inert = true; old.setAttribute('aria-hidden', 'true'); host.append(old);
      const animation = old.animate(frames, {duration: 280, easing: 'cubic-bezier(.32,.72,0,1)'}); moduleFeedbackAnimations.add(animation);
      const finish = () => { moduleFeedbackAnimations.delete(animation); old.remove(); }; animation.finished.then(finish, finish);
    }
    animateModuleChange(player.querySelector('.music-copy')); animateModuleChange(player.querySelector('.music-art > img'));
  }

  function syncStream() {
    if (disposed || document.hidden || !isModuleEnabled('music')) {
      stream?.close(); retiringStream?.close(); stream = null; retiringStream = null;
      clearSpectrum(); syncClock(); return;
    }
    if (typeof window.EventSource !== 'function') { musicError = 'La connexion au lecteur n’est pas disponible.'; renderMusic(); return; }
    const wantsSpectrum = !fileDragging && motionEnabled() && (state === 'hover' || state === 'open' && builtinVisible('music'));
    if (stream && streamSpectrum === wantsSpectrum) return;
    // Keep the old subscription until the new one opens, avoiding artwork flicker.
    retiringStream?.close(); retiringStream = stream;
    let current;
    try { current = new window.EventSource('/api/music/events?spectrum=' + (wantsSpectrum ? '1' : '0')); }
    catch { retiringStream?.close(); retiringStream = null; stream = null; musicError = 'Connexion musicale indisponible.'; renderMusic(); return; }
    stream = current; streamSpectrum = wantsSpectrum;
    current.addEventListener('open', () => { if (stream === current) { retiringStream?.close(); retiringStream = null; } });
    current.addEventListener('music', event => { if (stream === current) try { setMusic(JSON.parse(event.data)); } catch {} });
    current.addEventListener('spectrum', event => { if (stream === current) try { receiveSpectrum(JSON.parse(event.data)); } catch {} });
    current.addEventListener('error', () => {
      if (disposed || stream !== current || document.hidden) return;
      music.position = position(); musicAt = window.performance.now(); connectionLost = true;
      musicError = 'Connexion au lecteur en cours…'; clearSpectrum(); renderMusic(); update();
    });
  }

  async function commandMusic(event) {
    const button = event.target.closest('[data-music-command]');
    if (!button || button.disabled || commandBusy || disposed) return;
    await performMusicCommand({command: button.dataset.musicCommand});
  }
  async function performMusicCommand(value) {
    if (commandBusy || disposed) return;
    commandBusy = true; musicError = ''; renderMusic();
    try {
      const response = await window.fetch('/api/music', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Notchy': '1'}, body: JSON.stringify(value)});
      const data = await response.json();
      if (disposed) return;
      if (value.command === 'seek' && (music.title !== value.title || music.artist !== value.artist)) return;
      if (!response.ok || data.error) throw new Error(data.error || 'Le lecteur n’a pas pu effectuer cette action.');
      if (Object.hasOwn(data, 'available')) setMusic(data);
    } catch (error) { if (!disposed) musicError = error.message || 'Le lecteur ne répond pas.'; }
    finally { if (!disposed) { commandBusy = false; seekPreview = null; seekTrack = null; renderMusic(); recheckCollapse(); } }
  }
  function previewMusicSeek() {
    if (musicSeek.disabled || disposed) return;
    seekTrack ||= {title: music.title, artist: music.artist};
    seekPreview = Math.min(music.duration, Math.max(0, Number(musicSeek.value))); renderTime();
  }
  async function commitMusicSeek() {
    if (seekTrack && (seekTrack.title !== music.title || seekTrack.artist !== music.artist)) { seekPreview = null; seekTrack = null; musicError = 'Le morceau a changé. Choisis sa nouvelle position.'; renderMusic(); return; }
    if (disposed || musicSeek.disabled || seekPreview === null || !seekTrack || state !== 'open' || !builtinVisible('music')) { seekPreview = null; seekTrack = null; renderTime(); return; }
    await performMusicCommand({command: 'seek', position: seekPreview, ...seekTrack});
  }
  function startMusicSeek() { if (!musicSeek.disabled) { seekDragging = true; seekTrack = {title: music.title, artist: music.artist}; } }
  function endMusicSeek(event) { if (!seekDragging) return; seekDragging = false; if (event.type === 'pointercancel') { seekPreview = null; seekTrack = null; renderTime(); } recheckCollapse(); }
  function musicLifecycle() { if (state !== 'open' || !builtinVisible('music')) { seekPreview = null; seekTrack = null; seekDragging = false; } renderMusic(); syncStream(); musicQueueLifecycle(); }
  let spectrumAnalyzed = '';
  function coverLoaded(event) {
    const image = event.target;
    if (disposed || !music.cover || image.getAttribute('src') !== music.cover || !image.complete || !image.naturalWidth || spectrumAnalyzed === music.cover) return;
    try {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
      const context = canvas.getContext('2d', {willReadFrequently: true}); context.drawImage(image, 0, 0, 16, 16);
      notch.style.setProperty('--spectrum-color', artworkColor(context.getImageData(0, 0, 16, 16).data)); spectrumAnalyzed = music.cover;
    } catch { notch.style.setProperty('--spectrum-color', '#ffffff'); }
  }
  function coverError(event) { event.target.hidden = true; event.target.nextElementSibling.removeAttribute('hidden'); if (event.target.getAttribute('src') === music.cover) notch.style.setProperty('--spectrum-color', '#ffffff'); }

  function queueVisible() { return queueOpen && view === 'music' && state === 'open' && !moduleEditing && !document.hidden; }
  function queueText(value, max = 240) { return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, max) : ''; }
  function queueSnapshot(value) {
    const statuses = ['disconnected','connecting','connected','ok','accepted','scope-required','busy','limited','unauthorized','forbidden','offline','unavailable','error','cancelled','invalid'];
    const track = item => item && typeof item.name === 'string' ? {name: queueText(item.name), artists: Array.isArray(item.artists) ? item.artists.slice(0, 8).map(name => queueText(name, 100)).filter(Boolean) : [], type: item.type === 'episode' ? 'episode' : 'track', uri: item.type !== 'episode' && typeof item.uri === 'string' && /^spotify:track:[A-Za-z0-9]{22}$/.test(item.uri) ? item.uri : '', artwork: typeof item.artwork === 'string' && item.artwork.length <= 355000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(item.artwork) ? item.artwork : null} : null;
    return {status: statuses.includes(value?.status) ? value.status : 'error', canPlay: value?.canPlay === true, message: queueText(value?.message, 600), current: value?.status === 'ok' ? track(value?.current) : null, items: value?.status === 'ok' && Array.isArray(value?.items) ? value.items.slice(0, 50).map(track).filter(Boolean) : [], retryAfter: Number.isFinite(value?.retryAfter) ? Math.min(300, Math.max(1, value.retryAfter)) : 0};
  }
  function renderMusicQueue() {
    const host = byId('music-queue'); host.hidden = !queueOpen || view !== 'music' || moduleEditing;
    player.dataset.queueOpen = String(!host.hidden);
    const button = byId('music-queue-toggle'); button.setAttribute('aria-expanded', String(queueOpen)); button.setAttribute('aria-label', queueOpen ? 'Fermer À suivre' : 'Afficher À suivre');
    if (host.hidden) return;
    const messages = {disconnected: 'Connecte Spotify pour afficher sa file.', connecting: 'Autorise la connexion dans ton navigateur.', connected: 'La file est prête à être actualisée.', ok: 'La file est vide.', unauthorized: 'Reconnecte Spotify pour restaurer la session.', forbidden: 'Spotify refuse cet accès pour ce compte.', limited: 'Spotify demande une pause avant de réessayer.', offline: 'Spotify est momentanément indisponible.', unavailable: 'La file Spotify est indisponible.', error: 'Impossible de lire la file pour le moment.', cancelled: 'Lecture annulée.', invalid: 'Commande indisponible.'};
    text(byId('music-queue-status'), queueBusy ? queueOperation === 'play-track' ? 'Lecture demandée à Spotify…' : 'Chargement de la file…' : queueNotice || queueState.message || messages[queueState.status]);
    byId('music-queue-status').hidden = !queueBusy && !queueNotice && queueState.status === 'ok' && !!queueState.items.length;
    byId('music-queue-refresh').disabled = queueBusy || queueState.status === 'connecting' || Date.now() < queueRetryUntil;
    const needsPlayback = !queueState.canPlay && ['ok','connected','scope-required'].includes(queueState.status);
    byId('music-queue-connect').hidden = !needsPlayback && !['disconnected','unauthorized','forbidden','error'].includes(queueState.status);
    text(byId('music-queue-connect'), needsPlayback ? 'Autoriser la lecture Spotify' : 'Connecter Spotify');
    byId('music-queue-connect').disabled = queueBusy;
    byId('music-queue-disconnect').hidden = !['connected','ok','limited','forbidden','offline'].includes(queueState.status);
    byId('music-queue-disconnect').disabled = queueBusy;
    const list = byId('music-queue-items'), signature = JSON.stringify([queueState.items, queueState.canPlay]);
    if (queueListSignature !== signature) {
    const nodes = queueState.items.map(item => {
      const row = document.createElement('li'), itemView = document.createElement(item.uri ? 'button' : 'div'); itemView.className = 'music-queue-item';
      if (item.uri) { itemView.type = 'button'; itemView.dataset.musicQueueCommand = 'play-track'; itemView.dataset.uri = item.uri; itemView.setAttribute('aria-label', `Lire ${item.name} · ${item.artists.join(' · ')}`); itemView.title = 'Lire sur l’appareil Spotify actif · remplace le contexte de lecture'; }
      const art = document.createElement('span'); art.className = 'music-queue-art';
      const placeholder = () => { const glyph = player.querySelector('.cover-placeholder').cloneNode(true); glyph.removeAttribute('hidden'); return glyph; };
      if (item.artwork) { const image = document.createElement('img'); image.src = item.artwork; image.alt = ''; image.addEventListener('error', () => image.replaceWith(placeholder()), {once: true}); art.append(image); } else art.append(placeholder());
      const copy = document.createElement('span'); copy.className = 'music-queue-copy'; const title = document.createElement('strong'), artist = document.createElement('small');
      title.textContent = item.name || 'Titre indisponible'; title.title = title.textContent; artist.textContent = item.artists.join(' · ') || (item.type === 'episode' ? 'Épisode' : 'Artiste inconnu'); artist.title = artist.textContent;
      copy.append(title, artist); itemView.append(art, copy); row.append(itemView); return row;
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
      let value = desktop?.musicQueue ? await desktop.musicQueue(refresh ? 'queue' : 'status') : {status: 'unavailable', message: 'Ouvre cette vue dans l’application Windows pour connecter Spotify.'};
      if (disposed || ticket !== queueEpoch || !queueVisible()) return;
      if (!refresh && ['connected','ok'].includes(value?.status)) value = await desktop.musicQueue('queue');
      if (disposed || ticket !== queueEpoch || !queueVisible()) return;
      queueState = queueSnapshot(value); if (queueState.retryAfter) queueRetryUntil = Date.now() + queueState.retryAfter * 1000;
    } catch { if (ticket === queueEpoch) queueState = {status: 'error', current: null, items: [], message: 'La file Spotify est indisponible. Réessaie.'}; }
    finally { if (ticket === queueEpoch) { queueBusy = false; renderMusicQueue(); scheduleMusicQueue(); } }
  }
  function closeMusicQueue(restore = true, focus = true) {
    queueOpen = queueActive = queueBusy = false; queueNotice = queueOperation = ''; queueEpoch++; window.clearTimeout(queueTimer); queueTimer = 0;
    renderMusicQueue();
    if (restore && queueReturnView === 'nook' && view === 'music') selectViewButton({dataset: {view: 'nook'}});
    update(); if (focus && !byId('music-queue-toggle').closest('[hidden],[inert]')) byId('music-queue-toggle').focus({preventScroll: true});
  }
  function musicQueueLifecycle() {
    if (queueOpen && (view !== 'music' || state !== 'open' || moduleEditing)) { closeMusicQueue(false, false); return; }
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
      queueReturnView = view; queueOpen = true;
      if (view !== 'music') selectViewButton({dataset: {view: 'music'}});
      setState('open'); renderMusicQueue(); update(); musicQueueLifecycle(); return;
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
        queueNotice = queueText(value?.message, 600) || (value?.status === 'accepted' ? 'Lecture demandée à Spotify sur l’appareil actif.' : 'Spotify n’a pas pu lancer ce titre.');
        if (value?.status === 'accepted') value = await desktop.musicQueue('queue');
      }
      if (!disposed && ticket === queueEpoch && queueVisible()) { queueRetryUntil = value?.retryAfter ? Date.now() + Math.min(300, value.retryAfter) * 1000 : 0; queueState = queueSnapshot(value); }
    }
    catch { if (ticket === queueEpoch) queueState = {status: 'error', current: null, items: [], message: 'La connexion Spotify est indisponible.'}; }
    finally { if (ticket === queueEpoch) { queueBusy = false; queueOperation = ''; renderMusicQueue(); scheduleMusicQueue(); recheckCollapse(); } }
  }

  function paint(now = window.performance.now()) {
    window.cancelAnimationFrame(frame);
    frame = 0;
    if (disposed) return;
    const value = motion.step(now, {snap: !motionEnabled() || document.hidden});
    const width = Math.max(1, Math.min(value.width, Math.max(1, window.innerWidth - 32)));
    geometry = shape({...value, width}, window.innerWidth);
    const band = Math.max(0, Math.min(value.band, geometry.height));
    for (const [name, number] of Object.entries({width, height: geometry.height, band, shoulder: geometry.shoulder, 'surface-width': geometry.totalWidth})) {
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
    const localSend = view === 'localsend' ? localSendPresentation() : null, transferBand = localSendBand();
    const format = appearanceFormats[appearance.format];
    const editorLayout = getModuleEditorActive() ? moduleEditorPresentation(moduleDraft, modulePicked) : null;
    const editorWidth = editorLayout?.width || 0;
    const expandedMusic = queueOpen && view === 'music';
    const homeActive = view === 'nook' && !getModuleEditorActive();
    const scale = format.width / appearanceFormats.balanced.width;
    const context = homeModuleContext();
    let homeWidth = format.width, homeHeight = format.height;
    if (homeActive) {
      const home = byId('nook-layout'), style = getComputedStyle(home);
      const horizontalPadding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      const verticalPadding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      const gap = 16, slots = getHomeSlots();
      const maximumWidth = Math.max(1, window.innerWidth - (window.innerWidth <= 640 ? 32 : 80));
      const preferred = homeModuleLayout(slots, Math.max(0, maximumWidth - horizontalPadding), gap, context);
      const single = preferred.items.length === 1 ? moduleDefinitions[preferred.items[0].id].size.width : 0;
      const preferredWidth = preferred.items.length ? (single || preferred.preferredWidth + horizontalPadding) * scale : format.width;
      homeWidth = Math.min(Math.max(preferred.minWidth + horizontalPadding, preferredWidth), maximumWidth);
      homeLayout = homeModuleLayout(slots, Math.max(0, homeWidth - horizontalPadding), gap, context);
      homeHeight = Math.max(164, homeLayout.contentHeight) + verticalPadding;
      home.dataset.layout = homeLayout.mode;
      home.style.setProperty('--home-gap', gap + 'px');
      for (const item of homeLayout.items) {
        const cell = homeCells.get(item.id); if (!cell) continue;
        cell.dataset.row = String(item.row); cell.dataset.column = String(item.column);
        cell.style.setProperty('--module-width', item.width + 'px');
        cell.style.setProperty('--module-height', item.height + 'px');
        cell.style.setProperty('--module-min-width', item.minWidth + 'px');
        cell.style.setProperty('--module-min-height', item.minHeight + 'px');
      }
    }
    const hasMusic = musicInBand(), hasFocus = isModuleEnabled('focus') && focusIsActive();
    const quiet = state === 'open' ? sizes.open : closedBandSize(state, {music: hasMusic, focus: hasFocus, transfer: !!transferBand, feedback: moduleFeedback && notch.dataset.feedback});
    const definition = view === 'nook' ? moduleDefinitions[homePrimary()] : Object.values(moduleDefinitions).find(item => item.view === view);
    const directWidth = localSend ? localSend.direction === 'receive' ? 440 : 520 : view === 'files' ? 520 * scale : definition ? definition.size.width * scale : format.width;
    const size = {...quiet, ...(state === 'open' ? {width: view === 'welcome' ? 300 : getModuleEditorActive() ? Math.min(editorWidth, Math.max(1, window.innerWidth - 32)) : homeActive ? homeWidth : expandedMusic ? Math.min(Math.max(780, directWidth), Math.max(1, window.innerWidth - 80)) : directWidth, radius: appearance.radius} : {})};
    if (state === 'open') {
      // Keep the menu under the pointer when a narrower route replaces the current panel.
      openWidth = view === 'welcome' || localSend ? size.width : Math.max(openWidth, size.width);
      size.width = Math.min(openWidth, Math.max(1, window.innerWidth - 32));
      if (view === 'welcome') activationPoint = null;
    }
    if (state === 'open' && (view === 'welcome' || localSend)) size.band = 0;
    if (localSend) size.radius = 18;
    const directItem = definition ? homeModuleLayout([definition.id], directWidth, 16, context).items[0] : null;
    let contentHeight = view === 'welcome' ? 196 : definition ? Math.max(definition.size.minHeight, Math.min(Math.max(definition.size.height * scale, (directItem?.minHeight || 0) + 30), definition.size.maxHeight)) : format.height;
    if (view === 'settings') contentHeight = 440;
    if (view === 'files') contentHeight = ['result', 'ocr', 'preview'].includes(fileMode) ? 264 : 238;
    if (localSend) contentHeight = localSend.direction === 'send' ? 210 : localSend.stage === 'consent' ? 116 : 158;
    const shelfDetails = view === 'tray' && !!shelfSelectionItem();
    if (shelfDetails) contentHeight = Math.max(contentHeight, 288);
    if (!homeActive && state === 'open' && weatherVisible()) contentHeight = Math.max(contentHeight, Math.min(moduleDefinitions.weather.size.maxHeight, weatherNaturalPanelHeight()));
    const editorHeight = editorLayout ? editorLayout.height + (window.innerWidth <= 430 ? 134 : window.innerWidth <= 640 ? 152 : 116) : 272;
    const desiredHeight = getModuleEditorActive() ? editorHeight : homeActive ? homeHeight : view === 'settings' || shelfDetails ? contentHeight : expandedMusic && window.innerWidth <= 640 ? Math.max(370, contentHeight) : !desktop && window.innerHeight <= 430 ? Math.min(contentHeight, 180) : contentHeight;
    const maximumHeight = desktop ? desktopMaxHeight - size.band - 8 : window.innerHeight - 96;
    let panelHeight = Math.max(0, Math.min(desiredHeight, maximumHeight));
    naturalOpenHeight = size.band + panelHeight;
    if (state === 'open' && view !== 'welcome' && activationPoint) {
      // A shorter destination keeps the clicked point visible until the pointer returns to its content.
      const pointerHeight = activationPoint.y - notch.getBoundingClientRect().top + 16;
      panelHeight = Math.max(0, Math.min(Math.max(panelHeight, pointerHeight - size.band), maximumHeight));
    }
    notch.style.setProperty('--panel-height', panelHeight + 'px');
    motion.setTarget({...size, width: Math.min(size.width, Math.max(1, window.innerWidth - 32)), height: size.band + (state === 'open' ? panelHeight : 0)}, {snap: !motionEnabled() || document.hidden});
    paint();
    renderLocalSend();
    recheckCollapse();
  }

  function setState(next) {
    if (disposed || !Object.hasOwn(sizes, next)) return false;
    window.clearTimeout(collapseTimer); collapseTimer = 0; collapseDeferred = false;
    if (next !== 'open' || state !== 'open') {openWidth = 0; activationPoint = null;}
    if (next !== 'open' && (menu.contains(document.activeElement) || panel.contains(document.activeElement))) toggle.focus({preventScroll: true});
    state = next;
    notch.dataset.state = next;
    document.body.dataset.notchState = next;
    toggle.setAttribute('aria-expanded', String(next === 'open'));
    toggle.tabIndex = next === 'open' && view === 'localsend' ? -1 : 0;
    toggle.setAttribute('aria-label', next === 'open' ? 'Réduire l’encoche' : 'Ouvrir l’encoche');
    panel.setAttribute('aria-hidden', String(next !== 'open'));
    panel.inert = next !== 'open';
    menu.hidden = next !== 'open' || view === 'welcome' || view === 'localsend';
    menu.inert = menu.hidden;
    renderMenuSelection();
    renderLiveActivities();
    update();
    musicLifecycle();
    renderFocus(); nearbyLifecycle();
    filesLifecycle();
    weatherLifecycle();
    renderModuleFeedback();
    if (next === 'open' && view === 'nook' && isModuleEnabled('shelf') && !shelfLoaded && !shelfBusy && !fileDragging) void loadShelf();
    return true;
  }

  function protectedInteraction() {
    const focused = document.hasFocus() ? document.activeElement : null;
    return welcome?.isActive() || fileDialogOpen || fileDragging || seekDragging || getModuleEditorActive() || state === 'open' && view === 'localsend' && !!nearby.incoming && localSendContext?.incomingId === nearby.incoming.id || queueOpen && (queueState.status === 'connecting' || queueBusy && queueOperation === 'play-track') || focused?.id !== 'music-seek' && !!focused?.closest('input,textarea,select,[contenteditable="true"]') || keyboardNavigation && state !== 'discreet' && !!focused?.closest('#notch-toggle,#notch-panel,#notch-menu');
  }
  function scheduleCollapse(deactivated = false) {
    window.clearTimeout(collapseTimer); collapseTimer = 0;
    if (disposed || state === 'discreet') { collapseDeferred = false; return; }
    collapseDeferred = protectedInteraction();
    if (collapseDeferred) return;
    collapseTimer = window.setTimeout(() => {
      collapseTimer = 0;
      if (disposed || !(deactivated || !pointerInside)) return;
      collapseDeferred = protectedInteraction();
      if (!collapseDeferred) setState('discreet');
    }, 220);
  }
  function recheckCollapse() { if (collapseDeferred && !disposed && !pointerInside && !protectedInteraction()) scheduleCollapse(); }
  function enter() { pointerInside = true; window.clearTimeout(collapseTimer); collapseTimer = 0; collapseDeferred = false; if (state !== 'open') setState('hover'); }
  function leave() { pointerInside = false; scheduleCollapse(); }
  function nativePointer(value) {
    const inside = value?.inside;
    if (disposed || document.hidden || typeof inside !== 'boolean') return;
    if (value.moved === true && keyboardNavigation) {
      keyboardNavigation = false;
      if (!inside) { leave(); return; }
    }
    if (inside === pointerInside) return;
    if (inside) enter(); else leave();
  }
  function toggleFocus() { if (keyboardNavigation && state === 'discreet') setState('hover'); }
  function open() { if (welcome?.isActive() && state === 'open') { finishWelcome('discreet'); return; } if (state === 'open') { if (!getModuleEditorActive()) setState('discreet'); return; } if (localSendBand()) { selectViewButton({dataset: {view: localSendBand().stage === 'ready' ? 'tray' : 'localsend'}}); setState('open'); return; } if (moduleFeedback && isModuleEnabled(moduleFeedback.id)) { selectViewButton({dataset: {view: moduleDefinitions[moduleFeedback.id].view}}); setState('open'); return; } if (music.available) selectViewButton(menuButtons.find(button => button.dataset.view === 'nook')); setState('open'); }
  function focusInteraction() { if (protectedInteraction()) { if (collapseTimer) collapseDeferred = true; window.clearTimeout(collapseTimer); collapseTimer = 0; } }
  function focusDeparture() { window.queueMicrotask(recheckCollapse); }
  function keyboardInteraction(event) { if (['Tab', 'Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {keyboardNavigation = true; focusInteraction();} }
  function pointerInteraction(event) {
    keyboardNavigation = false;
    activationPoint = state === 'open' && notch.contains(event.target) && Number.isFinite(event.clientY) ? {y: event.clientY} : null;
  }
  function pointerPosition(event) {
    // A real mouse move ends the keyboard guard without moving DOM focus.
    if (keyboardNavigation && event.pointerType === 'mouse' && (event.movementX || event.movementY)) {
      keyboardNavigation = false;
      if (!notch.contains(event.target)) scheduleCollapse();
    }
    if (!activationPoint) return;
    if (state !== 'open' || !notch.contains(event.target) || event.clientY - notch.getBoundingClientRect().top <= naturalOpenHeight - 16) {
      activationPoint = null;
      if (state === 'open') update();
    }
  }
  function showFileChooser(input) { fileDialogOpen = true; desktop?.setDialogOpen?.(true); input.click(); }
  function closeFileChooser() { fileDialogOpen = false; desktop?.setDialogOpen?.(false); recheckCollapse(); }
  function outside(event) { if (state === 'open' && !notch.contains(event.target)) { if (welcome?.isActive()) { finishWelcome('discreet'); return; } if (getModuleEditorActive()) closeModuleEditor(false); setState('discreet'); } }
  function key(event) { if (event.key === 'Escape' && !getModuleEditorActive()) { event.preventDefault(); if (queueOpen) { event.stopImmediatePropagation(); closeMusicQueue(); } else if (welcome?.isActive()) finishWelcome('discreet'); else setState('discreet'); } }
  function selectView(event) {
    const button = event.target.closest('[data-view]');
    if (disposed || menu.hidden || !button || !menu.contains(button)) return;
    selectViewButton(button);
  }
  function selectViewButton(button) {
    if (!button) return;
    if (view === 'welcome' && button.dataset.view !== 'welcome' && welcome?.isActive()) {
      welcome.hide(); try { window.localStorage.setItem(welcomeStorageKey, 'done'); } catch {}
    }
    view = button.dataset.view;
    toggle.tabIndex = state === 'open' && view === 'localsend' ? -1 : 0;
    byId('welcome-player').hidden = view !== 'welcome';
    menu.hidden = state !== 'open' || view === 'welcome' || view === 'localsend'; menu.inert = menu.hidden;
    panel.setAttribute('aria-label', Object.values(moduleDefinitions).find(item => item.view === view)?.label || (view === 'nook' ? 'Accueil Notchy' : view === 'welcome' ? 'Bienvenue dans Notchy' : view === 'localsend' ? 'Partage LocalSend' : view === 'files' ? 'Actions de fichier' : 'Réglages'));
    renderMenuSelection();
    renderHomeLayout();
    musicLifecycle();
    renderFocus();
    renderShelf();
    renderFiles(); filesLifecycle();
    renderWeather(); weatherLifecycle();
    renderSettings();
    renderModules(); nearbyLifecycle();
    renderModuleFeedback();
    renderLocalSend();
    if (builtinVisible('shelf') && !shelfLoaded && !shelfBusy && !fileDragging) void loadShelf();
  }
  function renderMenuSelection() {
    for (const item of menuButtons) {
      const definition = Object.values(moduleDefinitions).find(entry => entry.view === item.dataset.view);
      item.hidden = !!definition && !isModuleEnabled(definition.id) && !(definition.id === 'shelf' && view === 'tray');
      const selected = item.dataset.view === view || item.dataset.view === 'nook' && view === 'music';
      item.setAttribute('aria-pressed', String(selected)); item.setAttribute('aria-current', selected ? 'page' : 'false');
    }
  }

  notch.addEventListener('pointerenter', enter);
  notch.addEventListener('pointerleave', leave);
  toggle.addEventListener('focus', toggleFocus);
  toggle.addEventListener('click', open);
  menu.addEventListener('click', selectView);
  byId('welcome-replay').addEventListener('click', replayWelcome);
  byId('module-feedback-actions').addEventListener('click', feedbackCommand);
  panel.addEventListener('click', commandMusic);
  player.addEventListener('click', musicQueueCommand);
  musicSeek.addEventListener('input', previewMusicSeek);
  musicSeek.addEventListener('change', commitMusicSeek);
  musicSeek.addEventListener('pointerdown', startMusicSeek);
  document.addEventListener('pointerup', endMusicSeek);
  document.addEventListener('pointercancel', endMusicSeek);
  document.addEventListener('focusin', focusInteraction);
  document.addEventListener('focusout', focusDeparture);
  byId('weather-player').addEventListener('click', weatherCommand);
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
  document.addEventListener('pointerdown', outside);
  document.addEventListener('pointerdown', pointerInteraction, true);
  document.addEventListener('pointermove', pointerPosition, true);
  document.addEventListener('keydown', keyboardInteraction, true);
  document.addEventListener('keydown', key);
  document.addEventListener('visibilitychange', update);
  window.addEventListener('resize', update);
  reduced.addEventListener('change', update);
  if (desktop) {
    desktop.setInteractive(false);
    document.addEventListener('mousemove', desktopPointer);
    document.addEventListener('pointerdown', desktopFocus);
    const removeResume = desktop.onResume(value => { if (value?.maxHeight) desktopMaxHeight = value.maxHeight; if (value?.reason === 'open') setState('open'); else update(); });
    const removeDeactivate = desktop.onDeactivate?.(() => scheduleCollapse(true));
    const removePointer = desktop.onPointer?.(nativePointer);
    desktopRemoveResume = () => { removeResume(); removeDeactivate?.(); removePointer?.(); };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    queueEpoch++; queueOpen = queueActive = queueBusy = false; window.clearTimeout(queueTimer); queueTimer = 0;
    shelfEpoch++;
    fileEpoch++;
    disposeModules();
    disposeWeather();
    window.clearTimeout(nearbyTimer); nearbyTimer = 0;
    window.clearTimeout(filePoll); filePoll = 0;
    desktopRemoveResume?.();
    focusComponent.dispose(); clearModuleFeedback(false);
    welcome?.dispose();
    window.cancelAnimationFrame(frame);
    window.clearTimeout(collapseTimer); collapseTimer = 0;
    frame = 0;
    window.clearInterval(clock); clock = 0; clockDelay = 0;
    stream?.close(); retiringStream?.close(); stream = null; retiringStream = null;
    notch.removeEventListener('pointerenter', enter);
    notch.removeEventListener('pointerleave', leave);
    toggle.removeEventListener('focus', toggleFocus);
    toggle.removeEventListener('click', open);
    menu.removeEventListener('click', selectView);
    byId('welcome-replay').removeEventListener('click', replayWelcome);
    byId('module-feedback-actions').removeEventListener('click', feedbackCommand);
    panel.removeEventListener('click', commandMusic);
    player.removeEventListener('click', musicQueueCommand);
    musicSeek.removeEventListener('input', previewMusicSeek);
    musicSeek.removeEventListener('change', commitMusicSeek);
    musicSeek.removeEventListener('pointerdown', startMusicSeek);
    document.removeEventListener('pointerup', endMusicSeek);
    document.removeEventListener('pointercancel', endMusicSeek);
    document.removeEventListener('focusin', focusInteraction);
    document.removeEventListener('focusout', focusDeparture);
    byId('weather-player').removeEventListener('click', weatherCommand);
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
    reduced.removeEventListener('change', update);
  }

  window.notchy = Object.freeze({
    setState,
    setMusic,
    setAppearance,
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
    dispose,
    inspect: () => ({state, view, geometry: {...geometry}, homeLayout: homeLayout ? JSON.parse(JSON.stringify(homeLayout)) : null, morphing: motion.isActive(), band: parseFloat(notch.style.getPropertyValue('--band')), motion: motionEnabled(), appearance: {...appearance}, desktop: !!desktop, moduleEditing: getModuleEditorActive(), musicQueue: {open: queueOpen, status: queueState.status, count: queueState.items.length, busy: queueBusy}, file: currentFile() ? {...currentFile(), mode: fileMode, status: fileJob.status, jobId: fileJob.jobId, busy: fileBusy} : null, music: {...music, position: position()}, streamActive: !!stream, clockActive: !!clock, shelfCount: shelfItems.length, shelfBusy, modules: getModules(), focus: {active: focusIsActive(), running: !!focus.deadline, seconds: FocusModel.remaining(focus), phase: focus.pomodoro ? {...focus.pomodoro} : null, configuration: {...focusSettings}, complete: focus.complete, timerActive: focusComponent.inspect().timerActive},
    }),
  });
  window.addEventListener('pagehide', dispose, {once: true});
  welcome = window.NotchyWelcome.create({host: byId('welcome-player'), start: () => finishWelcome(), tutorialFinish: () => finishWelcome(), motion: motionEnabled});
  for (const id of Object.keys(moduleDefinitions).filter(id => !byId('module-catalog').querySelector(`[data-module-id="${id}"]`))) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.moduleCommand = 'pick'; button.dataset.moduleId = id; button.draggable = true;
    const tile = document.createElement('span'); tile.className = 'module-tile'; tile.append(byId(moduleDefinitions[id].element).querySelector('svg').cloneNode(true));
    tile.append(byId('module-catalog').querySelector('.module-installed').cloneNode(true)); const label = document.createElement('span'); label.className = 'module-label'; label.textContent = moduleLabels[id]; button.append(tile, label); byId('module-catalog').append(button);
  }
  renderAppearance(); renderHomeLayout(); renderModules(); renderFocus(); renderFiles(); renderWeather();
  setState('discreet');
  void readNearby();
  renderSettings();
  let welcomeDone = false; try { welcomeDone = window.localStorage.getItem(welcomeStorageKey) === 'done'; } catch {}
  if (!welcomeDone) showWelcome();
})(typeof window === 'object' ? window : null);
