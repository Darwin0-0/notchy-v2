(function (root) {
  'use strict';
  const steps = [
    {title: 'Un aperçu, un clic.', text: 'Survole l’encoche pour un aperçu. Clique pour ouvrir tes modules.', drawing: '<path d="M4 10h43q4 0 4 4v1q0 3 3 3h20q3 0 3-3v-1q0-4 4-4h43"/><path d="M23 30h31q4 0 4 4v8q0 5 5 5h34q5 0 5-5v-8q0-4 4-4h23"/><path d="m45 27 4-4 4 4m-4-4v6"/>'},
    {title: 'Une tâche, un temps pour elle.', text: 'Ajoute ta tâche dans Focus, puis lance le Pomodoro. La pause arrive au bon moment.', drawing: '<circle cx="47" cy="27" r="19"/><path d="M47 16v11l8 5M80 17h34M80 29h26m-26 12h20m-23-26-4 4-3-3m7 12-4 4-3-3m7 12-4 4-3-3"/>'},
    {title: 'Dépose. Garde. Partage.', text: 'Glisse un fichier sur l’encoche. Garde-le dans l’Étagère ou envoie-le avec LocalSend.', drawing: '<path d="M8 10h29q4 0 4 4v16q0 6 6 6h67q6 0 6-6V14q0-4 4-4h20"/><path d="M55 6h21l8 8v19H55zM75 6v9h9M61 22h16M61 27h10"/><path d="m101 19 5 5 5-5m-5-11v16"/>'}
  ];
  function create({host, start = () => {}, tutorialFinish = start, motion = true} = {}) {
    const document = host?.ownerDocument;
    if (!document) throw new TypeError('La bienvenue nécessite un élément hôte.');
    const window = document.defaultView, reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const i18n = window.NotchyI18n, t = (source, values) => i18n?.t(source, values) ?? source;
    let active = false, page = 'welcome', step = 0, disposed = false, animations = [], focusFrame = 0;
    const sourceText = new Map();
    const node = (tag, className, text) => {const value = document.createElement(tag); value.className = className; if (text !== undefined) {sourceText.set(value, text); value.textContent = t(text);} return value;};
    const control = (command, text, className = '') => {const value = node('button', className, text); value.type = 'button'; value.dataset.welcomeCommand = command; return value;};
    const card = node('div', 'welcome-card'), intro = node('div', 'welcome-intro');
    const brand = node('div', 'welcome-brand');
    const svgNode = (tag, attributes) => {const value = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [name, content] of Object.entries(attributes)) value.setAttribute(name, content); return value;};
    const mark = svgNode('svg', {viewBox: '0 0 64 84', 'aria-hidden': 'true'}); mark.classList.add('welcome-mimo');
    const body = svgNode('g', {class: 'welcome-mimo-body'});
    // Mimo's original V1 silhouette; the welcome owns only this short greeting.
    body.append(svgNode('rect', {class: 'welcome-mimo-ear', x: 3, y: 28, width: 7, height: 11, rx: 3}), svgNode('rect', {class: 'welcome-mimo-ear', x: 54, y: 28, width: 7, height: 11, rx: 3}));
    body.append(svgNode('path', {'fill-rule': 'evenodd', d: 'M25 8H39C51 8 58 16 58 28V37C58 50 51 55 39 55H25C13 55 6 50 6 37V28C6 16 13 8 25 8Z M25 12C15 12 10 18 10 28V37C10 47 15 51 25 51H39C49 51 54 47 54 37V28C54 18 49 12 39 12Z'}));
    const waveArm = svgNode('rect', {class: 'welcome-mimo-wave', x: 48, y: 66, width: 7, height: 9, rx: 3.5});
    const rightEye = svgNode('circle', {class: 'welcome-mimo-eye', cx: 41, cy: 32, r: 4.5});
    body.append(svgNode('circle', {cx: 23, cy: 32, r: 4.5}), rightEye, svgNode('path', {d: 'M29.5 39h5a2.5 2.5 0 0 1-5 0Z'}));
    const laptop = svgNode('g', {class: 'welcome-mimo-laptop'});
    laptop.append(svgNode('rect', {class: 'welcome-mimo-pc', x: 13, y: 49, width: 38, height: 26, rx: 4}), svgNode('rect', {class: 'welcome-mimo-pc-base', x: 10, y: 74, width: 44, height: 3, rx: 1.5}), svgNode('path', {d: 'M28 61h8M32 57v8', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.5, 'stroke-linecap': 'round'}));
    body.append(laptop, svgNode('rect', {x: 9, y: 66, width: 7, height: 9, rx: 3.5}), waveArm, svgNode('rect', {x: 20, y: 73, width: 8, height: 8, rx: 4}), svgNode('rect', {x: 36, y: 73, width: 8, height: 8, rx: 4})); mark.append(body);
    brand.append(mark, node('div', 'welcome-wordmark', 'Notchy'));
    const title = node('h2', 'welcome-title', 'Fais place à ton rythme.'), description = node('p', 'welcome-description', 'Musique, focus et fichiers. Juste quand tu en as besoin.');
    const introActions = node('div', 'welcome-actions'); introActions.append(control('start', 'Démarrer', 'welcome-primary'), control('tutorial', 'Découvrir', 'welcome-secondary'));
    intro.append(brand, title, description, introActions);
    const tutorial = node('div', 'welcome-tutorial'); tutorial.hidden = true;
    const top = node('div', 'welcome-tutorial-top'), counter = node('span', 'welcome-counter'); top.append(counter, control('start', 'Passer', 'welcome-skip'));
    const drawing = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); drawing.setAttribute('viewBox', '0 0 152 54'); drawing.setAttribute('aria-hidden', 'true'); drawing.classList.add('welcome-drawing');
    const stepTitle = node('h2', 'welcome-step-title'), stepText = node('p', 'welcome-step-text');
    const tutorialActions = node('div', 'welcome-actions'), previous = control('previous', 'Précédent', 'welcome-secondary'), next = control('next', 'Suivant', 'welcome-primary'); tutorialActions.append(previous, next);
    const status = node('span', 'welcome-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const language = node('label', 'language-control welcome-language'), languageLabel = node('span', '', 'Langue'), languageChoice = node('select', '');
    languageChoice.id = 'welcome-language'; languageChoice.dataset.languageChoice = ''; languageChoice.setAttribute('aria-label', t('Langue'));
    for (const [code, name] of [['fr', 'Français'], ['en', 'English']]) {const option = node('option', '', name); option.value = code; option.setAttribute('lang', code); languageChoice.append(option);}
    language.append(languageLabel, languageChoice);
    tutorial.append(top, drawing, stepTitle, stepText, tutorialActions, status); card.append(intro, tutorial, language); host.replaceChildren(card); host.hidden = true;
    function stopMimo() {
      animations.forEach(animation => animation.cancel()); animations = [];
    }
    function greetMimo() {
      stopMimo();
      if ((typeof motion === 'function' ? motion() : motion) === false || reduced.matches || document.hidden) return;
      if (typeof body.animate !== 'function') return;
      const timing = {duration: 780, delay: 0, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'both'};
      animations.push(body.animate([{opacity: 0, transform: 'translateY(6px) scale(.94)'}, {opacity: 1, transform: 'translateY(-1px) scale(1.015)', offset: .65}, {opacity: 1, transform: 'translateY(0) scale(1)'}], timing));
      animations.push(waveArm.animate([{transform: 'translateY(0) rotate(0deg)'}, {transform: 'translateY(-14px) rotate(-20deg)', offset: .3}, {transform: 'translateY(-14px) rotate(12deg)', offset: .55}, {transform: 'translateY(-14px) rotate(-16deg)', offset: .72}, {transform: 'translateY(0) rotate(0deg)'}], timing));
      animations.push(rightEye.animate([{transform: 'scaleY(1)'}, {transform: 'scaleY(1)', offset: .4}, {transform: 'scaleY(.15)', offset: .52}, {transform: 'scaleY(1)', offset: .68}, {transform: 'scaleY(1)'}], timing));
      const current = animations;
      Promise.all(current.map(animation => animation.finished)).then(() => {if (animations === current) stopMimo();}, () => {});
    }
    function focus(control) {if (focusFrame) window.cancelAnimationFrame(focusFrame); focusFrame = window.requestAnimationFrame(() => {focusFrame = 0; if (active && !disposed && !document.hidden) control?.focus();});}
    function render() {
      for (const [element, source] of sourceText) element.textContent = t(source);
      languageChoice.value = i18n?.locale() || 'fr'; languageChoice.setAttribute('aria-label', t('Langue'));
      intro.hidden = page !== 'welcome'; tutorial.hidden = page !== 'tutorial';
      if (page !== 'tutorial') return;
      const value = steps[step]; counter.textContent = `${step + 1} / ${steps.length}`; stepTitle.textContent = t(value.title); stepText.textContent = t(value.text);
      drawing.innerHTML = value.drawing; previous.disabled = step === 0; next.textContent = t(step === steps.length - 1 ? 'C’est parti' : 'Suivant'); next.dataset.welcomeCommand = step === steps.length - 1 ? 'finish' : 'next';
      status.textContent = t('Étape {step} sur {total} : {title}', {step: step + 1, total: steps.length, title: t(value.title)});
    }
    function show(mode = 'welcome') {
      if (disposed) return false;
      active = true; page = mode === 'tutorial' ? 'tutorial' : 'welcome'; step = 0; host.hidden = false; render();
      if (page === 'welcome') greetMimo(); else stopMimo();
      focus(page === 'welcome' ? introActions.firstElementChild : next); return true;
    }
    function hide() {active = false; host.hidden = true; stopMimo(); if (focusFrame) window.cancelAnimationFrame(focusFrame); focusFrame = 0;}
    function click(event) {
      const value = event.target.closest('[data-welcome-command]'); if (!active || disposed || !value || !host.contains(value) || value.disabled) return;
      const command = value.dataset.welcomeCommand;
      if (command === 'start' || command === 'finish') {hide(); (command === 'finish' ? tutorialFinish : start)();}
      else if (command === 'tutorial') {page = 'tutorial'; step = 0; stopMimo(); render(); focus(next);}
      else if (command === 'previous' || command === 'next') {step = Math.max(0, Math.min(steps.length - 1, step + (command === 'previous' ? -1 : 1))); render(); focus(next);}
    }
    function keydown(event) {if (active && page === 'tutorial' && event.key === 'Escape' && !event.isComposing) {event.preventDefault(); event.stopPropagation(); page = 'welcome'; stopMimo(); render(); focus(introActions.lastElementChild);}}
    const changeLanguage = () => i18n?.setLocale(languageChoice.value);
    const onReducedMotion = () => {if (reduced.matches) stopMimo();}, onHidden = () => {if (document.hidden) {stopMimo(); if (focusFrame) window.cancelAnimationFrame(focusFrame); focusFrame = 0;}};
    const motionObserver = typeof window.MutationObserver === 'function' ? new window.MutationObserver(() => {if ((typeof motion === 'function' ? motion() : motion) === false) stopMimo();}) : null;
    if (motionObserver && document.body) motionObserver.observe(document.body, {attributes: true, attributeFilter: ['data-motion']});
    languageChoice.addEventListener('change', changeLanguage);
    host.addEventListener('click', click); host.addEventListener('keydown', keydown); reduced.addEventListener('change', onReducedMotion); document.addEventListener('visibilitychange', onHidden);
    const removeLanguage = i18n?.onChange(() => {if (!disposed) render();});
    return Object.freeze({show, hide, dispose: () => {if (disposed) return; hide(); disposed = true; removeLanguage?.(); languageChoice.removeEventListener('change', changeLanguage); motionObserver?.disconnect(); host.removeEventListener('click', click); host.removeEventListener('keydown', keydown); reduced.removeEventListener('change', onReducedMotion); document.removeEventListener('visibilitychange', onHidden);}, isActive: () => active, inspect: () => ({active, page, step, animating: animations.length > 0, disposed})});
  }
  const api = {create};
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) root.NotchyWelcome = api;
})(typeof window === 'object' ? window : null);
