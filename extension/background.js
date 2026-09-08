/* User-invoked tab control. Only active intent (tab ID + origin + follow flag)
   lives in memory-backed session storage; no paths or browsing history. */
'use strict';
importScripts('sites.js', 'settings.js');

const tabOperations = new Map();
const commands = new Set(['goshen:status', 'goshen:enable', 'goshen:disable', 'goshen:follow']);
const SESSION_KEY = 'goshen.tab-intents';
const FOLLOW_ORIGINS = ['http://*/*', 'https://*/*'];
const intents = new Map();
const generations = new Map();
const closedTabs = new Set();
const pendingAuto = new Map();
const deferredAuto = new Map();
const replacedTabs = new Map();
const suppressedTabs = new Set();
const lastDocuments = new Map();
const earlyNavigation = new Map();
const readinessSignals = new Map();
const EARLY_RETRY_DELAYS = [40, 80, 160, 320, 640, 1000, 1500];
let sessionWrites = Promise.resolve();
const ready = chrome.storage.session.get(SESSION_KEY).then(stored => {
  for (const [key, value] of Object.entries(stored[SESSION_KEY] || {})) {
    const id = Number(key);
    if (!Number.isInteger(id) || id < 0 || !value || typeof value.origin !== 'string') continue;
    try {
      const origin = new URL(value.origin);
      if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== value.origin) continue;
      intents.set(id, { origin: origin.origin, followCrossSite: value.followCrossSite === true });
    } catch { /* Discard malformed session state. */ }
  }
});

function persistIntents() {
  const operation = sessionWrites.catch(() => {}).then(() => chrome.storage.session.set({
    [SESSION_KEY]: Object.fromEntries(intents),
  }));
  sessionWrites = operation;
  return operation;
}

function generation(id) { return generations.get(id) || 0; }
function clearEarlyNavigation(id, version) {
  const navigation = earlyNavigation.get(id);
  if (!navigation || version !== undefined && navigation.version !== version) return;
  clearTimeout(navigation.timer);
  earlyNavigation.delete(id);
}
function cancelTab(id) { clearEarlyNavigation(id); readinessSignals.delete(id); deferredAuto.delete(id); generations.set(id, generation(id) + 1); }
function currentOperation(id, version) {
  return () => { if (closedTabs.has(id) || generation(id) !== version) throw new Error('GOSHEN_CANCELED'); };
}

function queueOperation(id, action) {
  const prior = tabOperations.get(id) || Promise.resolve();
  const operation = prior.catch(() => {}).then(action);
  tabOperations.set(id, operation);
  void operation.finally(() => { if (tabOperations.get(id) === operation) tabOperations.delete(id); }).catch(() => {});
  return operation;
}

async function clearIntent(id) {
  let current = id;
  const seen = new Set();
  while (replacedTabs.has(current) && !seen.has(current)) { seen.add(current); current = replacedTabs.get(current); }
  suppressedTabs.add(id);
  suppressedTabs.add(current);
  if (current !== id) cancelTab(current);
  await ready;
  const removed = intents.delete(id);
  const removedCurrent = current !== id && intents.delete(current);
  if (removed || removedCurrent) await persistIntents();
}

async function withIntent(response, id) {
  const followPermissionGranted = await chrome.permissions.contains({ origins: FOLLOW_ORIGINS }).catch(() => false);
  const intent = intents.get(id);
  const persistent = Boolean(intent);
  return {
    ...response,
    persistent,
    followCrossSite: intent?.followCrossSite === true,
    followPermissionGranted,
    persistencePaused: persistent && !response.enabled,
  };
}

