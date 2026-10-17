'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const {weatherDesignValues, weatherNarrative, weatherConditionPath} = require('../notch.js');

const snapshot = {temperature: 19, min: 17, max: 26, rainRisk: 0,
  hours: Array.from({length: 8}, (_, index) => ({time: `2026-10-15T${String(index + 6).padStart(2, '0')}:00`, temperature: 19 + index})),
  days: [{date: '2026-10-15', min: 17, max: 26}, {date: '2026-10-16', min: 18, max: 27}, {date: '2026-10-17', min: 18, max: 26}]};

test('weather reveals the actual forecast at the three reference sizes', () => {
  for (const [size, hours, days, narrative] of [['full', 6, 3, true], ['scene', 4, 0, true], ['rail', 2, 0, false]]) {
    const result = weatherDesignValues(snapshot, size);
    assert.equal(result.size, size); assert.equal(result.hours.length, hours); assert.equal(result.days.length, days); assert.equal(result.narrative, narrative);
    assert.equal(result.hours[0].temperature, 19); assert.equal(result.rainRisk, 0);
  }
});

test('missing forecasts and unavailable current weather are never filled with placeholders', () => {
  const short = weatherDesignValues({...snapshot, hours: snapshot.hours.slice(0, 1), days: []});
  assert.equal(short.hours.length, 1); assert.equal(short.days.length, 0);
  for (const temperature of [null, undefined, NaN]) {
    const value = weatherDesignValues({...snapshot, temperature});
    assert.equal(value.available, false); assert.deepEqual(value.hours, []); assert.deepEqual(value.days, []); assert.equal(value.narrative, false);
  }
});

test('forecast validation removes impossible dates, duplicate slots and invalid ranges', () => {
  const value = weatherDesignValues({...snapshot, hours: [
    ...snapshot.hours.slice(0, 1), ...snapshot.hours.slice(0, 1),
    {time: '2026-02-30T10:00', temperature: 20}, {time: '2026-10-15T25:00', temperature: 20}, {time: '2026-10-15T09:00', temperature: null}
  ], days: [snapshot.days[0], snapshot.days[0], {date: '2026-02-30', min: 18, max: 27}, {date: '2026-10-16', min: 28, max: 20}, {date: '2026-10-17', min: 15, max: null}]});
  assert.deepEqual(value.hours, [{time: '2026-10-15T06:00', temperature: 19}]);
  assert.deepEqual(value.days, [{date: '2026-10-15', min: 17, max: 26}]);
});

test('weather typography converts real temperatures without inventing unavailable readings', () => {
  for (const [temperature, celsius, fahrenheit] of [[14,14,57],[27,27,81],[0,0,32],[-40,-40,-40],[14.4,14,58]]) {
    const value = weatherDesignValues({temperature}); assert.equal(value.celsius, celsius); assert.equal(value.fahrenheit, fahrenheit); assert.equal(value.available, true);
  }
  for (const temperature of [null, undefined, NaN, Infinity, 151, -151, '14']) {
    const value = weatherDesignValues({temperature}); assert.equal(value.available, false); assert.equal(value.celsius, null); assert.equal(value.fahrenheit, null);
  }
});

test('weather calendar distinguishes unknown data from a confirmed empty or populated day', () => {
  for (const count of [0,1,12,9999]) assert.equal(weatherDesignValues({calendarTodayCount:count}).calendarTodayCount, count);
  for (const count of [undefined,null,-1,1.5,'2',Infinity,10000]) assert.equal(weatherDesignValues({calendarTodayCount:count}).calendarTodayCount, null);
  const start = new Date(2026,9,17,0,0,1).getTime(), end = new Date(2026,9,17,23,59,59).getTime();
  assert.equal(weatherDesignValues({}, 'full', start).date, '2026-10-17'); assert.equal(weatherDesignValues({}, 'full', end).date, '2026-10-17');
});

for (const presentation of ['full', 'scene', 'rail']) test(`weather ${presentation} renders the latest condition independently of its hidden icon template`, () => {
  const node = tag => ({tag, children: [], dataset: {}, attributes: {}, classList: {add() {}},
    append(...items) {this.children.push(...items);}, prepend(...items) {this.children.unshift(...items);},
    replaceChildren(...items) {this.children = items;}, setAttribute(key, value) {this.attributes[key] = value;},
    removeAttribute(key) {delete this.attributes[key];}, getClientRects() {return [];},
    querySelector(selector) {return this.children.find(child => child.tag === selector) || this.children.map(child => child.querySelector(selector)).find(Boolean);},
    cloneNode() {const copy = node(tag); copy.attributes = {...this.attributes}; copy.children = this.children.map(child => child.cloneNode()); return copy;},
  });
  const template = node('svg'), templatePath = node('path'); templatePath.setAttribute('d', weatherConditionPath('sun')); template.append(templatePath);
  const host = node('div'), scope = {weather: {...snapshot, icon: 'rain', condition: 'Pluie'}, weatherBusy: false, weatherError: '', weatherPickerOpen: false,
    window: {}, document: {hidden: false, createElement: node}, i18n: {locale: () => 'fr'}, t: value => value,
    weatherDesignValues, weatherConditionPath, localizedWeatherNarrative: weatherNarrative, weatherFreshness: () => 'Updated',
    byId(id) {assert.equal(id, 'weather-condition-icon'); return template;},
  };
  const source = fs.readFileSync(require.resolve('../notch.js'), 'utf8'), start = source.indexOf('  function renderWeatherDesign('), end = source.indexOf('  function renderWeatherSummary(', start);
  assert(start > 0 && end > start);
  vm.runInNewContext(source.slice(start, end) + 'this.render = renderWeatherDesign;', scope);
  for (const condition of ['rain', 'moon', 'cloud-sun', 'fog', 'snow', 'thunder', 'unknown', 'sun']) {
    scope.weather.icon = condition; scope.render(host, presentation);
    assert.equal(host.querySelector('svg').querySelector('path').attributes.d, weatherConditionPath(condition));
    assert.equal(templatePath.attributes.d, weatherConditionPath('sun'), 'rendering must not mutate the shared template');
    assert.equal(host.dataset.condition, condition);
  }
  for (const count of [undefined,null,0,1,4,-1,'3']) {
    scope.weather.calendarTodayCount = count; scope.render(host, presentation);
    const stack = host.children[0], calendar = stack.children[1], city = stack.children[2], degrees = stack.children[3];
    assert.equal(stack.children.length, 5); assert.equal(calendar.tag, 'button'); assert.equal(calendar.dataset.weatherCommand, 'calendar');
    assert.equal(calendar.attributes['aria-haspopup'], 'dialog'); assert.equal(calendar.attributes['aria-controls'], 'calendar-player'); assert.equal(calendar.attributes['aria-expanded'], 'false');
    assert.equal(calendar.dataset.hasEvents, String(Number.isSafeInteger(count) && count > 0));
    assert.equal(city.tag, 'button'); assert.equal(city.dataset.weatherCommand, 'details');
    assert.equal(degrees.children[0].textContent, '19°C'); assert.equal(degrees.children[2].textContent, '66°F');
    scope.render(host, presentation); assert.equal(host.children[0], stack, 'unchanged weather/calendar must preserve the focused control rather than rebuild it');
  }
});
