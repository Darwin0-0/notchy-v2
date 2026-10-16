(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) {root.NotchyIA = api; api.prepare(root.document);}
})(typeof window === 'object' ? window : null, function () {
  'use strict';
  const PRIMARY = Object.freeze(['nook', 'tray', 'settings']);
  const TABS = Object.freeze(['general', 'modules', 'scenarios', 'health']);
  const LABELS = Object.freeze({general:'Général',modules:'Modules',scenarios:'Scénarios',health:'Santé'});
  async function invokeCore(name,args={}) {
    if (!['health_run','settings_get','settings_set','favorites_list','favorites_add','discovery_validate','discovery_scan','discovery_first_candidates'].includes(name)) throw new TypeError('Unknown native operation');
    const tauri=typeof window==='object'?window.__TAURI__:null;
    if (typeof tauri?.core?.invoke==='function') return tauri.core.invoke(name,args);
    if (typeof tauri?.invoke==='function') return tauri.invoke(name,args);
    return null;
  }
  function tabForRoute(view, editing = false) {
    return editing ? 'modules' : view === 'settings' ? 'general' : TABS.includes(view) ? view : null;
  }
  function prepare(document) {
    const menu = document.getElementById('notch-menu');
    if (!menu) return;
    for (const view of ['music','focus','tasks','weather','modules','scenarios','health']) {
      let button = menu.querySelector('[data-view="'+view+'"]');
      if (!button) {button=document.createElement('button'); button.type='button'; button.dataset.view=view; button.tabIndex=-1; button.setAttribute('aria-label',view); menu.append(button);}
      button.hidden=true;
    }
  }
  function create({document, t, onTab, onRoute, onScan, onNativeHealth}) {
    const settings=document.getElementById('settings-player'), menu=document.getElementById('notch-menu');
    const general=document.createElement('div'); general.id='ia-general'; general.className='ia-general';
    general.append(...settings.childNodes);
    const tabs=document.createElement('div'); tabs.className='ia-tabs'; tabs.setAttribute('role','tablist');
    const body=document.createElement('div'); body.className='ia-settings-body';
    const panels=new Map([['general',general],...['modules','scenarios','health'].map(id=>[id,document.getElementById(id+'-player')])]);
    const buttons=new Map();
    let disposed=false, active=null, healthEpoch=0, healthFlight=null;
    for (const id of TABS) {
      const button=document.createElement('button'); button.type='button'; button.id='ia-tab-'+id; button.dataset.settingsTab=id; button.setAttribute('role','tab');
      button.setAttribute('aria-controls',panels.get(id).id); tabs.append(button); buttons.set(id,button);
      const panel=panels.get(id); panel.setAttribute('role','tabpanel'); panel.setAttribute('aria-labelledby',button.id); body.append(panel);
    }
    settings.classList.add('ia-settings'); settings.append(tabs,body);
    // Genuine diagnostics augment the six app statuses; they never claim that a
    // listening socket proves that another device can pass the Windows firewall.
    const diagnostics=document.createElement('details'); diagnostics.className='ia-diagnostics';
    const summary=document.createElement('summary'), diagnosticRows=document.createElement('div'), diagnosticStatus=document.createElement('p'), scan=document.createElement('button');
    diagnosticStatus.setAttribute('role','status'); diagnosticRows.className='ia-diagnostic-rows'; scan.type='button'; scan.dataset.iaScan='';
    diagnostics.append(summary,diagnosticRows,diagnosticStatus,scan); panels.get('health').append(diagnostics);
    function renderNativeReport(report) {
      diagnosticRows.replaceChildren();
      for (const item of report?.checks || []) {
        const row=document.createElement('p'), label=document.createElement('strong'), detail=document.createElement('span');
        const port=item.detail?.match(/^Port (\d+) (joignable localement · pare-feu non vérifié|non joignable localement · service ou filtrage à vérifier)$/);
        row.dataset.status=item.status; label.textContent=t(item.label); detail.textContent=port ? t('Port {port} '+port[2],{port:port[1]}) : t(item.detail); row.append(label,detail); diagnosticRows.append(row);
      }
    }
    async function refreshHealth() {
      const epoch=++healthEpoch; diagnosticStatus.textContent=t('Vérification…');
      try {if (!healthFlight) healthFlight=Promise.resolve().then(()=>onNativeHealth?.()).finally(()=>{healthFlight=null;}); const report=await healthFlight; if (disposed || epoch!==healthEpoch) return;
        if (!report) {diagnosticStatus.textContent=t('Diagnostic disponible dans l’application de bureau.');return;}
        renderNativeReport(report); diagnosticStatus.textContent='';
      } catch(error) {if (!disposed && epoch===healthEpoch) diagnosticStatus.textContent=error.message || t('Vérification indisponible.');}
    }
    function select(event) {const button=event.target.closest('[data-settings-tab]'); if (button && tabs.contains(button)) onTab(button.dataset.settingsTab);}
    function key(event) {
      const current=TABS.indexOf(event.target.dataset.settingsTab); if (current<0) return;
      const next=event.key==='ArrowRight'?(current+1)%TABS.length:event.key==='ArrowLeft'?(current+TABS.length-1)%TABS.length:event.key==='Home'?0:event.key==='End'?TABS.length-1:-1;
      if (next<0) return; event.preventDefault(); const button=buttons.get(TABS[next]); onTab(TABS[next]); button.focus({preventScroll:true});
    }
    async function scanNetwork() {
      if (scan.disabled) return; scan.disabled=true; diagnosticStatus.textContent=t('Recherche sur ton réseau local…');
      try {const result=await onScan?.(); if (!disposed) diagnosticStatus.textContent=result ? t('{count} appareil(s) trouvé(s)',{count:result.peers?.length || 0}) : t('Diagnostic disponible dans l’application de bureau.');}
      catch(error) {if (!disposed) diagnosticStatus.textContent=error.message || t('Recherche impossible. Réessaie.');}
      finally {if (!disposed) scan.disabled=false;}
    }
    function openCard(event) {
      const target=event.target;
      const promote=target.closest('[data-scene-promote]');
      if (promote && event.type==='click' && document.getElementById('nook-layout').contains(promote)) {const route={music:'music',focus:'focus',tasks:'tasks',weather:'weather',shelf:'tray'}[promote.dataset.scenePromote]; if (route) {event.preventDefault();event.stopImmediatePropagation();onRoute(route);return;}}
      if (target.closest('button,a,input,textarea,select,[contenteditable="true"]') || event.type==='keydown' && !['Enter',' '].includes(event.key)) return;
      const card=target.closest('[data-activity]'); if (!card || !document.getElementById('nook-layout').contains(card)) return;
      const route={music:'music',focus:'focus',tasks:'tasks',weather:'weather',shelf:'tray'}[card.dataset.activity]; if (!route) return;
      if (event.type==='keydown') event.preventDefault(); onRoute(route);
    }
    const nook=document.getElementById('nook-layout');
    tabs.addEventListener('click',select); tabs.addEventListener('keydown',key); scan.addEventListener('click',scanNetwork);
    nook.addEventListener('click',openCard,true); nook.addEventListener('keydown',openCard);
    function render(view, editing) {
      if (disposed) return;
      const next=tabForRoute(view,editing), changed=next!==active; active=next;
      if (changed) body.scrollTop=0;
      settings.hidden=!next; settings.dataset.settingsTab=next || '';
      general.hidden=next!=='general';
      for (const [id,button] of buttons) {button.textContent=t(LABELS[id]);button.setAttribute('aria-selected',String(id===next));button.tabIndex=id===next?0:-1;}
      for (const button of menu.querySelectorAll('[data-view]')) {
        button.hidden=!PRIMARY.includes(button.dataset.view);
        const selected=button.dataset.view==='settings' ? !!next : button.dataset.view===view || button.dataset.view==='nook' && ['music','focus','tasks','weather'].includes(view);
        button.setAttribute('aria-pressed',String(selected)); button.setAttribute('aria-current',selected?'page':'false');
      }
      summary.textContent=t('Diagnostic réseau'); scan.textContent=t('Chercher sur le réseau local');
      if (next==='health' && changed) void refreshHealth();
      for (const card of nook.querySelectorAll('[data-activity]')) if (card.classList.contains('activity-main') || card.classList.contains('activity-module-summary') || card.classList.contains('activity-card')) {card.tabIndex=0;card.setAttribute('role','group');card.setAttribute('aria-label',t('Ouvrir {module}',{module:t({music:'Musique',focus:'Focus',tasks:'Tâches',weather:'Météo',shelf:'Étagère'}[card.dataset.activity] || card.dataset.activity)}));const button=card.querySelector('[data-scene-promote]');if (button) button.setAttribute('aria-label',card.getAttribute('aria-label'));}
    }
    return {render, refreshHealth, dispose() {disposed=true;healthEpoch++;tabs.removeEventListener('click',select);tabs.removeEventListener('keydown',key);scan.removeEventListener('click',scanNetwork);nook.removeEventListener('click',openCard,true);nook.removeEventListener('keydown',openCard);}};
  }
  return Object.freeze({PRIMARY,TABS,tabForRoute,invokeCore,prepare,create});
});
