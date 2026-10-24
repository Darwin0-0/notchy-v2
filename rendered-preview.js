(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) root.NotchyRenderedPreview = api;
})(typeof window === 'object' ? window : null, function () {
  'use strict';
  const route = /^\/rendered-preview\/[a-f0-9]{32}$/;
  const paths = {previous: 'M15 5l-7 7 7 7', next: 'M9 5l7 7-7 7', close: 'M6 6l12 12M18 6L6 18'};

  function create({host, t = value => value, onClose, onNavigate} = {}) {
    if (!host?.ownerDocument) throw new TypeError('A rendered preview host is required.');
    const document = host.ownerDocument, view = document.defaultView;
    if (!view?.addEventListener || !document.addEventListener) throw new TypeError('A preview document window is required.');
    let disposed = false, opened = false, owner = null, name = '', url = null, status = 'closed', generation = 0, frame = null, frameListeners = null;
    const say = (source, values = {}) => String(t(source, values) ?? source).replace(/\{(\w+)\}/g, (match, key) => Object.hasOwn(values, key) ? String(values[key]) : match);
    const make = (tag, className) => {const node = document.createElement(tag); if (className) node.className = className; return node;};
    const overlay = make('section', 'rendered-preview'), toolbar = make('header', 'rendered-preview-toolbar'), title = make('strong', 'rendered-preview-title'), controls = make('div', 'rendered-preview-controls'), body = make('div', 'rendered-preview-body'), information = make('p', 'rendered-preview-status');
    overlay.hidden = true; overlay.setAttribute('role', 'region'); overlay.setAttribute('aria-label', say('Aperçu du document'));
    toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', say('Commandes de l’aperçu'));
    information.setAttribute('role', 'status'); information.setAttribute('aria-live', 'polite'); information.hidden = true;
    function button(action, label) {
      const node = make('button', 'rendered-preview-button'), svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      node.type = 'button'; node.dataset.renderedPreviewAction = action; node.setAttribute('aria-label', say(label)); node.title = say(label);
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); path.setAttribute('d', paths[action]); svg.append(path); node.append(svg); return node;
    }
    const previous = button('previous', 'Document précédent'), next = button('next', 'Document suivant'), close = button('close', 'Fermer l’aperçu');
    previous.disabled = next.disabled = typeof onNavigate !== 'function'; controls.append(previous, next, close); toolbar.append(title, controls); body.append(information); overlay.append(toolbar, body); host.append(overlay);
    function announce(value) {
      status = value; overlay.dataset.status = value; overlay.setAttribute('aria-busy', String(value === 'loading'));
      information.textContent = value === 'loading' ? say('Préparation de l’aperçu…') : value === 'error' ? say('Aperçu indisponible. Ferme puis réessaie.') : '';
      information.hidden = !information.textContent;
    }
    function clearFrame() {
      if (!frame) return;
      frame.removeEventListener('load', frameListeners.load); frame.removeEventListener('error', frameListeners.error);
      frame.setAttribute('src', 'about:blank'); frame.remove(); frame = null; frameListeners = null;
    }
    function hide(expectedOwner) {
      if (!opened || expectedOwner !== undefined && expectedOwner !== owner) return false;
      generation++; opened = false; overlay.hidden = true; clearFrame(); owner = null; name = ''; url = null; title.textContent = ''; title.removeAttribute('title'); announce('closed'); return true;
    }
    function closePreview() {if (!opened || disposed) return; const currentOwner = owner; hide(currentOwner); onClose?.(currentOwner);}
    function navigate(step) {if (opened && !disposed && typeof onNavigate === 'function') onNavigate(step, owner);}
    function click(event) {
      const action = event.target.closest?.('[data-rendered-preview-action]'); if (!action || !controls.contains(action) || action.disabled || !opened || disposed) return;
      event.preventDefault(); event.stopPropagation();
      if (action === close) closePreview(); else navigate(action === previous ? -1 : 1);
    }
    function key(event) {
      if (!opened || disposed || event.defaultPrevented || event.isComposing) return;
      if (event.key === 'Escape') {event.preventDefault(); event.stopImmediatePropagation?.(); event.stopPropagation(); closePreview(); return;}
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || !overlay.contains(event.target) || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || typeof onNavigate !== 'function') return;
      const target = event.target;
      if (target?.isContentEditable || target?.closest?.('input,textarea,select,[contenteditable]')) return;
      event.preventDefault(); event.stopImmediatePropagation?.(); event.stopPropagation(); navigate(event.key === 'ArrowLeft' ? -1 : 1);
    }
    function message(event) {
      if (!opened || disposed || !frame || event.source !== frame.contentWindow || event.origin !== 'null') return;
      const value = event.data; if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      const keys = Reflect.ownKeys(value), fields = Object.getOwnPropertyDescriptors(value);
      // A document can be interactive while its embedded pages are still loading.
      if (keys.length === 1 && keys[0] === 'type' && fields.type.value === 'notchy-preview-ready') {
        if (status === 'loading') announce('ready'); return;
      }
      if (keys.length !== 2 || !keys.includes('type') || !keys.includes('key')) return;
      if (fields.type.value === 'notchy-preview-key' && fields.key.value === 'Escape') closePreview();
    }
    function show(value, nextOwner) {
      if (disposed) return false;
      if (!value || typeof value.name !== 'string' || typeof value.url !== 'string' || !route.test(value.url) || typeof nextOwner !== 'string' || !nextOwner.trim()) throw new TypeError('Invalid rendered preview.');
      const origin = view.location?.origin, resolved = new URL(value.url, origin);
      if (!origin || origin === 'null' || resolved.origin !== origin || resolved.pathname !== value.url || resolved.search || resolved.hash) throw new TypeError('Invalid rendered preview origin.');
      generation++; clearFrame(); const current = generation; owner = nextOwner; name = value.name; url = value.url; opened = true; title.textContent = name; title.title = name; overlay.hidden = false; announce('loading');
      const currentFrame = make('iframe', 'rendered-preview-frame'); currentFrame.dataset.renderedPreviewFrame = ''; currentFrame.setAttribute('title', say('Aperçu de {name}', {name}));
      currentFrame.setAttribute('sandbox', 'allow-scripts'); currentFrame.setAttribute('referrerpolicy', 'no-referrer');
      currentFrame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'; payment 'none'; usb 'none'");
      const active = () => !disposed && opened && current === generation && frame === currentFrame;
      frameListeners = {load: () => {if (active()) announce('ready');}, error: () => {if (active()) announce('error');}};
      currentFrame.addEventListener('load', frameListeners.load); currentFrame.addEventListener('error', frameListeners.error); frame = currentFrame;
      currentFrame.setAttribute('src', url); body.append(currentFrame); close.focus({preventScroll: true}); return true;
    }
    controls.addEventListener('click', click); overlay.addEventListener('keydown', key, true); document.addEventListener('keydown', key, true); view.addEventListener('message', message);
    return Object.freeze({show, hide, isOpen: expectedOwner => opened && (expectedOwner === undefined || expectedOwner === owner), inspect: () => ({open: opened, owner, name, url, status, generation}), dispose() {
      if (disposed) return false; hide(); disposed = true; generation++; clearFrame(); controls.removeEventListener('click', click); overlay.removeEventListener('keydown', key, true); document.removeEventListener('keydown', key, true); view.removeEventListener('message', message); overlay.remove(); return true;
    }});
  }
  return Object.freeze({create});
});
