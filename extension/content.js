(() => {
  'use strict';

  // All native ChatGPT nodes remain owned by ChatGPT. This script only annotates
  // them and adds a separate, removable set of controls around the page.
  const settingsAPI = globalThis.CyberdeckSettings;
  if (!settingsAPI || globalThis.CyberdeckRuntime) return;

  const root = document.documentElement;
  const isPreview = root.getAttribute('data-cd-preview') === 'true';
  const startedAt = performance.now();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const instrumentViewport = window.matchMedia('(min-width: 1200px)');
  const companion = globalThis.GoshenCompanion?.create();
  const nativeMarks = new Map();
  const nativeLoaders = new Map();
  const rootAttributes = [
    'data-cd-enabled', 'data-cd-theme', 'data-cd-layout', 'data-cd-motion',
    'data-cd-state', 'data-cd-activity', 'data-cd-has-main', 'data-cd-has-sidebar',
  ];
  const rootVariables = [
    '--cd-scanline-opacity', '--cd-glow-opacity', '--cd-font-size',
    '--cd-sidebar-width', '--cd-main-left',
  ];
  const selectors = {
    main: 'main, [role="main"]',
    prompt: '#prompt-textarea, [data-testid="prompt-textarea"]',
    composer: 'form, [data-testid="composer"], [data-testid="composer-root"], [data-type="unified-composer"]',
    stop: 'button[data-testid="stop-button"], button[data-testid="stop-generating-button"], button[aria-label="Stop generating"], button[aria-label="Stop streaming"], button[aria-label="Stop response"], button[aria-label="Stop answering"]',
    send: 'button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"]',
    messages: '[data-message-author-role="user"], [data-message-author-role="assistant"]',
    loading: '.loading-shimmer-tertiary, .loading-shimmer, .loading-shimmer-primary, svg.animate-spin, [data-testid="loading-spinner"]',
  };

  let settings = { ...settingsAPI.defaults };
  let shell = null;
  let elements = {};
  let observer = null;
  let observedBody = null;
  let resizeObserver = null;
  let scanTimer = 0;
  let clockTimer = 0;
  let animationId = 0;
  let lastFrameAt = 0;
  let typingUntil = 0;
  let lastSendAt = -10000;
  let previousPath = location.pathname;
  let activeStop = false;
  let returnFocus = null;
  let destroyed = false;
  let lifecycleRevision = 0;
  let unsubscribe = () => {};

  const setText = (element, value) => {
    if (element && element.textContent !== value) element.textContent = value;
  };

  function setAttribute(element, name, value) {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }

  function applyPresentation() {
    setAttribute(root, 'data-cd-enabled', 'true');
    setAttribute(root, 'data-cd-theme', settings.theme);
    setAttribute(root, 'data-cd-layout', settings.layout);
    setAttribute(root, 'data-cd-motion', String(effectiveMotion()));
    setVariable('--cd-scanline-opacity', String(settings.scanlines / 100));
    setVariable('--cd-glow-opacity', String(settings.glow / 100));
    setVariable('--cd-font-size', `${settings.fontSize}px`);
  }

  function observePage() {
    if (!observer || observedBody === document.body) return;
    observer.disconnect();
    // React can regenerate the body and reset attributes on html during startup.
    // Keep the document-level anchor even when the previous body is detached.
    observer.observe(root, {
      childList: true, attributes: true,
      attributeFilter: ['class', 'style', 'data-cd-enabled', 'data-cd-theme', 'data-cd-layout', 'data-cd-motion'],
    });
    observedBody = document.body;
    if (observedBody) observer.observe(observedBody, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'aria-label', 'aria-busy', 'data-testid', 'disabled', 'data-state', 'data-cd-main', 'data-cd-sidebar', 'data-cd-app', 'data-cd-workspace', 'data-cd-composer'],
    });
  }

  function recoverPage() {
    if (!shell || !settings.enabled || destroyed || !document.body) return false;
    observePage();
    if (!shell.isConnected) {
      // Preserve controls and event listeners; do not create duplicate shells,
      // timers, or observers each time the site replaces part of its document.
      document.body.append(shell);
      updateClock();
      syncMotion();
    }
    applyPresentation();
    return true;
  }

  function effectiveMotion() {
    return settings.motion && (!settings.respectReducedMotion || !reducedMotion.matches);
  }

  function activity() {
    return activeStop ? 'working' : performance.now() < typingUntil ? 'typing' : 'ready';
  }

  function onInput(event) {
    const prompt = event.target?.closest?.(selectors.prompt);
    if (!prompt || prompt.closest('#cd-shell')) return;
    typingUntil = performance.now() + 2400;
    // React to the input event without reading the draft or any field value.
    renderCompanion(performance.now());
  }

  function signalSent() {
    const now = performance.now();
    if (now - lastSendAt < 400) return;
    lastSendAt = now;
    typingUntil = 0;
    companion?.react('sent', now);
    renderCompanion(now);
    scheduleScan();
  }

  function onSubmit(event) {
    const composer = nativeMarks.get('data-cd-composer');
    if (composer && event.target === composer) signalSent();
  }

  function onPageClick(event) {
    const send = event.target?.closest?.(selectors.send);
    if (send && !send.disabled && !send.closest('#cd-shell')) signalSent();
  }

  function syncLoaders(scope) {
    const candidates = new Set([...scope.querySelectorAll(selectors.loading)].filter(element => {
      if (element.closest('#cd-shell, [data-cd-owned], button, a, [contenteditable="true"], [hidden]') || !element.isConnected) return false;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || !element.getClientRects().length) return false;
      return element.matches('.loading-shimmer-tertiary, .loading-shimmer, .loading-shimmer-primary') || element.getBoundingClientRect().width <= 48;
    }));
    for (const [native, panel] of nativeLoaders) {
      if (!native.isConnected || !candidates.has(native)) {
        native.removeAttribute('data-cd-native-loader');
        panel?.remove();
        nativeLoaders.delete(native);
      }
    }
    for (const native of candidates) {
      const isText = native.matches('.loading-shimmer-tertiary, .loading-shimmer, .loading-shimmer-primary');
      setAttribute(native, 'data-cd-native-loader', isText ? 'text' : 'circle');
      if (isText) { nativeLoaders.set(native, null); continue; }
      let panel = nativeLoaders.get(native);
      if (!panel?.isConnected) {
        panel = document.createElement('span');
        panel.className = 'cd-native-light-panel';
        panel.setAttribute('data-cd-owned', 'loading-lights');
        panel.setAttribute('aria-hidden', 'true');
        panel.innerHTML = '<i></i><i></i><i></i><i></i><i></i><i></i>';
        native.parentElement?.insertBefore(panel, native);
        nativeLoaders.set(native, panel);
      }
    }
  }

  function isRendered(element) {
    if (!element || !element.isConnected || element.closest('[hidden], [aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  }

  function firstRendered(query, within = document) {
    return [...within.querySelectorAll(query)].find(element => !element.closest('#cd-shell') && isRendered(element)) || null;
  }

  function isOnscreen(element) {
    if (!isRendered(element)) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight;
  }

  function mark(name, element) {
    const previous = nativeMarks.get(name);
    if (previous === element && (!element || element.hasAttribute(name))) return;
    previous?.removeAttribute(name);
    if (element) {
      element.setAttribute(name, '');
      nativeMarks.set(name, element);
    } else {
      nativeMarks.delete(name);
    }
    if ((name === 'data-cd-main' || name === 'data-cd-sidebar' || name === 'data-cd-workspace') && resizeObserver) {
      if (previous) resizeObserver.unobserve(previous);
      if (element) resizeObserver.observe(element);
    }
  }

  function findSidebar(main) {
    const known = [...document.querySelectorAll('#history, #stage-slideover-sidebar, [data-testid="sidebar"], [data-testid="history-sidebar"], [data-sidebar="true"]')].find(isOnscreen);
    if (known && !known.contains(main)) return known;
    const historyNav = firstRendered('nav[aria-label="Chat history"], nav[aria-label="History"], nav[aria-label="Chats"]');
    if (historyNav && isOnscreen(historyNav) && !historyNav.contains(main)) {
      return historyNav.closest('aside, [data-testid="sidebar"]') || historyNav;
    }
    return [...document.querySelectorAll('aside')].find(candidate =>
      !candidate.closest('#cd-shell, [role="dialog"], dialog') &&
      !candidate.contains(main) && isOnscreen(candidate) &&
      candidate.querySelector('a[href^="/c/"], a[href^="/g/"], nav[aria-label="Chat history"]')
    ) || null;
  }

  function findApp(main, sidebar) {
    if (!main) return null;
    // The lowest common ancestor avoids accidentally framing portal dialogs and
    // extension popovers along with the app. Explicit app roots help in layouts
    // where the sidebar has been collapsed or removed.
    // ChatGPT retains the desktop sidebar node while collapsing it. Keeping
    // that structural anchor avoids framing an inner display:contents wrapper.
    const structuralSidebar = sidebar || document.querySelector('#stage-slideover-sidebar, [data-testid="sidebar"], [data-testid="history-sidebar"]');
    if (structuralSidebar && !structuralSidebar.contains(main)) {
      let candidate = main.parentElement;
      while (candidate && candidate !== document.body && candidate !== root) {
        if (candidate.contains(structuralSidebar)) return candidate;
        candidate = candidate.parentElement;
      }
    }
    const explicit = main.closest('#app, #root, #__next, [data-testid="app-root"], .stage-layout');
    if (explicit && explicit !== document.body && explicit !== root) return explicit;
    let parent = main.parentElement;
    while (parent && parent !== document.body && getComputedStyle(parent).display === 'contents') parent = parent.parentElement;
    return parent && parent !== document.body && parent !== root ? parent : main;
  }

  function findWorkspace(main, app) {
    if (!main || !app || main === app) return main;
    let candidate = main;
    while (candidate.parentElement && candidate.parentElement !== app && candidate.parentElement !== document.body) {
      candidate = candidate.parentElement;
    }
    // This encloses the native header and its scroll region as well as main.
    // Their shared reservation prevents the deck rail from covering controls.
    return candidate === app || getComputedStyle(candidate).display === 'contents' ? main : candidate;
  }

  function findComposer(main) {
    const prompt = firstRendered(selectors.prompt, main || document);
    if (!prompt) return null;
    const explicit = prompt.closest(selectors.composer);
    if (explicit && explicit !== main && !explicit.closest('dialog, [role="dialog"]')) return explicit;
    let candidate = prompt.parentElement;
    for (let depth = 0; candidate && candidate !== main && depth < 5; depth++, candidate = candidate.parentElement) {
      if (candidate.querySelector(`${selectors.send}, ${selectors.stop}`)) return candidate;
    }
    return prompt.parentElement && prompt.parentElement !== main ? prompt.parentElement : null;
  }

  function setVariable(name, value) {
    if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
  }

  function measureLayout() {
    if (!shell) return;
    const sidebar = nativeMarks.get('data-cd-sidebar');
    const main = nativeMarks.get('data-cd-workspace') || nativeMarks.get('data-cd-main');
    const sidebarWidth = isOnscreen(sidebar) ? Math.round(sidebar.getBoundingClientRect().width) : 0;
    setVariable('--cd-sidebar-width', `${sidebarWidth}px`);
    if (isRendered(main)) setVariable('--cd-main-left', `${Math.round(main.getBoundingClientRect().left)}px`);
  }

  function syncNativePage() {
    scanTimer = 0;
    if (!shell || document.hidden || !recoverPage()) return;
    const main = firstRendered(selectors.main);
    const sidebar = findSidebar(main);
    const app = findApp(main, sidebar);
    mark('data-cd-main', main);
    mark('data-cd-sidebar', sidebar);
    mark('data-cd-app', app);
    mark('data-cd-workspace', findWorkspace(main, app));
    mark('data-cd-composer', findComposer(main));
    setAttribute(root, 'data-cd-has-main', String(Boolean(main)));
    setAttribute(root, 'data-cd-has-sidebar', String(Boolean(sidebar)));

    const scope = main || document;
    syncLoaders(scope);
    const stop = [...scope.querySelectorAll(selectors.stop)].find(isOnscreen);
    // Visible generation controls provide a coarse activity signal. Neither
    // prompt nor response text is read to infer what the model is doing.
    const wasActive = activeStop;
    activeStop = Boolean(stop);
    if (wasActive && !activeStop) companion?.react('complete', performance.now());
    if (location.pathname !== previousPath) {
      previousPath = location.pathname;
      typingUntil = 0;
      companion?.react('navigate', performance.now());
    }
    const state = stop ? 'working' : 'ready';
    setAttribute(shell, 'data-state', state);
    setAttribute(root, 'data-cd-state', state);
    setText(elements.state, state.toUpperCase());
    setText(elements.messageCount, String([...scope.querySelectorAll(selectors.messages)].filter(isRendered).length).padStart(2, '0'));
    renderCompanion(performance.now());
    measureLayout();
  }

  function scheduleScan() {
    if (shell && !scanTimer && !document.hidden) scanTimer = window.setTimeout(syncNativePage, 120);
  }

  function nativeMutation(records) {
    // Animation, clock, controls, and modal writes must not cause us to rescan
    // ChatGPT. Streaming native updates are coalesced into at most ~8 scans/sec.
    if (records.some(record => {
      const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
      return target && target !== shell && !shell?.contains(target) && !target.closest?.('[data-cd-owned]');
    })) scheduleScan();
  }

  function formatElapsed() {
    const seconds = Math.floor((performance.now() - startedAt) / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return [hours, minutes, seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
  }

  function updateClock() {
    if (!shell || document.hidden) return;
    setText(elements.elapsed, formatElapsed());
    setText(elements.clock, new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    renderCompanion(performance.now());
  }

  const waveformFrames = [
    '___._/\\_.___/\\__._/\\_.___._',
    '__._/\\_.___/\\__._/\\_.___._.',
    '_._/\\_.___/\\__._/\\_.___._._',
    '._/\\_.___/\\__._/\\_.___._.__',
  ];

  function renderCompanion(now) {
    if (!shell) return;
    const current = activity();
    setAttribute(shell, 'data-activity', current);
    setAttribute(root, 'data-cd-activity', current);
    setText(elements.state, current.toUpperCase());
    const resident = companion?.frame({ now, activity: current, motion: Boolean(canAnimate()), quips: settings.quips });
    if (resident) {
      setText(elements.ascii, resident.art);
      setText(elements.companionLabel, resident.label);
      setText(elements.quip, resident.quip);
      elements.quip.hidden = !settings.quips;
      setAttribute(elements.petButton, 'data-mood', resident.mood);
    }
    const moving = canAnimate();
    const wave = Math.floor(now / 220) % waveformFrames.length;
    setText(elements.waveform, moving && current !== 'ready' ? waveformFrames[wave] : '____.____.____.____.____.____');
  }

  function canAnimate() {
    return shell && effectiveMotion() && settings.layout !== 'focus' && instrumentViewport.matches && !document.hidden;
  }

  function animate(now) {
    animationId = 0;
    if (!canAnimate()) return;
    if (now - lastFrameAt >= 120) {
      renderCompanion(now);
      lastFrameAt = now;
    }
    animationId = requestAnimationFrame(animate);
  }

  function syncMotion() {
    if (!shell) return;
    setAttribute(root, 'data-cd-motion', String(effectiveMotion()));
    setAttribute(shell, 'data-paused', String(document.hidden));
    if (animationId) cancelAnimationFrame(animationId);
    animationId = 0;
    if (canAnimate()) animationId = requestAnimationFrame(animate);
    renderCompanion(performance.now());
  }

  function syncControls() {
    if (!shell) return;
    shell.querySelectorAll('[data-setting]').forEach(control => {
      const value = settings[control.dataset.setting];
      if (control.type === 'checkbox') control.checked = value;
      else control.value = String(value);
      const output = shell.querySelector(`[data-output="${control.dataset.setting}"]`);
      if (output) setText(output, `${value}${control.dataset.setting === 'fontSize' ? ' px' : '%'}`);
    });
    shell.querySelectorAll('.cd-theme-choice').forEach(button => {
      const active = button.dataset.theme === settings.theme;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('is-active', active);
    });
    const focus = settings.layout === 'focus';
    elements.focusButton.setAttribute('aria-pressed', String(focus));
    setText(elements.focusButton, focus ? 'EXIT FOCUS' : 'FOCUS MODE');
  }

  function applySettings(next) {
    if (destroyed) return;
    lifecycleRevision += 1;
    settings = settingsAPI.normalize(next);
    if (!settings.enabled) { unmount(); return; }
    if (!document.body) return;
    if (!shell) mount();
    recoverPage();
    syncControls();
    syncMotion();
    scheduleScan();
  }

  async function saveSettings(patch) {
    lifecycleRevision += 1;
    try {
      const saved = await settingsAPI.save(patch);
      applySettings(saved);
      // Only an explicit power gesture clears this tab's navigation setting.
      // Storage broadcasts and controller cleanup must leave other tabs alone.
      if (patch.enabled === false) {
        try { await globalThis.chrome?.runtime?.sendMessage?.({ type: 'goshen:page-off' }); }
        catch { /* Local preview or an extension reloaded while this page was open. */ }
      }
      if (shell) setText(elements.settingsStatus, 'SAVED ON THIS DEVICE');
    } catch {
      if (shell) setText(elements.settingsStatus, 'COULD NOT SAVE. TRY AGAIN.');
    }
  }

  function openSettings() {
    if (!shell || elements.dialog.open) return;
    returnFocus = document.activeElement;
    elements.dialog.showModal();
  }

  function closeSettings() {
    if (elements.dialog?.open) elements.dialog.close();
  }

  function toggleFocus() {
    void saveSettings({ layout: settings.layout === 'focus' ? 'deck' : 'focus' });
  }

  function onKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !event.repeat && event.target?.closest?.(selectors.prompt)) signalSent();
    if (!event.repeat && event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyF') {
      event.preventDefault();
      toggleFocus();
    }
  }

  function onVisibilityChange() {
    syncMotion();
    if (!document.hidden) {
      updateClock();
      scheduleScan();
    }
  }

  async function onPageShow(event) {
    if (!event.persisted || destroyed) return;
    // A cached document can predate an OFF gesture on a later page in this tab.
    unmount();
    const revision = ++lifecycleRevision;
    const [saved, intent] = await Promise.all([
      settingsAPI.load().catch(() => ({ ...settings, enabled: false })),
      (async () => {
        try { return await globalThis.chrome?.runtime?.sendMessage?.({ type: 'goshen:restore-intent' }); }
        catch { return null; }
      })(),
    ]);
    if (destroyed || revision !== lifecycleRevision) return;
    applySettings({ ...saved, enabled: saved.enabled === true || intent?.ok === true && intent.enabled === true });
  }

  function mount() {
    shell = document.createElement('div');
    shell.id = 'cd-shell';
    shell.className = 'cd-shell';
    shell.dataset.version = '0.3.6';
    shell.innerHTML = `
      <header class="cd-topbar">
        <div class="cd-brand"><span class="cd-brand-icon" aria-hidden="true">▥</span><span class="cd-brand-name">TERMINAL</span><span class="cd-model">GT—01</span></div>
        <div class="cd-topbar-center"><span class="cd-bus-lights" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span> PERSONAL COMPUTING / REIMAGINED</div>
        <div class="cd-topbar-actions"><span class="cd-live"><span class="cd-dot" aria-hidden="true"></span>${isPreview ? 'DEMO CONTENT' : 'LIVE SESSION'}</span><button type="button" class="cd-settings-button" aria-haspopup="dialog">TUNE TERMINAL <span aria-hidden="true">↗</span></button></div>
      </header>
      <div class="cd-workspace-label" aria-hidden="true"><span class="cd-panel-number">01</span><span class="cd-workspace-title">CONVERSATION TERMINAL</span><span class="cd-workspace-meta">UTF-8 / INTERACTIVE</span></div>
      <aside class="cd-rail" aria-label="Terminal instruments">
        <section class="cd-module cd-signal-module">
          <h2 class="cd-module-heading"><span>02</span> RESIDENT / HOPPER <span class="cd-module-corner" aria-hidden="true">↗</span></h2>
          <div class="cd-module-body">
            <div class="cd-signal-header"><span class="cd-state" role="status" aria-live="polite">READY</span><span class="cd-signal-light" aria-hidden="true"></span></div>
            <button type="button" class="cd-pet-button" aria-label="Pet HOPPER" title="Give HOPPER a headpat"><pre class="cd-ascii cd-rabbit" aria-hidden="true"></pre></button>
            <div class="cd-signal-caption cd-companion-label">HOPPER / STANDBY</div>
            <p class="cd-quip" aria-live="off"></p>
            <div class="cd-link-lights" aria-hidden="true"><span>RX <i></i><i></i><i></i></span><span>TX <i></i><i></i><i></i></span><span>SYS <i></i></span></div>
            <pre class="cd-waveform" aria-hidden="true"></pre>
            <p class="cd-signal-note">Resident rabbit · click for a headpat</p>
          </div>
        </section>
        <section class="cd-module cd-session-module">
          <h2 class="cd-module-heading"><span>03</span> SESSION</h2>
          <div class="cd-module-body"><dl class="cd-stats">
            <div><dt>LOADED MESSAGES</dt><dd class="cd-message-count">00</dd></div>
            <div><dt>TERMINAL UPTIME</dt><dd class="cd-elapsed">00:00:00</dd></div>
            <div><dt>LOCAL TIME</dt><dd class="cd-clock">--:--:--</dd></div>
          </dl></div>
        </section>
        <section class="cd-module cd-phosphor-module">
          <h2 class="cd-module-heading"><span>04</span> PHOSPHOR</h2>
          <div class="cd-module-body">
            <div class="cd-theme-options" aria-label="Phosphor color">
              <button type="button" class="cd-theme-choice" data-theme="amber" aria-label="Amber phosphor" title="Amber phosphor"><span class="cd-swatch" aria-hidden="true"></span>AMBER</button>
              <button type="button" class="cd-theme-choice" data-theme="green" aria-label="Green phosphor" title="Green phosphor"><span class="cd-swatch" aria-hidden="true"></span>GREEN</button>
              <button type="button" class="cd-theme-choice" data-theme="ice" aria-label="Ice phosphor" title="Ice phosphor"><span class="cd-swatch" aria-hidden="true"></span>ICE</button>
            </div>
            <div class="cd-tubes" aria-hidden="true"><div class="cd-tube"><i></i></div><div class="cd-tube"><i></i></div><div class="cd-tube"><i></i></div></div>
            <div class="cd-tube-caption" aria-hidden="true"><span>V—01</span><span>V—02</span><span>V—03</span></div>
            <div class="cd-hardware-note"><span aria-hidden="true">◆</span> ALL SYSTEMS LOCAL</div>
          </div>
        </section>
        <div class="cd-rail-signature" aria-hidden="true">PHOSPHOR INTERFACE<br><span>DESIGNED FOR THE HUMAN AT THE KEYS.</span></div>
      </aside>
      <footer class="cd-statusbar"><div class="cd-status-left"><span class="cd-dot" aria-hidden="true"></span>TERMINAL ONLINE</div><div class="cd-status-center">${isPreview ? 'DEMO CONVERSATION' : 'CHATGPT / PERSONAL TERMINAL'}</div><div class="cd-status-right"><span class="cd-key-hint"><kbd>ALT</kbd> <kbd>SHIFT</kbd> <kbd>F</kbd></span><button type="button" class="cd-focus-button" aria-pressed="false">FOCUS MODE</button></div></footer>
      <dialog class="cd-settings" aria-labelledby="cd-settings-title">
        <div class="cd-settings-heading"><div><span class="cd-settings-eyebrow">GT—01 / CONFIGURATION</span><h2 id="cd-settings-title">TUNE YOUR TERMINAL</h2></div><button type="button" class="cd-close-settings" aria-label="Close terminal settings">×</button></div>
        <div class="cd-settings-controls">
          <label class="cd-control cd-toggle" for="cd-setting-enabled"><span>Terminal power<small>Skin the ChatGPT interface</small></span><input id="cd-setting-enabled" type="checkbox" data-setting="enabled"></label>
          <label class="cd-control" for="cd-setting-theme"><span>Phosphor color</span><select id="cd-setting-theme" data-setting="theme"><option value="amber">Amber / classic terminal</option><option value="green">Green / mainframe</option><option value="ice">Ice / deep space</option></select></label>
          <label class="cd-control" for="cd-setting-layout"><span>Workspace</span><select id="cd-setting-layout" data-setting="layout"><option value="deck">Full deck</option><option value="focus">Focus terminal</option></select></label>
          <label class="cd-control cd-range" for="cd-setting-fontSize"><span>Text size <output for="cd-setting-fontSize" data-output="fontSize">15 px</output></span><input id="cd-setting-fontSize" type="range" min="13" max="20" step="1" data-setting="fontSize"></label>
          <label class="cd-control cd-range" for="cd-setting-scanlines"><span>Scanlines <output for="cd-setting-scanlines" data-output="scanlines">18%</output></span><input id="cd-setting-scanlines" type="range" min="0" max="40" step="1" data-setting="scanlines"></label>
          <label class="cd-control cd-range" for="cd-setting-glow"><span>Phosphor glow <output for="cd-setting-glow" data-output="glow">35%</output></span><input id="cd-setting-glow" type="range" min="0" max="60" step="1" data-setting="glow"></label>
          <label class="cd-control cd-toggle" for="cd-setting-motion"><span>Ambient animation<small>Rabbit, signal lights, and warm tubes</small></span><input id="cd-setting-motion" type="checkbox" data-setting="motion"></label>
          <label class="cd-control cd-toggle" for="cd-setting-quips"><span>Rabbit quips<small>A little company at the terminal</small></span><input id="cd-setting-quips" type="checkbox" data-setting="quips"></label>
          <label class="cd-control cd-toggle" for="cd-setting-respectReducedMotion"><span>Follow system reduced motion<small>Let your device pause the animation</small></span><input id="cd-setting-respectReducedMotion" type="checkbox" data-setting="respectReducedMotion"></label>
        </div>
        <div class="cd-settings-footer"><button type="button" class="cd-reset-settings">RESTORE DEFAULTS</button><span class="cd-settings-status" role="status">SAVED ON THIS DEVICE</span></div>
      </dialog>`;
    document.body.append(shell);
    elements = {
      state: shell.querySelector('.cd-state'),
      ascii: shell.querySelector('.cd-ascii'),
      petButton: shell.querySelector('.cd-pet-button'),
      companionLabel: shell.querySelector('.cd-companion-label'),
      quip: shell.querySelector('.cd-quip'),
      waveform: shell.querySelector('.cd-waveform'),
      messageCount: shell.querySelector('.cd-message-count'),
      elapsed: shell.querySelector('.cd-elapsed'),
      clock: shell.querySelector('.cd-clock'),
      dialog: shell.querySelector('.cd-settings'),
      focusButton: shell.querySelector('.cd-focus-button'),
      settingsStatus: shell.querySelector('.cd-settings-status'),
    };
    renderCompanion(performance.now());
    setText(elements.waveform, '____.____.____.____.____.____');
    shell.querySelector('.cd-settings-button').addEventListener('click', openSettings);
    shell.querySelector('.cd-close-settings').addEventListener('click', closeSettings);
    elements.petButton.addEventListener('click', () => { companion?.react('pet', performance.now()); renderCompanion(performance.now()); });
    shell.querySelector('.cd-reset-settings').addEventListener('click', () => { void saveSettings(settingsAPI.defaults); });
    elements.focusButton.addEventListener('click', toggleFocus);
    elements.dialog.addEventListener('close', () => {
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      returnFocus = null;
    });
    elements.dialog.addEventListener('click', event => {
      if (event.target !== elements.dialog) return;
      const rect = elements.dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeSettings();
    });
    shell.querySelectorAll('.cd-theme-choice').forEach(button => button.addEventListener('click', () => { void saveSettings({ theme: button.dataset.theme }); }));
    shell.querySelectorAll('[data-setting]').forEach(control => {
      control.addEventListener('input', () => {
        if (control.type !== 'range') return;
        const key = control.dataset.setting;
        // Immediate local feedback; storage writes happen once on change.
        applySettings({ ...settings, [key]: Number(control.value) });
      });
      control.addEventListener('change', () => {
        const value = control.type === 'checkbox' ? control.checked : control.type === 'range' ? Number(control.value) : control.value;
        void saveSettings({ [control.dataset.setting]: value });
      });
    });
    observer = new MutationObserver(nativeMutation);
    observePage();
    if ('ResizeObserver' in window) resizeObserver = new ResizeObserver(measureLayout);
    window.addEventListener('resize', scheduleScan);
    document.addEventListener('visibilitychange', onVisibilityChange);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('input', onInput, true);
    document.addEventListener('submit', onSubmit, true);
    document.addEventListener('click', onPageClick, true);
    reducedMotion.addEventListener('change', syncMotion);
    instrumentViewport.addEventListener('change', syncMotion);
    clockTimer = window.setInterval(updateClock, 1000);
    updateClock();
  }

  function unmount() {
    if (!shell) return;
    observer?.disconnect();
    resizeObserver?.disconnect();
    observer = null;
    observedBody = null;
    resizeObserver = null;
    clearTimeout(scanTimer);
    clearInterval(clockTimer);
    if (animationId) cancelAnimationFrame(animationId);
    scanTimer = clockTimer = animationId = 0;
    window.removeEventListener('resize', scheduleScan);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('submit', onSubmit, true);
    document.removeEventListener('click', onPageClick, true);
    reducedMotion.removeEventListener('change', syncMotion);
    instrumentViewport.removeEventListener('change', syncMotion);
    if (elements.dialog.open) elements.dialog.close();
    shell.remove();
    shell = null;
    elements = {};
    for (const [name, element] of nativeMarks) element.removeAttribute(name);
    nativeMarks.clear();
    for (const [native, panel] of nativeLoaders) { native.removeAttribute('data-cd-native-loader'); panel?.remove(); }
    nativeLoaders.clear();
    rootAttributes.forEach(name => root.removeAttribute(name));
    rootVariables.forEach(name => root.style.removeProperty(name));
    activeStop = false;
    typingUntil = 0;
    companion?.reset(performance.now());
    returnFocus = null;
  }

  globalThis.CyberdeckRuntime = Object.freeze({
    refresh: scheduleScan,
    applyPreferences: applySettings,
    destroy() {
      destroyed = true;
      lifecycleRevision += 1;
      unmount();
      unsubscribe();
      window.removeEventListener('pageshow', onPageShow);
      delete globalThis.CyberdeckRuntime;
    },
  });

  window.addEventListener('pageshow', onPageShow);

  async function initialize() {
    let loaded;
    try { loaded = await settingsAPI.load(); }
    catch { loaded = { ...settingsAPI.defaults }; }
    if (destroyed) return;
    unsubscribe = settingsAPI.subscribe(applySettings);
    // An early activation, OFF, or cached-page reconciliation can arrive while
    // storage is loading. Leave that newer operation entirely in control.
    if (lifecycleRevision === 0) applySettings(loaded);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else void initialize();
})();
