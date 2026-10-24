(() => {
  'use strict';
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const marker = new RegExp('^about:blank#' + uuid + '$');
  const blobPage = new RegExp('^blob:null/' + uuid + '$');
  document.addEventListener('DOMContentLoaded', () => {
    if (!document.querySelector('script[type="__bundler/template"]')) return;
    const framePrototype = HTMLIFrameElement.prototype;
    const source = Object.getOwnPropertyDescriptor(framePrototype, 'src');
    const parserPrototype = DOMParser.prototype;
    const parser = Object.getOwnPropertyDescriptor(parserPrototype, 'parseFromString');
    if (!source?.configurable || !source.set || !source.get || !parser?.value || !parser.configurable) return;
    const states = new WeakMap();
    Object.defineProperty(framePrototype, 'src', {
      ...source,
      set(value) {
        const state = states.get(this);
        if (state && !state.loaded) {
          if (typeof value === 'string' && blobPage.test(value)) {
            state.pending = value;
            return;
          }
          state.pending = null;
        }
        source.set.call(this, value);
      }
    });
    Object.defineProperty(parserPrototype, 'parseFromString', {
      ...parser,
      value: function parseFromString(...args) {
        const parsed = parser.value.apply(this, args);
        for (const frame of parsed.querySelectorAll('iframe[src]')) {
          if (!marker.test(frame.getAttribute('src') || '') || states.has(frame)) continue;
          const state = { loaded: false, pending: null };
          states.set(frame, state);
          // The initial blank navigation must finish before its replacement starts.
          frame.addEventListener('load', () => {
            state.loaded = true;
            const pending = state.pending;
            state.pending = null;
            if (pending !== null) source.set.call(frame, pending);
          }, { once: true });
        }
        return parsed;
      }
    });
  }, { once: true, capture: true });
})();
