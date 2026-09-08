/* Gmail-only appearance adapter. Reads structure and computed colors, never mail text. */
(() => {
  'use strict';
  const GRAPHICS = 'path,rect,circle,ellipse,line,polygon,polyline';
  const DEFINITIONS = 'defs,mask,clipPath,pattern,marker,filter,linearGradient,radialGradient,symbol';
  const PRESERVE = '[data-gt-preserve],#goshen-universal-host,[role="img"],.a3s,.ii';
  const CONTROLS = 'button,[role="button"],[role="checkbox"],header,[role="banner"],[role="toolbar"],.TO';
  let inspectedIcons = new WeakSet();

  function matches() {
    return globalThis.location?.hostname === 'mail.google.com' && /^\/mail(?:\/|$)/.test(globalThis.location?.pathname || '');
  }

  function paint(value) {
    const match = String(value).match(/^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/);
    if (!match) return null;
    const channels = match.slice(1, 4).map(Number);
    return {
      visible: match[4] === undefined || Number(match[4]) > 0.08,
      neutral: Math.max(...channels) - Math.min(...channels) <= 28,
      selectedInk: channels[0] === 4 && channels[1] === 30 && channels[2] === 73,
    };
  }

  function iconSnapshot(svg) {
    if (!svg || svg.closest(PRESERVE) || !svg.closest(CONTROLS)) return null;
    const bounds = svg.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0 || bounds.width > 48 || bounds.height > 48) return null;
    // Walk only a bounded number of native nodes; querySelectorAll would still
    // enumerate an arbitrarily dense SVG before a length check could reject it.
    const graphics = [];
    let node = svg.firstElementChild;
    let visited = 0;
    while (node) {
      if (++visited > 128 || node.matches('image,use,foreignObject')) return null;
      const definition = node.matches(DEFINITIONS);
      if (!definition && node.matches(GRAPHICS)) {
        if (graphics.length === 64) return null;
        graphics.push(node);
      }
      if (!definition && node.firstElementChild) { node = node.firstElementChild; continue; }
      while (node !== svg && !node.nextElementSibling) node = node.parentElement;
      if (node === svg) break;
      node = node.nextElementSibling;
    }
    if (!graphics.length) return null;
    const selectedNavigation = Boolean(svg.closest('.TO.nZ'));
    const snapshot = [];
    for (const node of graphics) {
      const computed = getComputedStyle(node);
      const paints = {};
      for (const name of ['fill', 'stroke']) {
        const value = computed[name];
        if (value === 'none') continue;
        const color = paint(value);
        // Gradient/reference/unknown paint may be a logo or a mask: preserve it.
        if (!color || color.visible && !color.neutral && !(selectedNavigation && color.selectedInk)) return null;
        if (color.visible) paints[name] = true;
      }
      snapshot.push({ node, ...paints });
    }
    return snapshot;
  }

  function decorateIcon(element, mark) {
    const svg = element.closest('svg');
    if (!svg) return false;
    if (inspectedIcons.has(svg) || element.closest(DEFINITIONS)) return true;
    inspectedIcons.add(svg);
    // Classify the entire SVG once, including negative decisions. Reading all
    // paints before any marker writes avoids repeated style/layout flushes for
    // every path in a vector. New descendants keep their native paint rather
    // than inheriting an earlier verdict about a different graphic.
    const snapshot = iconSnapshot(svg);
    if (!snapshot) return true;
    for (const paint of snapshot) {
      if (paint.fill) mark(paint.node, 'data-gt-icon-fill', 'true');
      if (paint.stroke) mark(paint.node, 'data-gt-icon-stroke', 'true');
    }
    return true;
  }

  function decorate(element, mark) {
    // The universal runtime gates this pure classifier with matches(). Keeping
    // classification separate also allows synthetic, content-free visual QA.
    if (!element?.isConnected || typeof mark !== 'function') return false;
    // Preservation is a handled decision. Returning false would let the
    // universal classifier recolor the message body through its fallback.
    if (element.closest(PRESERVE)) return true;
    if (decorateIcon(element, mark)) return true;
    let region = null;
    if (element.matches('form[role="search"]')) region = 'search';
    else if (element.matches('[role="navigation"].aeN')) region = 'navigation';
    else if (element.matches('[role="main"]')) region = 'main';
    else if (element.matches('.Tm.aeJ')) region = 'inbox';
    else if (element.matches('.wNSjCf,.vvhV3c')) region = 'card';
    else if (element.matches('.zA[role="row"]')) region = 'row';
    else if (element.matches('.TO')) region = 'nav-row';
    if (!region) return false;
    mark(element, 'data-gt-gmail-region', region);
    mark(element, 'data-gt-surface', region === 'search' || region === 'card' ? 'raised' : region === 'main' ? 'base' : 'panel');
    mark(element, 'data-gt-foreground', 'text');
    return true;
  }

  function reset() { inspectedIcons = new WeakSet(); }

  function preservedRoot(element) { return element?.closest?.(PRESERVE) || null; }

  globalThis.GoshenGmail = Object.freeze({ matches, decorate, reset, preservedRoot });
})();
