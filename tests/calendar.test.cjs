'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {KEY, LIMITS, validDate, validTime, dayKey, dayOffset, shiftMonth, monthDays, weekDays, validateData, createPersistence, createStore} = require('../calendar.js');
const appointment = (overrides = {}) => ({id: 'appointment-1', title: 'Dentist', date: '2026-10-17', start: '09:00', end: '10:00', ...overrides});
const data = (...events) => ({version: 1, events});
const now = () => new Date(2026, 9, 17, 12).getTime();

test('calendar validates actual Gregorian dates and the supported range', () => {
  for (const value of ['1900-01-01', '2000-02-29', '2024-02-29', '2199-12-31']) assert.equal(validDate(value), true, value);
  for (const value of ['1899-12-31', '2200-01-01', '2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-1-01', '', null]) assert.equal(validDate(value), false, String(value));
});
test('appointments require canonical minute times and end after start on the same day', () => {
  for (const value of ['00:00', '09:03', '23:59']) assert.equal(validTime(value), true);
  for (const value of ['24:00', '9:00', '12:60', '09:00:00', null]) assert.equal(validTime(value), false);
  for (const value of [{start: '10:00', end: '10:00'}, {start: '23:00', end: '01:00'}, {end: '24:00'}]) assert.throws(() => validateData(data(appointment(value))), {code: 'time'});
});
test('today uses local calendar components rather than a UTC date slice', () => {
  const date = new Date(2026, 9, 17, 0, 1);
  assert.equal(dayKey(date), '2026-10-17');
});
test('month navigation clamps the day and honours leap years', () => {
  assert.equal(shiftMonth('2026-01-31', 1), '2026-02-28');
  assert.equal(shiftMonth('2024-03-31', -1), '2024-02-29');
  assert.equal(shiftMonth('2026-12-17', 1), '2027-01-17');
  assert.equal(shiftMonth('1900-01-01', -1), '1900-01-01');
  assert.equal(shiftMonth('2199-12-31', 1), '2199-12-31');
});
test('month grid has six Monday-first weeks including adjacent dates', () => {
  const days = monthDays('2026-10-17'); assert.equal(days.length, 42);
  assert.equal(days[0], '2026-09-28'); assert.equal(days.at(-1), '2026-11-08');
  assert.equal(new Set(days).size, 42); assert.equal(dayOffset('2026-12-31', 1), '2027-01-01');
});
test('the compact calendar exposes one complete week across month and year boundaries', () => {
  assert.deepEqual(weekDays('2026-10-17'), ['2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17','2026-10-18']);
  assert.deepEqual(weekDays('2027-01-01'), ['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03']);
  assert.equal(weekDays('2024-02-29')[3], '2024-02-29');
  assert.equal(weekDays('1900-01-01').length, 7);
  assert.equal(weekDays('2199-12-31').filter(validDate).at(-1), '2199-12-31');
  assert.throws(() => weekDays('2026-02-29'), {code:'date'});
});
test('persisted calendar rejects extra properties, invalid fields and duplicate IDs', () => {
  for (const value of [null, [], {version: 2, events: []}, {...data(), tasks: []}, data({...appointment(), note: 'extra'}), data(appointment(), appointment()), data(appointment({id: '../escape'})), data(appointment({id: ''})), data(appointment({id: 'a'.repeat(65)}))]) assert.throws(() => validateData(value));
});
test('titles are trimmed, bounded in Unicode points and cannot contain controls', () => {
  for (const title of ['', '  ', ' leading', 'trailing ', 'a\nline', 'a\u0085line', 'x'.repeat(121)]) assert.throws(() => validateData(data(appointment({title}))), {code: 'title'});
  assert.equal(validateData(data(appointment({title: '😀'.repeat(120)}))).events[0].title.length, 240);
  assert.equal(validateData(data(appointment({title: '<img src=x onerror=alert(1)>'}))).events[0].title, '<img src=x onerror=alert(1)>');
});
test('maximum event count is enforced without silently truncating saved data', () => {
  const events = Array.from({length: LIMITS.events}, (_, i) => appointment({id: 'id-' + i}));
  assert.equal(validateData(data(...events)).events.length, 200);
  assert.throws(() => validateData(data(...events, appointment({id: 'overflow'}))));
});
test('calendar data is cloned and ordered by date and start time', () => {
  const source = data(appointment({id: 'later', start: '13:00', end: '14:00'}), appointment({id: 'earlier'}));
  const value = validateData(source); assert.deepEqual(value.events.map(event => event.id), ['earlier', 'later']);
  value.events[0].title = 'Changed'; assert.equal(source.events[1].title, 'Dentist');
});
test('native persistence uses existing guarded settings operations and exact payload', async () => {
  let saved = null; const calls = [];
  const persistence = createPersistence({invoke: async (operation, args) => {calls.push([operation, args]); if (operation === 'settings_get') return saved ? {[KEY]: saved} : {}; saved = args.patch[KEY]; return {[KEY]: saved};}});
  assert.deepEqual(await persistence.load(), data()); await persistence.save(data(appointment()));
  assert.deepEqual(await persistence.load(), data(appointment()));
  assert.deepEqual(calls[1], ['settings_set', {patch: {[KEY]: data(appointment())}}]);
});
test('native save accepts the same appointment acknowledged with alphabetically ordered properties', async () => {
  const source = data(appointment(), appointment({id:'appointment-2', start:'13:00', end:'14:00'}));
  const reply = {events:source.events.map(({date,end,id,start,title}) => ({date,end,id,start,title})), version:1};
  let saved;
  const persistence = createPersistence({invoke:async (operation,args) => {assert.equal(operation,'settings_set'); saved=args.patch[KEY]; return {[KEY]:reply};}});
  await assert.doesNotReject(persistence.save(source));
  assert.deepEqual(saved, source);
});
test('native failure cannot fall back to browser storage and pretend a save succeeded', async () => {
  let browserWrites = 0;
  const persistence = createPersistence({invoke: async () => {throw Error('native rejected');}, storage: {setItem() {browserWrites++;}}});
  await assert.rejects(persistence.save(data(appointment()))); assert.equal(browserWrites, 0);
});
test('missing or mismatched native acknowledgement is a persistence error', async () => {
  for (const reply of [null, {}, {[KEY]: data()}]) {
    const persistence = createPersistence({invoke: async () => reply});
    await assert.rejects(persistence.save(data(appointment())), {code: 'storage'});
  }
});
test('a native corruption sentinel is an explicit load error, never a successful empty calendar', async () => {
  let writes = 0;
  const persistence = createPersistence({invoke: async (operation) => {if (operation === 'settings_set') writes++; return {[KEY]: null};}});
  const store = createStore({...persistence, now});
  assert.equal(await store.refresh(), false); assert.equal(store.snapshot().status, 'error');
  assert.equal(store.snapshot().todayCount, null); assert.equal(store.snapshot().loaded, false);
  await assert.rejects(store.add({title:'Appointment', date:'2026-10-17', start:'09:00', end:'10:00'}), {code:'busy'});
  assert.equal(writes, 0); store.dispose();
});
test('browser development storage roundtrips separately and rejects missing storage', async () => {
  const values = new Map(), persistence = createPersistence({storage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)}});
  assert.deepEqual(await persistence.load(), data()); await persistence.save(data(appointment())); assert.deepEqual(await persistence.load(), data(appointment()));
  await assert.rejects(createPersistence().load(), {code: 'storage'});
});
test('today count is unknown until loading completes and counts only real local appointments', async () => {
  const store = createStore({now, load: async () => data(appointment(), appointment({id: 'tomorrow', date: '2026-10-18'})), save: async () => {}});
  assert.equal(store.snapshot().todayCount, null); await store.refresh();
  assert.equal(store.snapshot().todayCount, 1); assert.equal(store.snapshot().events.length, 2); store.dispose();
});
test('add and remove are persisted before their results become visible', async () => {
  let finish; const writes = [], store = createStore({now, id: () => 'new-1', load: async () => data(), save: value => {writes.push(value); return new Promise(resolve => {finish = resolve;});}});
  await store.refresh(); const adding = store.add({title: '  Meeting  ', date: '2026-10-17', start: '09:00', end: '09:30'});
  assert.equal(store.snapshot().status, 'saving'); assert.equal(store.snapshot().todayCount, 0); assert.equal(writes[0].events[0].title, 'Meeting');
  finish(); await adding; assert.equal(store.snapshot().todayCount, 1);
  const removing = store.remove('new-1'); assert.equal(store.snapshot().todayCount, 1); finish(); await removing; assert.equal(store.snapshot().todayCount, 0); store.dispose();
});
test('failed save preserves the previous appointments and permits a later retry', async () => {
  let fail = true; const store = createStore({now, id: () => 'new-1', load: async () => data(appointment()), save: async () => {if (fail) throw Error('disk full');}});
  await store.refresh(); await assert.rejects(store.remove('appointment-1'), {code: 'storage'});
  assert.equal(store.snapshot().todayCount, 1); assert.equal(store.snapshot().status, 'error'); fail = false;
  await store.remove('appointment-1'); assert.equal(store.snapshot().todayCount, 0); assert.equal(store.snapshot().status, 'ready'); store.dispose();
});
test('malformed persisted events never become an empty successful calendar', async () => {
  const store = createStore({load: async () => ({version: 1, events: [{task: 'Pomodoro'}]}), save: async () => {}});
  assert.equal(await store.refresh(), false); assert.equal(store.snapshot().status, 'error'); assert.equal(store.snapshot().loaded, false); assert.equal(store.snapshot().todayCount, null); store.dispose();
});
test('synchronous load failure can be retried after storage recovers', async () => {
  let fail = true; const store = createStore({load: () => {if (fail) throw Error('unavailable'); return data();}, save: async () => {}});
  assert.equal(await store.refresh(), false); fail = false; assert.equal(await store.refresh(), true); assert.equal(store.snapshot().status, 'ready'); store.dispose();
});
test('simultaneous loads coalesce and cannot race a pending mutation', async () => {
  let finish, calls = 0; const store = createStore({load: async () => {calls++; return data(appointment());}, save: () => new Promise(resolve => {finish = resolve;})});
  const first = store.refresh(), second = store.refresh(); assert.equal(first, second); await first; assert.equal(calls, 1);
  const removing = store.remove('appointment-1'); assert.equal(await store.refresh(), false); assert.equal(calls, 1);
  await assert.rejects(store.remove('appointment-1'), {code: 'busy'}); finish(); await removing; store.dispose();
});
test('reloading a new store preserves successful add and deletion', async () => {
  let saved = data(); const options = {now, load: async () => saved, save: async value => {saved = copy(value);}, id: () => 'new-1'};
  function copy(value) {return JSON.parse(JSON.stringify(value));}
  const first = createStore(options); await first.refresh(); await first.add({title: 'Appointment', date: '2026-10-17', start: '12:00', end: '13:00'}); first.dispose();
  const second = createStore(options); await second.refresh(); assert.equal(second.snapshot().todayCount, 1); await second.remove('new-1'); second.dispose();
  const third = createStore(options); await third.refresh(); assert.equal(third.snapshot().todayCount, 0); third.dispose();
});
test('today count follows a local midnight without saving or adding data', async () => {
  let time = new Date(2026, 9, 17, 23, 59).getTime(), saves = 0;
  const store = createStore({now: () => time, load: async () => data(appointment({date: '2026-10-18'})), save: async () => {saves++;}});
  await store.refresh(); assert.equal(store.snapshot().todayCount, 0); time += 120000; assert.equal(store.snapshot().todayCount, 1); assert.equal(saves, 0); store.dispose();
});
test('dispose prevents a slow load from publishing later state changes', async () => {
  let finish, changes = 0; const store = createStore({load: () => new Promise(resolve => {finish = resolve;}), save: async () => {}});
  store.subscribe(() => changes++); const loading = store.refresh(); await Promise.resolve(); store.dispose(); finish(data(appointment()));
  assert.equal(await loading, false); assert.equal(changes, 1); assert.equal(await store.refresh(), false);
});

