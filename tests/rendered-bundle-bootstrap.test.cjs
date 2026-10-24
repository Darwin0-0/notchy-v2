'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src-tauri/src/rendered_bundle_bootstrap.js'), 'utf8');
const id = '1ab97d4e-1f72-4c2f-8686-ede3532458f1', marker = 'about:blank#' + id;
const first = 'blob:null/' + id, second = 'blob:null/01234567-89ab-cdef-0123-456789abcdef';

function fixture({bundle = true, compatibility = true} = {}) {
  const documentListeners = [], windowListeners = [];
  class Frame {
    constructor(initial = marker) { this.value = initial; this.committed = null; this.writes = []; this.loads = []; }
    get src() { return this.value; }
    set src(value) { this.value = String(value); this.committed = this.value; this.writes.push(this.value); }
    getAttribute(name) { return name === 'src' ? this.value : null; }
    addEventListener(type, callback, options) { assert.equal(type, 'load'); assert.equal(options.once, true); this.loads.push(callback); }
    insert() { this.initialNavigation = this.value; }
    finishInitialNavigation() { this.committed = this.initialNavigation; for (const callback of this.loads.splice(0)) callback(); }
  }
  class Parser { parseFromString(parsed) { return parsed; } }
  const originalSource = Object.getOwnPropertyDescriptor(Frame.prototype, 'src'), originalParser = Parser.prototype.parseFromString;
  const document = {
    querySelector(selector) { assert.equal(selector, 'script[type="__bundler/template"]'); return bundle; },
    addEventListener(type, callback, options = {}) { assert.equal(type, 'DOMContentLoaded'); documentListeners.push({callback, capture: options.capture === true}); }
  };
  if (compatibility) vm.runInNewContext(source, {document, HTMLIFrameElement: Frame, DOMParser: Parser, WeakMap,
    addEventListener(type, callback) { assert.equal(type, 'DOMContentLoaded'); windowListeners.push(callback); }
  });
  function parsed(...frames) { return new Parser().parseFromString({querySelectorAll(selector) { assert.equal(selector, 'iframe[src]'); return frames; }}, 'text/html'); }
  function domContentLoaded(author) {
    // DOMContentLoaded targets Document: its capture phase precedes the author's
    // ordinary document listener, then the event bubbles to Window.
    for (const item of documentListeners.filter(item => item.capture)) item.callback();
    author?.();
    for (const item of documentListeners.filter(item => !item.capture)) item.callback();
    for (const callback of windowListeners) callback();
  }
  return {Frame, Parser, parsed, domContentLoaded, originalSource, originalParser};
}

test('a late blank navigation reproduces the committed blank frame despite its blob src', () => {
  const f = fixture({compatibility:false}), frame = new f.Frame();
  f.domContentLoaded(() => {f.parsed(frame); frame.insert(); frame.src = first;});
  frame.finishInitialNavigation();
  assert.equal(frame.src, first); assert.equal(frame.committed, marker);
});

test('capture installs before the author parser and serializes placeholder then latest blob', () => {
  const f = fixture(), frame = new f.Frame();
  f.domContentLoaded(() => {
    assert.notEqual(f.Parser.prototype.parseFromString, f.originalParser);
    f.parsed(frame); frame.insert(); frame.src = first; frame.src = second;
  });
  assert.deepEqual(frame.writes, []); assert.equal(frame.src, marker);
  frame.finishInitialNavigation();
  assert.equal(frame.committed, second); assert.deepEqual(frame.writes, [second]);
  frame.src = first; assert.equal(frame.committed, first); assert.deepEqual(frame.writes, [second, first]);
});

test('ordinary documents keep the native parser and iframe source descriptor', () => {
  const f = fixture({bundle:false}); f.domContentLoaded();
  assert.equal(f.Parser.prototype.parseFromString, f.originalParser);
  assert.deepEqual(Object.getOwnPropertyDescriptor(f.Frame.prototype,'src'), f.originalSource);
});

test('only parsed canonical bundle markers are tracked and native getters are preserved', () => {
  const f = fixture(); f.domContentLoaded();
  const descriptor = Object.getOwnPropertyDescriptor(f.Frame.prototype,'src');
  assert.equal(descriptor.get, f.originalSource.get); assert.equal(descriptor.enumerable, f.originalSource.enumerable); assert.equal(descriptor.configurable, f.originalSource.configurable);
  for (const initial of ['about:blank','about:blank#bad','about:blank#'+id.toUpperCase(),marker+'?x','https://example.invalid/']) {
    const frame = new f.Frame(initial); f.parsed(frame); frame.src = first;
    assert.deepEqual(frame.writes,[first]); assert.equal(frame.loads.length,0);
  }
  const unparsed = new f.Frame(); unparsed.src = first; assert.deepEqual(unparsed.writes,[first]);
  const parsedTwice = new f.Frame(); f.parsed(parsedTwice); f.parsed(parsedTwice); assert.equal(parsedTwice.loads.length,1);
});

test('other assignments override queued bundle navigation without being rewritten', () => {
  const f = fixture(); f.domContentLoaded();
  for (const value of ['https://example.invalid/',first+'?x','about:blank',null]) {
    const frame = new f.Frame(); f.parsed(frame); frame.insert(); frame.src = first; frame.src = value; frame.finishInitialNavigation();
    assert.deepEqual(frame.writes,[String(value)]);
  }
  assert(!source.includes('</script'), 'The trusted inline bootstrap cannot terminate its script element');
});
