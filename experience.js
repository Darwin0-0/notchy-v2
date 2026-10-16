(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) root.NotchyExperience = api;
})(typeof window === 'object' ? window : null, function () {
  'use strict';
  const MODULE_IDS = Object.freeze(['music', 'focus', 'weather', 'tasks', 'shelf']);
  const META = Object.freeze({music: ['Musique', 'var(--activity-music)'], focus: ['Focus', 'var(--activity-focus)'], weather: ['Météo', 'var(--activity-weather)'], tasks: ['Tâches', 'var(--activity-tasks)'], shelf: ['Étagère', 'var(--activity-shelf)']});
  const ICON_PATHS = Object.freeze({health: 'M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5z M9 12l2 2 4-4', back: 'm14 6-6 6 6 6', up: 'm6 15 6-6 6 6', down: 'm6 9 6 6 6-6', ready: 'm5 12 4 4L19 6', attention: 'M12 5v9 M12 19h.01', unknown: 'M6 12h12', busy: 'M12 3a9 9 0 0 1 9 9'});
  const list = value => Array.isArray(value) ? value : [];
  const known = id => typeof id === 'string' && MODULE_IDS.includes(id);
  const copy = state => ({enabled: [...state.enabled], order: [...state.order]});

  function normalizeModuleState(value = {}) {
    const order = [...new Set([...list(value?.order).filter(known), ...MODULE_IDS])];
    const selected = new Set(list(value?.enabled).filter(known));
    return {enabled: order.filter(id => selected.has(id)), order};
  }
  function modulePreviewPlan(value) {
    const state = normalizeModuleState(value), visible = state.enabled.slice(0, 3), reserve = state.enabled.slice(3);
    const items = visible.map((id, index) => ({id, column: index === 0 ? 1 : 2, row: index === 2 ? 2 : 1,
      columnSpan: visible.length === 1 ? 2 : 1, rowSpan: visible.length < 3 || index === 0 ? 2 : 1}));
    return {...state, visible, reserve, items};
  }
  function updateModuleState(value, id, command) {
    const state = normalizeModuleState(value);
    if (!known(id)) return state;
    if (command === 'toggle') state.enabled = state.enabled.includes(id) ? state.enabled.filter(item => item !== id) : [...state.enabled, id];
    else if (command === 'up' || command === 'down') {
      const index = state.order.indexOf(id), next = index + (command === 'up' ? -1 : 1);
      if (next >= 0 && next < state.order.length) [state.order[index], state.order[next]] = [state.order[next], state.order[index]];
    }
    return normalizeModuleState(state);
  }
  function healthReadiness(items) {
    const rows = list(items), ready = rows.filter(item => item?.status === 'ready').length;
    return {ready, total: rows.length, all: rows.length > 0 && ready === rows.length, busy: rows.some(item => item?.status === 'busy')};
  }

  function create({healthHost, modulesHost, t = value => value, onAction = () => {}, onModulesChange = () => {}, icons = {}} = {}) {
    const document = healthHost?.ownerDocument || modulesHost?.ownerDocument;
    if (!document) throw new TypeError('A Health or Modules host is required.');
    let disposed = false, moduleState = normalizeModuleState(), healthItems = new Map();
    const moduleRows = new Map(), healthRows = new Map(), tiles = new Map();
    const say = (source, values = {}) => String(t(source, values) ?? source).replace(/\{(\w+)\}/g, (match, key) => Object.hasOwn(values, key) ? String(values[key]) : match);
    const element = (tag, className, text) => {const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;};
    function icon(name) {
      const supplied = icons[name] || (name === 'ready' ? icons.check : null);
      if (supplied?.cloneNode) {const clone = supplied.cloneNode(true); clone.removeAttribute?.('id'); clone.setAttribute?.('aria-hidden', 'true'); clone.setAttribute?.('focusable', 'false'); return clone;}
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false'); path.setAttribute('d', ICON_PATHS[name] || ICON_PATHS.unknown); svg.append(path); return svg;
    }
    const button = (className, label) => {const node = element('button', className, label); node.type = 'button'; return node;};
    const place = (parent, node, index) => {if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] || null);};
    function heading(host, title, health = false) {
      host.classList.add('experience-view');
      const head = element('header', 'experience-heading'), label = element('div', 'experience-heading-title'), titleNode = element('h2', '', say(title));
      if (health) label.append(icon('health'));
      label.append(titleNode);
      const actions = element('div', 'experience-heading-actions'), back = button('experience-back', say('Retour'));
      const backLabel = element('span', '', say('Retour')); back.dataset.experienceCommand = 'back'; back.replaceChildren(icon('back'), backLabel); actions.append(back); head.append(label, actions); host.replaceChildren(head);
      return {head, titleNode, actions, back, backLabel};
    }
    const healthHeading = healthHost ? heading(healthHost, 'Santé de Notchy', true) : null;
    const healthChip = healthHost ? element('span', 'experience-health-chip') : null;
    const healthGrid = healthHost ? element('div', 'experience-health-grid') : null;
    if (healthHost) {healthChip.setAttribute('role', 'status'); healthChip.setAttribute('aria-live', 'polite'); healthHeading.actions.prepend(healthChip); healthHost.append(healthGrid);}
    const moduleHeading = modulesHost ? heading(modulesHost, 'Modules') : null;
    const moduleHint = modulesHost ? element('span', 'experience-module-hint', say('3 visibles au maximum')) : null;
    const moduleBody = modulesHost ? element('div', 'experience-module-body') : null;
    const moduleList = modulesHost ? element('div', 'experience-module-list') : null;
    const preview = modulesHost ? element('section', 'experience-module-preview') : null;
    const previewTitle = modulesHost ? element('h3', '', say('APERÇU')) : null;
    const previewStage = modulesHost ? element('div', 'experience-preview-stage') : null;
    const previewCaption = modulesHost ? element('p', 'experience-preview-caption') : null;
    const moduleStatus = modulesHost ? element('p', 'experience-sr') : null;
    if (modulesHost) {
      moduleHeading.actions.prepend(moduleHint); moduleList.setAttribute('role', 'list'); moduleList.setAttribute('aria-label', say('Modules'));
      preview.setAttribute('aria-label', say('Aperçu de la disposition')); previewStage.setAttribute('aria-hidden', 'true'); moduleStatus.setAttribute('role', 'status'); moduleStatus.setAttribute('aria-live', 'polite');
      preview.append(previewTitle, previewStage, previewCaption); moduleBody.append(moduleList, preview, moduleStatus); modulesHost.append(moduleBody);
    }
    function renderHealth({items = []} = {}) {
      if (disposed || !healthHost) return;
      const focused = document.activeElement, keepFocus = healthGrid.contains(focused) ? focused : null;
      const next = new Map();
      for (const item of list(items).slice(0, 6)) if (item && typeof item.id === 'string' && item.id && !next.has(item.id)) next.set(item.id, {...item, status: ['ready', 'attention', 'unknown', 'busy'].includes(item.status) ? item.status : 'unknown'});
      healthItems = next;
      for (const [id, row] of healthRows) if (!next.has(id)) {row.card.remove(); healthRows.delete(id);}
      let index = 0;
      for (const [id, item] of next) {
        let row = healthRows.get(id);
        if (!row) {
          const card = element('article', 'experience-health-card'), mark = element('span', 'experience-health-mark'), text = element('div', 'experience-health-copy');
          const label = element('strong'), detail = element('span'), action = button('experience-pill');
          action.dataset.experienceCommand = 'health'; action.dataset.experienceItem = id; text.append(label, detail); card.append(mark, text, action); row = {card, mark, label, detail, action}; healthRows.set(id, row);
          card.classList.add('experience-new-row'); card.style.setProperty('--entry-index', String(index));
        }
        row.card.dataset.status = item.status; row.card.setAttribute('aria-busy', String(item.status === 'busy')); row.mark.replaceChildren(icon(item.status));
        row.label.textContent = typeof item.label === 'string' ? item.label : ''; row.detail.textContent = typeof item.detail === 'string' ? item.detail : ''; row.detail.title = row.detail.textContent;
        row.action.textContent = typeof item.actionLabel === 'string' ? item.actionLabel : ''; row.action.hidden = !row.action.textContent || item.action === undefined || item.status === 'ready'; row.action.disabled = item.status === 'busy';
        row.action.setAttribute('aria-label', row.action.textContent + ' · ' + row.label.textContent); place(healthGrid, row.card, index++);
      }
      const readiness = healthReadiness([...next.values()]); healthChip.dataset.ready = String(readiness.all);
      healthChip.textContent = readiness.all ? say('Tout est prêt') : say('{ready}/{total} prêts', readiness);
      healthHeading.titleNode.textContent = say('Santé de Notchy'); healthHeading.backLabel.textContent = say('Retour');
      if (keepFocus) (keepFocus.isConnected && !keepFocus.disabled && !keepFocus.hidden ? keepFocus : healthHeading.back).focus({preventScroll: true});
      return readiness;
    }
    function renderModules(value = {}) {
      if (disposed || !modulesHost) return;
      moduleState = normalizeModuleState(value);
      const plan = modulePreviewPlan(moduleState), focused = document.activeElement;
      const keepFocus = moduleList.contains(focused) ? focused : null;
      const definitions = new Map(list(value.definitions).filter(item => item && known(item.id)).map(item => [item.id, item]));
      for (const [index, id] of moduleState.order.entries()) {
        let row = moduleRows.get(id);
        if (!row) {
          const item = element('div', 'experience-module-row'), dot = element('span', 'experience-module-dot'), text = element('span', 'experience-module-copy'), label = element('strong'), tag = element('span', 'experience-module-tag');
          item.setAttribute('role', 'listitem'); item.dataset.experienceModule = id; dot.style.backgroundColor = META[id][1]; dot.setAttribute('aria-hidden', 'true'); text.append(label, tag);
          const controls = element('span', 'experience-module-controls'), up = button('experience-arrow'), down = button('experience-arrow'), toggle = button('experience-switch');
          up.append(icon('up')); down.append(icon('down')); toggle.setAttribute('role', 'switch'); toggle.append(element('span'));
          for (const [command, control] of [['up', up], ['down', down], ['toggle', toggle]]) {control.dataset.experienceCommand = command; control.dataset.experienceModule = id; controls.append(control);}
          item.append(dot, text, controls); row = {item, label, tag, up, down, toggle}; moduleRows.set(id, row);
          item.classList.add('experience-new-row'); item.style.setProperty('--entry-index', String(index));
          const tile = element('div', 'experience-preview-tile'); tile.style.setProperty('--experience-module-color', META[id][1]); tiles.set(id, tile); previewStage.append(tile);
        }
        const definition = definitions.get(id), label = say(typeof definition?.label === 'string' ? definition.label : META[id][0]), enabled = moduleState.enabled.includes(id), visible = plan.visible.includes(id);
        row.label.textContent = label; row.item.title = typeof definition?.description === 'string' ? definition.description : '';
        row.item.dataset.enabled = String(enabled); row.tag.textContent = enabled ? say(visible ? 'VISIBLE' : 'EN RÉSERVE') : ''; row.tag.dataset.visible = String(visible);
        row.up.setAttribute('aria-label', say('Monter {module}', {module: label})); row.down.setAttribute('aria-label', say('Descendre {module}', {module: label})); row.up.disabled = index === 0; row.down.disabled = index === moduleState.order.length - 1;
        row.toggle.setAttribute('aria-label', label); row.toggle.setAttribute('aria-checked', String(enabled)); place(moduleList, row.item, index);
        const tile = tiles.get(id), placement = plan.items.find(item => item.id === id); tile.textContent = label; tile.dataset.visible = String(!!placement);
        tile.style.left = !placement ? '25%' : placement.column === 2 ? 'calc(50% + var(--measure-2-px))' : '0'; tile.style.top = !placement ? '25%' : placement.row === 2 ? 'calc(50% + var(--measure-2-px))' : '0';
        tile.style.width = !placement ? '50%' : placement.columnSpan === 2 ? '100%' : 'calc(50% - var(--measure-2-px))'; tile.style.height = !placement ? '50%' : placement.rowSpan === 2 ? '100%' : 'calc(50% - var(--measure-2-px))';
      }
      const count = plan.visible.length;
      previewCaption.textContent = say(count > 1 ? '{count} modules visibles' : '{count} module visible', {count}) + (plan.reserve.length ? ' · ' + say('{count} en réserve', {count: plan.reserve.length}) : '') + (!count ? ' — ' + say('active au moins un module') : '');
      previewStage.dataset.count = String(count); moduleStatus.textContent = previewCaption.textContent;
      moduleHeading.titleNode.textContent = say('Modules'); moduleHint.textContent = say('3 visibles au maximum'); previewTitle.textContent = say('APERÇU'); moduleHeading.backLabel.textContent = say('Retour');
      if (keepFocus?.isConnected) (keepFocus.disabled ? moduleRows.get(keepFocus.dataset.experienceModule)?.toggle : keepFocus)?.focus({preventScroll: true});
      return copy(moduleState);
    }
    function command(event) {
      if (disposed) return;
      const target = event.target.closest?.('[data-experience-command]');
      if (!target || target.disabled || !(healthHost?.contains(target) || modulesHost?.contains(target))) return;
      const action = target.dataset.experienceCommand;
      if (action === 'back') {onAction('back'); return;}
      if (action === 'health') {const item = healthItems.get(target.dataset.experienceItem); if (item && item.status !== 'busy' && item.status !== 'ready' && item.action !== undefined) onAction(item.action, {...item}); return;}
      const id = target.dataset.experienceModule;
      if (!known(id) || !['toggle', 'up', 'down'].includes(action)) return;
      const next = updateModuleState(moduleState, id, action), definitions = moduleState.order.map(key => ({id: key, label: moduleRows.get(key)?.label.textContent || META[key][0], description: moduleRows.get(key)?.item.title || ''}));
      renderModules({...next, definitions}); onModulesChange(copy(next));
    }
    healthHost?.addEventListener('click', command); modulesHost?.addEventListener('click', command);
    return {renderHealth, renderModules, dispose() {if (disposed) return; disposed = true; healthHost?.removeEventListener('click', command); modulesHost?.removeEventListener('click', command); healthItems.clear(); healthRows.clear(); moduleRows.clear(); tiles.clear();}};
  }
  return Object.freeze({MODULE_IDS, normalizeModuleState, modulePreviewPlan, updateModuleState, healthReadiness, create});
});
