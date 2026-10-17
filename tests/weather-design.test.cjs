'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const {createHash} = require('node:crypto');
const {weatherDesignValues, weatherNarrative, weatherConditionPath, weatherGlyphMarkup} = require('../notch.js');

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

test('weather metrics preserve bounded readings and reject missing or invalid values', () => {
  const fields = {feelsLike:[-150,150],humidity:[0,100],windSpeed:[0,400],uvIndex:[0,30]};
  for (const [field,[min,max]] of Object.entries(fields)) {
    for (const value of [min,max]) assert.equal(weatherDesignValues({[field]:value})[field],value,field);
    for (const value of [undefined,null,NaN,Infinity,'12',min - 0.1,max + 0.1]) assert.equal(weatherDesignValues({[field]:value})[field],null,field);
  }
  const value = weatherDesignValues({feelsLike:18.6,humidity:72.5,windSpeed:12.5,uvIndex:4.2});
  assert.equal(value.feelsLike,19); assert.equal(value.humidity,72.5); assert.equal(value.windSpeed,12.5); assert.equal(value.uvIndex,4.2);
});

test('weather sunrise accepts a real local timestamp and rejects invalid dates or clock fields', () => {
  for (const sunrise of ['2024-02-29T00:00','2026-10-17T23:59:59']) assert.equal(weatherDesignValues({sunrise}).sunrise,sunrise);
  for (const sunrise of [undefined,null,42,'','2026-02-29T06:00','2026-02-30T06:00','2026-10-17','2026-10-17T24:00','2026-10-17T06:60','2026-10-17T06:00:60','2026-10-17T06:00Z']) assert.equal(weatherDesignValues({sunrise}).sunrise,null);
});

test('complete weather SVG markup matches the supplied mockup artwork', () => {
  // Independent SHA-256 values extracted from the supplied ZIP HTML, not notch.js:
  // Notch · Simple-html.zip / Notch_Simple.dc.html, archive 6915c0b54773fd98fc087cee1c6de3cae6ebd7b01600bb0224c91c2600f9e7c9.
  // Notch · Détaillé-html.zip / Notch_Detail.dc.html, archive 3201db9e194373b20d14f3efc383de2bfa17f51f96d609f58921193f3060e994.
  // Hash the inner SVG exactly, preserving geometry, grouping and authored colors.
  const expected = {
    sunrise:'07ca035021700d29923fb57596eb13f92e2fb20f92e9c64932a0ee338af5f05a',
    thermometer:'46f33544bba0e534d1652667e27e6e3fb78163797570aae52ec672da7a9a773c',
    calendar:'7f1088a847a0237b5790eb172f4b6b4d8d1680356ce1c0e074495e2dfbda5e59',
    cloud:'c52ed2a44ef60b121d07a093ab79c5d1b07f38a59167d4825703c2b330323f24',
    humidity:'a203b6e9790e436d6d3702c6e7f2678cebf4b25888e1ee422123cc1b03750502',
    wind:'cd6a44b51305dd3ffbd3712857cc78c8e2e9e9143f86c4183ffa205c3c1023d4',
    uv:'06b233a2b380116c964a6f7033a46234714113bc3ff4e1842a44bc11bfb4850c',
    sun:'08b7207c8cf6a967459278b59312ddd1fb40492bdcf1288292b4a6be71b7bd6f',
    rain:'c975660c015fd9ae00aa1a39e54d8e62220d37646ae63119ee745e008bd911a1',
  };
  for (const [kind,digest] of Object.entries(expected)) assert.equal(createHash('sha256').update(weatherGlyphMarkup(kind)).digest('hex'),digest,kind);
  for (const kind of ['cloud-sun','cloud-moon']) assert.equal(weatherGlyphMarkup(kind),weatherGlyphMarkup('cloud'));
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
    weatherDesignValues, weatherConditionPath, weatherGlyphMarkup, localizedWeatherNarrative: weatherNarrative, weatherFreshness: () => 'Updated',
    byId(id) {assert.equal(id, 'weather-condition-icon'); return template;},
  };
  const source = fs.readFileSync(require.resolve('../notch.js'), 'utf8'), start = source.indexOf('  function renderWeatherDesign('), end = source.indexOf('  function renderWeatherSummary(', start);
  assert(start > 0 && end > start);
  vm.runInNewContext(source.slice(start, end) + 'this.render = renderWeatherDesign;', scope);
  for (const condition of ['rain', 'moon', 'cloud-sun', 'fog', 'snow', 'thunder', 'unknown', 'sun']) {
    scope.weather.icon = condition; scope.render(host, presentation);
    const icon = host.children[0].children[4].children[1];
    assert.equal(icon.innerHTML, weatherGlyphMarkup(condition));
    assert.equal(icon.dataset.weatherGlyph,condition); assert.equal(icon.attributes.viewBox,'0 0 100 100');
    assert.equal(templatePath.attributes.d, weatherConditionPath('sun'), 'rendering must not mutate the shared template');
    assert.equal(host.dataset.condition, condition);
  }
  for (const count of [undefined,null,0,1,4,-1,'3']) {
    scope.weather.calendarTodayCount = count; scope.render(host, presentation);
    const stack = host.children[0], calendar = stack.children[1], city = stack.children[2], degrees = stack.children[3];
    assert.equal(stack.children.length, 5); assert.equal(calendar.tag, 'button'); assert.equal(calendar.dataset.weatherCommand, 'calendar');
    assert.equal(calendar.attributes['aria-haspopup'], 'dialog'); assert.equal(calendar.attributes['aria-controls'], 'calendar-player'); assert.equal(calendar.attributes['aria-expanded'], 'false');
    assert.equal(calendar.children[1].className, 'weather-typography-label'); assert.equal(city.children[0].className, 'weather-typography-label');
    assert.equal(calendar.dataset.hasEvents, String(Number.isSafeInteger(count) && count > 0));
    assert.equal(city.tag, 'button'); assert.equal(city.dataset.weatherCommand, 'details');
    assert.equal(degrees.children.length,2); assert.equal(degrees.children[0].className,'weather-typography-celsius');
    assert.equal(degrees.children[0].children[0].textContent, '19°C'); assert.equal(degrees.children[0].children[1].innerHTML,weatherGlyphMarkup('thermometer')); assert.equal(degrees.children[1].textContent, '66°F');
    assert.equal(calendar.children[0].innerHTML,weatherGlyphMarkup('calendar')); assert.equal(stack.children[0].children[1].innerHTML,weatherGlyphMarkup('sunrise'));
    scope.render(host, presentation); assert.equal(host.children[0], stack, 'unchanged weather/calendar must preserve the focused control rather than rebuild it');
  }
});

