(function (root) {
  'use strict';
  const steps = [
    {title: 'Une encoche qui suit ton rythme.', text: 'Elle reste discrète. Survole-la pour un aperçu, puis clique pour ouvrir le panneau.', label: 'Discret · survol · ouvert', drawing: '<path d="M4 10h43q4 0 4 4v1q0 3 3 3h20q3 0 3-3v-1q0-4 4-4h43"/><path d="M23 30h31q4 0 4 4v8q0 5 5 5h34q5 0 5-5v-8q0-4 4-4h23"/><path d="m45 27 4-4 4 4m-4-4v6"/>'},
    {title: 'Dépose, puis choisis.', text: 'Glisse un fichier sur l’encoche. Tu peux le garder dans l’Étagère, le convertir ou en extraire le texte.', label: 'Déposer un fichier', drawing: '<path d="M8 10h29q4 0 4 4v16q0 6 6 6h67q6 0 6-6V14q0-4 4-4h20"/><path d="M55 6h21l8 8v19H55zM75 6v9h9M61 22h16M61 27h10"/><path d="m101 19 5 5 5-5m-5-11v16"/>'},
    {title: 'Compose ton Nook.', text: 'Fais un clic droit dans le panneau pour choisir les modules et leur place dans ton accueil.', label: 'Choisir les modules', drawing: '<rect x="18" y="7" width="112" height="37" rx="10"/><rect x="26" y="15" width="52" height="21" rx="5"/><rect x="86" y="15" width="15" height="21" rx="4"/><rect x="107" y="15" width="15" height="21" rx="4"/><path d="m62 20 12 8-6 2-3 6z"/>'}
  ];
  const greetings = [['en', 'hello'], ['fr', 'bonjour'], ['ar', 'مرحبا'], ['es', 'hola'], ['it', 'ciao'], ['en', 'hello']];
  function create({host, start = () => {}, tutorialFinish = start, motion = true} = {}) {
    const document = host?.ownerDocument;
    if (!document) throw new TypeError('La bienvenue nécessite un élément hôte.');
    const window = document.defaultView, reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let active = false, page = 'welcome', step = 0, disposed = false, animations = [], focusFrame = 0;
    const node = (tag, className, text) => {const value = document.createElement(tag); value.className = className; if (text !== undefined) value.textContent = text; return value;};
    const control = (command, text, className = '') => {const value = node('button', className, text); value.type = 'button'; value.dataset.welcomeCommand = command; return value;};
    const card = node('div', 'welcome-card'), intro = node('div', 'welcome-intro');
    const hello = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); hello.setAttribute('viewBox', '0 0 300 84'); hello.setAttribute('aria-hidden', 'true'); hello.classList.add('welcome-hello');
    const lettering = greetings.map(([language, word]) => {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text'); text.textContent = word; text.setAttribute('lang', language); text.setAttribute('x', '150'); text.setAttribute('y', '62'); text.setAttribute('text-anchor', 'middle');
      if (language === 'ar') text.setAttribute('direction', 'rtl');
      hello.append(text); return text;
    });
    const title = node('h2', 'welcome-title', 'Bienvenue dans Notchy !'), description = node('p', 'welcome-description', 'Ta concentration, dans l’encoche.');
    const introActions = node('div', 'welcome-actions'); introActions.append(control('start', 'Démarrer', 'welcome-primary'), control('tutorial', 'Voir le tutoriel', 'welcome-secondary'));
    intro.append(hello, title, description, introActions);
    const tutorial = node('div', 'welcome-tutorial'); tutorial.hidden = true;
    const top = node('div', 'welcome-tutorial-top'), counter = node('span', 'welcome-counter'); top.append(counter, control('start', 'Passer', 'welcome-skip'));
    const drawing = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); drawing.setAttribute('viewBox', '0 0 152 54'); drawing.setAttribute('aria-hidden', 'true'); drawing.classList.add('welcome-drawing');
    const stepTitle = node('h2', 'welcome-step-title'), stepText = node('p', 'welcome-step-text');
    const tutorialActions = node('div', 'welcome-actions'), previous = control('previous', 'Précédent', 'welcome-secondary'), next = control('next', 'Suivant', 'welcome-primary'); tutorialActions.append(previous, next);
    const status = node('span', 'welcome-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    tutorial.append(top, drawing, stepTitle, stepText, tutorialActions, status); card.append(intro, tutorial); host.replaceChildren(card); host.hidden = true;
    function stopInk() {
      animations.forEach(animation => animation.cancel()); animations = [];
      lettering.forEach((text, index) => {text.style.opacity = index === lettering.length - 1 ? '1' : '0'; text.style.strokeDashoffset = '0'; text.style.fillOpacity = '1'; text.style.strokeOpacity = '0';});
    }
    function drawHello() {
      stopInk();
      if ((typeof motion === 'function' ? motion() : motion) === false || reduced.matches || document.hidden) return;
      if (typeof lettering[0].animate !== 'function') return;
      lettering.forEach((text, index) => {
        const last = index === lettering.length - 1;
        text.style.opacity = '0';
        const animation = text.animate([
          {opacity: '0', strokeDashoffset: '400', fillOpacity: '0', strokeOpacity: '1', offset: 0},
          {opacity: '1', strokeDashoffset: '400', fillOpacity: '0', strokeOpacity: '1', offset: .04, easing: 'cubic-bezier(.45,.05,.3,1)'},
          {opacity: '1', strokeDashoffset: '0', fillOpacity: '0', strokeOpacity: '1', offset: .64},
          {opacity: '1', strokeDashoffset: '0', fillOpacity: '1', strokeOpacity: '0', offset: .84},
          {opacity: last ? '1' : '0', strokeDashoffset: '0', fillOpacity: '1', strokeOpacity: '0', offset: 1}
        ], {duration: 2500, delay: index * 2800, fill: 'both'});
        animations.push(animation);
      });
      const current = animations;
      Promise.all(current.map(animation => animation.finished)).then(() => {if (animations === current) stopInk();}, () => {});
    }
    function focus(control) {if (focusFrame) window.cancelAnimationFrame(focusFrame); focusFrame = window.requestAnimationFrame(() => {focusFrame = 0; if (active && !disposed) control?.focus();});}
    function render() {
      intro.hidden = page !== 'welcome'; tutorial.hidden = page !== 'tutorial';
      if (page !== 'tutorial') return;
      const value = steps[step]; counter.textContent = `${step + 1} / ${steps.length}`; stepTitle.textContent = value.title; stepText.textContent = value.text;
      drawing.innerHTML = value.drawing; previous.disabled = step === 0; next.textContent = step === steps.length - 1 ? 'C’est parti' : 'Suivant'; next.dataset.welcomeCommand = step === steps.length - 1 ? 'finish' : 'next';
      status.textContent = `Étape ${step + 1} sur ${steps.length} : ${value.title}`;
    }
    function show(mode = 'welcome') {
      if (disposed) return false;
      active = true; page = mode === 'tutorial' ? 'tutorial' : 'welcome'; step = 0; host.hidden = false; render();
      if (page === 'welcome') drawHello(); else stopInk();
      focus(page === 'welcome' ? introActions.firstElementChild : next); return true;
    }
    function hide() {active = false; host.hidden = true; stopInk(); if (focusFrame) window.cancelAnimationFrame(focusFrame); focusFrame = 0;}
    function click(event) {
      const value = event.target.closest('[data-welcome-command]'); if (!active || disposed || !value || !host.contains(value) || value.disabled) return;
      const command = value.dataset.welcomeCommand;
      if (command === 'start' || command === 'finish') {hide(); (command === 'finish' ? tutorialFinish : start)();}
      else if (command === 'tutorial') {page = 'tutorial'; step = 0; stopInk(); render(); focus(next);}
      else if (command === 'previous' || command === 'next') {step = Math.max(0, Math.min(steps.length - 1, step + (command === 'previous' ? -1 : 1))); render(); focus(next);}
    }
    function keydown(event) {if (active && page === 'tutorial' && event.key === 'Escape' && !event.isComposing) {event.preventDefault(); event.stopPropagation(); page = 'welcome'; stopInk(); render(); focus(introActions.lastElementChild);}}
    const onReducedMotion = () => {if (reduced.matches) stopInk();}, onHidden = () => {if (document.hidden) stopInk();};
    host.addEventListener('click', click); host.addEventListener('keydown', keydown); reduced.addEventListener('change', onReducedMotion); document.addEventListener('visibilitychange', onHidden);
    return Object.freeze({show, hide, dispose: () => {if (disposed) return; hide(); disposed = true; host.removeEventListener('click', click); host.removeEventListener('keydown', keydown); reduced.removeEventListener('change', onReducedMotion); document.removeEventListener('visibilitychange', onHidden);}, isActive: () => active, inspect: () => ({active, page, step, animating: animations.length > 0, disposed})});
  }
  const api = {create};
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) root.NotchyWelcome = api;
})(typeof window === 'object' ? window : null);
