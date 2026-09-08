import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../extension/gmail.js', import.meta.url), 'utf8');

// Small element classifier harness. Live Gmail and visual layout are verified
// separately; these tests cover the adapter's exact scope and paint exclusions.
class Element {
  constructor(tag, { classes = '', attributes = {}, fill = 'rgb(68, 71, 70)', stroke = 'none', width = 24, height = 24 } = {}) {
    this.tagName = tag.toUpperCase();
    this.attributes = new Map(Object.entries({ ...attributes, class: classes }));
    this.children = [];
    this.parentElement = null;
    this.isConnected = true;
    this.computed = { fill, stroke };
    this.bounds = { width, height };
    this.boundsReads = 0;
  }
  append(child) { child.parentElement = this; this.children.push(child); return child; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  matches(selectors) {
    return selectors.split(',').some(selector => {
      const tag = selector.match(/^[\w-]+/);
      if (tag && tag[0].toUpperCase() !== this.tagName) return false;
      for (const [, name, value] of selector.matchAll(/\[([^=\]]+)(?:="([^"]+)")?\]/g)) {
        if (!this.attributes.has(name) || value !== undefined && this.getAttribute(name) !== value) return false;
      }
      const classes = (this.getAttribute('class') || '').split(/\s+/);
      for (const [, name] of selector.matchAll(/\.([\w-]+)/g)) if (!classes.includes(name)) return false;
      for (const [, id] of selector.matchAll(/#([\w-]+)/g)) if (this.getAttribute('id') !== id) return false;
      return true;
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  get firstElementChild() { return this.children[0] || null; }
  get nextElementSibling() {
    if (!this.parentElement) return null;
    return this.parentElement.children[this.parentElement.children.indexOf(this) + 1] || null;
  }
  getBoundingClientRect() { this.boundsReads += 1; return this.bounds; }
}

function harness() {
  const location = { hostname: 'mail.google.com', pathname: '/mail/u/0/' };
  const metrics = { styleReads: 0 };
  const context = vm.createContext({ location, getComputedStyle: element => { metrics.styleReads += 1; return element.computed; } });
  vm.runInContext(source, context, { filename: 'gmail.js' });
  const marks = [];
  const mark = (element, name, value) => { marks.push({ element, name, value }); element.setAttribute(name, value); };
  return { helper: context.GoshenGmail, location, marks, mark, metrics };
}

function icon({ control = true, svg = {}, paths = [{}], nav = false, mailBody = false } = {}) {
  const wrapper = new Element('div', { classes: mailBody ? 'a3s' : nav ? 'TO nZ' : '', attributes: control && !nav ? { role: 'button' } : {} });
  const vector = wrapper.append(new Element('svg', svg));
  const leaves = paths.map(options => vector.append(new Element('path', options)));
  return { wrapper, vector, leaves };
}

test('production profile matches only the exact Gmail host and mail application path', () => {
  const { helper, location } = harness();
  assert.equal(helper.matches(), true);
  for (const [hostname, pathname] of [
    ['mail.google.com.evil.test', '/mail/u/0/'], ['example.org', '/mail/u/0/'],
    ['mail.google.com', '/accounts/'], ['mail.google.com', '/mailbox/'],
  ]) {
    Object.assign(location, { hostname, pathname });
    assert.equal(helper.matches(), false);
  }
});

test('Gmail surface roles retain distinct regions instead of flattening to base', () => {
  const { helper, mark } = harness();
  const cases = [
    [new Element('form', { attributes: { role: 'search' } }), 'search', 'raised'],
    [new Element('div', { classes: 'aeN WR nH', attributes: { role: 'navigation' } }), 'navigation', 'panel'],
    [new Element('div', { classes: 'bGI nH', attributes: { role: 'main' } }), 'main', 'base'],
    [new Element('div', { classes: 'Tm aeJ' }), 'inbox', 'panel'],
    [new Element('div', { classes: 'wNSjCf' }), 'card', 'raised'],
    [new Element('tr', { classes: 'zA yO s00Hgd', attributes: { role: 'row' } }), 'row', 'panel'],
    [new Element('div', { classes: 'TO aBP nZ aiq' }), 'nav-row', 'panel'],
  ];
  for (const [element, region, surface] of cases) {
    assert.equal(helper.decorate(element, mark), true);
    assert.equal(element.getAttribute('data-gt-gmail-region'), region);
    assert.equal(element.getAttribute('data-gt-surface'), surface);
  }
  const generic = new Element('div', { classes: 'nH' });
  assert.equal(helper.decorate(generic, mark), false, 'Ordinary Gmail layout wrappers still use the generic classifier');
});

test('mail bodies and explicitly preserved regions stop generic fallback for their entire subtree', () => {
  const { helper, mark, marks, metrics } = harness();
  const regions = [
    new Element('div', { classes:'a3s' }),
    new Element('div', { classes:'ii' }),
    new Element('div', { attributes:{ 'data-gt-preserve':'' } }),
    new Element('div', { attributes:{ role:'img' } }),
    new Element('div', { attributes:{ id:'goshen-universal-host' } }),
  ];
  // This caller reproduces the adapter contract: an unhandled element proceeds
  // to ordinary theme classification, even when the Gmail helper made no marks.
  const decorateWithFallback = element => {
    if (!helper.matches() || !helper.decorate(element,mark)) mark(element,'data-gt-foreground','generic-fallback');
  };
  for (const region of regions) {
    const paragraph = region.append(new Element('p'));
    const surface = region.append(new Element('div', { attributes:{ role:'main' } }));
    const control = region.append(new Element('button'));
    const svg = control.append(new Element('svg'));
    const path = svg.append(new Element('path'));
    for (const element of [region,paragraph,surface,control,svg,path]) {
      assert.equal(helper.decorate(element,mark),true,'Preserved descendants must be handled even when no marks are written');
      decorateWithFallback(element);
    }
    assert.equal(svg.boundsReads,0,'Preserved graphics need no geometry inspection');
  }
  assert.equal(metrics.styleReads,0);
  assert.equal(marks.length,0,'Neither Gmail-specific nor generic markers may enter preserved content');
  const ordinary = new Element('p');
  decorateWithFallback(ordinary);
  assert.equal(ordinary.getAttribute('data-gt-foreground'),'generic-fallback','Unrelated Gmail content must still reach the generic adapter');
});

test('small neutral control glyphs gain a fill marker while transparent paths stay transparent', () => {
  const { helper, mark } = harness();
  const { leaves } = icon({ paths: [{}, { fill: 'none' }, { fill: 'rgba(0, 0, 0, 0)' }] });
  leaves.forEach(element => helper.decorate(element, mark));
  assert.equal(leaves[0].getAttribute('data-gt-icon-fill'), 'true');
  assert.equal(leaves[1].getAttribute('data-gt-icon-fill'), null);
  assert.equal(leaves[2].getAttribute('data-gt-icon-fill'), null);
  assert.equal(leaves[0].getAttribute('data-gt-icon-stroke'), null);
});

test('stroke-only icons keep fill none and receive only a stroke marker', () => {
  const { helper, mark } = harness();
  const { leaves } = icon({ paths: [{ fill: 'none', stroke: 'rgb(68, 71, 70)' }] });
  helper.decorate(leaves[0], mark);
  assert.equal(leaves[0].getAttribute('data-gt-icon-fill'), null);
  assert.equal(leaves[0].getAttribute('data-gt-icon-stroke'), 'true');
});

test('the observed selected-navigation blue is changed only inside a selected Gmail navigation row', () => {
  const { helper, mark } = harness();
  const selected = icon({ nav: true, paths: [{ fill: 'rgb(4, 30, 73)' }] });
  const unrelated = icon({ paths: [{ fill: 'rgb(4, 30, 73)' }] });
  helper.decorate(selected.leaves[0], mark);
  helper.decorate(unrelated.leaves[0], mark);
  assert.equal(selected.leaves[0].getAttribute('data-gt-icon-fill'), 'true');
  assert.equal(unrelated.leaves[0].getAttribute('data-gt-icon-fill'), null);
});

test('multicolor, gradient, reference, large and non-control SVGs keep their original paint', () => {
  const { helper, mark, marks } = harness();
  const cases = [
    icon({ paths: [{}, { fill: 'rgb(66, 133, 244)' }] }),
    icon({ paths: [{ fill: 'url(#logo-gradient)' }] }),
    icon({ svg: { width: 49 } }),
    icon({ control: false }),
    icon({ svg: { attributes: { role: 'img' } } }),
    icon({ mailBody: true }),
  ];
  const reference = icon();
  reference.vector.append(new Element('use'));
  cases.push(reference);
  for (const { leaves } of cases) leaves.forEach(element => helper.decorate(element, mark));
  assert.equal(marks.length, 0);
});

test('SVG masks and definitions are not recolored and detached nodes are ignored', () => {
  const { helper, mark, marks } = harness();
  const { vector } = icon();
  const mask = vector.append(new Element('mask'));
  const maskPath = mask.append(new Element('path'));
  helper.decorate(maskPath, mark);
  const detached = new Element('form', { attributes: { role: 'search' } });
  detached.isConnected = false;
  helper.decorate(detached, mark);
  assert.equal(marks.length, 0);
});

test('all profile changes use the supplied reversible attribute writer', () => {
  const { helper } = harness();
  const form = new Element('form', { attributes: { role: 'search', 'data-gt-surface': 'original' } });
  const originals = new Map();
  helper.decorate(form, (element, name, value) => {
    if (!originals.has(name)) originals.set(name, element.getAttribute(name));
    element.setAttribute(name, value);
  });
  for (const [name, value] of originals) {
    if (value === null) form.removeAttribute(name);
    else form.setAttribute(name, value);
  }
  assert.equal(form.getAttribute('data-gt-surface'), 'original');
  assert.equal(form.getAttribute('data-gt-gmail-region'), null);
  assert.equal(form.getAttribute('data-gt-foreground'), null);
});

test('a 64-path SVG is classified once with linear style reads and one geometry read', () => {
  const { helper, mark, metrics, marks } = harness();
  const { vector, leaves } = icon({ paths: Array.from({ length: 64 }, () => ({})) });
  helper.decorate(vector, mark);
  for (let pass = 0; pass < 10; pass += 1) leaves.forEach(element => helper.decorate(element, mark));
  assert.equal(metrics.styleReads, 64, 'One computed-style snapshot per graphical leaf, rather than a full-vector snapshot per leaf');
  assert.equal(vector.boundsReads, 1);
  assert.equal(marks.length, 64);
});

test('rejected icons are also cached without repeated style or geometry reads', () => {
  const { helper, mark, metrics, marks } = harness();
  const { vector, leaves } = icon({ paths: [...Array.from({ length: 63 }, () => ({})), { fill: 'rgb(66, 133, 244)' }] });
  for (let pass = 0; pass < 10; pass += 1) leaves.forEach(element => helper.decorate(element, mark));
  assert.equal(metrics.styleReads, 64);
  assert.equal(vector.boundsReads, 1);
  assert.equal(marks.length, 0);
});

test('dense SVGs are rejected before reading their computed paint', () => {
  const { helper, mark, metrics, marks } = harness();
  const dense = icon({ paths: Array.from({ length: 1000 }, () => ({})) });
  helper.decorate(dense.vector, mark);
  const nested = icon({ paths: [] });
  let parent = nested.vector;
  for (let depth = 0; depth < 1000; depth += 1) parent = parent.append(new Element('g'));
  parent.append(new Element('path'));
  helper.decorate(nested.vector, mark);
  assert.equal(metrics.styleReads, 0);
  assert.equal(marks.length, 0);
});

test('new graphics do not inherit a cached verdict and the next activation can classify afresh', () => {
  const { helper, mark, metrics, marks } = harness();
  const { vector } = icon();
  helper.decorate(vector, mark);
  const newColor = vector.append(new Element('path', { fill: 'rgb(66, 133, 244)' }));
  helper.decorate(newColor, mark);
  assert.equal(newColor.getAttribute('data-gt-icon-fill'), null);
  assert.equal(metrics.styleReads, 1);
  assert.equal(marks.length, 1);
  helper.reset();
  helper.decorate(newColor, mark);
  assert.equal(metrics.styleReads, 3);
  assert.equal(vector.boundsReads, 2);
  assert.equal(newColor.getAttribute('data-gt-icon-fill'), null);
});
