import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../extension/universal.js', import.meta.url), 'utf8');
const companionSource = await readFile(new URL('../extension/companion.js', import.meta.url), 'utf8');
const gmailSource = await readFile(new URL('../extension/gmail.js', import.meta.url), 'utf8');
const defaults = { universalStyle: 'terminal', enabled: true, theme: 'amber', layout: 'deck', scanlines: 18, glow: 35, motion: true, quips: true, respectReducedMotion: false, fontSize: 15 };

// This narrow, dependency-free fixture checks ownership, asynchronous startup,
// event privacy and teardown. It does not claim CSS or real-site compatibility.
async function environment(initial = {}, prepare = () => {}, workload = {}) {
  const observers = new Set();
  const resizeObservers = new Set();
  const timers = new Map();
  const settingsListeners = new Set();
  const companionEvents = [];
  const companionFrames = [];
  let now = 0;
  let nextTimer = 0;
  let styleReadCount = 0;
  let styleFlushCount = 0;
  let styleDirty = false;
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
      const properties = new Map(); const priorities = new Map();
      this.style = {
        getPropertyValue: name => properties.get(name) || '',
        getPropertyPriority: name => priorities.get(name) || '',
        setProperty: (name, value, priority = '') => {
          priorities.set(name, priority);
          properties.set(name, String(value));
          this.attributes.set('style',[...properties].map(([key,entry]) => `${key}: ${entry}${priorities.get(key) ? ' !important' : ''};`).join(' '));
          mutation({ type: 'attributes', target: this, attributeName: 'style' });
        },
        removeProperty: name => {
          const previous = properties.get(name) || '';
          properties.delete(name); priorities.delete(name);
          this.attributes.set('style',[...properties].map(([key,entry]) => `${key}: ${entry}${priorities.get(key) ? ' !important' : ''};`).join(' '));
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
    get type() { return this.getAttribute('type') || 'text'; }
    get parentNode() { return this.parentElement; }
    setPointerCapture(id) { this.capturedPointer = id; }
    releasePointerCapture(id) { if (this.capturedPointer === id) this.capturedPointer = null; }
    attachShadow() { this.shadowRoot = new Element('shadow-root'); this.shadowRoot.parentElement = this; return this.shadowRoot; }
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
      if (name.startsWith('data-gt-') && !this.closest('#goshen-universal-host')) styleDirty = true;
      mutation({ type: 'attributes', target: this, attributeName: name });
    }
    removeAttribute(name) {
      if (this.attributes.delete(name)) {
        if (name.startsWith('data-gt-') && !this.closest('#goshen-universal-host')) styleDirty = true;
        mutation({ type: 'attributes', target: this, attributeName: name });
      }
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
  document.createTreeWalker = root => { const descendants = root.querySelectorAll('*'); let cursor = 0; return { nextNode: () => descendants[cursor++] || null }; };
  document.getElementById = id => document.querySelector(`#${id}`);

  function makeBody() {
    const body = new Element('body');
    body.innerHTML = '<div id="app"><main><form><div id="prompt-textarea"></div><button data-testid="send-button"></button></form></main></div>';
    return body;
  }
  document.documentElement.append(makeBody());
  prepare(document);

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
  function inheritedColor(element) {
    if (!element) return 'rgb(30, 30, 30)';
    const active = document.documentElement.getAttribute('data-gt-universal') === 'true' && document.documentElement.getAttribute('data-gt-style') === 'terminal';
    if (active && element.getAttribute('data-gt-image-region') === 'true' && element.style.getPropertyValue('--gt-preserved-ink')) return element.style.getPropertyValue('--gt-preserved-ink');
    if (active && (element.getAttribute('data-gt-foreground') === 'text' || element.hasAttribute('data-gt-gmail-region'))) return 'rgb(226, 223, 204)';
    return element.style.getPropertyValue('color') || inheritedColor(element.parentElement);
  }
  const context = vm.createContext({
    window, document, console, MutationObserver, ResizeObserver,
    location: workload.gmail ? { hostname:'mail.google.com',pathname:'/mail/u/0/' } : { pathname: '/c/runtime-fixture' },
    Node: { ELEMENT_NODE: 1 }, NodeFilter: { SHOW_ELEMENT: 1 }, performance: { now: () => now },
    setTimeout: window.setTimeout, setInterval: window.setInterval,
    clearTimeout: window.clearTimeout, clearInterval: window.clearInterval,
    requestAnimationFrame: callback => createTimer(() => callback(now), 16),
    cancelAnimationFrame: id => timers.delete(id),
    getComputedStyle: element => {
      styleReadCount += 1;
      if (styleDirty) { styleFlushCount += 1; styleDirty = false; now += workload.styleFlushCostMs || 0; }
      now += workload.styleCostMs || 0;
      const themedSurface = workload.inheritedColors && document.documentElement.getAttribute('data-gt-universal') === 'true' && document.documentElement.getAttribute('data-gt-style') === 'terminal' && element.hasAttribute('data-gt-surface');
      const result = { display:'block',visibility:'visible',backgroundImage:element.style.getPropertyValue('background-image') || 'none',backgroundColor:themedSurface ? 'rgb(16, 18, 15)' : element.style.getPropertyValue('background-color') || 'rgb(255, 255, 255)',color:workload.inheritedColors ? inheritedColor(element) : 'rgb(30, 30, 30)',fontFamily:element.style.getPropertyValue('font-family') || 'Arial',borderTopStyle:'none',borderRightStyle:'none',borderBottomStyle:'none',borderLeftStyle:'none' };
      return workload.readStyle ? workload.readStyle(element,result) : result;
    },
    CyberdeckSettings: {
      defaults, normalize: value => ({ ...defaults, ...value }),
      load: async () => ({ ...preferences }),
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
  if (workload.gmail) vm.runInContext(gmailSource,context,{ filename:'gmail.js' });
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
  vm.runInContext(source, context, { filename: 'universal.js' });
  await Promise.all([context.GoshenUniversal.enable(), context.GoshenUniversal.enable()]);
  await new Promise(resolve => setImmediate(resolve));
  advance(workload.initialAdvanceMs ?? 500);
  return {
    context, document, timers, observers, resizeObservers, settingsListeners, window, media, companionEvents, companionFrames,
    advance,
    get styleReads() { return styleReadCount; },
    get styleFlushes() { return styleFlushCount; },
    replaceBody() { const body = makeBody(); document.body.replaceWith(body); return body; },
    setSettings(patch) { preferences = { ...preferences, ...patch }; for (const listener of settingsListeners) listener(preferences); advance(); },
  };
}

const dock = document => document.getElementById('goshen-universal-host');

test('concurrent initial enable and repeated injection keep one dock and one pair of loops', async () => {
  const env = await environment({ enabled:false });
  const original = dock(env.document);
  assert.ok(original, 'Universal mode is independent of automatic ChatGPT power');
  assert.equal(env.document.querySelectorAll('#goshen-universal-host').length,1);
  assert.equal(env.timers.size,2, 'One animation loop and one maintenance loop');
  assert.equal(env.settingsListeners.size,1);
  vm.runInContext(source,env.context,{ filename:'universal-reinjected.js' });
  await Promise.all([env.context.GoshenUniversal.enable(),env.context.GoshenUniversal.enable()]);
  env.advance();
  assert.equal(dock(env.document),original);
  assert.equal(env.timers.size,2);
  assert.equal(env.settingsListeners.size,1);
  assert.deepEqual(JSON.parse(JSON.stringify(env.context.GoshenUniversal.status())),{ enabled:true,mode:'universal',style:'terminal' });
  env.context.GoshenUniversal.destroy();
});

test('OFF restores pre-existing attributes and style priority and removes every active listener and loop', async () => {
  const env = await environment({},document => {
    document.documentElement.setAttribute('data-gt-theme','existing-theme');
    document.documentElement.style.setProperty('--gt-font-size','19px','important');
    document.querySelector('main').setAttribute('data-gt-foreground','existing-tone');
  });
  assert.equal(env.document.querySelector('main').getAttribute('data-gt-foreground'),'text');
  const result = env.context.GoshenUniversal.disable();
  assert.equal(result.enabled,false);
  assert.equal(dock(env.document),null);
  assert.equal(env.document.documentElement.getAttribute('data-gt-universal'),null);
  assert.equal(env.document.documentElement.getAttribute('data-gt-theme'),'existing-theme');
  assert.equal(env.document.documentElement.style.getPropertyValue('--gt-font-size'),'19px');
  assert.equal(env.document.documentElement.style.getPropertyPriority('--gt-font-size'),'important');
  assert.equal(env.document.querySelector('main').getAttribute('data-gt-foreground'),'existing-tone');
  assert.equal(env.document.querySelector('form').getAttribute('data-gt-surface'),null);
  assert.equal(env.timers.size,0);
  assert.equal(env.settingsListeners.size,0);
  for (const listeners of env.document.listeners.values()) assert.equal(listeners.size,0);
  for (const medium of env.media) for (const listeners of medium.listeners.values()) assert.equal(listeners.size,0);
  for (const observer of env.observers) assert.equal(observer.targets.size,0);
  await env.context.GoshenUniversal.enable(); env.advance();
  assert.equal(env.settingsListeners.size,1);
  assert.equal(env.timers.size,2);
  env.context.GoshenUniversal.destroy();
  assert.equal(env.context.GoshenUniversal,undefined);
});

test('frame mode leaves native nodes unmarked and appearance settings can switch modes live', async () => {
  const env = await environment({ universalStyle:'frame' });
  const main = env.document.querySelector('main');
  const form = env.document.querySelector('form');
  assert.ok(dock(env.document));
  assert.equal(env.document.documentElement.getAttribute('data-gt-style'),'frame');
  assert.equal(main.getAttribute('data-gt-surface'),null);
  assert.equal(form.getAttribute('data-gt-surface'),null);
  env.setSettings({ universalStyle:'terminal',theme:'green' });
  assert.equal(main.getAttribute('data-gt-surface'),'base');
  assert.equal(env.document.documentElement.getAttribute('data-gt-theme'),'green');
  env.setSettings({ universalStyle:'frame' });
  assert.equal(main.getAttribute('data-gt-surface'),null);
  assert.equal(form.getAttribute('data-gt-surface'),null);
  env.context.GoshenUniversal.destroy();
});

test('body replacement reattaches the same companion and keeps controls working without duplicate timers', async () => {
  const env = await environment();
  const original = dock(env.document);
  const shadow = original.shadowRoot;
  const body = env.replaceBody();
  env.document.documentElement.removeAttribute('data-gt-universal');
  env.advance();
  assert.equal(dock(env.document),original);
  assert.equal(original.parentElement,body);
  assert.equal(env.document.documentElement.getAttribute('data-gt-universal'),'true');
  assert.equal(body.querySelector('main').getAttribute('data-gt-surface'),'base');
  assert.equal(env.timers.size,2);
  shadow.querySelector('.pet').dispatchEvent({ type:'click' });
  assert.equal(env.companionEvents.at(-1).event,'pet');
  shadow.querySelector('.collapse').dispatchEvent({ type:'click' });
  assert.equal(shadow.querySelector('.collapse').getAttribute('aria-expanded'),'false');
  assert.equal(env.timers.size,1, 'Collapsed rabbit animation must stop');
  env.context.GoshenUniversal.disable();
  await env.context.GoshenUniversal.enable(); env.advance();
  assert.equal(dock(env.document).shadowRoot.querySelector('.collapse').getAttribute('aria-expanded'),'false');
  env.context.GoshenUniversal.destroy();
});

test('typing reacts only to eligible edit events and never reads native values or text', async () => {
  const env = await environment();
  for (const type of ['password','checkbox','file','email','tel','number','text','search','url']) {
    const input = env.document.createElement('input');
    input.setAttribute('type',type);
    Object.defineProperty(input,'value',{ get() { throw new Error('Native field value was read'); } });
    Object.defineProperty(input,'textContent',{ get() { throw new Error('Native field text was read'); } });
    env.document.body.append(input);
    env.document.dispatchEvent({ type:'input',target:input });
    const expected = ['text','search','url'].includes(type) ? 'typing' : 'ready';
    assert.equal(env.companionFrames.at(-1).activity,expected,`Input type ${type}`);
    env.advance(3000);
  }
  assert.ok(env.companionFrames.every(frame => !Object.hasOwn(frame,'topic')),'No page-derived category is sent to HOPPER');
  assert.ok(env.companionEvents.every(event => event.topic === undefined));
  env.context.GoshenUniversal.destroy();
});

test('media, image backgrounds, icon fonts and semantic colored regions are preserved', async () => {
  const env = await environment({},document => {
    const main = document.querySelector('main');
    const imageRegion = document.createElement('section');
    imageRegion.id = 'photo-region';
    imageRegion.style.setProperty('background-image','url(example.png)');
    const caption = document.createElement('p'); caption.style.setProperty('background-color','transparent'); imageRegion.append(caption);
    const error = document.createElement('section'); error.id = 'error-region';
    error.style.setProperty('background-color','rgb(180, 20, 20)'); error.append(document.createElement('p'));
    const glyph = document.createElement('span'); glyph.id = 'glyph'; glyph.style.setProperty('font-family','Material Icons');
    main.append(imageRegion,error,glyph,document.createElement('svg'),document.createElement('canvas'),document.createElement('video'));
  });
  for (const selector of ['#photo-region p','#error-region p']) {
    const region = env.document.getElementById(selector.split(' ')[0].slice(1));
    assert.equal(region.getAttribute('data-gt-surface'),null);
    assert.equal(region.querySelector('p').getAttribute('data-gt-foreground'),null);
  }
  for (const selector of ['#glyph','svg','canvas','video']) {
    const element = env.document.querySelector(selector);
    assert.equal(element.getAttribute('data-gt-surface'),null);
    assert.equal(element.getAttribute('data-gt-font'),null);
  }
  env.context.GoshenUniversal.disable();
  assert.equal(env.document.getElementById('photo-region').getAttribute('data-gt-image-region'),null);
  env.context.GoshenUniversal.destroy();
});

function whiteCard(document, id = 'native-poster') {
  const poster = document.createElement('section'); poster.id = id;
  poster.style.setProperty('background-image','linear-gradient(white, white)');
  const card = document.createElement('div'); card.style.setProperty('background-color','rgb(255, 255, 255)');
  const text = document.createElement('p'); text.style.setProperty('background-color','transparent'); card.append(text);
  const caption = document.createElement('p'); caption.style.setProperty('background-color','transparent'); poster.append(caption,card);
  return { poster,card,text,caption };
}

test('an opaque neutral card themes inside artwork while text directly over the image keeps native ink', async () => {
  let content;
  const env = await environment({},document => {
    const main = document.querySelector('main'); main.style.setProperty('color','rgb(34, 34, 34)');
    content = whiteCard(document); main.append(content.poster);
  },{ inheritedColors:true });
  const { poster,card,text,caption } = content;
  assert.equal(env.context.getComputedStyle(env.document.querySelector('main')).color,'rgb(226, 223, 204)','Ordinary surrounding content is themed');
  assert.equal(env.context.getComputedStyle(card).backgroundColor,'rgb(16, 18, 15)');
  assert.equal(env.context.getComputedStyle(text).color,'rgb(226, 223, 204)','The newly themed card has light text on its dark surface');
  assert.equal(env.context.getComputedStyle(caption).color,'rgb(34, 34, 34)','Text over the actual image retains native contrast');
  assert.equal(card.getAttribute('data-gt-surface'),'base');
  assert.equal(text.getAttribute('data-gt-foreground'),'text');
  assert.equal(caption.getAttribute('data-gt-foreground'),null);
  assert.equal(poster.style.getPropertyValue('--gt-preserved-ink'),'rgb(34, 34, 34)');
  assert.equal(env.context.GoshenUniversal.diagnostics().preservedInkReads,0,'The first batch reuses its already-native color snapshot');
  env.context.GoshenUniversal.disable();
  assert.equal(env.context.getComputedStyle(card).backgroundColor,'rgb(255, 255, 255)');
  assert.equal(env.context.getComputedStyle(text).color,'rgb(34, 34, 34)');
  env.context.GoshenUniversal.destroy();
});

test('late image regions recover native colors through already-themed ancestors and restore those markers', async () => {
  const measurements = [];
  const env = await environment({},document => { document.querySelector('main').style.setProperty('color','rgb(34, 34, 34)'); },{
    inheritedColors:true,
    readStyle(element,result) { if (element.id === 'late-poster') measurements.push({ ink:result.color,parentInk:element.parentElement.getAttribute('data-gt-foreground') }); return result; },
  });
  const main = env.document.querySelector('main');
  const { poster,card,text,caption } = whiteCard(env.document,'late-poster'); main.append(poster);
  env.advance();
  assert.deepEqual(measurements,[
    { ink:'rgb(226, 223, 204)',parentInk:'text' },
    { ink:'rgb(34, 34, 34)',parentInk:null },
  ]);
  assert.equal(env.context.getComputedStyle(text).color,'rgb(226, 223, 204)');
  assert.equal(env.context.getComputedStyle(card).backgroundColor,'rgb(16, 18, 15)');
  assert.equal(env.context.getComputedStyle(caption).color,'rgb(34, 34, 34)');
  assert.equal(main.getAttribute('data-gt-foreground'),'text','The ancestor returns to its themed appearance within the same task');
  assert.equal(env.context.GoshenUniversal.diagnostics().preservedInkReads,1);
  env.context.GoshenUniversal.destroy();
});

test('only opaque neutral panels resume theming under images; explicit, semantic, Gmail and media boundaries stay native', async () => {
  const env = await environment({},document => {
    const poster = document.createElement('section'); poster.id = 'backdrop'; poster.style.setProperty('background-image','url(fictional-art.svg)');
    const cases = [
      ['opaque',{}],
      ['translucent',{ background:'rgb(255 255 255 / 90%)' }],
      ['semantic',{ background:'rgb(100% 0% 0%)' }],
      ['explicit',{ preserve:true }],
      ['message',{ className:'a3s' }],
      ['media',{ tag:'iframe' }],
    ];
    for (const [id,options] of cases) {
      const panel = document.createElement(options.tag || 'section'); panel.id = id;
      panel.style.setProperty('background-color',options.background || 'rgb(255, 255, 255)');
      if (options.preserve) panel.setAttribute('data-gt-preserve','');
      if (options.className) panel.className = options.className;
      const child = document.createElement('p'); child.style.setProperty('background-color','rgb(255, 255, 255)'); panel.append(child);
      poster.append(panel);
    }
    document.querySelector('main').append(poster);
    const alert = document.createElement('section'); alert.id = 'hard-alert'; alert.style.setProperty('background-color','rgb(200, 0, 0)');
    alert.append(whiteCard(document,'alert-card').card); document.querySelector('main').append(alert);
  },{ gmail:true,inheritedColors:true });
  assert.equal(env.document.getElementById('opaque').getAttribute('data-gt-surface'),'base');
  for (const id of ['translucent','semantic','explicit','message','media']) {
    const panel = env.document.getElementById(id);
    assert.equal(panel.getAttribute('data-gt-surface'),null,id);
    // A translucent wrapper is still over artwork; its opaque neutral child may
    // resume independently. Semantic/explicit preservation never permits this.
    if (['semantic','explicit','message','media'].includes(id)) assert.equal(panel.querySelector('p').getAttribute('data-gt-foreground'),null,id);
  }
  assert.equal(env.document.getElementById('hard-alert').querySelector('div').getAttribute('data-gt-surface'),null);
  const added = env.document.createElement('p'); added.style.setProperty('background-color','transparent');
  env.document.getElementById('opaque').append(added); env.advance();
  assert.equal(added.getAttribute('data-gt-foreground'),'text','A later descendant of the resumed panel follows its terminal surface');
  env.context.GoshenUniversal.destroy();
});

test('modern neutral RGB colors and percentage alpha classify without leaving light unthemed panels', async () => {
  const neutral = [
    'rgb(100% 100% 100%)','rgb(255 255 255 / 100%)','rgba(100%, 100%, 100%, 1)',
    'color(srgb 1 1 1)','color(srgb 100% 100% 100% / 100%)','color(srgb .94 .95 .96)',
    'color(srgb-linear .8 .8 .8)','color(display-p3 1 1 1)','color(display-p3-linear .75 .75 .75)',
  ];
  const env = await environment({},document => {
    for (const [index,value] of neutral.entries()) {
      const panel = document.createElement('section'); panel.id = `neutral-${index}`; panel.style.setProperty('background-color',value); document.body.append(panel);
    }
    const transparent = document.createElement('section'); transparent.id = 'almost-clear'; transparent.style.setProperty('background-color','rgb(100% 100% 100% / 5%)'); document.body.append(transparent);
  });
  for (const [index,value] of neutral.entries()) {
    const panel = env.document.getElementById(`neutral-${index}`);
    assert.equal(panel.getAttribute('data-gt-surface'),'base',value);
    assert.equal(panel.getAttribute('data-gt-foreground'),'text',value);
    assert.equal(panel.getAttribute('data-gt-image-region'),null,value);
  }
  assert.equal(env.document.getElementById('almost-clear').getAttribute('data-gt-surface'),null,'Percentage alpha must not be mistaken for an opaque panel');
  env.context.GoshenUniversal.destroy();
});

test('saturated modern RGB and unsupported color spaces keep native contrast instead of receiving light foregrounds', async () => {
  const values = ['rgb(100% 0% 0%)','color(srgb 1 0 0)','color(display-p3 1 .2 .1)','oklch(97% .02 90)','color(xyz-d50 .95 1 1.09)'];
  const env = await environment({},document => {
    document.querySelector('main').style.setProperty('color','rgb(34, 34, 34)');
    for (const [index,value] of values.entries()) {
      const panel = document.createElement('section'); panel.id = `native-${index}`; panel.style.setProperty('background-color',value);
      panel.append(document.createElement('p')); document.querySelector('main').append(panel);
    }
  },{ inheritedColors:true });
  for (const [index,value] of values.entries()) {
    const panel = env.document.getElementById(`native-${index}`);
    assert.equal(panel.getAttribute('data-gt-surface'),null,value);
    assert.equal(panel.getAttribute('data-gt-foreground'),null,value);
    assert.equal(panel.getAttribute('data-gt-image-region'),'true',value);
    assert.equal(panel.querySelector('p').getAttribute('data-gt-foreground'),null,value);
    assert.equal(env.context.getComputedStyle(panel).color,'rgb(34, 34, 34)',value);
  }
  env.context.GoshenUniversal.destroy();
});

test('exactly neutral Lab and OKLab panels theme without converting colored perceptual values', async () => {
  const neutral = [
    'oklch(100% 0 0)','oklch(.5 0 none)','oklch(0 0 2turn / 100%)',
    'oklab(1 0 0)','oklab(50% 0% -0 / 75%)','oklab(0 0e2 0)',
    'lch(100 0 270deg)','lch(50% 0 1.5rad / 100%)','lab(0 0 0)','lab(100% 0% 0%)',
  ];
  const colored = ['oklch(100% .01 90)','oklab(1 0 .000001)','lch(100 1 0)','lab(100 -1 0)'];
  const env = await environment({},document => {
    for (const [index,value] of [...neutral,...colored,'oklch(100% 0 none / 5%)'].entries()) {
      const panel = document.createElement('section'); panel.id = `perceptual-${index}`;
      panel.style.setProperty('background-color',value); document.body.append(panel);
    }
  });
  for (const [index,value] of neutral.entries()) {
    const panel = env.document.getElementById(`perceptual-${index}`);
    assert.equal(panel.getAttribute('data-gt-surface'),'base',value);
    assert.equal(panel.getAttribute('data-gt-foreground'),'text',value);
    assert.equal(panel.getAttribute('data-gt-image-region'),null,value);
  }
  for (const [index,value] of colored.entries()) {
    const panel = env.document.getElementById(`perceptual-${neutral.length + index}`);
    assert.equal(panel.getAttribute('data-gt-surface'),null,value);
    assert.equal(panel.getAttribute('data-gt-image-region'),'true',value);
  }
  assert.equal(env.document.getElementById(`perceptual-${neutral.length + colored.length}`).getAttribute('data-gt-surface'),null,'A five-percent-alpha neutral must remain transparent');
  env.context.GoshenUniversal.destroy();
});

test('many late preservation boundaries group native reads and yield after a bounded batch', async () => {
  const env = await environment({},document => { document.querySelector('main').style.setProperty('color','rgb(34, 34, 34)'); },{ inheritedColors:true });
  const main = env.document.querySelector('main');
  const flushesBefore = env.styleFlushes;
  for (let index = 0; index < 24; index += 1) main.append(whiteCard(env.document,`poster-${index}`).poster);
  env.advance(1);
  let metrics = env.context.GoshenUniversal.diagnostics();
  assert.equal(metrics.preservedInkReads,8,'Only eight new preservation boundaries may be measured in a single slice');
  assert.ok(metrics.queuedRoots || metrics.activeWalkers,'Native-color snapshots still yield during a large insertion');
  env.advance(100);
  metrics = env.context.GoshenUniversal.diagnostics();
  assert.equal(metrics.preservedInkReads,24);
  assert.equal(metrics.queuedRoots,0); assert.equal(metrics.activeWalkers,0);
  assert.ok(env.styleFlushes - flushesBefore <= 7,'Native reads share one suspension phase per batch, without per-boundary read/write alternation');
  assert.equal(main.getAttribute('data-gt-foreground'),'text');
  env.context.GoshenUniversal.destroy();
});

test('preserved ink cleanup restores only its property and keeps page styles added while active', async () => {
  let original,empty,added;
  const env = await environment({},document => {
    original = whiteCard(document).poster;
    original.style.setProperty('--gt-preserved-ink','rgb(1, 2, 3)','important');
    empty = document.createElement('section'); empty.setAttribute('data-gt-preserve',''); empty.setAttribute('style','');
    added = document.createElement('section'); added.setAttribute('data-gt-preserve','');
    document.querySelector('main').append(original,empty,added);
  },{ inheritedColors:true });
  assert.ok(added.hasAttribute('style'),'The owned custom property needs an inline declaration while enabled');
  original.style.setProperty('padding','17px','important');
  env.context.GoshenUniversal.disable();
  assert.equal(original.style.getPropertyValue('--gt-preserved-ink'),'rgb(1, 2, 3)');
  assert.equal(original.style.getPropertyPriority('--gt-preserved-ink'),'important');
  assert.equal(original.style.getPropertyValue('padding'),'17px');
  assert.equal(original.style.getPropertyPriority('padding'),'important');
  assert.equal(original.style.getPropertyValue('background-image'),'linear-gradient(white, white)');
  assert.equal(empty.hasAttribute('style'),true,'An originally empty style attribute remains present');
  assert.equal(added.hasAttribute('style'),false,'An otherwise-empty style attribute introduced by Goshen is removed');
  await env.context.GoshenUniversal.enable(); env.advance();
  added.style.setProperty('margin','9px');
  env.setSettings({ universalStyle:'frame' });
  assert.equal(added.style.getPropertyValue('--gt-preserved-ink'),'');
  assert.equal(added.style.getPropertyValue('margin'),'9px','A later page style survives switching to frame mode');
  env.context.GoshenUniversal.destroy();
});

test('Gmail message preservation retains inherited ink without inspecting message text', async () => {
  const env = await environment({},document => { document.querySelector('main').style.setProperty('color','rgb(34, 34, 34)'); },{ gmail:true,inheritedColors:true });
  const outer = env.document.createElement('div'); outer.className = 'ii';
  const message = env.document.createElement('div'); message.className = 'a3s';
  const paragraph = env.document.createElement('p');
  Object.defineProperty(paragraph,'textContent',{ get() { throw new Error('Message text was inspected'); } });
  outer.append(message); message.append(paragraph); env.document.querySelector('main').append(outer);
  env.advance();
  assert.equal(env.context.getComputedStyle(paragraph).color,'rgb(34, 34, 34)');
  assert.equal(paragraph.getAttribute('data-gt-foreground'),null);
  assert.equal(message.getAttribute('data-gt-surface'),null);
  assert.equal(env.document.querySelector('main').getAttribute('data-gt-foreground'),'text');
  env.context.GoshenUniversal.disable();
  assert.equal(outer.hasAttribute('style'),false);
  assert.equal(message.hasAttribute('style'),false);
  env.context.GoshenUniversal.destroy();
});

test('failed native-color reads restore suspended ancestors and keep the rest of the batch usable', async () => {
  const env = await environment({},() => {},{ inheritedColors:true,readStyle(element,result) {
    if (element.id === 'unreadable-poster' && element.parentElement.getAttribute('data-gt-foreground') === null) throw new Error('Synthetic style read failure');
    return result;
  } });
  const main = env.document.querySelector('main');
  const bad = whiteCard(env.document,'unreadable-poster');
  const good = whiteCard(env.document,'readable-poster');
  main.append(bad.poster,good.poster); env.advance();
  assert.equal(main.getAttribute('data-gt-foreground'),'text');
  assert.equal(env.document.body.getAttribute('data-gt-foreground'),'text');
  assert.equal(good.poster.style.getPropertyValue('--gt-preserved-ink'),'rgb(30, 30, 30)');
  assert.equal(env.context.GoshenUniversal.diagnostics().errors,1);
  env.context.GoshenUniversal.disable();
  assert.equal(main.getAttribute('data-gt-foreground'),null);
  assert.equal(bad.poster.style.getPropertyValue('--gt-preserved-ink'),'');
  env.context.GoshenUniversal.destroy();
});

test('motion preferences stop the animation loop while maintenance and manual reactions stay available', async () => {
  const env = await environment();
  assert.equal(env.timers.size,2);
  env.setSettings({ respectReducedMotion:true });
  assert.equal(env.document.documentElement.getAttribute('data-gt-motion'),'false');
  assert.equal(env.timers.size,1);
  dock(env.document).shadowRoot.querySelector('.pet').dispatchEvent({ type:'click' });
  assert.equal(env.companionEvents.at(-1).event,'pet');
  env.setSettings({ respectReducedMotion:false,motion:false });
  assert.equal(env.timers.size,1);
  env.setSettings({ motion:true });
  assert.equal(env.timers.size,2);
  env.context.GoshenUniversal.destroy();
});

test('OFF during an in-flight preference load prevents a late dock from appearing', async () => {
  const env = await environment();
  const runtime = env.context.GoshenUniversal;
  runtime.disable();
  let finishLoad;
  env.context.CyberdeckSettings.load = () => new Promise(resolve => { finishLoad = resolve; });
  const pending = runtime.enable();
  runtime.disable();
  finishLoad({ ...defaults });
  await pending;
  env.advance();
  assert.equal(runtime.status().enabled,false);
  assert.equal(dock(env.document),null);
  assert.equal(env.timers.size,0);
  assert.equal(env.settingsListeners.size,0);
  runtime.destroy();
});

function pointer(control,type,x,y,extra = {}) {
  const event = { type,target:control,button:0,isPrimary:true,pointerId:7,clientX:x,clientY:y,preventDefault() { this.prevented = true; },stopPropagation() {},...extra };
  control.dispatchEvent(event);
  return event;
}
function key(control,keyValue,extra = {}) {
  const event = { type:'keydown',key:keyValue,target:control,preventDefault() { this.prevented = true; },stopPropagation() {},...extra };
  control.dispatchEvent(event);
  return event;
}
function geometry(element) {
  return Object.fromEntries(['left','top','width','height'].map(name => [name,parseFloat(element.style.getPropertyValue(name))]));
}

test('title-bar dragging uses pointer capture, clamps to viewport, and ignores its action buttons', async () => {
  const env = await environment();
  const shadow = dock(env.document).shadowRoot;
  const handle = shadow.querySelector('.handle');
  const panel = shadow.querySelector('.dock');
  const before = geometry(panel);
  pointer(handle,'pointerdown',100,100,{ target:shadow.querySelector('.collapse') });
  pointer(handle,'pointermove',0,0);
  assert.deepEqual(geometry(panel),before,'Window buttons must not start a drag');
  assert.equal(handle.capturedPointer,undefined);
  pointer(handle,'pointerdown',100,100);
  assert.equal(handle.capturedPointer,7);
  pointer(handle,'pointermove',-5000,-5000);
  assert.equal(geometry(panel).left,12);
  assert.equal(geometry(panel).top,12);
  pointer(handle,'pointermove',5000,5000);
  assert.equal(geometry(panel).left,env.window.innerWidth - before.width - 12);
  assert.equal(geometry(panel).top,env.window.innerHeight - before.height - 12);
  pointer(handle,'pointerup',5000,5000);
  assert.equal(handle.capturedPointer,null);
  env.context.GoshenUniversal.destroy();
});

test('resize grip enforces usable minima, scales the rabbit, and preserves dimensions across OFF/on', async () => {
  const env = await environment();
  let shadow = dock(env.document).shadowRoot;
  const handle = shadow.querySelector('.handle');
  const grip = shadow.querySelector('.resize');
  pointer(handle,'pointerdown',100,100); pointer(handle,'pointermove',-5000,-5000); pointer(handle,'pointerup',-5000,-5000);
  pointer(grip,'pointerdown',100,100); pointer(grip,'pointermove',200,180); pointer(grip,'pointerup',200,180);
  assert.equal(geometry(shadow.querySelector('.dock')).width,360);
  assert.equal(geometry(shadow.querySelector('.dock')).height,420);
  assert.ok(parseFloat(shadow.querySelector('.deck').style.getPropertyValue('--rabbit-size')) > 9);
  const resized = geometry(shadow.querySelector('.dock'));
  env.context.GoshenUniversal.disable(); await env.context.GoshenUniversal.enable(); env.advance();
  shadow = dock(env.document).shadowRoot;
  assert.deepEqual(geometry(shadow.querySelector('.dock')),resized);
  const newGrip = shadow.querySelector('.resize');
  pointer(newGrip,'pointerdown',100,100); pointer(newGrip,'pointermove',-5000,-5000); pointer(newGrip,'pointerup',-5000,-5000);
  assert.equal(geometry(shadow.querySelector('.dock')).width,220);
  assert.equal(geometry(shadow.querySelector('.dock')).height,280);
  env.context.GoshenUniversal.destroy();
});

test('keyboard movement/resizing and viewport changes keep a collapsed or expanded window reachable', async () => {
  const env = await environment();
  const shadow = dock(env.document).shadowRoot;
  const handle = shadow.querySelector('.handle');
  const grip = shadow.querySelector('.resize');
  const panel = shadow.querySelector('.dock');
  const before = geometry(panel);
  assert.equal(key(handle,'ArrowLeft',{ shiftKey:true }).prevented,true);
  assert.equal(geometry(panel).left,before.left - 40);
  pointer(handle,'pointerdown',100,100); pointer(handle,'pointermove',-5000,-5000); pointer(handle,'pointerup',-5000,-5000);
  key(grip,'ArrowRight',{ shiftKey:true }); key(grip,'ArrowDown');
  assert.equal(geometry(panel).width,300); assert.equal(geometry(panel).height,350);
  env.window.innerWidth = 280; env.window.innerHeight = 310;
  env.window.dispatchEvent({ type:'resize' });
  let current = geometry(panel);
  assert.ok(current.left >= 12 && current.top >= 12);
  assert.ok(current.left + current.width <= 268 && current.top + current.height <= 298);
  shadow.querySelector('.collapse').dispatchEvent({ type:'click' });
  assert.equal(geometry(panel).height,44);
  key(handle,'ArrowDown',{ shiftKey:true });
  shadow.querySelector('.collapse').dispatchEvent({ type:'click' });
  current = geometry(panel);
  assert.ok(current.top + current.height <= 298);
  env.context.GoshenUniversal.destroy();
});

test('short viewports fit all sprite rows while reserving reachable window controls', async () => {
  const env = await environment();
  const shadow = dock(env.document).shadowRoot;
  const panel = shadow.querySelector('.dock');
  const deck = shadow.querySelector('.deck');
  const spriteRows = shadow.querySelector('.rabbit').textContent.split('\n').length;
  const frameHeight = () => spriteRows * parseFloat(deck.style.getPropertyValue('--rabbit-size')) * 1.08;

  // A short browser window may have less room than the normal 280 px minimum.
  env.window.innerWidth = 210; env.window.innerHeight = 250;
  env.window.dispatchEvent({ type:'resize' });
  let current = geometry(panel);
  assert.equal(deck.getAttribute('data-compact'),'true');
  assert.equal(deck.getAttribute('data-tight'),'false');
  assert.ok(frameHeight() <= current.height - 131 + .1,'All 14 sprite rows must fit beside the compact labels and fixed controls');
  assert.ok(current.left >= 0 && current.left + current.width <= 210);
  assert.ok(current.top >= 0 && current.top + current.height <= 250);

  env.window.innerHeight = 180;
  env.window.dispatchEvent({ type:'resize' });
  current = geometry(panel);
  assert.equal(deck.getAttribute('data-tight'),'true');
  assert.ok(frameHeight() <= current.height - 82 + .1,'Optional labels must yield room before the sprite or controls overflow');
  assert.ok(current.top + current.height <= 180);
  key(shadow.querySelector('.resize'),'ArrowUp');
  assert.ok(Number.isFinite(parseFloat(deck.style.getPropertyValue('--rabbit-size'))));

  env.window.innerWidth = 1024; env.window.innerHeight = 768;
  env.window.dispatchEvent({ type:'resize' });
  key(shadow.querySelector('.resize'),'Home');
  assert.equal(deck.getAttribute('data-compact'),'false');
  assert.equal(deck.getAttribute('data-tight'),'false');
  assert.equal(geometry(panel).height,340,'Returning to a larger viewport restores the normal expanded layout');
  env.context.GoshenUniversal.destroy();
});

test('cancel restores the prior position and OFF releases an active drag and all window listeners', async () => {
  const env = await environment();
  const shadow = dock(env.document).shadowRoot;
  const handle = shadow.querySelector('.handle');
  const panel = shadow.querySelector('.dock');
  const before = geometry(panel);
  pointer(handle,'pointerdown',100,100); pointer(handle,'pointermove',50,50); pointer(handle,'pointercancel',50,50);
  assert.deepEqual(geometry(panel),before);
  pointer(handle,'pointerdown',100,100);
  env.context.GoshenUniversal.disable();
  assert.equal(handle.capturedPointer,null);
  for (const control of shadow.querySelectorAll('button,header')) for (const listeners of control.listeners.values()) assert.equal(listeners.size,0);
  for (const [type,listeners] of env.window.listeners) assert.equal(listeners.size,type === 'pageshow' ? 1 : 0);
  assert.equal(env.timers.size,0);
  env.context.GoshenUniversal.destroy();
});

test('a large overlapping mutation storm stays bounded and drains without repeated style reads', async () => {
  const env = await environment();
  const root = env.document.createElement('div');
  env.document.body.append(root);
  const readsBefore = env.styleReads;
  for (let index = 0; index < 600; index += 1) {
    const row = env.document.createElement('section');
    const content = env.document.createElement('span');
    row.append(content);
    root.append(row);
  }
  const slicesBefore = env.context.GoshenUniversal.diagnostics().slices;
  env.advance(2);
  let metrics = env.context.GoshenUniversal.diagnostics();
  assert.ok(metrics.activeWalkers <= 1);
  assert.ok(metrics.queuedRoots <= 24);
  assert.ok(metrics.maxQueuedRoots <= 24);
  assert.ok(metrics.activeWalkers || metrics.queuedRoots,'Large renders must yield instead of finishing in one long callback');
  assert.ok(metrics.maxSliceNodes <= 256,'A fast clock still has a hard per-slice traversal bound');
  env.advance(80);
  metrics = env.context.GoshenUniversal.diagnostics();
  assert.equal(metrics.activeWalkers,0);
  assert.equal(metrics.queuedRoots,0);
  assert.equal(metrics.errors,0);
  assert.ok(metrics.slices - slicesBefore >= 5,'The fast pass still cooperates with the event loop');
  assert.ok(env.styleReads - readsBefore <= 1201,'Each new ordinary element gets at most one style classification');
  const readsAfter = env.styleReads;
  root.remove(); env.document.body.append(root); env.advance(3000);
  assert.equal(env.styleReads,readsAfter,'Rewalking moved, already classified content must not repeat style reads');
  env.context.GoshenUniversal.destroy();
});

test('expensive style reads hit the elapsed-time budget and preserve time for input and animation', async () => {
  const env = await environment({},() => {},{ styleCostMs:1 });
  const root = env.document.createElement('section');
  for (let index = 0; index < 200; index += 1) root.append(env.document.createElement('p'));
  env.document.body.append(root);
  env.advance(100);
  let metrics = env.context.GoshenUniversal.diagnostics();
  assert.ok(metrics.maxSliceMs <= 6,`Simulated classification cost exceeded the six millisecond budget: ${metrics.maxSliceMs}`);
  assert.ok(metrics.activeWalkers > 0,'Heavy classification must continue incrementally');
  const input = env.document.createElement('input'); input.setAttribute('type','text');
  env.document.body.append(input);
  env.document.dispatchEvent({ type:'input',target:input });
  assert.equal(env.companionFrames.at(-1).activity,'typing','Input reactions stay usable while scanning is pending');
  const busyReads = env.styleReads;
  env.advance(75);
  assert.ok(env.styleReads - busyReads <= 8,'Recent input restricts scan work to short slices with longer yields');
  env.advance(500);
  metrics = env.context.GoshenUniversal.diagnostics();
  assert.equal(metrics.activeWalkers,0); assert.equal(metrics.queuedRoots,0);
  assert.equal(metrics.errors,0);
  env.context.GoshenUniversal.destroy();
});

test('startup paints its first slice immediately and batches style reads before theme writes', async () => {
  const env = await environment({},document => {
    const main = document.querySelector('main');
    for (let index = 0; index < 600; index += 1) {
      const card = document.createElement('section');
      card.append(document.createElement('p'));
      main.append(card);
    }
  },{ initialAdvanceMs:0,styleCostMs:.02,styleFlushCostMs:2 });
  assert.equal(env.document.body.getAttribute('data-gt-surface'),null);
  env.advance(1);
  assert.equal(env.document.body.getAttribute('data-gt-surface'),'base','No 90ms startup wait before the first paint');
  assert.ok(env.context.GoshenUniversal.diagnostics().activeWalkers > 0);
  env.advance(150);
  const metrics = env.context.GoshenUniversal.diagnostics();
  assert.equal(metrics.activeWalkers,0); assert.equal(metrics.queuedRoots,0);
  assert.equal(metrics.errors,0);
  assert.ok(env.styleReads >= 1200);
  assert.ok(env.styleFlushes <= metrics.slices + 1,`Theme writes caused ${env.styleFlushes} simulated style flushes across ${metrics.slices} slices`);
  assert.ok(env.styleFlushes < env.styleReads / 100,'Classification must not alternate native reads/writes per element');
  env.context.GoshenUniversal.destroy();
});

test('hidden tabs suspend scanning and animation timers and resume one bounded pass when visible', async () => {
  const env = await environment({},document => { document.hidden = true; });
  assert.equal(env.styleReads,0);
  assert.equal(env.timers.size,0,'Hidden startup should not start periodic work');
  const card = env.document.createElement('section');
  card.append(env.document.createElement('p')); env.document.body.append(card);
  env.advance(10000);
  assert.equal(env.styleReads,0);
  assert.equal(env.timers.size,0);
  env.document.hidden = false;
  env.document.dispatchEvent({ type:'visibilitychange' }); env.advance();
  assert.equal(card.getAttribute('data-gt-surface'),'base');
  assert.equal(env.timers.size,2,'Visible idle mode has one animation loop and one maintenance loop');
  const readsBefore = env.styleReads;
  env.document.hidden = true; env.document.dispatchEvent({ type:'visibilitychange' });
  assert.equal(env.timers.size,0);
  env.advance(10000);
  assert.equal(env.styleReads,readsBefore);
  env.context.GoshenUniversal.disable();
  env.document.hidden = false; env.document.dispatchEvent({ type:'visibilitychange' }); env.advance();
  assert.equal(env.timers.size,0,'Visibility cannot resurrect a disabled runtime');
  env.context.GoshenUniversal.destroy();
});

test('many independent small additions fold a full pending queue into one pass', async () => {
  const env = await environment();
  for (let index = 0; index < 40; index += 1) env.document.body.append(env.document.createElement('section'));
  env.advance(0);
  const queued = env.context.GoshenUniversal.diagnostics();
  assert.equal(queued.maxQueuedRoots,24);
  assert.equal(queued.queuedRoots,1,'Backpressure replaces a full queue with one containing subtree');
  assert.equal(queued.activeWalkers,0);
  env.advance(1000);
  assert.equal(env.context.GoshenUniversal.diagnostics().queuedRoots,0);
  env.context.GoshenUniversal.destroy();
});

test('only explicit dock OFF and close clear tab navigation intent', async () => {
  const env = await environment();
  const messages = [];
  env.context.chrome = { runtime:{ id:'fixture-extension',sendMessage(message) { messages.push(JSON.parse(JSON.stringify(message))); return Promise.resolve(); } } };
  dock(env.document).shadowRoot.querySelector('.exit').dispatchEvent({ type:'click' });
  assert.deepEqual(messages,[{ type:'goshen:page-off' }]);
  await env.context.GoshenUniversal.enable(); env.advance();
  env.context.GoshenUniversal.disable();
  assert.equal(messages.length,1,'Controller cleanup must preserve tab intent');
  await env.context.GoshenUniversal.enable(); env.advance();
  dock(env.document).shadowRoot.querySelector('.close').dispatchEvent({ type:'click' });
  assert.equal(messages.length,2);
  await env.context.GoshenUniversal.enable(); env.advance();
  env.context.chrome.runtime.sendMessage = () => { throw new Error('Extension context invalidated'); };
  assert.doesNotThrow(() => dock(env.document).shadowRoot.querySelector('.exit').dispatchEvent({ type:'click' }));
  assert.equal(env.context.GoshenUniversal.status().enabled,false);
  assert.equal(env.timers.size,0);
  env.context.GoshenUniversal.destroy();
});

test('detached nodes released by pruning can be themed again when a virtual list reuses them', async () => {
  const env = await environment();
  const item = env.document.createElement('p'); env.document.body.append(item); env.advance();
  assert.equal(item.getAttribute('data-gt-foreground'),'text');
  item.remove(); env.advance(2000);
  assert.equal(item.getAttribute('data-gt-foreground'),null);
  env.document.body.append(item); env.advance();
  assert.equal(item.getAttribute('data-gt-foreground'),'text');
  env.context.GoshenUniversal.destroy();
});

test('dock bounds exclude native scrollbar space from the usable viewport', async () => {
  const env = await environment();
  env.document.documentElement.clientWidth = env.window.innerWidth - 15;
  env.document.documentElement.clientHeight = env.window.innerHeight - 15;
  env.window.dispatchEvent({ type:'resize' });
  const bounds = geometry(dock(env.document).shadowRoot.querySelector('.dock'));
  assert.ok(bounds.left + bounds.width <= env.document.documentElement.clientWidth - 12);
  assert.ok(bounds.top + bounds.height <= env.document.documentElement.clientHeight - 12);
  env.context.GoshenUniversal.destroy();
});

test('BFCache restore disables a stale active dock after tab intent was switched off elsewhere', async () => {
  const env = await environment();
  const messages = [];
  env.context.chrome = { runtime:{ id:'fixture-extension',async sendMessage(message) { messages.push(message.type); return { ok:true,enabled:false }; } } };
  env.window.dispatchEvent({ type:'pageshow',persisted:true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.context.GoshenUniversal.status().enabled,false);
  assert.deepEqual(messages,['goshen:restore-intent']);
  assert.equal(dock(env.document),null);
  env.context.GoshenUniversal.destroy();
  assert.equal(env.window.listeners.get('pageshow').size,0);
});

test('BFCache restore can re-enable a previously disabled page for its current eligible tab intent', async () => {
  const env = await environment();
  env.context.GoshenUniversal.disable();
  env.context.chrome = { runtime:{ id:'fixture-extension',async sendMessage() { return { ok:true,enabled:true }; } } };
  env.window.dispatchEvent({ type:'pageshow',persisted:true });
  await new Promise(resolve => setImmediate(resolve)); env.advance();
  assert.equal(env.context.GoshenUniversal.status().enabled,true);
  assert.equal(env.document.querySelectorAll('#goshen-universal-host').length,1);
  env.context.GoshenUniversal.destroy();
});

test('a delayed BFCache eligibility reply cannot undo a newer local OFF action', async () => {
  const env = await environment();
  let answer;
  env.context.chrome = { runtime:{ id:'fixture-extension',sendMessage() { return new Promise(resolve => { answer = resolve; }); } } };
  env.window.dispatchEvent({ type:'pageshow',persisted:true });
  env.context.GoshenUniversal.disable();
  answer({ ok:true,enabled:true });
  await new Promise(resolve => setImmediate(resolve)); env.advance();
  assert.equal(env.context.GoshenUniversal.status().enabled,false);
  env.context.GoshenUniversal.destroy();
});