// These functions are serialized into the extension's isolated world. Keep them
// self-contained; they never run in the website's own JavaScript environment.
function readPageState(mode, origin, requireReady, readinessToken) {
  if (location.origin !== origin) return { navigated: true };
  if (!['text/html', 'application/xhtml+xml'].includes(document.contentType)) return { unsupported: 'The terminal works on web pages. Standalone images, PDFs, and other document viewers keep their own appearance.' };
  if (requireReady && (!document.documentElement || !document.body || document.readyState === 'loading')) {
    if (readinessToken && globalThis.GoshenDOMReadyNotifier?.token !== readinessToken) {
      globalThis.GoshenDOMReadyNotifier?.cancel();
      const notifier = {
        token: readinessToken,
        cancel() {
          document.removeEventListener('readystatechange', notify);
          document.removeEventListener('DOMContentLoaded', notify);
          globalThis.removeEventListener('pagehide', notifier.cancel);
          if (globalThis.GoshenDOMReadyNotifier === notifier) delete globalThis.GoshenDOMReadyNotifier;
        },
      };
      function notify() {
        if (!document.documentElement || !document.body || document.readyState === 'loading') return;
        notifier.cancel();
        try {
          chrome.runtime.sendMessage({ type: 'goshen:document-ready', token: readinessToken })?.catch?.(() => {});
        } catch { /* The extension may have been reloaded while this page parsed. */ }
      }
      globalThis.GoshenDOMReadyNotifier = notifier;
      document.addEventListener('readystatechange', notify);
      document.addEventListener('DOMContentLoaded', notify);
      globalThis.addEventListener('pagehide', notifier.cancel, { once: true });
    }
    // Never return a pending Promise: readiness must not hold up the OFF queue.
    return { notReady: true };
  }
  if (mode === 'chatgpt') {
    return {
      readyState: document.readyState,
      available: Boolean(globalThis.CyberdeckRuntime),
      stale: Boolean(globalThis.CyberdeckRuntime && !globalThis.CyberdeckRuntime.applyPreferences),
      enabled: document.documentElement?.getAttribute('data-cd-enabled') === 'true',
    };
  }
  return { readyState: document.readyState, available: Boolean(globalThis.GoshenUniversal), ...(globalThis.GoshenUniversal?.status() || { enabled: false }) };
}

async function changePageState(mode, origin, enabled, preferences) {
  if (location.origin !== origin) return { navigated: true };
  if (!enabled) globalThis.GoshenDOMReadyNotifier?.cancel();
  if (mode === 'chatgpt') {
    if (!enabled && !globalThis.CyberdeckRuntime) return { enabled: false };
    if (!globalThis.CyberdeckRuntime?.applyPreferences) return { stale: true };
    globalThis.CyberdeckRuntime.applyPreferences(preferences);
    return { enabled: document.documentElement.getAttribute('data-cd-enabled') === 'true' };
  }
  if (!globalThis.GoshenUniversal) return enabled ? { missing: true } : { enabled: false };
  if (enabled) await globalThis.GoshenUniversal.enable();
  else await globalThis.GoshenUniversal.disable();
  return globalThis.GoshenUniversal.status();
}

function pageError(value) {
  if (!value || value.missing) throw new Error('GOSHEN_NO_RESULT');
  if (value.notReady) throw new Error('GOSHEN_DOM_NOT_READY');
  if (value?.navigated) throw new Error('GOSHEN_PAGE_CHANGED');
  if (value?.stale) throw new Error('GOSHEN_REFRESH_REQUIRED');
  return value;
}

function friendlyError(error) {
  const message = String(error?.message || '');
  if (/GOSHEN_CANCELED/i.test(message)) return 'This activation was canceled by a page change or by turning the terminal off.';
  if (/GOSHEN_DOM_NOT_READY|GOSHEN_PRECOMMIT/i.test(message)) return 'This page is still starting. Try turning on the terminal again in a moment.';
  if (/GOSHEN_FOLLOW_PERMISSION/i.test(message)) return 'Allow website access to follow this tab across sites. Same-site navigation still works without it.';
  if (/GOSHEN_ENTER_FIRST/i.test(message)) return 'Turn on the terminal on this tab first, then choose whether it follows you across sites.';
  if (/GOSHEN_REFRESH_REQUIRED|Extension context invalidated/i.test(message)) return 'Refresh this page to finish updating the terminal.';
  if (/GOSHEN_PAGE_CHANGED|No tab|No document|No frame|Frame.*removed|document.*removed/i.test(message)) return 'This page changed during activation. Open the terminal controls again on the page you want.';
  if (/Cannot access|cannot be scripted|Missing host permission|extensions gallery|not allowed/i.test(message)) return 'Chrome cannot theme this page. Try a regular website and reopen the terminal controls.';
  return 'Could not update this tab. Refresh the page and try the terminal again.';
}

