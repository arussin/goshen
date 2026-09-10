import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

const sources = Object.fromEntries(await Promise.all(['sites.js', 'settings.js', 'background.js'].map(async file => [file, await readFile(new URL(`../extension/${file}`, import.meta.url), 'utf8')])));
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

// Chrome validates each ScriptInjection.args entry before converting it. A
// whole-array JSON clone would hide invalid undefined entries by making nulls.
function scriptArguments(args = []) {
  return Array.from(args, (value, index) => {
    const serialized = JSON.stringify(value);
    if (serialized === undefined || typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError(`Error at property args: Error at index ${index}: Value is unserializable.`);
    }
    return JSON.parse(serialized);
  });
}

const settle = async () => { for (let turn = 0; turn < 3; turn++) await new Promise(resolve => setImmediate(resolve)); };

function environment({ url = 'https://example.com/article', contentType = 'text/html', chatRuntime = false, settings = {}, tabs = true, session = {}, permissionGranted = false, originPermissions = {}, registeredScripts = [], failSessionRead = false, failRegistrationRead = false } = {}) {
  const state = { calls: [], writes: [], sessionWrites: [], permissionChecks: [], permissionRemovals: [], registrationCalls: [], registeredScripts: plain(registeredScripts), originPermissions: new Map(Object.entries({ 'https://chatgpt.com/*': true, 'https://chat.openai.com/*': true, ...originPermissions })), failSessionRead, failRegistrationRead, sessionData: plain(session), data: { 'cyberdeck.settings': { theme: 'green', universalStyle: 'frame', ...settings } }, css: false, active: false, failFiles: false, navigated: false, injections: 0, documentId: 'doc-1', permissionGranted,activeTabId:41,tabStatuses:new Map(), tabURLs: new Map(tabs ? [[41, url]] : []), pendingURLs: new Map(), timers: new Map(), now: 0, timerId: 0 };
  const attributes = new Map();
  const updated = new Set();
  const removed = new Set();
  const replaced = new Set();
  const permissionAdded = new Set();
  let listener;
  const documentListeners = new Map();
  const windowListeners = new Map();
  const events = listeners => ({
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
  });
  const page = vm.createContext({ location: { origin: new URL(url).origin }, document: { contentType, readyState: 'complete', body: {}, documentElement: { getAttribute: key => attributes.get(key) || null } } });
  Object.assign(page.document, events(documentListeners));
  Object.assign(page, events(windowListeners));
  const installUniversal = () => {
    state.injections++;
    page.GoshenUniversal = {
      status: () => ({ enabled: state.active, mode: 'universal', style: 'frame' }),
      enable: async () => { state.active = true; },
      disable: () => { state.active = false; },
    };
  };
  const installChat = () => {
    page.CyberdeckRuntime = { applyPreferences: preferences => { attributes.set('data-cd-enabled', String(preferences.enabled)); } };
  };
  if (chatRuntime) { installChat(); attributes.set('data-cd-enabled', 'true'); }
  const storageListeners = new Set();
  const chrome = {
    runtime: { id: 'goshen-test', getURL: file => `chrome-extension://goshen-test/${file}`, onMessage: { addListener: callback => { listener = callback; } } },
    tabs: {
      query: async options => { state.calls.push(['query', plain(options)]); return state.tabURLs.has(state.activeTabId) ? [{ id:state.activeTabId,url:state.tabURLs.get(state.activeTabId) }] : []; },
      get: async id => { if (!state.tabURLs.has(id)) throw new Error(`No tab with id ${id}`); return { id, url: state.tabURLs.get(id), pendingUrl: state.pendingURLs.get(id), status:state.tabStatuses.get(id) || 'complete' }; },
      onUpdated: { addListener: callback => updated.add(callback) },
      onRemoved: { addListener: callback => removed.add(callback) },
      onReplaced: { addListener: callback => replaced.add(callback) },
    },
    permissions: {
      getAll: async () => {
        const origins = new Set([...state.originPermissions].filter(([, granted]) => granted).map(([origin]) => origin));
        for (const origin of ['http://*/*', 'https://*/*']) {
          if (!state.originPermissions.has(origin) && state.permissionGranted) origins.add(origin);
        }
        return { permissions: ['storage', 'scripting', 'activeTab'], origins: [...origins] };
      },
      contains: async options => {
        state.permissionChecks.push(plain(options));
        return options.origins.every(origin => {
          if (state.originPermissions.has(origin)) return state.originPermissions.get(origin);
          const protocol = origin.startsWith('https:') ? 'https://*/*' : 'http://*/*';
          return state.originPermissions.has(protocol) ? state.originPermissions.get(protocol) : state.permissionGranted;
        });
      },
      remove: async options => {
        state.permissionRemovals.push(plain(options));
        state.permissionGranted = false;
        for (const origin of options.origins) state.originPermissions.set(origin, false);
        return true;
      },
      onAdded: { addListener: callback => permissionAdded.add(callback) },
    },
    storage: {
      local: {
        get: async () => plain(state.data),
        set: async patch => { state.writes.push(plain(patch)); Object.assign(state.data, plain(patch)); for (const callback of storageListeners) callback({ 'cyberdeck.settings': { newValue: state.data['cyberdeck.settings'] } }, 'local'); },
      },
      session: {
        get: async () => { if (state.failSessionRead) throw new Error('Session storage unavailable'); return plain(state.sessionData); },
        set: async patch => { state.sessionWrites.push(plain(patch)); Object.assign(state.sessionData, plain(patch)); },
      },
      onChanged: { addListener: callback => storageListeners.add(callback) },
    },
    scripting: {
      getRegisteredContentScripts: async () => { state.registrationCalls.push(['get']); if (state.failRegistrationRead) throw new Error('Registration lookup unavailable'); return plain(state.registeredScripts); },
      unregisterContentScripts: async options => {
        state.registrationCalls.push(['unregister', plain(options)]);
        state.registeredScripts = state.registeredScripts.filter(script => !options.ids.includes(script.id));
      },
      executeScript: async options => {
        const args = scriptArguments(options.args);
        state.calls.push(['execute', { target: plain(options.target), world: options.world, injectImmediately: options.injectImmediately, files: plain(options.files), func: options.func?.name, args }]);
        if (page.document.readyState !== 'complete' && !options.injectImmediately) throw new Error('Regression: default document_idle injection would wait for page load');
        if (options.target.documentIds && (state.navigated || options.target.documentIds[0] !== state.documentId)) throw new Error('No document with requested id');
        if (options.files) {
          if (state.failFiles) throw new Error('Injection failed');
          if (options.files.includes('universal.js') && !state.skipInstall) installUniversal();
          if (options.files.includes('content.js')) installChat();
          return [{ frameId: 0, documentId: state.documentId }];
        }
        page.args = args;
        const value = await vm.runInContext(`(${options.func.toString()})(...args)`, page);
        return [{ frameId: 0, documentId: state.documentId, result: plain(value) }];
      },
      insertCSS: async options => { state.calls.push(['insert', plain(options)]); if (state.navigated) throw new Error('No document with id doc-1'); state.css = true; },
      removeCSS: async options => { state.calls.push(['remove', plain(options)]); state.css = false; },
    },
  };
  const context = vm.createContext({ chrome, URL, console, Promise, Map, Set, crypto: { randomUUID },
    setTimeout(callback, delay) { const id = ++state.timerId; state.timers.set(id, { callback, due: state.now + delay }); return id; },
    clearTimeout(id) { state.timers.delete(id); },
  });
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(sources[file], context, { filename: file }));
  vm.runInContext(sources['background.js'], context, { filename: 'background.js' });
  const sender = { id: chrome.runtime.id, url: chrome.runtime.getURL('popup.html') };
  function send(type, from = sender) {
    return new Promise(resolve => {
      const wait = listener(typeof type === 'string' ? { type } : type, from, value => resolve(plain(value)));
      if (!wait) resolve(undefined);
    });
  }
  const pageSender = () => ({ id:chrome.runtime.id,tab:{ id:state.activeTabId },frameId:0,documentId:state.documentId,documentLifecycle:'active' });
  page.chrome = { runtime: { sendMessage: message => send(message, pageSender()) } };
  function emitDocument(type, readyState) {
    if (readyState) page.document.readyState = readyState;
    for (const callback of [...documentListeners.get(type) || []]) callback({ type });
  }
  function hidePage() { for (const callback of [...windowListeners.get('pagehide') || []]) callback({ type:'pagehide' }); }
  let documentCount = 1;
  function update(id, change) {
    if (change.status) state.tabStatuses.set(id, change.status);
    if (id === state.activeTabId && change.status === 'complete') page.document.readyState = 'complete';
    if (change.url) state.tabURLs.set(id, change.url);
    updated.forEach(callback => callback(id, change, { id, url: state.tabURLs.get(id) }));
  }
  function beginNavigation(address) {
    state.pendingURLs.set(state.activeTabId, address);
    update(state.activeTabId, { status: 'loading' });
  }
  function commitNavigation(address, { complete = true, readyState = complete ? 'complete' : 'interactive', emitURL = true } = {}) {
    hidePage();
    const id = state.activeTabId;
    state.tabURLs.set(id, address);
    state.pendingURLs.delete(id);
    page.location.origin = new URL(address).origin;
    page.document.readyState = readyState;
    delete page.GoshenUniversal;
    delete page.CyberdeckRuntime;
    attributes.clear();
    state.active = state.css = false;
    state.documentId = `doc-${++documentCount}`;
    if (emitURL) update(id, { url: address });
    if (complete) update(id, { status: 'complete' });
  }
  function navigate(address, options = {}) { beginNavigation(address); commitNavigation(address, options); }
  function close(id = 41) { state.tabURLs.delete(id); removed.forEach(callback => callback(id)); }
  function replace(id = 42,{ complete = true } = {}) {
    const old = state.activeTabId;
    state.tabURLs.set(id,state.tabURLs.get(old)); state.tabURLs.delete(old); state.activeTabId = id;
    state.tabStatuses.set(id,complete ? 'complete' : 'loading');
    page.document.readyState = complete ? 'complete' : 'loading';
    delete page.GoshenUniversal; delete page.CyberdeckRuntime;
    attributes.clear(); state.active = state.css = false; state.documentId = `doc-${++documentCount}`;
    replaced.forEach(callback => callback(id,old));
  }
  function grantAccess(origins = ['http://*/*', 'https://*/*']) {
    if (origins.includes('http://*/*') && origins.includes('https://*/*')) {
      state.permissionGranted = true;
      for (const origin of origins) state.originPermissions.delete(origin);
    } else for (const origin of origins) state.originPermissions.set(origin, true);
    permissionAdded.forEach(callback => callback({ origins }));
  }
  async function advance(milliseconds) {
    const target = state.now + milliseconds;
    await settle();
    for (let round = 0; round < 100; round++) {
      const next = [...state.timers].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) { state.now = target; return; }
      state.now = next[1].due; state.timers.delete(next[0]); next[1].callback();
      await settle();
    }
    assert.fail('Automatic startup retries did not remain bounded');
  }
  return { state, chrome, page, attributes, context, send, navigate, beginNavigation, commitNavigation, update, close,replace,grantAccess,advance,emitDocument,hidePage,pageSender,documentListeners,windowListeners };
}

