import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8');
const companionSource = await readFile(new URL('../extension/companion.js', import.meta.url), 'utf8');
const defaults = { enabled: true, theme: 'amber', layout: 'deck', scanlines: 18, glow: 35, motion: true, quips: true, respectReducedMotion: false, fontSize: 15 };

// A narrow DOM fixture keeps these lifecycle regressions runnable with Node
// alone. It models tree ownership, filtered MutationObserver delivery, and
// timers; it does not establish layout compatibility with the live website.
async function environment(initial = {}, { messageHandler, preview = false, loadHandler, nativeSetup } = {}) {
  const observers = new Set();
  const resizeObservers = new Set();
  const timers = new Map();
  const settingsListeners = new Set();
  const companionEvents = [];
  const companionFrames = [];
  const messages = [];
  let now = 0;
  let nextTimer = 0;
  let preferences = { ...defaults, ...initial };

  class Events {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(listener);
    }
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
    dispatchEvent(event) { for (const listener of this.listeners.get(event.type) || []) listener(event); }
  }

  function mutation(record) {
    for (const observer of observers) {
      for (const [target, options] of observer.targets) {
        if (record.target !== target && !(options.subtree && target.contains(record.target))) continue;
        if (!options[record.type]) continue;
        if (record.type === 'attributes' && options.attributeFilter && !options.attributeFilter.includes(record.attributeName)) continue;
        observer.records.push(record);
        break;
      }
    }
  }

  class Element extends Events {
    constructor(tagName) {
      super();
      this.tagName = tagName.toUpperCase();
      this.nodeType = 1;
      this.parentElement = null;
      this.children = [];
      this.attributes = new Map();
      this._text = '';
      this.open = false;
      const properties = new Map();
      this.style = {
        getPropertyValue: name => properties.get(name) || '',
        setProperty: (name, value) => {
          properties.set(name, String(value));
          mutation({ type: 'attributes', target: this, attributeName: 'style' });
        },
        removeProperty: name => {
          const previous = properties.get(name) || '';
          properties.delete(name);
          mutation({ type: 'attributes', target: this, attributeName: 'style' });
          return previous;
        },
      };
      const dataName = key => `data-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`;
      this.dataset = new Proxy({}, {
        get: (_, key) => this.getAttribute(dataName(key)),
        set: (_, key, value) => { this.setAttribute(dataName(key), value); return true; },
      });
      this.classList = {
        toggle: (name, enabled) => {
          const values = new Set(this.className.split(/\s+/).filter(Boolean));
          if (enabled ?? !values.has(name)) values.add(name);
          else values.delete(name);
          this.className = [...values].join(' ');
        },
        contains: name => this.className.split(/\s+/).includes(name),
      };
    }
    get id() { return this.getAttribute('id') || ''; }
    set id(value) { this.setAttribute('id', value); }
    get className() { return this.getAttribute('class') || ''; }
    set className(value) { this.setAttribute('class', value); }
    get type() { return this.getAttribute('type') || ''; }
    get parentNode() { return this.parentElement; }
    get isConnected() { return this === document || Boolean(this.parentElement?.isConnected); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) {
      for (const child of [...this.children]) child.remove();
      this._text = String(value);
      mutation({ type: 'childList', target: this, addedNodes: [], removedNodes: [] });
    }
    set innerHTML(markup) {
      for (const child of [...this.children]) child.remove();
      const stack = [this];
      for (const token of markup.match(/<[^>]+>|[^<]+/g) || []) {
        if (token.startsWith('</')) { stack.pop(); continue; }
        if (!token.startsWith('<')) { stack.at(-1)._text += token; continue; }
        const tag = token.match(/^<([\w-]+)/)?.[1];
        if (!tag) continue;
        const child = new Element(tag);
        for (const attribute of token.matchAll(/([\w-]+)="([^"]*)"/g)) child.setAttribute(attribute[1], attribute[2]);
        stack.at(-1).append(child);
        if (!['input', 'br', 'hr', 'img', 'meta', 'link'].includes(tag)) stack.push(child);
      }
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      mutation({ type: 'attributes', target: this, attributeName: name });
    }
    removeAttribute(name) {
      if (this.attributes.delete(name)) mutation({ type: 'attributes', target: this, attributeName: name });
    }
    append(...nodes) {
      for (const node of nodes) {
        node.remove();
        node.parentElement = this;
        this.children.push(node);
        mutation({ type: 'childList', target: this, addedNodes: [node], removedNodes: [] });
      }
    }
    appendChild(node) { this.append(node); return node; }
    insertBefore(node, reference) {
      if (reference === null) return this.appendChild(node);
      if (!this.children.includes(reference)) throw new Error('Reference node is not a child');
      if (node === reference) return node;
      node.remove();
      node.parentElement = this;
      this.children.splice(this.children.indexOf(reference), 0, node);
      mutation({ type: 'childList', target: this, addedNodes: [node], removedNodes: [] });
      return node;
    }
    remove() {
      if (!this.parentElement) return;
      const parent = this.parentElement;
      parent.children.splice(parent.children.indexOf(this), 1);
      this.parentElement = null;
      mutation({ type: 'childList', target: parent, addedNodes: [], removedNodes: [this] });
    }
    replaceWith(node) { const parent = this.parentElement; this.remove(); parent.append(node); }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    matches(query) {
      return query.split(',').some(part => {
        const selector = part.trim();
        const tag = selector.match(/^[\w-]+/)?.[0];
        if (tag && this.tagName !== tag.toUpperCase()) return false;
        const id = selector.match(/#([\w-]+)/)?.[1];
        if (id && this.id !== id) return false;
        for (const cls of selector.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(cls[1])) return false;
        for (const attribute of selector.matchAll(/\[([\w-]+)(?:(\^?=)"([^"]*)")?\]/g)) {
          const value = this.getAttribute(attribute[1]);
          if (value === null || (attribute[2] === '=' && value !== attribute[3]) || (attribute[2] === '^=' && !value.startsWith(attribute[3]))) return false;
        }
        return true;
      });
    }
    closest(query) { for (let node = this; node; node = node.parentElement) if (node.matches(query)) return node; return null; }
    querySelectorAll(query) { return this.children.flatMap(child => [...(child.matches(query) ? [child] : []), ...child.querySelectorAll(query)]); }
    querySelector(query) { return this.querySelectorAll(query)[0] || null; }
    getBoundingClientRect() {
      const width = this.tagName === 'SVG' ? 24 : 900;
      const height = this.tagName === 'SVG' ? 24 : 600;
      return { x: 20, y: 80, left: 20, top: 80, right: 20 + width, bottom: 80 + height, width, height };
    }
    getClientRects() { return this.isConnected ? [this.getBoundingClientRect()] : []; }
    showModal() { this.open = true; }
    close() { this.open = false; this.dispatchEvent({ type: 'close' }); }
    focus() { document.activeElement = this; }
  }

  const document = new Element('document');
  document.nodeType = 9;
  document.hidden = false;
  document.readyState = 'complete';
  document.documentElement = new Element('html');
  document.append(document.documentElement);
  Object.defineProperty(document, 'body', { get: () => document.documentElement.querySelector('body') });
  document.createElement = tag => new Element(tag);
  document.getElementById = id => document.querySelector(`#${id}`);

  function makeBody() {
    const body = new Element('body');
    body.innerHTML = '<div id="app"><main><form><div id="prompt-textarea"></div><button data-testid="send-button"></button></form></main></div>';
    return body;
  }
  document.documentElement.append(makeBody());
  nativeSetup?.(document);

  class MutationObserver {
    constructor(callback) { this.callback = callback; this.targets = new Map(); this.records = []; observers.add(this); }
    observe(target, options) { this.targets.set(target, options); }
    disconnect() { this.targets.clear(); this.records = []; }
    takeRecords() { const records = this.records; this.records = []; return records; }
  }
  class ResizeObserver {
    constructor(callback) { this.callback = callback; this.targets = new Set(); resizeObservers.add(this); }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
  }
  const window = new Events();
  const media = [];
  const createTimer = (callback, delay = 0, interval = false) => {
    const id = ++nextTimer;
    timers.set(id, { callback, due: now + delay, delay, interval });
    return id;
  };
  Object.assign(window, {
    innerWidth: 1440, innerHeight: 900, ResizeObserver,
    setTimeout: (callback, delay) => createTimer(callback, delay),
    setInterval: (callback, delay) => createTimer(callback, delay, true),
    clearTimeout: id => timers.delete(id), clearInterval: id => timers.delete(id),
    matchMedia: query => {
      const match = new Events();
      // This desktop fixture requests reduced motion, while the extension's
      // explicit motion override defaults to on. Tests exercise both policies.
      match.matches = true;
      match.media = query;
      media.push(match);
      return match;
    },
  });
  const context = vm.createContext({
    window, document, console, MutationObserver, ResizeObserver,
    location: { pathname: '/c/runtime-fixture' },
    Node: { ELEMENT_NODE: 1 }, performance: { now: () => now },
    setTimeout: window.setTimeout, setInterval: window.setInterval,
    clearTimeout: window.clearTimeout, clearInterval: window.clearInterval,
    requestAnimationFrame: callback => createTimer(() => callback(now), 16),
    cancelAnimationFrame: id => timers.delete(id),
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    ...(preview ? {} : { chrome: { runtime: { id: 'runtime-test', async sendMessage(message) {
      messages.push(JSON.parse(JSON.stringify(message)));
      return messageHandler ? messageHandler(message) : { ok: true, enabled: false };
    } } } }),
    CyberdeckSettings: {
      defaults, normalize: value => ({ ...defaults, ...value }),
      load: async () => loadHandler ? loadHandler({ ...preferences }) : ({ ...preferences }),
      save: async patch => { preferences = { ...preferences, ...patch }; return preferences; },
      subscribe: listener => { settingsListeners.add(listener); return () => settingsListeners.delete(listener); },
    },
  });

  function advance(milliseconds = 500) {
    const end = now + milliseconds;
    for (let rounds = 0; rounds < 2000; rounds++) {
      let delivered = false;
      for (const observer of observers) {
        if (!observer.records.length) continue;
        const records = observer.takeRecords();
        observer.callback(records, observer);
        delivered = true;
      }
      if (delivered) continue;
      const next = [...timers].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) { now = end; return; }
      const [id, timer] = next;
      now = timer.due;
      if (timer.interval) timer.due += timer.delay;
      else timers.delete(id);
      timer.callback();
    }
    assert.fail('Runtime caused an unbounded mutation or timer feedback loop');
  }

  vm.runInContext(companionSource, context, { filename: 'companion.js' });
  const originalCompanion = context.GoshenCompanion;
  context.GoshenCompanion = {
    create() {
      const engine = originalCompanion.create();
      return {
        frame(input) { companionFrames.push({ ...input }); return engine.frame(input); },
        react(event, at, topic) { companionEvents.push({ event, at, topic }); return engine.react(event, at, topic); },
        reset(at) { return engine.reset(at); },
      };
    },
  };
  vm.runInContext(source, context, { filename: 'content.js' });
  await new Promise(resolve => setImmediate(resolve));
  advance();
  return {
    context, document, timers, observers, resizeObservers, settingsListeners, window, media, companionEvents, companionFrames, messages,
    savedSettings: () => ({ ...preferences }),
    storeWhileCached(patch) { preferences = { ...preferences, ...patch }; },
    advance,
    replaceBody() { const body = makeBody(); document.body.replaceWith(body); return body; },
    setSettings(patch) { preferences = { ...preferences, ...patch }; for (const listener of settingsListeners) listener(preferences); advance(); },
  };
}

