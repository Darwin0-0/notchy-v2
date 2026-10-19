(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) {root.NotchyIA = api; api.prepare(root.document);}
})(typeof window === 'object' ? window : null, function () {
  'use strict';
  const PRIMARY = Object.freeze(['nook', 'tray', 'module-library', 'settings']);
  const TABS = Object.freeze(['general', 'appearance', 'notch', 'modules', 'scenarios', 'health', 'about']);
  const LABELS = Object.freeze({general:'Général',appearance:'Apparence',notch:'Encoche',modules:'Modules',scenarios:'Scénarios',health:'Santé',about:'À propos'});
  const ICONS = Object.freeze({general:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9 3l1-1h4l1 3 3 1 3 3-1 3 1 3-3 3-3 1-1 3h-4l-1-3-3-1-3-3 1-3-1-3 3-3 3-1Z',appearance:'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4 2 2 0 0 1 2-3h2a3 3 0 0 0 3-3 9 9 0 0 0-9-8ZM7 9h.01M12 7h.01M17 9h.01M7 14h.01',notch:'M4 4h16v16H4ZM4 9h16M9 4v2h6V4',modules:'m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',scenarios:'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z',health:'M3 12h4l3-8 4 16 3-8h4',about:'M12 11v6M12 7h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',language:'M3 5h12M9 3v2M5 5c0 7 7 11 7 11M13 5c0 7-7 11-10 12M13 21l5-12 5 12M15 17h6',startup:'M12 2v10M6 5a9 9 0 1 0 12 0',motion:'m13 3-9 11h7l-1 7L21 9h-8l1-6Z',radius:'M4 10V7a3 3 0 0 1 3-3h3M14 4h3a3 3 0 0 1 3 3v3M20 14v3a3 3 0 0 1-3 3h-3M10 20H7a3 3 0 0 1-3-3v-3',replay:'M3 11a9 9 0 1 1 2 7M3 4v7h7',reset:'M3 11a9 9 0 1 1 2 7M3 4v7h7'});
  async function invokeCore(name,args={}) {
    if (!['health_run','settings_get','settings_set','favorites_list','favorites_add','discovery_validate','discovery_scan','discovery_first_candidates'].includes(name)) throw new TypeError('Unknown native operation');
    const tauri=typeof window==='object'?window.__TAURI__:null;
    if (typeof tauri?.core?.invoke==='function') return tauri.core.invoke(name,args);
    if (typeof tauri?.invoke==='function') return tauri.invoke(name,args);
    return null;
  }
  function tabForRoute(view, editing = false, section = 'general') {
    return editing ? 'modules' : view === 'settings' ? ['general','appearance','notch','about'].includes(section) ? section : 'general' : ['modules','scenarios','health'].includes(view) ? view : null;
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
  function create({document, t, onTab, onRoute, onScan, onNativeHealth, motion = () => true}) {
    const settings=document.getElementById('settings-player'), menu=document.getElementById('notch-menu');
    const window=document.defaultView, translated=new Map();
    const node=(tag,className,source)=>{const el=document.createElement(tag);el.className=className;if(source){translated.set(el,source);el.textContent=t(source);}return el;};
    const icon=id=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS(svg.namespaceURI,'path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');path.setAttribute('d',ICONS[id] || ICONS.general);svg.append(path);return svg;};
    const general=node('div','ia-page');general.id='ia-general';
    const appearance=node('div','ia-page');appearance.id='ia-appearance';
    const notchPage=node('div','ia-page');notchPage.id='ia-notch';
    const about=node('div','ia-page ia-about');about.id='ia-about';
    const group=(host,title)=>{const section=node('section','ia-section'),heading=node('h2','ia-caption',title),card=node('div','ia-group');section.append(heading,card);host.append(section);return card;};
    function row(host,{id,title,detail,control,command}) {
      const el=node(command?'button':'div','ia-row');if(command){el.type='button';el.dataset.settingsCommand=command;}
      const glyph=node('span','ia-row-icon'),copy=node('span','ia-row-copy');glyph.append(icon(id));copy.append(node('strong','',title));if(detail)copy.append(node('small','',detail));el.append(glyph,copy);if(control){control.classList.add('ia-row-control');el.append(control);}host.append(el);return el;
    }
    // Move existing controls: their native callbacks, persistence and labels remain authoritative.
    const system=group(general,'SYSTÈME'),language=document.getElementById('settings-language');
    row(system,{id:'language',title:'Langue',detail:'La langue de Notchy',control:language});
    const startup=document.getElementById('startup-control'),startupInput=document.getElementById('startup-windows');
    const launch=row(system,{id:'startup',title:'Démarrer avec Windows',detail:'Ouvrir Notchy automatiquement',control:startupInput});
    launch.id=startup.id;startup.remove();launch.hidden=true;
    const startupStatus=document.getElementById('startup-status');general.append(startupStatus);
    const desktopOnly=row(system,{id:'startup',title:'Démarrer avec Windows',detail:'Disponible dans l’application de bureau'});desktopOnly.dataset.desktopOnly='';
    const app=group(general,'APPLICATION'),replay=document.getElementById('welcome-replay');
    const replayRow=row(app,{id:'replay',title:'Redécouvrir Notchy',detail:'Revoir l’animation et la présentation'});replayRow.replaceWith(replay);replay.className='ia-row';replay.replaceChildren(...replayRow.childNodes);
    const look=group(appearance,'APPARENCE'),format=settings.querySelector('.settings-format-segment'),formatSelect=document.getElementById('appearance-format');
    const formatRow=row(look,{id:'notch',title:'Format',detail:'La largeur de ton espace',control:format});formatRow.append(formatSelect);format.setAttribute('aria-label',t('Format'));format.removeAttribute('aria-labelledby');
    const radius=document.getElementById('appearance-radius'),radiusValue=document.getElementById('appearance-radius-value'),radiusControls=node('span','ia-range-control');radiusControls.append(radiusValue,radius);
    row(look,{id:'radius',title:'Arrondis',detail:'Les contours de l’encoche',control:radiusControls});
    const motionInput=document.getElementById('appearance-motion');motionInput.setAttribute('aria-label',t('Animations'));
    row(look,{id:'motion',title:'Animations',detail:'Des transitions fluides et naturelles',control:motionInput});
    row(group(appearance,'PRÉFÉRENCES VISUELLES'),{id:'reset',title:'Réinitialiser l’apparence',detail:'Format standard, arrondis et animations',command:'reset-appearance'});
    const essentials=group(notchPage,'TON ENCOCHE');
    for(const button of settings.querySelectorAll('.settings-essentials > button')){button.className='ia-row';essentials.append(button);}
    const moduleGroup=group(notchPage,'PERSONNALISATION');
    row(moduleGroup,{id:'modules',title:'Modules',detail:'Choisir et placer tes modules',command:'modules'});
    row(moduleGroup,{id:'modules',title:'Bibliothèque de modules',detail:'Découvrir ou importer un module',command:'library'});
    const brand=node('div','ia-about-brand'),logo=node('div','ia-about-logo');brand.append(logo,node('h2','ia-about-name','Notchy'));
    const version=node('span','ia-version');version.textContent='VERSION '+document.querySelector('meta[name="application-version"]').content;brand.append(version,node('p','ia-about-tagline','Musique, focus et fichiers. Juste quand tu en as besoin.'));about.append(brand);
    row(group(about,'NOTCHY'),{id:'health',title:'Santé de Notchy',detail:'Vérifier les services et les connexions',command:'health'});
    const oldClose=settings.querySelector('[data-settings-command="close"]');
    const header=node('header','ia-titlebar'),title=node('h2','','RÉGLAGES');header.append(title);oldClose.className='ia-close';oldClose.removeAttribute('data-i18n');oldClose.textContent='×';oldClose.setAttribute('aria-label',t('Fermer les réglages'));header.append(oldClose);
    settings.replaceChildren();
    const tabs=document.createElement('div'); tabs.className='ia-tabs'; tabs.setAttribute('role','tablist');tabs.setAttribute('aria-orientation','vertical');
    const body=document.createElement('div'); body.className='ia-settings-body';
    const panels=new Map([['general',general],['appearance',appearance],['notch',notchPage],['about',about],...['modules','scenarios','health'].map(id=>[id,document.getElementById(id+'-player')])]);
    const buttons=new Map();
    let disposed=false, active=null, requested='general', healthEpoch=0, healthFlight=null, animation=null;
    for (const id of TABS) {
      const button=document.createElement('button'); button.type='button'; button.id='ia-tab-'+id; button.dataset.settingsTab=id; button.setAttribute('role','tab');
      const label=node('span','',LABELS[id]);button.append(icon(id),label);button.setAttribute('aria-controls',panels.get(id).id); tabs.append(button); buttons.set(id,button);
      const panel=panels.get(id); panel.setAttribute('role','tabpanel'); panel.setAttribute('aria-labelledby',button.id); body.append(panel);
    }
    const layout=node('div','ia-settings-layout');layout.append(tabs,body);settings.classList.add('ia-settings');settings.append(header,layout);
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
    function selectTab(id) {requested=id;onTab(id);}
    function select(event) {const button=event.target.closest('[data-settings-tab]'); if (button && tabs.contains(button)) selectTab(button.dataset.settingsTab);}
    function key(event) {
      const current=TABS.indexOf(event.target.dataset.settingsTab); if (current<0) return;
      const next=['ArrowDown','ArrowRight'].includes(event.key)?(current+1)%TABS.length:['ArrowUp','ArrowLeft'].includes(event.key)?(current+TABS.length-1)%TABS.length:event.key==='Home'?0:event.key==='End'?TABS.length-1:-1;
      if (next<0) return; event.preventDefault(); const button=buttons.get(TABS[next]); selectTab(TABS[next]); button.focus({preventScroll:true});
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
    }
    const nook=document.getElementById('nook-layout');
    tabs.addEventListener('click',select); tabs.addEventListener('keydown',key); scan.addEventListener('click',scanNetwork);
    nook.addEventListener('click',openCard,true);
    function render(view, editing) {
      if (disposed) return;
      const next=tabForRoute(view,editing,requested), changed=next!==active; active=next;
      if (changed || !motion() || document.hidden) {animation?.cancel();animation=null;}
      if (changed) body.scrollTop=0;
      settings.hidden=!next; settings.dataset.settingsTab=next || '';
      document.getElementById('notch').dataset.settingsOpen=String(!!next);
      for(const [el,source] of translated)el.textContent=t(source);
      oldClose.setAttribute('aria-label',t('Fermer les réglages'));tabs.setAttribute('aria-label',t('Réglages de Notchy'));
      startupInput.setAttribute('aria-label',t('Démarrer avec Windows'));motionInput.setAttribute('aria-label',t('Animations'));format.setAttribute('aria-label',t('Format'));
      desktopOnly.hidden=!document.getElementById('startup-control').hidden;
      for (const [id,button] of buttons) {button.setAttribute('aria-selected',String(id===next));button.tabIndex=id===next?0:-1;panels.get(id).hidden=id!==next;}
      if(next==='about'&&!logo.childElementCount){const mark=document.querySelector('.welcome-mimo');if(mark)logo.append(mark.cloneNode(true));}
      if(changed&&next&&motion()&&!document.hidden&&typeof panels.get(next).animate==='function')animation=panels.get(next).animate([{opacity:.4,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],{duration:220,easing:'cubic-bezier(.16,1,.3,1)'});
      for (const button of menu.querySelectorAll('[data-view]')) {
        button.hidden=!PRIMARY.includes(button.dataset.view);
        const selected=button.dataset.view==='settings' ? !!next : button.dataset.view===view || button.dataset.view==='nook' && ['music','focus','tasks','weather'].includes(view);
        button.setAttribute('aria-pressed',String(selected)); button.setAttribute('aria-current',selected?'page':'false');
      }
      summary.textContent=t('Diagnostic réseau'); scan.textContent=t('Chercher sur le réseau local');
      if (next==='health' && changed) void refreshHealth();
      for (const card of nook.querySelectorAll('[data-activity]')) if (card.classList.contains('activity-main') || card.classList.contains('activity-module-summary') || card.classList.contains('activity-card')) {card.removeAttribute('tabindex');card.setAttribute('role','group');card.setAttribute('aria-label',t({music:'Musique',focus:'Tâches & Focus',tasks:'Tâches & Focus',weather:'Météo',shelf:'Étagère'}[card.dataset.activity] || card.dataset.activity));}
    }
    return {render, refreshHealth, dispose() {disposed=true;healthEpoch++;animation?.cancel();tabs.removeEventListener('click',select);tabs.removeEventListener('keydown',key);scan.removeEventListener('click',scanNetwork);nook.removeEventListener('click',openCard,true);}};
  }
  return Object.freeze({PRIMARY,TABS,tabForRoute,invokeCore,prepare,create});
});
