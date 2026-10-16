(function () {
  'use strict';
  const runtime = window.NotchyModules;
  const elements = Object.fromEntries(['reading', 'water', 'import', 'file', 'export', 'clear', 'status', 'language', 'presentations', 'module', 'empty', 'layout', 'identity'].map(id => [id, document.getElementById(id)]));
  let storage;
  try { storage = window.localStorage; } catch (_) { elements.status.textContent = 'Browser storage is unavailable. Development state will last for this page only.'; }
  const store = runtime.createStore({ storage, key: 'notchy.module-lab.v2' });
  let savedId = null;
  try { savedId = storage?.getItem('notchy.module-lab.active'); } catch (_) { /* The in-memory library remains usable. */ }
  let activeId = store.get(savedId) ? savedId : store.list()[0]?.manifest.id || null, presentation = 'full';
  let dispose = null;
  function report(error) {
    elements.status.textContent = error instanceof Error ? error.message : 'The module could not be loaded.';
    elements.status.dataset.error = 'true';
  }
  function draw() {
    const entry = store.get(activeId), language = elements.language.value;
    elements.layout.dataset.presentation = presentation;
    elements.empty.hidden = !!entry; elements.module.hidden = !entry;
    elements.export.disabled = !entry; elements.clear.disabled = !entry;
    elements.identity.textContent = entry ? entry.manifest.name[language] + ' · ' + entry.manifest.version : 'Blank island';
    if (!entry) { if (dispose) dispose(); dispose = null; return; }
    dispose = runtime.render(elements.module, entry.manifest, entry.state, {
      presentation, language,
      onAction(action, value) { try { store.performAction(activeId, action, value); } catch (error) { report(error); } }
    });
  }
  function install(value) {
    try {
      const entry = store.install(value);
      activeId = entry.manifest.id;
      if (storage) storage.setItem('notchy.module-lab.active', activeId);
      draw();
      elements.status.textContent = entry.manifest.name.en + ' is ready. Its controls update real local state.';
      delete elements.status.dataset.error;
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
    if (!button || !['full', 'scene', 'rail'].includes(button.dataset.presentation)) return;
    presentation = button.dataset.presentation;
    for (const item of elements.presentations.querySelectorAll('button')) item.setAttribute('aria-pressed', String(item === button));
    draw();
  });
  elements.language.addEventListener('change', draw);
  elements.clear.addEventListener('click', () => {
    try {
      for (const entry of store.list()) store.remove(entry.manifest.id);
      activeId = null; draw();
      if (storage) storage.removeItem('notchy.module-lab.active');
      elements.status.textContent = 'The island is empty. Import your next idea.';
      delete elements.status.dataset.error;
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