test('editing persists title, date and times while preserving the appointment identity and other events', async () => {
  let saved;
  const other = appointment({id: 'other', start: '13:00', end: '14:00'});
  const store = createStore({now, load: async () => data(appointment(), other), save: async value => {saved = value;}});
  await store.refresh();
  await store.update('appointment-1', {title: '  Updated meeting  ', date: '2026-10-18', start: '15:30', end: '16:15'});
  const updated = appointment({title: 'Updated meeting', date: '2026-10-18', start: '15:30', end: '16:15'});
  assert.deepEqual(saved, data(other, updated));
  assert.deepEqual(store.snapshot().events, [other, updated]);
  assert.equal(store.snapshot().todayCount, 1); store.dispose();
});

test('failed edits preserve the original event and the same values can be retried', async () => {
  let fail = true;
  const store = createStore({now, load: async () => data(appointment()), save: async () => {if (fail) throw Error('disk full');}});
  await store.refresh(); const changes = {title: 'Changed', date: '2026-10-17', start: '11:00', end: '12:00'};
  await assert.rejects(store.update('appointment-1', changes), {code: 'storage'});
  assert.deepEqual(store.snapshot().events, [appointment()]);
  fail = false; await store.update('appointment-1', changes);
  assert.deepEqual(store.snapshot().events, [appointment(changes)]); store.dispose();
});