function detailFixture(language, value = {}) {
  const node = tag => {
    let text = '';
    const element = {tag, className:'', children:[], dataset:{}, attributes:{},
      get textContent() {return text + this.children.map(child => child.textContent).join('');}, set textContent(value) {text = String(value); this.children = [];},
      append(...items) {this.children.push(...items);}, replaceChildren(...items) {text = ''; this.children = items;},
      setAttribute(key, value) {this.attributes[key] = value; if (key === 'class') this.className = value;}, removeAttribute(key) {delete this.attributes[key];},
      getClientRects() {return [];},
      querySelectorAll(selector) {return this.children.flatMap(child => [child, ...child.querySelectorAll('*')]).filter(child => selector === '*' || (selector.startsWith('.') ? child.className.split(' ').includes(selector.slice(1)) : child.tag === selector));},
      querySelector(selector) {return this.querySelectorAll(selector)[0];},
      cloneNode() {const copy = node(tag); copy.className = this.className; copy.attributes = {...this.attributes}; copy.textContent = text; copy.children = this.children.map(child => child.cloneNode()); return copy;},
    };
    element.classList = {add(...names) {element.className = [...new Set([...element.className.split(' ').filter(Boolean), ...names])].join(' ');}};
    return element;
  };
  const template = node('svg'); template.append(node('path'));
  const i18n = require('../i18n.js').create({getItem:() => language, setItem(){}}), host = node('div');
  const scope = {weather:{...snapshot,mode:'city',city:'Kinshasa',displayName:'Kinshasa',icon:'sun',condition:'Ciel dégagé',feelsLike:18,humidity:72,windSpeed:12.5,uvIndex:4.2,sunrise:'2026-10-15T06:13',calendarTodayCount:1,...value},weatherBusy:false,weatherError:'',weatherPickerOpen:false,window:{},document:{hidden:false,createElement:node},i18n,t:i18n.t,weatherDesignValues,weatherConditionPath,weatherGlyphMarkup,localizedWeatherNarrative:weatherNarrative,weatherFreshness:()=>'Updated',byId:()=>template};
  const source = fs.readFileSync(require.resolve('../notch.js'), 'utf8'), start = source.indexOf('  function renderWeatherDesign('), end = source.indexOf('  function renderWeatherSummary(', start);
  vm.runInNewContext(source.slice(start, end) + 'this.render = renderWeatherDesign;', scope);
  return {host, scope};
}