async function runOnTab(tab, command, { automatic = false, check = () => {}, previousDocumentId, expectedDocumentId } = {}) {
  check();
  const site = GoshenSites.resolve(tab.url);
  const response = { ok: true, tabId: tab.id, host: site.host, mode: site.mode, enabled: false };
  if (site.mode === 'unsupported') return { ...response, reason: site.reason };
  let readiness;
  if (automatic && command === 'goshen:enable') {
    readiness = readinessSignals.get(tab.id);
    if (!readiness || readiness.version !== generation(tab.id)) {
      readiness = { version: generation(tab.id), token: crypto.randomUUID(), documentId: null, previousDocumentId, signaled: false };
      readinessSignals.set(tab.id, readiness);
    }
  }

  // Pin subsequent actions to the document we inspected. A redirect or reload
  // must not unexpectedly apply this site's adapter to another document.
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, frameIds: [0] }, world: 'ISOLATED', injectImmediately: true,
    func: readPageState, args: [site.mode, site.origin, command === 'goshen:enable', readiness?.token ?? null],
  });
  const frame = results.find(result => result.frameId === 0) || results[0];
  if (!frame?.documentId) throw new Error('GOSHEN_PAGE_CHANGED');
  if (expectedDocumentId && frame.documentId !== expectedDocumentId) throw new Error('GOSHEN_PAGE_CHANGED');
  if (readiness) readiness.documentId = frame.documentId;
  if (frame.result?.unsupported) return { ...response, mode: 'unsupported', reason: frame.result.unsupported };
  const previous = pageError(frame.result);
  check();
  const navigation = earlyNavigation.get(tab.id);
  if (automatic && !expectedDocumentId && tab.status === 'loading' && navigation?.watchPrevious && !navigation.previousDocumentId && previous.available && previous.enabled) {
    // The worker may have restarted since this existing deck was enabled.
    navigation.previousDocumentId = frame.documentId;
    if (readiness) readiness.previousDocumentId = frame.documentId;
    throw new Error('GOSHEN_PRECOMMIT');
  }
  // A loading notification can still expose the previous committed document,
  // including on same-URL reloads. Never apply a new activation to that page.
  if (automatic && tab.status === 'loading' && (frame.documentId === previousDocumentId ||
    previous.readyState === 'complete' && !expectedDocumentId && !previousDocumentId)) throw new Error('GOSHEN_PRECOMMIT');
  if (command === 'goshen:enable' || intents.has(tab.id)) lastDocuments.set(tab.id, frame.documentId);
  const target = { tabId: tab.id, documentIds: [frame.documentId] };
  if (command === 'goshen:status') return { ...response, enabled: Boolean(previous.enabled), style: previous.style };

  const enabled = command === 'goshen:enable';
  if (enabled && previous.enabled && previous.available) return { ...response, enabled: true, style: previous.style };
  const adapter = GoshenSites.adapters[site.mode];
  let inserted = false;
  try {
    if (enabled && (site.mode === 'universal' || !previous.available)) {
      // Remove our previous sheet first so repeated enable actions cannot
      // accumulate duplicate style sheets after the service worker restarts.
      if (previous.available || !automatic) await chrome.scripting.removeCSS({ target, files: adapter.styles, origin: 'AUTHOR' });
      check();
      await chrome.scripting.insertCSS({ target, files: adapter.styles, origin: 'AUTHOR' });
      inserted = true;
      check();
      if (!previous.available) await chrome.scripting.executeScript({ target, world: 'ISOLATED', injectImmediately: true, files: adapter.scripts });
    }
    check();
    const preferences = site.mode === 'chatgpt'
      ? automatic ? { ...await CyberdeckSettings.load(), enabled } : await CyberdeckSettings.save({ enabled })
      : null;
    check();
    const changed = await chrome.scripting.executeScript({
      target, world: 'ISOLATED', injectImmediately: true, func: changePageState,
      args: [site.mode, site.origin, enabled, preferences],
    });
    const state = pageError(changed[0]?.result);
    check();
    if (typeof state.enabled !== 'boolean' || state.enabled !== enabled) throw new Error('GOSHEN_NO_RESULT');
    if (!enabled && site.mode === 'universal') await chrome.scripting.removeCSS({ target, files: adapter.styles, origin: 'AUTHOR' });
    return { ...response, enabled: Boolean(state.enabled), style: state.style };
  } catch (error) {
    // A failed first activation should leave neither an orphan dock nor an
    // active stylesheet behind. A removed/navigated document needs no cleanup.
    if (inserted && !previous.enabled) {
      if (site.mode === 'universal') {
        await chrome.scripting.executeScript({ target, world: 'ISOLATED', injectImmediately: true, func: changePageState, args: [site.mode, site.origin, false, null] }).catch(() => {});
      }
      await chrome.scripting.removeCSS({ target, files: adapter.styles, origin: 'AUTHOR' }).catch(() => {});
    }
    throw error;
  }
}

