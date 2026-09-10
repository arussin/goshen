import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const script = await readFile(new URL('../extension/popup.js', import.meta.url), 'utf8');
const markup = await readFile(new URL('../extension/popup.html', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

// A control/protocol harness only: this deliberately makes no browser-layout claims.
function harness({ preview = false, mode = 'universal', enabled = false, automatic = false, loadError = false, handler, persistent = false, followCrossSite = false, permissionGranted = true, accessGranted = false, permissionHandler } = {}) {
  const nodes = new Map();
  function node(id, attributes = '') {
    const events = new Map();
    const element = {
      id, dataset: {}, style: { setProperty() {} }, textContent: '', hidden: /\bhidden\b/.test(attributes),
      disabled: /\bdisabled\b/.test(attributes), checked: false,
      addEventListener(name, callback) { events.set(name, callback); },
      setAttribute(name, value) { this[name] = String(value); },
      fire(name, target = element) { events.get(name)?.({ target, preventDefault() {} }); },
      closest(selector) {
        if (selector === 'button[data-theme]' && this.dataset.theme) return this;
        if (selector === 'button[data-layout]' && this.dataset.layout) return this;
        if (selector === 'button[data-universal-style]' && this.dataset.universalStyle) return this;
        return null;
      },
    };
    for (const [, name, value] of attributes.matchAll(/\b(type|name|min|max|value)="([^"]*)"/g)) element[name] = value;
    nodes.set(id, element);
    return element;
  }
  for (const [, attributes, id] of markup.matchAll(/<\w+\b([^>]*\bid="([^"]+)"[^>]*)>/g)) node(id, attributes);
  const themeButtons = ['amber', 'green', 'ice'].map(theme => Object.assign(node(`theme-${theme}`), { dataset: { theme } }));
  const layoutButtons = ['deck', 'focus'].map(layout => Object.assign(node(`layout-${layout}`), { dataset: { layout } }));
  const styleButtons = ['terminal', 'frame'].map(universalStyle => Object.assign(node(`style-${universalStyle}`), { dataset: { universalStyle } }));
  const panel = node('page-panel');
  const pageRoot = node('html');
  const defaults = { enabled: automatic, theme: 'amber', layout: 'deck', universalStyle: 'terminal', motion: true, quips: true, respectReducedMotion: false, scanlines: 18, glow: 35, fontSize: 15 };
  let preferences = { ...defaults };
  const saves = [];
  const messages = [];
  const packets = [];
  const permissionRequests = [];
  const eventOrder = [];
  const windowEvents = new Map();
  const api = {
    defaults,
    normalize(value) { return { ...defaults, ...value }; },
    async load() { if (loadError) throw new Error('Preference storage unavailable'); return preferences; },
    async save(patch) { saves.push(patch); preferences = { ...preferences, ...patch }; return preferences; },
    subscribe() { return () => {}; },
  };
  const context = vm.createContext({
    CyberdeckSettings: api,
    window: { addEventListener(type, listener) { windowEvents.set(type, listener); } },
    document: {
      documentElement: pageRoot,
      getElementById(id) { assert.ok(nodes.has(id), `Missing popup element: ${id}`); return nodes.get(id); },
      querySelector() { return panel; },
      querySelectorAll(selector) {
        if (selector === '[data-theme].theme-choice') return themeButtons;
        if (selector === 'button[data-layout]') return layoutButtons;
        if (selector === 'button[data-universal-style]') return styleButtons;
        return [];
      },
    },
    ...(preview ? {} : { chrome: { runtime: { id: 'popup-test', async sendMessage(message) {
      messages.push(message.type);
      eventOrder.push(message.type);
      packets.push(JSON.parse(JSON.stringify(message)));
      if (handler) return handler(message);
      if (message.type === 'goshen:enable') enabled = persistent = true;
      if (message.type === 'goshen:disable') enabled = persistent = followCrossSite = false;
      if (message.type === 'goshen:follow') followCrossSite = message.followCrossSite;
      return { ok: true, tabId: 41, host: mode === 'chatgpt' ? 'chatgpt.com' : 'example.org', mode, enabled, persistent, followCrossSite, followPermissionGranted: accessGranted, reason: 'This browser page cannot be changed.' };
    } }, permissions: { request(options) {
      eventOrder.push('permissions:request');
      permissionRequests.push(JSON.parse(JSON.stringify(options)));
      return Promise.resolve(permissionHandler ? permissionHandler() : permissionGranted).then(granted => { accessGranted = granted; return granted; });
    } } } }),
  });
  vm.runInContext(script, context, { filename: 'popup.js' });
  return { nodes, messages, saves, panel, packets, permissionRequests, eventOrder,
    closePopup: () => windowEvents.get('pagehide')?.(),
    pageOff: () => { enabled = persistent = followCrossSite = false; },
    tabState: () => ({ enabled, persistent, followCrossSite, accessGranted }),
  };
}

test('page activation works while automatic ChatGPT startup is off, then exits without changing preferences', async () => {
  const { nodes, messages, saves } = harness({ automatic: false });
  await settle();
  assert.equal(nodes.get('page-toggle').textContent, 'TERMINAL ON');
  assert.equal(nodes.get('enabled').checked, false);
  nodes.get('page-toggle').fire('click');
  assert.equal(nodes.get('page-toggle').disabled, true);
  await settle();
  assert.equal(nodes.get('page-toggle').textContent, 'TERMINAL OFF');
  assert.equal(nodes.get('page-state').textContent, 'ACTIVE');
  nodes.get('page-toggle').fire('click');
  await settle();
  assert.deepEqual(messages, ['goshen:status', 'goshen:enable', 'goshen:disable']);
  assert.equal(saves.length, 0);
  assert.equal(nodes.get('page-toggle').textContent, 'TERMINAL ON');
});

test('unsupported pages show the supplied reason and never dispatch activation', async () => {
  const { nodes, messages } = harness({ mode: 'unsupported' });
  await settle();
  assert.equal(nodes.get('page-toggle').disabled, true);
  assert.equal(nodes.get('page-hint').textContent, 'This browser page cannot be changed.');
  nodes.get('page-toggle').fire('click');
  assert.deepEqual(messages, ['goshen:status']);
});

test('a failed activation stays off, exposes the error, and permits retry', async () => {
  let attempts = 0;
  const { nodes } = harness({ handler: ({ type }) => {
    if (type === 'goshen:enable' && ++attempts === 1) return { ok: false, error: 'Refresh this page and try again.' };
    return { ok: true, host: 'example.org', mode: 'universal', enabled: type === 'goshen:enable' };
  } });
  await settle();
  nodes.get('page-toggle').fire('click');
  await settle();
  assert.equal(nodes.get('page-error').hidden, false);
  assert.equal(nodes.get('page-error-message').textContent, 'Refresh this page and try again.');
  assert.equal(nodes.get('page-state').textContent, 'OFF');
  assert.equal(nodes.get('page-toggle').disabled, false);
  nodes.get('page-toggle').fire('click');
  await settle();
  assert.equal(nodes.get('page-state').textContent, 'ACTIVE');
  assert.equal(nodes.get('page-error').hidden, true);
});

test('a failed status read can be retried without claiming that activation succeeded', async () => {
  let checks = 0;
  const { nodes } = harness({ handler: () => {
    if (++checks === 1) throw new Error('Extension connection interrupted');
    return { ok: true, host: 'example.org', mode: 'universal', enabled: false };
  } });
  await settle();
  assert.equal(nodes.get('page-state').textContent, 'UNAVAILABLE');
  assert.equal(nodes.get('page-toggle').disabled, true);
  nodes.get('page-retry').fire('click');
  await settle();
  assert.equal(nodes.get('page-state').textContent, 'OFF');
  assert.equal(nodes.get('page-toggle').disabled, false);
});

test('preview cannot activate pages but its appearance controls remain usable', async () => {
  const { nodes, messages, saves } = harness({ preview: true });
  await settle();
  assert.equal(nodes.get('page-host').textContent, 'Local preview');
  assert.equal(nodes.get('page-toggle').disabled, true);
  assert.equal(nodes.get('preferences').disabled, false);
  nodes.get('controls').fire('click', nodes.get('style-frame'));
  await settle();
  assert.deepEqual(messages, []);
  assert.equal(saves[0].universalStyle, 'frame');
});

test('layout controls match page mode, while appearance failure does not disable page activation', async () => {
  const chatgpt = harness({ mode: 'chatgpt' });
  const universal = harness({ loadError: true });
  await settle();
  assert.equal(chatgpt.nodes.get('universal-style-section').hidden, true);
  assert.equal(chatgpt.nodes.get('chatgpt-layout-section').hidden, false);
  assert.equal(universal.nodes.get('chatgpt-layout-section').hidden, true);
  assert.equal(universal.nodes.get('universal-style-section').hidden, false);
  assert.equal(universal.nodes.get('error').hidden, false);
  assert.equal(universal.nodes.get('preferences').disabled, true);
  assert.equal(universal.nodes.get('page-toggle').disabled, false);
});

test('opening or activating the popup never requests broader site access', async () => {
  const { nodes, permissionRequests } = harness();
  await settle();
  assert.equal(nodes.get('follow-tab').disabled, true);
  nodes.get('page-toggle').fire('click');
  await settle();
  assert.equal(nodes.get('follow-tab').disabled, false);
  assert.deepEqual(permissionRequests, []);
});

test('cross-site follow requests access immediately from its explicit gesture, then scopes the command to this tab', async () => {
  const { nodes, permissionRequests, packets, eventOrder } = harness({ enabled: true, persistent: true });
  await settle();
  const toggle = nodes.get('follow-tab');
  toggle.checked = true;
  toggle.fire('change');
  assert.deepEqual(eventOrder, ['goshen:status', 'goshen:follow', 'permissions:request'], 'Desired intent is dispatched before the permission window can destroy the popup');
  assert.deepEqual(permissionRequests, [{ origins: ['http://*/*', 'https://*/*'] }], 'Permission request happens synchronously before the handler awaits');
  assert.equal(toggle.disabled, true);
  await settle();
  assert.equal(toggle.checked, true);
  assert.deepEqual(packets[1], { type: 'goshen:follow', followCrossSite: true, expectedTabId: 41 });
  assert.deepEqual(packets.at(-1), { type: 'goshen:status', expectedTabId: 41 });
  assert.equal(nodes.get('follow-access').hidden, true);
  toggle.checked = false;
  toggle.fire('change');
  await settle();
  assert.equal(permissionRequests.length, 1, 'Turning following off never requests access');
  assert.equal(toggle.checked, false);
  assert.equal(packets.some(packet => packet.type === 'goshen:remove-cross-site-access'), false, 'An individual tab choice must not revoke access for every tab');
  assert.equal(nodes.get('remove-cross-site-access').hidden, false, 'Optional permission stays granted until explicitly removed');
});

test('global access removal is available only for actual granted access, including an inactive tab', async () => {
  const absent = harness({ followCrossSite: true, persistent: true });
  const granted = harness({ accessGranted: true });
  const preview = harness({ preview: true });
  await settle();
  assert.equal(absent.nodes.get('remove-cross-site-access').hidden, true);
  assert.equal(absent.nodes.get('remove-access-hint').hidden, true);
  absent.nodes.get('remove-cross-site-access').fire('click');
  assert.deepEqual(absent.messages, ['goshen:status']);
  assert.equal(granted.nodes.get('remove-cross-site-access').hidden, false);
  assert.equal(granted.nodes.get('remove-cross-site-access').disabled, false);
  assert.equal(granted.nodes.get('remove-access-hint').hidden, false);
  assert.equal(preview.nodes.get('remove-cross-site-access').hidden, true);
});

test('explicit global removal goes through the worker and reports success only after confirmed revocation', async () => {
  let finishRemoval;
  const response = { ok: true, tabId: 41, host: 'chatgpt.com', mode: 'chatgpt', enabled: true, persistent: true, followCrossSite: true, followPermissionGranted: true };
  const { nodes, packets, saves, permissionRequests, panel } = harness({ automatic: true, handler: message => {
    if (message.type === 'goshen:remove-cross-site-access') return new Promise(resolve => { finishRemoval = resolve; });
    return response;
  } });
  await settle();
  nodes.get('remove-cross-site-access').fire('click');
  assert.deepEqual(packets.at(-1), { type: 'goshen:remove-cross-site-access', expectedTabId: 41 });
  assert.equal(panel['aria-busy'], 'true');
  for (const id of ['remove-cross-site-access', 'follow-tab', 'page-toggle', 'page-retry', 'enabled']) assert.equal(nodes.get(id).disabled, true, `${id} stays disabled during removal`);
  assert.equal(nodes.get('page-notice').hidden, true);
  finishRemoval({ ok: true, crossSiteAccessRemoved: true, followPermissionGranted: false, crossSiteAccessGranted: false });
  await settle();
  assert.equal(nodes.get('page-notice').hidden, false);
  assert.equal(nodes.get('page-notice').textContent, 'Cross-site access removed. Automatic ChatGPT access is unchanged.');
  assert.equal(nodes.get('remove-cross-site-access').hidden, true);
  assert.equal(nodes.get('remove-access-hint').hidden, true);
  assert.equal(nodes.get('follow-tab').checked, false);
  assert.equal(nodes.get('page-state').textContent, 'ACTIVE');
  assert.equal(nodes.get('page-host').textContent, 'chatgpt.com');
  assert.equal(nodes.get('page-mode').textContent, 'CHATGPT TERMINAL');
  assert.equal(nodes.get('enabled').checked, true);
  assert.equal(nodes.get('enabled').disabled, false);
  assert.equal(panel['aria-busy'], 'false');
  assert.deepEqual(packets.map(packet => packet.type), ['goshen:status', 'goshen:remove-cross-site-access']);
  assert.deepEqual(permissionRequests, []);
  assert.deepEqual(saves, []);
});

test('failed global removal refreshes actual status while preserving the worker error', async () => {
  let attempted = false;
  const { nodes, packets } = harness({ handler: message => {
    if (message.type === 'goshen:remove-cross-site-access') {
      attempted = true;
      return { ok: false, error: 'Chrome could not remove cross-site access. Try again.' };
    }
    return { ok: true, tabId: 41, host: 'example.org', mode: 'universal', enabled: true, persistent: true, followCrossSite: !attempted, followPermissionGranted: !attempted, crossSiteAccessGranted: true };
  } });
  await settle();
  nodes.get('remove-cross-site-access').fire('click');
  await settle();
  assert.deepEqual(packets.map(packet => packet.type), ['goshen:status', 'goshen:remove-cross-site-access', 'goshen:status']);
  assert.equal(nodes.get('page-error-message').textContent, 'Chrome could not remove cross-site access. Try again.');
  assert.equal(nodes.get('page-error').hidden, false);
  assert.equal(nodes.get('page-notice').hidden, true);
  assert.equal(nodes.get('follow-tab').checked, false, 'Follow state comes from the refreshed reply, even when revocation failed');
  assert.equal(nodes.get('remove-cross-site-access').hidden, false, 'Removal remains available when only one optional origin grant remains');
  assert.equal(nodes.get('remove-cross-site-access').disabled, false);
});

test('failed refresh after removal failure leaves status unknown and retains the removal error', async () => {
  let attempted = false;
  const { nodes, messages } = harness({ handler: message => {
    if (message.type === 'goshen:remove-cross-site-access') {
      attempted = true;
      return { ok: false, error: 'Permission removal failed.' };
    }
    if (attempted) throw new Error('Worker disconnected');
    return { ok: true, tabId: 41, host: 'example.org', mode: 'universal', enabled: true, followPermissionGranted: true };
  } });
  await settle();
  nodes.get('remove-cross-site-access').fire('click');
  await settle();
  assert.deepEqual(messages, ['goshen:status', 'goshen:remove-cross-site-access', 'goshen:status']);
  assert.equal(nodes.get('page-error-message').textContent, 'Permission removal failed.');
  assert.equal(nodes.get('page-error').hidden, false);
  assert.equal(nodes.get('page-notice').hidden, true);
  assert.equal(nodes.get('page-state').textContent, 'UNAVAILABLE');
  assert.equal(nodes.get('page-retry').disabled, false);
});

test('an unconfirmed removal reply cannot show a success notice', async () => {
  for (const reply of [
    { ok: true, followPermissionGranted: false },
    { ok: true, crossSiteAccessRemoved: true, followPermissionGranted: true },
    { ok: true, crossSiteAccessRemoved: true, followPermissionGranted: false, crossSiteAccessGranted: true },
  ]) {
    const { nodes, messages } = harness({ handler: message => message.type === 'goshen:remove-cross-site-access' ? reply : ({ ok: true, tabId: 41, host: 'example.org', mode: 'universal', enabled: true, followPermissionGranted: true }) });
    await settle();
    nodes.get('remove-cross-site-access').fire('click');
    await settle();
    assert.deepEqual(messages, ['goshen:status', 'goshen:remove-cross-site-access', 'goshen:status']);
    assert.equal(nodes.get('page-notice').hidden, true);
    assert.equal(nodes.get('page-error').hidden, false);
    assert.match(nodes.get('page-error-message').textContent, /Could not confirm/);
    assert.equal(nodes.get('remove-cross-site-access').hidden, false);
  }
});

test('denied follow permission leaves same-site persistence and active appearance intact', async () => {
  const { nodes, packets } = harness({ enabled: true, persistent: true, permissionGranted: false });
  await settle();
  nodes.get('follow-tab').checked = true;
  nodes.get('follow-tab').fire('change');
  await settle();
  assert.equal(nodes.get('follow-tab').checked, false);
  assert.equal(nodes.get('page-state').textContent, 'ACTIVE');
  assert.equal(nodes.get('page-error').hidden, false);
  assert.match(nodes.get('page-error-message').textContent, /not granted/);
  assert.deepEqual(packets.filter(packet => packet.type === 'goshen:follow').map(packet => packet.followCrossSite), [true, false]);
});

test('closing the popup during the permission window cannot lose desired follow or send late mutations', async () => {
  for (const granted of [true, false]) {
    let finishPermission;
    const env = harness({ enabled: true, persistent: true, permissionHandler: () => new Promise(resolve => { finishPermission = resolve; }) });
    await settle();
    env.nodes.get('follow-tab').checked = true;
    env.nodes.get('follow-tab').fire('change');
    assert.equal(env.tabState().followCrossSite, true, 'The worker receives the choice before the popup disappears');
    env.closePopup();
    finishPermission(granted);
    await settle();
    assert.deepEqual(env.packets.map(packet => packet.type), ['goshen:status', 'goshen:follow']);
    assert.equal(env.tabState().followCrossSite, true);
    assert.equal(env.tabState().accessGranted, granted);
  }
});

test('an ungranted or revoked desired follow flag is truthful and offers an explicit access retry', async () => {
  const env = harness({ persistent: true, followCrossSite: true, enabled: false, accessGranted: false });
  await settle();
  assert.equal(env.nodes.get('page-state').textContent, 'PAUSED');
  assert.equal(env.nodes.get('follow-tab').checked, true);
  assert.match(env.nodes.get('follow-hint').textContent, /paused.*Allow website access/);
  assert.equal(env.nodes.get('follow-access').hidden, false);
  assert.deepEqual(env.permissionRequests, [], 'Opening a paused popup cannot prompt for permission');
  env.nodes.get('follow-access').fire('click');
  assert.equal(env.permissionRequests.length, 1);
  await settle();
  assert.equal(env.nodes.get('follow-access').hidden, true);
  assert.equal(env.tabState().accessGranted, true);
});

test('permission completion after a later page OFF never sends a new enable or follow-on command', async () => {
  for (const granted of [true, false]) {
    let finishPermission;
    const env = harness({ enabled: true, persistent: true, permissionHandler: () => new Promise(resolve => { finishPermission = resolve; }) });
    await settle();
    env.nodes.get('follow-tab').checked = true;
    env.nodes.get('follow-tab').fire('change');
    await settle();
    assert.equal(env.nodes.get('page-toggle').disabled, true, 'Popup controls remain busy until the permission flow completes');
    env.pageOff();
    finishPermission(granted);
    await settle();
    assert.equal(env.tabState().persistent, false);
    assert.equal(env.nodes.get('follow-tab').checked, false);
    assert.equal(env.nodes.get('page-state').textContent, 'OFF');
    assert.equal(env.packets.filter(packet => packet.type === 'goshen:follow' && packet.followCrossSite).length, 1);
    assert.equal(env.packets.some(packet => packet.type === 'goshen:enable'), false);
  }
});

test('paused intent can be switched off on protected pages and forgotten on another supported site', async () => {
  const protectedPage = harness({ mode: 'unsupported', persistent: true });
  const pausedPage = harness({ persistent: true });
  await settle();
  assert.equal(protectedPage.nodes.get('page-toggle').disabled, false);
  assert.equal(protectedPage.nodes.get('page-toggle').textContent, 'TERMINAL OFF');
  assert.equal(protectedPage.nodes.get('page-state').textContent, 'PAUSED');
  protectedPage.nodes.get('page-toggle').fire('click');
  assert.equal(pausedPage.nodes.get('page-forget').hidden, false);
  pausedPage.nodes.get('page-forget').fire('click');
  await settle();
  assert.equal(protectedPage.packets.at(-1).type, 'goshen:disable');
  assert.equal(pausedPage.packets.at(-1).type, 'goshen:disable');
  assert.equal(protectedPage.nodes.get('page-toggle').disabled, true);
  assert.equal(pausedPage.nodes.get('page-forget').hidden, true);
});

test('Automatic on ChatGPT OFF clears the current ChatGPT tab intent as well as the saved preference', async () => {
  const { nodes, saves, packets } = harness({ mode: 'chatgpt', automatic: true, enabled: true, persistent: true, followCrossSite: true });
  await settle();
  nodes.get('enabled').checked = false;
  nodes.get('controls').fire('change', nodes.get('enabled'));
  await settle();
  assert.equal(saves.at(-1).enabled, false);
  assert.deepEqual(packets.at(-1), { type: 'goshen:disable', expectedTabId: 41 });
  assert.equal(nodes.get('page-state').textContent, 'OFF');
  assert.equal(nodes.get('follow-tab').checked, false);
  assert.equal(nodes.get('follow-tab').disabled, true);
});

test('Automatic on ChatGPT OFF does not clear an unrelated universal tab intent', async () => {
  const { nodes, saves, packets } = harness({ automatic: true, enabled: true, persistent: true });
  await settle();
  nodes.get('enabled').checked = false;
  nodes.get('controls').fire('change', nodes.get('enabled'));
  await settle();
  assert.equal(saves.at(-1).enabled, false);
  assert.deepEqual(packets.map(packet => packet.type), ['goshen:status']);
  assert.equal(nodes.get('page-state').textContent, 'ACTIVE');
});

test('Automatic OFF waits for an in-flight status response before clearing its inspected ChatGPT tab', async () => {
  let finishStatus;
  const { nodes, packets } = harness({ automatic: true, handler: message => {
    if (message.type === 'goshen:status') return new Promise(resolve => { finishStatus = resolve; });
    return { ok: true, tabId: 41, host: 'chatgpt.com', mode: 'chatgpt', enabled: false, persistent: false };
  } });
  await settle();
  nodes.get('enabled').checked = false;
  nodes.get('controls').fire('change', nodes.get('enabled'));
  await settle();
  assert.deepEqual(packets.map(packet => packet.type), ['goshen:status']);
  finishStatus({ ok: true, tabId: 41, host: 'chatgpt.com', mode: 'chatgpt', enabled: true, persistent: true });
  await settle();
  assert.deepEqual(packets.at(-1), { type: 'goshen:disable', expectedTabId: 41 });
  assert.equal(nodes.get('page-state').textContent, 'OFF');
});

test('a newer Automatic ON gesture supersedes an OFF preference save still completing', async () => {
  const { nodes, packets } = harness({ mode: 'chatgpt', automatic: true, enabled: true, persistent: true });
  await settle();
  const automatic = nodes.get('enabled');
  automatic.checked = false;
  nodes.get('controls').fire('change', automatic);
  automatic.checked = true;
  nodes.get('controls').fire('change', automatic);
  await settle();
  assert.equal(packets.some(packet => packet.type === 'goshen:disable'), false, 'A superseded OFF must not overwrite the newer ON from the worker');
  assert.equal(automatic.checked, true);
  assert.equal(automatic.disabled, false);
  assert.equal(nodes.get('page-state').textContent, 'ACTIVE');
});
