(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) root.NotchySearch = api;
})(typeof window === 'object' ? window : null, function () {
  'use strict';
  const CONFIG = Object.freeze({minimumQuery: 2, maximumQuery: 256, limit: 8, debounce: 80, statusInterval: 1000, menuInset: 8});
  // Keep the affordance aligned with Rust; native validation remains authoritative.
  const OPENABLE_FORMATS = 'pdf epub txt md csv json yaml yml log rtf docx xlsx pptx odt ods odp png jpg jpeg webp gif bmp tif tiff ico avif heic mp3 m4a wav flac ogg aac mp4 webm mkv avi mov zip';
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
    'Autres actions': 'More actions', 'Actions pour {name}': 'Actions for {name}',
    'Aperçu QuickLook': 'QuickLook preview', 'Obtenir QuickLook': 'Get QuickLook',
    'Fermer l’aperçu': 'Close preview',
    'QuickLook est nécessaire pour afficher un aperçu. Installe-le, puis reviens dans Notchy.': 'QuickLook is needed for previews. Install it, then return to Notchy.',
    'Impossible de lancer l’aperçu QuickLook.': 'QuickLook preview could not be started.',
    'Ouverture…': 'Opening…', 'Impossible d’ouvrir cet élément.': 'This item could not be opened.',
    'Impossible d’afficher cet élément.': 'This item could not be revealed.',
    'Impossible de préparer cet envoi.': 'This item could not be prepared for sharing.',
    'Actualiser': 'Refresh', 'Reconstruire l’index': 'Rebuild the index',
    'Raccourci global indisponible · Ctrl+K dans Notchy': 'Global shortcut unavailable · Ctrl+K in Notchy',
    'Dossier': 'Folder', 'Fichier': 'File', 'Entrée': 'Enter', 'Échap': 'Esc',
  });
  let instance = 0;

  function canOpen(hit) {
    return hit?.kind === 'folder' || typeof hit?.name === 'string' && OPENABLE_FORMATS.split(' ').includes(hit.name.split('.').pop().toLowerCase()) && hit.name.includes('.');
  }

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
    const name = typeof value === 'string' ? value : '';
    const fold = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const words = [...new Set((typeof query === 'string' ? query : '').trim().split(/\s+/u).map(fold).filter(Boolean))];
    if (!words.length) return [{text: name, matched: false}];
    // Keep source offsets while folding, so accents, decomposed marks and emoji
    // are rendered exactly as received. No query or filename becomes HTML.
    const offsets = []; let folded = '', offset = 0, cluster = 0;
    for (const character of name) {
      const end = offset + character.length, text = fold(character);
      if (text) {cluster = offsets.length; folded += text; for (let i = 0; i < text.length; i++) offsets.push({start: offset, end});}
      else if (/\p{M}/u.test(character)) for (let i = cluster; i < offsets.length; i++) offsets[i].end = end;
      offset = end;
    }
    const matches = [];
    for (const word of words) for (let at = folded.indexOf(word); at !== -1; at = folded.indexOf(word, at + 1)) matches.push({start: offsets[at].start, end: offsets[at + word.length - 1].end});
    matches.sort((a, b) => a.start - b.start || b.end - a.end);
    const ranges = [];
    for (const match of matches) {const last = ranges[ranges.length - 1]; if (last && match.start <= last.end) last.end = Math.max(last.end, match.end); else ranges.push({...match});}
    const parts = []; let cursor = 0;
    for (const match of ranges) {
      if (match.start > cursor) parts.push({text: name.slice(cursor, match.start), matched: false});
      parts.push({text: name.slice(match.start, match.end), matched: true}); cursor = match.end;
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
    let cancelFocus = null;
    let status = {files: 0, indexing: false, shortcutUnavailable: false}, statusReady = false, reindexing = false, opener = null, emptyController = null, menuOpener = null;
    let quickLook = {supported: false, available: false};
    let previewing = false, previewSent = null, previewFlight = null, previewVersion = 0;
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
        more: 'M4 12h.01M12 12h.01M20 12h.01', open: 'M14 4h6v6M20 4 10 14M10 4H4v16h16v-6',
        preview: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
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
    const preview = button('search-icon-button search-preview', 'preview');
    const more = button('search-icon-button search-more', 'more'), contextMenu = element('div', 'search-context-menu');
    contextMenu.id = prefix + '-actions'; contextMenu.hidden = true; contextMenu.setAttribute('role', 'menu');
    more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-controls', contextMenu.id); more.setAttribute('aria-expanded', 'false');
    const menuItems = ['open', 'reveal', 'send', 'preview'].map(action => {
      const item = button('search-context-action', action), copy = element('span'); item.append(copy); item.dataset.searchAction = action;
      item.setAttribute('role', 'menuitem'); item.tabIndex = -1; contextMenu.append(item); return {action, item, copy};
    });
    const reindex = button('search-icon-button search-reindex', 'refresh'), reindexLabel = element('span'); reindex.append(reindexLabel);
    const announcer = element('span', 'search-sr'); announcer.id = prefix + '-status'; announcer.setAttribute('role', 'status'); announcer.setAttribute('aria-live', 'polite'); announcer.setAttribute('aria-atomic', 'true');
    input.setAttribute('aria-describedby', announcer.id);
    actions.append(preview, reveal, send, more, openButton); footer.append(information, reindex, actions);
    host.classList.add('notchy-search'); host.hidden = true; host.replaceChildren(heading, body, footer, announcer, contextMenu);
    host.setAttribute('aria-label', label('Recherche locale'));

    function cancelInputFocus() {cancelFocus?.(); cancelFocus = null;}
    function focusInput() {
      cancelInputFocus(); input.focus({preventScroll: true});
      // The shell or native WebView may become focusable just after onOpen.
      // One paint retry handles that hand-off without polling or stealing focus
      // from a result/action the user has deliberately reached in the meantime.
      const retry = () => {cancelFocus = null; if (opened && !disposed && !host.contains(document.activeElement)) input.focus({preventScroll: true});};
      if (typeof view?.requestAnimationFrame === 'function') {const frame = view.requestAnimationFrame(retry); cancelFocus = () => view.cancelAnimationFrame(frame);}
      else {const timer = setTimeout(retry, 0); cancelFocus = () => clearTimeout(timer);}
    }
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
      more.setAttribute('aria-label', label('Autres actions')); more.title = label('Autres actions') + ' · Shift+F10';
      openButton.textContent = label(acting ? 'Ouverture…' : 'Ouvrir'); openButton.title = label('Entrée');
      send.hidden = typeof onSend !== 'function' || hits[selected]?.kind !== 'file';
      for (const control of [openButton, preview, reveal, send, more]) control.disabled = acting || loading || !hits[selected];
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
      const previousId = hits[selected]?.id;
      selected = hits.length ? Math.max(0, Math.min(index, hits.length - 1)) : -1;
      if (hits[selected]?.id !== previousId) previewVersion++;
      for (let position = 0; position < list.children.length; position++) list.children[position].setAttribute('aria-selected', String(position === selected));
      if (selected >= 0) {
        const row = list.children[selected]; input.setAttribute('aria-activedescendant', row.id);
        if (scroll) row.scrollIntoView?.({block: 'nearest'});
      } else input.removeAttribute('aria-activedescendant');
      send.hidden = typeof onSend !== 'function' || hits[selected]?.kind !== 'file';
      openButton.hidden = !canOpen(hits[selected]);
      reveal.title = label('Afficher dans l’Explorateur') + ' · ' + (canOpen(hits[selected]) ? 'Ctrl+' : '') + label('Entrée');
      const previewLabel = label(previewing ? 'Fermer l’aperçu' : quickLook.available ? 'Aperçu QuickLook' : 'Obtenir QuickLook');
      preview.hidden = !quickLook.supported;
      preview.setAttribute('aria-label', previewLabel); preview.title = previewLabel + ' · Space';
      preview.setAttribute('aria-keyshortcuts', 'Space Alt+p'); preview.setAttribute('aria-pressed', String(previewing));
      preview.setAttribute('aria-busy', String(!!previewFlight));
      contextMenu.setAttribute('aria-label', label('Actions pour {name}', {name: hits[selected]?.name || ''}));
      for (const {action, item, copy} of menuItems) {
        copy.textContent = action === 'preview' ? previewLabel : label(action === 'open' ? 'Ouvrir' : action === 'reveal' ? 'Afficher dans l’Explorateur' : 'Envoyer via LocalSend');
        item.hidden = action === 'preview' ? !quickLook.supported : action === 'open' ? !canOpen(hits[selected]) : action === 'send' && (hits[selected]?.kind !== 'file' || typeof onSend !== 'function');
      }
      if (previewing) void syncPreview();
    }

    function focusResult() {list.children[selected]?.focus({preventScroll: true});}
    function syncPreview() {
      if (previewFlight) return previewFlight;
      const target = () => opened && !disposed && previewing ? hits[selected]?.id || null : null;
      if (target() === previewSent) return Promise.resolve();
      previewFlight = (async () => {
        while (target() !== previewSent) {
          const id = target();
          await invoke(id ? 'search_preview' : 'search_preview_close', id ? {id} : {});
          previewSent = id;
          previewVersion++;
        }
      })().catch(async () => {
        previewing = false; previewVersion++;
        if (previewSent !== null) {try {await invoke('search_preview_close', {});} catch (_) {}}
        previewSent = null;
        if (opened && !disposed) error = 'Impossible de lancer l’aperçu QuickLook.';
      }).finally(() => {previewFlight = null; if (opened && !disposed) render();});
      return previewFlight;
    }
    function stopPreview() {previewing = false; previewVersion++; void syncPreview();}
    function togglePreview() {
      if (!quickLook.supported || !hits[selected] || loading || acting) return;
      closeMenu();
      if (!quickLook.available) {void activate('preview'); return;}
      error = ''; previewing = !previewing; previewVersion++; focusResult(); void syncPreview(); render();
    }
    function results(value) {
      const menuHadFocus = contextMenu.contains(document.activeElement); closeMenu();
      if (menuHadFocus && opened) input.focus({preventScroll: true});
      const previousId = hits[selected]?.id;
      hits = normalizeHits(value); selected = hits.length ? 0 : -1; list.replaceChildren();
      if (hits[selected]?.id !== previousId) previewVersion++;
      for (const hit of hits) {
        const row = button('search-result'), glyph = element('span', 'search-result-icon'), copy = element('span', 'search-result-copy');
        row.id = prefix + '-result-' + list.children.length; row.tabIndex = -1; row.setAttribute('role', 'option'); row.dataset.resultId = hit.id;
        row.setAttribute('aria-label', hit.name + ', ' + label(hit.kind === 'folder' ? 'Dossier' : 'Fichier') + ', ' + hit.path);
        const name = element('span', 'search-result-name'), path = element('span', 'search-result-path');
        for (const [node, value] of [[name, hit.name], [path, hit.path]]) for (const part of highlightParts(value, input.value)) {const span = element(part.matched ? 'mark' : 'span'); span.textContent = part.text; node.append(span);}
        row.setAttribute('aria-haspopup', 'menu'); row.setAttribute('aria-controls', contextMenu.id);
        path.title = hit.path; glyph.append(icon(hit.kind)); copy.append(name, path); row.append(glyph, copy); list.append(row);
      }
    }
    function closeMenu(restoreFocus = false) {
      if (contextMenu.hidden) return;
      contextMenu.hidden = true; more.setAttribute('aria-expanded', 'false');
      for (const row of list.children) row.setAttribute('aria-expanded', 'false');
      if (restoreFocus && opened) (menuOpener?.isConnected !== false && host.contains(menuOpener) ? menuOpener : input).focus({preventScroll: true});
      menuOpener = null;
    }
    function showMenu(index = selected, point = null, anchor = null) {
      if (!opened || disposed || acting || loading || !hits[index]) return;
      closeMenu(); select(index, false);
      menuOpener = anchor || (host.contains(document.activeElement) ? document.activeElement : input);
      contextMenu.hidden = false; more.setAttribute('aria-expanded', 'true'); list.children[selected]?.setAttribute('aria-expanded', 'true');
      const bounds = host.getBoundingClientRect(), menuBounds = contextMenu.getBoundingClientRect(), row = (anchor || list.children[selected]).getBoundingClientRect();
      const scale = bounds.width / host.offsetWidth || 1;
      const x = point?.x ?? row.left, y = point?.y ?? row.bottom, inset = CONFIG.menuInset;
      contextMenu.style.left = Math.max(inset, Math.min((x - bounds.left) / scale, (bounds.width - menuBounds.width) / scale - inset)) + 'px';
      contextMenu.style.top = Math.max(inset, Math.min((y - bounds.top) / scale, (bounds.height - menuBounds.height) / scale - inset)) + 'px';
      menuItems.find(({item}) => !item.hidden)?.item.focus({preventScroll: true});
    }
    function readStatus(value, previewRequest) {
      if (!value || typeof value !== 'object') return;
      if (value.quickLook && typeof value.quickLook === 'object') quickLook = {supported: value.quickLook.supported === true, available: value.quickLook.available === true};
      // A reply sampled before a toggle, selection or completed Invoke/Close
      // cannot describe the current viewer, even after its flight has settled.
      if (previewRequest === previewVersion && previewing && !previewFlight && value.quickLook?.previewVisible === false) {previewing = false; previewSent = null; previewVersion++;}
      if (quickLook.available && error === 'QuickLook est nécessaire pour afficher un aperçu. Installe-le, puis reviens dans Notchy.') error = '';
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
      const previewRequest = previewVersion;
      try {
        const value = await invoke('search_query', {q, limit: CONFIG.limit});
        if (!opened || disposed || current !== generation) return;
        if (!value || !Array.isArray(value.hits)) throw new Error('Invalid search response');
        readStatus(value, previewRequest); results(value.hits);
      } catch (_) {if (!opened || disposed || current !== generation) return; error = 'La recherche est indisponible.';}
      finally {if (opened && !disposed && current === generation) {loading = false; render();}}
    }
    async function refreshStatus() {
      if (!opened || disposed) return;
      clearTimeout(poll); poll = null;
      const current = ++statusGeneration, wasIndexing = status.indexing, previewRequest = previewVersion;
      try {
        const value = await invoke('search_status', {});
        if (!opened || disposed || current !== statusGeneration) return;
        if (!value || typeof value.indexing !== 'boolean' || !Number.isSafeInteger(value.files)) throw new Error('Invalid search status');
        readStatus(value, previewRequest);
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
      const current = ++statusGeneration, previewRequest = previewVersion; input.focus({preventScroll: true}); reindexing = true; error = ''; render();
      try {
        const value = await invoke('search_reindex', {});
        if (!opened || disposed || current !== statusGeneration) return;
        if (!value || typeof value.indexing !== 'boolean' || !Number.isSafeInteger(value.files)) throw new Error('Invalid search status');
        generation++; clearTimeout(debounce); debounce = null; loading = false; results([]); readStatus(value, previewRequest);
        if (!status.indexing && input.value.trim().length >= CONFIG.minimumQuery) void query();
      } catch (_) {if (opened && !disposed && current === statusGeneration) error = 'La recherche est indisponible.';}
      finally {reindexing = false; if (opened && !disposed) render();}
    }
    function changed() {
      if (composing || disposed || !opened) return;
      stopPreview();
      generation++; clearTimeout(debounce); error = ''; loading = input.value.trim().length >= CONFIG.minimumQuery; results([]); render();
      if (loading) debounce = setTimeout(query, CONFIG.debounce);
    }
    async function activate(action = 'open') {
      const hit = hits[selected];
      if (!opened || disposed || acting || loading || !hit || action === 'send' && (hit.kind !== 'file' || typeof onSend !== 'function')) return;
      if (action === 'preview' && !quickLook.supported) return;
      if (action === 'preview' && quickLook.available) {togglePreview(); return;}
      if (action !== 'preview') stopPreview();
      if (action === 'open' && !canOpen(hit)) action = 'reveal';
      closeMenu(); const current = generation; input.focus({preventScroll: true}); acting = true; error = ''; render();
      try {
        if (action === 'send') await onSend(hit.id);
        else if (action === 'preview') {
          await invoke(quickLook.available ? 'search_preview' : 'search_quicklook_install', quickLook.available ? {id: hit.id} : {});
          if (opened && !disposed && current === generation && !quickLook.available) error = 'QuickLook est nécessaire pour afficher un aperçu. Installe-le, puis reviens dans Notchy.';
        }
        else await invoke(action === 'reveal' ? 'search_reveal' : 'search_open', {id: hit.id});
        if (action !== 'preview' && opened && !disposed && current === generation) close();
      } catch (_) {
        if (opened && !disposed && current === generation) {error = action === 'preview' ? 'Impossible de lancer l’aperçu QuickLook.' : action === 'send' ? 'Impossible de préparer cet envoi.' : action === 'reveal' ? 'Impossible d’afficher cet élément.' : 'Impossible d’ouvrir cet élément.'; render();}
      } finally {acting = false; if (opened && !disposed) render();}
    }
    function key(event) {
      if (!opened || composing || event.isComposing) return;
      if (!contextMenu.hidden) {
        const visible = menuItems.filter(({item}) => !item.hidden).map(({item}) => item), current = visible.indexOf(document.activeElement);
        if (['Escape', 'Tab', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); event.stopImmediatePropagation();
          if (event.key === 'Escape' || event.key === 'Tab') closeMenu(true);
          else visible[event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : visible.length - 1)) % visible.length]?.focus({preventScroll: true});
        }
        return;
      }
      if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) {
        const row = event.target.closest?.('[data-result-id]');
        const index = row && list.contains(row) ? hits.findIndex(hit => hit.id === row.dataset.resultId) : selected;
        if (hits[index]) {event.preventDefault(); event.stopImmediatePropagation(); showMenu(index);}
        return;
      }
      if (event.key === 'Escape') {event.preventDefault(); event.stopImmediatePropagation(); if (previewing) {stopPreview(); focusResult(); render();} else close(); return;}
      if (event.key?.toLowerCase() === 'p' && event.altKey && !event.ctrlKey && !event.metaKey && !event.repeat && quickLook.supported) {
        event.preventDefault(); event.stopImmediatePropagation(); void activate('preview'); return;
      }
      const row = event.target.closest?.('[data-result-id]'), inResults = !!row && list.contains(row);
      if (inResults && (event.key === ' ' || event.code === 'Space') && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) togglePreview(); return;
      }
      if (event.target !== input && !inResults) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || inResults && previewing && ['ArrowLeft','ArrowRight'].includes(event.key)) {
        event.preventDefault(); if (!hits.length) return;
        const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
        select(quickLook.supported ? selected + step : (selected + (step > 0 ? 1 : hits.length - 1)) % hits.length);
        if (quickLook.supported) focusResult();
      } else if (event.key === 'Enter') {event.preventDefault(); void activate(event.ctrlKey || event.metaKey ? 'reveal' : 'open');}
      else if (inResults && !event.ctrlKey && !event.metaKey && !event.altKey && (event.key?.length === 1 || event.key === 'Backspace')) {
        event.preventDefault(); input.focus({preventScroll:true});
        input.value = event.key === 'Backspace' ? [...input.value].slice(0,-1).join('') : input.value + event.key;
        changed();
      }
    }
    function open() {
      if (disposed) return false;
      if (!opened) {opener = document.activeElement; opened = true; host.hidden = false; onOpen?.(); refresh();}
      focusInput(); return true;
    }
    function close({restoreFocus = true, notify = true} = {}) {
      if (!opened || disposed) return false;
      stopPreview();
      closeMenu(); cancelInputFocus();
      opened = false; generation++; statusGeneration++; clearTimeout(debounce); clearTimeout(poll); debounce = poll = null;
      loading = false; host.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant');
      if (notify) onClose?.();
      if (restoreFocus && opener?.isConnected !== false && typeof opener?.focus === 'function') opener.focus({preventScroll: true});
      return true;
    }
    listen(input, 'input', changed); listen(input, 'compositionstart', () => {composing = true; generation++; clearTimeout(debounce); debounce = null; loading = false; results([]); render();});
    listen(input, 'compositionend', () => {composing = false; changed();}); listen(host, 'keydown', key);
    listen(clear, 'click', () => {input.value = ''; changed(); input.focus({preventScroll: true});}); listen(closeButton, 'click', () => close());
    listen(list, 'click', event => {const row = event.target.closest('[data-result-id]'); if (!row || !list.contains(row)) return; closeMenu(); select(hits.findIndex(hit => hit.id === row.dataset.resultId), false); if (quickLook.supported) focusResult(); else void activate();});
    listen(list, 'dblclick', event => {const row = event.target.closest('[data-result-id]'); if (!row || !list.contains(row)) return; select(hits.findIndex(hit => hit.id === row.dataset.resultId), false); void activate();});
    listen(list, 'pointermove', event => {if (!contextMenu.hidden || previewing || list.contains(document.activeElement)) return; const row = event.target.closest('[data-result-id]'); if (row && list.contains(row)) select(hits.findIndex(hit => hit.id === row.dataset.resultId), false);});
    listen(list, 'contextmenu', event => {
      const row = event.target.closest('[data-result-id]'); if (!row || !list.contains(row)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      showMenu(hits.findIndex(hit => hit.id === row.dataset.resultId), {x: event.clientX, y: event.clientY});
    });
    listen(contextMenu, 'contextmenu', event => {event.preventDefault(); event.stopImmediatePropagation();});
    for (const {action, item} of menuItems) listen(item, 'click', event => {event.stopImmediatePropagation(); if (!item.hidden) void activate(action);});
    listen(more, 'click', () => contextMenu.hidden ? showMenu(selected, null, more) : closeMenu(true));
    listen(document, 'pointerdown', event => {cancelInputFocus(); if (!contextMenu.hidden && !contextMenu.contains(event.target) && event.target !== more && !more.contains(event.target)) closeMenu();});
    if (view) listen(view, 'focus', () => {if (opened && !disposed) {void refreshStatus(); if (!host.contains(document.activeElement)) focusInput();}});
    listen(host, 'pointerenter', () => {if (opened && previewing) void refreshStatus();});
    listen(view || host, 'resize', () => closeMenu(true));
    listen(list, 'scroll', () => closeMenu(true));
    listen(openButton, 'click', () => void activate()); listen(reveal, 'click', () => void activate('reveal')); listen(send, 'click', () => void activate('send'));
    listen(preview, 'click', togglePreview);
    listen(reindex, 'click', () => void rebuild());
    render();
    return Object.freeze({open, close, stopPreview, isOpen: () => opened, isPreviewing: () => previewing, render, refresh, elements: {input, clear, close: closeButton, list, empty, information, open: openButton, preview, reveal, send, more, contextMenu, reindex, announcer}, dispose() {
      if (disposed) return false; close({restoreFocus: false, notify: false}); disposed = true; for (const remove of listeners) remove(); emptyController?.dispose();
      host.replaceChildren(...previous); host.hidden = previousHidden; if (previousLabel === null) host.removeAttribute('aria-label'); else host.setAttribute('aria-label', previousLabel);
      delete host.dataset.status; if (!hadClass) host.classList.remove('notchy-search'); return true;
    }});
  }
  return Object.freeze({CONFIG, MESSAGES, normalizeHits, highlightParts, canOpen, create});
});
