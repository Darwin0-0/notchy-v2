(function (root) {
  'use strict';
  const NOTCH_TOKENS = typeof module === 'object' && module.exports ? require('./tokens.js') : root.NOTCH_TOKENS;
  const MOTION = NOTCH_TOKENS.welcomeMotion;
  // Authored beats from NotchyIntro.dc.html. The shell owns its geometry;
  // only the first reveal follows this sequence, never the tutorial controls.
  const COMPOSITION = Object.freeze({titleAt:500, wordStagger:90, languageAt:900, descriptionAt:1200, actionsAt:1600, reveal:800, copyReveal:900, blur:14, y:12});
  const steps = [
    {title: 'Un aperçu, un clic.', text: 'Survole l’encoche pour un aperçu. Clique pour ouvrir tes modules.', width:260,height:70,drawing: '<path class="welcome-line" pathLength="1" d="M2 12H60a8 8 0 0 1 8 8V36a10 10 0 0 0 10 10H182a10 10 0 0 0 10-10V20a8 8 0 0 1 8-8H258" stroke-width="3"/><circle class="welcome-ripple" cx="130" cy="32" r="9" stroke-width="2"/><circle cx="130" cy="32" r="9" stroke-width="2"/><g class="welcome-arrow-nudge"><path d="M130 36V28 M126.5 31.5l3.5-3.5 3.5 3.5" stroke-width="2"/></g>'},
    {title: 'Une tâche, un temps pour elle.', text: 'Ajoute ta tâche dans Focus, puis lance le Pomodoro. La pause arrive au bon moment.', width:220,height:78,drawing: '<circle cx="44" cy="39" r="30" stroke-width="3"/><path d="M44 39L56 47" stroke-width="3"/><path class="welcome-timer-hand" d="M44 39V20" stroke-width="3"/><path class="welcome-check welcome-check-first" pathLength="1" d="M92 20l4 4 8-9" stroke-width="2.6"/><path d="M114 20h62" stroke-width="2.6"/><path class="welcome-check welcome-check-second" pathLength="1" d="M92 39l4 4 8-9" stroke-width="2.6"/><path d="M114 39h62" stroke-width="2.6"/><path class="welcome-check welcome-check-third" pathLength="1" d="M92 58l4 4 8-9" stroke-width="2.6"/><path d="M114 58h62" stroke-width="2.6"/>'},
    {title: 'Dépose. Garde. Partage.', text: 'Glisse un fichier sur l’encoche. Garde-le dans l’Étagère ou envoie-le avec LocalSend.', width:260,height:70,drawing: '<path class="welcome-line" pathLength="1" d="M2 12H60a8 8 0 0 1 8 8V44a10 10 0 0 0 10 10H182a10 10 0 0 0 10-10V20a8 8 0 0 1 8-8H258" stroke-width="2.6"/><g class="welcome-file-nudge"><g transform="translate(20 -2)"><path d="M96 24h13l8 8v17a3 3 0 0 1-3 3H96a3 3 0 0 1-3-3V27a3 3 0 0 1 3-3z M109 24v8h8 M98 41h12 M98 46h8" stroke-width="2"/></g></g><g class="welcome-drop-arrow"><path d="M152 29v17 M146 40l6 6 6-6" stroke-width="2.2"/></g>'}
  ];
  function create({host, start = () => {}, tutorialFinish = start, motion = true, stageChanged = () => {}} = {}) {
    const document = host?.ownerDocument;
    if (!document) throw new TypeError('La bienvenue nécessite un élément hôte.');
    const window = document.defaultView, reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const i18n = window.NotchyI18n, t = (source, values) => i18n?.t(source, values) ?? source;
    let active = false, page = 'welcome', stage = 'idle', step = 0, disposed = false, animations = [], focusFrame = 0;
    const elementAnimations = new Map(), introTimers = new Set();
    const sourceText = new Map();let renderedTitle='';
    const node = (tag, className, text) => {const value = document.createElement(tag); value.className = className; if (text !== undefined) {sourceText.set(value, text); value.textContent = t(text);} return value;};
    const control = (command, text, className = '') => {const value = node('button', className, text); value.type = 'button'; value.dataset.welcomeCommand = command; return value;};
    const svgNode = (tag, attributes) => {const value = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [name, content] of Object.entries(attributes)) value.setAttribute(name, content); return value;};
    const card = node('div', 'welcome-card'), intro = node('div', 'welcome-intro'), brand = node('div', 'welcome-brand');
    const mascot = node('div', 'welcome-mascot');
    const mark = node('span', 'welcome-mimo'); mark.setAttribute('aria-hidden', 'true'); mark.dataset.galetSource = 'reference-canvas';
    mascot.append(mark);
    const wordmark = node('div', 'welcome-wordmark', 'Notchy'); wordmark.setAttribute('aria-label', 'Notchy');
    brand.append(mascot, wordmark);
    const title = node('h2', 'welcome-title'), description = node('p', 'welcome-description', 'Musique, focus et fichiers. Juste quand tu en as besoin.');
    const introActions = node('div', 'welcome-actions'); introActions.append(control('start', 'Démarrer', 'welcome-primary'), control('tutorial', 'Découvrir', 'welcome-secondary'));
    intro.append(title, description, introActions);
    const tutorial = node('div', 'welcome-tutorial'), top = node('div', 'welcome-tutorial-top'), counter = node('span', 'welcome-counter'); top.append(counter, control('start', 'Passer', 'welcome-skip'));
    const slides = steps.map(value => {
      const layer = node('div', 'welcome-slide'), illustration = node('div', 'welcome-illustration');
      const drawing = svgNode('svg', {width:value.width,height:value.height,viewBox:`0 0 ${value.width} ${value.height}`,fill:'none',stroke:'currentColor','stroke-width':2,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}); drawing.classList.add('welcome-drawing'); drawing.innerHTML = value.drawing;
      const title = node('h2', 'welcome-step-title', value.title), text = node('p', 'welcome-step-text', value.text);
      illustration.append(drawing); layer.append(illustration, title, text); tutorial.append(layer); return {layer, illustration, title, text};
    });
    const tutorialActions = node('div', 'welcome-actions'), previous = control('previous', 'Précédent', 'welcome-secondary'), next = control('next', 'Suivant', 'welcome-primary'); tutorialActions.append(previous, next);
    const status = node('span', 'welcome-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const language = node('label', 'welcome-language'), languageLabel = node('span', 'welcome-status', 'Langue'), languageChoice = node('select', '');
    languageChoice.id = 'welcome-language'; languageChoice.dataset.languageChoice = ''; languageChoice.setAttribute('aria-label', t('Langue'));
    for (const code of ['fr', 'en']) {const option = node('option', '', code.toUpperCase()); option.value = code; option.setAttribute('lang', code); languageChoice.append(option);}
    const languageArrow=svgNode('svg',{class:'welcome-language-arrow',viewBox:'0 0 24 24',width:16,height:16,'aria-hidden':'true'});languageArrow.append(svgNode('path',{d:'M6 9l6 6 6-6',fill:'none',stroke:'currentColor','stroke-width':2.6,'stroke-linecap':'round','stroke-linejoin':'round'}));
    language.append(languageLabel, languageChoice, languageArrow);
    tutorial.append(top, tutorialActions, status); card.append(brand, intro, tutorial, language); host.replaceChildren(card); host.hidden = true; host.dataset.welcomeDesign = 'mimo-head';
    const Galet = window.NotchyGalet || (typeof module === 'object' && module.exports ? require('./galet.js') : null);
    if (typeof Galet?.create !== 'function') throw new TypeError('Le compagnon Galet est indisponible.');
    const galet = Galet.create(mark, {motion, active:false, scope:document});
    const motionEnabled = () => (typeof motion === 'function' ? motion() : motion) !== false && !reduced.matches && !document.hidden;
    function stopAnimations() {animations.forEach(animation => animation.cancel()); animations = []; elementAnimations.clear(); mascot.style.transform = '';introActions.inert=false;}
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
        if (current) frames[0] = Object.fromEntries(Object.keys(frames[0]).map(property => [property, current[property] || frames[0][property]]));
        previous.cancel(); animations = animations.filter(animation => animation !== previous);
      }
      const animation = element.animate(frames, {duration, delay, easing, fill: 'both'}); animations.push(animation);
      elementAnimations.set(element, animation);
      void animation.finished.then(() => {const index = animations.indexOf(animation); if (index >= 0) {animations.splice(index, 1); if (elementAnimations.get(element) === animation) elementAnimations.delete(element); animation.cancel();}}, () => {});
    }
    function reveal(element, delay = 0, duration = MOTION.entrance) {
      animate(element, [{opacity:0,filter:`blur(${COMPOSITION.blur}px)`,transform:`translateY(${COMPOSITION.y}px)`},{opacity:1,filter:'blur(0px)',transform:'translateY(0px)'}],duration,delay);
    }
    function renderTitle() {
      const phrase=t('Fais place à ton rythme.');if(renderedTitle===phrase)return;renderedTitle=phrase;title.setAttribute('aria-label',phrase);
      title.replaceChildren(...phrase.split(/\s+/).map(word=>{const span=document.createElement('span');span.className='welcome-word';span.textContent=word;span.setAttribute('aria-hidden','true');return span;}));
    }
    function greetGalet() {
      const center = ((wordmark.getBoundingClientRect?.().width || 160) + 22) / 2;
      host.dataset.mimoBeat = 'wake'; mascot.style.transform = `translateX(${center}px)`;
      animate(mascot, [{opacity: 0, transform: `translate(${center}px,${MOTION.revealY}px) rotate(${MOTION.wakeTilt}deg)`}, {opacity: 1, transform: `translate(${center}px,0px) rotate(0deg)`}], MOTION.mascot);
      scheduleIntro(() => {
        host.dataset.mimoBeat = 'awake';
        galet.emote('greet');
      }, MOTION.wakeAt);
      scheduleIntro(() => {
        host.dataset.mimoBeat = 'curious'; mascot.style.transform = `translateX(${center}px) rotate(${MOTION.tilt}deg)`;
        animate(mascot, [{transform: `translateX(${center}px) rotate(0deg)`}, {transform: mascot.style.transform}], MOTION.look);
      }, MOTION.curiousAt);
      scheduleIntro(() => {
        host.dataset.mimoBeat = 'name'; mascot.style.transform = '';
        animate(mascot, [{transform: `translateX(${center}px) rotate(${MOTION.tilt}deg)`}, {transform: 'translateX(0px) rotate(0deg)'}], MOTION.wordmark);
        animate(wordmark, [{opacity: 0, transform: `translateX(${MOTION.wordmarkX}px)`}, {opacity: 1, transform: 'translateX(0px)'}], MOTION.wordmark);
      }, MOTION.nameAt);
      scheduleIntro(() => {
        host.dataset.mimoBeat = 'ready';
        animate(mascot, [{transform: 'translateY(0px) rotate(0deg)'}, {transform: `translateY(${MOTION.settleY}px) rotate(${MOTION.settleTilt}deg)`, offset: .45}, {transform: 'translateY(0px) rotate(0deg)'}], MOTION.settle);
      }, MOTION.returnAt);
    }
    function moveSlide(slide, entering, direction = 1) {
      animate(slide.layer, [{opacity:entering?0:1,filter:entering?'blur(14px)':'blur(0px)',transform:`translateX(${entering?direction*16:0}px)`},{opacity:entering?1:0,filter:entering?'blur(0px)':'blur(14px)',transform:`translateX(${entering?0:-direction*16}px)`}],entering?MOTION.slide:MOTION.exit,0,entering?MOTION.easing:'ease-in');
    }
    function revealSlide(slide,direction=1){moveSlide(slide,true,direction);reveal(slide.illustration,0,900);reveal(slide.title,150,800);reveal(slide.text,300,800);}
    function focus(control) {if (focusFrame) window.cancelAnimationFrame(focusFrame); focusFrame = 0; if (document.hidden) return; focusFrame = window.requestAnimationFrame(() => {focusFrame = 0; if (active && !disposed && !document.hidden) control?.focus({preventScroll: true});});}
    function render() {
      for (const [element, source] of sourceText) element.textContent = t(source);
      renderTitle();host.dataset.welcomeStage = stage; host.dataset.welcomeMotion = String(active && ['logo','welcome','tour'].includes(stage) && motionEnabled());
      if (stage !== 'logo') host.dataset.mimoBeat = stage === 'welcome' ? 'ready' : 'idle';
      languageChoice.value = i18n?.locale() || 'fr'; languageChoice.setAttribute('aria-label', t('Langue'));
      brand.hidden = !['logo', 'welcome'].includes(stage); intro.hidden = language.hidden = stage !== 'welcome'; tutorial.hidden = stage !== 'tour';
      galet.setMotion(motion); galet.setActive(active && ['logo','welcome'].includes(stage) && !host.hidden);
      for (const [index, slide] of slides.entries()) {slide.layer.dataset.active = String(index === step); slide.layer.inert = index !== step; slide.layer.setAttribute('aria-hidden', String(index !== step));}
      previous.disabled = step === 0; counter.textContent = `${step + 1} / ${steps.length}`;
      next.textContent = t(step === steps.length - 1 ? 'C’est parti' : 'Suivant'); next.dataset.welcomeCommand = step === steps.length - 1 ? 'finish' : 'next';
      status.textContent = stage === 'tour' ? t('Étape {step} sur {total} : {title}', {step: step + 1, total: steps.length, title: t(steps[step].title)}) : '';
    }
    function setStage(value) {
      const previousStage = stage; stage = value; render(); stageChanged(stage);
      if (stage === 'logo') greetGalet();
      else if (stage === 'welcome') {
        const staged=previousStage==='logo'&&motionEnabled();
        if(previousStage!=='logo'){reveal(mascot,0,MOTION.mascot);reveal(wordmark,100,MOTION.wordmark);}
        [...title.children].forEach((word,index)=>reveal(word,staged?COMPOSITION.titleAt+index*COMPOSITION.wordStagger:index*30,staged?COMPOSITION.reveal:MOTION.entrance));
        reveal(description,staged?COMPOSITION.descriptionAt:80,staged?COMPOSITION.copyReveal:MOTION.entrance);reveal(introActions,staged?COMPOSITION.actionsAt:120,staged?COMPOSITION.copyReveal:MOTION.entrance);reveal(language,staged?COMPOSITION.languageAt:0,staged?700:MOTION.entrance);
        if(staged){introActions.inert=true;scheduleIntro(()=>{introActions.inert=false;},COMPOSITION.actionsAt);scheduleIntro(()=>focus(introActions.firstElementChild),COMPOSITION.actionsAt+COMPOSITION.copyReveal);}
        else focus(introActions.firstElementChild);
      }
      else if (stage === 'tour') {revealSlide(slides[step]);reveal(top);reveal(tutorialActions,80);focus(next);}
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
    function hide() {active = false; host.hidden = true; host.dataset.welcomeMotion = 'false'; galet.setActive(false); clearIntroTimers(); stopAnimations(); if (focusFrame) window.cancelAnimationFrame(focusFrame); focusFrame = 0;}
    function click(event) {
      const value = event.target.closest('[data-welcome-command]'); if (!active || disposed || !value || !host.contains(value) || value.disabled || introActions.inert&&introActions.contains(value)) return;
      const command = value.dataset.welcomeCommand;
      if (command === 'start' || command === 'finish') {stopAnimations(); setStage('done'); hide(); (command === 'finish' ? tutorialFinish : start)();}
      else if (command === 'tutorial') {page = 'tutorial'; step = 0; clearIntroTimers(); stopAnimations(); setStage('tour');}
      else if (command === 'previous' || command === 'next') {
        const old = slides[step]; step = Math.max(0, Math.min(steps.length - 1, step + (command === 'previous' ? -1 : 1))); render();
        const direction = command === 'next' ? 1 : -1; moveSlide(old, false, direction); revealSlide(slides[step],direction);focus(next);
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
    return Object.freeze({show, hide, dispose: () => {if (disposed) return; hide(); disposed = true; galet.dispose(); removeLanguage?.(); languageChoice.removeEventListener('change', changeLanguage); motionObserver?.disconnect(); host.removeEventListener('click', click); host.removeEventListener('keydown', keydown); reduced.removeEventListener('change', onReducedMotion); document.removeEventListener('visibilitychange', onHidden);}, isActive: () => active, inspect: () => ({active, page, stage, step, beat: host.dataset.mimoBeat || 'idle', animating: animations.length > 0, blinking:['logo','welcome'].includes(stage)&&host.dataset.welcomeMotion==='true',mascot:galet.inspect(),disposed})});
  }
  const api = {create};
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) root.NotchyWelcome = api;
})(typeof window === 'object' ? window : null);
