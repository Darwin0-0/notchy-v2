(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) root.NotchyCalendar = api;
})(typeof window === 'object' ? window : null, function () {
  'use strict';
  const KEY = 'notchy-calendar-v1';
  const LIMITS = Object.freeze({events: 200, title: 120, bytes: 262144, firstYear: 1900, lastYear: 2199});
  const copy = value => JSON.parse(JSON.stringify(value));
  const pad = value => String(value).padStart(2, '0');
  const fault = code => Object.assign(new Error(code), {code});
  const plain = value => !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number), date = new Date(Date.UTC(year, month - 1, day));
    return year >= LIMITS.firstYear && year <= LIMITS.lastYear && date.toISOString().slice(0, 10) === value;
  }
  const validTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  function dayKey(value = Date.now()) {
    const date = new Date(value);
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }
  function dayOffset(value, offset) {
    if (!validDate(value) || !Number.isInteger(offset) || Math.abs(offset) > 366) throw fault('date');
    const date = new Date(value + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  }
  function shiftMonth(value, offset) {
    if (!validDate(value) || !Number.isInteger(offset) || Math.abs(offset) > 12) throw fault('date');
    const [year, month, day] = value.split('-').map(Number), target = new Date(Date.UTC(year, month - 1 + offset, 1));
    if (target.getUTCFullYear() < LIMITS.firstYear || target.getUTCFullYear() > LIMITS.lastYear) return value;
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    return target.getUTCFullYear() + '-' + pad(target.getUTCMonth() + 1) + '-' + pad(Math.min(day, last));
  }
  function monthDays(value) {
    if (!validDate(value)) throw fault('date');
    const first = value.slice(0, 8) + '01', weekday = (new Date(first + 'T12:00:00Z').getUTCDay() + 6) % 7;
    return Array.from({length: 42}, (_, index) => dayOffset(first, index - weekday));
  }
  function weekDays(value) {
    if (!validDate(value)) throw fault('date');
    const weekday = (new Date(value + 'T12:00:00Z').getUTCDay() + 6) % 7;
    return Array.from({length: 7}, (_, index) => dayOffset(value, index - weekday));
  }
  function validateEvent(value) {
    if (!exact(value, ['id', 'title', 'date', 'start', 'end'])) throw fault('invalid');
    if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.id)) throw fault('invalid');
    if (typeof value.title !== 'string' || value.title !== value.title.trim() || !value.title || [...value.title].length > LIMITS.title || /[\u0000-\u001f\u007f-\u009f]/.test(value.title)) throw fault('title');
    if (!validDate(value.date)) throw fault('date');
    if (!validTime(value.start) || !validTime(value.end) || value.start >= value.end) throw fault('time');
    return {id:value.id, title:value.title, date:value.date, start:value.start, end:value.end};
  }
  function validateData(value) {
    if (!exact(value, ['version', 'events']) || value.version !== 1 || !Array.isArray(value.events) || value.events.length > LIMITS.events) throw fault('invalid');
    if (new TextEncoder().encode(JSON.stringify(value)).length > LIMITS.bytes) throw fault('invalid');
    const ids = new Set(), events = value.events.map(event => {const next = validateEvent(event); if (ids.has(next.id)) throw fault('invalid'); ids.add(next.id); return next;});
    events.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
    return {version: 1, events};
  }
  function createPersistence({invoke, storage} = {}) {
    if (typeof invoke === 'function') return {
      async load() {const reply = await invoke('settings_get', {}); if (!plain(reply)) throw fault('storage'); return Object.hasOwn(reply, KEY) ? reply[KEY] : {version: 1, events: []};},
      async save(value) {const next = validateData(value), reply = await invoke('settings_set', {patch: {[KEY]: next}}); if (!plain(reply) || !Object.hasOwn(reply, KEY) || JSON.stringify(validateData(reply[KEY])) !== JSON.stringify(next)) throw fault('storage');},
    };
    return {
      async load() {if (!storage?.getItem) throw fault('storage'); const text = storage.getItem(KEY); return text === null ? {version: 1, events: []} : JSON.parse(text);},
      async save(value) {if (!storage?.setItem) throw fault('storage'); storage.setItem(KEY, JSON.stringify(validateData(value)));},
    };
  }
  function createStore({load, save, now = Date.now, id = () => globalThis.crypto.randomUUID()} = {}) {
    let data = {version: 1, events: []}, status = 'loading', error = '', loaded = false, busy = false, disposed = false, flight = null;
    const listeners = new Set();
    const snapshot = () => ({source: 'local', status, error, loaded, busy, events: copy(data.events), today: dayKey(now()), todayCount: loaded ? data.events.filter(event => event.date === dayKey(now())).length : null});
    const announce = () => {if (!disposed) for (const listener of [...listeners]) listener(snapshot());};
    function refresh() {
      if (disposed) return Promise.resolve(false);
      if (flight) return flight;
      if (busy) return Promise.resolve(false);
      busy = true; status = 'loading'; error = ''; announce();
      flight = (async () => {
        try {const next = validateData(await Promise.resolve().then(load)); if (disposed) return false; data = next; loaded = true; status = 'ready'; return true;}
        catch (cause) {if (!disposed) {status = 'error'; error = cause?.code || 'storage';} return false;}
        finally {busy = false; flight = null; announce();}
      })();
      return flight;
    }
    async function commit(next) {
      if (disposed) throw fault('disposed');
      if (busy || !loaded) throw fault('busy');
      next = validateData(next); busy = true; status = 'saving'; error = ''; announce();
      try {await save(copy(next)); if (disposed) return false; data = next; status = 'ready'; return true;}
      catch {if (!disposed) {status = 'error'; error = 'storage';} throw fault('storage');}
      finally {busy = false; announce();}
    }
    return Object.freeze({snapshot, refresh, subscribe(listener) {listeners.add(listener); return () => listeners.delete(listener);},
      async add(value) {
        if (data.events.length >= LIMITS.events) throw fault('limit');
        if (!plain(value)) throw fault('invalid');
        const event = validateEvent({id: id(), title: typeof value.title === 'string' ? value.title.trim() : value.title, date: value.date, start: value.start, end: value.end});
        return commit({version: 1, events: [...data.events, event]});
      },
      async update(eventId, value) {
        if (!data.events.some(event => event.id === eventId)) throw fault('missing');
        if (!plain(value)) throw fault('invalid');
        const event = validateEvent({id: eventId, title: typeof value.title === 'string' ? value.title.trim() : value.title, date: value.date, start: value.start, end: value.end});
        return commit({version: 1, events: data.events.map(current => current.id === eventId ? event : current)});
      },
      async remove(eventId) {if (!data.events.some(event => event.id === eventId)) throw fault('missing'); return commit({version: 1, events: data.events.filter(event => event.id !== eventId)});},
      async restore(value) {
        const event = validateEvent(value);
        if (data.events.some(current => current.id === event.id)) throw fault('collision');
        if (data.events.length >= LIMITS.events) throw fault('limit');
        return commit({version: 1, events: [...data.events, event]});
      },
      tick: announce,
      dispose() {disposed = true; listeners.clear();},
    });
  }
  function create({host, locale = () => 'fr', load, save, onClose = () => {}, onChange = () => {}, onLayout = () => {}, now = Date.now, motion = () => true, reflow} = {}) {
    if (!host?.ownerDocument || typeof load !== 'function' || typeof save !== 'function') throw new TypeError('Calendar requires a host and persistent load/save callbacks.');
    const document = host.ownerDocument, window = document.defaultView, store = createStore({load, save, now});
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)'), animations = new Set();
    let selectionFrame = 0, selectionFlight = null, selectionTarget = null, selectionPosition = null, weekKey = '', listKey = '', lastFormOpen = false, exitGhost = null;
    let opened = false, disposed = false, selected = dayKey(now()), trigger = null, formOpen = false, formError = '', notice = '', previousToday = dayKey(now());
    let editingId = null, formOrigin = null, formReturnDate = selected, undoEvent = null;
    let preferredHeight = 228;
    let draft = {title: '', date: selected, start: '09:00', end: '10:00'};
    const en = () => (typeof locale === 'function' ? locale() : locale) === 'en';
    const say = (fr, english) => en() ? english : fr;
    const format = (date, options) => new Intl.DateTimeFormat(en() ? 'en-GB' : 'fr-FR', {...options, timeZone: 'UTC'}).format(new Date(date + 'T12:00:00Z'));
    function make(tag, className = '', text = '') {const node = document.createElement(tag); node.className = className; node.textContent = text; return node;}
    function button(label, action, className = '') {const node = make('button', className, label); node.type = 'button'; node.addEventListener('click', action); return node;}
    const header = make('header', 'calendar-header'), back = button('', () => formOpen ? cancelForm() : close({reason: 'back'}), 'calendar-back'), title = make('h2'), today = button('', () => choose(dayKey(now())), 'calendar-today');
    header.append(back, title, today);
    const body = make('div', 'calendar-body'), month = make('section', 'calendar-month'), monthHeader = make('div', 'calendar-month-heading');
    const previous = button('‹', () => choose(dayOffset(selected, -7))), monthTitle = make('h3'), next = button('›', () => choose(dayOffset(selected, 7)));
    monthHeader.append(previous, monthTitle, next);
    const grid = make('div', 'calendar-grid'), selection = make('span', 'calendar-selection'); grid.setAttribute('role', 'grid'); selection.setAttribute('aria-hidden', 'true');
    month.append(monthHeader, grid);
    const agenda = make('section', 'calendar-agenda'), agendaHeader = make('div', 'calendar-agenda-heading'), dayTitle = make('h3'), add = button('+', () => showForm(), 'calendar-add');
    agendaHeader.append(dayTitle, add);
    const list = make('div', 'calendar-events'), form = make('form', 'calendar-form'), fields = {};
    form.noValidate = true;
    for (const [name, type] of [['title', 'text'], ['date', 'date'], ['start', 'time'], ['end', 'time']]) {
      const label = make('label', 'calendar-field calendar-field-' + name), caption = make('span'), input = make('input');
      input.name = name; input.type = type; input.required = true; input.autocomplete = 'off';
      if (name === 'title') {input.maxLength = 240; input.placeholder = '';}
      if (name === 'date') {input.min = '1900-01-01'; input.max = '2199-12-31';}
      if (type === 'time') input.step = '60';
      input.addEventListener('input', () => {draft[name] = input.value; if (formError) {formError = ''; showStatus(); reportLayout();}});
      label.append(caption, input); form.append(label); fields[name] = {label, caption, input};
    }
    const formActions = make('div', 'calendar-form-actions'), cancel = button('', cancelForm), submit = make('button', 'calendar-submit'); submit.type = 'submit'; formActions.append(cancel, submit); form.append(formActions);
    const status = make('p', 'calendar-status'), retry = button('', () => void store.refresh(), 'calendar-retry'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const undo = button('', () => void undoRemove(), 'calendar-undo');
    const agendaScroll = make('div', 'calendar-agenda-scroll'); agendaScroll.append(list, form);
    const eventsHeading = make('p', 'calendar-events-heading', say('Rendez-vous', 'Appointments'));
    agenda.append(eventsHeading, agendaScroll, status, undo, retry); body.append(agendaHeader, agenda, month);
    host.classList.add('notchy-calendar'); host.setAttribute('role', 'dialog'); host.setAttribute('aria-modal', 'false'); host.tabIndex = -1; host.hidden = true; host.replaceChildren(header, body);
    const moving = () => opened && !disposed && !document.hidden && motion() && !reduced.matches && document.body?.dataset.motion !== 'false';
    function animate(node, frames, options = {}) {
      if (!moving() || typeof node.animate !== 'function') return;
      const animation = node.animate(frames, {duration: 320, easing: 'cubic-bezier(.22,1,.36,1)', ...options});
      animations.add(animation);
      animation.onfinish = animation.oncancel = () => {animations.delete(animation); animation.onfinish = animation.oncancel = null; animation.cancel(); if (node.classList.contains('calendar-agenda-exit')) {node.remove(); if (exitGhost === node) exitGhost = null;}};
    }
    function stopAnimations() {
      for (const animation of animations) {animation.onfinish = animation.oncancel = null; animation.cancel();}
      animations.clear(); window.cancelAnimationFrame(selectionFrame); selectionFrame = 0; selectionFlight = null;
      exitGhost?.remove(); exitGhost = null;
      delete grid.dataset.traveling;
      if (selectionTarget) {selectionPosition = {...selectionTarget}; selection.style.translate = selectionTarget.x + 'px ' + selectionTarget.y + 'px';}
    }
    function updateTitle(node, text) {
      if (node.dataset.calendarTitle === text) return;
      for (const animation of animations) if (node.contains(animation.effect?.target)) {animation.cancel();}
      const previousText = node.dataset.calendarTitle;
      const letters = Array.from(text, letter => {const span = make('span', 'calendar-title-letter', letter); span.setAttribute('aria-hidden', 'true'); return span;});
      node.dataset.calendarTitle = text; node.setAttribute('aria-label', text); node.replaceChildren(...letters);
      if (previousText) letters.forEach((letter, index) => animate(letter, [{opacity: 0, transform: 'translateY(4px)', filter: 'blur(2px)'}, {opacity: 1, transform: 'translateY(0)', filter: 'blur(0)'}], {duration: 280, delay: Math.min(index * 14, 98), fill: 'both'}));
    }
    function positionSelection(immediate = false) {
      if (!opened || !grid.getClientRects().length) return;
      const node = grid.querySelector('[data-calendar-date="' + selected + '"]'); if (!node) return;
      // Layout coordinates exclude the button's temporary press compression.
      const target = {x: node.offsetLeft, y: node.offsetTop};
      const changed = !selectionTarget || Math.abs(target.x - selectionTarget.x) > .1 || Math.abs(target.y - selectionTarget.y) > .1;
      selection.style.width = node.offsetWidth + 'px'; selection.style.height = node.offsetHeight + 'px'; grid.dataset.indicator = 'true';
      if (!changed && !immediate) return;
      const now = window.performance.now(), current = selectionFlight?.spring.sample(now);
      const from = current ? {x: selectionFlight.target.x + current.values.x, y: selectionFlight.target.y + current.values.y} : selectionPosition;
      window.cancelAnimationFrame(selectionFrame); selectionFrame = 0; selectionTarget = target;
      if (immediate || !from || !moving() || typeof reflow !== 'function') {delete grid.dataset.traveling; selectionPosition = {...target}; selectionFlight = null; selection.style.translate = target.x + 'px ' + target.y + 'px'; return;}
      selectionFlight = {target, spring: reflow({x: from.x - target.x, y: from.y - target.y}, {now, velocity: current?.velocity})};
      function step(time) {
        selectionFrame = 0;
        if (!moving()) {stopAnimations(); return;}
        const value = selectionFlight.spring.sample(time);
        selectionPosition = {x: target.x + value.values.x, y: target.y + value.values.y};
        selection.style.translate = selectionPosition.x + 'px ' + selectionPosition.y + 'px';
        if (!value.done) {grid.dataset.traveling = 'true'; selectionFrame = window.requestAnimationFrame(step);} else {delete grid.dataset.traveling; selectionFlight = null;}
      }
      step(now);
    }
    function reportLayout() {
      if (!opened || !host.getClientRects().length) return;
      const style = window.getComputedStyle(host), number = value => parseFloat(value) || 0;
      const sections = [...body.children].filter(node => !node.hidden);
      const bodyHeight = sections.reduce((height, node) => height + node.offsetHeight, 0) + Math.max(0, sections.length - 1) * number(window.getComputedStyle(body).rowGap);
      const height = Math.ceil(header.offsetHeight + bodyHeight + number(style.rowGap) + number(style.paddingTop) + number(style.paddingBottom));
      if (height === preferredHeight) return;
      preferredHeight = height; onLayout(height);
    }
    function stopContentMotion() {
      for (const animation of [...animations]) if (animation.effect?.target === list || list.contains(animation.effect?.target) || animation.effect?.target === form || animation.effect?.target === month || animation.effect?.target === exitGhost) animation.cancel();
      exitGhost?.remove(); exitGhost = null;
    }
    function animateContent(previousRows, previousMonthTop) {
      if (!moving()) return;
      const scale = host.getBoundingClientRect().width / host.offsetWidth || 1;
      if (previousMonthTop !== null) animate(month, [{transform: 'translateY(' + ((previousMonthTop - month.getBoundingClientRect().top) / scale) + 'px)'}, {transform: 'translateY(0)'}], {duration: 460});
      const rows = formOpen ? [form] : [...list.children];
      rows.forEach((node, index) => {
        const prior = previousRows.get(node.dataset.calendarEvent), rect = node.getBoundingClientRect();
        const scale = host.getBoundingClientRect().width / host.offsetWidth || 1;
        animate(node, [{opacity: prior?.opacity ?? 0, transform: 'translateY(' + (prior ? (prior.top - rect.top) / scale : 6) + 'px)'}, {opacity: 1, transform: 'translateY(0)'}], {delay: prior ? 0 : Math.min(index * 36 + 30, 138), fill: 'both'});
      });
    }
    function fadeAgendaOut() {
      if (!moving() || agenda.hidden || !list.getClientRects().length) return;
      const rect = agenda.getBoundingClientRect(), frame = host.getBoundingClientRect(), scale = frame.width / host.offsetWidth || 1;
      exitGhost = agenda.cloneNode(true); exitGhost.classList.add('calendar-agenda-exit'); exitGhost.inert = true; exitGhost.setAttribute('aria-hidden', 'true');
      for (const node of exitGhost.querySelectorAll('[id],[data-calendar-edit]')) {node.removeAttribute('id'); node.removeAttribute('data-calendar-edit');}
      Object.assign(exitGhost.style, {left:(rect.left-frame.left)/scale+'px',top:(rect.top-frame.top)/scale+'px',width:rect.width/scale+'px',height:rect.height/scale+'px'});
      host.append(exitGhost); animate(exitGhost, [{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-6px)'}], {duration:160});
    }
    function message(code) {
      return ({title: say('Écris un titre de 120 caractères maximum.', 'Write a title of up to 120 characters.'), date: say('Choisis une date valide.', 'Choose a valid date.'), time: say('La fin doit être après le début, le même jour.', 'The end must be after the start on the same day.'), limit: say('200 rendez-vous maximum. Supprime-en un pour continuer.', 'Up to 200 appointments. Remove one to continue.'), busy: say('Patiente pendant l’enregistrement.', 'Wait while the calendar is saving.'), invalid: say('Les données du calendrier sont invalides.', 'The calendar data is invalid.'), storage: say('Enregistrement impossible. Tes modifications ne sont pas enregistrées.', 'Could not save. Your changes have not been saved.'), missing: say('Ce rendez-vous n’existe plus.', 'This appointment no longer exists.'), collision: say('Ce rendez-vous existe déjà. Aucun rendez-vous n’a été remplacé.', 'This appointment already exists. No appointment was replaced.')})[code] || say('Calendrier indisponible. Réessaie.', 'Calendar unavailable. Try again.');
    }
    function showStatus() {
      const value = store.snapshot();
      status.textContent = formError ? message(formError) : value.status === 'loading' ? say('Chargement du calendrier…', 'Loading calendar…') : value.status === 'saving' ? say('Enregistrement…', 'Saving…') : value.status === 'error' ? value.loaded ? message(value.error) : say('Impossible de charger le calendrier. Réessaie sans modifier les données enregistrées.', 'Could not load the calendar. Try again without changing saved data.') : notice;
      status.dataset.error = String(!!formError || value.status === 'error'); status.hidden = !status.textContent;
      retry.hidden = value.status !== 'error' || value.busy || value.loaded; retry.textContent = say('Réessayer', 'Try again');
      undo.hidden = !undoEvent; undo.disabled = value.busy; undo.textContent = say('Annuler la suppression', 'Undo deletion');
      undo.setAttribute('aria-label', undo.textContent + (undoEvent ? ' : ' + undoEvent.title : ''));
    }
    function render() {
      if (disposed) return;
      const value = store.snapshot(), focusDate = grid.contains(document.activeElement) ? document.activeElement.dataset.calendarDate : null;
      const previousMonthTop = opened && month.getClientRects().length ? month.getBoundingClientRect().top : null;
      const previousRows = new Map([...list.querySelectorAll('[data-calendar-event]')].map(node => [node.dataset.calendarEvent, {top: node.getBoundingClientRect().top, opacity: Number(window.getComputedStyle(node).opacity)}]));
      host.setAttribute('aria-label', say('Calendrier local', 'Local calendar')); host.setAttribute('aria-busy', String(value.busy));
      host.dataset.form = String(formOpen);
      back.textContent = '← ' + say('Retour', 'Back');
      back.disabled = value.busy; back.setAttribute('aria-label', formOpen ? say('Annuler les modifications et revenir aux rendez-vous', 'Cancel changes and return to appointments') : say('Fermer le calendrier et revenir', 'Close calendar and return'));
      title.textContent = say('Calendrier', 'Calendar'); today.textContent = say('Aujourd’hui', 'Today');
      const monthLabel = format(selected, {month: 'long', year: 'numeric'});
      updateTitle(monthTitle, monthLabel[0].toLocaleUpperCase() + monthLabel.slice(1)); grid.setAttribute('aria-label', monthTitle.textContent);
      previous.setAttribute('aria-label', say('Semaine précédente', 'Previous week')); next.setAttribute('aria-label', say('Semaine suivante', 'Next week'));
      previous.disabled = !validDate(dayOffset(selected, -7)); next.disabled = !validDate(dayOffset(selected, 7));
      const counts = new Map(); if (value.loaded) for (const event of value.events) counts.set(event.date, (counts.get(event.date) || 0) + 1);
      const days = weekDays(selected), changedWeek = weekKey !== days[0];
      if (changedWeek) {
        weekKey = days[0]; grid.replaceChildren(selection);
        const row = make('div', 'calendar-week'); row.setAttribute('role', 'row');
        for (const date of days) {
          const cell = make('div', 'calendar-cell'), node = button('', () => choose(date), 'calendar-day'); cell.setAttribute('role', 'gridcell');
          const month = make('span', 'calendar-day-month'), number = make('span', 'calendar-day-number', String(Number(date.slice(-2)))), weekday = make('span', 'calendar-day-weekday');
          node.append(month, number, weekday);
          node.dataset.calendarDate = date; node.disabled = !validDate(date); cell.append(node); row.append(cell);
        }
        grid.append(row);
      }
      for (const node of grid.querySelectorAll('[data-calendar-date]')) {
          const date = node.dataset.calendarDate, cell = node.parentElement; cell.setAttribute('aria-selected', String(date === selected));
          node.dataset.calendarDate = date; node.dataset.outside = String(date.slice(0, 7) !== selected.slice(0, 7)); node.tabIndex = date === selected ? 0 : -1;
          node.querySelector('.calendar-day-month').textContent = format(date, {month:'short'}).replace(/\.$/, '');
          node.querySelector('.calendar-day-weekday').textContent = format(date, {weekday:'short'}).replace(/\.$/, '');
          if (date === value.today) node.setAttribute('aria-current', 'date'); else node.removeAttribute('aria-current');
          const count = counts.get(date) || 0; node.setAttribute('aria-label', format(date, {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'}) + (count ? say(' · ' + count + ' rendez-vous', ' · ' + count + ' appointments') : ''));
          const dot = node.querySelector('.calendar-day-dot');
          if (count && !dot) {const dot = make('span', 'calendar-day-dot'); dot.setAttribute('aria-hidden', 'true'); node.append(dot);} else if (!count) dot?.remove();
      }
      positionSelection(changedWeek);
      if (focusDate) (grid.querySelector('[data-calendar-date="' + focusDate + '"]') || grid.querySelector('[tabindex="0"]'))?.focus({preventScroll: true});
      const dayLabel = formOpen ? editingId ? say('Modifier le rendez-vous', 'Edit appointment') : say('Nouveau rendez-vous', 'New appointment') : format(selected, {weekday:'long'});
      updateTitle(dayTitle, dayLabel[0].toLocaleUpperCase() + dayLabel.slice(1)); add.setAttribute('aria-label', say('Ajouter un rendez-vous', 'Add appointment')); add.title = add.getAttribute('aria-label'); add.disabled = formOpen || value.busy || !value.loaded || value.events.length >= LIMITS.events;
      list.hidden = formOpen; form.hidden = !formOpen;
      const events = value.events.filter(event => event.date === selected), nextListKey = JSON.stringify([selected, value.loaded, en(), events]);
      const contentChanged = !formOpen && nextListKey !== listKey || formOpen !== lastFormOpen;
      if (contentChanged) {stopContentMotion(); if (!formOpen && !lastFormOpen && !events.length && previousRows.size) fadeAgendaOut();}
      eventsHeading.textContent = say('Rendez-vous', 'Appointments'); eventsHeading.hidden = formOpen || !events.length;
      if (!formOpen && nextListKey !== listKey) {
        listKey = nextListKey;
        list.replaceChildren();
        if (value.loaded && !events.length) list.append(make('p', 'calendar-empty', say('Aucun rendez-vous ce jour. Utilise le bouton Ajouter pour en créer un.', 'No appointments on this day. Use Add to create one.')));
        for (const event of events) {
          const item = make('article', 'calendar-event'), edit = button('', () => showForm(event.id), 'calendar-edit'), time = make('time', '', event.start + ' – ' + event.end), name = make('strong', '', event.title), remove = button('×', () => void removeEvent(event.id), 'calendar-remove');
          item.dataset.calendarEvent = event.id;
          edit.dataset.calendarEdit = event.id; edit.disabled = value.busy; edit.setAttribute('aria-label', say('Modifier : ', 'Edit: ') + event.title); edit.title = edit.getAttribute('aria-label');
          time.dateTime = event.date + 'T' + event.start; remove.disabled = value.busy; remove.setAttribute('aria-label', say('Supprimer : ', 'Delete: ') + event.title); remove.title = remove.getAttribute('aria-label'); edit.append(name, time); item.append(edit, remove); list.append(item);
        }
      }
      for (const button of list.querySelectorAll('button')) button.disabled = value.busy || !value.loaded;
      const labels = {title: say('Titre', 'Title'), date: say('Date', 'Date'), start: say('Début', 'Start'), end: say('Fin', 'End')};
      for (const [name, field] of Object.entries(fields)) {field.caption.textContent = labels[name]; field.input.value = draft[name]; field.input.disabled = value.busy;}
      fields.title.input.placeholder = say('Nom du rendez-vous', 'Appointment title'); form.setAttribute('aria-label', editingId ? say('Modifier le rendez-vous', 'Edit appointment') : say('Ajouter un rendez-vous', 'Add appointment')); submit.textContent = editingId ? say('Enregistrer', 'Save') : say('Ajouter', 'Add'); submit.disabled = value.busy || !value.loaded; cancel.textContent = say('Annuler', 'Cancel'); cancel.disabled = value.busy;
      showStatus();
      agenda.hidden = !formOpen && !events.length && !status.textContent && undo.hidden && retry.hidden;
      reportLayout();
      if (contentChanged) animateContent(previousRows, previousMonthTop);
      lastFormOpen = formOpen;
    }
    function choose(date, focus = false) {if (!validDate(date)) return; selected = date; if (!formOpen) draft.date = selected; notice = ''; render(); if (focus) grid.querySelector('[tabindex="0"]')?.focus({preventScroll: true});}
    function focusAppointment(id) {const node = id ? [...list.querySelectorAll('[data-calendar-edit]')].find(item => item.dataset.calendarEdit === id) : null; (node || add).focus({preventScroll: true});}
    function cancelForm() {
      if (store.snapshot().busy) return;
      const id = editingId; selected = formReturnDate; formOpen = false; editingId = null; formError = ''; render();
      if (formOrigin?.isConnected && !formOrigin.hidden) formOrigin.focus({preventScroll: true}); else focusAppointment(id);
      formOrigin = null;
    }
    function showForm(eventId = null) {
      const value = store.snapshot(); if (value.busy || !value.loaded || formOpen) return;
      const event = eventId ? value.events.find(item => item.id === eventId) : null; if (eventId && !event) return;
      formOrigin = document.activeElement; formReturnDate = selected; editingId = eventId; formOpen = true; formError = ''; notice = '';
      draft = event ? {title: event.title, date: event.date, start: event.start, end: event.end} : {title: '', date: selected, start: '09:00', end: '10:00'};
      render(); fields.title.input.focus({preventScroll: true});
    }
    async function submitEvent(event) {
      event.preventDefault(); if (store.snapshot().busy) return;
      const id = editingId;
      try {await (id ? store.update(id, draft) : store.add(draft)); if (disposed) return; selected = draft.date; formOpen = false; editingId = null; formOrigin = null; formError = ''; notice = say('Rendez-vous enregistré.', 'Appointment saved.'); render(); if (opened) focusAppointment(id);}
      catch (error) {if (!disposed) {formError = error.code || 'storage'; render(); const name = error.code === 'title' ? 'title' : error.code === 'date' ? 'date' : error.code === 'time' ? 'end' : null; if (opened) {(name ? fields[name].input : submit).focus({preventScroll: true}); status.scrollIntoView({block: 'nearest'});}}}
    }
    async function removeEvent(id) {
      const event = store.snapshot().events.find(item => item.id === id); if (!event) return;
      try {await store.remove(id); if (!disposed) {undoEvent = event; formError = ''; notice = say('Rendez-vous supprimé.', 'Appointment deleted.'); render(); if (opened) undo.focus({preventScroll: true});}}
      catch (error) {if (!disposed) {formError = error.code || 'storage'; render(); if (opened) status.scrollIntoView({block: 'nearest'});}}
    }
    async function undoRemove() {
      if (!undoEvent || store.snapshot().busy) return;
      const event = undoEvent;
      try {await store.restore(event); if (disposed) return; undoEvent = null; formError = ''; notice = say('Rendez-vous restauré.', 'Appointment restored.'); if (!formOpen) selected = event.date; render(); if (opened) {if (formOpen) fields.title.input.focus({preventScroll: true}); else focusAppointment(event.id);}}
      catch (error) {if (!disposed) {formError = error.code || 'storage'; render(); if (opened) undo.focus({preventScroll: true});}}
    }
    function key(event) {
      if (!opened) return;
      if (event.key === 'Escape') {event.preventDefault(); event.stopImmediatePropagation(); if (store.snapshot().busy) return; if (formOpen) cancelForm(); else close({reason: 'escape'}); return;}
      const date = event.target.dataset?.calendarDate; if (!date) return;
      let target = null;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) target = dayOffset(date, {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7}[event.key]);
      else if (event.key === 'PageUp' || event.key === 'PageDown') target = shiftMonth(date, event.key === 'PageUp' ? -1 : 1);
      else if (event.key === 'Home' || event.key === 'End') {const offset = (new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7; target = dayOffset(date, event.key === 'Home' ? -offset : 6 - offset);}
      if (target) {event.preventDefault(); event.stopPropagation(); choose(target, true);}
    }
    function open(options = {}) {
      if (disposed) return false;
      const entering = !opened;
      if (entering) {trigger = options.trigger || document.activeElement; selected = dayKey(now()); formOpen = false; editingId = null; formOrigin = null; formError = ''; notice = ''; opened = true; host.hidden = false;}
      render(); if (entering) {positionSelection(true); animate(host, [{opacity: 0, transform: 'translateY(6px)'}, {opacity: 1, transform: 'translateY(0)'}], {duration: 260});}
      if (options.keyboard) grid.querySelector('[tabindex="0"]')?.focus({preventScroll: true}); return true;
    }
    function close({restoreFocus = true, notify = true, reason = 'close'} = {}) {
      if (!opened || store.snapshot().busy && notify) return false; stopAnimations(); opened = false; host.hidden = true;
      if (restoreFocus && trigger?.isConnected && trigger.getClientRects().length) trigger.focus({preventScroll: true});
      if (notify) onClose({reason, trigger, restoreFocus}); return true;
    }
    const unsubscribe = store.subscribe(value => {render(); onChange(value);});
    form.addEventListener('submit', submitEvent); host.addEventListener('keydown', key);
    const tick = () => {if (document.hidden) stopAnimations(); const next = dayKey(now()); if (next !== previousToday) {previousToday = next; store.tick();}};
    const syncMotion = () => {if (!moving()) stopAnimations();};
    const motionObserver = new window.MutationObserver(syncMotion); motionObserver.observe(document.body, {attributes: true, attributeFilter: ['data-motion']}); reduced.addEventListener('change', syncMotion);
    const resizeObserver = new window.ResizeObserver(() => {positionSelection(true); reportLayout();}); resizeObserver.observe(grid);
    document.addEventListener('visibilitychange', tick); const timer = window.setInterval(tick, 60000);
    render(); void store.refresh();
    return Object.freeze({open, close, isOpen: () => opened, isBusy: () => store.snapshot().busy, refreshLocale: render, refresh: () => store.refresh(), snapshot: store.snapshot,
      get todayCount() {return store.snapshot().todayCount;},
      get preferredHeight() {return preferredHeight;},
      dispose() {if (disposed) return; close({restoreFocus: false, notify: false}); stopAnimations(); disposed = true; undoEvent = null; formOrigin = null; unsubscribe(); store.dispose(); window.clearInterval(timer); motionObserver.disconnect(); resizeObserver.disconnect(); reduced.removeEventListener('change', syncMotion); form.removeEventListener('submit', submitEvent); host.removeEventListener('keydown', key); document.removeEventListener('visibilitychange', tick); host.replaceChildren();},
    });
  }
  return Object.freeze({KEY, LIMITS, validDate, validTime, dayKey, dayOffset, shiftMonth, monthDays, weekDays, validateEvent, validateData, createPersistence, createStore, create});
});
