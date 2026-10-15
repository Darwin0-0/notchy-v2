'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {weatherDesignValues} = require('../notch.js');

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