function assertEnabled(document, theme = 'amber') {
  assert.equal(document.documentElement.getAttribute('data-cd-enabled'), 'true');
  assert.equal(document.documentElement.getAttribute('data-cd-theme'), theme);
  assert.equal(document.documentElement.getAttribute('data-cd-layout'), 'deck');
  assert.equal(document.documentElement.getAttribute('data-cd-motion'), 'true');
  assert.equal(document.querySelectorAll('#cd-shell').length, 1);
}

test('early explicit activation and OFF survive a late initial preference snapshot', async () => {
  for (const enabled of [true, false]) {
    let finishLoad;
    const env = await environment({ enabled: !enabled }, {
      loadHandler: snapshot => new Promise(resolve => { finishLoad = () => resolve(snapshot); }),
    });
    env.context.CyberdeckRuntime.applyPreferences({ ...defaults, enabled, theme: 'green' });
    finishLoad();
    await new Promise(resolve => setImmediate(resolve));
    env.advance();
    if (enabled) assertEnabled(env.document, 'green');
    else assert.equal(env.document.querySelector('#cd-shell'), null);
    assert.equal(env.settingsListeners.size, 1);
    assert.equal(env.savedSettings().enabled, !enabled, 'A tab choice must not rewrite automatic startup preferences');
    env.context.CyberdeckRuntime.destroy();
  }
});

