(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) root.NotchySearch = api;
})(typeof window === 'object' ? window : null, function () {
  'use strict';
  const CONFIG = Object.freeze({minimumQuery: 2, maximumQuery: 256, limit: 8, debounce: 80, statusInterval: 1000});
  const MESSAGES = Object.freeze({
    'Recherche locale': 'Local search', 'Rechercher un fichier ou un dossier': 'Search files and folders',
    'Effacer la recherche': 'Clear search', 'Fermer la recherche': 'Close search',
    'Résultats de recherche': 'Search results', 'Recherche…': 'Searching…', 'Préparation de la recherche…': 'Preparing search…',
    'Tout reste sur cet ordinateur.': 'Everything stays on this computer.',
    'Tape au moins deux caractères.': 'Type at least two characters.',
    'Aucun résultat': 'No results', 'Essaie un autre nom ou une partie du nom.': 'Try another name or part of a name.',
    'Indexation de {count} éléments…': 'Indexing {count} items…', '{count} éléments indexés': '{count} indexed items',
    '{count} résultats': '{count} results', 'La recherche est indisponible.': 'Search is unavailable.',
    'Réessaie dans un instant.': 'Try again in a moment.', 'Réessayer': 'Try again',
    'Ouvrir': 'Open', 'Afficher dans l’Explorateur': 'Show in File Explorer', 'Envoyer via LocalSend': 'Send via LocalSend',
    'Ouverture…': 'Opening…', 'Impossible d’ouvrir cet élément.': 'This item could not be opened.',
    'Impossible d’afficher cet élément.': 'This item could not be revealed.',
    'Impossible de préparer cet envoi.': 'This item could not be prepared for sharing.',
    'Actualiser': 'Refresh', 'Reconstruire l’index': 'Rebuild the index',
    'Raccourci global indisponible · Ctrl+K dans Notchy': 'Global shortcut unavailable · Ctrl+K in Notchy',
    'Dossier': 'Folder', 'Fichier': 'File', 'Entrée': 'Enter', 'Échap': 'Esc',
  });
  let instance = 0;

  function normalizeHits(value) {
    const hits = [], ids = new Set();
    for (const item of Array.isArray(value) ? value : []) {
      if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)
        || typeof item.name !== 'string' || !item.name || typeof item.path !== 'string') continue;
      ids.add(item.id);
      hits.push({id: item.id, name: item.name, path: item.path, kind: item.kind === 'folder' || item.kind === 'dir' ? 'folder' : 'file'});
      if (hits.length === CONFIG.limit) break;
    }
    return hits;
  }

  function highlightParts(value, query) {
    const name = typeof value === 'string' ? value : '', needle = typeof query === 'string' ? query.trim() : '';
    if (!needle) return [{text: name, matched: false}];
    const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'), parts = [];
    let cursor = 0;
    for (const match of name.matchAll(pattern)) {
      const index = match.index;
      if (index > cursor) parts.push({text: name.slice(cursor, index), matched: false});
      parts.push({text: match[0], matched: true});
      cursor = index + match[0].length;
    }
    if (cursor < name.length || !parts.length) parts.push({text: name.slice(cursor), matched: false});
    return parts;
  }

  function create({host, invoke, t, onOpen, onClose, onSend} = {}) {
    if (host?.nodeType !== 1 || !host.ownerDocument?.createElement || typeof invoke !== 'function') {
      throw new TypeError('Search requires a host element and a native invoke function.');
    }
    const document = host.ownerDocument, prefix = 'notchy-search-' + (++instance), listeners = [];
    const previous = Array.from(host.childNodes), hadClass = host.classList.contains('notchy-search'), previousHidden = host.hidden, previousLabel = host.getAttribute('aria-label');
    const view = document.defaultView;
    const emptyApi = view?.NotchEmpty;
    let opened = false, disposed = false, hits = [], selected = -1, generation = 0, statusGeneration = 0;
    let debounce = null, poll = null, loading = false, acting = false, composing = false, error = '', statusError = false;
    let status = {files: 0, indexing: false, shortcutUnavailable: false}, statusReady = false, reindexing = false, opener = null, emptyController = null;
    const element = (tag, className) => {const node = document.createElement(tag); if (className) node.className = className; return node;};
    const label = (key, values = {}) => {
      const translated = typeof t === 'function' ? t(key) : key;
      const english = /^en\b/i.test(document.documentElement?.lang || '');
      const value = typeof translated === 'string' && translated !== key ? translated : english ? MESSAGES[key] || key : key;
      return value.replace(/\{(\w+)\}/g, (match, name) => Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match);
    };
    const icon = kind => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', {search: 'm16.5 16.5 4 4M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z',
        close: 'm6 6 12 12M18 6 6 18', folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
        file: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9ZM14 3v6h6',
        reveal: 'M10 4H4v16h16v-6M14 4h6v6M20 4 10 14', send: 'M12 16V3m-5 5 5-5 5 5M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7',
        refresh: 'M20 7v5h-5M4 17v-5h5M6.2 6.2A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.8 5.8'}[kind]);
      svg.append(path); return svg;
    };
    const button = (className, kind) => {const node = element('button', className); node.type = 'button'; if (kind) node.append(icon(kind)); return node;};
    const listen = (node, event, handler) => {node.addEventListener(event, handler); listeners.push(() => node.removeEventListener(event, handler));};
    const heading = element('div', 'search-heading'), field = element('div', 'search-field'), input = element('input', 'search-input');
    const clear = button('search-icon-button search-clear', 'close'), closeButton = button('search-icon-button search-close');
    input.id = prefix + '-input'; input.type = 'search'; input.maxLength = CONFIG.maximumQuery; input.autocomplete = 'off'; input.spellcheck = false;
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', prefix + '-results'); input.setAttribute('enterkeyhint', 'go');
    field.append(icon('search'), input, clear); heading.append(field, closeButton);
    const body = element('div', 'search-body'), list = element('div', 'search-results'), empty = element('div', 'search-empty');
    list.id = prefix + '-results'; list.setAttribute('role', 'listbox');
    body.append(list, empty);
    const footer = element('footer', 'search-footer'), information = element('span', 'search-information'), actions = element('div', 'search-actions');
    const reveal = button('search-icon-button search-reveal', 'reveal'), send = button('search-icon-button search-send', 'send'), openButton = button('search-open');
    const reindex = button('search-icon-button search-reindex', 'refresh'), reindexLabel = element('span'); reindex.append(reindexLabel);
    const announcer = element('span', 'search-sr'); announcer.id = prefix + '-status'; announcer.setAttribute('role', 'status'); announcer.setAttribute('aria-live', 'polite'); announcer.setAttribute('aria-atomic', 'true');
    input.setAttribute('aria-describedby', announcer.id);
    actions.append(reveal, send, openButton); footer.append(information, reindex, actions);
    host.classList.add('notchy-search'); host.hidden = true; host.replaceChildren(heading, body, footer, announcer);
    host.setAttribute('aria-label', label('Recherche locale'));

    function emptyState(title, hint, retry = false) {
      if (emptyApi?.show) {
        if (!emptyController) emptyController = emptyApi.show(empty, {icon: icon('search')});
        emptyController.update({title, hint, actionLabel: retry ? label('Réessayer') : '', onAction: retry ? refresh : null});
      } else {
        empty.replaceChildren(); const strong = element('strong'), detail = element('span'); strong.textContent = title; detail.textContent = hint;
        empty.append(strong, detail);
        if (retry) {const retryButton = button('search-retry'); retryButton.textContent = label('Réessayer'); retryButton.addEventListener('click', refresh, {once: true}); empty.append(retryButton);}
      }
    }
    function render() {
      if (disposed) return;
      const query = input.value.trim(), hasHits = hits.length > 0;
      host.setAttribute('aria-label', label('Recherche locale'));
      input.placeholder = label('Rechercher un fichier ou un dossier'); input.setAttribute('aria-label', input.placeholder);
      clear.hidden = !input.value; clear.setAttribute('aria-label', label('Effacer la recherche')); clear.title = label('Effacer la recherche');
      closeButton.textContent = label('Échap'); closeButton.setAttribute('aria-label', label('Fermer la recherche'));
      list.setAttribute('aria-label', label('Résultats de recherche')); list.setAttribute('aria-busy', String(loading));
      list.hidden = !hasHits; empty.hidden = hasHits;
      input.setAttribute('aria-expanded', String(opened && hasHits));
      host.dataset.status = error || statusError ? 'error' : loading ? 'loading' : status.indexing ? 'indexing' : 'ready';
      information.textContent = error ? label(error) : statusError ? label('La recherche est indisponible.') : status.indexing ? label('Indexation de {count} éléments…', {count: status.files})
        : status.shortcutUnavailable ? label('Raccourci global indisponible · Ctrl+K dans Notchy')
        : statusReady ? label('{count} éléments indexés', {count: status.files}) : label('Tout reste sur cet ordinateur.');
      information.title = information.textContent;
      reindexLabel.textContent = label('Actualiser'); reindex.title = label('Reconstruire l’index'); reindex.setAttribute('aria-label', label('Reconstruire l’index'));
      reindex.disabled = status.indexing || reindexing; reindex.setAttribute('aria-busy', String(reindexing));
      reveal.setAttribute('aria-label', label('Afficher dans l’Explorateur')); reveal.title = label('Afficher dans l’Explorateur') + ' · Ctrl+' + label('Entrée');
      send.setAttribute('aria-label', label('Envoyer via LocalSend')); send.title = label('Envoyer via LocalSend');
      openButton.textContent = label(acting ? 'Ouverture…' : 'Ouvrir'); openButton.title = label('Entrée');
      send.hidden = typeof onSend !== 'function' || hits[selected]?.kind !== 'file';
      for (const control of [openButton, reveal, send]) control.disabled = acting || loading || !hits[selected];
      actions.hidden = !hasHits;
      if (!hasHits) {
        if (error || statusError) emptyState(label(error || 'La recherche est indisponible.'), label('Réessaie dans un instant.'), true);
        else if (loading) emptyState(label('Recherche…'), label('Tout reste sur cet ordinateur.'));
        else if (!statusReady) emptyState(label('Préparation de la recherche…'), label('Tout reste sur cet ordinateur.'));
        else if (query.length < CONFIG.minimumQuery) emptyState(label('Recherche locale'), label('Tape au moins deux caractères.'));
        else emptyState(label('Aucun résultat'), status.indexing ? label('Indexation de {count} éléments…', {count: status.files}) : label('Essaie un autre nom ou une partie du nom.'));
      }
      if (error) announcer.textContent = label(error);
      else if (!loading && hasHits) announcer.textContent = label('{count} résultats', {count: hits.length});
      else if (!hasHits && query.length >= CONFIG.minimumQuery && statusReady && !loading) announcer.textContent = label('Aucun résultat');
      else announcer.textContent = '';
      select(selected, false);
    }
    function select(index, scroll = true) {
      selected = hits.length ? Math.max(0, Math.min(index, hits.length - 1)) : -1;
      for (let position = 0; position < list.children.length; position++) list.children[position].setAttribute('aria-selected', String(position === selected));
      if (selected >= 0) {
        const row = list.children[selected]; input.setAttribute('aria-activedescendant', row.id);
        if (scroll) row.scrollIntoView?.({block: 'nearest'});
      } else input.removeAttribute('aria-activedescendant');
      send.hidden = typeof onSend !== 'function' || hits[selected]?.kind !== 'file';
    }
    function results(value) {
      hits = normalizeHits(value); selected = hits.length ? 0 : -1; list.replaceChildren();
      for (const hit of hits) {
        const row = button('search-result'), glyph = element('span', 'search-result-icon'), copy = element('span', 'search-result-copy');
        row.id = prefix + '-result-' + list.children.length; row.tabIndex = -1; row.setAttribute('role', 'option'); row.dataset.resultId = hit.id;
        row.setAttribute('aria-label', hit.name + ', ' + label(hit.kind === 'folder' ? 'Dossier' : 'Fichier') + ', ' + hit.path);
        const name = element('span', 'search-result-name'), path = element('span', 'search-result-path');
        for (const part of highlightParts(hit.name, input.value)) {const span = element(part.matched ? 'mark' : 'span'); span.textContent = part.text; name.append(span);}
        path.textContent = hit.path; path.title = hit.path; glyph.append(icon(hit.kind)); copy.append(name, path); row.append(glyph, copy); list.append(row);
      }
    }
    function readStatus(value) {
      if (!value || typeof value !== 'object') return;
      status = {files: Number.isSafeInteger(value.files) && value.files >= 0 ? value.files : status.files, indexing: value.indexing === true,
        shortcutUnavailable: typeof value.shortcut?.available === 'boolean' ? !value.shortcut.available : status.shortcutUnavailable};
      statusReady = true; statusError = typeof value.lastError === 'string' && !!value.lastError;
      if (!status.indexing) {clearTimeout(poll); poll = null;}
      else if (opened && !disposed && !poll) poll = setTimeout(refreshStatus, CONFIG.statusInterval);
    }
    async function query() {
      if (!opened || disposed) return;
      const q = input.value.trim(), current = ++generation;
      clearTimeout(debounce); debounce = null; error = ''; results([]);
      if (q.length < CONFIG.minimumQuery) {loading = false; render(); return;}
      loading = true; render();
      try {
        const value = await invoke('search_query', {q, limit: CONFIG.limit});
        if (!opened || disposed || current !== generation) return;
        if (!value || !Array.isArray(value.hits)) throw new Error('Invalid search response');
        readStatus(value); results(value.hits);
      } catch (_) {if (!opened || disposed || current !== generation) return; error = 'La recherche est indisponible.';}
      finally {if (opened && !disposed && current === generation) {loading = false; render();}}
    }
    async function refreshStatus() {
      if (!opened || disposed) return;
      clearTimeout(poll); poll = null;
      const current = ++statusGeneration, wasIndexing = status.indexing;
      try {
        const value = await invoke('search_status', {});
        if (!opened || disposed || current !== statusGeneration) return;
        if (!value || typeof value.indexing !== 'boolean' || !Number.isSafeInteger(value.files)) throw new Error('Invalid search status');
        readStatus(value);
        if (wasIndexing && !status.indexing && input.value.trim().length >= CONFIG.minimumQuery && !loading && !debounce) void query();
      } catch (_) {if (!opened || disposed || current !== statusGeneration) return; statusError = true; statusReady = true;}
      finally {
        if (opened && !disposed && current === statusGeneration) {
          render(); if (status.indexing && !poll) poll = setTimeout(refreshStatus, CONFIG.statusInterval);
        }
      }
    }
    function refresh() {if (opened && !disposed) {void refreshStatus(); if (input.value.trim().length >= CONFIG.minimumQuery) void query();}}
    async function rebuild() {
      if (!opened || disposed || reindexing || status.indexing) return;
      const current = ++statusGeneration; input.focus({preventScroll: true}); reindexing = true; error = ''; render();
      try {
        const value = await invoke('search_reindex', {});
        if (!opened || disposed || current !== statusGeneration) return;
        if (!value || typeof value.indexing !== 'boolean' || !Number.isSafeInteger(value.files)) throw new Error('Invalid search status');
        generation++; clearTimeout(debounce); debounce = null; loading = false; results([]); readStatus(value);
        if (!status.indexing && input.value.trim().length >= CONFIG.minimumQuery) void query();
      } catch (_) {if (opened && !disposed && current === statusGeneration) error = 'La recherche est indisponible.';}
      finally {reindexing = false; if (opened && !disposed) render();}
    }
    function changed() {
      if (composing || disposed || !opened) return;
      generation++; clearTimeout(debounce); error = ''; loading = input.value.trim().length >= CONFIG.minimumQuery; results([]); render();
      if (loading) debounce = setTimeout(query, CONFIG.debounce);
    }
    async function activate(action = 'open') {
      const hit = hits[selected];
      if (!opened || disposed || acting || loading || !hit || action === 'send' && (hit.kind !== 'file' || typeof onSend !== 'function')) return;
      const current = generation; input.focus({preventScroll: true}); acting = true; error = ''; render();
      try {
        if (action === 'send') await onSend(hit.id);
        else await invoke(action === 'reveal' ? 'search_reveal' : 'search_open', {id: hit.id});
        if (opened && !disposed && current === generation) close();
      } catch (_) {
        if (opened && !disposed && current === generation) {error = action === 'send' ? 'Impossible de préparer cet envoi.' : action === 'reveal' ? 'Impossible d’afficher cet élément.' : 'Impossible d’ouvrir cet élément.'; render();}
      } finally {acting = false; if (opened && !disposed) render();}
    }
    function key(event) {
      if (!opened || composing || event.isComposing) return;
      if (event.key === 'Escape') {event.preventDefault(); event.stopImmediatePropagation(); close(); return;}
      if (event.target !== input) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); if (!hits.length) return;
        select((selected + (event.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length);
      } else if (event.key === 'Enter') {event.preventDefault(); void activate(event.ctrlKey || event.metaKey ? 'reveal' : 'open');}
    }
    function open() {
      if (disposed) return false;
      if (!opened) {opener = document.activeElement; opened = true; host.hidden = false; onOpen?.(); refresh();}
      input.focus({preventScroll: true}); return true;
    }
    function close({restoreFocus = true, notify = true} = {}) {
      if (!opened || disposed) return false;
      opened = false; generation++; statusGeneration++; clearTimeout(debounce); clearTimeout(poll); debounce = poll = null;
      loading = false; host.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant');
      if (notify) onClose?.();
      if (restoreFocus && opener?.isConnected !== false && typeof opener?.focus === 'function') opener.focus({preventScroll: true});
      return true;
    }
    listen(input, 'input', changed); listen(input, 'compositionstart', () => {composing = true; generation++; clearTimeout(debounce); debounce = null; loading = false; results([]); render();});
    listen(input, 'compositionend', () => {composing = false; changed();}); listen(host, 'keydown', key);
    listen(clear, 'click', () => {input.value = ''; changed(); input.focus({preventScroll: true});}); listen(closeButton, 'click', () => close());
    listen(list, 'click', event => {const row = event.target.closest('[data-result-id]'); if (!row || !list.contains(row)) return; select(hits.findIndex(hit => hit.id === row.dataset.resultId), false); void activate();});
    listen(list, 'pointermove', event => {const row = event.target.closest('[data-result-id]'); if (row && list.contains(row)) select(hits.findIndex(hit => hit.id === row.dataset.resultId), false);});
    listen(openButton, 'click', () => void activate()); listen(reveal, 'click', () => void activate('reveal')); listen(send, 'click', () => void activate('send'));
    listen(reindex, 'click', () => void rebuild());
    render();
    return Object.freeze({open, close, isOpen: () => opened, render, refresh, elements: {input, clear, close: closeButton, list, empty, information, open: openButton, reveal, send, reindex, announcer}, dispose() {
      if (disposed) return false; close({restoreFocus: false, notify: false}); disposed = true; for (const remove of listeners) remove(); emptyController?.dispose();
      host.replaceChildren(...previous); host.hidden = previousHidden; if (previousLabel === null) host.removeAttribute('aria-label'); else host.setAttribute('aria-label', previousLabel);
      delete host.dataset.status; if (!hadClass) host.classList.remove('notchy-search'); return true;
    }});
  }
  return Object.freeze({CONFIG, MESSAGES, normalizeHits, highlightParts, create});
});