test('editing rejects missing events and invalid replacements without a persistence call', async () => {
  let writes = 0;
  const store = createStore({load: async () => data(appointment()), save: async () => {writes++;}});
  await store.refresh();
  await assert.rejects(store.update('missing', appointment()), {code: 'missing'});
  for (const changes of [null, {...appointment(), title: ''}, {...appointment(), date: '2026-02-30'}, {...appointment(), start: '11:00'}]) await assert.rejects(store.update('appointment-1', changes));
  assert.equal(writes, 0); assert.deepEqual(store.snapshot().events, [appointment()]); store.dispose();
});

test('Undo restores the exact deleted event through persistent storage and survives reload', async () => {
  let saved = data(appointment(), appointment({id: 'other', date: '2026-10-18'}));
  const options = {now, load: async () => saved, save: async value => {saved = value;}};
  const store = createStore(options); await store.refresh();
  const deleted = store.snapshot().events[0]; await store.remove(deleted.id); assert.equal(store.snapshot().todayCount, 0);
  await store.restore(deleted); assert.equal(store.snapshot().todayCount, 1);
  assert.deepEqual(store.snapshot().events[0], deleted); store.dispose();
  const reloaded = createStore(options); await reloaded.refresh();
  assert.deepEqual(reloaded.snapshot().events[0], deleted); reloaded.dispose();
});