test('a late initial load cannot invalidate a newer cached-page reconciliation', async () => {
  for (const enabled of [false, true]) for (const initialFinishesFirst of [false, true]) {
    const loads = [];
    const env = await environment({ enabled: !enabled }, {
      loadHandler: snapshot => new Promise(resolve => loads.push(() => resolve(snapshot))),
    });
    env.storeWhileCached({ enabled, theme: 'ice' });
    env.window.dispatchEvent({ type: 'pageshow', persisted: true });
    loads[initialFinishesFirst ? 0 : 1]();
    await new Promise(resolve => setImmediate(resolve));
    if (initialFinishesFirst) assert.equal(env.document.querySelector('#cd-shell'), null, 'The old initialization must leave the pending restoration in control');
    loads[initialFinishesFirst ? 1 : 0]();
    await new Promise(resolve => setImmediate(resolve));
    env.advance();
    if (enabled) assertEnabled(env.document, 'ice');
    else assert.equal(env.document.querySelector('#cd-shell'), null);
    assert.equal(env.settingsListeners.size, 1);
    env.context.CyberdeckRuntime.destroy();
  }
});

test('page hydration removal restores the same deck, root flags, and selected appearance', async () => {
  const env = await environment({ theme: 'green', fontSize: 18 });
  const { document } = env;
  const shell = document.querySelector('#cd-shell');
  const originalTimerCount = env.timers.size;
  assert.ok(shell);
  shell.remove();
  for (const name of ['data-cd-enabled', 'data-cd-theme', 'data-cd-layout', 'data-cd-motion']) document.documentElement.removeAttribute(name);
  document.documentElement.style.removeProperty('--cd-font-size');
  env.advance();
  assert.equal(document.querySelector('#cd-shell'), shell, 'Recovery must reattach the existing controls, preserving listeners and state');
  assertEnabled(document, 'green');
  assert.equal(document.documentElement.style.getPropertyValue('--cd-font-size'), '18px');
  shell.querySelector('.cd-settings-button').dispatchEvent({ type: 'click' });
  assert.equal(shell.querySelector('.cd-settings').open, true, 'Reattached deck controls must retain their event handlers');
  assert.equal(env.timers.size, originalTimerCount, 'Recovery must not duplicate the clock or animation loop');
  env.context.CyberdeckRuntime.destroy();
});