async function control(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!Number.isInteger(tab?.id)) return { ok: true, mode: 'unsupported', host: 'No active tab', enabled: false, reason: 'Open a website to turn on the terminal.' };
  if (Number.isInteger(message.expectedTabId) && message.expectedTabId !== tab.id) throw new Error('GOSHEN_PAGE_CHANGED');
  const command = message.type;
  if (command !== 'goshen:status' && command !== 'goshen:follow') cancelTab(tab.id);
  const check = currentOperation(tab.id, generation(tab.id));
  if (command === 'goshen:disable') await clearIntent(tab.id);
  return queueOperation(tab.id, async () => {
    await ready;
    check();
    const active = await chrome.tabs.get(tab.id);
    check();
    if (command === 'goshen:follow') {
      if (typeof message.followCrossSite !== 'boolean') throw new Error('GOSHEN_FOLLOW_PERMISSION');
      let intent = intents.get(tab.id);
      const site = GoshenSites.resolve(active.url);
      if (!intent) {
        const status = await runOnTab(active, 'goshen:status', { check });
        check();
        if (!message.followCrossSite) return withIntent(status, tab.id);
        if (!status.enabled || !site.origin) throw new Error('GOSHEN_ENTER_FIRST');
        intent = { origin: site.origin, followCrossSite: false };
      }
      intents.set(tab.id, {
        origin: !message.followCrossSite && site.origin ? site.origin : intent.origin,
        followCrossSite: message.followCrossSite,
      });
      suppressedTabs.delete(tab.id);
      await persistIntents();
      check();
      // Also cover permission already granted (no onAdded event) or granted
      // while this write was pending. The queued resume still checks access.
      if (message.followCrossSite) resumeTab(tab.id);
      // Report desired following even if Chrome's prompt closes the popup.
      // Only the permission-checked resume can activate another document.
      const result = await runOnTab(active, 'goshen:status', { check });
      return withIntent(result, tab.id);
    }
    const result = await runOnTab(active, command, { check });
    check();
    if (command === 'goshen:enable' && result.enabled) {
      const origin = GoshenSites.resolve(active.url).origin;
      intents.set(tab.id, { origin, followCrossSite: intents.get(tab.id)?.followCrossSite === true });
      suppressedTabs.delete(tab.id);
      await persistIntents();
      check();
    }
    return withIntent(result, tab.id);
  });
}

function scheduleEarlyRetry(id, version) {
  const navigation = earlyNavigation.get(id);
  if (!navigation || navigation.version !== version || !intents.has(id) || closedTabs.has(id)) return;
  if (navigation.attempt >= EARLY_RETRY_DELAYS.length) { clearEarlyNavigation(id, version); return; }
  const delay = EARLY_RETRY_DELAYS[navigation.attempt++];
  clearTimeout(navigation.timer);
  navigation.timer = setTimeout(() => {
    navigation.timer = null;
    if (earlyNavigation.get(id) === navigation && generation(id) === version) resumeTab(id);
  }, delay);
}

