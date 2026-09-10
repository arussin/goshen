(() => {
  'use strict';
  const settings = globalThis.CyberdeckSettings;
  const form = document.getElementById('controls');
  const preferences = document.getElementById('preferences');
  const status = document.getElementById('save-status');
  const error = document.getElementById('error');
  const errorMessage = document.getElementById('error-message');
  const pagePanel = document.querySelector('.page-panel');
  const pageHost = document.getElementById('page-host');
  const pageMode = document.getElementById('page-mode');
  const pageState = document.getElementById('page-state');
  const pageToggle = document.getElementById('page-toggle');
  const pageHint = document.getElementById('page-hint');
  const pageError = document.getElementById('page-error');
  const pageErrorMessage = document.getElementById('page-error-message');
  const followTab = document.getElementById('follow-tab');
  const followHint = document.getElementById('follow-hint');
  const followAccess = document.getElementById('follow-access');
  const removeCrossSiteAccess = document.getElementById('remove-cross-site-access');
  const removeAccessHint = document.getElementById('remove-access-hint');
  const pageNotice = document.getElementById('page-notice');
  const pageForget = document.getElementById('page-forget');
  const canControlPage = Boolean(globalThis.chrome?.runtime?.id && typeof globalThis.chrome?.runtime?.sendMessage === 'function');
  let current = { ...settings.defaults };
  let busy = 0;
  let version = 0;
  let automaticVersion = 0;
  let pageBusy = false;
  let pageAction = 'goshen:status';
  let page = null;
  let automaticPageUpdate = null;
  let permissionBusy = false;
  let removalBusy = false;
  let popupClosed = false;

  function render(value) {
    current = settings.normalize(value);
    document.documentElement.dataset.theme = current.theme;
    for (const name of ['enabled', 'motion', 'quips', 'respectReducedMotion']) document.getElementById(name).checked = current[name];
    for (const name of ['scanlines', 'glow', 'fontSize']) {
      const input = document.getElementById(name);
      input.value = current[name];
      showRange(input);
    }
    document.querySelectorAll('[data-theme].theme-choice').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.theme === current.theme)));
    document.querySelectorAll('button[data-layout]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.layout === current.layout)));
    document.querySelectorAll('button[data-universal-style]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.universalStyle === current.universalStyle)));
  }

  function showRange(input) {
    document.getElementById(`${input.id}-value`).textContent = `${input.value}${input.id === 'fontSize' ? ' px' : '%'}`;
    input.style.setProperty('--fill', `${((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100}%`);
  }

  function renderPage() {
    const mode = page?.mode;
    const supported = mode === 'chatgpt' || mode === 'universal';
    const enabled = page?.enabled === true;
    const persistent = page?.persistent === true;
    const working = pageBusy || permissionBusy || removalBusy;
    const needsAccess = page?.followCrossSite === true && page?.followPermissionGranted !== true;
    pagePanel.setAttribute('aria-busy', String(working));
    document.getElementById('enabled').disabled = canControlPage && working;
    pageToggle.disabled = !canControlPage || !(supported || persistent) || working;
    pageToggle.dataset.enabled = String(enabled);
    pageState.dataset.enabled = String(enabled);
    document.getElementById('chatgpt-layout-section').hidden = mode === 'universal';
    document.getElementById('universal-style-section').hidden = mode === 'chatgpt';
    document.getElementById('tab-follow').hidden = !canControlPage;
    followTab.checked = page?.followCrossSite === true;
    followTab.disabled = !canControlPage || working || !(enabled || persistent);
    followHint.textContent = followTab.checked
      ? needsAccess ? 'Cross-site following is paused. Allow website access to continue.' : 'Follows this tab across supported websites until you turn the terminal off.'
      : enabled || persistent ? 'Stays on this site after navigation and reloads.' : 'Turn on the terminal to keep this tab themed.';
    followAccess.hidden = !canControlPage || !needsAccess;
    followAccess.disabled = working;
    removeCrossSiteAccess.hidden = !canControlPage || page?.crossSiteAccessGranted !== true;
    removeCrossSiteAccess.disabled = working || removeCrossSiteAccess.hidden;
    removeAccessHint.hidden = removeCrossSiteAccess.hidden;
    pageForget.hidden = !(persistent && !enabled && supported);
    pageForget.disabled = working;
    document.getElementById('page-retry').disabled = working;

    if (!canControlPage) {
      pageHost.textContent = 'Local preview';
      pageMode.textContent = 'PREVIEW';
      pageState.textContent = 'PREVIEW';
      pageToggle.textContent = 'OPEN THE CHROME EXTENSION';
      pageHint.textContent = 'Use the Chrome extension to turn on the terminal on a website. Appearance controls work in this preview.';
      return;
    }
    if (!page) {
      pageHost.textContent = pageBusy ? 'Checking this page…' : 'Page status unavailable';
      pageMode.textContent = pageBusy ? 'CONNECTING' : 'UNAVAILABLE';
      pageState.textContent = pageBusy ? 'CHECKING' : 'UNAVAILABLE';
      pageToggle.textContent = pageBusy ? 'CHECKING PAGE…' : 'CHECK PAGE STATUS';
      pageHint.textContent = 'Open a website in this tab, then check again.';
      return;
    }
    pageHost.textContent = page.host || 'Current page';
    pageMode.textContent = mode === 'chatgpt' ? 'CHATGPT TERMINAL' : mode === 'universal' ? 'WEBSITE TERMINAL' : 'UNSUPPORTED PAGE';
    pageState.textContent = pageBusy ? (pageAction === 'goshen:status' ? 'CHECKING' : 'WORKING') : enabled ? 'ACTIVE' : persistent ? 'PAUSED' : supported ? 'OFF' : 'UNAVAILABLE';
    pageToggle.textContent = pageBusy
      ? (pageAction === 'goshen:status' ? 'CHECKING PAGE…' : pageAction === 'goshen:follow' ? 'SAVING TAB SETTING…' : pageAction === 'goshen:remove-cross-site-access' ? 'REMOVING CROSS-SITE ACCESS…' : pageAction === 'goshen:disable' ? 'TURNING TERMINAL OFF…' : 'TURNING TERMINAL ON…')
      : enabled || !supported && persistent ? 'TERMINAL OFF' : supported ? 'TERMINAL ON' : 'TERMINAL UNAVAILABLE';
    pageHint.textContent = !supported
      ? (page.reason || 'Chrome does not allow extensions to change this page. Open a regular website to use the terminal.')
      : mode === 'chatgpt'
        ? 'Your ChatGPT terminal. Control automatic startup below.'
        : persistent ? (page.followCrossSite && !needsAccess ? 'The theme follows this tab across supported websites. Turn it off to restore the page.' : 'The theme stays on this tab during same-site navigation. Turn it off to restore the page.') : 'Turn on the terminal for this tab. It will stay on as you navigate this site.';
    if (!supported && persistent) pageHint.textContent += ' Your tab setting is paused here; TERMINAL OFF clears it.';
  }

  async function requestPage(type, options = {}) {
    if (!canControlPage || pageBusy || popupClosed) return false;
    pageBusy = true;
    pageAction = type;
    pageError.hidden = true;
    pageNotice.hidden = true;
    renderPage();
    try {
      let reply;
      try { reply = await globalThis.chrome.runtime.sendMessage({ type, ...options, ...(Number.isInteger(page?.tabId) ? { expectedTabId: page.tabId } : {}) }); }
      catch { throw new Error('Could not connect to the terminal. Reload the extension and reopen this panel.'); }
      if (popupClosed) return false;
      if (!reply?.ok) throw new Error(reply?.error || 'Could not reach the terminal. Reload the extension, then check again.');
      if (type === 'goshen:remove-cross-site-access') {
        if (reply.crossSiteAccessRemoved !== true || reply.followPermissionGranted !== false || reply.crossSiteAccessGranted !== false) throw new Error('Could not confirm that cross-site access was removed. Check again.');
        page = { ...page, followCrossSite: false, followPermissionGranted: false, crossSiteAccessGranted: false };
        return true;
      }
      if (!['chatgpt', 'universal', 'unsupported'].includes(reply.mode)) throw new Error('Could not read this page’s status. Check again.');
      page = {
        mode: reply.mode,
        host: typeof reply.host === 'string' ? reply.host : '',
        enabled: reply.enabled === true,
        tabId: Number.isInteger(reply.tabId) ? reply.tabId : null,
        persistent: reply.persistent === true,
        followCrossSite: reply.followCrossSite === true,
        followPermissionGranted: reply.followPermissionGranted === true,
        crossSiteAccessGranted: typeof reply.crossSiteAccessGranted === 'boolean' ? reply.crossSiteAccessGranted : reply.followPermissionGranted === true,
        reason: typeof reply.reason === 'string' ? reply.reason : '',
      };
      return true;
    } catch (cause) {
      if (popupClosed) return false;
      if (type === 'goshen:status') page = null;
      pageErrorMessage.textContent = cause?.message || 'Could not change this page. Check again.';
      pageError.hidden = false;
      return false;
    } finally {
      pageBusy = false;
      if (!popupClosed) { renderPage(); reconcileAutomaticPage(); }
    }
  }

  function reconcileAutomaticPage() {
    if (automaticPageUpdate === null || pageBusy || permissionBusy || removalBusy || !page || popupClosed) return;
    const enabled = automaticPageUpdate;
    automaticPageUpdate = null;
    if (page.mode === 'chatgpt') void requestPage(enabled ? 'goshen:status' : 'goshen:disable');
  }

  function showError(cause) {
    status.textContent = 'SAVE UNAVAILABLE';
    errorMessage.textContent = cause?.message || 'Could not save preferences. Reload the extension and try again.';
    error.hidden = false;
  }

  async function persist(patch) {
    const request = ++version;
    const automaticRequest = Object.prototype.hasOwnProperty.call(patch, 'enabled') ? ++automaticVersion : 0;
    busy += 1;
    status.textContent = 'SAVING…';
    error.hidden = true;
    render({ ...current, ...patch });
    try {
      const saved = await settings.save(patch);
      if (request === version) { render(saved); status.textContent = 'PREFERENCES SAVED'; }
      if (automaticRequest && automaticRequest === automaticVersion) {
        automaticPageUpdate = saved.enabled === true;
        reconcileAutomaticPage();
      }
    } catch (cause) {
      if (request === version) showError(cause);
    } finally {
      busy -= 1;
    }
  }

  async function initializePreferences() {
    preferences.disabled = true;
    status.textContent = 'LOADING PREFERENCES';
    error.hidden = true;
    try {
      render(await settings.load());
      preferences.disabled = false;
      status.textContent = 'PREFERENCES LOADED';
    } catch (cause) { showError(cause); }
  }

  pageToggle.addEventListener('click', () => {
    if (!page || pageToggle.disabled) return;
    void requestPage(page.enabled || page.mode === 'unsupported' && page.persistent ? 'goshen:disable' : 'goshen:enable');
  });
  pageForget.addEventListener('click', () => { void requestPage('goshen:disable'); });
  async function requestFollowAccess() {
    if (pageBusy || permissionBusy || popupClosed) return;
    permissionBusy = true;
    // Dispatch desired intent before Chrome can close this popup. Both API
    // calls happen synchronously in the gesture; no permission is inferred.
    const recorded = requestPage('goshen:follow', { followCrossSite: true });
    let permission;
    try { permission = globalThis.chrome.permissions.request({ origins: ['http://*/*', 'https://*/*'] }); }
    catch { permission = Promise.reject(new Error('Could not request website access. Reopen the extension and try again.')); }
    const outcome = Promise.resolve(permission).then(granted => ({ granted }), cause => ({ cause }));
    try {
      const saved = await recorded;
      const result = await outcome;
      if (popupClosed) return;
      if (!saved) return;
      if (result.granted) {
        // A later OFF wins: never re-send follow:true after permission returns.
        await requestPage('goshen:status');
      } else {
        await requestPage('goshen:follow', { followCrossSite: false });
        throw result.cause || new Error('Website access was not granted. The theme will continue to follow this tab on the same site.');
      }
    } catch (cause) {
      if (popupClosed) return;
      pageErrorMessage.textContent = cause.message;
      pageError.hidden = false;
    } finally {
      permissionBusy = false;
      if (!popupClosed) { renderPage(); reconcileAutomaticPage(); }
    }
  }
  followTab.addEventListener('change', () => {
    if (followTab.disabled) return;
    if (!followTab.checked) { void requestPage('goshen:follow', { followCrossSite: false }); return; }
    void requestFollowAccess();
  });
  followAccess.addEventListener('click', () => { if (!followAccess.disabled) void requestFollowAccess(); });
  removeCrossSiteAccess.addEventListener('click', async () => {
    if (removeCrossSiteAccess.disabled || popupClosed) return;
    removalBusy = true;
    renderPage();
    try {
      const removed = await requestPage('goshen:remove-cross-site-access');
      if (popupClosed) return;
      if (removed) {
        pageNotice.textContent = 'Cross-site access removed. Automatic ChatGPT access is unchanged.';
        pageNotice.hidden = false;
      } else {
        const removalError = pageErrorMessage.textContent;
        await requestPage('goshen:status');
        if (popupClosed) return;
        pageErrorMessage.textContent = removalError;
        pageError.hidden = false;
      }
    } finally {
      removalBusy = false;
      if (!popupClosed) { renderPage(); reconcileAutomaticPage(); }
    }
  });
  document.getElementById('page-retry').addEventListener('click', () => { void requestPage('goshen:status'); });
  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', event => { if (event.target.type === 'range') showRange(event.target); });
  form.addEventListener('change', event => {
    const input = event.target;
    if (input.type === 'checkbox') void persist({ [input.name]: input.checked });
    if (input.type === 'range') void persist({ [input.name]: Number(input.value) });
  });
  form.addEventListener('click', event => {
    const theme = event.target.closest('button[data-theme]');
    const layout = event.target.closest('button[data-layout]');
    const style = event.target.closest('button[data-universal-style]');
    if (theme) void persist({ theme: theme.dataset.theme });
    if (layout) void persist({ layout: layout.dataset.layout });
    if (style) void persist({ universalStyle: style.dataset.universalStyle });
  });
  document.getElementById('reset').addEventListener('click', () => { void persist(settings.defaults); });
  document.getElementById('retry').addEventListener('click', initializePreferences);
  const unsubscribe = settings.subscribe(value => {
    if (busy) return;
    const automaticChanged = current.enabled !== value.enabled;
    render(value);
    if (automaticChanged && page?.mode === 'chatgpt') void requestPage('goshen:status');
  });
  window.addEventListener('pagehide', () => { popupClosed = true; unsubscribe(); }, { once: true });
  renderPage();
  void initializePreferences();
  void requestPage('goshen:status');
})();
