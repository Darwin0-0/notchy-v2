(function (root) {
  'use strict';
  function create({host, store, language = () => 'fr', onClose = () => {}, onPlace = () => {}, onBlank = () => {}, onDialog = () => {}}) {
    const document = host.ownerDocument, runtime = root.NotchyModules;
    let tab = 'discover', pending = null, removal = null, previewSize = 'scene', draft = '', open = false, locale = '', previewDispose = null, message = '', epoch = 0;
    const say = (fr, en) => language() === 'en' ? en : fr;
    const make = (tag, cls, text) => {const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node;};
    const button = (text, action, cls = '') => {const node = make('button', cls, text); node.type = 'button'; node.addEventListener('click', action); return node;};
    const status = make('p', 'module-library-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const file = make('input'); file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true;
    const head = make('header', 'module-library-header'), title = make('h2'), actions = make('div', 'module-library-header-actions');
    const importButton = button('', () => onDialog(file)), back = button('', onClose);
    actions.append(importButton, back); head.append(title, actions);
    const navigation = make('nav', 'module-library-tabs'), body = make('div', 'module-library-body'); navigation.setAttribute('aria-label', 'Modules');
    const tabs = new Map();
    for (const id of ['discover', 'installed', 'studio']) {const node = button('', () => {tab = id; pending = null; removal = null; message = ''; render();}); node.dataset.moduleLibraryTab = id; navigation.append(node); tabs.set(id, node);}
    host.replaceChildren(head, navigation, body, status, file); host.classList.add('module-library');
    function fail(error) {message = say('Impossible de continuer : ', 'Unable to continue: ') + String(error?.message || error).slice(0, 240); status.textContent = message;}
    let busy=false;
    async function attempt(action) {if(busy)return;busy=true;host.setAttribute('aria-busy','true');body.inert=navigation.inert=true;importButton.disabled=back.disabled=true;try {await action();} catch (error) {fail(error);} finally {busy=false;host.removeAttribute('aria-busy');body.inert=navigation.inert=false;importButton.disabled=back.disabled=false;}}
    function inspect(value) {pending = runtime.validateManifest(value); removal = null; message = ''; render(); body.querySelector('[data-module-confirm]')?.focus({preventScroll: true});}
    async function selected() {
      const selectedFile = file.files?.[0], ticket = ++epoch; onDialog(null); file.value = '';
      if (!selectedFile) return;
      try {
        if (selectedFile.size > runtime.limits.manifestBytes) throw new Error(say('Ce manifeste dépasse la limite autorisée.', 'This manifest is too large.'));
        const text = await selectedFile.text(); if (!open || ticket !== epoch) return;
        inspect(runtime.parseManifest(text));
      } catch (error) {if (open && ticket === epoch) fail(error);}
    }
    file.addEventListener('change', selected); file.addEventListener('cancel', () => onDialog(null));
    function preview(manifest, state) {
      const selector = make('div', 'module-library-sizes'); selector.setAttribute('aria-label', say('Taille de l’aperçu', 'Preview size'));
      for (const [size, fr, en] of [['full', 'Plein', 'Full'], ['scene', 'Principal', 'Main'], ['rail', 'Petit', 'Small']]) {
        const control = button(say(fr, en), () => {previewSize = size; render();}); control.setAttribute('aria-pressed', String(size === previewSize)); selector.append(control);
      }
      const frame = make('div', 'module-library-preview'); frame.dataset.size = previewSize;
      previewDispose = runtime.render(frame, manifest, state, {presentation: previewSize, language: language()}); body.append(selector, frame);
    }
    function card(entry, installed) {
      const manifest = installed ? entry.manifest : entry, item = make('article', 'module-library-card'); item.dataset.libraryModule = manifest.id;
      const copy = make('div', 'module-library-copy'); copy.append(make('h3', '', manifest.name[language()]), make('p', '', manifest.description[language()]));
      const controls = make('div', 'module-library-card-actions');
      if (installed) {
        controls.append(button(say('Placer dans Nook', 'Place in Nook'), () => onPlace(manifest.id)), button(say('Retirer', 'Remove'), () => {removal = manifest.id; render(); body.querySelector('button')?.focus({preventScroll:true});}));
      } else controls.append(button(store.get(manifest.id) ? say('Installé', 'Installed') : say('Découvrir', 'Preview'), () => inspect(manifest)));
      item.append(copy, controls); return item;
    }
    function render() {
      if (!open) return;
      locale = language(); previewDispose?.(); previewDispose = null; body.replaceChildren();
      title.textContent = say('Bibliothèque de modules', 'Module library'); importButton.textContent = say('Importer', 'Import'); back.textContent = say('Retour', 'Back');
      for (const [id, node] of tabs) {node.textContent = id === 'discover' ? say('Découvrir', 'Discover') : id === 'installed' ? say('Mes modules', 'My modules') : say('Atelier', 'Studio'); node.setAttribute('aria-current', id === tab ? 'page' : 'false');}
      status.textContent = message;
      if (removal) {
        const current = store.get(removal); if (!current) {removal = null; render(); return;}
        body.append(make('h3', '', say('Retirer ', 'Remove ') + current.manifest.name[language()] + ' ?'), make('p', '', say('Les données locales de ce module seront supprimées.', 'This module’s local data will be removed.')));
        body.append(button(say('Annuler', 'Cancel'), () => {if(busy)return;removal = null; render();tabs.get(tab)?.focus({preventScroll:true});}), button(say('Retirer le module', 'Remove module'), () => attempt(async () => {await store.remove(removal); removal = null; message = say('Module retiré.', 'Module removed.'); render();tabs.get(tab)?.focus({preventScroll:true});})));
        return;
      }
      if (pending) {
        const existing = store.get(pending.id), panel = make('div', 'module-library-review');
        panel.append(make('h3', '', pending.name[language()]), make('p', '', pending.description[language()]), make('p', 'module-library-access', say('Données locales uniquement · aucun accès au système ou au réseau.', 'Local data only · no system or network access.')));
        body.append(panel); preview(pending, existing?.state || runtime.normalizeState(pending, {}));
        const confirm = button(existing ? say('Mettre à jour', 'Update module') : say('Installer le module', 'Install module'), () => attempt(async () => {const id = pending.id; await store.install(pending); pending = null; tab = 'installed'; message = say('Module prêt à être placé dans Nook.', 'Module ready to place in Nook.'); render(); body.querySelector(`[data-library-module="${id}"] button`)?.focus({preventScroll: true});}), 'module-library-primary');
        confirm.dataset.moduleConfirm = ''; body.append(confirm, button(say('Annuler', 'Cancel'), () => {pending = null; render();tabs.get(tab)?.focus({preventScroll:true});})); return;
      }
      if (tab === 'discover') {
        body.append(make('p', 'module-library-intro', say('Des modules à essayer, puis à adapter. Vous pouvez aussi importer un manifeste partagé.', 'Try a module, then make it yours. You can also import a shared manifest.')));
        for (const manifest of runtime.catalog) body.append(card(manifest, false));
        body.append(make('p', 'module-library-caption', say('Cette sélection est incluse avec Notchy. Aucun catalogue en ligne n’est connecté.', 'This selection ships with Notchy. No online marketplace is connected.')));
      } else if (tab === 'installed') {
        const items = store.list(); if (!items.length) body.append(make('h3', '', say('Votre prochain module commence ici.', 'Your next module starts here.')), make('p', '', say('Choisissez un exemple ou importez votre fichier JSON.', 'Choose an example or import your JSON file.')));
        for (const entry of items) body.append(card(entry, true));
      } else {
        body.append(make('p', 'module-library-intro', say('Commencez sur une encoche vierge, avec un exemple modifiable. Les modules actuels utilisent un manifeste JSON, sans code exécutable.', 'Start with a blank island and an editable example. Current modules use a JSON manifest without executable code.')));
        const tools = make('div', 'module-library-studio-actions'); tools.append(button(say('Encoche vierge', 'Blank island'), onBlank), button(say('Charger un exemple', 'Load example'), () => {draft = JSON.stringify(runtime.catalog[0], null, 2); render();})); body.append(tools);
        const label = make('label', 'module-library-editor-label', say('Manifeste du module', 'Module manifest')), editor = make('textarea', 'module-library-json'); editor.value = draft; editor.spellcheck = false; editor.maxLength = runtime.limits.manifestBytes; editor.setAttribute('aria-label', label.textContent); editor.addEventListener('input', () => {draft = editor.value;}); label.append(editor); body.append(label);
        body.append(button(say('Valider et prévisualiser', 'Validate and preview'), () => attempt(() => inspect(runtime.parseManifest(draft)))));
      }
    }
    const unsubscribe = store.subscribe(() => {if (open && !pending && !removal) render();});
    const key = event => {if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); if(busy)return; if (pending || removal) {pending = null; removal = null; render(); importButton.focus();} else onClose();}};
    const context = event => {event.stopPropagation();};
    host.addEventListener('keydown', key); host.addEventListener('contextmenu', context);
    return {isOpen:()=>open, isBusy:()=>busy, show() {open = true; host.hidden = false; render(); back.focus({preventScroll: true});}, hide() {open = false; epoch++; previewDispose?.(); previewDispose = null; host.hidden = true;}, refresh() {if (open && locale !== language()) render();}, dispose() {unsubscribe(); previewDispose?.(); host.removeEventListener('keydown', key); host.removeEventListener('contextmenu', context); file.removeEventListener('change', selected); open = false; epoch++;}};
  }
  root.NotchyModuleLibrary = Object.freeze({create});
})(window);
