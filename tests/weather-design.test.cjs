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
  for (const [size, hours, days, narrative] of [['full', 5, 3, true], ['scene', 4, 0, true], ['rail', 2, 0, false]]) {
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

test('unchanged condition icons retain the supplied detailed mockup artwork', () => {
  // Independent SHA-256 values extracted from the supplied ZIP HTML, not notch.js:
  // Notch · Simple-html.zip / Notch_Simple.dc.html, archive 6915c0b54773fd98fc087cee1c6de3cae6ebd7b01600bb0224c91c2600f9e7c9.
  // Notch · Détaillé-html.zip / Notch_Detail.dc.html, archive 3201db9e194373b20d14f3efc383de2bfa17f51f96d609f58921193f3060e994.
  // Hash the inner SVG exactly, preserving geometry, grouping and authored colors.
  const expected = {
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

test('new narrative and balanced icons preserve the supplied SVG geometry in the shared 100-unit viewBox',()=>{
  // Inner markup independently transcribed from WeatherNarrative.dc.html and Weather.dc.html.
  const reference={
    sunrise:'<path d="M7 22a9 9 0 0 1 18 0z" fill="#ff9f1c"></path><path d="M16 5v5 M5.5 11l3.5 3.5 M26.5 11L23 14.5 M3 22h26 M8 27h16" stroke="#ff9f1c" stroke-width="2.4" stroke-linecap="round" fill="none"></path>',
    thermometer:'<rect x="12" y="3" width="8" height="19" rx="4" fill="none" stroke="#ff4d3d" stroke-width="2.6"></rect><circle cx="16" cy="24" r="5" fill="#ff4d3d"></circle><rect x="14.6" y="11" width="2.8" height="13" rx="1.4" fill="#ff4d3d"></rect>',
    moon:'<path d="M25 19.5A11 11 0 0 1 12.5 7a11 11 0 1 0 12.5 12.5z" fill="#9db8d9"></path>'
  };
  for(const [kind,markup]of Object.entries(reference))assert.equal(weatherGlyphMarkup(kind),'<g transform="scale(3.125)">'+markup+'</g>',kind);
  assert.equal(weatherGlyphMarkup('moon-small'),'<g transform="scale(4.1666667)"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="#9db8d9"></path></g>');
  const calendar='<rect x="3" y="3" width="26" height="26" rx="7" fill="#5a5a5e"></rect><g fill="#9a9a9f"><circle cx="10" cy="11" r="1.6"></circle><circle cx="16" cy="11" r="1.6"></circle><circle cx="22" cy="11" r="1.6"></circle><circle cx="10" cy="17" r="1.6"></circle><circle cx="16" cy="17" r="1.6"></circle><circle cx="22" cy="17" r="1.6"></circle><circle cx="10" cy="23" r="1.6"></circle><circle cx="16" cy="23" r="1.6"></circle></g>';
  const scaled=calendar.replace(/\b(x|y|width|height|rx|cx|cy|r)="([\d.]+)"/g,(_,key,value)=>key+'="'+Number(value)*3.125+'"');
  assert.equal(weatherGlyphMarkup('calendar'),scaled,'calendar retains direct rect/group children so the real appointment colors still apply');
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
    const icon = host.children[1].children[4].children[1];
    assert.equal(icon.innerHTML, weatherGlyphMarkup(condition));
    assert.equal(icon.dataset.weatherGlyph,condition); assert.equal(icon.attributes.viewBox,'0 0 100 100');
    assert.equal(templatePath.attributes.d, weatherConditionPath('sun'), 'rendering must not mutate the shared template');
    assert.equal(host.dataset.condition, condition);
  }
  for (const count of [undefined,null,0,1,4,-1,'3']) {
    scope.weather.calendarTodayCount = count; scope.render(host, presentation);
    const stack = host.children[1], calendar = stack.children[1], city = stack.children[2], degrees = stack.children[3];
    assert.equal(host.children[0].className,'weather-design-eyebrow');assert.equal(host.children[0].textContent,'MÉTÉO');
    assert.equal(stack.children.length, 5); assert.equal(calendar.tag, 'button'); assert.equal(calendar.dataset.weatherCommand, 'calendar');
    assert.equal(calendar.attributes['aria-haspopup'], 'dialog'); assert.equal(calendar.attributes['aria-controls'], 'calendar-player'); assert.equal(calendar.attributes['aria-expanded'], 'false');
    assert.equal(calendar.children[1].className, 'weather-typography-label'); assert.equal(city.children[0].className, 'weather-typography-label');
    assert.equal(calendar.dataset.hasEvents, String(Number.isSafeInteger(count) && count > 0));
    assert.equal(city.tag, 'button'); assert.equal(city.dataset.weatherCommand, 'details');
    assert.equal(degrees.children.length,2); assert.equal(degrees.children[0].className,'weather-typography-celsius');
    assert.equal(degrees.children[0].children[0].textContent, '19°C'); assert.equal(degrees.children[0].children[1].innerHTML,weatherGlyphMarkup('thermometer')); assert.equal(degrees.children[1].textContent, '66°F');
    assert.equal(calendar.children[0].innerHTML,weatherGlyphMarkup('calendar')); assert.equal(stack.children[0].children[1].innerHTML,weatherGlyphMarkup('sunrise'));
    scope.render(host, presentation); assert.equal(host.children[1], stack, 'unchanged weather/calendar must preserve the focused control rather than rebuild it');
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
      focus(options) {this.focusedWith=options;},
      querySelectorAll(selector) {const command=selector.match(/^\[data-weather-command="([^"]+)"\]$/)?.[1];return this.children.flatMap(child => [child, ...child.querySelectorAll('*')]).filter(child => selector === '*' || (command?child.dataset.weatherCommand===command:selector.startsWith('.') ? child.className.split(' ').includes(selector.slice(1)) : child.tag === selector));},
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
  return {host, scope, node, template};
}

for (const language of ['fr','en']) test(`balanced weather ${language} preserves city and calendar actions with real readings and five hourly forecasts`, () => {
  const {host,scope} = detailFixture(language); scope.render(host,'rail',{interactive:true});
  assert.equal(host.dataset.weatherView,'detail'); assert.equal(host.dataset.size,'full'); assert(host.className.includes('weather-detail'));
  const hero = host.querySelector('.weather-detail-hero'), date = hero.querySelector('.weather-typography-date'), picker = hero.querySelector('.weather-design-city');
  assert.equal(hero.tag,'header'); assert.equal(hero.querySelector('.weather-typography'),undefined);
  assert.match(date.textContent,language === 'en' ? /October/ : /octobre/); assert.equal(date.dataset.weatherCommand,'calendar'); assert.equal(date.attributes['aria-haspopup'],'dialog'); assert.equal(date.dataset.hasEvents,'true');
  assert.equal(picker.id,'weather-city-button'); assert.equal(picker.dataset.weatherCommand,'picker'); assert.equal(picker.textContent,'Kinshasa'); assert.equal(picker.attributes['aria-controls'],'weather-picker');
  assert.equal(host.querySelector('.weather-design-temperature').textContent,'19°');assert.equal(host.querySelector('.weather-design-temperature').title,'19°C');assert.equal(host.querySelector('.weather-typography-fahrenheit').textContent,'66°F');
  assert.equal(host.querySelector('.weather-detail-condition').textContent,language === 'en' ? 'Clear sky' : 'Ciel dégagé');
  assert.equal(host.querySelector('.weather-detail-condition-icon').innerHTML,weatherGlyphMarkup('sun'));
  assert.equal(host.querySelector('.weather-detail-range').textContent,language === 'en' ? 'Low 17° · High 26°' : 'Min 17° · Max 26°');
  const hours = host.querySelectorAll('.weather-design-hour');
  assert.deepEqual(hours.map(hour => hour.children[2].textContent),['19°','20°','21°','22°','23°']);
  assert.equal(hours[0].children[0].textContent,language === 'en' ? '06:00' : '06h');
  assert(hours.every(hour => hour.children[1].innerHTML === weatherGlyphMarkup('sun')));
  assert.equal(host.querySelectorAll('.weather-design-day').length,0);
  assert.equal(host.querySelector('.weather-detail-stats'),undefined);assert.equal(host.querySelector('.weather-detail-sunrise'),undefined);
  scope.render(host,'rail',{interactive:true}); assert.equal(host.querySelector('.weather-detail-hero'),hero,'unchanged readings preserve the active calendar/city controls');
});

test('balanced weather hides missing forecasts and never invents absent daily extrema', () => {
  const {host,scope} = detailFixture('fr',{hours:[],days:[],min:null,max:null}); scope.render(host,'full',{interactive:true});
  assert.equal(host.querySelector('.weather-detail-forecast').hidden,true);
  assert.equal(host.querySelectorAll('.weather-design-hour').length,0); assert.equal(host.querySelectorAll('.weather-design-day').length,0);
  assert.equal(host.querySelector('.weather-detail-sunrise'),undefined);
  assert.equal(host.querySelector('.weather-detail-range').textContent,'Min —° · Max —°');
});

test('expanded weather filters invalid hourly slots and uses each valid slot condition', () => {
  const {host,scope} = detailFixture('en',{hours:[{time:'2026-02-30T07:00',temperature:20},{time:'2026-10-17T07:00',temperature:20,icon:'rain'},{time:'2026-10-17T07:00',temperature:21,icon:'sun'},{time:'2026-10-17T08:00',temperature:null},{time:'2026-10-17T09:00',temperature:22,icon:'cloud'}],sunrise:'2026-10-17T24:00',humidity:101,windSpeed:-1,uvIndex:'4',feelsLike:Infinity});
  scope.render(host,'full',{interactive:true});
  const hours = host.querySelectorAll('.weather-design-hour'); assert.equal(hours.length,2);
  assert.deepEqual(hours.map(hour => hour.children[0].textContent),['07:00','09:00']); assert.deepEqual(hours.map(hour => hour.children[2].textContent),['20°','22°']);
  assert.deepEqual(hours.map(hour => hour.children[1].innerHTML),[weatherGlyphMarkup('rain'),weatherGlyphMarkup('cloud')]);
  assert.equal(host.querySelector('.weather-detail-sunrise'),undefined);assert.equal(host.querySelector('.weather-detail-stats'),undefined);
});

test('an hourly condition update redraws its actual icon even when every timestamp and temperature stays the same',()=>{
  const {host,scope}=detailFixture('en',{icon:'moon',hours:[{time:'2026-10-17T21:00',temperature:18,icon:'moon'}]});scope.render(host,'full',{interactive:true});
  assert.equal(host.querySelector('.weather-design-hour-icon').innerHTML,weatherGlyphMarkup('moon-small'));
  scope.weather.hours[0].icon='rain';scope.render(host,'full',{interactive:true});assert.equal(host.querySelector('.weather-design-hour-icon').innerHTML,weatherGlyphMarkup('rain'));
  assert.equal(host.querySelector('.weather-design-hour').children[0].textContent,'21:00');assert.equal(host.querySelector('.weather-design-hour').children[2].textContent,'18°');
});

test('the balanced error layer retains its real retry command without replacing city or calendar actions',()=>{
  const {host,scope}=detailFixture('fr',{error:'Offline',fetchedAt:1});let retry,commands=0;
  scope.uiMessage=value=>value;scope.weatherCommand=()=>commands++;scope.window.NotchEmpty={show(_host,options){retry=options.onAction;return{elements:{action:{dataset:{}}}};}};
  scope.render(host,'full',{interactive:true});assert.equal(host.querySelector('.weather-design-empty').hidden,false);
  assert.equal(host.querySelector('.weather-design-city').dataset.weatherCommand,'picker');assert.equal(host.querySelector('.weather-typography-date').dataset.weatherCommand,'calendar');
  retry({stopPropagation(){}});assert.equal(commands,1);
});

function inlineFixture(){
  const f=detailFixture('en'),{scope,node,template}=f,fullHost=node('div'),home={dataset:{weatherSplit:'true'},contains:host=>host===f.host};
  const calls={routes:[],renders:0,fullRenders:0,selected:[],calendar:[]},modules={enabled:['music','weather'],slots:['music','weather',null]},music=Object.freeze({title:'Keep playing',sourceId:'real-player',playing:true,position:42,duration:180});
  Object.assign(scope,{view:'nook',state:'open',islandPage:'music',disposed:false,weatherInlineDetail:false,weatherInlinePickerReturn:null,detailReturn:null,detailView:'',weatherLocations:[],
    moduleSettings:modules,music,settingsReturn:null,document:{...scope.document,activeElement:null},weatherCityInput:{focus(options){this.focusedWith=options;}},weatherPlayer:{querySelector:selector=>fullHost.querySelector(selector)},
    byId:id=>id==='nook-layout'?home:template,getModuleEditorActive:()=>false,calendar:null,desktop:null,queueOpen:false,welcome:null,moduleLibrary:null,focusToolReturn:null,settingsRoute:route=>route==='settings',
    activityCards:new Map([['weather',{querySelector:selector=>selector==='.weather-design'?f.host:f.host.querySelector('.weather-design-city')}]]),
    renderActivitySceneValues(){calls.renders++;scope.render(f.host,'scene',{inline:scope.weatherInlineDetail&&scope.view==='nook'&&home.dataset.weatherSplit==='true'});},
    renderWeather(){calls.fullRenders++;scope.render(fullHost,'full',{interactive:true});},
    openActivityDetail(route){scope.detailReturn={view:scope.view,page:scope.islandPage,control:scope.document.activeElement};scope.detailView=route;scope.view=route;calls.routes.push(route);},
    restoreFocusRoute(origin){scope.view=origin.view;scope.islandPage=origin.page;calls.routes.push(scope.view);scope.renderActivitySceneValues();},
    openCalendar(button){calls.calendar.push(button);},setState(value){scope.state=value;},
    async loadWeather(command,location){calls.selected.push({command,location});scope.weather={...scope.weather,city:location.name,displayName:location.name};scope.renderActivitySceneValues();}
  });
  const source=fs.readFileSync(require.resolve('../notch.js'),'utf8'),start=source.indexOf('  function closeWeatherInline()'),end=source.indexOf('  function weatherInput(',start),keyStart=source.indexOf('  function key(event)'),keyEnd=source.indexOf('  function selectView(',keyStart),backStart=source.indexOf('  function returnFromDetail()'),backEnd=source.indexOf('  let calendar =',backStart);
  vm.runInNewContext(source.slice(start,end)+source.slice(keyStart,keyEnd)+source.slice(backStart,backEnd),scope);
  scope.renderWeather();scope.renderActivitySceneValues();
  const click=(command,{targetHost=f.host,result}={})=>{let button=targetHost.querySelectorAll('*').find(child=>child.dataset.weatherCommand===command);if(!button)button={dataset:{weatherCommand:command,weatherResult:result}};scope.document.activeElement=button;
    button.closest=selector=>selector==='.weather-design'?targetHost:button;scope.weatherCommand({type:'click',target:{closest:()=>button},preventDefault(){}});return button;};
  return{...f,fullHost,home,calls,modules,music,click,escape(){scope.key({key:'Escape',preventDefault(){},stopImmediatePropagation(){}});}};
}

test('Nook city opens Balanced inside the same 35% card with five actual hours and no duplicate city id',()=>{
  const f=inlineFixture(),before=JSON.stringify(f.modules);f.click('details');
  assert.equal(f.scope.view,'nook');assert.equal(f.scope.state,'open');assert.equal(f.scope.islandPage,'music');assert.deepEqual(f.calls.routes,[]);assert.equal(JSON.stringify(f.modules),before);assert.equal(f.scope.music,f.music);
  assert.equal(f.host.dataset.weatherView,'detail');assert.equal(f.host.dataset.weatherInline,'true');assert.equal(f.host.querySelectorAll('.weather-design-hour').length,5);
  assert.deepEqual(f.host.querySelectorAll('.weather-design-hour-time').map(hour=>hour.textContent),['06:00','07:00','08:00','09:00','10:00']);
  assert.equal(f.host.querySelector('.weather-design-city').dataset.weatherCommand,'inline-picker');assert.equal(f.host.querySelector('.weather-design-city').id,undefined);
  assert.equal([...f.host.querySelectorAll('*'),...f.fullHost.querySelectorAll('*')].filter(node=>node.id==='weather-city-button').length,1);
  assert.equal(f.host.querySelector('.weather-inline-back').focusedWith.preventScroll,true);
});

test('inline X and Escape return to the same Narrative card without closing or moving the media player',()=>{
  const f=inlineFixture();for(const close of [()=>f.click('inline-close'),()=>f.escape()]){
    f.click('details');close();assert.equal(f.scope.view,'nook');assert.equal(f.scope.state,'open');assert.equal(f.scope.weatherInlineDetail,false);assert.equal(f.host.dataset.weatherView,'summary');
    assert.equal(f.host.querySelector('.weather-typography').children.length,5);assert.equal(f.host.querySelector('.weather-design-city').focusedWith.preventScroll,true);assert.equal(f.scope.music,f.music);assert.deepEqual(f.calls.routes,[]);
  }
});

test('the inline calendar remains its own layer and its first Escape preserves Balanced',()=>{
  const f=inlineFixture();f.click('details');const trigger=f.click('calendar');assert.equal(f.calls.calendar[0],trigger);
  let open=true;f.scope.calendar={isOpen:()=>open,close(){open=false;}};f.escape();assert.equal(open,false);assert.equal(f.scope.weatherInlineDetail,true);assert.equal(f.host.dataset.weatherInline,'true');
  f.escape();assert.equal(f.host.dataset.weatherView,'summary');assert.equal(f.scope.state,'open');
});

test('inline city uses the existing full picker and both its Back and Escape restore the original Balanced card',()=>{
  for(const leave of [f=>f.click('picker',{targetHost:f.fullHost}),f=>f.escape()]){
    const f=inlineFixture();f.click('details');const control=f.click('inline-picker'),origin=f.scope.detailReturn;
    assert.equal(f.scope.view,'weather');assert.equal(f.scope.weatherPickerOpen,true);assert.equal(f.scope.weatherInlinePickerReturn,origin);assert.equal(origin.view,'nook');assert.equal(origin.page,'music');assert.equal(origin.control,control);
    assert.equal(f.scope.weatherCityInput.focusedWith.preventScroll,true);leave(f);
    assert.equal(f.scope.view,'nook');assert.equal(f.scope.weatherPickerOpen,false);assert.equal(f.scope.weatherInlinePickerReturn,null);assert.equal(f.scope.weatherInlineDetail,true);assert.equal(f.host.dataset.weatherInline,'true');assert.equal(f.scope.music,f.music);assert.deepEqual(f.calls.routes,['weather','nook']);
  }
});

test('the actual global Back from the inline picker restores Balanced and clears only its temporary picker state',()=>{
  const f=inlineFixture(),before=JSON.stringify(f.modules);f.click('details');f.click('inline-picker');const origin=f.scope.detailReturn;
  assert.equal(origin.view,'nook');f.scope.returnFromDetail();
  assert.equal(f.scope.view,'nook');assert.equal(f.scope.islandPage,'music');assert.equal(f.scope.weatherPickerOpen,false);assert.equal(f.scope.weatherInlinePickerReturn,null);assert.equal(f.scope.weatherInlineDetail,true);assert.equal(f.host.dataset.weatherInline,'true');
  assert.equal(f.scope.detailReturn,null);assert.equal(f.scope.detailView,'');assert.equal(JSON.stringify(f.modules),before);assert.equal(f.scope.music,f.music);assert.deepEqual(f.calls.routes,['weather','nook']);
});

test('choosing a real picker result returns to Balanced and forwards that selected location without altering placements',()=>{
  const f=inlineFixture(),before=JSON.stringify(f.modules),location={name:'New city',latitude:48,longitude:2};f.scope.weatherLocations=[location];f.click('details');f.click('inline-picker');f.click('choose',{targetHost:f.fullHost,result:'0'});
  assert.deepEqual(f.calls.selected,[{command:'select',location}]);assert.equal(f.scope.view,'nook');assert.equal(f.host.dataset.weatherInline,'true');assert.equal(f.host.querySelector('.weather-design-city').textContent,'New city');assert.equal(JSON.stringify(f.modules),before);assert.equal(f.scope.music,f.music);
});

test('non-paired weather still opens its standalone detail and stale inline origins never hijack another route',()=>{
  const f=inlineFixture();f.home.dataset.weatherSplit='false';f.click('details');assert.equal(f.scope.view,'weather');assert.equal(f.scope.weatherInlineDetail,false);
  f.scope.weatherPickerOpen=true;f.scope.weatherInlinePickerReturn={view:'nook',page:'music'};f.scope.detailReturn={view:'settings',page:'essential'};f.scope.closeWeatherPicker();
  assert.equal(f.scope.view,'weather');assert.equal(f.scope.weatherPickerOpen,false);assert.equal(f.scope.weatherInlinePickerReturn,null);assert.deepEqual(f.calls.routes,['weather']);
});
