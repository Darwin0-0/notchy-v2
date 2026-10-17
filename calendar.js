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
  function validateEvent(value) {
    if (!exact(value, ['id', 'title', 'date', 'start', 'end'])) throw fault('invalid');
    if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.id)) throw fault('invalid');
    if (typeof value.title !== 'string' || value.title !== value.title.trim() || !value.title || [...value.title].length > LIMITS.title || /[\u0000-\u001f\u007f-\u009f]/.test(value.title)) throw fault('title');
    if (!validDate(value.date)) throw fault('date');
    if (!validTime(value.start) || !validTime(value.end) || value.start >= value.end) throw fault('time');
    return {...value};
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
      async remove(eventId) {if (!data.events.some(event => event.id === eventId)) throw fault('missing'); return commit({version: 1, events: data.events.filter(event => event.id !== eventId)});},
      tick: announce,
      dispose() {disposed = true; listeners.clear();},
    });
  }
  function create({host, locale = () => 'fr', load, save, onClose = () => {}, onChange = () => {}, now = Date.now} = {}) {
    if (!host?.ownerDocument || typeof load !== 'function' || typeof save !== 'function') throw new TypeError('Calendar requires a host and persistent load/save callbacks.');
    const document = host.ownerDocument, window = document.defaultView, store = createStore({load, save, now});
    let opened = false, disposed = false, selected = dayKey(now()), trigger = null, formOpen = false, formError = '', notice = '', previousToday = dayKey(now());
    let draft = {title: '', date: selected, start: '09:00', end: '10:00'};
    const en = () => (typeof locale === 'function' ? locale() : locale) === 'en';
    const say = (fr, english) => en() ? english : fr;
    const format = (date, options) => new Intl.DateTimeFormat(en() ? 'en-GB' : 'fr-FR', {...options, timeZone: 'UTC'}).format(new Date(date + 'T12:00:00Z'));
    function make(tag, className = '', text = '') {const node = document.createElement(tag); node.className = className; node.textContent = text; return node;}
    function button(label, action, className = '') {const node = make('button', className, label); node.type = 'button'; node.addEventListener('click', action); return node;}
    const header = make('header', 'calendar-header'), back = button('', () => close({reason: 'back'}), 'calendar-back'), title = make('h2'), today = button('', () => choose(dayKey(now())), 'calendar-today');
    header.append(back, title, today);
    const body = make('div', 'calendar-body'), month = make('section', 'calendar-month'), monthHeader = make('div', 'calendar-month-heading');
    const previous = button('‹', () => choose(shiftMonth(selected, -1))), monthTitle = make('h3'), next = button('›', () => choose(shiftMonth(selected, 1)));
    monthHeader.append(previous, monthTitle, next);
    const weekdays = make('div', 'calendar-weekdays'), grid = make('div', 'calendar-grid'); grid.setAttribute('role', 'grid');
    month.append(monthHeader, weekdays, grid);
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
      input.addEventListener('input', () => {draft[name] = input.value; if (formError) {formError = ''; showStatus();}});
      label.append(caption, input); form.append(label); fields[name] = {label, caption, input};
    }
    const formActions = make('div', 'calendar-form-actions'), cancel = button('', () => {formOpen = false; formError = ''; render(); add.focus({preventScroll: true});}), submit = make('button', 'calendar-submit'); submit.type = 'submit'; formActions.append(cancel, submit); form.append(formActions);
    const status = make('p', 'calendar-status'), retry = button('', () => void store.refresh(), 'calendar-retry'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const agendaScroll = make('div', 'calendar-agenda-scroll'); agendaScroll.append(list, form);
    agenda.append(agendaHeader, agendaScroll, status, retry); body.append(month, agenda);
    host.classList.add('notchy-calendar'); host.setAttribute('role', 'dialog'); host.setAttribute('aria-modal', 'false'); host.tabIndex = -1; host.hidden = true; host.replaceChildren(header, body);
    function message(code) {
      return ({title: say('Écris un titre de 120 caractères maximum.', 'Write a title of up to 120 characters.'), date: say('Choisis une date valide.', 'Choose a valid date.'), time: say('La fin doit être après le début, le même jour.', 'The end must be after the start on the same day.'), limit: say('200 rendez-vous maximum. Supprime-en un pour continuer.', 'Up to 200 appointments. Remove one to continue.'), busy: say('Patiente pendant l’enregistrement.', 'Wait while the calendar is saving.'), invalid: say('Les données du calendrier sont invalides.', 'The calendar data is invalid.'), storage: say('Enregistrement impossible. Tes modifications ne sont pas enregistrées.', 'Could not save. Your changes have not been saved.'), missing: say('Ce rendez-vous n’existe plus.', 'This appointment no longer exists.')})[code] || say('Calendrier indisponible. Réessaie.', 'Calendar unavailable. Try again.');
    }
    function showStatus() {
      const value = store.snapshot();
      status.textContent = formError ? message(formError) : value.status === 'loading' ? say('Chargement du calendrier…', 'Loading calendar…') : value.status === 'saving' ? say('Enregistrement…', 'Saving…') : value.status === 'error' ? value.loaded ? message(value.error) : say('Impossible de charger le calendrier. Réessaie sans modifier les données enregistrées.', 'Could not load the calendar. Try again without changing saved data.') : notice;
      status.dataset.error = String(!!formError || value.status === 'error'); status.hidden = !status.textContent;
      retry.hidden = value.status !== 'error' || value.busy; retry.textContent = say('Réessayer', 'Try again');
    }
    function render() {
      if (disposed) return;
      const value = store.snapshot(), focusDate = grid.contains(document.activeElement) ? document.activeElement.dataset.calendarDate : null;
      host.setAttribute('aria-label', say('Calendrier local', 'Local calendar')); host.setAttribute('aria-busy', String(value.busy));
      back.textContent = '← ' + say('Retour', 'Back'); back.setAttribute('aria-label', say('Fermer le calendrier et revenir', 'Close calendar and return'));
      title.textContent = say('Calendrier', 'Calendar'); today.textContent = say('Aujourd’hui', 'Today');
      monthTitle.textContent = format(selected, {month: 'long', year: 'numeric'}); grid.setAttribute('aria-label', monthTitle.textContent);
      previous.setAttribute('aria-label', say('Mois précédent', 'Previous month')); next.setAttribute('aria-label', say('Mois suivant', 'Next month'));
      previous.disabled = selected.startsWith('1900-01'); next.disabled = selected.startsWith('2199-12');
      weekdays.replaceChildren(...Array.from({length: 7}, (_, i) => {const label = make('span', '', format(dayOffset('2026-10-12', i), {weekday: 'narrow'})); label.setAttribute('aria-hidden', 'true'); return label;}));
      const counts = new Map(); if (value.loaded) for (const event of value.events) counts.set(event.date, (counts.get(event.date) || 0) + 1);
      grid.replaceChildren(); const days = monthDays(selected);
      for (let week = 0; week < 6; week++) {
        const row = make('div', 'calendar-week'); row.setAttribute('role', 'row');
        for (const date of days.slice(week * 7, week * 7 + 7)) {
          const cell = make('div', 'calendar-cell'), node = button(String(Number(date.slice(-2))), () => choose(date), 'calendar-day'); cell.setAttribute('role', 'gridcell'); cell.setAttribute('aria-selected', String(date === selected));
          node.dataset.calendarDate = date; node.dataset.outside = String(date.slice(0, 7) !== selected.slice(0, 7)); node.tabIndex = date === selected ? 0 : -1;
          node.disabled = !validDate(date); if (date === value.today) node.setAttribute('aria-current', 'date');
          const count = counts.get(date) || 0; node.setAttribute('aria-label', format(date, {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'}) + (count ? say(' · ' + count + ' rendez-vous', ' · ' + count + ' appointments') : ''));
          if (count) {const dot = make('span', 'calendar-day-dot'); dot.setAttribute('aria-hidden', 'true'); node.append(dot);}
          cell.append(node); row.append(cell);
        }
        grid.append(row);
      }
      if (focusDate) (grid.querySelector('[data-calendar-date="' + focusDate + '"]') || grid.querySelector('[tabindex="0"]'))?.focus({preventScroll: true});
      dayTitle.textContent = format(selected, {weekday: 'short', day: 'numeric', month: 'short'}); add.setAttribute('aria-label', say('Ajouter un rendez-vous', 'Add appointment')); add.title = add.getAttribute('aria-label'); add.disabled = value.busy || !value.loaded || value.events.length >= LIMITS.events;
      list.hidden = formOpen; form.hidden = !formOpen;
      if (!formOpen) {
        const events = value.events.filter(event => event.date === selected);
        list.replaceChildren();
        if (value.loaded && !events.length) {list.append(make('p', 'calendar-empty', say('Aucun rendez-vous ce jour.', 'No appointments on this day.'))); if (value.events.length < LIMITS.events) list.append(button(say('Ajouter un rendez-vous', 'Add appointment'), () => showForm(), 'calendar-empty-add'));}
        for (const event of events) {
          const item = make('article', 'calendar-event'), time = make('time', '', event.start + ' – ' + event.end), name = make('strong', '', event.title), remove = button('×', () => void removeEvent(event.id), 'calendar-remove');
          time.dateTime = event.date + 'T' + event.start; remove.disabled = value.busy; remove.setAttribute('aria-label', say('Supprimer : ', 'Delete: ') + event.title); remove.title = remove.getAttribute('aria-label'); item.append(time, name, remove); list.append(item);
        }
      }
      const labels = {title: say('Titre', 'Title'), date: say('Date', 'Date'), start: say('Début', 'Start'), end: say('Fin', 'End')};
      for (const [name, field] of Object.entries(fields)) {field.caption.textContent = labels[name]; field.input.value = draft[name]; field.input.disabled = value.busy;}
      fields.title.input.placeholder = say('Nom du rendez-vous', 'Appointment title'); submit.textContent = say('Ajouter', 'Add'); submit.disabled = value.busy || !value.loaded; cancel.textContent = say('Annuler', 'Cancel'); cancel.disabled = value.busy;
      showStatus();
    }
    function choose(date, focus = false) {if (!validDate(date)) return; selected = date; if (!formOpen) draft.date = selected; notice = ''; render(); if (focus) grid.querySelector('[tabindex="0"]')?.focus({preventScroll: true});}
    function showForm() {if (store.snapshot().busy || !store.snapshot().loaded) return; formOpen = true; formError = ''; notice = ''; draft = {title: '', date: selected, start: '09:00', end: '10:00'}; render(); fields.title.input.focus({preventScroll: true});}
    async function submitEvent(event) {
      event.preventDefault(); if (store.snapshot().busy) return;
      try {await store.add(draft); if (disposed) return; selected = draft.date; formOpen = false; formError = ''; notice = say('Rendez-vous enregistré.', 'Appointment saved.'); render(); add.focus({preventScroll: true});}
      catch (error) {if (!disposed) {formError = error.code || 'storage'; render(); const name = error.code === 'title' ? 'title' : error.code === 'date' ? 'date' : error.code === 'time' ? 'end' : null; if (name) fields[name].input.focus({preventScroll: true}); if (opened) status.scrollIntoView({block: 'nearest'});}}
    }
    async function removeEvent(id) {
      try {await store.remove(id); if (!disposed) {notice = say('Rendez-vous supprimé.', 'Appointment deleted.'); render(); add.focus({preventScroll: true});}}
      catch (error) {if (!disposed) {formError = error.code || 'storage'; render(); if (opened) status.scrollIntoView({block: 'nearest'});}}
    }
    function key(event) {
      if (!opened) return;
      if (event.key === 'Escape') {event.preventDefault(); event.stopImmediatePropagation(); if (formOpen && !store.snapshot().busy) {formOpen = false; formError = ''; render(); add.focus({preventScroll: true});} else close({reason: 'escape'}); return;}
      const date = event.target.dataset?.calendarDate; if (!date) return;
      let target = null;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) target = dayOffset(date, {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7}[event.key]);
      else if (event.key === 'PageUp' || event.key === 'PageDown') target = shiftMonth(date, event.key === 'PageUp' ? -1 : 1);
      else if (event.key === 'Home' || event.key === 'End') {const offset = (new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7; target = dayOffset(date, event.key === 'Home' ? -offset : 6 - offset);}
      if (target) {event.preventDefault(); event.stopPropagation(); choose(target, true);}
    }
    function open(options = {}) {
      if (disposed) return false;
      if (!opened) {trigger = options.trigger || document.activeElement; selected = dayKey(now()); formOpen = false; formError = ''; notice = ''; opened = true; host.hidden = false;}
      render(); if (options.keyboard) grid.querySelector('[tabindex="0"]')?.focus({preventScroll: true}); return true;
    }
    function close({restoreFocus = true, notify = true, reason = 'close'} = {}) {
      if (!opened) return false; opened = false; host.hidden = true;
      if (restoreFocus && trigger?.isConnected && trigger.getClientRects().length) trigger.focus({preventScroll: true});
      if (notify) onClose({reason, trigger, restoreFocus}); return true;
    }
    const unsubscribe = store.subscribe(value => {render(); onChange(value);});
    form.addEventListener('submit', submitEvent); host.addEventListener('keydown', key);
    const tick = () => {const next = dayKey(now()); if (next !== previousToday) {previousToday = next; store.tick();}};
    document.addEventListener('visibilitychange', tick); const timer = window.setInterval(tick, 60000);
    render(); void store.refresh();
    return Object.freeze({open, close, isOpen: () => opened, isBusy: () => store.snapshot().busy, refreshLocale: render, refresh: () => store.refresh(), snapshot: store.snapshot,
      get todayCount() {return store.snapshot().todayCount;},
      dispose() {if (disposed) return; close({restoreFocus: false, notify: false}); disposed = true; unsubscribe(); store.dispose(); window.clearInterval(timer); form.removeEventListener('submit', submitEvent); host.removeEventListener('keydown', key); document.removeEventListener('visibilitychange', tick); host.replaceChildren();},
    });
  }
  return Object.freeze({KEY, LIMITS, validDate, validTime, dayKey, dayOffset, shiftMonth, monthDays, validateEvent, validateData, createPersistence, createStore, create});
});