test('Undo never overwrites an appointment with the same ID', async () => {
  let writes = 0;
  const store = createStore({load: async () => data(appointment({title: 'Existing meeting'})), save: async () => {writes++;}});
  await store.refresh(); await assert.rejects(store.restore(appointment()), {code: 'collision'});
  assert.equal(writes, 0); assert.equal(store.snapshot().events[0].title, 'Existing meeting'); store.dispose();
});

test('a failed Undo preserves the saved deletion and permits restoring the same snapshot later', async () => {
  let fail = false, saved = data(appointment());
  const store = createStore({load: async () => saved, save: async value => {if (fail) throw Error('unavailable'); saved = value;}});
  await store.refresh(); const deleted = store.snapshot().events[0]; await store.remove(deleted.id);
  fail = true; await assert.rejects(store.restore(deleted), {code: 'storage'});
  assert.deepEqual(store.snapshot().events, []); assert.deepEqual(saved, data());
  fail = false; await store.restore(deleted); assert.deepEqual(saved, data(deleted)); store.dispose();
});

test('an existing appointment can be edited at the event limit, while Undo enforces the limit', async () => {
  const events = Array.from({length: LIMITS.events}, (_, index) => appointment({id: 'event-' + index}));
  const store = createStore({load: async () => data(...events), save: async () => {}}); await store.refresh();
  await store.update('event-0', {...events[0], title: 'Corrected'});
  assert.equal(store.snapshot().events.find(event => event.id === 'event-0').title, 'Corrected');
  await assert.rejects(store.restore(appointment()), {code: 'limit'}); store.dispose();
});