test('page root attribute reconciliation restores the theme even while the shell stays attached', async () => {
  const env = await environment();
  const root = env.document.documentElement;
  root.removeAttribute('data-cd-enabled');
  root.setAttribute('data-cd-theme', 'other-page-value');
  root.removeAttribute('data-cd-layout');
  env.document.querySelector('main').removeAttribute('data-cd-main');
  env.document.querySelector('form').removeAttribute('data-cd-composer');
  env.advance();
  assertEnabled(env.document);
  assert.ok(env.document.querySelector('main').hasAttribute('data-cd-main'));
  assert.ok(env.document.querySelector('form').hasAttribute('data-cd-composer'));
  env.context.CyberdeckRuntime.destroy();
});

test('body replacement restores the existing shell and observes later native messages', async () => {
  const env = await environment();
  const shell = env.document.querySelector('#cd-shell');
  const originalMain = env.document.querySelector('main');
  const newBody = env.replaceBody();
  env.advance();
  assert.equal(newBody.querySelector('#cd-shell'), shell);
  const newMain = newBody.querySelector('main');
  assert.ok(newMain.hasAttribute('data-cd-main'));
  assert.ok(!originalMain.hasAttribute('data-cd-main'));
  assert.ok(newBody.querySelector('form').hasAttribute('data-cd-composer'));
  const message = env.document.createElement('div');
  message.setAttribute('data-message-author-role', 'assistant');
  message.textContent = 'Native page update after replacing the body';
  newMain.append(message);
  env.advance();
  assert.equal(shell.querySelector('.cd-message-count').textContent, '01', 'Observation must continue in the replacement body');
  assertEnabled(env.document);
  env.context.CyberdeckRuntime.destroy();
});

test('turning deck power off prevents hydration recovery until it is enabled again', async () => {
  const env = await environment();
  env.setSettings({ enabled: false });
  env.replaceBody();
  env.advance(2000);
  assert.equal(env.document.querySelector('#cd-shell'), null);
  assert.equal(env.document.documentElement.getAttribute('data-cd-enabled'), null);
  assert.equal(env.document.querySelector('[data-cd-main]'), null);
  env.setSettings({ enabled: true, theme: 'ice' });
  assertEnabled(env.document, 'ice');
  assert.equal(env.settingsListeners.size, 1);
  env.context.CyberdeckRuntime.destroy();
});

