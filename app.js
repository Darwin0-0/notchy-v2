(function (root, factory) {
  'use strict';
  const create = factory();
  if (typeof module === 'object' && module.exports) module.exports = {create};
  else {
    const app = create(root);
    root.NotchyApp = app;
    app.boot();
  }
})(typeof window === 'object' ? window : null, function () {
  'use strict';
  return function create(window) {
    let instance = null, waiting = false, starting = false, failure = null;
    function start() {
      if (instance) return instance;
      if (failure) throw failure;
      if (starting) throw new Error('Notchy is already starting');
      if (!window?.document || typeof window.NotchyShell?.create !== 'function') throw new Error('Notchy shell is unavailable');
      starting = true;
      try { instance = window.NotchyShell.create(); return instance; }
      // A partial mount may own listeners; retrying it requires a fresh document.
      catch (error) { failure = error; throw error; }
      finally { starting = false; }
    }
    function boot() {
      if (instance || waiting) return instance;
      if (!window?.document) throw new Error('Notchy requires a browser document');
      if (window.document.readyState === 'loading') {
        waiting = true;
        window.document.addEventListener('DOMContentLoaded', () => {waiting = false; start();}, {once: true});
        return null;
      }
      return start();
    }
    return Object.freeze({start, boot});
  };
});
