const {test}=require('node:test');
const assert=require('node:assert/strict');
const {FocusModel,focusConfiguration,focusCardValues}=require('../notch.js');

test('idle Focus card shows actual configured cycles and a padded pause without fake tasks',()=>{
 const value=focusCardValues(FocusModel.defaults(),focusConfiguration(),10000);
 assert.equal(value.seconds,1500);assert.equal(value.badge,'FOCUS');assert.equal(value.completed,0);assert.equal(value.total,4);assert.equal(value.pause,'05:00');assert.equal(value.task,'');assert.equal(value.active,false);assert.equal(value.progress,0);
});

test('cycle count advances after work and last work previews the actual long break',()=>{
 const settings={work:1,rest:1,longRest:2,total:2};
 const model=FocusModel.restore({minutes:1,remaining:60,deadline:70000,sessionActive:true,pomodoro:{...settings,session:1,phase:'work'}},10000);
 assert.equal(focusCardValues(model,settings,40000).progress,.5);
 FocusModel.tick(model,70000);let card=focusCardValues(model,settings,70000);assert.equal(card.completed,1);assert.equal(card.badge,'PAUSE');assert.equal(card.pause,'01:00');
 FocusModel.tick(model,130000);card=focusCardValues(model,settings,130000);assert.equal(card.completed,1);assert.equal(card.badge,'FOCUS');assert.equal(card.pause,'02:00');assert.equal(card.pauseLabel,'Pause longue');
 FocusModel.tick(model,190000);card=focusCardValues(model,settings,190000);assert.equal(card.completed,2);assert.equal(card.badge,'PAUSE LONGUE');
 FocusModel.tick(model,310000);card=focusCardValues(model,settings,310000);assert.equal(card.completed,2);assert.equal(card.badge,'TERMINÉ');assert.equal(card.active,false);assert.equal(card.seconds,0);
});

test('paused card freezes and exposes only a real stored task',()=>{
 const model=FocusModel.restore({minutes:25,remaining:723,sessionActive:true,task:'Relire le document',pomodoro:{work:25,rest:5,longRest:15,total:4,session:1,phase:'work'}},10000);
 const card=focusCardValues(model,focusConfiguration(),90000000);assert.equal(card.badge,'EN PAUSE');assert.equal(card.seconds,723);assert.equal(card.task,'Relire le document');assert.equal(card.completed,0);
});

test('localized Focus presentation preserves user task titles and the paused cycle',()=>{
 const model=FocusModel.restore({minutes:25,remaining:723,sessionActive:true,task:'Relire le document',pomodoro:{work:25,rest:5,longRest:15,total:4,session:1,phase:'work'}},10000);
 const before=JSON.stringify(model);
 const words={'EN PAUSE':'PAUSED','Reprends quand tu es prêt.':'Resume when you are ready.','Pause courte':'Short break'};
 const card=focusCardValues(model,focusConfiguration(),10000,source=>words[source]||source);
 assert.equal(card.badge,'PAUSED');assert.equal(card.description,'Resume when you are ready.');assert.equal(card.pauseLabel,'Short break');
 assert.equal(card.task,'Relire le document');assert.equal(card.seconds,723);assert.equal(JSON.stringify(model),before);
 assert.equal(focusCardValues(model,focusConfiguration(),10000).badge,'EN PAUSE');
});

test('localized break and completion copy uses the current real phase',()=>{
 const model=FocusModel.restore({minutes:15,remaining:900,deadline:910000,sessionActive:true,pomodoro:{work:25,rest:5,longRest:15,total:4,session:4,phase:'break',breakKind:'long'}},10000);
 const words={'PAUSE LONGUE':'LONG BREAK','Lève-toi et éloigne-toi de l’écran un moment.':'Stand up and step away from your screen for a moment.','Pause longue':'Long break','TERMINÉ':'DONE','Cycle terminé. Prends un moment pour toi.':'Cycle complete. Take a moment for yourself.'};
 const translate=source=>words[source]||source;
 let card=focusCardValues(model,focusConfiguration(),10000,translate);
 assert.equal(card.badge,'LONG BREAK');assert.equal(card.pauseLabel,'Long break');assert.equal(card.description,words['Lève-toi et éloigne-toi de l’écran un moment.']);
 FocusModel.tick(model,910000);card=focusCardValues(model,focusConfiguration(),910000,translate);
 assert.equal(card.badge,'DONE');assert.equal(card.description,'Cycle complete. Take a moment for yourself.');assert.equal(card.seconds,0);assert.equal(card.completed,4);
});