function startEarlyNavigation(id, watchPrevious = false) {
  const version = generation(id);
  void ready.then(() => {
    if (!intents.has(id) || closedTabs.has(id) || generation(id) !== version) return;
    let navigation = earlyNavigation.get(id);
    if (!navigation || navigation.version !== version) {
      navigation = { version, watchPrevious, previousDocumentId: watchPrevious ? lastDocuments.get(id) : undefined, attempt: 0, timer: null };
      earlyNavigation.set(id, navigation);
    }
    clearTimeout(navigation.timer);
    navigation.timer = null;
    resumeTab(id);
  }).catch(() => {});
}

function resumeTab(id, signal) {
  if (closedTabs.has(id)) return;
  const version = generation(id);
  if (pendingAuto.has(id)) {
    // A same-generation URL/complete event can arrive while a readiness probe
    // is returning an older snapshot. Coalesce one fresh check after it ends.
    deferredAuto.set(id, signal || deferredAuto.get(id));
    return;
  }
  pendingAuto.set(id, version);
  const check = currentOperation(id, version);
  let retry = false;
  void queueOperation(id, async () => {
    await ready;
    check();
    if (signal && (readinessSignals.get(id)?.token !== signal.token || readinessSignals.get(id)?.version !== version)) return;
    const intent = intents.get(id);
    if (!intent) return;
    const tab = await chrome.tabs.get(id);
    check();
    // tab.url is the last committed URL, while pendingUrl identifies a request
    // whose new document cannot yet receive our pinned injection.
    if (tab.pendingUrl) throw new Error('GOSHEN_PRECOMMIT');
    const site = GoshenSites.resolve(tab.url);
    // Protected pages keep intent paused. Cross-origin access is never inferred
    // from another enabled tab or from a grant without this tab's own intent.
    if (site.mode === 'unsupported') return;
    if (site.origin !== intent.origin) {
      if (!intent.followCrossSite || !await chrome.permissions.contains({ origins: [`${site.origin}/*`] })) return;
      check();
    }
    await runOnTab(tab, 'goshen:enable', { automatic: true, check, previousDocumentId: earlyNavigation.get(id)?.previousDocumentId || readinessSignals.get(id)?.previousDocumentId, expectedDocumentId: signal?.documentId });
  }).catch(error => {
    retry = /GOSHEN_PRECOMMIT|GOSHEN_DOM_NOT_READY|GOSHEN_PAGE_CHANGED|No document|No frame|Frame.*removed|document.*removed/i.test(String(error?.message));
    // Missing grants, replaced documents and loading failures pause this tab.
    // A later completed navigation or explicit popup action may try again.
  }).finally(() => {
    pendingAuto.delete(id);
    if (deferredAuto.has(id)) {
      const deferred = deferredAuto.get(id);
      deferredAuto.delete(id);
      resumeTab(id, deferred);
    }
    else if (retry) scheduleEarlyRetry(id, version);
    else {
      clearEarlyNavigation(id, version);
      if (readinessSignals.get(id)?.version === version) readinessSignals.delete(id);
    }
  });
}

async function documentReady(message, sender) {
  const id = sender.tab.id;
  const signal = readinessSignals.get(id);
  if (!signal || signal.token !== message.token || signal.version !== generation(id)) return { ok: false };
  // A ready event can beat the result of the probe that installed its listener.
  // Validate behind that short probe, then release the queue before resuming.
  const accepted = await queueOperation(id, async () => {
    await ready;
    if (closedTabs.has(id) || !intents.has(id) || readinessSignals.get(id) !== signal ||
      generation(id) !== signal.version || signal.documentId !== sender.documentId || signal.signaled) return false;
    signal.signaled = true;
    return true;
  });
  if (accepted) resumeTab(id, { token: signal.token, documentId: sender.documentId });
  return { ok: accepted };
}

