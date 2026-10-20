(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./module-contracts.js') : root && root.NotchyLayout);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NotchyModules = api;
})(typeof window === 'undefined' ? null : window, function (layoutHost) {
  'use strict';

  const limits = Object.freeze({ manifestBytes: 65536, registryBytes: 196608, modules: 12, fields: 8, actions: 8, text: 512 });
  const presentations = ['full', 'scene', 'rail'];
  const safeId = /^[a-z][a-z0-9-]{0,47}$/;
  const moduleId = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){1,3}$/;
  const versionPattern = /^(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})$/;
  const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
  const renderedHosts = new WeakMap();
  const renderedDrafts = new WeakMap();

  function fail(message) { throw new Error('Module: ' + message); }
  function bytes(text) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
    return unescape(encodeURIComponent(text)).length;
  }
  function jsonSize(value, maximum) {
    let encoded;
    try { encoded = JSON.stringify(value); } catch (_) { fail('expected serializable JSON'); }
    if (typeof encoded !== 'string' || bytes(encoded) > maximum) fail('JSON exceeds its size limit');
    return encoded;
  }
  function object(value, allowed, required, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path + ' must be an object');
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(path + ' must be plain JSON');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string' || forbidden.has(key) || !allowed.includes(key)) fail(path + ': unknown property ' + String(key));
      if (!Object.prototype.hasOwnProperty.call(descriptors[key], 'value')) fail(path + ': accessors are not JSON');
    }
    for (const key of required) if (!Object.prototype.hasOwnProperty.call(descriptors, key)) fail(path + ': missing ' + key);
    return value;
  }
  function text(value, maximum, path) {
    if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) fail(path + ' must be nonempty text');
    return value.trim();
  }
  function identifier(value, path) {
    if (typeof value !== 'string' || !safeId.test(value) || forbidden.has(value)) fail(path + ' is not a valid identifier');
    return value;
  }
  function localized(value, maximum, path) {
    object(value, ['en', 'fr'], ['en', 'fr'], path);
    return { en: text(value.en, maximum, path + '.en'), fr: text(value.fr, maximum, path + '.fr') };
  }
  function list(value, maximum, path, minimum) {
    if (!Array.isArray(value) || value.length > maximum || value.length < (minimum || 0)) fail(path + ' has an invalid item count');
    return value;
  }
  function finite(value, minimum, maximum, path) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) fail(path + ' is out of range');
    return value;
  }
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  }
  function unique(values, path) {
    if (new Set(values).size !== values.length) fail(path + ' contains duplicates');
    return values;
  }
  function validateManifest(value) {
    object(value, ['$schema', 'manifestVersion', 'id', 'version', 'name', 'description', 'permissions', 'fields', 'actions', 'presentations', 'progress', 'appearance', 'layout'],
      ['manifestVersion', 'id', 'version', 'name', 'description', 'permissions', 'fields', 'actions', 'presentations', 'appearance'], 'manifest');
    if (value.manifestVersion !== 2) fail('unsupported manifestVersion; use 2');
    if (value.$schema !== undefined) text(value.$schema, 512, '$schema');
    if (typeof value.id !== 'string' || value.id.length > 96 || !moduleId.test(value.id)) fail('id must be namespaced, for example community.reading');
    if (typeof value.version !== 'string' || !versionPattern.test(value.version)) fail('version must contain three numeric components');
    if (!Array.isArray(value.permissions) || value.permissions.length) fail('this runtime accepts no privileged permissions');
    const fields = list(value.fields, limits.fields, 'fields', 1).map((field, index) => {
      const path = 'fields[' + index + ']';
      object(field, ['id', 'type', 'label', 'default', 'min', 'max', 'maxLength'], ['id', 'type', 'label', 'default'], path);
      const output = { id: identifier(field.id, path + '.id'), type: field.type, label: localized(field.label, 80, path + '.label') };
      if (field.type === 'number') {
        if (field.maxLength !== undefined || field.min === undefined || field.max === undefined) fail(path + ': numbers require min and max only');
        output.min = finite(field.min, -1000000, 1000000, path + '.min');
        output.max = finite(field.max, output.min, 1000000, path + '.max');
        if (output.min === output.max) fail(path + ': min must be smaller than max');
        output.default = finite(field.default, output.min, output.max, path + '.default');
      } else if (field.type === 'text') {
        if (field.min !== undefined || field.max !== undefined) fail(path + ': text does not accept numeric bounds');
        output.maxLength = field.maxLength === undefined ? limits.text : finite(field.maxLength, 1, limits.text, path + '.maxLength');
        if (!Number.isInteger(output.maxLength)) fail(path + ': maxLength must be an integer');
        if (typeof field.default !== 'string' || field.default.length > output.maxLength || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(field.default)) fail(path + ': invalid default text');
        output.default = field.default;
      } else if (field.type === 'boolean') {
        if (field.min !== undefined || field.max !== undefined || field.maxLength !== undefined || typeof field.default !== 'boolean') fail(path + ': invalid boolean field');
        output.default = field.default;
      } else fail(path + ': supported types are text, number and boolean');
      return output;
    });
    unique(fields.map(field => field.id), 'fields');
    const fieldMap = new Map(fields.map(field => [field.id, field]));
    const actions = list(value.actions, limits.actions, 'actions').map((action, index) => {
      const path = 'actions[' + index + ']';
      object(action, ['id', 'label', 'type', 'field', 'amount'], ['id', 'label', 'type', 'field'], path);
      const output = { id: identifier(action.id, path + '.id'), label: localized(action.label, 80, path + '.label'), type: action.type, field: identifier(action.field, path + '.field') };
      const field = fieldMap.get(output.field);
      if (!field) fail(path + ': unknown target field');
      if (action.type === 'increment') {
        if (field.type !== 'number') fail(path + ': increment requires a number field');
        output.amount = finite(action.amount, -1000000, 1000000, path + '.amount');
        if (!output.amount) fail(path + ': amount cannot be zero');
      } else {
        if (action.amount !== undefined) fail(path + ': amount is only available for increment');
        if (action.type === 'toggle' && field.type !== 'boolean') fail(path + ': toggle requires a boolean field');
        if (action.type === 'set-text' && field.type !== 'text') fail(path + ': set-text requires a text field');
        if (!['reset', 'toggle', 'set-text'].includes(action.type)) fail(path + ': unsupported host action');
      }
      return output;
    });
    unique(actions.map(action => action.id), 'actions');
    const actionMap = new Map(actions.map(action => [action.id, action]));
    object(value.presentations, presentations, presentations, 'presentations');
    const views = {};
    for (const name of presentations) {
      const view = object(value.presentations[name], ['fields', 'actions'], ['fields', 'actions'], 'presentations.' + name);
      const fieldIds = unique(list(view.fields, limits.fields, name + '.fields', 1).map(id => identifier(id, name + '.fields')), name + '.fields');
      const actionIds = unique(list(view.actions, limits.actions, name + '.actions').map(id => identifier(id, name + '.actions')), name + '.actions');
      if (fieldIds.some(id => !fieldMap.has(id)) || actionIds.some(id => !actionMap.has(id))) fail(name + ': unknown field or action reference');
      views[name] = { fields: fieldIds.slice(), actions: actionIds.slice() };
    }
    object(value.appearance, ['accent'], ['accent'], 'appearance');
    if (typeof value.appearance.accent !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value.appearance.accent)) fail('appearance.accent must be a six-digit hex color');
    const output = { manifestVersion: 2, id: value.id, version: value.version, name: localized(value.name, 80, 'name'),
      description: localized(value.description, 280, 'description'), permissions: [], fields, actions, presentations: views,
      appearance: { accent: value.appearance.accent.toUpperCase() } };
    if (value.layout !== undefined) {
      if (!layoutHost) fail('the layout host is required for layout declarations');
      try { output.layout = layoutHost.normalizeLayout(value.layout); }
      catch (error) { fail('layout: ' + error.message); }
    }
    if (value.progress !== undefined) {
      object(value.progress, ['valueField', 'targetField', 'label'], ['valueField', 'targetField', 'label'], 'progress');
      const progress = { valueField: identifier(value.progress.valueField, 'progress.valueField'), targetField: identifier(value.progress.targetField, 'progress.targetField'), label: localized(value.progress.label, 80, 'progress.label') };
      const current = fieldMap.get(progress.valueField), target = fieldMap.get(progress.targetField);
      if (!current || !target || current.type !== 'number' || target.type !== 'number' || current.min < 0 || target.min <= 0 || current.id === target.id) fail('progress needs distinct nonnegative value and positive target number fields');
      output.progress = progress;
    }
    // Bound the original metadata too; schema hints never grant extra import space.
    jsonSize(value, limits.manifestBytes);
    return freeze(output);
  }
  function parseManifest(source) {
    if (typeof source !== 'string' || bytes(source) > limits.manifestBytes) fail('manifest exceeds the import size limit');
    let value;
    try { value = JSON.parse(source); } catch (_) { fail('invalid JSON'); }
    return validateManifest(value);
  }
  function normalizeState(manifest, state) {
    const output = {};
    const input = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
    for (const field of manifest.fields) {
      const descriptor = Object.getOwnPropertyDescriptor(input, field.id);
      const value = descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : undefined;
      if (field.type === 'number') output[field.id] = typeof value === 'number' && Number.isFinite(value) ? Math.max(field.min, Math.min(field.max, value)) : field.default;
      else if (field.type === 'boolean') output[field.id] = typeof value === 'boolean' ? value : field.default;
      else output[field.id] = typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, field.maxLength) : field.default;
    }
    return freeze(output);
  }
  function validateRegistry(value) {
    const empty = () => freeze({ registryVersion: 1, modules: [] });
    try {
      object(value, ['registryVersion', 'modules'], ['registryVersion', 'modules'], 'registry');
      if (value.registryVersion !== 1 || !Array.isArray(value.modules) || value.modules.length > limits.modules) return empty();
      jsonSize(value, limits.registryBytes);
      const modules = [], ids = new Set();
      for (const entry of value.modules) {
        try {
          object(entry, ['manifest', 'state'], ['manifest', 'state'], 'registry.modules');
          const manifest = validateManifest(entry.manifest);
          if (ids.has(manifest.id)) continue;
          modules.push({ manifest, state: normalizeState(manifest, entry.state) });
          ids.add(manifest.id);
        } catch (_) { /* Corrupt entries do not disable unrelated installed modules. */ }
      }
      return freeze({ registryVersion: 1, modules });
    } catch (_) { return empty(); }
  }
  function compareVersions(left, right) {
    const a = left.split('.').map(Number), b = right.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  }
  function createStore(options) {
    const config = options || {}, storage = config.storage, key = config.key || 'notchy.modules.v2';
    const asynchronous = typeof config.persist === 'function';
    let mutations = Promise.resolve();
    let registry = validateRegistry(null);
    if (storage && typeof storage.getItem === 'function') {
      try {
        const saved = storage.getItem(key);
        if (saved && bytes(saved) <= limits.registryBytes) registry = validateRegistry(JSON.parse(saved));
      } catch (_) { /* A broken or unavailable storage backend starts with an empty library. */ }
    }
    const subscribers = new Set();
    if (typeof config.onChange === 'function') subscribers.add(config.onChange);
    function commit(modules, result) {
      const next = freeze({ registryVersion: 1, modules: modules.slice() });
      const encoded = jsonSize(next, limits.registryBytes);
      function accept() {
        if (storage && typeof storage.setItem === 'function') storage.setItem(key, encoded);
        registry = next;
        for (const subscriber of subscribers) { try { subscriber(registry); } catch (_) { /* One host observer must not break the store. */ } }
        return result;
      }
      if (asynchronous) return Promise.resolve().then(() => config.persist(encoded)).then(accept);
      return accept();
    }
    function mutate(work) {
      if (!asynchronous) return work();
      const next = mutations.then(work);
      mutations = next.then(() => undefined, () => undefined);
      return next;
    }
    function get(id) { return registry.modules.find(entry => entry.manifest.id === id) || null; }
    function installNow(manifest) {
      const existing = get(manifest.id);
      if (!existing && registry.modules.length >= limits.modules) fail('installed module limit reached');
      if (existing && compareVersions(manifest.version, existing.manifest.version) < 0) fail('a newer module version is already installed');
      const previous = {};
      if (existing) for (const field of manifest.fields) {
        const old = existing.manifest.fields.find(item => item.id === field.id);
        if (old && old.type === field.type) previous[field.id] = existing.state[field.id];
      }
      const entry = freeze({ manifest, state: normalizeState(manifest, previous) });
      return commit(existing ? registry.modules.map(item => item === existing ? entry : item) : registry.modules.concat(entry), entry);
    }
    function updateStateNow(id, patch) {
      const existing = get(id);
      if (!existing) fail('module is not installed');
      const keys = existing.manifest.fields.map(field => field.id);
      object(patch, keys, [], 'state');
      for (const [fieldId, value] of Object.entries(patch)) {
        const field = existing.manifest.fields.find(item => item.id === fieldId);
        const expectedType = field.type === 'text' ? 'string' : field.type;
        if (typeof value !== expectedType || (field.type === 'number' && !Number.isFinite(value))) fail('state value has the wrong type');
      }
      const entry = freeze({ manifest: existing.manifest, state: normalizeState(existing.manifest, Object.assign({}, existing.state, patch)) });
      return commit(registry.modules.map(item => item === existing ? entry : item), entry);
    }
    function performActionNow(id, actionId, value) {
      const entry = get(id);
      if (!entry) fail('module is not installed');
      const action = entry.manifest.actions.find(item => item.id === actionId);
      if (!action) fail('unknown action');
      const field = entry.manifest.fields.find(item => item.id === action.field);
      let next;
      if (action.type === 'increment') next = entry.state[action.field] + action.amount;
      else if (action.type === 'toggle') next = !entry.state[action.field];
      else if (action.type === 'reset') next = field.default;
      else {
        if (typeof value !== 'string') fail('set-text requires text');
        next = value;
      }
      return updateStateNow(id, { [action.field]: next });
    }
    function removeNow(id) {
      const filtered = registry.modules.filter(entry => entry.manifest.id !== id);
      if (filtered.length === registry.modules.length) return false;
      return commit(filtered, true);
    }
    function install(input) {
      let manifest;
      try { manifest = typeof input === 'string' ? parseManifest(input) : validateManifest(input); }
      catch (error) { if (asynchronous) return Promise.reject(error); throw error; }
      return mutate(() => installNow(manifest));
    }
    function updateState(id, input) {
      let patch;
      try { object(input, Object.keys(input || {}), [], 'state'); patch = Object.assign({}, input); }
      catch (error) { if (asynchronous) return Promise.reject(error); throw error; }
      return mutate(() => updateStateNow(id, patch));
    }
    return Object.freeze({ list: () => registry.modules, get, install,
      remove: id => mutate(() => removeNow(id)), updateState,
      performAction: (id, actionId, value) => mutate(() => performActionNow(id, actionId, value)),
      snapshot: () => registry,
      subscribe(listener) {
        if (typeof listener !== 'function') fail('subscriber must be a function');
        subscribers.add(listener);
        return () => subscribers.delete(listener);
      } });
  }
  function render(host, input, inputState, options) {
    if (!host || !host.ownerDocument || typeof host.replaceChildren !== 'function') fail('render needs a host element');
    const manifest = validateManifest(input), state = normalizeState(manifest, inputState), config = options || {};
    const requested = config.presentation || 'full';
    const canonical = (layoutHost?.PRESENTATIONS || ['full', 'main', 'side', 'tall', 'wide', 'small']).includes(requested);
    if (canonical && layoutHost && !layoutHost.supports(layoutHost.getCommunityContract(manifest), requested)) fail('unsupported presentation: ' + requested);
    if (canonical && requested !== 'full' && !layoutHost) fail('the layout host is required for this presentation');
    const presentation = canonical && layoutHost ? layoutHost.legacyPresentation(requested) : presentations.includes(requested) ? requested : 'full';
    const language = config.language === 'fr' ? 'fr' : 'en', view = manifest.presentations[presentation];
    const doc = host.ownerDocument, listeners = [], captureDrafts = [], focusTargets = new Map();
    const active = doc.activeElement;
    const previousFocus = active && host.contains(active) ? { action: active.dataset.moduleAction, field: active.dataset.moduleField, start: active.selectionStart, end: active.selectionEnd } : null;
    const previousDisposer = renderedHosts.get(host);
    if (previousDisposer) previousDisposer();
    let drafts = renderedDrafts.get(host);
    if (!drafts || drafts.id !== manifest.id || config.resetDrafts === true) {
      drafts = {id: manifest.id, fields: new Map()}; renderedDrafts.set(host, drafts);
    }
    // A presentation/locale change is not a save. Only acknowledged changes
    // to this field (or an explicit host reset) supersede its local draft.
    for (const [id, draft] of drafts.fields) {
      const field = manifest.fields.find(field => field.id === id);
      if (!field || field.type !== 'text' || state[id] === draft.value) drafts.fields.delete(id);
      else draft.value = draft.value.slice(0, field.maxLength);
    }
    const make = (tag, className, content) => {
      const element = doc.createElement(tag);
      element.className = className;
      if (content !== undefined) element.textContent = content;
      return element;
    };
    const on = (element, type, handler) => { element.addEventListener(type, handler); listeners.push(() => element.removeEventListener(type, handler)); };
    const card = make('section', 'module-runtime module-runtime--' + presentation);
    card.dataset.moduleId = manifest.id;
    card.dataset.modulePresentation = canonical ? requested : presentation === 'full' ? 'full' : presentation === 'scene' ? 'main' : 'small';
    if (layoutHost) layoutHost.applyTokens(card);
    card.setAttribute('aria-label', manifest.name[language]);
    card.style.setProperty('--module-accent', manifest.appearance.accent);
    card.append(make('h3', 'module-runtime-title', manifest.name[language]));
    if (presentation === 'full') card.append(make('p', 'module-runtime-description', manifest.description[language]));
    const content = make('dl', 'module-runtime-fields');
    for (const id of view.fields) {
      const field = manifest.fields.find(item => item.id === id);
      const row = make('div', 'module-runtime-field module-runtime-field--' + field.type);
      row.append(make('dt', 'module-runtime-label', field.label[language]));
      let displayed = state[id];
      if (field.type === 'boolean') displayed = displayed ? (language === 'fr' ? 'Oui' : 'Yes') : (language === 'fr' ? 'Non' : 'No');
      else if (field.type === 'number') displayed = new Intl.NumberFormat(language).format(displayed);
      row.append(make('dd', 'module-runtime-value', String(displayed || (displayed === 0 ? 0 : '—'))));
      content.append(row);
    }
    card.append(content);
    if (manifest.progress) {
      const value = state[manifest.progress.valueField], target = state[manifest.progress.targetField];
      const progress = make('progress', 'module-runtime-progress');
      progress.max = target;
      progress.value = Math.max(0, Math.min(target, value));
      progress.setAttribute('aria-label', manifest.progress.label[language]);
      card.append(progress, make('p', 'module-runtime-progress-label', value + ' / ' + target));
    }
    const controls = make('div', 'module-runtime-actions');
    function dispatch(action, value) {
      if (typeof config.onAction === 'function') config.onAction(action.id, value);
    }
    for (const id of view.actions) {
      const action = manifest.actions.find(item => item.id === id), field = manifest.fields.find(item => item.id === action.field);
      const button = make('button', 'module-runtime-action', action.label[language]);
      button.type = 'button';
      button.dataset.moduleAction = action.id;
      focusTargets.set('action:' + action.id, button);
      button.setAttribute('aria-label', action.label[language]);
      button.disabled = typeof config.onAction !== 'function';
      if (action.type === 'increment') button.disabled = button.disabled || (action.amount > 0 ? state[field.id] >= field.max : state[field.id] <= field.min);
      if (action.type === 'set-text') {
        const form = make('form', 'module-runtime-editor'), label = make('label', 'module-runtime-input-label', field.label[language]);
        const input = make('input', 'module-runtime-input'), draft = drafts.fields.get(field.id);
        input.type = 'text'; input.maxLength = field.maxLength; input.value = draft ? draft.value : state[field.id]; input.disabled = button.disabled;
        const initialValue = input.value;
        if (draft && typeof input.setSelectionRange === 'function' && typeof draft.start === 'number') input.setSelectionRange(draft.start, draft.end);
        function remember() {
          const value = input.value.slice(0, field.maxLength);
          if (value === state[field.id]) drafts.fields.delete(field.id);
          else drafts.fields.set(field.id, {value, start: input.selectionStart, end: input.selectionEnd});
        }
        on(input, 'input', remember); on(input, 'select', remember);
        captureDrafts.push(() => {
          if (input.value !== initialValue) remember();
          else {const current = drafts.fields.get(field.id); if (current && current.value === input.value) {current.start = input.selectionStart; current.end = input.selectionEnd;}}
        });
        input.dataset.moduleField = field.id;
        focusTargets.set('field:' + field.id, input);
        input.setAttribute('aria-label', field.label[language]);
        label.append(input); form.append(label, button); button.type = 'submit';
        on(form, 'submit', event => { event.preventDefault(); remember(); dispatch(action, input.value); });
        controls.append(form);
      } else {
        on(button, 'click', () => dispatch(action));
        controls.append(button);
      }
    }
    card.append(controls);
    host.replaceChildren(card);
    if (previousFocus) {
      const target = focusTargets.get(previousFocus.field ? 'field:' + previousFocus.field : 'action:' + previousFocus.action);
      if (target && !target.disabled) {
        target.focus({ preventScroll: true });
        if (previousFocus.field && typeof target.setSelectionRange === 'function' && typeof previousFocus.start === 'number') target.setSelectionRange(previousFocus.start, previousFocus.end);
      }
    }
    let disposed = false;
    function dispose() {
      if (disposed) return; disposed = true;
      captureDrafts.splice(0).forEach(capture => capture());
      listeners.splice(0).forEach(unsubscribe => unsubscribe());
      if (card.parentNode === host) card.remove();
      if (renderedHosts.get(host) === dispose) renderedHosts.delete(host);
    }
    renderedHosts.set(host, dispose);
    return dispose;
  }

  const catalog = freeze([
    validateManifest({ manifestVersion: 2, id: 'community.reading', version: '1.0.0', name: { en: 'Reading', fr: 'Lecture' },
      description: { en: 'Make room for one more chapter. Your reading progress stays on this device.', fr: 'Une place pour un chapitre de plus. Votre progression reste sur cet appareil.' }, permissions: [],
      fields: [
        { id: 'title', type: 'text', label: { en: 'Book', fr: 'Livre' }, default: '', maxLength: 120 },
        { id: 'completed', type: 'number', label: { en: 'Chapters read', fr: 'Chapitres lus' }, default: 0, min: 0, max: 1000 },
        { id: 'target', type: 'number', label: { en: 'Chapter goal', fr: 'Objectif de chapitres' }, default: 12, min: 1, max: 1000 }
      ],
      actions: [
        { id: 'advance', type: 'increment', field: 'completed', amount: 1, label: { en: 'One more chapter', fr: 'Un chapitre de plus' } },
        { id: 'reset', type: 'reset', field: 'completed', label: { en: 'Start again', fr: 'Recommencer' } },
        { id: 'rename', type: 'set-text', field: 'title', label: { en: 'Save book', fr: 'Enregistrer le livre' } }
      ],
      presentations: { full: { fields: ['title', 'completed', 'target'], actions: ['advance', 'rename', 'reset'] }, scene: { fields: ['title', 'completed'], actions: ['advance', 'rename'] }, rail: { fields: ['completed'], actions: ['advance'] } },
      progress: { valueField: 'completed', targetField: 'target', label: { en: 'Reading progress', fr: 'Progression de lecture' } }, appearance: { accent: '#A6E3B4' }
    }),
    validateManifest({ manifestVersion: 2, id: 'community.water', version: '1.0.0', name: { en: 'Water break', fr: 'Pause eau' },
      description: { en: 'A small reminder to take care of yourself. Count the glasses you choose to record.', fr: 'Un petit rappel pour prendre soin de vous. Notez les verres de votre choix.' }, permissions: [],
      fields: [
        { id: 'glasses', type: 'number', label: { en: 'Glasses recorded', fr: 'Verres enregistrés' }, default: 0, min: 0, max: 50 },
        { id: 'goal', type: 'number', label: { en: 'Personal goal', fr: 'Objectif personnel' }, default: 8, min: 1, max: 50 }
      ],
      actions: [
        { id: 'drink', type: 'increment', field: 'glasses', amount: 1, label: { en: 'Record a glass', fr: 'Noter un verre' } },
        { id: 'reset', type: 'reset', field: 'glasses', label: { en: 'Reset count', fr: 'Remettre à zéro' } }
      ],
      presentations: { full: { fields: ['glasses', 'goal'], actions: ['drink', 'reset'] }, scene: { fields: ['glasses'], actions: ['drink', 'reset'] }, rail: { fields: ['glasses'], actions: ['drink'] } },
      progress: { valueField: 'glasses', targetField: 'goal', label: { en: 'Personal water goal', fr: 'Objectif personnel pour l’eau' } }, appearance: { accent: '#5AC8FA' }
    })
  ]);

  function getLayoutContract(input) {
    if (!layoutHost) fail('the layout host is required');
    return layoutHost.getCommunityContract(validateManifest(input));
  }
  return Object.freeze({ limits, catalog, validateManifest, parseManifest, validateRegistry, normalizeState, createStore, getLayoutContract, render });
});
