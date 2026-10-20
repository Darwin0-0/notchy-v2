(function (root, factory) {
  'use strict';
  const api = factory(typeof module === 'object' && module.exports ? require('./module-contracts.js') : root?.NotchyLayout);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) root.NotchyExperience = api;
})(typeof window === 'object' ? window : null, function (defaultLayout) {
  'use strict';
  const MODULE_IDS = Object.freeze(['music', 'focus', 'weather', 'shelf']);
  const META = Object.freeze({music: ['Musique', 'var(--activity-music)'], focus: ['Tâches & Focus', 'var(--activity-focus)'], weather: ['Météo', 'var(--activity-weather)'], shelf: ['Étagère', 'var(--activity-shelf)']});
  const ICON_PATHS = Object.freeze({health: 'M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5z M9 12l2 2 4-4', back: 'M15 5l-7 7 7 7', up: 'm6 15 6-6 6 6', down: 'm6 9 6 6 6-6', ready: 'M5 12.5l4.5 4.5L19 7.5', attention: 'M12 5v9 M12 19h.01', unknown: 'M6 12h12', busy: 'M12 3a9 9 0 0 1 9 9', plus:'M12 5v14 M5 12h14', remove:'M5 12h14', menu:'M5 7h14 M5 12h11 M5 17h14'});
  const list = value => Array.isArray(value) ? value : [];
  const known = (id, ids = MODULE_IDS) => typeof id === 'string' && ids.includes(id);
  const copy = state => ({enabled: [...state.enabled], order: [...state.order]});
  const canonical = (id, ids) => id === 'tasks' && ids.includes('focus') ? 'focus' : id;

  function normalizeModuleState(value = {}, ids = MODULE_IDS) {
    const order = [...new Set([...list(value?.order).map(id => canonical(id, ids)).filter(id => known(id, ids)), ...ids])];
    const selected = new Set(list(value?.enabled).map(id => canonical(id, ids)).filter(id => known(id, ids)));
    return {enabled: order.filter(id => selected.has(id)), order};
  }
  function modulePreviewPlan(value, ids = MODULE_IDS) {
    const state = normalizeModuleState(value, ids), visible = state.enabled.slice(0, 3), reserve = state.enabled.slice(3);
    const items = visible.map((id, index) => ({id, column: index === 0 ? 1 : 2, row: index === 2 ? 2 : 1,
      columnSpan: visible.length === 1 ? 2 : 1, rowSpan: visible.length < 3 || index === 0 ? 2 : 1}));
    return {...state, visible, reserve, items};
  }
  function updateModuleState(value, id, command, ids = MODULE_IDS) {
    const state = normalizeModuleState(value, ids);
    id = canonical(id, ids);
    if (!known(id, ids)) return state;
    if (command === 'toggle') state.enabled = state.enabled.includes(id) ? state.enabled.filter(item => item !== id) : [...state.enabled, id];
    else if (command === 'up' || command === 'down') {
      const index = state.order.indexOf(id), next = index + (command === 'up' ? -1 : 1);
      if (next >= 0 && next < state.order.length) [state.order[index], state.order[next]] = [state.order[next], state.order[index]];
    }
    return normalizeModuleState(state, ids);
  }
  function healthReadiness(items) {
    const rows = list(items), ready = rows.filter(item => item?.status === 'ready').length;
    return {ready, total: rows.length, all: rows.length > 0 && ready === rows.length, busy: rows.some(item => item?.status === 'busy')};
  }

  function create({healthHost, modulesHost, modulesToolbarHost = null, layout = defaultLayout, getModuleContract = id => layout?.getBuiltinContract(id), renderModulePreview = null, t = value => value, onAction = () => {}, onModulesChange = () => {}, icons = {}} = {}) {
    const document = healthHost?.ownerDocument || modulesHost?.ownerDocument;
    if (!document) throw new TypeError('A Health or Modules host is required.');
    let disposed = false, moduleState = normalizeModuleState(), moduleIds = [...MODULE_IDS], healthItems = new Map();
    let moduleGrid = [], moduleOptions = {}, moduleDefinitions = new Map(), editorMenu = null, movingModule = null, draggedModule = null, resizing = null, lastModuleSignature = '', lastPreviewRenderer = null;
    const healthRows = new Map(), tiles = new Map(), previewCleanups = [];
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
    const moduleHeading = modulesHost ? heading(modulesHost, 'Modifier le panneau') : null;
    const moduleBody = modulesHost ? element('div', 'experience-module-body') : null;
    const previewStage = modulesHost ? element('div', 'experience-module-grid') : null;
    const gridCells = modulesHost ? element('div', 'experience-grid-cells') : null;
    const gridCards = modulesHost ? element('div', 'experience-grid-cards') : null;
    const gridMenu = modulesHost ? element('div', 'experience-grid-menu') : null;
    const resizePreview = modulesHost ? element('div','experience-grid-resize-preview') : null;
    const moduleStatus = modulesHost ? element('p', 'experience-sr') : null;
    if (modulesHost) {
      modulesHost.classList.add('experience-module-editor'); moduleHeading.head.classList.add('experience-editor-toolbar');
      moduleHeading.back.dataset.experienceCommand = 'done'; moduleHeading.back.replaceChildren(moduleHeading.backLabel);
      if (modulesToolbarHost) {modulesToolbarHost.append(moduleHeading.head); modulesHost.classList.add('experience-module-editor--external-toolbar');}
      previewStage.setAttribute('role', 'group'); previewStage.setAttribute('aria-label', say('Grille du panneau, 3 colonnes et 3 lignes'));
      gridMenu.setAttribute('role','menu'); gridMenu.hidden=true; moduleStatus.setAttribute('role', 'status'); moduleStatus.setAttribute('aria-live', 'polite');
      resizePreview.hidden=true;resizePreview.setAttribute('aria-hidden','true');
      previewStage.append(gridCells,gridCards,resizePreview,gridMenu); moduleBody.append(previewStage, moduleStatus); modulesHost.append(moduleBody);
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
    const editorSnapshot = () => ({...copy(moduleState), grid: moduleGrid.map(item => ({...item}))});
    const contractFor = id => moduleDefinitions.get(id)?.contract || (typeof moduleOptions.getContract === 'function' ? moduleOptions.getContract(id) : getModuleContract(id));
    const labelFor = id => say(typeof moduleDefinitions.get(id)?.label === 'string' ? moduleDefinitions.get(id).label : META[id]?.[0] || id);
    function validateGrid(grid, ids = moduleIds, definitions = moduleDefinitions, options = moduleOptions) {
      if (!layout?.planGrid) throw new TypeError(say('Le moteur de grille est indisponible.'));
      if (!Array.isArray(grid) || grid.some(item => !item || !known(item.id,ids) || !Number.isInteger(item.column) || !Number.isInteger(item.row))) throw new TypeError(say('La grille contient un module indisponible ou une position invalide.'));
      const placements = grid.map(({id,presentation,column,row}) => ({id,presentation,column,row}));
      const plan = layout.planGrid(placements,{getContract:id => definitions.get(id)?.contract || (typeof options.getContract === 'function' ? options.getContract(id) : getModuleContract(id))});
      if (plan.items.some(item => !item.fits)) throw new RangeError(say('Ce format ne tient pas dans cet emplacement.'));
      return {placements,plan};
    }
    function defaultGrid(state, ids, definitions, options) {
      const first = state.enabled.slice(0,3), result=[];
      for (const [index,id] of first.entries()) {
        const candidate={id,presentation:first.length===1?'full':index===0?'main':first.length===2?'side':index===1?'tall':'small',column:index===0?0:2,row:index===2?2:0};
        try {validateGrid([...result,candidate],ids,definitions,options); result.push(candidate);} catch {}
      }
      return result;
    }
    function announce(message) {if (moduleStatus) moduleStatus.textContent=message;}
    function candidateAt(id,presentation,column,row) {
      const replacement={id,presentation,column,row},next=moduleGrid.map(item=>item.id===id?replacement:item);if(!next.some(item=>item.id===id))next.push(replacement);
      try {return validateGrid(next);} catch {return null;}
    }
    function focusModule(id) {const card=tiles.get(id); (card || gridCells.querySelector('button') || moduleHeading.back)?.focus({preventScroll:true});}
    function applyGrid(grid, enabled=moduleState.enabled) {
      try {
        const {placements}=validateGrid(grid), next={...copy(moduleState), enabled:[...new Set(enabled)].filter(id=>known(id,moduleIds)),grid:placements};
        const acknowledged=onModulesChange({...next,enabled:[...next.enabled],order:[...next.order],grid:placements.map(item=>({...item}))});
        if (acknowledged===false) {announce(say('La disposition n’a pas été modifiée.'));return false;}
        editorMenu=null; movingModule=null; draggedModule=null;
        renderModules({...moduleOptions,...next});
        announce(say('Disposition mise à jour.'));
        return true;
      } catch(error) {announce(String(error?.message || say('Cette disposition est indisponible.')));return false;}
    }
    function choosePosition(id,column,row) {
      const current=moduleGrid.find(item=>item.id===id); if (!current) return false;
      const candidate=candidateAt(id,current.presentation,column,row);
      if (!candidate) {announce(say('Cet emplacement est occupé ou trop petit.'));return false;}
      const applied=applyGrid(candidate.placements); if(applied)focusModule(id); return applied;
    }
    function removeModule(id) {
      if (!moduleGrid.some(item=>item.id===id)) return;
      if(applyGrid(moduleGrid.filter(item=>item.id!==id),moduleState.enabled.filter(item=>item!==id))) focusModule(null);
    }
    function addFormat(id,column,row) {
      const available=layout?.supportedFormats?.(contractFor(id)) || [];
      for(const presentation of ['small','tall','side','wide','main','full']) if(available.includes(presentation)) {
        const candidate=candidateAt(id,presentation,column,row);if(candidate)return candidate;
      }
      return null;
    }
    function menuControl(label, command, id, disabled=false) {
      const control=button('experience-grid-menu-item',label); control.dataset.experienceCommand=command;
      if(id)control.dataset.experienceModule=id;control.disabled=disabled;control.setAttribute('role','menuitem');return control;
    }
    function focusMenu() {[...gridMenu.querySelectorAll('button')].find(control=>!control.disabled)?.focus({preventScroll:true});}
    function renderGridMenu() {
      gridMenu.replaceChildren(); gridMenu.hidden=!editorMenu; if(!editorMenu)return;
      const heading=element('strong','experience-grid-menu-title',editorMenu.id?labelFor(editorMenu.id):say('Ajouter un module'));
      gridMenu.append(heading);
      if(editorMenu.id) {
        const placement=moduleGrid.find(item=>item.id===editorMenu.id);if(!placement){editorMenu=null;gridMenu.hidden=true;return;}
        gridMenu.append(element('span','experience-grid-menu-label',say('TAILLE')));
        for(const presentation of layout.supportedFormats(contractFor(placement.id))) {
          const format=layout.getFormat(presentation),available=!!candidateAt(placement.id,presentation,placement.column,placement.row);
          const control=menuControl(`${presentation} · ${format.cols} × ${format.rows} · ${format.width} × ${format.height}`,'resize',placement.id,!available);
          control.dataset.gridPresentation=presentation; control.setAttribute('aria-checked',String(placement.presentation===presentation));control.setAttribute('role','menuitemradio');
          if(!available)control.title=say('Les cellules nécessaires ne sont pas libres.');gridMenu.append(control);
        }
        gridMenu.append(menuControl(say('Déplacer'),'move',placement.id),menuControl(say('Retirer du panneau'),'remove',placement.id));
      } else {
        let count=0;
        for(const id of moduleState.order)if(!moduleGrid.some(item=>item.id===id)) {
          const available=!!addFormat(id,editorMenu.column,editorMenu.row),control=menuControl(labelFor(id),'add-module',id,!available);
          if(!available)control.title=say('Aucun format ne tient dans ces cellules libres.');gridMenu.append(control);count++;
        }
        if(!count)gridMenu.append(element('p','',say('Tous les modules disponibles sont déjà placés.')));
      }
      gridMenu.append(menuControl(say('Fermer'),'close-grid-menu',editorMenu.id));
    }
    function renderModules(value = {}) {
      if (disposed || !modulesHost) return;
      if(resizing)return editorSnapshot();
      const ids=[...new Set([...MODULE_IDS,...list(value.definitions).map(item=>item?.id).filter(id=>typeof id==='string' && /^[a-z][a-z0-9-]*\.[a-z][a-z0-9.-]*$/.test(id)).slice(0,12)])];
      const definitions=new Map(list(value.definitions).filter(item=>item&&known(item.id,ids)).map(item=>[item.id,item])),state=normalizeModuleState(value,ids);
      let validated;
      try {validated=validateGrid(Object.hasOwn(value,'grid')?value.grid:defaultGrid(state,ids,definitions,value),ids,definitions,value);}
      catch(error) {announce(String(error?.message || say('Disposition invalide.')));return editorSnapshot();}
      const renderer=typeof value.renderPreview==='function'?value.renderPreview:renderModulePreview;
      const signature=JSON.stringify({grid:validated.placements,...state,labels:ids.map(id=>say(typeof definitions.get(id)?.label==='string'?definitions.get(id).label:META[id]?.[0]||id)),descriptions:ids.map(id=>definitions.get(id)?.description||''),movingModule,previewRevision:value.previewRevision??null,title:say('Modifier le panneau')});
      if(signature===lastModuleSignature&&renderer===lastPreviewRenderer){moduleIds=ids;moduleDefinitions=definitions;moduleOptions={...value};moduleState=state;moduleGrid=validated.placements;renderGridMenu();return editorSnapshot();}
      const focusId=document.activeElement?.closest?.('[data-experience-module]')?.dataset.experienceModule;
      for(const cleanup of previewCleanups.splice(0))cleanup();
      moduleIds=ids;moduleDefinitions=definitions;moduleOptions={...value};moduleState=state;moduleGrid=validated.placements;
      gridCells.replaceChildren();gridCards.replaceChildren();tiles.clear();
      const free=new Set(validated.plan.freeCells.map(cell=>cell.row*3+cell.column)),firstFree=validated.plan.freeCells[0];
      for(let row=0;row<3;row++)for(let column=0;column<3;column++) {
        const cell=element('div','experience-grid-cell');cell.style.gridColumn=String(column+1);cell.style.gridRow=String(row+1);
        cell.dataset.gridColumn=String(column);cell.dataset.gridRow=String(row);
        if(free.has(row*3+column)) {
          const add=button('experience-grid-add'),mark=element('span','experience-grid-add-mark'),copyNode=element('span','experience-grid-add-copy');
          mark.append(icon('plus'));copyNode.append(element('strong','',say(movingModule?'Déplacer ici':'Ajouter')),element('span','',say('cellule libre · 1 × 1')));
          add.append(mark,copyNode);add.dataset.experienceCommand=movingModule?'place-module':'add';add.dataset.gridColumn=String(column);add.dataset.gridRow=String(row);
          if(movingModule)add.dataset.experienceModule=movingModule;
          add.setAttribute('aria-label',say(movingModule?'Déplacer {module}, colonne {column}, ligne {row}':'Ajouter un module, colonne {column}, ligne {row}',{module:labelFor(movingModule),column:column+1,row:row+1}));
          cell.dataset.promoted=String(firstFree?.column===column&&firstFree?.row===row);cell.append(add);
        }else cell.setAttribute('aria-hidden','true');
        gridCells.append(cell);
      }
      for(const item of validated.plan.items) {
        const card=element('article','experience-grid-module'),content=element('div','experience-grid-module-content');card.tabIndex=0;card.draggable=true;
        card.dataset.experienceModule=item.id;card.dataset.gridPresentation=item.presentation;card.style.gridColumn=`${item.column+1} / span ${item.cols}`;card.style.gridRow=`${item.row+1} / span ${item.rows}`;
        card.setAttribute('role','group');card.setAttribute('aria-label',say('{module}, {format}. Entrée pour les options, flèches pour déplacer.',{module:labelFor(item.id),format:item.presentation}));
        content.inert=true;content.setAttribute('aria-hidden','true');
        if(renderer){const cleanup=renderer(content,{...item});if(typeof cleanup==='function')previewCleanups.push(cleanup);}
        else {content.append(element('strong','experience-grid-module-label',labelFor(item.id)),element('span','experience-grid-module-description',moduleDefinitions.get(item.id)?.description || ''));}
        const remove=button('experience-grid-remove'),options=button('experience-grid-options');remove.append(icon('remove'));options.append(icon('menu'));
        options.setAttribute('aria-haspopup','menu');
        for(const [control,command,label]of [[remove,'remove','Retirer du panneau'],[options,'grid-options','Options du module']]){control.dataset.experienceCommand=command;control.dataset.experienceModule=item.id;control.setAttribute('aria-label',say(label)+' · '+labelFor(item.id));}
        const badge=element('span','experience-grid-dimensions',`${item.presentation} · ${item.cols} × ${item.rows} · ${Math.round(item.width)} × ${Math.round(item.height)}`);badge.setAttribute('aria-hidden','true');
        const handle=button('experience-grid-resize');handle.dataset.experienceCommand='resize-options';handle.dataset.experienceModule=item.id;
        handle.setAttribute('aria-label',say('Redimensionner {module}',{module:labelFor(item.id)}));handle.setAttribute('aria-haspopup','menu');
        handle.title=say('Tire pour redimensionner · flèches pour choisir la taille');
        handle.append(element('span','experience-grid-resize-grip'));
        card.append(content,remove,options,badge,handle);gridCards.append(card);tiles.set(item.id,card);
      }
      moduleHeading.titleNode.textContent=say('Modifier le panneau');moduleHeading.backLabel.textContent=say('Terminé');
      lastModuleSignature=signature;lastPreviewRenderer=renderer;
      renderGridMenu();if(focusId)focusModule(focusId);
      return editorSnapshot();
    }
    function editorCommand(target,action) {
      const id=target.dataset.experienceModule;
      if(action==='close-grid-menu'){editorMenu=null;renderGridMenu();focusModule(id);return;}
      if(action==='add'){editorMenu={column:Number(target.dataset.gridColumn),row:Number(target.dataset.gridRow)};renderGridMenu();focusMenu();return;}
      if(!known(id,moduleIds))return;
      if(action==='resize-options'){editorMenu={id};renderGridMenu();focusMenu();return;}
      if(action==='grid-options'){editorMenu={id};renderGridMenu();focusMenu();}
      else if(action==='remove')removeModule(id);
      else if(action==='move'){movingModule=id;editorMenu=null;renderModules({...moduleOptions,...editorSnapshot()});announce(say('Choisis une cellule libre ou utilise les flèches pour déplacer le module.'));focusModule(id);}
      else if(action==='place-module')choosePosition(id,Number(target.dataset.gridColumn),Number(target.dataset.gridRow));
      else if(action==='resize') {const current=moduleGrid.find(item=>item.id===id),candidate=current&&candidateAt(id,target.dataset.gridPresentation,current.column,current.row);if(candidate&&applyGrid(candidate.placements))focusModule(id);}
      else if(action==='add-module'&&editorMenu&&!editorMenu.id){const candidate=addFormat(id,editorMenu.column,editorMenu.row);if(candidate&&applyGrid(candidate.placements,[...moduleState.enabled,id]))focusModule(id);}
    }
    function gridContext(event) {
      const card=event.target.closest?.('.experience-grid-module');if(!card||!modulesHost?.contains(card))return;
      event.preventDefault();event.stopPropagation();editorMenu={id:card.dataset.experienceModule};renderGridMenu();focusMenu();
    }
    function gridKey(event) {
      if(disposed)return;
      if(resizing){
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();finishResize(false);return;}
        if(event.key==='Tab'){finishResize(false);return;}
        if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' ','Delete','Backspace'].includes(event.key)){event.preventDefault();event.stopPropagation();return;}
      }
      const resizeHandle=event.target.closest?.('.experience-grid-resize');
      if(resizeHandle&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){
        event.preventDefault();event.stopPropagation();
        const id=resizeHandle.dataset.experienceModule,current=moduleGrid.find(item=>item.id===id),axis=['ArrowLeft','ArrowRight'].includes(event.key)?'width':'height',direction=['ArrowLeft','ArrowUp'].includes(event.key)?-1:1;
        const format=current&&layout.getFormat(current.presentation);
        const cross=axis==='width'?'height':'width';
        const choices=current?layout.supportedFormats(contractFor(id)).map(presentation=>({presentation,...layout.getFormat(presentation)})).filter(item=>(item[axis]-format[axis])*direction>0).sort((a,b)=>Math.abs(a[cross]-format[cross])-Math.abs(b[cross]-format[cross])||Math.abs(a[axis]-format[axis])-Math.abs(b[axis]-format[axis])):[];
        const next=choices.map(item=>candidateAt(id,item.presentation,current.column,current.row)).find(Boolean);
        if(next&&applyGrid(next.placements)){tiles.get(id)?.querySelector('.experience-grid-resize')?.focus({preventScroll:true});announce(say('Taille du module mise à jour.'));}
        else announce(say('Les cellules nécessaires ne sont pas libres.'));
        return;
      }
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(editorMenu||movingModule){const id=editorMenu?.id||movingModule;editorMenu=null;movingModule=null;renderModules({...moduleOptions,...editorSnapshot()});focusModule(id);}else onAction('back');return;}
      const card=event.target.closest?.('.experience-grid-module'),id=card?.dataset.experienceModule;
      if(card&&event.target===card) {
        const item=moduleGrid.find(item=>item.id===id),delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
        if(delta){event.preventDefault();event.stopPropagation();choosePosition(id,item.column+delta[0],item.row+delta[1]);}
        else if(['Enter',' '].includes(event.key)){event.preventDefault();event.stopPropagation();editorMenu={id};renderGridMenu();focusMenu();}
        else if(['Delete','Backspace'].includes(event.key)){event.preventDefault();event.stopPropagation();removeModule(id);}
      }
      if(gridMenu.contains(event.target)&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
        const controls=[...gridMenu.querySelectorAll('button')].filter(control=>!control.disabled),index=controls.indexOf(document.activeElement);
        if(controls.length){event.preventDefault();event.stopPropagation();controls[event.key==='Home'?0:event.key==='End'?controls.length-1:(index+(event.key==='ArrowDown'?1:-1)+controls.length)%controls.length].focus({preventScroll:true});}
      }
    }
    function gridDrag(event) {
      if(disposed)return;
      if(resizing||event.target.closest?.('.experience-grid-resize')){event.preventDefault();return;}
      if(event.type==='dragstart') {
        const card=event.target.closest?.('.experience-grid-module');if(!card||!modulesHost.contains(card))return;
        draggedModule=card.dataset.experienceModule;event.dataTransfer?.setData('application/x-notchy-module',draggedModule);if(event.dataTransfer)event.dataTransfer.effectAllowed='move';card.dataset.dragging='true';return;
      }
      if(event.type==='dragend'){draggedModule=null;for(const card of tiles.values())delete card.dataset.dragging;return;}
      if(!draggedModule)return;
      const rect=previewStage.getBoundingClientRect?.();if(!rect?.width||!rect?.height)return;
      const logicalX=(event.clientX-rect.left)/rect.width*layout.grid.width,logicalY=(event.clientY-rect.top)/rect.height*layout.grid.height;
      const column=Math.floor(logicalX/(layout.grid.cellWidth+layout.grid.gap)),row=Math.floor(logicalY/(layout.grid.cellHeight+layout.grid.gap)),current=moduleGrid.find(item=>item.id===draggedModule);
      if(logicalX<0||logicalY<0||logicalX>layout.grid.width||logicalY>layout.grid.height||logicalX%(layout.grid.cellWidth+layout.grid.gap)>layout.grid.cellWidth||logicalY%(layout.grid.cellHeight+layout.grid.gap)>layout.grid.cellHeight)return;
      const candidate=current&&candidateAt(draggedModule,current.presentation,column,row);
      if(event.type==='dragover'){if(candidate){event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='move';}return;}
      if(event.type==='drop'){event.preventDefault();event.stopPropagation();const id=draggedModule;draggedModule=null;if(candidate&&applyGrid(candidate.placements))focusModule(id);else announce(say('Cet emplacement est occupé ou trop petit.'));}
    }
    function finishResize(commit=false){
      const gesture=resizing;if(!gesture)return;
      resizing=null;resizePreview.hidden=true;delete previewStage.dataset.resizing;
      delete gesture.card.dataset.resizing;
      if(modulesHost.hasPointerCapture?.(gesture.pointerId))modulesHost.releasePointerCapture(gesture.pointerId);
      if(commit&&gesture.moved&&gesture.candidate){
        if(applyGrid(gesture.candidate.placements))tiles.get(gesture.id)?.querySelector('.experience-grid-resize')?.focus({preventScroll:true});
      }else{
        if(commit&&gesture.moved)announce(say('Les cellules nécessaires ne sont pas libres.'));
        gesture.card.querySelector('.experience-grid-resize')?.focus({preventScroll:true});
      }
    }
    function resizeGesture(event){
      if(disposed)return;
      if(event.type==='pointerdown'){
        const handle=event.target.closest?.('.experience-grid-resize');
        if(!handle||event.button!==0||resizing||!modulesHost.contains(handle))return;
        const id=handle.dataset.experienceModule,current=moduleGrid.find(item=>item.id===id),bounds=previewStage.getBoundingClientRect();
        if(!current||!bounds.width||!bounds.height)return;
        event.preventDefault();event.stopPropagation();editorMenu=null;renderGridMenu();
        const format=layout.getFormat(current.presentation),card=tiles.get(id);
        resizing={id,current:{...current},pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,bounds,format,card,moved:false,candidate:null};
        handle.focus({preventScroll:true});card.dataset.resizing='true';previewStage.dataset.resizing='true';
        modulesHost.setPointerCapture?.(event.pointerId);
        return;
      }
      const gesture=resizing;if(!gesture||event.pointerId!==gesture.pointerId)return;
      if(event.type==='pointercancel'||event.type==='lostpointercapture'){finishResize(false);return;}
      if(event.type==='pointerup'){
        event.preventDefault();event.stopPropagation();const tapped=!gesture.moved,id=gesture.id;finishResize(true);
        if(tapped){editorMenu={id};renderGridMenu();focusMenu();}
        return;
      }
      if(event.type!=='pointermove')return;
      const dx=(event.clientX-gesture.startX)*layout.grid.width/gesture.bounds.width,dy=(event.clientY-gesture.startY)*layout.grid.height/gesture.bounds.height;
      if(!gesture.moved&&Math.hypot(event.clientX-gesture.startX,event.clientY-gesture.startY)<6)return;
      gesture.moved=true;
      const width=gesture.format.width+dx,height=gesture.format.height+dy;
      const choices=layout.supportedFormats(contractFor(gesture.id)).map(presentation=>({presentation,...layout.getFormat(presentation)}));
      choices.sort((a,b)=>Math.pow((a.width-width)/(layout.grid.cellWidth+layout.grid.gap),2)+Math.pow((a.height-height)/(layout.grid.cellHeight+layout.grid.gap),2)-Math.pow((b.width-width)/(layout.grid.cellWidth+layout.grid.gap),2)-Math.pow((b.height-height)/(layout.grid.cellHeight+layout.grid.gap),2));
      const nearest=choices[0];if(!nearest)return;
      gesture.candidate=candidateAt(gesture.id,nearest.presentation,gesture.current.column,gesture.current.row);
      const pitchX=layout.grid.cellWidth+layout.grid.gap,pitchY=layout.grid.cellHeight+layout.grid.gap,maxWidth=layout.grid.width-gesture.current.column*pitchX,maxHeight=layout.grid.height-gesture.current.row*pitchY;
      resizePreview.hidden=false;resizePreview.dataset.blocked=String(!gesture.candidate);
      resizePreview.style.left=100*gesture.current.column*pitchX/layout.grid.width+'%';resizePreview.style.top=100*gesture.current.row*pitchY/layout.grid.height+'%';
      resizePreview.style.width=100*Math.max(80,Math.min(maxWidth,width))/layout.grid.width+'%';resizePreview.style.height=100*Math.max(56,Math.min(maxHeight,height))/layout.grid.height+'%';
      resizePreview.textContent=gesture.candidate?nearest.presentation+' · '+nearest.width+' × '+nearest.height:say('Espace occupé');
    }
    function resizeBlur(){finishResize(false);}
    function command(event) {
      if (disposed) return;
      const target = event.target.closest?.('[data-experience-command]');
      if (!target || target.disabled || !(healthHost?.contains(target) || modulesHost?.contains(target) || modulesToolbarHost?.contains(target))) return;
      const action = target.dataset.experienceCommand;
      if (action === 'back' || action === 'done') {finishResize(false);onAction(action); return;}
      if(resizing)return;
      if (action === 'health') {const item = healthItems.get(target.dataset.experienceItem); if (item && item.status !== 'busy' && item.status !== 'ready' && item.action !== undefined) onAction(item.action, {...item}); return;}
      editorCommand(target,action);
    }
    healthHost?.addEventListener('click', command); modulesHost?.addEventListener('click', command); modulesToolbarHost?.addEventListener('click',command);
    modulesHost?.addEventListener('contextmenu',gridContext);modulesHost?.addEventListener('keydown',gridKey);modulesToolbarHost?.addEventListener('keydown',gridKey);
    for(const type of ['dragstart','dragend','dragover','drop'])modulesHost?.addEventListener(type,gridDrag);
    for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])modulesHost?.addEventListener(type,resizeGesture);
    document.defaultView?.addEventListener('blur',resizeBlur);
    return {renderHealth, renderModules, dispose() {
      if(disposed)return;finishResize(false);disposed=true;
      for(const cleanup of previewCleanups.splice(0))cleanup();
      healthHost?.removeEventListener('click',command);modulesHost?.removeEventListener('click',command);modulesToolbarHost?.removeEventListener('click',command);
      modulesHost?.removeEventListener('contextmenu',gridContext);modulesHost?.removeEventListener('keydown',gridKey);modulesToolbarHost?.removeEventListener('keydown',gridKey);
      for(const type of ['dragstart','dragend','dragover','drop'])modulesHost?.removeEventListener(type,gridDrag);
      for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])modulesHost?.removeEventListener(type,resizeGesture);
      document.defaultView?.removeEventListener('blur',resizeBlur);
      if(modulesToolbarHost)moduleHeading.head.remove();healthItems.clear();healthRows.clear();tiles.clear();
    }};
  }
  return Object.freeze({MODULE_IDS, normalizeModuleState, modulePreviewPlan, updateModuleState, healthReadiness, create});
});
