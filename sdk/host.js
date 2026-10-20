(function () {
  'use strict';
  const runtime = window.NotchyModules;
  window.NotchyLayout.applyTokens(document.documentElement);
  const elements = Object.fromEntries(['reading', 'water', 'import', 'file', 'export', 'clear', 'status', 'language', 'presentations', 'dimensions', 'constraints', 'geometry', 'defaults', 'long-text', 'save-error', 'module', 'empty', 'layout', 'identity'].map(id => [id, document.getElementById(id)]));
  let storage;
  try { storage = window.localStorage; } catch (_) { elements.status.textContent = 'Browser storage is unavailable. Development state will last for this page only.'; }
  const adapter = { getItem: key => storage?.getItem(key) || null, setItem(key, value) {
    if (elements['save-error'].checked) { elements['save-error'].checked = false; throw new Error('Lab save failure. The previous committed state was kept. Try the action again.'); }
    storage?.setItem(key, value);
  } };
  const store = runtime.createStore({ storage: adapter, key: 'notchy.module-lab.v2' });
  let savedId = null;
  try { savedId = storage?.getItem('notchy.module-lab.active'); } catch (_) { /* The in-memory library remains usable. */ }
  let activeId = store.get(savedId) ? savedId : store.list()[0]?.manifest.id || null;
  let presentation = 'full', dimensions = 'ideal', dispose = null;
  function report(error) {
    elements.status.textContent = error instanceof Error ? error.message : 'The module could not be loaded.';
    elements.status.dataset.error = 'true';
  }
  function announce(message) { elements.status.textContent = message; delete elements.status.dataset.error; }
  function draw(resetDrafts = false) {
    const entry = store.get(activeId), language = elements.language.value;
    const contract = entry && runtime.getLayoutContract(entry.manifest);
    const supported = contract ? Object.keys(contract.layout) : [];
    if (entry && !supported.includes(presentation)) presentation = supported[0];
    for (const button of elements.presentations.querySelectorAll('button')) {
      button.disabled = !!entry && !supported.includes(button.dataset.presentation);
      button.setAttribute('aria-pressed', String(button.dataset.presentation === presentation));
      button.title = button.disabled ? 'This module does not support this presentation.' : '';
    }
    for (const button of elements.dimensions.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.dimensions === dimensions));
    elements.layout.dataset.presentation = presentation;
    elements.empty.hidden = !!entry; elements.module.hidden = !entry;
    for (const key of ['export', 'clear', 'defaults', 'long-text']) elements[key].disabled = !entry;
    elements['long-text'].disabled = !entry || !entry.manifest.fields.some(field => field.type === 'text');
    elements.identity.textContent = entry ? entry.manifest.name[language] + ' · ' + entry.manifest.version : 'Blank island';
    const view = contract?.layout[presentation];
    elements.constraints.textContent = view ? 'Supported: ' + supported.join(', ') + '. Legacy views are translated by the host.' : 'Choose a module to inspect its supported presentations.';
    elements.geometry.textContent = view ? 'Minimum ' + view.min.width + ' × ' + view.min.height + ' · ideal ' + view.ideal.width + ' × ' + view.ideal.height + ' logical px.' : '';
    if (!entry) {
      elements.layout.style.removeProperty('--lab-slot-width'); elements.layout.style.removeProperty('--lab-slot-height');
      if (dispose) dispose(); dispose = null; return;
    }
    const size = view[dimensions];
    elements.layout.style.setProperty('--lab-slot-width', size.width + 'px');
    elements.layout.style.setProperty('--lab-slot-height', size.height + 'px');
    dispose = runtime.render(elements.module, entry.manifest, entry.state, {
      presentation, language, resetDrafts: resetDrafts === true,
      onAction(action, value) {
        try { store.performAction(activeId, action, value); announce((storage ? 'Saved locally. ' : 'Kept for this page only. ') + 'Switching presentations preserves these values.'); }
        catch (error) { report(error); }
      }
    });
  }
  function install(value) {
    try {
      const entry = store.install(value); activeId = entry.manifest.id;
      try { storage?.setItem('notchy.module-lab.active', activeId); } catch (_) { /* Selection is optional; the module commit already succeeded. */ }
      draw(); announce(entry.manifest.name.en + ' is ready. Its controls update real development state.');
    } catch (error) { report(error); }
  }
  store.subscribe(draw);
  elements.reading.addEventListener('click', () => install(runtime.catalog[0]));
  elements.water.addEventListener('click', () => install(runtime.catalog[1]));
  elements.import.addEventListener('click', () => elements.file.click());
  elements.file.addEventListener('change', async () => {
    const file = elements.file.files[0]; elements.file.value = '';
    if (!file) return;
    if (file.size > runtime.limits.manifestBytes) { report(new Error('The manifest exceeds the import size limit.')); return; }
    try { install(await file.text()); } catch (error) { report(error); }
  });
  elements.presentations.addEventListener('click', event => {
    const button = event.target.closest('[data-presentation]');
    if (!button || button.disabled || !window.NotchyLayout.PRESENTATIONS.includes(button.dataset.presentation)) return;
    presentation = button.dataset.presentation; draw(); elements.module.scrollTop = 0;
  });
  elements.dimensions.addEventListener('click', event => {
    const button = event.target.closest('[data-dimensions]');
    if (!button || !['min', 'ideal'].includes(button.dataset.dimensions)) return;
    dimensions = button.dataset.dimensions; draw(); elements.module.scrollTop = 0;
  });
  elements.language.addEventListener('change', draw);
  elements.defaults.addEventListener('click', () => {
    const entry = store.get(activeId); if (!entry) return;
    try { store.updateState(activeId, Object.fromEntries(entry.manifest.fields.map(field => [field.id, field.default]))); draw(true); announce('Manifest defaults restored in this development library.'); }
    catch (error) { report(error); }
  });
  elements['long-text'].addEventListener('click', () => {
    const entry = store.get(activeId); if (!entry) return;
    try { store.updateState(activeId, Object.fromEntries(entry.manifest.fields.filter(field => field.type === 'text').map(field => [field.id, 'A long module title — '.repeat(30).slice(0, field.maxLength)]))); elements.module.scrollTop = 0; announce('Maximum-length text is ready. Check every supported presentation.'); }
    catch (error) { report(error); }
  });
  elements.clear.addEventListener('click', () => {
    try {
      for (const entry of store.list()) store.remove(entry.manifest.id);
      activeId = null; draw(); storage?.removeItem('notchy.module-lab.active');
      announce('The island is empty. Import your next idea.');
    } catch (error) { report(error); }
  });
  elements.export.addEventListener('click', () => {
    const entry = store.get(activeId); if (!entry) return;
    const blob = new Blob([JSON.stringify(entry.manifest, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = entry.manifest.id + '.manifest.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  draw();
})();
