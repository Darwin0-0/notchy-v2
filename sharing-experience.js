(function (root, factory) {
  'use strict';
  const api = factory(typeof module === 'object' && module.exports ? require('./empty-states.js') : root?.NotchEmpty);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) root.NotchySharingExperience = api;
})(typeof window === 'object' ? window : null, function (Empty) {
  'use strict';
  const array = value => Array.isArray(value) ? value : [];
  const text = value => typeof value === 'string' ? value : '';
  const CAPABILITIES = ['canOcr', 'canConvert', 'canSend', 'canOpen', 'canDownload', 'canRemove', 'canPreview'];
  let instance = 0;
  const PATHS = {upload: 'M12 16V4M7 9l5-5 5 5M4 20h16', file: 'M6 3h8l4 4v14H6z', ocr: 'M3 7V5a2 2 0 0 1 2-2h2 M17 3h2a2 2 0 0 1 2 2v2 M21 17v2a2 2 0 0 1-2 2h-2 M7 21H5a2 2 0 0 1-2-2v-2 M7 12h10', convert: 'M4 7h15l-3-3 M20 17H5l3 3 M20 7v5 M4 17v-5', send: 'm22 2-7 20-4-9-9-4Z M22 2 11 13', open: 'M14 3h7v7 M10 14 21 3 M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5', download: 'M12 3v12 m-4-4 4 4 4-4 M5 15v5h14v-5', remove: 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7', star: 'm12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.3-5.7-3-5.7 3 1.1-6.3-4.5-4.4 6.3-.9Z', phone: 'M7 4.5a2.5 2.5 0 0 1 2.5-2.5h5A2.5 2.5 0 0 1 17 4.5v15a2.5 2.5 0 0 1-2.5 2.5h-5A2.5 2.5 0 0 1 7 19.5zM11 18h2', laptop: 'M6 5h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM2 20h20', check: 'm5 12 4 4L19 6', back: 'm14 6-6 6 6 6', cancel: 'm6 6 12 12 M18 6 6 18', retry: 'M21 12a9 9 0 1 1-3-6.7L21 8 M21 3v5h-5'};
  const REFERENCE_ICONS = {
    plus:'<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"></path>',
    upload:'<g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5M4 16v4h16v-4"></path></g>',
    file:'<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6z"></path></g>',
    phone:'<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2" width="10" height="20" rx="2.5"></rect><path d="M11 18h2"></path></g>',
    laptop:'<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="11" rx="2"></rect><path d="M2 20h20"></path></g>',
  };

  function normalizeSharingFiles(value) {
    const seen = new Set();
    return array(value).filter(item => item && text(item.id) && !seen.has(item.id) && seen.add(item.id)).map(item => ({id: item.id, name: text(item.name), size: Number.isSafeInteger(item.size) && item.size >= 0 ? item.size : null,
      ...Object.fromEntries(CAPABILITIES.map(key => [key, item[key] === true]))}));
  }
  function sharingDeviceList({peers, favorites} = {}) {
    const live = new Map(), saved = new Map();
    for (const peer of array(peers)) {
      const identity = text(peer?.identity) || text(peer?.id);
      if (peer && text(peer.id) && identity && !live.has(identity)) live.set(identity, {id: peer.id, identity, alias: text(peer.alias || peer.name), deviceType: text(peer.deviceType), online: peer.online !== false});
    }
    for (const favorite of array(favorites)) {
      const item = typeof favorite === 'string' ? {identity: favorite} : favorite;
      const identity = text(item?.identity) || text(item?.id);
      if (item && identity && !saved.has(identity)) saved.set(identity, {id: 'offline:' + identity, identity, alias: text(item.alias || item.name), deviceType: text(item.deviceType), online: false});
    }
    return [...saved].map(([identity, item]) => ({...item, ...live.get(identity), favorite: true})).concat([...live].filter(([identity]) => !saved.has(identity)).map(([, item]) => ({...item, favorite: false})));
  }
  function manualIPv4(value) {
    const address = text(value).trim(), segments = address.split(':'), parts = segments[0].split('.');
    if (segments.length > 2 || segments.length === 2 && (!/^[1-9]\d{0,4}$/.test(segments[1]) || Number(segments[1]) > 65535)) return null;
    if (parts.length !== 4 || parts.some(part => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) return null;
    const octets = parts.map(Number);
    const local = octets[0] === 10 || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31 || octets[0] === 192 && octets[1] === 168 || octets[0] === 169 && octets[1] === 254;
    if (!local) return null;
    return address;
  }
  function sharingSelection(files, selectedIds) {
    const selected = new Set(array(selectedIds).filter(id => typeof id === 'string'));
    return normalizeSharingFiles(files).filter(item => selected.has(item.id));
  }

  function create({host, t = value => value, onAction = () => {}, invoke = null, onGetQuickLook = null} = {}) {
    if (!host?.ownerDocument) throw new TypeError('A sharing host is required.');
    const document = host.ownerDocument;
    let disposed = false, state = {}, files = [], devices = [], selected = [], dragDepth = 0, ipOpen = false, ipError = '', searching = false, searchTimer = null;
    let onlineBefore = null, transferBefore = '', networkReaction = null, reactionTimer = null, networkState = 'idle';
    let activeFile = null, previewing = false, previewSent = null, previewFlight = null, previewRequest = null, previewStatus = null, previewVersion = 0, previewError = '', previewTimer = null, previewNeedsQuickLook = false;
    const renderedFile = id => /\.html?$/i.test(files.find(item => item.id === id)?.name || '');
    const fileRows = new Map(), deviceRows = new Map();
    const say = (source, values = {}) => String(t(source, values) ?? source).replace(/\{(\w+)\}/g, (match, key) => Object.hasOwn(values, key) ? String(values[key]) : match);
    const make = (tag, className, value) => {const node = document.createElement(tag); if (className) node.className = className; if (value !== undefined) node.textContent = value; return node;};
    const put = (node, value) => {if (node.textContent !== value) node.textContent = value;};
    const place = (parent, node, index) => {if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] || null);};
    function icon(name) {const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false'); if (REFERENCE_ICONS[name]) svg.innerHTML = REFERENCE_ICONS[name]; else {const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', PATHS[name] || PATHS.file); svg.append(path);} return svg;}
    function button(className, command, label, glyph) {const node = make('button', className); node.type = 'button'; node.dataset.sharingCommand = command; if (glyph) node.append(icon(glyph)); if (label) node.append(make('span', '', label)); return node;}
    const shelf = make('section', 'sharing-shelf'), shelfHeading = make('header', 'sharing-shelf-heading'), shelfTitle = make('h2', '', 'TRAY'), shelfBody = make('div', 'sharing-card-body'), drop = button('sharing-drop', 'add', '', 'upload'), dropTitle = make('strong'), shelfEmpty = make('div', 'sharing-drop sharing-drop-empty');
    drop.append(dropTitle);
    const fileList = make('div', 'sharing-files'), fileStatus = make('p', 'sharing-file-status'), shelfFooter = make('footer', 'sharing-shelf-footer'), count = make('span', 'sharing-file-count'), shelfHelp = make('span', 'sharing-file-summary'), selectAll = button('sharing-select-all', 'select-all'), selectedTools = make('span', 'sharing-selected-tools');
    const getQuickLook=button('sharing-pill sharing-secondary','get-quicklook');getQuickLook.hidden=true;
    fileStatus.setAttribute('role','status'); fileStatus.setAttribute('aria-live','polite'); fileStatus.hidden = true;
    fileList.setAttribute('role', 'list'); count.setAttribute('role', 'status'); count.setAttribute('aria-live', 'polite');
    const selectionButtons = new Map();
    for (const command of ['open', 'download', 'remove']) {const node = button('sharing-icon', command, '', command); node.dataset.sharingSelection = 'true'; selectedTools.append(node); selectionButtons.set(command, node);}
    shelfHeading.append(shelfTitle,count); shelfBody.append(drop,shelfEmpty,fileList); shelfFooter.append(shelfHelp,selectAll,selectedTools); shelf.append(shelfHeading,shelfBody,fileStatus,getQuickLook,shelfFooter);
    const nearby = make('section', 'sharing-nearby'), heading = make('header', 'sharing-nearby-heading'), title = make('h2', '', 'LOCALSEND'), readiness = make('span', 'sharing-readiness');
    heading.append(title, readiness);
    const nearbyBody = make('div', 'sharing-card-body'), deviceList = make('div', 'sharing-devices'); deviceList.setAttribute('role', 'list');
    const empty = make('div', 'sharing-device-empty'), emptyActions = make('div', 'sharing-empty-actions'), retry = button('sharing-pill sharing-secondary', 'discover', '', 'retry'), retryLabel = make('span'); retry.append(retryLabel);
    const search = make('div','sharing-search'), searchTitle = make('strong'), searchHint = make('p');
    search.append(searchTitle,searchHint);
    const transfer = make('div', 'sharing-transfer'), transferOpen = button('sharing-transfer-open', 'open-transfer'), transferLabel = make('strong'), transferDetail = make('span'), transferProgress = make('div', 'sharing-transfer-progress'), transferFill = make('span'), transferCancel = button('sharing-icon', 'cancel', '', 'cancel');
    transferOpen.append(transferLabel, transferDetail); transferProgress.append(transferFill); transferProgress.setAttribute('role', 'progressbar'); transferProgress.setAttribute('aria-valuemin', '0'); transferProgress.setAttribute('aria-valuemax', '100'); transfer.append(transferOpen, transferProgress, transferCancel);
    const nearbyFooter = make('footer', 'sharing-nearby-footer'), help = make('span'), manual = button('sharing-manual', 'manual-ip', '+ IP'), stopSearch = button('sharing-pill sharing-secondary','stop'), deviceSummary = make('p','sharing-device-summary'), status = make('p', 'sharing-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); nearbyFooter.append(help,stopSearch,manual);
    const form = make('form', 'sharing-ip-form'), formHeading = make('header'), formTitle = make('strong'), formBack = button('sharing-icon', 'close-ip', '', 'back'), inputLabel = make('label'), address = make('input', 'sharing-ip-input'), formMessage = make('p', 'sharing-ip-message'), formSubmit = button('sharing-pill', 'connect');
    form.noValidate = true; formSubmit.type = 'submit'; address.type = 'text'; address.inputMode = 'decimal'; address.autocomplete = 'off'; address.spellcheck = false; address.maxLength = 21; address.placeholder = '192.168.1.20'; address.name = 'address'; formMessage.id = 'sharing-ip-message-' + ++instance; address.setAttribute('aria-describedby', formMessage.id); address.setAttribute('aria-invalid', 'false');
    inputLabel.append(make('span'), address); formHeading.append(formTitle, formBack); form.append(formHeading, inputLabel, formMessage, formSubmit); form.hidden = true;
    nearbyBody.append(deviceList,deviceSummary,empty,search,transfer); nearby.append(heading,nearbyBody,status,nearbyFooter,form); host.classList.add('sharing-experience'); host.replaceChildren(shelf, nearby);
    const emptyAction = event => {event.stopPropagation?.(); command(event);};
    const shelfEmptyView = Empty.show(shelfEmpty, {icon:icon('upload'),character:'idle',variant:'shelf',onAction:emptyAction}), deviceEmptyView = Empty.show(empty, {icon:icon('laptop'),character:'idle',variant:'sharing',onAction:emptyAction});
    const networkCharacter = deviceEmptyView.elements.icon, networkRings = [];
    for (let index=0;index<3;index++) {const ring=make('span','sharing-mimo-ring'); ring.setAttribute('aria-hidden','true'); networkCharacter.append(ring); networkRings.push(ring);}
    shelfEmptyView.elements.action.classList.add('sharing-drop-cta'); shelfEmptyView.elements.hint.classList.add('sharing-drop-detail'); shelfEmptyView.elements.action.dataset.sharingCommand = 'add';
    const emptyIp = deviceEmptyView.elements.action; emptyIp.classList.add('sharing-pill'); emptyIp.dataset.sharingCommand = 'manual-ip'; emptyActions.append(emptyIp,retry); empty.append(emptyActions);
    const motionQuery = document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
    function syncRadarMotion() {
      const active = !disposed && !host.hidden && !host.closest?.('[hidden],[inert]') && !document.hidden && document.body?.dataset.motion !== 'false' && !motionQuery?.matches;
      for (const ring of networkRings) ring.style.animationPlayState = active ? 'running' : 'paused';
    }
    const Observer = document.defaultView?.MutationObserver, motionObserver = Observer ? new Observer(syncRadarMotion) : null;
    motionObserver?.observe(document.body,{attributes:true,attributeFilter:['data-motion']});
    for (let ancestor=host;ancestor;ancestor=ancestor.parentElement) motionObserver?.observe(ancestor,{attributes:true,attributeFilter:['hidden','inert']});
    motionQuery?.addEventListener?.('change',syncRadarMotion); document.addEventListener?.('visibilitychange',syncRadarMotion);
    function reactNetwork(reaction) {
      clearTimeout(reactionTimer); networkReaction = reaction;
      reactionTimer = setTimeout(()=>{reactionTimer=null; networkReaction=null; render();},2000); reactionTimer.unref?.();
    }
    function endSearch() {searching = false; clearTimeout(searchTimer); searchTimer = null;}
    function beginSearch() {
      endSearch(); searching = true; state = {...state,status:''};
      // This bounded visual scan does not stop the network listener or claim
      // that discovery is complete. Incoming transfers remain available.
      searchTimer = setTimeout(()=>{endSearch(); render();},6000); searchTimer.unref?.(); render();
    }
    function toolLabel(command) {return say({open: 'Ouvrir', ocr: 'Extraire le texte', convert: 'Convertir', send: 'Envoyer', remove: 'Retirer', download: 'Télécharger', cancel: 'Annuler le transfert'}[command] || command);}
    function render(next = {}) {
      if (disposed) return;
      state = {...state, ...next}; files = normalizeSharingFiles(state.files); devices = sharingDeviceList(state); selected = sharingSelection(files, state.selectedIds);
      const focused = host.contains(document.activeElement) ? document.activeElement : null, busy = state.busy === true, chosen = new Set(selected.map(item => item.id));
      const currentIds = new Set(files.map(item => item.id));
      if (!currentIds.has(activeFile)) activeFile = selected.at(-1)?.id || null;
      if (previewing && (!chosen.has(activeFile) || !files.find(item => item.id === activeFile)?.canPreview)) stopPreview();
      for (const [id, row] of fileRows) if (!currentIds.has(id)) {row.row.remove(); fileRows.delete(id);}
      for (const [index, item] of files.entries()) {
        let row = fileRows.get(item.id);
        if (!row) {
          const node = make('div', 'sharing-file-row'), select = button('sharing-file-select', 'select'), glyph = make('span','sharing-file-glyph'), name = make('span', 'sharing-file-name'), size = make('span','sharing-file-size'), tick = make('span', 'sharing-file-tick'), actions = make('span', 'sharing-file-actions'), tools = new Map();
          glyph.append(icon('file')); node.setAttribute('role', 'listitem'); select.dataset.sharingFile = item.id; select.append(glyph,name,size,tick); tick.append(icon('check')); tick.setAttribute('aria-hidden', 'true');
          for (const command of ['ocr', 'convert', 'send']) {const node = button('sharing-icon', command, '', command); node.dataset.sharingFile = item.id; tools.set(command, node); actions.append(node);}
          node.append(select, actions); row = {row: node, select, name, size, tick, actions, tools}; fileRows.set(item.id, row);
          node.classList.add('experience-new-row'); node.style.setProperty('--entry-index', String(index));
        }
        row.name.textContent = item.name; row.name.title = previewing ? '' : item.name; row.select.setAttribute('aria-label', say('Sélectionner {file}', {file: item.name})); row.select.setAttribute('aria-pressed', String(chosen.has(item.id))); row.select.disabled = busy; row.row.dataset.selected = String(chosen.has(item.id));
        row.select.title = previewing ? '' : typeof invoke === 'function' && item.canPreview ? say('Espace pour l’aperçu · flèches pour parcourir') : item.name;
        if (typeof invoke === 'function' && item.canPreview) row.select.setAttribute('aria-keyshortcuts', 'Space ArrowUp ArrowDown ArrowLeft ArrowRight');
        else row.select.removeAttribute('aria-keyshortcuts');
        const extension = item.name.split('.').at(-1).toLowerCase(); row.row.dataset.tone = /^(pdf|pptx?|docx?)$/.test(extension) ? 'red' : /^(jpe?g|heic|gif)$/.test(extension) ? 'orange' : /^(png|webp|svg)$/.test(extension) ? 'mint' : 'blue';
        row.size.textContent = item.size === null ? '—' : item.size < 1048576 ? Math.ceil(item.size / 1024)+' '+say('Ko') : new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(item.size / 1048576)+' '+say('Mo');
        for (const [command, node] of row.tools) {node.hidden = item['can' + command[0].toUpperCase() + command.slice(1)] !== true; node.disabled = busy; node.setAttribute('aria-label', toolLabel(command) + ' · ' + item.name); node.title = toolLabel(command);}
        place(fileList, row.row, index);
      }
      shelf.dataset.empty = String(!files.length); fileList.hidden = !files.length; drop.disabled = busy; drop.hidden = !files.length; shelfEmpty.hidden = !!files.length;
      dropTitle.textContent = say('Dépose ici'); shelfEmptyView.update({title:say('Dépose un fichier ici'),hint:say('Garde tes fichiers à portée de main, prêts à envoyer.'),actionLabel:say('Choisir un fichier')}); shelfEmptyView.elements.action.disabled = busy;
      if (shelfEmptyView.elements.action.firstChild?.localName !== 'svg') shelfEmptyView.elements.action.insertBefore(icon('upload'),shelfEmptyView.elements.action.firstChild || null);
      put(count, say(files.length === 1 ? '{count} fichier gardé' : '{count} fichiers gardés', {count: files.length}));
      put(shelfHelp,selected.length ? say('{count} sélectionné(s)',{count:selected.length}) : say('Tous tes fichiers à portée de main'));
      selectAll.hidden = !files.length; selectAll.disabled = busy; selectAll.textContent = say('Tout'); selectAll.setAttribute('aria-label', say(selected.length === files.length ? 'Tout désélectionner' : 'Tout sélectionner')); selectAll.setAttribute('aria-pressed', String(files.length > 0 && selected.length === files.length));
      for (const [command, node] of selectionButtons) {const capability = 'can' + command[0].toUpperCase() + command.slice(1); node.hidden = !selected.length || command === 'open' && selected.length !== 1 || !selected.every(item => item[capability]); node.disabled = busy; node.setAttribute('aria-label', toolLabel(command)); node.title = toolLabel(command);}
      selectedTools.hidden = !selected.length;
      const fileMessage = previewError || (typeof state.fileStatus === 'string' ? state.fileStatus : text(state.fileStatus?.message || state.fileStatus?.error));
      put(fileStatus,fileMessage); fileStatus.hidden = !fileMessage; fileStatus.dataset.error = String(!!previewError || !!state.fileStatus?.error || state.fileStatus?.kind === 'error');
      getQuickLook.hidden=!previewError||!previewNeedsQuickLook||typeof onGetQuickLook!=='function';getQuickLook.textContent=say('QuickLook dans le Market');getQuickLook.disabled=busy;
      const peerIds = new Set(devices.map(peer => peer.identity));
      for (const [id, row] of deviceRows) if (!peerIds.has(id)) {row.row.remove(); deviceRows.delete(id);}
      for (const [index, peer] of devices.entries()) {
        let row = deviceRows.get(peer.identity);
        if (!row) {
          const node = make('div', 'sharing-device-row'), send = button('sharing-device-send', 'send'), glyph = make('span', 'sharing-device-glyph'), copy = make('span', 'sharing-device-copy'), label = make('strong'), detail = make('span'), action = make('span','sharing-device-action'), favorite = button('sharing-favorite', 'favorite', '', 'star');
          node.setAttribute('role', 'listitem'); copy.append(label, detail); send.append(glyph, copy, action); node.append(send, favorite); row = {row: node, send, glyph, label, detail, action, favorite}; deviceRows.set(peer.identity, row);
          node.classList.add('experience-new-row'); node.style.setProperty('--entry-index', String(index));
        }
        row.send.dataset.sharingPeer = peer.id; row.favorite.dataset.sharingPeer = peer.id;
        const label = peer.alias || say('Appareil favori'); row.label.textContent = label; row.label.title = label; row.detail.textContent = say(peer.online ? 'Même réseau' : 'Hors ligne'); row.detail.hidden = false; row.action.textContent = say('Envoyer');
        const sendFiles = selected.length ? selected : files;
        row.glyph.replaceChildren(icon(peer.deviceType === 'mobile' ? 'phone' : 'laptop')); row.row.dataset.online = String(peer.online); row.send.disabled = busy || !peer.online || state.available === false || !sendFiles.length || !sendFiles.every(item => item.canSend);
        row.send.setAttribute('aria-label', say('Envoyer à {device}', {device: label}) + (!peer.online ? ' · ' + say('Hors ligne') : '')); row.favorite.setAttribute('aria-pressed', String(peer.favorite)); row.favorite.setAttribute('aria-label', say(peer.favorite ? 'Retirer {device} des favoris' : 'Ajouter {device} aux favoris', {device: label})); row.favorite.disabled = busy;
        place(deviceList, row.row, index);
      }
      const activeTransfer = state.transfer && ['preparing', 'waiting', 'sending', 'receiving'].includes(state.transfer.status), pending = !!state.incoming;
      const online = devices.filter(peer=>peer.online);
      const onlineNow = new Set(online.map(peer=>peer.identity)), transferKey = state.transfer ? state.transfer.id + ':' + state.transfer.status : '';
      if (onlineBefore && online.some(peer=>!onlineBefore.has(peer.identity))) reactNetwork('finished');
      if (onlineBefore && transferKey !== transferBefore && state.transfer?.status === 'complete') reactNetwork(state.transfer.direction === 'receive' ? 'received' : 'finished');
      onlineBefore = onlineNow; transferBefore = transferKey;
      if (online.length || activeTransfer || pending || state.status?.error || state.status?.kind === 'error') endSearch();
      nearby.dataset.state = pending ? 'consent' : activeTransfer ? 'transfer' : searching ? 'searching' : devices.length ? 'found' : 'idle';
      transfer.hidden = !activeTransfer && !pending; search.hidden = !searching || activeTransfer || pending; deviceList.hidden = !devices.length || searching || activeTransfer || pending; empty.hidden = !!devices.length || searching || activeTransfer || pending;
      const sendCount = selected.length || files.length;
      deviceSummary.hidden = deviceList.hidden; deviceSummary.textContent = say(online.length === 1 ? '{count} appareil trouvé' : '{count} appareils trouvés',{count:online.length})+' · '+say(sendCount === 1 ? '{count} fichier prêt à envoyer' : '{count} fichiers prêts à envoyer',{count:sendCount});
      if (!transfer.hidden) {
        const current = pending ? state.incoming : state.transfer, progress = Number.isFinite(current.progress) ? Math.min(100, Math.max(0, current.progress)) : null;
        transferLabel.textContent = say(pending ? 'Demande de partage' : current.status === 'waiting' ? 'En attente d’acceptation' : current.status === 'receiving' ? 'Réception…' : 'Envoi…'); transferDetail.textContent = text(current.alias) + (progress !== null ? ' · ' + Math.round(progress) + ' %' : '');
        transferProgress.hidden = progress === null || pending; transferFill.style.width = (progress || 0) + '%'; if (progress !== null) transferProgress.setAttribute('aria-valuenow', String(Math.round(progress))); else transferProgress.removeAttribute('aria-valuenow'); transferProgress.setAttribute('aria-label', say('Progression du transfert')); transferCancel.hidden = pending; transferCancel.disabled = busy; transferCancel.setAttribute('aria-label', toolLabel('cancel'));
      }
      readiness.textContent = searching ? say('Recherche') : online.length ? say('{count} trouvé(s)',{count:online.length}) : say(busy ? 'En cours…' : state.available === true ? 'Prêt' : 'Indisponible'); readiness.dataset.ready = String(state.available === true); readiness.dataset.searching = String(searching); nearby.setAttribute('aria-busy', String(busy || searching));
      searchTitle.textContent = say('Recherche d’appareils…'); searchHint.textContent = say('Même réseau Wi-Fi requis'); stopSearch.textContent = say('Annuler'); stopSearch.hidden = !searching; help.hidden = searching || devices.length > 0;
      if (devices.length) {if (retry.parentElement !== nearbyFooter) nearbyFooter.insertBefore(retry,manual);} else if (retry.parentElement !== emptyActions) emptyActions.append(retry);
      retry.hidden = searching || activeTransfer || pending;
      const networkError = !!ipError || !!state.status?.error || state.status?.kind === 'error' || state.transfer?.status === 'error';
      const reaction = networkError ? 'error' : pending ? 'share-request' : activeTransfer ? state.transfer.status === 'waiting' ? 'approval' : 'receiving' : searching ? 'searching' : ipOpen ? busy ? 'working' : 'question' : networkReaction || 'idle';
      networkState = reaction;
      deviceEmptyView.update({character:reaction,title:say('Aucun appareil à proximité'),hint:say('Même réseau Wi‑Fi requis, internet n’est pas nécessaire.'),actionLabel:say('Ajouter une IP')}); put(retryLabel,say('Réessayer')); retry.disabled = busy;
      // One shared character follows the actual flow instead of replaying a demo.
      const characterParent = ipOpen ? formHeading : searching ? search : !deviceList.hidden || !transfer.hidden ? title : empty;
      const characterBefore = characterParent === search ? searchTitle : characterParent === empty ? deviceEmptyView.elements.title : characterParent === formHeading ? formTitle : title.firstChild;
      if (networkCharacter.parentElement !== characterParent) characterParent.insertBefore(networkCharacter,characterBefore || null);
      networkCharacter.dataset.sharingPlacement = characterParent === search || characterParent === empty ? 'hero' : 'inline';
      if (emptyIp.firstChild?.localName !== 'svg') emptyIp.insertBefore(icon('plus'),emptyIp.firstChild || null);
      help.textContent = say('Sans internet : même Wi‑Fi'); manual.disabled = busy; emptyIp.disabled = busy;
      const message = typeof state.status === 'string' ? state.status : text(state.status?.message || state.status?.error);
      put(status, message); status.hidden = !message; status.dataset.error = String(!!state.status?.error || state.status?.kind === 'error');
      form.hidden = !ipOpen; formTitle.textContent = say('Ajouter une IP'); formBack.setAttribute('aria-label', say('Retour')); inputLabel.firstChild.textContent = say('Adresse réseau locale'); address.setAttribute('aria-label', say('Adresse réseau locale')); address.disabled = busy; address.setAttribute('aria-invalid', String(!!ipError));
      for (const layer of [heading, nearbyBody, nearbyFooter, status]) layer.inert = ipOpen;
      formMessage.textContent = ipError || message || say('Même réseau Wi‑Fi requis.'); formMessage.dataset.error = String(!!ipError || !!state.status?.error || state.status?.kind === 'error'); formSubmit.textContent = say(busy ? 'Connexion…' : 'Connecter'); formSubmit.disabled = busy;
      if (focused) {
        let visible = focused.isConnected && !focused.disabled;
        for (let ancestor = focused; ancestor && ancestor !== host; ancestor = ancestor.parentElement) if (ancestor.hidden || ancestor.inert) visible = false;
        const restore = visible ? focused : ipOpen ? formBack : files.length ? drop : shelfEmptyView.elements.action;
        if (!restore.disabled && document.activeElement !== restore) restore.focus({preventScroll: true});
      }
      syncRadarMotion();
      if (previewing) void syncPreview();
    }
    function syncPreview() {
      const target = () => !disposed && previewing && selected.some(item => item.id === activeFile) ? activeFile : null;
      if (previewFlight) {
        if (previewRequest?.id && target() !== previewRequest.id && !previewRequest.close) {
          previewRequest.cancelled = true; previewVersion++;
          // Do not leave Escape waiting behind a workbook conversion.
          previewRequest.close = (async () => {try {await invoke('shelf_preview_close', {});} catch (_) {}})();
        }
        return previewFlight;
      }
      if (target() === previewSent) return Promise.resolve();
      let renderedRequest = renderedFile(activeFile);
      previewFlight = (async () => {
        while (target() !== previewSent) {
          const id = target();
          const request = {id, cancelled: false, close: null}; previewRequest = request;
          if(id)renderedRequest=renderedFile(id);
          if(id&&typeof onGetQuickLook==='function'){
            let status;
            try {status=previewStatus||await invoke('search_status',{});}
            catch (error) {if (!request.cancelled && id === target()) throw error;if(request.close)await request.close;previewRequest=null;previewSent=null;continue;}
            if(request.cancelled||id!==target()){if(request.close)await request.close;previewRequest=null;previewSent=null;continue;}
            previewStatus=status;
            renderedRequest=status?.renderedPreview?.supported===true&&renderedFile(id);
            if(status?.quickLook?.available===false&&!renderedRequest){previewing=false;previewStatus=null;previewVersion++;clearInterval(previewTimer);previewTimer=null;previewRequest=null;await onGetQuickLook();continue;}
          }
          try {await invoke(id ? 'shelf_preview' : 'shelf_preview_close', id ? {id} : {});}
          catch (error) {if (!request.cancelled && id === target()) throw error;}
          if (request.close) await request.close;
          previewRequest = null;
          if (request.cancelled) {previewSent = null; continue;}
          previewSent = id; previewVersion++;
        }
      })().catch(async () => {
        previewing = false; previewStatus = null; previewVersion++; clearInterval(previewTimer); previewTimer = null;
        if (previewSent !== null) {try {await invoke('shelf_preview_close', {});} catch (_) {}}
        previewSent = null;
        if (!disposed) {previewNeedsQuickLook=!renderedRequest;previewError=say(renderedRequest?'Aperçu indisponible.':'Impossible de lancer l’aperçu QuickLook. Retrouve son module dans le Market.');}
      }).finally(() => {previewRequest = null; previewFlight = null; if (!disposed) render();});
      return previewFlight;
    }
    function stopPreview() {
      previewing = false; previewStatus = null; previewVersion++; clearInterval(previewTimer); previewTimer = null;
      void syncPreview();
    }
    async function refreshPreview() {
      if (!previewing || disposed || previewFlight) return;
      const version = previewVersion;
      try {
        const status = await invoke('search_status', {});
        if (!disposed && previewing && version === previewVersion) previewStatus = status;
        const rendered=status?.renderedPreview?.supported===true&&renderedFile(activeFile);
        if (!disposed && previewing && !previewFlight && version === previewVersion && (rendered?status?.renderedPreview?.visible===false:status?.quickLook?.previewVisible===false)) stopPreview();
      } catch (_) { /* A temporary status failure does not close an existing viewer. */ }
    }
    function togglePreview() {
      if (typeof invoke !== 'function' || state.busy || !selected.find(item => item.id === activeFile)?.canPreview) return false;
      previewError = ''; previewNeedsQuickLook=false; previewing = !previewing; previewVersion++;
      if (!previewing) previewStatus = null;
      clearInterval(previewTimer); previewTimer = null;
      if (previewing) {previewTimer = setInterval(refreshPreview, 1000); previewTimer.unref?.();}
      void syncPreview(); render(); return true;
    }
    function emit(command, payload = {}) {onAction(command, payload);}
    function command(event) {
      if (disposed) return;
      const target = event.target.closest?.('[data-sharing-command]'); if (!target || !host.contains(target) || target.disabled) return;
      const command = target.dataset.sharingCommand, id = target.dataset.sharingFile, peerId = target.dataset.sharingPeer;
      if(command==='get-quicklook'){if(previewNeedsQuickLook&&typeof onGetQuickLook==='function'){stopPreview();onGetQuickLook();}return;}
      if (command === 'connect') return;
      if (command === 'manual-ip' || command === 'close-ip') {ipOpen = command === 'manual-ip'; ipError = ''; render(); (ipOpen ? formBack : manual).focus({preventScroll: true}); return;}
      if (command === 'select' || command === 'select-all') {
        const chosen = new Set(selected.map(item => item.id));
        if (command === 'select' && files.some(file => file.id === id)) {activeFile = id; if (previewing) {chosen.clear(); chosen.add(id);} else if (chosen.has(id)) chosen.delete(id); else chosen.add(id);}
        else if (command === 'select-all') {chosen.clear(); if (selected.length !== files.length) for (const item of files) chosen.add(item.id);}
        else return;
        const selectedIds = files.filter(item => chosen.has(item.id)).map(item => item.id); render({selectedIds}); emit('select', {id: id || null, selected: !!id && chosen.has(id), selectedIds}); return;
      }
      if (command === 'favorite') {const peer = devices.find(item => item.id === peerId); if (peer) emit('favorite', {id: peer.id, identity: peer.identity, favorite: !peer.favorite, peer: {...peer}}); return;}
      if (['ocr', 'convert', 'send', 'open', 'download', 'remove'].includes(command)) {
        let chosen = id ? files.filter(item => item.id === id) : selected.length ? selected : files;
        const capability = 'can' + command[0].toUpperCase() + command.slice(1);
        const peer = peerId ? devices.find(item => item.id === peerId) : null;
        if (!chosen.length || !chosen.every(item => item[capability]) || peerId && (!peer?.online || state.available === false)) return;
        emit(command, {id: chosen.length === 1 ? chosen[0].id : null, ids: chosen.map(item => item.id), ...(peerId ? {peerId} : {})}); return;
      }
      if (command === 'cancel') {emit(command, {id: state.transfer?.id || null}); return;}
      if (command === 'stop') {endSearch(); render(); emit('stop'); return;}
      if (command === 'discover') beginSearch();
      if (command === 'add' || command === 'discover' || command === 'open-transfer') emit(command);
    }
    function submit(event) {
      event.preventDefault(); event.stopPropagation(); if (disposed || state.busy) return;
      const value = manualIPv4(address.value);
      if (!value) {ipError = say('Entre une adresse IP locale valide (ex. 192.168.1.20).'); render(); return;}
      ipError = ''; address.value = value; render(); emit('connect', {address: value});
    }
    function input() {if (ipError) {ipError = ''; render();}}
    function moveSelection(direction, focusRow = true) {
      if(![-1,1].includes(direction)||!files.length||state.busy)return false;
      const index=files.findIndex(item=>item.id===activeFile),next=files[Math.max(0,Math.min(files.length-1,index+direction))];
      activeFile=next.id;previewVersion++;render({selectedIds:[next.id]});emit('select',{id:next.id,selected:true,selectedIds:[next.id]});
      const row=fileRows.get(next.id);if(focusRow)row.select.focus({preventScroll:true});row.row.scrollIntoView?.({block:'nearest'});return true;
    }
    function keydown(event) {
      if (disposed || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (ipOpen) {if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); ipOpen = false; ipError = ''; render(); manual.focus({preventScroll: true});} return;}
      if (event.key === 'Escape' && previewing) {event.preventDefault(); event.stopPropagation(); stopPreview(); return;}
      const target = event.target?.closest?.('[data-sharing-command]'), id = target?.dataset.sharingFile;
      if (state.busy || target?.dataset.sharingCommand !== 'select' || !files.some(item => item.id === id)) return;
      activeFile = id;
      if (event.key === ' ' && event.repeat) {if (typeof invoke === 'function' && selected.find(item => item.id === id)?.canPreview) event.preventDefault(); return;}
      if (event.key === ' ' && togglePreview()) {event.preventDefault(); event.stopPropagation(); return;}
      const direction = {ArrowUp:-1, ArrowLeft:-1, ArrowDown:1, ArrowRight:1}[event.key];
      if (!direction) return;
      event.preventDefault(); event.stopPropagation();
      moveSelection(direction);
    }
    function isFileDrag(event) {return Array.from(event.dataTransfer?.types || []).includes('Files');}
    function enter(event) {if (!isFileDrag(event) || disposed || state.busy) return; dragDepth++; host.dataset.dragging = 'true';}
    function over(event) {if (!isFileDrag(event) || disposed) return; event.preventDefault(); event.stopPropagation(); if (event.dataTransfer) event.dataTransfer.dropEffect = state.busy ? 'none' : 'copy'; if (!state.busy) host.dataset.dragging = 'true';}
    function leave(event) {if (!isFileDrag(event)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) host.dataset.dragging = 'false';}
    function dropFiles(event) {if (!isFileDrag(event) || disposed) return; event.preventDefault(); event.stopPropagation(); dragDepth = 0; host.dataset.dragging = 'false'; const incomingFiles = Array.from(event.dataTransfer?.files || []); if (!state.busy && incomingFiles.length) emit('add', {files: incomingFiles});}
    const listeners = [['click', command], ['keydown', keydown], ['dragenter', enter], ['dragover', over], ['dragleave', leave], ['drop', dropFiles]];
    for (const [name, handler] of listeners) host.addEventListener(name, handler); form.addEventListener('submit', submit); address.addEventListener('input', input);
    return {render, stopPreview, inspect: () => ({searching,disposed,network:{state:networkState,placement:networkCharacter.dataset.sharingPlacement || 'hero',online:onlineBefore?.size || 0}}), previewTarget: () => previewing ? activeFile : null, navigatePreview: direction => previewing && moveSelection(direction, false), isPreviewing: () => previewing, dispose() {if (disposed) return; disposed = true; stopPreview(); endSearch(); clearTimeout(reactionTimer); reactionTimer=null; syncRadarMotion(); motionObserver?.disconnect(); motionQuery?.removeEventListener?.('change',syncRadarMotion); document.removeEventListener?.('visibilitychange',syncRadarMotion); shelfEmptyView.dispose(); deviceEmptyView.dispose(); for (const [name, handler] of listeners) host.removeEventListener(name, handler); form.removeEventListener('submit', submit); address.removeEventListener('input', input); fileRows.clear(); deviceRows.clear(); host.dataset.dragging = 'false';}};
  }
  return Object.freeze({normalizeSharingFiles, sharingDeviceList, manualIPv4, sharingSelection, create});
});
