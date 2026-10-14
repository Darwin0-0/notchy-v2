const test = require('node:test');
const assert = require('node:assert/strict');
const {artworkColor, normalizeMusic, moduleActivitySnapshot, moduleActivityChange} = require('../notch.js');

test('artwork tint selects the dominant visible color and falls back to white', () => {
  assert.equal(artworkColor(new Uint8ClampedArray([222, 183, 62, 255, 223, 180, 60, 255, 18, 18, 18, 255])), '#dfb53d');
  assert.equal(artworkColor(new Uint8ClampedArray([255, 0, 0, 0, 0, 0, 0, 255])), '#ffffff');
  assert.equal(artworkColor(new Uint8ClampedArray()), '#ffffff');
  assert.equal(artworkColor(new Uint8ClampedArray([240, 240, 240, 255])), '#f0f0f0');
});

test('Spotify controls require a real capability and a known native mode', () => {
  const ready = normalizeMusic({available: true, canShuffle: true, shuffle: true, canRepeat: true, repeat: 'track'});
  assert.equal(ready.canShuffle, true); assert.equal(ready.shuffle, true);
  assert.equal(ready.canRepeat, true); assert.equal(ready.repeat, 'track');
  const unknown = normalizeMusic({available: true, canShuffle: true, canRepeat: true, shuffle: 'yes', repeat: 'whatever'}, ready);
  assert.equal(unknown.canShuffle, false); assert.equal(unknown.shuffle, null);
  assert.equal(unknown.canRepeat, false); assert.equal(unknown.repeat, null);
  assert.equal(normalizeMusic({...ready, available: false}).canShuffle, false);
});

test('file completion emits once for the running job, without startup or cancelled feedback', () => {
  const snap = value => moduleActivitySnapshot('files', value);
  const running = snap({jobId: 'a'.repeat(32), status: 'running', command: 'ocr'});
  const complete = snap({jobId: running.jobId, status: 'complete', command: 'ocr'});
  assert.equal(moduleActivityChange('files', null, complete), null);
  assert.equal(moduleActivityChange('files', running, complete).title, 'Texte extrait');
  assert.equal(moduleActivityChange('files', complete, complete), null);
  assert.equal(moduleActivityChange('files', {...running, jobId: 'b'.repeat(32)}, complete), null);
  assert.equal(moduleActivityChange('files', {...running, status: 'cancelled'}, complete), null);
  assert.equal(moduleActivityChange('files', running, {...complete, status: 'error'}), null);
});