test('explicit ChatGPT power OFF clears only its own tab intent after saving', async () => {
  const env = await environment();
  const power = env.document.querySelector('#cd-setting-enabled');
  power.checked = false;
  power.dispatchEvent({ type: 'change' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.savedSettings().enabled, false);
  assert.equal(env.document.querySelector('#cd-shell'), null);
  assert.deepEqual(env.messages, [{ type: 'goshen:page-off' }], 'No tab ID or URL can be supplied by the page');
  env.context.CyberdeckRuntime.destroy();
});

test('controller and storage OFF do not report a new user gesture, and preview power still works', async () => {
  const env = await environment();
  env.context.CyberdeckRuntime.applyPreferences({ ...defaults, enabled: false });
  env.setSettings({ enabled: false });
  assert.deepEqual(env.messages, []);
  env.context.CyberdeckRuntime.destroy();
  const preview = await environment({}, { preview: true });
  const power = preview.document.querySelector('#cd-setting-enabled');
  power.checked = false;
  power.dispatchEvent({ type: 'change' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(preview.savedSettings().enabled, false);
  assert.equal(preview.document.querySelector('#cd-shell'), null);
  preview.context.CyberdeckRuntime.destroy();
});

test('Back/Forward restoration removes a cached active ChatGPT deck after later OFF', async () => {
  const env = await environment();
  env.storeWhileCached({ enabled: false });
  env.window.dispatchEvent({ type: 'pageshow', persisted: false });
  assert.deepEqual(env.messages, [], 'Ordinary page show does not start a reconciliation request');
  env.window.dispatchEvent({ type: 'pageshow', persisted: true });
  assert.equal(env.document.querySelector('#cd-shell'), null, 'Cached active presentation is removed before the eligibility reply');
  await new Promise(resolve => setImmediate(resolve));
  env.advance();
  assert.equal(env.document.querySelector('#cd-shell'), null);
  assert.deepEqual(env.messages, [{ type: 'goshen:restore-intent' }]);
  env.context.CyberdeckRuntime.destroy();
});

test('Back/Forward restoration honors fresh automatic settings or an eligible tab without saving preferences', async () => {
  for (const automatic of [false, true]) {
    const env = await environment({ enabled: false }, { messageHandler: () => ({ ok: true, enabled: !automatic }) });
    env.storeWhileCached({ enabled: automatic, theme: 'ice' });
    env.window.dispatchEvent({ type: 'pageshow', persisted: true });
    await new Promise(resolve => setImmediate(resolve));
    env.advance();
    assertEnabled(env.document, 'ice');
    assert.equal(env.savedSettings().enabled, automatic, 'A temporary tab intent never turns automatic startup on');
    env.context.CyberdeckRuntime.destroy();
  }
});

test('a late cached-page eligibility reply cannot override a newer controller OFF or destruction', async () => {
  for (const destroy of [false, true]) {
    let resolveIntent;
    const env = await environment({}, { messageHandler: () => new Promise(resolve => { resolveIntent = resolve; }) });
    env.window.dispatchEvent({ type: 'pageshow', persisted: true });
    if (destroy) env.context.CyberdeckRuntime.destroy();
    else env.context.CyberdeckRuntime.applyPreferences({ ...defaults, enabled: false });
    resolveIntent({ ok: true, enabled: true });
    await new Promise(resolve => setImmediate(resolve));
    env.advance();
    assert.equal(env.document.querySelector('#cd-shell'), null);
    if (!destroy) env.context.CyberdeckRuntime.destroy();
  }
});

test('destroy after hydration recovery removes marks and cancels every lifecycle subscription', async () => {
  const env = await environment();
  env.document.querySelector('#cd-shell').remove();
  env.advance();
  env.context.CyberdeckRuntime.destroy();
  assert.equal(env.document.querySelector('[data-cd-main], [data-cd-app], [data-cd-composer], [data-cd-workspace]'), null);
  env.replaceBody();
  env.advance(2000);
  assert.equal(env.context.CyberdeckRuntime, undefined);
  assert.equal(env.document.querySelector('#cd-shell'), null);
  assert.equal(env.document.querySelector('[data-cd-main], [data-cd-app], [data-cd-composer], [data-cd-workspace]'), null);
  assert.equal(env.document.documentElement.getAttribute('data-cd-enabled'), null);
  assert.equal(env.document.documentElement.style.getPropertyValue('--cd-font-size'), '');
  assert.equal(env.timers.size, 0);
  assert.equal(env.settingsListeners.size, 0);
  for (const observer of [...env.observers, ...env.resizeObservers]) assert.equal(observer.targets.size, 0);
  for (const target of [env.document, env.window, ...env.media]) {
    for (const listeners of target.listeners.values()) assert.equal(listeners.size, 0);
  }
});

test('motion controls honor the explicit override, system-follow choice, and master off setting', async () => {
  const env = await environment();
  const root = env.document.documentElement;
  const system = env.media.find(match => match.media.includes('prefers-reduced-motion'));
  assert.equal(system.matches, true);
  assert.equal(root.getAttribute('data-cd-motion'), 'true', 'The explicit animation setting enables motion by default');
  assert.equal(env.companionFrames.at(-1).motion, true);

  env.setSettings({ respectReducedMotion: true });
  assert.equal(root.getAttribute('data-cd-motion'), 'false');
  assert.equal(env.companionFrames.at(-1).motion, false);
  const still = env.document.querySelector('.cd-ascii').textContent;
  env.advance(6000);
  assert.equal(env.document.querySelector('.cd-ascii').textContent, still);

  system.matches = false;
  system.dispatchEvent({ type: 'change' });
  env.advance();
  assert.equal(root.getAttribute('data-cd-motion'), 'true', 'System-follow resumes animation when reduced motion is cleared');
  env.setSettings({ motion: false, respectReducedMotion: false });
  assert.equal(root.getAttribute('data-cd-motion'), 'false', 'Master off wins over the explicit system override');
  assert.equal(env.companionFrames.at(-1).motion, false);
  const offArt = env.document.querySelector('.cd-ascii').textContent;
  env.advance(6000);
  assert.equal(env.document.querySelector('.cd-ascii').textContent, offArt);
  env.context.CyberdeckRuntime.destroy();
});

test('native loading text and decorative circles receive reversible light panels without altering button icons', async () => {
  const env = await environment();
  const { document } = env;
  const main = document.querySelector('main');
  const loadingText = document.createElement('span');
  loadingText.className = 'loading-shimmer-tertiary';
  loadingText.textContent = 'Thinking';
  const circle = document.createElement('svg');
  circle.className = 'animate-spin';
  circle.setAttribute('aria-hidden', 'true');
  const button = document.createElement('button');
  const buttonCircle = document.createElement('svg');
  buttonCircle.className = 'animate-spin';
  button.append(buttonCircle);
  main.append(loadingText, circle, button);
  env.advance();

  assert.equal(loadingText.getAttribute('data-cd-native-loader'), 'text');
  assert.equal(loadingText.textContent, 'Thinking', 'The native loading label must remain accessible and untouched');
  assert.equal(circle.getAttribute('data-cd-native-loader'), 'circle');
  assert.equal(circle.parentElement, main, 'ChatGPT keeps ownership of its spinner node');
  const panel = document.querySelector('.cd-native-light-panel');
  assert.ok(panel);
  assert.equal(panel.getAttribute('aria-hidden'), 'true');
  assert.equal(panel.querySelectorAll('i').length, 6);
  assert.equal(main.children[main.children.indexOf(circle) - 1], panel, 'The panel is inserted beside its native spinner');
  assert.equal(buttonCircle.getAttribute('data-cd-native-loader'), null, 'Interactive controls retain their native icons');
  env.context.CyberdeckRuntime.refresh();
  env.advance();
  assert.equal(document.querySelectorAll('.cd-native-light-panel').length, 1, 'Repeated scans must not duplicate panels');

  loadingText.className = 'loaded';
  circle.className = 'loaded';
  env.advance();
  assert.equal(loadingText.getAttribute('data-cd-native-loader'), null);
  assert.equal(circle.getAttribute('data-cd-native-loader'), null);
  assert.equal(document.querySelector('.cd-native-light-panel'), null, 'Completed native indicators must release their decoration');

  loadingText.className = 'loading-shimmer-tertiary';
  circle.className = 'animate-spin';
  env.advance();
  assert.ok(document.querySelector('.cd-native-light-panel'));
  env.setSettings({ enabled: false });
  assert.equal(document.querySelector('[data-cd-native-loader]'), null);
  assert.equal(document.querySelector('.cd-native-light-panel'), null);
  assert.equal(circle.parentElement, main);
  assert.equal(circle.className, 'animate-spin');
  assert.equal(circle.getAttribute('aria-hidden'), 'true');
  assert.equal(loadingText.textContent, 'Thinking');
  env.context.CyberdeckRuntime.destroy();
});

test('startup does not read pre-existing drafts or conversations with quips enabled or disabled', async () => {
  for (const quips of [true, false]) {
    const env = await environment({ quips }, { nativeSetup(document) {
      const message = document.createElement('div');
      message.setAttribute('data-message-author-role', 'assistant');
      message.textContent = 'Private conversation fixture';
      document.querySelector('main').append(message);
      const draft = document.querySelector('#prompt-textarea');
      draft.textContent = 'Private draft fixture';
      for (const native of [draft, message]) {
        for (const property of ['value', 'textContent', 'innerText']) Object.defineProperty(native, property, {
          get() { assert.fail(`Startup must not read native ${property}`); },
        });
      }
    } });
    assert.equal(env.document.documentElement.getAttribute('data-cd-enabled'), 'true');
    assert.ok(env.document.querySelector('#cd-shell'));
    env.context.CyberdeckRuntime.destroy();
  }
});

test('typing and native submission drive HOPPER without reading the prompt or duplicating send reactions', async () => {
  const env = await environment();
  const { document } = env;
  const root = document.documentElement;
  const prompt = document.querySelector('#prompt-textarea');
  const form = document.querySelector('form');
  const outside = document.createElement('textarea');
  document.querySelector('main').append(outside);
  document.dispatchEvent({ type: 'input', target: outside });
  assert.equal(root.getAttribute('data-cd-activity'), 'ready');

  const privatePrompt = 'Please debug my code with private customer value secret-7942.';
  prompt.textContent = privatePrompt;
  for (const property of ['value', 'textContent', 'innerText']) Object.defineProperty(prompt, property, {
    get() { assert.fail(`The extension must not read the draft's ${property}`); },
  });
  document.dispatchEvent({ type: 'input', target: prompt });
  assert.equal(root.getAttribute('data-cd-activity'), 'typing');
  assert.equal(document.querySelector('.cd-pet-button').getAttribute('data-mood'), 'listening');
  assert.equal(env.companionFrames.at(-1).activity, 'typing');
  assert.equal(env.companionFrames.at(-1).topic, undefined);
  assert.ok(!document.querySelector('#cd-shell').textContent.includes('secret-7942'));

  document.dispatchEvent({ type: 'submit', target: form });
  document.dispatchEvent({ type: 'click', target: document.querySelector('[data-testid="send-button"]') });
  const sends = env.companionEvents.filter(event => event.event === 'sent');
  assert.equal(sends.length, 1, 'Click plus submit for the same action should produce one companion reaction');
  assert.equal(sends[0].topic, undefined);
  assert.equal(root.getAttribute('data-cd-activity'), 'ready');
  assert.equal(document.querySelector('.cd-pet-button').getAttribute('data-mood'), 'alert');
  assert.ok(!JSON.stringify(env.companionEvents).includes(privatePrompt));
  assert.ok(!JSON.stringify(env.companionFrames).includes('secret-7942'));

  env.advance(500);
  env.setSettings({ quips: false });
  document.dispatchEvent({ type: 'input', target: prompt });
  env.advance(3100);
  assert.equal(root.getAttribute('data-cd-activity'), 'ready', 'Typing activity settles after the user pauses');
  env.context.CyberdeckRuntime.destroy();
});

test('visible generation controls drive working, completion and pet reactions without reading responses', async () => {
  const env = await environment();
  const { document } = env;
  const main = document.querySelector('main');
  const stop = document.createElement('button');
  stop.setAttribute('aria-label', 'Stop answering');
  main.append(stop);
  env.advance();
  assert.equal(document.documentElement.getAttribute('data-cd-activity'), 'working');
  assert.equal(document.querySelector('.cd-pet-button').getAttribute('data-mood'), 'working');
  assert.match(document.querySelector('.cd-ascii').textContent, /┌─────────┐/);

  const assistant = document.createElement('div');
  assistant.setAttribute('data-message-author-role', 'assistant');
  assistant.textContent = 'The first words of a native streaming response.';
  for (const property of ['value', 'textContent', 'innerText']) Object.defineProperty(assistant, property, {
    get() { assert.fail(`The extension must not read the response's ${property}`); },
  });
  main.append(assistant);
  env.advance();
  assert.equal(document.documentElement.getAttribute('data-cd-activity'), 'working');
  assert.equal(document.querySelector('.cd-pet-button').getAttribute('data-mood'), 'working');
  stop.remove();
  env.advance();
  assert.equal(document.documentElement.getAttribute('data-cd-activity'), 'ready');
  assert.equal(env.companionEvents.at(-1).event, 'complete');
  assert.equal(document.querySelector('.cd-pet-button').getAttribute('data-mood'), 'celebrating');

  document.querySelector('.cd-pet-button').dispatchEvent({ type: 'click' });
  assert.equal(document.querySelector('.cd-pet-button').getAttribute('data-mood'), 'happy');
  assert.match(document.querySelector('.cd-ascii').textContent, /♥/);
  env.setSettings({ quips: false });
  assert.equal(document.querySelector('.cd-quip').textContent, '');
  env.context.CyberdeckRuntime.destroy();
});

test('changing status and answer content never changes the control-based generation signal', async () => {
  const env = await environment();
  const { document } = env;
  const main = document.querySelector('main');
  const stop = document.createElement('button');
  stop.setAttribute('aria-label', 'Stop answering');
  const assistant = document.createElement('div');
  assistant.setAttribute('data-message-author-role', 'assistant');
  assistant.setAttribute('data-message-id', 'pending-answer');
  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  const label = document.createElement('span');
  label.className = 'loading-shimmer-tertiary';
  label.textContent = 'Pro thinking';
  status.append(label);
  assistant.append(status);
  main.append(stop, assistant);
  env.advance();
  assert.equal(document.documentElement.getAttribute('data-cd-activity'), 'working', 'A thinking label is not streamed answer content');
  assert.equal(document.querySelector('.cd-pet-button').getAttribute('data-mood'), 'working');

  const answer = document.createElement('div');
  answer.className = 'markdown prose';
  assistant.append(answer);
  label.textContent = 'Thinking longer for a better answer';
  env.advance();
  assert.equal(document.documentElement.getAttribute('data-cd-activity'), 'working', 'An empty answer container plus changing status should keep the thinking animation');
  assert.match(document.querySelector('.cd-ascii').textContent, /┌─────────┐/);

  answer.textContent = 'Here is the actual answer, now streaming.';
  for (const native of [label, answer, assistant]) {
    for (const property of ['value', 'textContent', 'innerText']) Object.defineProperty(native, property, {
      get() { assert.fail(`The extension must not inspect native ${property}`); },
    });
  }
  env.advance();
  assert.equal(document.documentElement.getAttribute('data-cd-activity'), 'working');
  assert.equal(document.querySelector('.cd-pet-button').getAttribute('data-mood'), 'working');
  stop.remove();
  env.advance();
  assert.equal(env.companionEvents.at(-1).event, 'complete');
  env.context.CyberdeckRuntime.destroy();
});

test('response identities and remounts do not infer receiving activity', async () => {
  const env = await environment();
  const { document } = env;
  const main = document.querySelector('main');
  const makePreviousAnswer = () => {
    const assistant = document.createElement('div');
    assistant.setAttribute('data-message-author-role', 'assistant');
    assistant.setAttribute('data-message-id', 'previous-answer');
    const answer = document.createElement('div');
    answer.className = 'markdown';
    answer.textContent = 'This answer belongs to the previous completed turn.';
    assistant.append(answer);
    return assistant;
  };
  const original = makePreviousAnswer();
  main.append(original);
  env.advance();
  const stop = document.createElement('button');
  stop.setAttribute('data-testid', 'stop-button');
  main.append(stop);
  env.advance();
  assert.equal(document.documentElement.getAttribute('data-cd-activity'), 'working');
  original.replaceWith(makePreviousAnswer());
  env.advance();
  assert.equal(document.documentElement.getAttribute('data-cd-activity'), 'working', 'React remounting the same prior answer must not signal incoming text');

  const fresh = document.createElement('div');
  fresh.setAttribute('data-message-author-role', 'assistant');
  fresh.setAttribute('data-message-id', 'fresh-answer');
  const freshText = document.createElement('div');
  freshText.className = 'markdown';
  // Equal length deliberately: a truly new answer still counts as incoming.
  freshText.textContent = 'This answer belongs to the previous completed turn.';
  fresh.append(freshText);
  main.append(fresh);
  env.advance();
  assert.equal(document.documentElement.getAttribute('data-cd-activity'), 'working', 'Answer identity or text does not distinguish hidden processing from receiving');
  env.context.CyberdeckRuntime.destroy();
});