test('the Chrome injection fixture rejects unserializable argument entries before cloning arrays', async () => {
  const env = environment();
  for (const value of [undefined, () => {}, Symbol('invalid'), NaN, Infinity, -Infinity]) {
    await assert.rejects(env.chrome.scripting.executeScript({
      target: { tabId: 41 }, injectImmediately: true, func: value => value, args: ['valid', value],
    }), /index 1: Value is unserializable/);
  }
  const result = await env.chrome.scripting.executeScript({
    target: { tabId: 41 }, injectImmediately: true, func: (...values) => values, args: ['valid', null, false],
  });
  assert.deepEqual(result[0].result, ['valid', null, false]);
});

test('manual controls and automatic follow pass valid Chrome arguments without losing readiness signals', async () => {
  const env = environment();
  assert.equal((await env.send('goshen:status')).ok, true);
  assert.equal((await env.send('goshen:enable')).enabled, true);
  assert.equal((await env.send('goshen:status')).enabled, true);
  const manualProbes = env.state.calls.filter(([kind, call]) => kind === 'execute' && call.func === 'readPageState');
  assert.equal(manualProbes.length, 3);
  assert.ok(manualProbes.every(([, call]) => call.args[3] === null));
  env.state.permissionGranted = true;
  assert.equal((await env.send({ type: 'goshen:follow', followCrossSite: true })).followCrossSite, true);
  await settle();
  env.navigate('https://other.example/parsing', { complete: false, readyState: 'loading' });
  await settle();
  assert.equal(env.state.active, false);
  assert.equal(typeof env.page.GoshenDOMReadyNotifier?.token, 'string');
  env.emitDocument('readystatechange', 'interactive');
  await settle();
  assert.equal(env.state.active, true);
  assert.equal((await env.send('goshen:disable')).enabled, false);
  assert.equal(env.state.active, false);
  assert.deepEqual(env.state.sessionData['goshen.tab-intents'], {});
});

test('site policy selects exact tailored hosts and blocks browser/store addresses', () => {
  const { context } = environment();
  const resolve = context.GoshenSites.resolve;
  for (const url of ['https://chatgpt.com/c/abc', 'https://chat.openai.com/']) assert.equal(resolve(url).mode, 'chatgpt');
  for (const url of ['http://chatgpt.com/', 'https://chatgpt.com.attacker.example/', 'https://example.com/?next=chatgpt.com', 'http://localhost:4173/']) assert.equal(resolve(url).mode, 'universal');
  for (const url of ['chrome://settings', 'chrome-extension://x/popup.html', 'file:///tmp/a.html', 'about:blank', 'javascript:alert(1)', 'https://chromewebstore.google.com/detail/x', 'https://chrome.google.com/webstore/detail/x', 'invalid']) assert.equal(resolve(url).mode, 'unsupported');
});

test('opening the popup inspects only the chosen tab without injecting a theme or storing its address', async () => {
  const env = environment();
  assert.deepEqual(await env.send('goshen:status'), { ok: true, tabId: 41, host: 'example.com', mode: 'universal', enabled: false, persistent: false, followCrossSite: false, followPermissionGranted: false, crossSiteAccessGranted: false, persistencePaused: false });
  assert.equal(env.state.calls.filter(([name]) => name === 'execute').length, 1);
  assert.equal(env.state.calls.some(([name]) => name === 'insert'), false);
  assert.equal(env.state.writes.length, 0);
  assert.deepEqual(env.state.calls[0], ['query', { active: true, currentWindow: true }]);
});

test('activation targets the inspected document and repeated entry/exit stays idempotent', async () => {
  const env = environment();
  assert.equal((await env.send('goshen:enable')).enabled, true);
  assert.equal(env.state.css, true);
  assert.equal(env.state.injections, 1);
  assert.equal((await env.send('goshen:enable')).enabled, true);
  assert.equal(env.state.injections, 1, 'Keep one runtime per document');
  for (const [kind, call] of env.state.calls.filter(([kind, call]) => ['insert','remove'].includes(kind) || kind === 'execute' && call.files)) {
    assert.deepEqual(call.target, { tabId: 41, documentIds: ['doc-1'] });
  }
  assert.equal((await env.send('goshen:disable')).enabled, false);
  assert.equal(env.state.active, false);
  assert.equal(env.state.css, false);
  assert.equal(env.state.writes.length, 0, 'Universal tab activation is never recorded as browsing history');
});

test('failed activation removes an inserted sheet and reports a friendly error', async () => {
  const env = environment();
  env.state.failFiles = true;
  const result = await env.send('goshen:enable');
  assert.equal(result.ok, false);
  assert.match(result.error, /Refresh the page/);
  assert.equal(env.state.css, false);
  assert.equal(env.state.active, false);
});

test('navigation between inspection and injection cannot apply the theme to the replacement document', async () => {
  const env = environment();
  const execute = env.chrome.scripting.executeScript;
  env.chrome.scripting.executeScript = async options => {
    const result = await execute(options);
    if (options.func?.name === 'readPageState') env.state.navigated = true;
    return result;
  };
  const result = await env.send('goshen:enable');
  assert.equal(result.ok, false);
  assert.match(result.error, /page changed/);
  assert.equal(env.state.injections, 0);
});

test('an adapter that fails to initialize is reported as failure and its stylesheet is rolled back', async () => {
  const env = environment();
  env.state.skipInstall = true;
  const result = await env.send('goshen:enable');
  assert.equal(result.ok, false);
  assert.equal(env.state.css, false);
});

test('untrusted callers cannot operate other tabs through the worker', async () => {
  const env = environment();
  for (const sender of [{ id:'other',url:'chrome-extension://goshen-test/popup.html' }, { id:'goshen-test',url:'https://example.com',tab:{id:41} }, { id:'goshen-test',url:'chrome-extension://goshen-test/other.html' }]) {
    assert.equal((await env.send('goshen:enable', sender)).ok, false);
  }
  assert.equal(env.state.calls.length, 0);
  assert.equal(await env.send('unknown'), undefined);
});

test('unsupported schemes and non-HTML documents never receive runtime files', async () => {
  for (const options of [{url:'chrome://extensions'}, {url:'https://chromewebstore.google.com/'}, {contentType:'application/pdf'}, {contentType:'image/svg+xml'}, {tabs:false}]) {
    const env = environment(options);
    const result = await env.send('goshen:enable');
    assert.equal(result.mode, 'unsupported');
    assert.equal(result.enabled, false);
    assert.equal(env.state.calls.some(([name]) => name === 'insert'), false);
  }
});

test('ChatGPT retains its tailored runtime and existing preferences when controlled from the popup', async () => {
  const env = environment({ url:'https://chatgpt.com/', chatRuntime:true });
  assert.equal((await env.send('goshen:disable')).enabled, false);
  assert.equal(env.state.data['cyberdeck.settings'].theme, 'green');
  assert.equal(env.state.data['cyberdeck.settings'].enabled, false);
  assert.equal((await env.send('goshen:enable')).enabled, true);
  assert.equal(env.state.injections, 0);
  assert.equal(env.state.calls.some(([name]) => name === 'insert'), false);
});

