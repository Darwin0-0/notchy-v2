(() => {
  'use strict';
  const config = __NOTCHY_CONFIG__;
  const invoke = (command, args) => window.__TAURI__.core.invoke(command, args);
  const request = (command, value) => invoke('desktop_command', {value: {command, value}})
    .catch(error => ({ok: false, error: String(error)}));
  let geometryPending = null, geometryFlight = null;
  const sendGeometry = value => {
    geometryPending = value;
    if (!geometryFlight) geometryFlight = (async () => {
      let result;
      while (geometryPending) {
        const next = geometryPending; geometryPending = null;
        result = await request('geometry', next);
      }
      return result;
    })().finally(() => {
      geometryFlight = null;
      if (geometryPending) return sendGeometry(geometryPending);
    });
    return geometryFlight;
  };
  const ownApi = address => address.origin === location.origin && address.pathname.startsWith('/api/');
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, options) => {
    const address = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    if (!ownApi(address)) return nativeFetch(input, options);
    const headers = new Headers(options?.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('X-Notchy', config.token);
    return nativeFetch(input, {...options, headers});
  };
  const NativeEventSource = window.EventSource;
  window.EventSource = class extends NativeEventSource {
    constructor(address, options) {
      const url = new URL(address, location.href);
      if (ownApi(url)) url.searchParams.set('token', config.token);
      super(url.href, options);
    }
  };
  const preferenceKeys = new Set(config.keys);
  for (const [key, value] of Object.entries(config.preferences || {})) {
    if (preferenceKeys.has(key) && typeof value === 'string' && localStorage.getItem(key) === null) localStorage.setItem(key, value);
  }
  const nativeSet = Storage.prototype.setItem, nativeRemove = Storage.prototype.removeItem;
  Storage.prototype.setItem = function(key, value) {
    nativeSet.call(this, key, value);
    if (this === localStorage && preferenceKeys.has(key)) void request('preference', {key, value: String(value)});
  };
  Storage.prototype.removeItem = function(key) {
    nativeRemove.call(this, key);
    if (this === localStorage && preferenceKeys.has(key)) void request('preference', {key, value: null});
  };
  const listen = (name, callback) => {
    if (typeof callback !== 'function') throw new TypeError('Callback requis.');
    let disposed = false, remove;
    window.__TAURI__.event.listen(name, event => {if (!disposed) callback(event.payload);})
      .then(unlisten => {if (disposed) unlisten(); else remove = unlisten;}).catch(() => {});
    return () => {disposed = true; remove?.();};
  };
  let startup = Object.freeze({supported: config.startup?.supported === true, enabled: config.startup?.enabled === true,
    ...(typeof config.startup?.error === 'string' ? {error: config.startup.error} : {})});
  const setStartup = async enabled => {
    if (typeof enabled !== 'boolean') return {ok: false, ...startup, error: 'Invalid startup preference.'};
    const reply = await request('startup', enabled);
    if (typeof reply.supported === 'boolean' && typeof reply.enabled === 'boolean') {
      startup = Object.freeze({supported: reply.supported, enabled: reply.enabled,
        ...(typeof reply.error === 'string' ? {error: reply.error} : {})});
    }
    return {...reply, supported: startup.supported, enabled: startup.enabled};
  };
  Object.defineProperty(window, 'notchyDesktop', {value: Object.freeze({
    isDesktop: true,
    localSendActive: config.localSendActive === true,
    get startup() { return startup; },
    setStartup,
    sendGeometry,
    setInteractive: value => typeof value === 'boolean' && void request('interactive', value),
    focus: () => void request('focus'), hide: () => void request('hide'), quit: () => void request('quit'),
    reload: () => request('reload'), musicQueue: value => request('music-queue', value),
    setDialogOpen: value => typeof value === 'boolean' && void request('dialog', value),
    copyText: value => request('copy-text', value),
    openShelfItem: value => request('shelf-open', value), revealShelfItem: value => request('shelf-reveal', value),
    onResume: callback => listen('notchy:resume', callback),
    onDeactivate: callback => listen('notchy:deactivate', callback),
    onPointer: callback => listen('notchy:pointer', callback),
  }), configurable: false, writable: false});
  if (config.checking) {
    const settle = async (state, maximum) => {
      const started=performance.now();
      while (performance.now()-started<maximum) {
        const current=window.notchy?.inspect();
        if (current?.state===state&&!current.morphing) return performance.now()-started;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      return performance.now()-started;
    };
    window.__notchyCheckErrors = [];
    window.addEventListener('error', event => window.__notchyCheckErrors.push(String(event.error?.stack || event.message).slice(0, 1000)));
    window.addEventListener('unhandledrejection', event => window.__notchyCheckErrors.push(String(event.reason?.stack || event.reason).slice(0, 1000)));
    window.addEventListener('DOMContentLoaded', () => setTimeout(async () => {
      try {
        if (window.notchy?.getWelcome()?.active) document.querySelector('#welcome-player [data-welcome-command=start]')?.click();
        window.notchy?.setState('open');
        document.querySelector('#notch-menu [data-view=nook]')?.focus();
        document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Tab'}));
        const openingMs=await settle('open',10000);
        const open = window.notchy?.inspect();
        await request('diagnostic', {phase:'open', ready:!!open, state:open?.state, morphing:open?.morphing, openingMs, geometry:open?.geometry,
          desktop:window.notchyDesktop.isDesktop, node:typeof require, scripts:[...document.scripts].map(script=>new URL(script.src||location.href).pathname),
          body:getComputedStyle(document.body).backgroundColor, surfaceFill:getComputedStyle(document.querySelector('#notch-surface > use')).fill, captureAvailable:typeof window.notchyDesktop.captureBackdrop==='function', errors:window.__notchyCheckErrors});
        document.activeElement?.blur();
        window.notchy?.setState('discreet');
        const closingMs=await settle('discreet',6000);
        const discreet = window.notchy?.inspect();
        await request('diagnostic', {phase:'discreet', ready:!!discreet, state:discreet?.state, morphing:discreet?.morphing, closingMs, geometry:discreet?.geometry, errors:window.__notchyCheckErrors});
      } catch (error) {await request('diagnostic', {phase:'error', error:String(error).slice(0,1000)});}
    }, 600));
  }
})();
