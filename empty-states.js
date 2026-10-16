(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) root.NotchEmpty = api;
})(typeof window === 'object' ? window : null, function () {
  'use strict';
  const instances = new WeakMap();
  const SVG = 'http://www.w3.org/2000/svg';
  const fields = ['icon', 'title', 'hint', 'actionLabel', 'onAction', 'since'];
  const text = value => typeof value === 'string' ? value : '';

  function options(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Empty-state options must be an object.');
    return value;
  }
  function timestamp(value) {
    if (!(value instanceof Date) && typeof value !== 'number') return null;
    const date = new Date(value instanceof Date ? value.getTime() : value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  function svgNode(value, host) {
    // Callers supply their own trusted, constant SVG DOM; strings are never parsed as markup.
    return value?.nodeType === 1 && value.namespaceURI === SVG && value.localName === 'svg'
      && value !== host && !value.contains(host) ? value : null;
  }

  function show(host, initial = {}) {
    options(initial);
    if (host?.nodeType !== 1 || !host.ownerDocument?.createElement || !host.replaceChildren || !host.classList || host.closest?.('button')) {
      throw new TypeError('An empty state needs an element outside a button.');
    }
    const existing = instances.get(host);
    if (existing) {existing.update(initial); return existing;}
    const document = host.ownerDocument, original = Array.from(host.childNodes), hadClass = host.classList.contains('notch-empty');
    const elements = {};
    for (const [name, tag] of Object.entries({icon: 'span', title: 'strong', hint: 'span', action: 'button', time: 'time'})) {
      const element = document.createElement(tag); element.className = 'notch-empty-' + name; elements[name] = element;
    }
    elements.icon.setAttribute('aria-hidden', 'true'); elements.action.type = 'button';
    let state = {}, disposed = false;
    const originalIcons = new Map();
    function action(event) {if (!disposed && !elements.action.disabled && !elements.action.hidden) return state.onAction?.(event);}
    elements.action.addEventListener('click', action);
    host.classList.add('notch-empty'); host.replaceChildren(...Object.values(elements));

    function update(patch = {}) {
      if (disposed) return false;
      options(patch);
      const next = {...state};
      for (const field of fields) {
        if (!Object.prototype.hasOwnProperty.call(patch, field) && Object.prototype.hasOwnProperty.call(state, field)) continue;
        const value = patch[field];
        next[field] = field === 'icon' ? svgNode(value, host) : field === 'since' ? timestamp(value)
          : field === 'onAction' ? typeof value === 'function' ? value : null : text(value);
      }
      if (next.icon !== state.icon) {
        if (next.icon && !originalIcons.has(next.icon) && original.some(node => node !== next.icon && node.contains?.(next.icon))) {
          originalIcons.set(next.icon, {parent: next.icon.parentNode, next: next.icon.nextSibling});
        }
        elements.icon.replaceChildren(...(next.icon ? [next.icon] : [])); elements.icon.hidden = !next.icon;
      }
      for (const name of ['title', 'hint']) if (next[name] !== state[name]) {
        elements[name].textContent = next[name]; elements[name].hidden = !next[name];
      }
      if (next.actionLabel !== state.actionLabel) elements.action.textContent = next.actionLabel;
      const hasAction = !!next.actionLabel.trim() && !!next.onAction, hadAction = !!state.actionLabel?.trim() && !!state.onAction;
      if (hasAction !== hadAction || !Object.prototype.hasOwnProperty.call(state, 'actionLabel')) {
        elements.action.hidden = !hasAction; elements.action.disabled = !hasAction;
      }
      if (next.since !== state.since) {
        elements.time.hidden = !next.since;
        if (next.since) {
          elements.time.setAttribute('datetime', next.since);
          elements.time.textContent = new Date(next.since).toLocaleString();
        } else {elements.time.removeAttribute('datetime'); elements.time.textContent = '';}
      }
      state = next; return true;
    }
    function dispose() {
      if (disposed) return false;
      disposed = true; elements.action.removeEventListener('click', action); instances.delete(host);
      for (const [icon, {parent, next}] of originalIcons) parent.insertBefore(icon, next?.parentNode === parent ? next : null);
      const owned = Object.values(elements);
      if (host.childNodes.length === owned.length && owned.every(node => node.parentNode === host)) host.replaceChildren(...original);
      else for (const node of owned) node.remove();
      if (!hadClass) host.classList.remove('notch-empty');
      return true;
    }
    const controller = {elements, update, dispose}; instances.set(host, controller); update(initial); return controller;
  }
  return {show};
});
