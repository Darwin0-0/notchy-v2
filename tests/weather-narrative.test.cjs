const {test}=require('node:test');
const assert=require('node:assert/strict');
const {weatherNarrative}=require('../notch.js');

const ready={status:'ready',mode:'city',city:'New York',temperature:24,feelsLike:18,nextRain:{available:true,periodMinutes:120,rainMm:.6,precipitationMm:.6}};

test('weather uses the original temperature, city, apparent temperature and two-hour narrative',()=>{
 const card=weatherNarrative(ready);
 assert.deepEqual([card.temperature,card.when,card.city,card.feelsLike,card.rain,card.rainQualifier,card.horizon],['24°','maintenant','New York','18°','pluie','prévue','prochaines 2 h']);
 assert.equal(card.rainIcon,true);assert.equal(card.state,'ready');assert.equal(card.status,'');
 assert.equal(weatherNarrative({...ready,temperature:0,feelsLike:0}).temperature,'0°');
 assert.equal(weatherNarrative({...ready,feelsLike:null}).feelsLike,'—');
});

test('dry, unknown and non-rain precipitation forecasts stay distinct',()=>{
 assert.equal(weatherNarrative({...ready,nextRain:{available:true,periodMinutes:120,rainMm:0,precipitationMm:0}}).rain,'sans pluie');
 const unknown=weatherNarrative({...ready,nextRain:null,rainRisk:90});assert.equal(unknown.rainQualifier,'indisponible');assert.equal(unknown.rainIcon,false);
 const precipitation=weatherNarrative({...ready,nextRain:{available:true,periodMinutes:120,rainMm:null,precipitationMm:.5}});assert.equal(precipitation.rain,'précipitations');assert.equal(precipitation.rainQualifier,'prévues');
 for(const forecast of[{available:true,periodMinutes:60,rainMm:2},{available:true,periodMinutes:120,rainMm:-1},{available:false,periodMinutes:120,rainMm:2}])assert.equal(weatherNarrative({...ready,nextRain:forecast}).rainIcon,false);
});

test('old forecast values are never labelled current and denied location never invents a city',()=>{
 const stale=weatherNarrative({...ready,stale:true});assert.equal(stale.when,'dernier relevé');assert.equal(stale.horizon,'prévision précédente · 2 h');assert.match(stale.forecastDescription,/précédente/);assert.match(stale.status,/Dernières données/);
 const missing=weatherNarrative({mode:'local',status:'error',error:'Localisation Windows refusée.'});assert.equal(missing.city,'Position actuelle');assert.equal(missing.temperature,'—');assert.equal(missing.status,'Localisation Windows refusée.');assert.equal(missing.state,'unavailable');
 const loading=weatherNarrative({mode:'city',status:'loading'});assert.equal(loading.city,'Choisis une ville');assert.equal(loading.loading,true);assert.match(loading.status,/Chargement/);
});