chrome.tabs.onUpdated.addListener((id, change) => {
  if (change.status === 'loading') cancelTab(id);
  if (change.status === 'loading' || change.url) startEarlyNavigation(id, change.status === 'loading');
  else if (change.status === 'complete') { clearEarlyNavigation(id); resumeTab(id); }
});
chrome.permissions.onAdded.addListener(permission => {
  if (!permission.origins?.length) return;
  void ready.then(() => {
    for (const [id, intent] of intents) if (intent.followCrossSite) resumeTab(id);
  }).catch(() => {});
});
chrome.tabs.onRemoved.addListener(id => {
  closedTabs.add(id);
  lastDocuments.delete(id);
  cancelTab(id);
  if (replacedTabs.has(id)) return;
  void clearIntent(id).catch(() => {});
});
chrome.tabs.onReplaced.addListener((addedId, removedId) => {
  replacedTabs.set(removedId,addedId);
  closedTabs.add(removedId);
  lastDocuments.delete(removedId);
  cancelTab(removedId);
  void queueOperation(addedId,async () => {
    await ready;
    const previous = intents.get(removedId);
    const removed = intents.delete(removedId);
    if (previous && !closedTabs.has(addedId) && !suppressedTabs.has(addedId) && !suppressedTabs.has(removedId) && !intents.has(addedId)) {
      intents.set(addedId,{ ...previous });
    }
    if (removed) await persistIntents();
    if (!intents.has(addedId) || closedTabs.has(addedId)) return;
    const tab = await chrome.tabs.get(addedId);
    // Prerender replacements may already have an interactive document even
    // while subresources are loading. The same bounded checks apply here.
    if (tab.status === 'loading') startEarlyNavigation(addedId);
    else resumeTab(addedId);
  }).catch(() => {});
});

async function restoreIntent(sender) {
  await ready;
  const id = sender.tab.id;
  const version = generation(id);
  const site = GoshenSites.resolve(sender.url);
  if (closedTabs.has(id) || site.mode === 'unsupported') return { ok:true,enabled:false };
  if (site.mode === 'universal' && (typeof sender.documentId !== 'string' || !sender.documentId || sender.documentLifecycle !== 'active')) return { ok:false,enabled:false };
  const check = currentOperation(id,version);
  return queueOperation(id,async () => {
    check();
    const intent = intents.get(id);
    if (!intent) return { ok:true,enabled:false };
    const tab = await chrome.tabs.get(id);
    check();
    const current = GoshenSites.resolve(tab.url);
    if (current.origin !== site.origin) return { ok:true,enabled:false };
    if (site.origin !== intent.origin && (!intent.followCrossSite || !await chrome.permissions.contains({ origins:[`${site.origin}/*`] }))) return { ok:true,enabled:false };
    check();
    if (site.mode === 'universal') {
      // A cached OFF page retains its runtime, but its sheet was removed. Its
      // restore hook has already disabled the cached appearance; reinstall the
      // sheet and activate the exact sender document before confirming success.
      const restored = await runOnTab(tab,'goshen:enable',{ check,expectedDocumentId:sender.documentId });
      check();
      if (!restored.enabled) return { ok:true,enabled:false };
    }
    return { ok:true,enabled:!closedTabs.has(id) && generation(id) === version && intents.get(id) === intent };
  });
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'goshen:document-ready') {
    if (sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id) || sender.frameId !== 0 ||
      typeof sender.documentId !== 'string' || sender.documentLifecycle !== 'active' || typeof message.token !== 'string') return false;
    documentReady(message, sender).then(respond, () => respond({ ok: false }));
    return true;
  }
  if (message?.type === 'goshen:restore-intent') {
    if (sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id) || sender.frameId !== 0 || typeof sender.url !== 'string' || sender.documentLifecycle && sender.documentLifecycle !== 'active') return false;
    restoreIntent(sender).then(respond,() => respond({ ok:false,enabled:false }));
    return true;
  }
  if (message?.type === 'goshen:page-off') {
    if (sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id)) return false;
    cancelTab(sender.tab.id);
    clearIntent(sender.tab.id).then(() => respond({ ok: true }), () => respond({ ok: false }));
    return true;
  }
  if (!commands.has(message?.type)) return false;
  // Only our popup can operate the active tab. Content scripts and websites
  // cannot use this message endpoint to request another injection.
  if (sender.id !== chrome.runtime.id || sender.tab || sender.url !== chrome.runtime.getURL('popup.html')) {
    respond({ ok: false, error: 'Open the extension popup to control this tab.' });
    return false;
  }
  control(message).then(respond, error => respond({ ok: false, error: friendlyError(error) }));
  return true;
});
