(function (root) {
  'use strict';
  const MOTION = Object.freeze({entrance: 300, mascot: 420, wordmark: 360, slide: 360, exit: 180, reduced: 150, introStart: 120, introEnd: 1900, wakeAt: 300, wake: 220, curiousAt: 560, look: 220, nameAt: 780, returnAt: 1180, settle: 400, gazeX: 2, gazeY: -.5, tilt: 3, easing: 'cubic-bezier(.2,.8,.2,1)'});
  // Exact head geometry from Notchy V1's robot-companion.js; torso, arms and props are omitted.
  const MIMO_HEAD = Object.freeze({shell: 'M25 8H39C51 8 58 16 58 28V37C58 50 51 55 39 55H25C13 55 6 50 6 37V28C6 16 13 8 25 8Z M25 12C15 12 10 18 10 28V37C10 47 15 51 25 51H39C49 51 54 47 54 37V28C54 18 49 12 39 12Z', mouth: 'M29.5 39h5a2.5 2.5 0 0 1-5 0Z'});
  const steps = [
    {title: 'Un aperçu, un clic.', text: 'Survole l’encoche pour un aperçu. Clique pour ouvrir tes modules.', drawing: '<path d="M6 10h46a8 8 0 0 1 8 8v8a8 8 0 0 0 8 8h24a8 8 0 0 0 8-8v-8a8 8 0 0 1 8-8h36"/><circle class="welcome-ripple" cx="75" cy="40" r="9" stroke-width="1.4"/><path d="M75 52V40m0 0-4 4m4-4 4 4"/>'},
    {title: 'Une tâche, un temps pour elle.', text: 'Ajoute ta tâche dans Focus, puis lance le Pomodoro. La pause arrive au bon moment.', drawing: '<circle cx="52" cy="30" r="20"/><path d="M52 18v12l8 5"/><path d="m84 18 3 3 5-6M98 18h30"/><path d="m84 30 3 3 5-6M98 30h30"/><path d="m84 42 3 3 5-6M98 42h30"/>'},
    {title: 'Dépose. Garde. Partage.', text: 'Glisse un fichier sur l’encoche. Garde-le dans l’Étagère ou envoie-le avec LocalSend.', drawing: '<path d="M6 12h30a7 7 0 0 1 7 7v16a7 7 0 0 0 7 7h50a7 7 0 0 0 7-7V19a7 7 0 0 1 7-7h30"/><path class="welcome-file-nudge" d="M65 16h14l6 6v14H65z"/><path class="welcome-file-nudge" d="M69 28h12M69 33h8"/><path class="welcome-arrow-nudge" d="M96 22v14m0 0-4-4m4 4 4-4"/>'}
  ];
  function create({host, start = () => {}, tutorialFinish = start, motion = true, stageChanged = () => {}} = {}) {
    const document = host?.ownerDocument;
    if (!document) throw new TypeError('La bienvenue nécessite un élément hôte.');
    const window = document.defaultView, reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const i18n = window.NotchyI18n, t = (source, values) => i18n?.t(source, values) ?? source;
    let active = false, page = 'welcome', stage = 'idle', step = 0, disposed = false, animations = [], focusFrame = 0;
    const elementAnimations = new Map(), introTimers = new Set();
    const sourceText = new Map();
    const node = (tag, className, text) => {const value = document.createElement(tag); value.className = className; if (text !== undefined) {sourceText.set(value, text); value.textContent = t(text);} return value;};
    const control = (command, text, className = '') => {const value = node('button', className, text); value.type = 'button'; value.dataset.welcomeCommand = command; return value;};
    const svgNode = (tag, attributes) => {const value = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [name, content] of Object.entries(attributes)) value.setAttribute(name, content); return value;};
    const card = node('div', 'welcome-card'), intro = node('div', 'welcome-intro'), brand = node('div', 'welcome-brand');
    const mascot = node('div', 'welcome-mascot');
    const mark = svgNode('svg', {width: 56, height: 56, viewBox: '0 0 64 64', 'aria-hidden': 'true', 'data-mimo-source': 'notchy-v1'}); mark.classList.add('welcome-mimo');
    mark.append(svgNode('path', {class: 'welcome-mimo-shell', d: MIMO_HEAD.shell, fill: '#ffffff', 'fill-rule': 'evenodd'}));
    // Gaze and waking use parent groups, leaving the circles' blink transform independent.
    const features = svgNode('g', {class: 'welcome-mimo-features'}), eyelids = svgNode('g', {class: 'welcome-mimo-eyelids'});
    eyelids.append(svgNode('circle', {class: 'welcome-mimo-eye', cx: 23, cy: 32, r: 4.5, fill: '#ffffff'}), svgNode('circle', {class: 'welcome-mimo-eye', cx: 41, cy: 32, r: 4.5, fill: '#ffffff'}));
    features.append(eyelids, svgNode('path', {d: MIMO_HEAD.mouth, fill: '#ffffff'})); mark.append(features);
    mascot.append(mark);
    const wordmark = node('div', 'welcome-wordmark', 'Notchy'); wordmark.setAttribute('aria-label', 'Notchy');
    brand.append(mascot, wordmark);
    const title = node('h2', 'welcome-title', 'Fais place à ton rythme.'), description = node('p', 'welcome-description', 'Musique, focus et fichiers. Juste quand tu en as besoin.');
    const introActions = node('div', 'welcome-actions'); introActions.append(control('start', 'Démarrer', 'welcome-primary'), control('tutorial', 'Découvrir', 'welcome-secondary'));
    intro.append(title, description, introActions);
    const tutorial = node('div', 'welcome-tutorial'), top = node('div', 'welcome-tutorial-top'), counter = node('span', 'welcome-counter'); top.append(counter, control('start', 'Passer', 'welcome-skip'));
    const slides = steps.map(value => {
      const layer = node('div', 'welcome-slide'), illustration = node('div', 'welcome-illustration');
      const drawing = svgNode('svg', {width: 150, height: 60, viewBox: '0 0 150 60', fill: 'none', stroke: '#6FE3C5', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true'}); drawing.classList.add('welcome-drawing'); drawing.innerHTML = value.drawing;
      const title = node('h2', 'welcome-step-title', value.title), text = node('p', 'welcome-step-text', value.text);
      illustration.append(drawing); layer.append(illustration, title, text); tutorial.append(layer); return {layer, illustration, title, text};
    });
    const tutorialActions = node('div', 'welcome-actions'), previous = control('previous', 'Précédent', 'welcome-secondary'), next = control('next', 'Suivant', 'welcome-primary'); tutorialActions.append(previous, next);
    const status = node('span', 'welcome-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const language = node('label', 'welcome-language'), languageLabel = node('span', 'welcome-status', 'Langue'), languageChoice = node('select', '');
    languageChoice.id = 'welcome-language'; languageChoice.dataset.languageChoice = ''; languageChoice.setAttribute('aria-label', t('Langue'));
    for (const code of ['fr', 'en']) {const option = node('option', '', code.toUpperCase()); option.value = code; option.setAttribute('lang', code); languageChoice.append(option);}
    language.append(languageLabel, languageChoice);
    tutorial.append(top, tutorialActions, status); card.append(brand, intro, tutorial, language); host.replaceChildren(card); host.hidden = true; host.dataset.welcomeDesign = 'mimo-head';
    const motionEnabled = () => (typeof motion === 'function' ? motion() : motion) !== false && !reduced.matches && !document.hidden;
    function stopAnimations() {animations.forEach(animation => animation.cancel()); animations = []; elementAnimations.clear(); mascot.style.transform = features.style.transform = eyelids.style.transform = '';}
    function clearIntroTimers() {for (const timer of introTimers) window.clearTimeout(timer); introTimers.clear();}
    function scheduleIntro(value, delay) {
      const timer = window.setTimeout(() => {
        introTimers.delete(timer);
        if (!active || disposed || document.hidden || page !== 'welcome') return;
        if (!motionEnabled()) {clearIntroTimers(); stopAnimations(); setStage('welcome'); return;}
        if (typeof value === 'function') value(); else setStage(value);
      }, delay);
      introTimers.add(timer);
    }
    function animate(element, frames, duration, delay = 0, easing = MOTION.easing) {
      if (document.hidden || typeof element.animate !== 'function') return;
      if (!motionEnabled()) {
        if (!frames.some(frame => frame.opacity !== undefined)) return;
        frames = frames.map(({opacity}) => ({opacity})); duration = MOTION.reduced; delay = 0; easing = 'linear';
      }
      const previous = elementAnimations.get(element);
      if (previous) {
        const current = window.getComputedStyle?.(element);
        if (current) frames[0] = Object.fromEntries(Object.keys(frames[0]).map(property => [property, current[property]]));
        previous.cancel(); animations = animations.filter(animation => animation !== previous);
      }
      const animation = element.animate(frames, {duration, delay, easing, fill: 'both'}); animations.push(animation);
      elementAnimations.set(element, animation);
      void animation.finished.then(() => {const index = animations.indexOf(animation); if (index >= 0) {animations.splice(index, 1); if (elementAnimations.get(element) === animation) elementAnimations.delete(element); animation.cancel();}}, () => {});
    }
    function reveal(element, delay = 0, duration = MOTION.entrance) {
      animate(element, [{opacity: 0, transform: 'translateY(6px)'}, {opacity: 1, transform: 'translateY(0px)'}], duration, delay);
    }
    function greetMimo() {
      const center = ((wordmark.getBoundingClientRect?.().width || 96) + 12) / 2;
      host.dataset.mimoBeat = 'wake'; mascot.style.transform = `translateX(${center}px)`;
      animate(mascot, [{opacity: 0, transform: `translate(${center}px,6px) rotate(-2deg)`}, {opacity: 1, transform: `translate(${center}px,0px) rotate(0deg)`}], MOTION.mascot);
      scheduleIntro(() => {
        host.dataset.mimoBeat = 'awake';
        animate(eyelids, [{transform: 'scaleY(.12)'}, {transform: 'scaleY(1)'}], MOTION.wake);
      }, MOTION.wakeAt);
      scheduleIntro(() => {
        host.dataset.mimoBeat = 'curious'; features.style.transform = `translate(${MOTION.gazeX}px,${MOTION.gazeY}px)`; mascot.style.transform = `translateX(${center}px) rotate(${MOTION.tilt}deg)`;
        animate(features, [{transform: 'translate(0px,0px)'}, {transform: features.style.transform}], MOTION.look);
        animate(mascot, [{transform: `translateX(${center}px) rotate(0deg)`}, {transform: mascot.style.transform}], MOTION.look);
      }, MOTION.curiousAt);
      scheduleIntro(() => {
        host.dataset.mimoBeat = 'name'; mascot.style.transform = '';
        animate(mascot, [{transform: `translateX(${center}px) rotate(${MOTION.tilt}deg)`}, {transform: 'translateX(0px) rotate(0deg)'}], MOTION.wordmark);
        animate(wordmark, [{opacity: 0, transform: 'translateX(8px)'}, {opacity: 1, transform: 'translateX(0px)'}], MOTION.wordmark);
      }, MOTION.nameAt);
      scheduleIntro(() => {
        host.dataset.mimoBeat = 'ready'; features.style.transform = '';
        animate(features, [{transform: `translate(${MOTION.gazeX}px,${MOTION.gazeY}px)`}, {transform: 'translate(0px,0px)'}], MOTION.entrance);
        animate(mascot, [{transform: 'translateY(0px) rotate(0deg)'}, {transform: 'translateY(1.5px) rotate(1.5deg)', offset: .45}, {transform: 'translateY(0px) rotate(0deg)'}], MOTION.settle);
      }, MOTION.returnAt);
    }
    function moveSlide(slide, entering, direction = 1) {
      animate(slide.layer, [{opacity: entering ? 0 : 1, transform: `translateX(${entering ? direction * 16 : 0}px)`}, {opacity: entering ? 1 : 0, transform: `translateX(${entering ? 0 : -direction * 16}px)`}], entering ? MOTION.slide : MOTION.exit, 0, entering ? MOTION.easing : 'ease-in');
    }
    function focus(control) {if (focusFrame) window.cancelAnimationFrame(focusFrame); focusFrame = 0; if (document.hidden) return; focusFrame = window.requestAnimationFrame(() => {focusFrame = 0; if (active && !disposed && !document.hidden) control?.focus({preventScroll: true});});}
    function render() {
      for (const [element, source] of sourceText) element.textContent = t(source);
      host.dataset.welcomeStage = stage; host.dataset.welcomeMotion = String(active && ['logo', 'welcome'].includes(stage) && motionEnabled());
      if (stage !== 'logo') host.dataset.mimoBeat = stage === 'welcome' ? 'ready' : 'idle';
      languageChoice.value = i18n?.locale() || 'fr'; languageChoice.setAttribute('aria-label', t('Langue'));
      brand.hidden = !['logo', 'welcome'].includes(stage); intro.hidden = language.hidden = stage !== 'welcome'; tutorial.hidden = stage !== 'tour';
      for (const [index, slide] of slides.entries()) {slide.layer.dataset.active = String(index === step); slide.layer.inert = index !== step; slide.layer.setAttribute('aria-hidden', String(index !== step));}
      previous.disabled = step === 0; counter.textContent = `${step + 1} / ${steps.length}`;
      next.textContent = t(step === steps.length - 1 ? 'C’est parti' : 'Suivant'); next.dataset.welcomeCommand = step === steps.length - 1 ? 'finish' : 'next';
      status.textContent = stage === 'tour' ? t('Étape {step} sur {total} : {title}', {step: step + 1, total: steps.length, title: t(steps[step].title)}) : '';
    }
    function setStage(value) {
      const previousStage = stage; stage = value; render(); stageChanged(stage);
      if (stage === 'logo') greetMimo();
      else if (stage === 'welcome') {if (previousStage !== 'logo') {reveal(mascot, 0, MOTION.mascot); reveal(wordmark, 100, MOTION.wordmark);} reveal(title, 40); reveal(description, 80); reveal(introActions, 120); reveal(language); focus(introActions.firstElementChild);}
      else if (stage === 'tour') {moveSlide(slides[step], true); reveal(top); reveal(tutorialActions, 80); reveal(slides[step].illustration); reveal(slides[step].title, 40); reveal(slides[step].text, 80); focus(next);}
    }
    function beginIntro() {
      clearIntroTimers(); stopAnimations(); setStage('idle');
      // A hidden WebView must not consume the first encounter before Windows shows it.
      if (document.hidden) return;
      if (!motionEnabled()) setStage('welcome');
      else {scheduleIntro('logo', MOTION.introStart); scheduleIntro('welcome', MOTION.introEnd);}
    }
    function show(mode = 'welcome') {
      if (disposed) return false;
      const nextPage = mode === 'tutorial' ? 'tutorial' : 'welcome';
      if (active && page === nextPage) {render(); return true;}
      clearIntroTimers(); stopAnimations(); active = true; page = nextPage; step = 0; host.hidden = false;
      if (page === 'tutorial') setStage('tour');
      else beginIntro();
      return true;
    }
    function hide() {active = false; host.hidden = true; host.dataset.welcomeMotion = 'false'; clearIntroTimers(); stopAnimations(); if (focusFrame) window.cancelAnimationFrame(focusFrame); focusFrame = 0;}
    function click(event) {
      const value = event.target.closest('[data-welcome-command]'); if (!active || disposed || !value || !host.contains(value) || value.disabled) return;
      const command = value.dataset.welcomeCommand;
      if (command === 'start' || command === 'finish') {stopAnimations(); setStage('done'); hide(); (command === 'finish' ? tutorialFinish : start)();}
      else if (command === 'tutorial') {page = 'tutorial'; step = 0; clearIntroTimers(); stopAnimations(); setStage('tour');}
      else if (command === 'previous' || command === 'next') {
        const old = slides[step]; step = Math.max(0, Math.min(steps.length - 1, step + (command === 'previous' ? -1 : 1))); render();
        const direction = command === 'next' ? 1 : -1; moveSlide(old, false, direction); moveSlide(slides[step], true, direction); focus(next);
      }
    }
    function keydown(event) {if (active && page === 'tutorial' && event.key === 'Escape' && !event.isComposing) {event.preventDefault(); event.stopPropagation(); page = 'welcome'; stopAnimations(); setStage('welcome'); focus(introActions.lastElementChild);}}
    const changeLanguage = () => i18n?.setLocale(languageChoice.value);
    const settleIntro = () => {clearIntroTimers(); stopAnimations(); if (active && ['idle', 'logo'].includes(stage)) setStage('welcome'); else render();};
    const onReducedMotion = () => {if (reduced.matches) settleIntro(); else render();};
    const onHidden = () => {
      if (document.hidden) {
        clearIntroTimers(); stopAnimations();
        if (active && page === 'welcome' && ['idle', 'logo'].includes(stage)) setStage('idle'); else render();
        if (focusFrame) window.cancelAnimationFrame(focusFrame); focusFrame = 0;
      } else if (active && page === 'welcome' && stage === 'idle') beginIntro();
      else render();
    };
    const motionObserver = typeof window.MutationObserver === 'function' ? new window.MutationObserver(() => {if ((typeof motion === 'function' ? motion() : motion) === false) settleIntro(); else render();}) : null;
    if (motionObserver && document.body) motionObserver.observe(document.body, {attributes: true, attributeFilter: ['data-motion']});
    languageChoice.addEventListener('change', changeLanguage);
    host.addEventListener('click', click); host.addEventListener('keydown', keydown); reduced.addEventListener('change', onReducedMotion); document.addEventListener('visibilitychange', onHidden);
    const removeLanguage = i18n?.onChange(() => {if (!disposed) render();});
    return Object.freeze({show, hide, dispose: () => {if (disposed) return; hide(); disposed = true; removeLanguage?.(); languageChoice.removeEventListener('change', changeLanguage); motionObserver?.disconnect(); host.removeEventListener('click', click); host.removeEventListener('keydown', keydown); reduced.removeEventListener('change', onReducedMotion); document.removeEventListener('visibilitychange', onHidden);}, isActive: () => active, inspect: () => ({active, page, stage, step, beat: host.dataset.mimoBeat || 'idle', animating: animations.length > 0, blinking: host.dataset.welcomeMotion === 'true', disposed})});
  }
  const api = {create};
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) root.NotchyWelcome = api;
})(typeof window === 'object' ? window : null);