for (const language of ['fr','en']) test(`expanded weather ${language} preserves city and calendar actions with real readings and six hourly forecasts`, () => {
  const {host,scope} = detailFixture(language); scope.render(host,'rail',{interactive:true});
  assert.equal(host.dataset.weatherView,'detail'); assert.equal(host.dataset.size,'full'); assert(host.className.includes('weather-detail'));
  const hero = host.querySelector('.weather-detail-hero'), date = hero.querySelector('.weather-typography-date'), picker = hero.querySelector('.weather-design-city');
  assert.equal(hero.tag,'header'); assert.equal(hero.querySelector('.weather-typography'),undefined);
  assert.match(date.textContent,language === 'en' ? /October/ : /octobre/); assert.equal(date.dataset.weatherCommand,'calendar'); assert.equal(date.attributes['aria-haspopup'],'dialog'); assert.equal(date.dataset.hasEvents,'true');
  assert.equal(picker.id,'weather-city-button'); assert.equal(picker.dataset.weatherCommand,'picker'); assert.equal(picker.textContent,'Kinshasa'); assert.equal(picker.attributes['aria-controls'],'weather-picker');
  assert.equal(hero.querySelector('.weather-detail-sunrise').textContent,language === 'en' ? '· Sunrise 06:13' : '· Lever 06:13');
  assert.equal(hero.querySelector('.weather-design-temperature').textContent,'19°C'); assert.equal(hero.querySelector('.weather-typography-fahrenheit').textContent,'66°F');
  assert.equal(hero.querySelector('.weather-detail-condition').textContent,language === 'en' ? 'Clear sky' : 'Ciel dégagé');
  assert.equal(hero.querySelector('.weather-detail-condition-icon').innerHTML,weatherGlyphMarkup('sun'));
  const hours = host.querySelectorAll('.weather-design-hour');
  assert.deepEqual(hours.map(hour => hour.children[2].textContent),['19°','20°','21°','22°','23°','24°']);
  assert.equal(hours[0].children[0].textContent,language === 'en' ? '06:00' : '06 h');
  assert(hours.every(hour => hour.children[1].innerHTML === weatherGlyphMarkup('sun')));
  assert.equal(host.querySelectorAll('.weather-design-day').length,0);
  const stats = host.querySelector('.weather-detail-stats'); assert.equal(stats.children.length,4);
  assert.deepEqual(stats.children.map(tile => tile.dataset.metric),['thermometer','humidity','wind','uv']);
  assert.deepEqual(stats.querySelectorAll('.weather-detail-stat-label').map(label => label.textContent),language === 'en' ? ['Feels like','Humidity','Wind','UV index'] : ['Ressenti','Humidité','Vent','Indice UV']);
  assert.deepEqual(stats.querySelectorAll('.weather-detail-stat-value').map(value => value.textContent),language === 'en' ? ['18°','72%','12.5 km/h','4.2'] : ['18°','72%','12,5 km/h','4,2']);
  scope.render(host,'rail',{interactive:true}); assert.equal(host.querySelector('.weather-detail-hero'),hero,'unchanged readings preserve the active calendar/city controls');
});

test('expanded weather hides missing forecasts and sunrise while keeping unavailable metric tiles explicit', () => {
  const {host,scope} = detailFixture('fr',{hours:[],days:[],feelsLike:null,humidity:null,windSpeed:null,uvIndex:null,sunrise:null}); scope.render(host,'full',{interactive:true});
  assert.equal(host.querySelector('.weather-detail-forecast').hidden,true); assert.notEqual(host.querySelector('.weather-detail-stats').hidden,true);
  assert.equal(host.querySelectorAll('.weather-design-hour').length,0); assert.equal(host.querySelectorAll('.weather-design-day').length,0);
  assert.equal(host.querySelector('.weather-detail-sunrise'),undefined);
  assert.deepEqual(host.querySelectorAll('.weather-detail-stat-value').map(value => value.textContent),['—','—','—','—']);
});

test('expanded weather filters invalid hourly slots and uses each valid slot condition', () => {
  const {host,scope} = detailFixture('en',{hours:[{time:'2026-02-30T07:00',temperature:20},{time:'2026-10-17T07:00',temperature:20,icon:'rain'},{time:'2026-10-17T07:00',temperature:21,icon:'sun'},{time:'2026-10-17T08:00',temperature:null},{time:'2026-10-17T09:00',temperature:22,icon:'cloud'}],sunrise:'2026-10-17T24:00',humidity:101,windSpeed:-1,uvIndex:'4',feelsLike:Infinity});
  scope.render(host,'full',{interactive:true});
  const hours = host.querySelectorAll('.weather-design-hour'); assert.equal(hours.length,2);
  assert.deepEqual(hours.map(hour => hour.children[0].textContent),['07:00','09:00']); assert.deepEqual(hours.map(hour => hour.children[2].textContent),['20°','22°']);
  assert.deepEqual(hours.map(hour => hour.children[1].innerHTML),[weatherGlyphMarkup('rain'),weatherGlyphMarkup('cloud')]);
  assert.equal(host.querySelector('.weather-detail-sunrise'),undefined); assert.deepEqual(host.querySelectorAll('.weather-detail-stat-value').map(value => value.textContent),['—','—','—','—']);
});