test('ChatGPT can be disabled before its automatic runtime has loaded, or enabled by injecting its own adapter', async () => {
  const env = environment({ url:'https://chatgpt.com/' });
  assert.equal((await env.send('goshen:disable')).enabled, false);
  assert.equal((await env.send('goshen:enable')).enabled, true);
  const injected = env.state.calls.find(([name,call]) => name === 'execute' && call.files);
  assert.deepEqual(injected[1].files, ['settings.js','companion.js','content.js']);
});

test('a stale ChatGPT runtime requests a refresh before changing saved preferences', async () => {
  const env = environment({ url:'https://chatgpt.com/' });
  env.page.CyberdeckRuntime = { refresh() {} };
  const result = await env.send('goshen:enable');
  assert.equal(result.ok, false);
  assert.match(result.error, /finish updating/);
  assert.equal(env.state.writes.length, 0);
});

test('same-origin reloads and navigation resume only the opted-in tab, using session-only origin state', async () => {
  const env = environment();
  const enabled = await env.send('goshen:enable');
  assert.equal(enabled.persistent, true);
  assert.deepEqual(env.state.sessionData, { 'goshen.tab-intents': { 41: { origin: 'https://example.com', followCrossSite: false } }, 'goshen.cross-site-access-revoked': false });
  assert.equal(JSON.stringify(env.state.sessionData).includes('/article'), false);
  env.navigate('https://example.com/next?private=query');
  env.update(41, { status: 'complete' });
  env.update(41, { status: 'complete' });
  await settle();
  assert.equal(env.state.active, true);
  assert.equal(env.state.injections, 2, 'One activation for each actual document, despite duplicate completion events');
  assert.equal(env.state.writes.length, 0, 'Tab intent never touches persistent preference storage');
  env.state.tabURLs.set(99, 'https://example.com/another');
  const count = env.state.calls.length;
  env.update(99, { status: 'complete' });
  await settle();
  assert.equal(env.state.calls.length, count, 'Another tab on the same site is not opted in');
});

test('same-site mode pauses on another origin and popup OFF clears intent even on a protected page', async () => {
  const env = environment();
  await env.send('goshen:enable');
  env.navigate('https://other.example/');
  await settle();
  assert.equal(env.state.active, false);
  assert.equal(env.state.injections, 1);
  const paused = await env.send('goshen:status');
  assert.equal(paused.persistent, true);
  assert.equal(paused.persistencePaused, true);
  env.navigate('chrome://settings');
  await settle();
  assert.equal((await env.send('goshen:status')).persistent, true);
  const off = await env.send('goshen:disable');
  assert.equal(off.mode, 'unsupported');
  assert.equal(off.persistent, false);
  assert.deepEqual(env.state.sessionData['goshen.tab-intents'], {});
  env.navigate('https://example.com/back');
  await settle();
  assert.equal(env.state.active, false);
});

test('desired follow survives a vanished popup, but cross-site activation waits for a real grant', async () => {
  const env = environment();
  await env.send('goshen:enable');
  // No popup callback is needed after this dispatched message.
  const desired = await env.send({ type: 'goshen:follow', followCrossSite: true });
  assert.equal(desired.ok, true);
  assert.equal(desired.followCrossSite, true);
  assert.equal(desired.followPermissionGranted, false);
  assert.equal(env.state.sessionData['goshen.tab-intents'][41].followCrossSite, true);
  env.navigate('https://other.example/next');
  await settle();
  assert.equal(env.state.active, false);
  assert.equal(env.state.injections, 1, 'Desired intent alone cannot trigger cross-site injection');
  const sender = { id: 'goshen-test', tab: { id: 41 }, frameId: 0, documentId: env.state.documentId, documentLifecycle: 'active', url: 'https://other.example/next' };
  assert.deepEqual(await env.send('goshen:restore-intent', sender), { ok: true, enabled: false });
  env.state.tabURLs.set(99, 'https://other.example/unselected');
  env.grantAccess();
  await settle();
  assert.equal(env.state.active, true);
  assert.equal(env.state.injections, 2);
  assert.equal(env.state.calls.some(([kind, call]) => kind === 'execute' && call.target.tabId === 99), false);
  assert.deepEqual(await env.send('goshen:restore-intent', sender), { ok: true, enabled: true });
  assert.equal((await env.send('goshen:status')).followPermissionGranted, true);
  assert.equal(env.state.sessionData['goshen.tab-intents'][41].origin, 'https://example.com');
  env.state.permissionGranted = false;
  env.navigate('https://third.example/');
  await settle();
  assert.equal(env.state.active, false, 'Revoked permission pauses following rather than attempting a new injection');
  assert.equal(env.state.injections, 2);
  assert.equal((await env.send('goshen:status')).followPermissionGranted, false);
  assert.deepEqual(await env.send('goshen:restore-intent', { ...sender, url: 'https://third.example/' }), { ok: true, enabled: false });
});

test('permission denial rollback cannot recreate an OFF intent or cancel its in-flight page cleanup', async () => {
  const env = environment();
  await env.send('goshen:enable');
  await env.send({ type: 'goshen:follow', followCrossSite: true });
  let release;
  let reached;
  const waiting = new Promise(resolve => { reached = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  const execute = env.chrome.scripting.executeScript;
  env.chrome.scripting.executeScript = async options => {
    if (options.func?.name === 'changePageState' && options.args[2] === false) { reached(); await barrier; }
    return execute(options);
  };
  const off = env.send('goshen:disable');
  await waiting;
  const rollback = env.send({ type: 'goshen:follow', followCrossSite: false, expectedTabId: 41 });
  release();
  assert.equal((await off).ok, true);
  assert.equal((await rollback).persistent, false);
  env.grantAccess();
  await settle();
  assert.equal(env.state.active, false);
  assert.deepEqual(env.state.sessionData['goshen.tab-intents'], {});
});

test('an ungranted desired-follow choice survives worker restart and later access still stays scoped', async () => {
  const first = environment();
  await first.send('goshen:enable');
  await first.send({ type: 'goshen:follow', followCrossSite: true });
  const env = environment({ url: 'https://other.example/paused', session: first.state.sessionData });
  env.update(41, { status: 'complete' });
  await settle();
  assert.equal(env.state.injections, 0);
  assert.equal((await env.send('goshen:status')).followCrossSite, true);
  env.grantAccess();
  await settle();
  assert.equal(env.state.active, true);
  assert.equal(env.state.injections, 1);
});

test('already-granted access resumes a newly selected cross-site follow without needing a new permission event', async () => {
  const env = environment();
  await env.send('goshen:enable');
  env.navigate('https://other.example/paused');
  await settle();
  assert.equal(env.state.active, false);
  env.state.permissionGranted = true;
  await env.send({ type: 'goshen:follow', followCrossSite: true });
  await settle();
  assert.equal(env.state.active, true);
  assert.equal(env.state.injections, 2);
  assert.ok(env.state.permissionChecks.some(check => check.origins[0] === 'https://other.example/*'));
});

test('turning off cross-site following makes the current site the new same-site boundary', async () => {
  const env = environment();
  await env.send('goshen:enable');
  env.state.permissionGranted = true;
  await env.send({ type: 'goshen:follow', followCrossSite: true });
  env.navigate('https://other.example/');
  await settle();
  await env.send({ type: 'goshen:follow', followCrossSite: false });
  assert.deepEqual(env.state.sessionData['goshen.tab-intents'][41], { origin: 'https://other.example', followCrossSite: false });
  env.state.permissionGranted = false;
  env.navigate('https://other.example/next');
  await settle();
  assert.equal(env.state.active, true);
  env.navigate('https://example.com/');
  await settle();
  assert.equal(env.state.active, false);
});

test('trusted dock OFF clears only its sender tab and closing a tab removes its intent', async () => {
  const env = environment({ session: { 'goshen.tab-intents': { 99: { origin: 'https://other.example', followCrossSite: false } } } });
  await env.send('goshen:enable');
  assert.equal(await env.send('goshen:page-off', { id: 'other', tab: { id: 41 } }), undefined);
  assert.ok(env.state.sessionData['goshen.tab-intents'][41]);
  await env.send('goshen:page-off', { id: 'goshen-test', tab: { id: 41 }, url: 'https://example.com/article' });
  assert.equal(env.state.sessionData['goshen.tab-intents'][41], undefined);
  assert.ok(env.state.sessionData['goshen.tab-intents'][99]);
  env.close(99);
  await settle();
  assert.deepEqual(env.state.sessionData['goshen.tab-intents'], {});
});

test('service-worker restart restores active session intent without storing or requesting paths', async () => {
  const first = environment();
  await first.send('goshen:enable');
  const restarted = environment({ session: first.state.sessionData });
  restarted.navigate('https://example.com/reloaded');
  await settle();
  assert.equal(restarted.state.active, true);
  assert.equal(restarted.state.injections, 1);
  assert.equal((await restarted.send('goshen:status')).persistent, true);
});

test('dock OFF cancels an activation in flight and prevents future navigation from reviving it', async () => {
  const env = environment();
  let release;
  let reached;
  const barrier = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { reached = resolve; });
  const execute = env.chrome.scripting.executeScript;
  env.chrome.scripting.executeScript = async options => {
    if (options.files) { reached(); await barrier; }
    return execute(options);
  };
  const activation = env.send('goshen:enable');
  await started;
  await env.send('goshen:page-off', { id: 'goshen-test', tab: { id: 41 } });
  release();
  assert.equal((await activation).ok, false);
  assert.equal(env.state.active, false);
  assert.equal(env.state.css, false);
  env.navigate('https://example.com/new');
  await settle();
  assert.equal(env.state.active, false);
});

test('a newer completed navigation supersedes a queued older automatic activation', async () => {
  const env = environment();
  await env.send('goshen:enable');
  const execute = env.chrome.scripting.executeScript;
  let replaced = false;
  env.chrome.scripting.executeScript = async options => {
    const result = await execute(options);
    if (options.func?.name === 'readPageState' && !replaced) {
      replaced = true;
      env.navigate('https://example.com/latest');
    }
    return result;
  };
  env.navigate('https://example.com/earlier');
  await settle();
  assert.equal(env.state.active, true);
  assert.equal(env.state.injections, 2, 'Only the final replacement document receives another runtime');
});

test('follow cannot activate a never-enabled tab and stale popup tab IDs cannot affect another tab', async () => {
  const env = environment();
  env.state.permissionGranted = true;
  const result = await env.send({ type: 'goshen:follow', followCrossSite: true });
  assert.equal(result.ok, false);
  assert.match(result.error, /Turn on the terminal/);
  assert.equal(env.state.sessionWrites.length, 0);
  const stale = await env.send({ type: 'goshen:enable', expectedTabId: 99 });
  assert.equal(stale.ok, false);
  assert.equal(env.state.injections, 0);
  env.close();
  await settle();
  assert.equal((await env.send('goshen:status')).mode, 'unsupported');
});

test('prerender replacement transfers only the opted-in tab and resumes its completed replacement', async () => {
  const env = environment();
  await env.send('goshen:enable');
  env.replace(42); await settle();
  assert.equal(env.state.active,true);
  assert.equal(env.state.injections,2);
  assert.equal(env.state.sessionData['goshen.tab-intents'][41],undefined);
  assert.deepEqual(env.state.sessionData['goshen.tab-intents'][42],{ origin:'https://example.com',followCrossSite:false });
  const unselected = environment();
  unselected.replace(52); await settle();
  assert.equal(unselected.state.injections,0);
  assert.deepEqual(unselected.state.sessionData,{});
});

test('a loading replacement waits for completion and OFF during transfer never recreates its intent', async () => {
  const env = environment();
  await env.send('goshen:enable');
  env.replace(42,{ complete:false }); await settle();
  assert.equal(env.state.injections,1);
  env.state.tabStatuses.set(42,'complete'); env.update(42,{ status:'complete' }); await settle();
  assert.equal(env.state.injections,2);
  const canceled = environment();
  await canceled.send('goshen:enable');
  canceled.replace(42);
  await canceled.send('goshen:page-off',{ id:'goshen-test',tab:{ id:41 },frameId:0 });
  await settle();
  assert.deepEqual(canceled.state.sessionData['goshen.tab-intents'],{});
  canceled.navigate('https://example.com/later'); await settle();
  assert.equal(canceled.state.active,false);
});

test('BFCache restoration is sender-scoped, permission-aware, and rejects invalid documents without mutation', async () => {
  const env = environment();
  const sender = { id:'goshen-test',tab:{ id:41 },frameId:0,documentId:env.state.documentId,url:'https://example.com/article',documentLifecycle:'active' };
  assert.deepEqual(await env.send('goshen:restore-intent',sender),{ ok:true,enabled:false });
  await env.send('goshen:enable');
  const before = env.state.calls.filter(([name,call]) => name === 'insert' || name === 'execute' && call.files).length;
  assert.deepEqual(await env.send({ type:'goshen:restore-intent',tabId:99,url:'https://another.example/' },sender),{ ok:true,enabled:true });
  assert.equal(env.state.calls.filter(([name,call]) => name === 'insert' || name === 'execute' && call.files).length,before);
  for (const invalid of [{ ...sender,id:'other' },{ ...sender,frameId:1 },{ ...sender,documentLifecycle:'cached' }]) assert.equal(await env.send('goshen:restore-intent',invalid),undefined);
  for (const invalid of [{ ...sender,documentId:undefined },{ ...sender,documentId:'' },{ ...sender,documentId:'stale-document' },{ ...sender,documentLifecycle:undefined }]) {
    assert.deepEqual(await env.send('goshen:restore-intent',invalid),{ ok:false,enabled:false });
  }
  assert.equal(env.state.calls.filter(([name,call]) => name === 'insert' || name === 'execute' && call.files).length,before);
  env.state.tabURLs.set(41,'https://other.example/');
  assert.deepEqual(await env.send('goshen:restore-intent',{ ...sender,url:'https://other.example/' }),{ ok:true,enabled:false });
  env.state.tabURLs.set(41,'https://example.com/article');
  await env.send('goshen:disable');
  assert.deepEqual(await env.send('goshen:restore-intent',sender),{ ok:true,enabled:false });
});

async function cachedUniversalPage({ failedActivation = false } = {}) {
  const env = environment();
  if (failedActivation) {
    const execute = env.chrome.scripting.executeScript;
    env.chrome.scripting.executeScript = options => {
      if (options.func?.name === 'changePageState' && options.args[2]) {
        env.chrome.scripting.executeScript = execute;
        throw new Error('First activation failed after installing the runtime');
      }
      return execute(options);
    };
    assert.equal((await env.send('goshen:enable')).ok,false);
  } else {
    await env.send('goshen:enable');
    await env.send('goshen:disable');
  }
  assert.equal(env.state.css,false,'Both popup OFF and failed activation remove the sheet');
  assert.equal(env.state.active,false);
  const cached = { runtime:env.page.GoshenUniversal,documentId:env.state.documentId };
  assert.ok(cached.runtime,'The disabled runtime remains in the cached document');
  env.navigate('https://example.com/b');
  await settle();
  await env.send('goshen:enable');
  assert.equal(env.state.css,true);
  // Restore A's cached document before its complete event. Its local restore
  // hook first disables the old appearance and asks the worker to reconcile.
  env.state.tabURLs.set(41,'https://example.com/article');
  env.state.documentId = cached.documentId;
  env.page.GoshenUniversal = cached.runtime;
  env.state.css = false;
  env.state.active = false;
  const sender = { id:'goshen-test',tab:{id:41},frameId:0,documentId:cached.documentId,url:'https://example.com/article',documentLifecycle:'active' };
  return { env,sender };
}

test('restoring cached A after enabling B reinstalls the sheet removed by OFF or failed activation', async () => {
  for (const failedActivation of [false,true]) {
    const { env,sender } = await cachedUniversalPage({ failedActivation });
    const before = env.state.calls.length;
    assert.deepEqual(await env.send('goshen:restore-intent',sender),{ ok:true,enabled:true });
    assert.equal(env.state.css,true,'The worker must restore CSS before authorizing the cached runtime');
    assert.equal(env.state.active,true);
    assert.equal(env.state.injections,2,'Reuse A’s cached runtime rather than inject it again');
    const inserted = env.state.calls.slice(before).filter(([kind]) => kind === 'insert');
    assert.equal(inserted.length,1);
    assert.deepEqual(inserted[0][1].target,{ tabId:41,documentIds:[sender.documentId] });
    env.update(41,{ status:'complete' });
    await settle();
    assert.equal(env.state.css,true);
    assert.equal(env.state.calls.slice(before).filter(([kind]) => kind === 'insert').length,1);
  }
});

test('OFF and navigation cancel a BFCache restoration paused while inserting its stylesheet', async () => {
  for (const action of ['off','navigation']) {
    const { env,sender } = await cachedUniversalPage();
    let release;
    let entered;
    const waiting = new Promise(resolve => { entered = resolve; });
    const insert = env.chrome.scripting.insertCSS;
    env.chrome.scripting.insertCSS = async options => {
      await insert(options);
      entered();
      await new Promise(resolve => { release = resolve; });
    };
    const restoring = env.send('goshen:restore-intent',sender);
    await waiting;
    const before = env.state.calls.length;
    const off = action === 'off' ? env.send('goshen:disable') : null;
    if (action === 'navigation') env.beginNavigation('https://example.com/new-document');
    await settle();
    release();
    assert.deepEqual(await restoring,{ ok:false,enabled:false });
    if (off) assert.equal((await off).enabled,false);
    await settle();
    assert.equal(env.state.active,false);
    assert.equal(env.state.css,false,'Canceled restoration removes its inserted sheet');
    assert.equal(env.state.calls.slice(before).some(([kind,call]) => kind === 'execute' && call.func === 'changePageState' && call.args[2] === true),false);
    if (action === 'off') assert.deepEqual(env.state.sessionData['goshen.tab-intents'],{});
  }
});

test('ChatGPT BFCache eligibility remains a read-only query for its tailored restore hook', async () => {
  const env = environment({ url:'https://chatgpt.com/',chatRuntime:true });
  await env.send('goshen:enable');
  const before = env.state.calls.length;
  const sender = { id:'goshen-test',tab:{id:41},frameId:0,url:'https://chatgpt.com/',documentLifecycle:'active' };
  assert.deepEqual(await env.send('goshen:restore-intent',sender),{ ok:true,enabled:true });
  assert.equal(env.state.calls.length,before,'ChatGPT’s hook still combines eligibility with automatic preferences itself');
});

test('an opted-in tab activates at interactive DOM readiness while slow resources still block window load', async () => {
  const env = environment();
  await env.send('goshen:enable');
  env.state.permissionGranted = true;
  await env.send({ type: 'goshen:follow', followCrossSite: true });
  await settle();
  const before = env.state.calls.length;
  env.navigate('https://slow.example/article', { complete: false });
  await settle();
  assert.equal(env.page.document.readyState, 'interactive');
  assert.equal(env.state.tabStatuses.get(41), 'loading');
  assert.equal(env.state.active, true, 'The terminal must appear without a tabs complete/window load event');
  const executions = env.state.calls.slice(before).filter(([kind]) => kind === 'execute');
  assert.ok(executions.length >= 3);
  assert.ok(executions.every(([, call]) => call.injectImmediately === true));
  assert.ok(executions.filter(([, call]) => call.files || call.func === 'changePageState').every(([, call]) => call.target.documentIds[0] === 'doc-2'));
  await env.advance(8000);
  assert.equal(env.state.injections, 2, 'A blocked load must not leave a repeating activation loop');
  assert.equal(env.state.timers.size, 0);
  env.update(41, { status: 'complete' });
  await settle();
  assert.equal(env.state.injections, 2, 'Completion is an idempotent fallback');
});

test('same-URL reload rejects the precommit document and retries after commit even without a URL event', async () => {
  const env = environment();
  await env.send('goshen:enable');
  const before = env.state.calls.filter(([kind]) => kind === 'execute').length;
  env.beginNavigation('https://example.com/article');
  await settle();
  assert.equal(env.state.calls.filter(([kind]) => kind === 'execute').length, before, 'A known pending URL cannot trigger an inspection of the old document');
  assert.equal(env.state.timers.size, 1);
  env.commitNavigation('https://example.com/article', { complete: false, emitURL: false });
  await env.advance(40);
  assert.equal(env.state.active, true);
  assert.equal(env.state.injections, 2);
  assert.equal(env.state.documentId, 'doc-2');
  assert.equal(env.state.tabStatuses.get(41), 'loading');
  assert.equal(env.state.timers.size, 0);
});

test('a previous interactive document is still rejected by document ID when pendingUrl is unavailable', async () => {
  const env = environment();
  env.page.document.readyState = 'interactive';
  await env.send('goshen:enable');
  const before = env.state.calls.length;
  env.beginNavigation('https://example.com/article');
  env.state.pendingURLs.delete(41);
  await settle();
  assert.equal(env.state.injections, 1);
  assert.equal(env.state.calls.slice(before).some(([kind, call]) => kind === 'insert' || kind === 'execute' && call.func === 'changePageState'), false);
  env.commitNavigation('https://example.com/article', { complete: false, emitURL: false });
  await env.advance(40);
  assert.equal(env.state.active, true);
  assert.equal(env.state.injections, 2);
});

test('a restarted worker learns the old themed document before a same-URL reload commits', async () => {
  const env = environment({ session: { 'goshen.tab-intents': { 41: { origin: 'https://example.com', followCrossSite: false } } } });
  env.page.GoshenUniversal = { status: () => ({ enabled: true }) };
  env.state.active = true;
  env.page.document.readyState = 'interactive';
  env.beginNavigation('https://example.com/article');
  env.state.pendingURLs.delete(41);
  await settle();
  assert.equal(env.state.injections, 0);
  assert.equal(env.state.timers.size, 1);
  env.commitNavigation('https://example.com/article', { complete: false, emitURL: false });
  await env.advance(40);
  assert.equal(env.state.active, true);
  assert.equal(env.state.injections, 1);
});

test('DOM parsing retries are bounded and later completion remains a fallback', async () => {
  const env = environment();
  await env.send('goshen:enable');
  const before = env.state.calls.length;
  env.navigate('https://example.com/slow-parser', { complete: false, readyState: 'loading' });
  await env.advance(10000);
  assert.equal(env.state.active, false);
  assert.equal(env.state.injections, 1);
  assert.equal(env.state.timers.size, 0, 'A stalled parser must not leave permanent polling');
  const reads = env.state.calls.slice(before).filter(([kind, call]) => kind === 'execute' && call.func === 'readPageState').length;
  assert.ok(reads >= 1 && reads <= 9, `Expected at most two event inspections plus seven bounded retries, got ${reads}`);
  env.update(41, { status: 'complete' });
  await settle();
  assert.equal(env.state.active, true);
  assert.equal(env.state.injections, 2);
});

test('completion arriving during a stale not-ready inspection cannot be lost', async () => {
  const env = environment();
  await env.send('goshen:enable');
  const execute = env.chrome.scripting.executeScript;
  let release;
  let reached;
  let held = false;
  const snapshotReady = new Promise(resolve => { reached = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  env.chrome.scripting.executeScript = async options => {
    const result = await execute(options);
    if (!held && options.func?.name === 'readPageState' && result[0].result.notReady) {
      held = true; reached(); await barrier;
    }
    return result;
  };
  env.navigate('https://example.com/parsing', { complete: false, readyState: 'loading' });
  await snapshotReady;
  env.update(41, { status: 'complete' });
  release();
  await settle();
  assert.equal(env.state.active, true);
  assert.equal(env.state.injections, 2);
  assert.equal(env.state.timers.size, 0);
});

test('early DOM readiness can succeed on a retry before load and OFF cancels outstanding checks immediately', async () => {
  const env = environment();
  await env.send('goshen:enable');
  env.navigate('https://example.com/parsing', { complete: false, readyState: 'loading' });
  await settle();
  assert.equal(env.state.active, false);
  env.page.document.readyState = 'interactive';
  await env.advance(40);
  assert.equal(env.state.active, true);
  env.navigate('https://example.com/still-parsing', { complete: false, readyState: 'loading' });
  await settle();
  assert.equal(env.state.timers.size, 1);
  const off = await env.send('goshen:disable');
  assert.equal(off.ok, true, 'OFF must not wait for DOMContentLoaded or window load');
  assert.equal(off.persistent, false);
  assert.equal(env.state.timers.size, 0);
  env.page.document.readyState = 'interactive';
  await env.advance(10000);
  assert.equal(env.state.active, false);
  assert.equal(env.state.injections, 2);
});

test('loading an unselected tab schedules no checks, and closing an opted-in tab clears its retry timer', async () => {
  const unselected = environment();
  unselected.navigate('https://example.com/native', { complete: false, readyState: 'loading' });
  await unselected.advance(10000);
  assert.equal(unselected.state.calls.length, 0);
  assert.equal(unselected.state.timers.size, 0);
  const env = environment();
  await env.send('goshen:enable');
  env.beginNavigation('https://example.com/waiting');
  await settle();
  assert.equal(env.state.timers.size, 1);
  env.close();
  await env.advance(10000);
  assert.equal(env.state.timers.size, 0);
  assert.deepEqual(env.state.sessionData['goshen.tab-intents'], {});
});

test('interactive readiness bypasses every coarse retry interval and survives retry exhaustion', async () => {
  for (const readyAt of [281,601,1241,2241,3741]) {
    const env = environment();
    await env.send('goshen:enable');
    env.navigate('https://example.com/parser-delay', { complete:false,readyState:'loading' });
    await env.advance(readyAt);
    assert.equal(env.state.active,false);
    const remaining = [...env.state.timers.values()].map(timer => timer.due - readyAt);
    if (readyAt === 3741) assert.equal(remaining.length,0,'The final polling retry has already expired');
    else assert.ok(remaining[0] >= 319,'The model reproduces the old coarse readiness delay');
    env.emitDocument('readystatechange','interactive');
    await settle();
    assert.equal(env.state.active,true,`Ready at ${readyAt}ms should not wait for another timer or full load`);
    assert.equal(env.state.now,readyAt);
    assert.equal(env.state.injections,2);
    assert.equal(env.state.timers.size,0);
    assert.equal(env.page.GoshenDOMReadyNotifier,undefined);
    for (const callbacks of env.documentListeners.values()) assert.equal(callbacks.size,0);
    assert.equal(env.windowListeners.get('pagehide').size,0);
    env.emitDocument('DOMContentLoaded');
    env.update(41,{ status:'complete' });
    await settle();
    assert.equal(env.state.injections,2,'Later ready/load signals cannot inject another runtime');
  }
});

test('notifier reinjection is idempotent and waits for a body, with DOMContentLoaded fallback and pagehide cleanup', async () => {
  const env = environment();
  await env.send('goshen:enable');
  env.navigate('https://example.com/parser-delay', { complete:false,readyState:'loading' });
  await env.advance(1241);
  assert.equal(env.documentListeners.get('readystatechange').size,1);
  assert.equal(env.documentListeners.get('DOMContentLoaded').size,1);
  assert.equal(env.windowListeners.get('pagehide').size,1);
  env.page.document.body = null;
  env.emitDocument('readystatechange','interactive');
  await settle();
  assert.equal(env.state.active,false);
  env.page.document.body = {};
  env.emitDocument('DOMContentLoaded','complete');
  await settle();
  assert.equal(env.state.active,true,'A known new document may already be complete while tabs still reports loading');
  assert.equal(env.state.tabStatuses.get(41),'loading');
  env.navigate('https://example.com/another-parser', { complete:false,readyState:'loading' });
  await settle();
  env.hidePage();
  assert.equal(env.page.GoshenDOMReadyNotifier,undefined);
  for (const callbacks of env.documentListeners.values()) assert.equal(callbacks.size,0);
  assert.equal(env.windowListeners.get('pagehide').size,0);
});

test('ready messages reject forged, non-main, inactive and mismatched-document senders without page work', async () => {
  const env = environment();
  await env.send('goshen:enable');
  env.navigate('https://example.com/parser-delay', { complete:false,readyState:'loading' });
  await settle();
  const message = { type:'goshen:document-ready',token:env.page.GoshenDOMReadyNotifier.token };
  const sender = env.pageSender();
  const before = env.state.calls.length;
  for (const invalid of [
    { ...sender,id:'another-extension' }, { ...sender,frameId:1 },
    { ...sender,documentLifecycle:'cached' }, { ...sender,documentLifecycle:undefined },
    { ...sender,documentId:undefined }, { ...sender,tab:undefined },
  ]) assert.equal(await env.send(message,invalid),undefined);
  assert.equal((await env.send(message,{ ...sender,documentId:'old-document' })).ok,false);
  assert.equal((await env.send({ ...message,token:'wrong-token' },sender)).ok,false);
  assert.equal(env.state.calls.length,before);
  assert.equal(env.state.active,false);
});

test('OFF, newer navigation and closed tabs reject old readiness tokens', async () => {
  const env = environment();
  await env.send('goshen:enable');
  env.navigate('https://example.com/parser-one', { complete:false,readyState:'loading' });
  await settle();
  const old = { type:'goshen:document-ready',token:env.page.GoshenDOMReadyNotifier.token };
  const oldSender = env.pageSender();
  env.navigate('https://example.com/parser-two', { complete:false,readyState:'loading' });
  await settle();
  assert.notEqual(env.page.GoshenDOMReadyNotifier.token,old.token);
  assert.equal((await env.send(old,oldSender)).ok,false);
  assert.equal((await env.send(old,env.pageSender())).ok,false,'Old generation cannot authorize even the replacement document');
  const current = { type:'goshen:document-ready',token:env.page.GoshenDOMReadyNotifier.token };
  const currentSender = env.pageSender();
  const off = await env.send('goshen:disable');
  assert.equal(off.ok,true); assert.equal(off.persistent,false);
  assert.equal(env.page.GoshenDOMReadyNotifier,undefined);
  assert.equal((await env.send(current,currentSender)).ok,false);
  env.close();
  assert.equal((await env.send(current,currentSender)).ok,false);
  env.emitDocument('readystatechange','interactive');
  await env.advance(10000);
  assert.equal(env.state.active,false);
  assert.equal(env.state.injections,1);
});

test('ready notification rechecks revoked cross-site access before any activation', async () => {
  const env = environment();
  await env.send('goshen:enable');
  env.state.permissionGranted = true;
  await env.send({ type:'goshen:follow',followCrossSite:true }); await settle();
  env.navigate('https://other.example/parser-delay', { complete:false,readyState:'loading' });
  await settle();
  assert.ok(env.page.GoshenDOMReadyNotifier);
  env.state.permissionGranted = false;
  const before = env.state.calls.length;
  env.emitDocument('readystatechange','interactive');
  await settle();
  assert.equal(env.state.active,false);
  assert.equal(env.state.calls.length,before,'A revoked grant must prevent even another page probe');
  assert.equal(env.state.injections,1);
  env.grantAccess(); await settle();
  assert.equal(env.state.active,true,'An explicit later grant can resume the existing opted-in tab');
});

test('a ready notification that beats its probe result is not lost or allowed to block OFF', async () => {
  for (const turnOff of [false,true]) {
    const env = environment();
    await env.send('goshen:enable');
    const execute = env.chrome.scripting.executeScript;
    let reached, release, held = false;
    const entered = new Promise(resolve => { reached = resolve; });
    const barrier = new Promise(resolve => { release = resolve; });
    env.chrome.scripting.executeScript = async options => {
      const result = await execute(options);
      if (!held && options.func?.name === 'readPageState' && result[0].result.notReady) {
        held = true; reached(); await barrier;
      }
      return result;
    };
    env.navigate('https://example.com/parser-delay',{ complete:false,readyState:'loading' });
    await entered;
    env.emitDocument('readystatechange','interactive');
    const off = turnOff ? env.send('goshen:disable') : null;
    await settle();
    release();
    if (off) assert.equal((await off).ok,true);
    await settle();
    assert.equal(env.state.active,!turnOff);
    assert.equal(env.state.injections,turnOff ? 1 : 2);
    assert.equal(env.state.timers.size,0);
  }
});

test('ready sender document is checked again after a same-origin replacement wins the queue', async () => {
  const env = environment();
  await env.send('goshen:enable');
  env.navigate('https://example.com/parser-delay',{ complete:false,readyState:'loading' });
  await settle();
  const sender = env.pageSender();
  const message = { type:'goshen:document-ready',token:env.page.GoshenDOMReadyNotifier.token };
  env.page.document.readyState = 'interactive';
  // Model an already committed same-origin replacement before its tabs event.
  env.state.documentId = 'replacement-before-event';
  const before = env.state.calls.length;
  await env.send(message,sender); await settle();
  assert.equal(env.state.active,false);
  assert.equal(env.state.calls.slice(before).some(([kind,call]) => kind === 'insert' || kind === 'execute' && (call.files || call.func === 'changePageState')),false);
});

test('a new completed document does not wait for a stale tabs loading flag', async () => {
  const env = environment();
  await env.send('goshen:enable');
  env.navigate('https://example.com/fast-document',{ complete:false,readyState:'complete' });
  await settle();
  assert.equal(env.state.tabStatuses.get(41),'loading');
  assert.equal(env.state.active,true);
  assert.equal(env.state.documentId,'doc-2');
  assert.equal(env.state.injections,2);
});

test('global removal clears every Follow choice, rebinds current sites and leaves rendered appearances untouched', async () => {
  const env = environment({ url: 'https://current.example/article', permissionGranted: true, session: {
    'goshen.tab-intents': {
      41: { origin: 'https://old.example', followCrossSite: true },
      42: { origin: 'https://manual.example', followCrossSite: false },
      43: { origin: 'https://chatgpt.com', followCrossSite: true },
      44: { origin: 'https://old.example', followCrossSite: true },
      45: { origin: 'https://missing.example', followCrossSite: true },
    },
  } });
  env.state.tabURLs.set(42, 'https://manual.example/article');
  env.state.tabURLs.set(43, 'https://chatgpt.com/c/test');
  env.state.tabURLs.set(44, 'chrome://settings');
  env.state.tabURLs.set(99, 'https://ordinary.example');
  env.state.active = env.state.css = true;
  const result = await env.send('goshen:remove-cross-site-access');
  assert.deepEqual(result, { ok: true, crossSiteAccessRemoved: true, followPermissionGranted: false, crossSiteAccessGranted: false });
  assert.deepEqual(env.state.sessionData, {
    'goshen.tab-intents': {
      41: { origin: 'https://current.example', followCrossSite: false },
      42: { origin: 'https://manual.example', followCrossSite: false },
      43: { origin: 'https://chatgpt.com', followCrossSite: false },
    },
    'goshen.cross-site-access-revoked': true,
  });
  assert.equal(env.state.active, true);
  assert.equal(env.state.css, true);
  assert.deepEqual(env.state.calls, [], 'Global removal never probes, disables or reinjects any page');
  assert.deepEqual(env.state.writes, [], 'Appearance and automatic ChatGPT preferences remain unchanged');
  assert.deepEqual(env.state.permissionRemovals, [{ origins: ['http://*/*', 'https://*/*'] }]);
  assert.equal(await env.chrome.permissions.contains({ origins: ['http://*/*'] }), false);
  assert.equal(await env.chrome.permissions.contains({ origins: ['https://*/*'] }), false);
});

test('global removal keeps same-site manual operation and automatic ChatGPT appearance available', async () => {
  const env = environment({ permissionGranted: true });
  await env.send('goshen:enable');
  await env.send({ type: 'goshen:follow', followCrossSite: true });
  await settle();
  env.navigate('https://current.example/one');
  await settle();
  assert.equal(env.state.active, true);
  assert.equal((await env.send('goshen:remove-cross-site-access')).ok, true);
  assert.equal(env.state.active, true);
  env.navigate('https://current.example/two');
  await settle();
  assert.equal(env.state.active, true, 'The current origin keeps its manually activated theme');
  env.navigate('https://example.com/back');
  await settle();
  assert.equal(env.state.active, false, 'The old Follow origin cannot revive cross-site activation');
  assert.equal((await env.send('goshen:enable')).enabled, true, 'A new manual activation still works');

  const chat = environment({ url: 'https://chatgpt.com/', chatRuntime: true, settings: { enabled: true }, permissionGranted: true });
  await chat.send('goshen:enable');
  const before = plain(chat.state.data);
  const calls = chat.state.calls.length;
  assert.equal((await chat.send('goshen:remove-cross-site-access')).ok, true);
  assert.equal(chat.attributes.get('data-cd-enabled'), 'true');
  assert.deepEqual(chat.state.data, before);
  assert.equal(chat.state.calls.length, calls);
});

test('only the extension popup can request global permission removal', async () => {
  const env = environment({ permissionGranted: true });
  for (const sender of [
    { id: 'other', url: 'chrome-extension://goshen-test/popup.html' },
    { id: 'goshen-test', url: 'https://example.com', tab: { id: 41 } },
    { id: 'goshen-test', url: 'chrome-extension://goshen-test/other.html' },
  ]) assert.equal((await env.send('goshen:remove-cross-site-access', sender)).ok, false);
  assert.deepEqual(env.state.permissionRemovals, []);
  assert.equal(env.state.permissionGranted, true);
});

test('partial removal of either protocol never claims success and still exposes remaining access', async () => {
  for (const remaining of ['http://*/*', 'https://*/*']) {
    const env = environment({ permissionGranted: true });
    await env.send('goshen:enable');
    await env.send({ type: 'goshen:follow', followCrossSite: true });
    await settle();
    const remove = env.chrome.permissions.remove;
    env.chrome.permissions.remove = async options => { await remove(options); env.state.originPermissions.set(remaining, true); return true; };
    const result = await env.send('goshen:remove-cross-site-access');
    assert.equal(result.ok, false);
    assert.notEqual(result.crossSiteAccessRemoved, true);
    assert.match(result.error, /could not be verified/);
    const grants = await env.chrome.permissions.getAll();
    assert.ok(grants.origins.includes(remaining));
    assert.ok(!grants.origins.includes(remaining === 'http://*/*' ? 'https://*/*' : 'http://*/*'));
    const status = await env.send('goshen:status');
    assert.equal(status.followCrossSite, false);
    assert.equal(status.followPermissionGranted, false);
    assert.equal(status.crossSiteAccessGranted, true, 'A partial grant keeps the explicit removal control available');
    assert.equal(env.state.sessionData['goshen.cross-site-access-revoked'], true);
  }
});

test('rejected removal or a false removal result with grants remaining cannot report success', async () => {
  for (const rejects of [true, false]) {
    const env = environment({ permissionGranted: true });
    await env.send('goshen:enable');
    await env.send({ type: 'goshen:follow', followCrossSite: true });
    await settle();
    env.chrome.permissions.remove = async () => { if (rejects) throw new Error('Chrome rejected permission removal'); return false; };
    const result = await env.send('goshen:remove-cross-site-access');
    assert.equal(result.ok, false);
    assert.notEqual(result.crossSiteAccessRemoved, true);
    assert.equal(env.state.sessionData['goshen.tab-intents'][41].followCrossSite, false);
    assert.equal(env.state.active, true);
    assert.equal((await env.send('goshen:status')).crossSiteAccessGranted, true);
  }
});

test('failed permission verification reports uncertainty and leaves removal available for retry', async () => {
  for (const failBeforeRemoval of [true, false]) {
    const env = environment({ permissionGranted: true });
    await env.send('goshen:enable');
    const getAll = env.chrome.permissions.getAll;
    env.chrome.permissions.getAll = async () => {
      if (failBeforeRemoval || env.state.permissionRemovals.length) throw new Error('Permission enumeration unavailable');
      return getAll();
    };
    const result = await env.send('goshen:remove-cross-site-access');
    assert.equal(result.ok, false);
    assert.notEqual(result.crossSiteAccessRemoved, true);
    assert.ok(env.state.permissionRemovals.some(request => request.origins.includes('http://*/*') && request.origins.includes('https://*/*')), 'Enumeration failure cannot prevent a fallback broad-removal attempt');
    const status = await env.send('goshen:status');
    assert.equal(status.followPermissionGranted, false);
    assert.equal(status.crossSiteAccessGranted, true, 'An unknown grant is not presented as removed');
  }
});

test('obsolete dynamic scripts are removed at startup and checked again during global removal', async () => {
  const env = environment({ registeredScripts: [{ id: 'legacy-follow', matches: ['https://*/*'] }, { id: 'legacy-theme', matches: ['http://*/*'] }], permissionGranted: true });
  await settle();
  assert.deepEqual(env.state.registeredScripts, []);
  assert.deepEqual(env.state.registrationCalls.find(([kind]) => kind === 'unregister')[1].ids.sort(), ['legacy-follow', 'legacy-theme']);
  env.state.registeredScripts.push({ id: 'remaining-old-script', matches: ['https://*/*'] });
  assert.equal((await env.send('goshen:remove-cross-site-access')).ok, true);
  assert.deepEqual(env.state.registeredScripts, []);
  assert.equal(env.state.injections, 0);
});

test('failed legacy-script cleanup cannot be reported as successful access removal', async () => {
  const env = environment({ permissionGranted: true });
  await settle();
  env.state.registeredScripts.push({ id: 'legacy-follow', matches: ['https://*/*'] });
  env.chrome.scripting.unregisterContentScripts = async () => { throw new Error('Unregistration failed'); };
  const result = await env.send('goshen:remove-cross-site-access');
  assert.equal(result.ok, false);
  assert.notEqual(result.crossSiteAccessRemoved, true);
  assert.equal(await env.chrome.permissions.contains({ origins: ['http://*/*', 'https://*/*'] }), false, 'Host removal is still attempted when registration cleanup fails');
});

test('an earlier startup cleanup failure cannot prevent a later explicit removal attempt', async () => {
  const env = environment({ permissionGranted: true, failRegistrationRead: true, registeredScripts: [{ id: 'legacy-follow', matches: ['https://*/*'] }] });
  await settle();
  assert.equal((await env.send('goshen:enable')).ok, false);
  assert.equal(env.state.injections, 0);
  env.state.failRegistrationRead = false;
  assert.equal((await env.send('goshen:remove-cross-site-access')).ok, true);
  assert.deepEqual(env.state.registeredScripts, []);
  assert.equal(await env.chrome.permissions.contains({ origins: ['http://*/*'] }), false);
  assert.equal(await env.chrome.permissions.contains({ origins: ['https://*/*'] }), false);
});

test('unreadable session state still allows host removal but is never overwritten or reported as complete', async () => {
  const session = { 'goshen.tab-intents': { 41: { origin: 'https://example.com', followCrossSite: true } } };
  const env = environment({ permissionGranted: true, session, failSessionRead: true });
  await settle();
  const result = await env.send('goshen:remove-cross-site-access');
  assert.equal(result.ok, false);
  assert.notEqual(result.crossSiteAccessRemoved, true);
  assert.equal(await env.chrome.permissions.contains({ origins: ['http://*/*'] }), false);
  assert.equal(await env.chrome.permissions.contains({ origins: ['https://*/*'] }), false);
  assert.deepEqual(env.state.sessionData, session);
  assert.deepEqual(env.state.sessionWrites, []);
});

test('failed persistence of revoked state prevents success even after browser grants are removed', async () => {
  const env = environment({ permissionGranted: true });
  await env.send('goshen:enable');
  env.chrome.storage.session.set = async () => { throw new Error('Session write unavailable'); };
  const result = await env.send('goshen:remove-cross-site-access');
  assert.equal(result.ok, false);
  assert.notEqual(result.crossSiteAccessRemoved, true);
  assert.equal(await env.chrome.permissions.contains({ origins: ['http://*/*'] }), false);
  assert.equal(await env.chrome.permissions.contains({ origins: ['https://*/*'] }), false);
});

test('required ChatGPT grants do not trigger optional-access removal or disturb its revocation marker', async () => {
  const env = environment({ url: 'https://chatgpt.com/', chatRuntime: true, settings: { enabled: true } });
  assert.equal((await env.send('goshen:remove-cross-site-access')).ok, true);
  const removals = env.state.permissionRemovals.length;
  const writes = env.state.sessionWrites.length;
  env.grantAccess(['https://chatgpt.com/*', 'https://chat.openai.com/*']);
  await settle();
  assert.equal(env.state.permissionRemovals.length, removals);
  assert.equal(env.state.sessionWrites.length, writes);
  assert.equal(env.state.sessionData['goshen.cross-site-access-revoked'], true);
  assert.equal(env.attributes.get('data-cd-enabled'), 'true');
  assert.equal(await env.chrome.permissions.contains({ origins: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] }), true);
});

test('a revoked worker with no optional access can answer its first popup request without canceling it', async () => {
  const env = environment({ session: { 'goshen.cross-site-access-revoked': true } });
  const status = await env.send('goshen:status');
  assert.equal(status.ok, true);
  assert.equal(status.crossSiteAccessGranted, false);
  assert.equal(env.state.permissionRemovals.length, 0);
});

test('a delayed old grant is removed again without reviving Follow, including after a worker restart', async () => {
  const env = environment({ permissionGranted: true });
  await env.send('goshen:enable');
  await env.send({ type: 'goshen:follow', followCrossSite: true });
  await settle();
  assert.equal((await env.send('goshen:remove-cross-site-access')).ok, true);
  const calls = env.state.calls.length;
  const removals = env.state.permissionRemovals.length;
  env.grantAccess();
  await settle();
  assert.ok(env.state.permissionRemovals.length > removals);
  assert.equal(await env.chrome.permissions.contains({ origins: ['http://*/*'] }), false);
  assert.equal(await env.chrome.permissions.contains({ origins: ['https://*/*'] }), false);
  assert.equal(env.state.sessionData['goshen.tab-intents'][41].followCrossSite, false);
  assert.equal(env.state.calls.length, calls, 'A stale grant cannot perform page work');

  const restarted = environment({ session: env.state.sessionData, permissionGranted: true });
  await settle();
  assert.equal(await restarted.chrome.permissions.contains({ origins: ['http://*/*'] }), false);
  assert.equal(await restarted.chrome.permissions.contains({ origins: ['https://*/*'] }), false);
  assert.equal(restarted.state.sessionData['goshen.cross-site-access-revoked'], true);
  assert.equal(restarted.state.sessionData['goshen.tab-intents'][41].followCrossSite, false);
  assert.deepEqual(restarted.state.calls, []);
});

test('a late grant after verification snapshots cannot survive an in-flight global removal', async () => {
  const env = environment({ permissionGranted: true });
  await env.send('goshen:enable');
  const getAll = env.chrome.permissions.getAll;
  let reached, release, held = false;
  const entered = new Promise(resolve => { reached = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  env.chrome.permissions.getAll = async () => {
    const result = await getAll();
    if (!held && env.state.permissionRemovals.length) {
      held = true; reached(); await barrier;
    }
    return result;
  };
  const removing = env.send('goshen:remove-cross-site-access');
  await entered;
  env.grantAccess();
  await settle();
  release();
  const result = await removing;
  await settle();
  assert.equal(result.ok, true);
  assert.deepEqual((await getAll()).origins.sort(), ['https://chat.openai.com/*', 'https://chatgpt.com/*'], 'A stale successful enumeration cannot conceal later optional grants');
  assert.ok(env.state.permissionRemovals.length >= 2);
});

test('global removal cancels an activation paused during injection before it can create new intent', async () => {
  const env = environment({ permissionGranted: true });
  const insert = env.chrome.scripting.insertCSS;
  let reached, release;
  const entered = new Promise(resolve => { reached = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  env.chrome.scripting.insertCSS = async options => { await insert(options); reached(); await barrier; };
  const enabling = env.send('goshen:enable');
  await entered;
  assert.equal((await env.send('goshen:remove-cross-site-access')).ok, true);
  release();
  assert.equal((await enabling).ok, false);
  await settle();
  assert.equal(env.state.active, false);
  assert.equal(env.state.css, false);
  assert.deepEqual(env.state.sessionData['goshen.tab-intents'], {});
  env.navigate('https://example.com/next');
  await settle();
  assert.equal(env.state.active, false);
});

test('an old Follow request cannot overtake removal but a new explicit Follow choice works afterward', async () => {
  const env = environment({ permissionGranted: true });
  await env.send('goshen:enable');
  const get = env.chrome.tabs.get;
  let reached, release, held = false;
  const entered = new Promise(resolve => { reached = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  env.chrome.tabs.get = async id => {
    const tab = await get(id);
    if (!held) { held = true; reached(); await barrier; }
    return tab;
  };
  const following = env.send({ type: 'goshen:follow', followCrossSite: true });
  await entered;
  assert.equal((await env.send('goshen:remove-cross-site-access')).ok, true);
  release();
  assert.equal((await following).ok, false);
  assert.equal(env.state.sessionData['goshen.tab-intents'][41].followCrossSite, false);
  assert.equal(env.state.sessionData['goshen.cross-site-access-revoked'], true);
  assert.equal((await env.send({ type: 'goshen:follow', followCrossSite: true })).followCrossSite, true);
  assert.equal(env.state.sessionData['goshen.cross-site-access-revoked'], false);
  env.grantAccess();
  await settle();
  env.navigate('https://new.example/allowed');
  await settle();
  assert.equal(env.state.active, true, 'The new explicit Follow choice permits a new cross-site grant');
});

test('one-site optional access is visible and explicitly removed while required ChatGPT grants remain', async () => {
  const env = environment({ originPermissions: { 'https://example.org/*': true } });
  assert.equal(await env.chrome.permissions.contains({ origins: ['http://*/*', 'https://*/*'] }), false);
  const status = await env.send('goshen:status');
  assert.equal(status.followPermissionGranted, false);
  assert.equal(status.crossSiteAccessGranted, true, 'A narrow optional grant must still expose the global removal action');
  const result = await env.send('goshen:remove-cross-site-access');
  assert.equal(result.ok, true);
  assert.equal(result.crossSiteAccessRemoved, true);
  assert.ok(env.state.permissionRemovals.some(request => request.origins.includes('https://example.org/*')), 'The actual narrow grant must be included in the removal request');
  assert.ok(env.state.permissionRemovals.every(request => !request.origins.includes('https://chatgpt.com/*') && !request.origins.includes('https://chat.openai.com/*')));
  assert.deepEqual((await env.chrome.permissions.getAll()).origins.sort(), ['https://chat.openai.com/*', 'https://chatgpt.com/*']);
  assert.equal((await env.send('goshen:status')).crossSiteAccessGranted, false);
});

test('a narrow optional grant surviving removal prevents a false success even when both broad checks are false', async () => {
  const env = environment({ originPermissions: { 'https://example.org/*': true } });
  const remove = env.chrome.permissions.remove;
  env.chrome.permissions.remove = async options => {
    await remove(options);
    env.state.originPermissions.set('https://example.org/*', true);
    return true;
  };
  const result = await env.send('goshen:remove-cross-site-access');
  assert.equal(result.ok, false);
  assert.notEqual(result.crossSiteAccessRemoved, true);
  assert.equal(await env.chrome.permissions.contains({ origins: ['http://*/*'] }), false);
  assert.equal(await env.chrome.permissions.contains({ origins: ['https://*/*'] }), false);
  assert.ok((await env.chrome.permissions.getAll()).origins.includes('https://example.org/*'));
  assert.equal((await env.send('goshen:status')).crossSiteAccessGranted, true);
});

test('commands already waiting on the active-tab query cannot revive Follow or activation after global removal', async () => {
  for (const command of ['goshen:follow', 'goshen:enable']) {
    const env = environment({ permissionGranted: true });
    if (command === 'goshen:follow') await env.send('goshen:enable');
    const query = env.chrome.tabs.query;
    let reached, release, held = false;
    const entered = new Promise(resolve => { reached = resolve; });
    const barrier = new Promise(resolve => { release = resolve; });
    env.chrome.tabs.query = async options => {
      const tabs = await query(options);
      if (!held) { held = true; reached(); await barrier; }
      return tabs;
    };
    const pending = env.send({ type: command, ...(command === 'goshen:follow' ? { followCrossSite: true } : {}) });
    await entered;
    assert.equal((await env.send('goshen:remove-cross-site-access')).ok, true);
    const callsAfterRemoval = env.state.calls.length;
    release();
    const result = await pending;
    assert.equal(result.ok, false, `${command} began before removal and must not acquire a newer authorization`);
    assert.equal(env.state.calls.length, callsAfterRemoval, 'The stale command cannot proceed to inspect or alter a page');
    assert.equal(env.state.sessionData['goshen.cross-site-access-revoked'], true);
    assert.equal(env.state.sessionData['goshen.tab-intents'][41]?.followCrossSite === true, false);
    assert.equal(env.state.active, command === 'goshen:follow', 'An existing appearance survives; a pending activation does not run');
    env.grantAccess();
    await settle();
    env.navigate('https://other.example/after-revocation');
    await settle();
    assert.equal(env.state.active, false);
  }
});

test('an expected-tab command waiting on its query cannot overtake a later OFF on that tab', async () => {
  for (const command of ['goshen:follow', 'goshen:enable']) {
    const env = environment({ permissionGranted: true });
    await env.send('goshen:enable');
    const query = env.chrome.tabs.query;
    let reached, release, held = false;
    const entered = new Promise(resolve => { reached = resolve; });
    const barrier = new Promise(resolve => { release = resolve; });
    env.chrome.tabs.query = async options => {
      const tabs = await query(options);
      if (!held) { held = true; reached(); await barrier; }
      return tabs;
    };
    const pending = env.send({ type: command, expectedTabId: 41, ...(command === 'goshen:follow' ? { followCrossSite: true } : {}) });
    await entered;
    assert.equal((await env.send({ type: 'goshen:disable', expectedTabId: 41 })).ok, true);
    const callsAfterOff = env.state.calls.length;
    release();
    assert.equal((await pending).ok, false);
    assert.equal(env.state.calls.length, callsAfterOff, 'The stale command must not inspect or alter the page after OFF');
    assert.equal(env.state.active, false);
    assert.deepEqual(env.state.sessionData['goshen.tab-intents'], {});
    env.navigate('https://example.com/after-off');
    await settle();
    assert.equal(env.state.active, false);
  }
});
