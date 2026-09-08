/* General-site mode. No network requests, page text or input values are read. */
(() => {
  'use strict';
  if (globalThis.GoshenUniversal) {
    void globalThis.GoshenUniversal.enable();
    return;
  }
  const settingsAPI = globalThis.CyberdeckSettings;
  if (!settingsAPI || !globalThis.GoshenCompanion) return;

  const companion = globalThis.GoshenCompanion.create();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const nativeMarks = new Map();
  const preservedInkStyles = new Map();
  const rootMarks = new Map();
  const rootsToScan = new Set();
  const walkers = [];
  const SCAN_ROOT_LIMIT = 24;
  const SCAN_NODE_LIMIT = 256;
  const SCAN_TIME_LIMIT = 6;
  const SCAN_YIELD_MS = 8;
  const SCAN_BUSY_YIELD_MS = 24;
  const PRESERVE_BATCH_LIMIT = 8;
  const PRESERVED_INK = '--gt-preserved-ink';
  const listeners = [];
  const ROOT_ATTRIBUTES = ['data-gt-universal', 'data-gt-theme', 'data-gt-style', 'data-gt-motion', 'data-gt-profile'];
  const EXCLUDED = 'svg,math,canvas,video,audio,picture,img,iframe,object,embed,script,style,noscript,[role="img"],[data-gt-preserve],#goshen-universal-host';
  const TEXT_TAGS = new Set(['A','P','H1','H2','H3','H4','H5','H6','LI','DT','DD','LABEL','LEGEND','SUMMARY','BLOCKQUOTE','FIGCAPTION','CODE','PRE','KBD','SAMP','TH','TD','BUTTON','INPUT','TEXTAREA','SELECT','OPTION','SPAN','STRONG','EM','SMALL','B','U','DIV','ARTICLE','SECTION','MAIN','BODY']);
  const FONT_TAGS = new Set(['A','P','H1','H2','H3','H4','H5','H6','LI','DT','DD','LABEL','LEGEND','SUMMARY','BLOCKQUOTE','FIGCAPTION','CODE','PRE','KBD','SAMP','TH','TD','BUTTON','INPUT','TEXTAREA','SELECT','OPTION','STRONG','EM','SMALL','B','U']);
  const BODY_FONT_TAGS = new Set(['P','LI','DT','DD','TEXTAREA']);
  const palettes = {
    amber: { phosphor:'#efb866', line:'#535940' },
    green: { phosphor:'#9ed79d', line:'#45604a' },
    ice: { phosphor:'#94d5e5', line:'#415c65' },
  };

  let preferences = { ...settingsAPI.defaults };
  let enabled = false;
  let desired = false;
  let destroyed = false;
  let pendingEnable = null;
  let host = null;
  let shadow = null;
  let elements = {};
  let observer = null;
  let scanTimer = 0;
  let stagedMarks = null;
  let stagedPreservations = [];
  let preservedRegions = new WeakSet();
  let preservationKinds = new WeakMap();
  let resumedPanels = new WeakSet();
  let inputYieldUntil = 0;
  let tickTimer = 0;
  let frameTimer = 0;
  let typingUntil = 0;
  let browsingUntil = 0;
  let lastPointerAt = -10000;
  let lastBrowseRenderAt = -10000;
  let pruneIterator = null;
  let lastPath = location.pathname;
  let collapsed = false;
  let dockLeft = false;
  let dockGeometry = null;
  let manipulation = null;
  let originalFontSize = null;
  let unsubscribe = () => {};
  let classified = new WeakSet();
  let scanStats = { scanned:0,slices:0,maxSliceMs:0,maxSliceNodes:0,maxQueuedRoots:0,preservedInkReads:0,errors:0 };
  let lifecycleRevision = 0;
  let restoreRequest = 0;

  function style() { return preferences.universalStyle === 'frame' ? 'frame' : 'terminal'; }
  function motion() { return preferences.motion !== false && (!preferences.respectReducedMotion || !reducedMotion.matches); }
  function status() { return { enabled, mode:'universal', style:style() }; }
  function diagnostics() {
    return { ...scanStats,maxSliceMs:Math.round(scanStats.maxSliceMs * 100) / 100,queuedRoots:rootsToScan.size,activeWalkers:walkers.length,markedElements:nativeMarks.size };
  }
  function setText(element, value) { if (element && element.textContent !== value) element.textContent = value; }
  function setAttribute(element, name, value) { if (element.getAttribute(name) !== value) element.setAttribute(name, value); }
  function rememberAttribute(element, records, name, value) {
    if (!records.has(name)) records.set(name, element.getAttribute(name));
    setAttribute(element, name, value);
  }
  function mark(element, name, value) {
    let record = nativeMarks.get(element);
    if (!record) { record = new Map(); nativeMarks.set(element, record); }
    if (!record.has(name)) record.set(name, element.getAttribute(name));
    if (name === 'data-gt-image-region' && value === 'true') preservedRegions.add(element);
    // Classification reads a whole slice before any native style changes.
    // Gmail's icon adapter uses this same path, including its multi-leaf marks.
    if (stagedMarks) stagedMarks.push([element,name,value]);
    else setAttribute(element,name,value);
  }
  function restore(element, records) {
    for (const [name, value] of records) {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    }
  }
  function clearNativeMarks() {
    for (const [element, record] of nativeMarks) restore(element, record);
    for (const element of preservedInkStyles.keys()) restorePreservedInk(element);
    nativeMarks.clear();
    classified = new WeakSet();
    preservedRegions = new WeakSet();
    preservationKinds = new WeakMap();
    resumedPanels = new WeakSet();
    stagedMarks = null;
    stagedPreservations = [];
    globalThis.GoshenGmail?.reset?.();
    pruneIterator = null;
    rootsToScan.clear();
    walkers.length = 0;
    clearTimeout(scanTimer);
    scanTimer = 0;
  }
  function listen(target, type, callback, options) {
    target.addEventListener(type, callback, options);
    listeners.push(() => target.removeEventListener(type, callback, options));
  }

  function colorNumber(token,scale) {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/.test(token || '')) return NaN;
    const result = parseFloat(token) * (token.endsWith('%') ? scale / 100 : 1);
    return Number.isFinite(result) ? Math.max(0,Math.min(scale,result)) : NaN;
  }
  function color(value) {
    const text = String(value).trim().toLowerCase();
    if (text === 'transparent') return { red:0,green:0,blue:0,alpha:0 };
    if (text.length > 256) return null;
    const perceptual = text.match(/^(lab|lch|oklab|oklch)\(([^()]*)\)$/);
    if (perceptual) {
      const sections = perceptual[2].trim().split(/\s*\/\s*/);
      const parts = sections[0].trim().split(/\s+/);
      if (sections.length > 2 || parts.length !== 3) return null;
      const zero = token => Number.isFinite(colorNumber(token,1)) && parseFloat(token) === 0;
      const polar = perceptual[1].endsWith('lch');
      const hue = parts[2] === 'none' || /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:deg|grad|rad|turn)?$/.test(parts[2]) && Number.isFinite(parseFloat(parts[2]));
      if (!zero(parts[1]) || (polar ? !hue : !zero(parts[2]))) return null;
      const scale = perceptual[1].startsWith('ok') ? 1 : 100;
      const lightness = colorNumber(parts[0],scale);
      const alpha = sections[1] === undefined ? 1 : colorNumber(sections[1],1);
      if (!Number.isFinite(lightness) || !Number.isFinite(alpha)) return null;
      // Only neutrality and alpha are consumed by the classifier. Equal dummy
      // RGB coordinates express zero chroma without claiming a gamut conversion.
      const neutral = lightness * 255 / scale;
      return { red:neutral,green:neutral,blue:neutral,alpha };
    }
    const rgb = text.match(/^rgba?\(([^()]*)\)$/);
    const modern = text.match(/^color\(\s*(srgb|srgb-linear|display-p3|display-p3-linear)\s+([^()]*)\)$/);
    if (!rgb && !modern) return null;
    const body = rgb ? rgb[1] : modern[2];
    const sections = body.trim().split(/\s*\/\s*/);
    if (sections.length > 2) return null;
    const parts = sections[0].trim().split(/[\s,]+/);
    let alphaPart = sections[1];
    if (rgb && sections.length === 1 && body.includes(',') && parts.length === 4) alphaPart = parts.pop();
    if (parts.length !== 3) return null;
    const scale = rgb ? 255 : 1;
    const channels = parts.map(part => colorNumber(part,scale));
    const alpha = alphaPart === undefined ? 1 : colorNumber(alphaPart,1);
    if (!channels.every(Number.isFinite) || !Number.isFinite(alpha)) return null;
    // This is a neutral/saturated classifier, not a gamut converter. Equal RGB
    // coordinates are neutral in these RGB spaces; colored wide-gamut values
    // remain native until an explicit conversion is supported.
    if (modern && modern[1] !== 'srgb' && Math.max(...channels) - Math.min(...channels) > .00001) return null;
    const [red,green,blue] = channels.map(channel => channel * 255 / scale);
    return { red,green,blue,alpha };
  }
  function saturated(value) { return value && Math.max(value.red,value.green,value.blue) - Math.min(value.red,value.green,value.blue) > 75; }
  function icon(element, computed) {
    return /icon|glyph|wingding|webding|font.?awesome|material.?symbol|symbola/i.test(computed.fontFamily) ||
      /(^|[\s_-])(icon|icons|material-symbols|fa[srlbd]?)([\s_-]|$)/i.test(element.getAttribute('class') || '') ||
      element.getAttribute('aria-hidden') === 'true' && ['I','SPAN'].includes(element.tagName);
  }
  function gmailProfile() { return globalThis.GoshenGmail?.matches() === true; }
  function preserveNativeRegion(element, ink, kind = 'hard') {
    if (!element?.isConnected || element === host || preservedRegions.has(element)) return;
    if (!preservedInkStyles.has(element)) preservedInkStyles.set(element,{
      value:element.style.getPropertyValue(PRESERVED_INK),
      priority:element.style.getPropertyPriority(PRESERVED_INK),
      hadStyle:element.hasAttribute('style'),
    });
    mark(element,'data-gt-image-region','true');
    preservationKinds.set(element,kind);
    stagedPreservations.push({ element,ink });
  }
  function restorePreservedInk(element) {
    const original = preservedInkStyles.get(element);
    if (!original) return;
    if (original.value) element.style.setProperty(PRESERVED_INK,original.value,original.priority);
    else element.style.removeProperty(PRESERVED_INK);
    if (!original.hadStyle && !element.getAttribute('style')?.trim()) element.removeAttribute('style');
    preservedInkStyles.delete(element);
  }
  function readPreservedInk() {
    const pending = stagedPreservations;
    stagedPreservations = [];
    if (!pending.length) return [];
    const suspended = [];
    const visited = new Set();
    const snapshots = [];
    try {
      // A boundary discovered in a later slice may already inherit themed ink.
      // Suspend only our color-producing ancestor markers, never page styles or
      // the root theme flag. Shared ancestors are inspected once per batch.
      for (const { element } of pending) {
        for (let ancestor = element; ancestor && !visited.has(ancestor); ancestor = ancestor.parentElement) {
          visited.add(ancestor);
          const owned = nativeMarks.get(ancestor);
          for (const name of ['data-gt-foreground','data-gt-gmail-region']) {
            if (!owned?.has(name)) continue;
            const value = ancestor.getAttribute(name);
            if (value === null || name === 'data-gt-foreground' && !['text','link'].includes(value)) continue;
            suspended.push([ancestor,name,value]);
            ancestor.removeAttribute(name);
          }
        }
      }
      // Read every native color before restoring markers or writing properties.
      // At most eight new boundaries join one scan slice; ordinary nodes take
      // no additional computed-style read. The slice diagnostic includes this.
      for (const { element,ink } of pending) {
        if (!element.isConnected) continue;
        try {
          let value = ink;
          if (suspended.length || !value) { value = getComputedStyle(element).color; scanStats.preservedInkReads += 1; }
          if (value) snapshots.push([element,value]);
        } catch { scanStats.errors += 1; }
      }
    } finally {
      for (const [ancestor,name,value] of suspended) setAttribute(ancestor,name,value);
    }
    return snapshots;
  }
  function preservedRegion(element) {
    // Newly discovered image/semantic-color parents have not been written to
    // the DOM yet. Their children must still be preserved within this slice.
    for (let node = element; node; node = node.parentElement) {
      if (preservedRegions.has(node) || node.getAttribute('data-gt-image-region') === 'true') return preservationKinds.get(node) || 'hard';
      if (resumedPanels.has(node)) return null;
    }
    return null;
  }
  function decorate(element) {
    if (!enabled || style() !== 'terminal' || !element.isConnected) return;
    if (classified.has(element) || nativeMarks.has(element)) return;
    classified.add(element);
    const gmail = gmailProfile() ? globalThis.GoshenGmail : null;
    const explicitPreserve = gmail?.preservedRoot?.(element) || element.closest('[data-gt-preserve],[role="img"]');
    if (explicitPreserve) { preserveNativeRegion(explicitPreserve); return; }
    if (gmail && gmail.decorate(element,mark)) return;
    if (element.closest(EXCLUDED)) return;
    const preservation = preservedRegion(element);
    if (preservation === 'hard') return;
    const computed = getComputedStyle(element);
    const background = color(computed.backgroundColor);
    if (computed.backgroundImage && computed.backgroundImage !== 'none') {
      preserveNativeRegion(element,computed.color,'image');
      return;
    }
    if (icon(element, computed)) return;
    // Keep semantic saturated colors, such as red errors or green success states.
    // Unknown color spaces also stay native rather than risking light theme ink
    // on a background whose original contrast we cannot classify.
    const foreground = color(computed.color);
    if (!background || !foreground || background.alpha > .12 && saturated(background)) {
      preserveNativeRegion(element,computed.color);
      return;
    }
    // Text directly over artwork stays native. An opaque neutral card supplies
    // its own background, so it can resume theming inside a page-size backdrop.
    if (preservation === 'image' && background.alpha < .99) return;
    if (preservation === 'image') resumedPanels.add(element);
    if (element.tagName === 'BODY' || background && background.alpha > .12) {
      const raised = ['BUTTON','INPUT','TEXTAREA','SELECT','OPTION'].includes(element.tagName);
      const panel = ['HEADER','NAV','ASIDE','FOOTER','PRE','BLOCKQUOTE','DIALOG'].includes(element.tagName);
      mark(element, 'data-gt-surface', raised ? 'raised' : panel ? 'panel' : 'base');
    }
    if (TEXT_TAGS.has(element.tagName) && !saturated(foreground)) {
      mark(element, 'data-gt-foreground', element.tagName === 'A' ? 'link' : 'text');
    } else if (element.tagName === 'A') mark(element, 'data-gt-foreground', 'link');
    if (FONT_TAGS.has(element.tagName)) mark(element, 'data-gt-font', BODY_FONT_TAGS.has(element.tagName) ? 'body' : 'native-size');
    if (['Top','Right','Bottom','Left'].some(side => computed[`border${side}Style`] && computed[`border${side}Style`] !== 'none' && computed[`border${side}Style`] !== 'hidden')) {
      mark(element, 'data-gt-border', 'true');
    }
  }

  function queueScan(node) {
    if (!enabled || style() !== 'terminal' || node?.nodeType !== 1 || node === host) return;
    if (node.closest(EXCLUDED) && !node.closest('[data-gt-preserve],[role="img"]') && !(gmailProfile() && node.closest('svg'))) return;
    // MutationObserver often reports both a new subtree and many descendants.
    // Keep one pending representative instead of walking every branch repeatedly.
    for (const root of rootsToScan) if (root === node || root.contains(node)) return;
    for (const root of rootsToScan) if (!root.isConnected || node.contains(root)) rootsToScan.delete(root);
    if (rootsToScan.size >= SCAN_ROOT_LIMIT) {
      rootsToScan.clear();
      rootsToScan.add(document.body || document.documentElement);
    } else rootsToScan.add(node);
    scanStats.maxQueuedRoots = Math.max(scanStats.maxQueuedRoots,rootsToScan.size);
    scheduleScan();
  }
  function scheduleScan(delay = 1) {
    if (!scanTimer && enabled && style() === 'terminal' && !document.hidden && (walkers.length || rootsToScan.size)) {
      scanTimer = setTimeout(scan,delay);
    }
  }
  function scan() {
    scanTimer = 0;
    if (!enabled || style() !== 'terminal' || document.hidden) return;
    const began = performance.now();
    const busy = began < inputYieldUntil || manipulation !== null;
    const nodeLimit = busy ? 24 : SCAN_NODE_LIMIT;
    const timeLimit = busy ? 2 : SCAN_TIME_LIMIT;
    let budget = nodeLimit;
    stagedMarks = [];
    while (budget > 0 && performance.now() - began < timeLimit && stagedPreservations.length < PRESERVE_BATCH_LIMIT) {
      if (walkers.length && !walkers[0].root.isConnected) walkers.length = 0;
      if (!walkers.length) {
        const root = rootsToScan.values().next().value;
        if (!root) break;
        rootsToScan.delete(root);
        if (!root.isConnected) continue;
        walkers.push({ root,first:root,walker:document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT) });
      }
      const job = walkers[0];
      const node = job.first || job.walker.nextNode();
      job.first = null;
      if (!node) { walkers.shift(); continue; }
      try { decorate(node); } catch { scanStats.errors += 1; }
      scanStats.scanned += 1;
      budget -= 1;
    }
    const writes = stagedMarks;
    stagedMarks = null;
    const inkWrites = readPreservedInk();
    for (const [element,value] of inkWrites) element.style.setProperty(PRESERVED_INK,value,'important');
    for (const [element,name,value] of writes) setAttribute(element,name,value);
    pruneMarks(12);
    scanStats.slices += 1;
    scanStats.maxSliceNodes = Math.max(scanStats.maxSliceNodes,nodeLimit - budget);
    scanStats.maxSliceMs = Math.max(scanStats.maxSliceMs,performance.now() - began);
    scheduleScan(busy ? SCAN_BUSY_YIELD_MS : SCAN_YIELD_MS);
  }
  function pruneMarks(budget = 200) {
    // Releasing removed nodes is also bounded; a large page must not cause a
    // full-document cleanup pass on every small batch of newly added content.
    if (!pruneIterator) pruneIterator = nativeMarks.entries();
    for (let count = 0; count < budget; count += 1) {
      const next = pruneIterator.next();
      if (next.done) { pruneIterator = null; break; }
      const [element, record] = next.value;
      if (!element.isConnected) { restore(element, record); restorePreservedInk(element); nativeMarks.delete(element); classified.delete(element); preservedRegions.delete(element); preservationKinds.delete(element); resumedPanels.delete(element); }
    }
  }

  function applyPreferences() {
    if (!enabled || !host) return;
    const root = document.documentElement;
    rememberAttribute(root, rootMarks, 'data-gt-universal', 'true');
    rememberAttribute(root, rootMarks, 'data-gt-theme', palettes[preferences.theme] ? preferences.theme : 'amber');
    rememberAttribute(root, rootMarks, 'data-gt-style', style());
    rememberAttribute(root, rootMarks, 'data-gt-motion', String(motion()));
    rememberAttribute(root, rootMarks, 'data-gt-profile', gmailProfile() ? 'gmail' : 'generic');
    root.style.setProperty('--gt-font-size', `${preferences.fontSize || 15}px`);
    const palette = palettes[preferences.theme] || palettes.amber;
    elements.deck.style.setProperty('--phosphor', palette.phosphor);
    elements.deck.style.setProperty('--line', palette.line);
    elements.deck.style.setProperty('--scanlines', String((preferences.scanlines || 0) / 100));
    elements.deck.style.setProperty('--glow', `${(preferences.glow || 0) / 6}px`);
    setAttribute(elements.deck, 'data-motion', String(motion()));
    setAttribute(elements.deck, 'data-paused', String(document.hidden));
    setText(elements.mode, style() === 'frame' ? 'FRAME ONLY' : 'PHOSPHOR MODE');
    elements.quip.hidden = preferences.quips === false;
    applyGeometry();
    syncAnimation();
    render();
  }

  function render() {
    if (!enabled || !host) return;
    const now = performance.now();
    const typing = now < typingUntil;
    const browsing = now < browsingUntil;
    const frame = companion.frame({ now, activity:typing ? 'typing' : 'ready', motion:motion() && !document.hidden && !collapsed, quips:preferences.quips !== false });
    setText(elements.rabbit, frame.art);
    setText(elements.quip, frame.quip);
    setText(elements.mood, frame.label);
    setText(elements.activity, typing ? 'KEYS ACTIVE' : browsing ? 'EXPLORING' : 'STANDBY');
    setAttribute(elements.deck, 'data-active', String(typing || browsing));
  }
  function syncAnimation() {
    clearInterval(frameTimer);
    frameTimer = 0;
    if (enabled && motion() && !document.hidden && !collapsed) frameTimer = setInterval(render, 160);
  }
  function tick() {
    if (!enabled) return;
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      companion.react('navigate', performance.now());
      browsingUntil = performance.now() + 2400;
    }
    // Some SPA frameworks replace the body. The separate dock can reattach
    // without recreating listeners or touching the application's own nodes.
    if (host && !host.isConnected && document.body) document.body.append(host);
    applyRootPresence();
    pruneMarks();
    render();
  }
  function onVisibilityChange() {
    clearTimeout(scanTimer); scanTimer = 0;
    clearInterval(tickTimer); tickTimer = 0;
    applyPreferences();
    if (!document.hidden) {
      tickTimer = setInterval(tick,1000);
      scheduleScan();
    }
  }
  function applyRootPresence() {
    const root = document.documentElement;
    setAttribute(root, 'data-gt-universal', 'true');
    setAttribute(root, 'data-gt-theme', palettes[preferences.theme] ? preferences.theme : 'amber');
    setAttribute(root, 'data-gt-style', style());
    setAttribute(root, 'data-gt-motion', String(motion()));
    setAttribute(root, 'data-gt-profile', gmailProfile() ? 'gmail' : 'generic');
  }
  function ownEvent(event) { return event.composedPath?.().includes(host); }
  function onInput(event) {
    if (ownEvent(event)) return;
    inputYieldUntil = performance.now() + 100;
    const target = event.target;
    if (!target?.matches?.('textarea,input,[contenteditable="true"],[contenteditable=""]')) return;
    // Do not inspect field values, labels, names, surrounding text or passwords.
    if (target.tagName === 'INPUT' && !['text','search','url'].includes(target.type)) return;
    typingUntil = performance.now() + 2200;
    render();
  }
  function onBrowse(event) {
    if (ownEvent(event)) return;
    const now = performance.now();
    inputYieldUntil = now + 80;
    browsingUntil = now + 1300;
    if (event.type === 'pointerdown' && now - lastPointerAt > 18000) {
      lastPointerAt = now;
      companion.react('navigate', now);
    }
    if (now - lastBrowseRenderAt >= 140) {
      lastBrowseRenderAt = now;
      render();
    }
  }

  const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
  function viewport() {
    const width = Math.max(1,document.documentElement.clientWidth || window.innerWidth);
    const height = Math.max(1,document.documentElement.clientHeight || window.innerHeight);
    return { width,height,margin:Math.min(12,width / 10,height / 10) };
  }
  function applyGeometry() {
    if (!elements.dock) return;
    const bounds = viewport();
    const availableWidth = bounds.width - 2 * bounds.margin;
    const availableHeight = bounds.height - 2 * bounds.margin;
    if (!dockGeometry) dockGeometry = { x:null,y:null,width:bounds.width < 600 ? 230 : 260,height:340 };
    dockGeometry.width = clamp(dockGeometry.width,Math.min(220,availableWidth),availableWidth);
    dockGeometry.height = clamp(dockGeometry.height,Math.min(280,availableHeight),availableHeight);
    const visibleHeight = collapsed ? Math.min(44,availableHeight) : dockGeometry.height;
    if (dockGeometry.x === null) dockGeometry.x = dockLeft ? bounds.margin : bounds.width - bounds.margin - dockGeometry.width;
    if (dockGeometry.y === null) dockGeometry.y = bounds.height - bounds.margin - visibleHeight;
    dockGeometry.x = clamp(dockGeometry.x,bounds.margin,bounds.width - bounds.margin - dockGeometry.width);
    dockGeometry.y = clamp(dockGeometry.y,bounds.margin,bounds.height - bounds.margin - visibleHeight);
    for (const [name,value] of [['left',dockGeometry.x],['top',dockGeometry.y],['width',dockGeometry.width],['height',visibleHeight]]) {
      elements.dock.style.setProperty(name,`${Math.round(value)}px`);
    }
    const compact = dockGeometry.height < 280;
    const tight = dockGeometry.height < 190;
    setAttribute(elements.deck,'data-compact',String(compact));
    setAttribute(elements.deck,'data-tight',String(tight));
    // Reserve the fixed header/footer, body padding, labels and two-line quip
    // before fitting the 23-column, 14-line sprite. Short viewports progressively
    // omit optional labels; the title, OFF and resize controls keep their space.
    const reservedHeight = tight ? 82 : compact ? 131 : preferences.quips === false ? 137 : 174;
    const horizontalPadding = tight ? 12 : compact ? 20 : 28;
    const size = clamp(Math.min(9 * dockGeometry.width / 260,
      (dockGeometry.height - reservedHeight) / (14 * 1.08),
      (dockGeometry.width - horizontalPadding) / (23 * (.65 + 1 / 15))),.5,22);
    elements.deck.style.setProperty('--rabbit-size',`${size.toFixed(2)}px`);
    elements.deck.style.setProperty('--rabbit-spacing',`${(size / 15).toFixed(2)}px`);
  }
  function resizeGeometry(width,height,base = dockGeometry) {
    const bounds = viewport();
    const availableWidth = bounds.width - bounds.margin - base.x;
    const availableHeight = bounds.height - bounds.margin - base.y;
    dockGeometry.width = clamp(width,Math.min(220,availableWidth),availableWidth);
    dockGeometry.height = clamp(height,Math.min(280,availableHeight),availableHeight);
    applyGeometry();
  }
  function endManipulation(cancel = false) {
    if (!manipulation) return;
    const previous = manipulation;
    manipulation = null;
    if (cancel) dockGeometry = { ...previous.geometry };
    try { previous.control.releasePointerCapture?.(previous.pointerId); } catch { /* The browser may already have released it. */ }
    if (elements.deck) setAttribute(elements.deck,'data-manipulating','false');
    applyGeometry();
  }
  function startManipulation(event,kind) {
    if (!enabled || event.button !== 0 || event.isPrimary === false || kind === 'resize' && collapsed) return;
    if (kind === 'move' && event.target?.closest?.('button')) return;
    event.preventDefault(); event.stopPropagation();
    endManipulation();
    applyGeometry();
    const control = kind === 'move' ? elements.handle : elements.resize;
    manipulation = { kind,control,pointerId:event.pointerId,x:event.clientX,y:event.clientY,geometry:{ ...dockGeometry } };
    try { control.setPointerCapture?.(event.pointerId); } catch { /* A cancelled pointer must not disrupt the host page. */ }
    control.focus();
    setAttribute(elements.deck,'data-manipulating','true');
  }
  function movePointer(event) {
    if (!manipulation || event.pointerId !== manipulation.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const start = manipulation.geometry;
    const dx = event.clientX - manipulation.x;
    const dy = event.clientY - manipulation.y;
    if (manipulation.kind === 'resize') resizeGeometry(start.width + dx,start.height + dy,start);
    else { dockGeometry.x = start.x + dx; dockGeometry.y = start.y + dy; applyGeometry(); }
  }
  function endPointer(event) {
    if (!manipulation || event.pointerId !== manipulation.pointerId) return;
    endManipulation(event.type === 'pointercancel');
  }
  function geometryKey(event,kind) {
    const control = kind === 'move' ? elements.handle : elements.resize;
    if (event.target !== control || !enabled || kind === 'resize' && collapsed) return;
    if (event.key === 'Escape' && manipulation) { event.preventDefault(); endManipulation(true); return; }
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    endManipulation();
    if (event.key === 'Home') {
      if (kind === 'move') { dockGeometry.x = null; dockGeometry.y = null; }
      else { dockGeometry.width = viewport().width < 600 ? 230 : 260; dockGeometry.height = 340; }
      applyGeometry(); return;
    }
    const step = event.shiftKey ? 40 : 10;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    if (kind === 'resize') resizeGeometry(dockGeometry.width + dx,dockGeometry.height + dy);
    else { dockGeometry.x += dx; dockGeometry.y += dy; applyGeometry(); }
  }
  function onViewportResize() { endManipulation(); applyGeometry(); }

  const SHADOW_STYLE = `
    :host{all:initial!important;position:fixed!important;inset:0!important;display:block!important;z-index:2147483646!important;pointer-events:none!important;color-scheme:dark!important}
    *{box-sizing:border-box}[hidden]{display:none!important} .deck{--phosphor:#efb866;--line:#535940;--scanlines:.18;--glow:5px;color:#e2dfcc;font:11px/1.45 "Cascadia Code",Consolas,"Liberation Mono",monospace;letter-spacing:.2px}
    .bezel{position:fixed;inset:0;border:6px solid #1a1e17;box-shadow:inset 0 0 0 1px var(--line),inset 0 0 38px #0003;pointer-events:none;border-radius:9px}
    .scanlines{position:fixed;inset:6px;background:repeating-linear-gradient(0deg,transparent 0 3px,#000 3px 4px);opacity:var(--scanlines);pointer-events:none}
    .dock{position:fixed;display:grid;grid-template-rows:43px minmax(0,1fr)42px;overflow:hidden;pointer-events:auto;border:1px solid var(--line);border-radius:5px;background:linear-gradient(135deg,#252a20,#151912 62%);box-shadow:0 10px 40px #0008,inset 0 1px #ffffff0a}
    header{display:flex;align-items:center;gap:8px;min-width:0;padding:9px 11px;border-bottom:1px solid var(--line);cursor:grab;touch-action:none;user-select:none}header:focus-visible{outline:2px solid var(--phosphor);outline-offset:-3px}.deck[data-manipulating="true"] header{cursor:grabbing}.help{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
    .brand{font-size:10px;letter-spacing:1px;color:var(--phosphor);flex:1;min-width:0;overflow:clip;text-overflow:ellipsis;white-space:nowrap}.lamp{display:inline-block;flex:none;width:5px;height:5px;background:var(--phosphor);box-shadow:0 0 7px var(--phosphor);border-radius:50%}
    button{font:inherit;color:var(--phosphor);background:transparent;border:1px solid transparent;border-radius:2px;cursor:pointer;padding:4px 6px;line-height:1.2}header button,footer button{flex-shrink:0}button:hover{background:#ffffff0b;border-color:var(--line)}button:focus-visible{outline:2px solid var(--phosphor);outline-offset:2px}
    .body{display:flex;flex-direction:column;gap:4px;padding:8px 12px;min-width:0;min-height:0;overflow:clip}.meta{display:flex;flex:none;justify-content:space-between;align-items:center;color:#a4aa92;font-size:8px;line-height:12px;letter-spacing:1px;white-space:nowrap}.mode{flex:1;min-width:0;overflow:clip;text-overflow:ellipsis;white-space:nowrap;color:#a4aa92;font-size:8px}
    .pet{display:flex;flex:1;align-items:center;justify-content:center;min-width:0;min-height:0;margin:0;padding:0;overflow:clip;border-radius:4px}.pet:hover{background:#ffffff03}.pet:focus-visible{outline-offset:-2px}.rabbit{font:var(--rabbit-size,9px)/1.08 "Cascadia Code",Consolas,"Liberation Mono",monospace;letter-spacing:var(--rabbit-spacing,.6px);white-space:pre;margin:0;color:var(--phosphor);text-shadow:0 0 var(--glow) var(--phosphor);user-select:none}
    .mood{flex:none;text-align:center;margin:0;color:var(--phosphor);font-size:8px;line-height:12px;letter-spacing:1px;white-space:nowrap;overflow:clip;text-overflow:ellipsis}.quip{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;flex:none;height:33px;padding:2px 0 0;margin:0;border-top:1px dashed var(--line);overflow:clip;font-size:10px;color:#c2c7ae;line-height:15px}
    .bank{display:flex;gap:4px;align-items:center}.bank i{width:4px;height:7px;background:var(--phosphor);opacity:.25}.bank i:nth-child(2){animation-delay:-.6s}.bank i:nth-child(3){animation-delay:-1.2s}.bank i:nth-child(4){animation-delay:-1.8s}.bank i:nth-child(5){animation-delay:-2.4s}.bank i:nth-child(6){animation-delay:-3s}
    footer{display:flex;justify-content:space-between;align-items:center;gap:5px;padding:7px 9px;border-top:1px solid var(--line);font-size:8px;color:#a4aa92}.exit{font-size:9px;border-color:var(--line);padding:5px 7px}.side{font-size:9px;color:#a4aa92}.resize{font-size:17px;padding:2px;line-height:1;cursor:nwse-resize;touch-action:none;user-select:none}
    .deck[data-compact="true"] .body{gap:3px;padding:6px 8px}.deck[data-compact="true"] .quip{display:none}
    .deck[data-tight="true"] .dock{grid-template-rows:36px minmax(0,1fr)34px}.deck[data-tight="true"] header{gap:6px;padding:6px 8px}.deck[data-tight="true"] footer{padding:4px 7px}.deck[data-tight="true"] .body{gap:0;padding:4px}.deck[data-tight="true"] .meta,.deck[data-tight="true"] .mood{display:none}
    .deck[data-collapsed="true"] .body,.deck[data-collapsed="true"] footer{display:none}.deck[data-collapsed="true"] .dock{grid-template-rows:43px}.deck[data-collapsed="true"] header{border-bottom:0}
    .deck[data-motion="true"] .lamp{animation:breathe 4s steps(2,end) infinite}.deck[data-motion="true"] .bank i{animation:blink 3.8s steps(2,end) infinite}.deck[data-motion="true"][data-active="true"] .bank i{animation-duration:1.6s}.deck[data-paused="true"] *{animation-play-state:paused!important}
    @keyframes blink{0%,70%,100%{opacity:.2}20%,40%{opacity:.95;box-shadow:0 0 5px var(--phosphor)}}@keyframes breathe{0%,100%{opacity:.4}50%{opacity:1}}
    @media(max-width:600px){.bezel{border-width:3px}.scanlines{inset:3px}}
    @media print{:host{display:none!important}}
  `;

  function mount() {
    enabled = true;
    scanStats = { scanned:0,slices:0,maxSliceMs:0,maxSliceNodes:0,maxQueuedRoots:0,preservedInkReads:0,errors:0 };
    originalFontSize = { value:document.documentElement.style.getPropertyValue('--gt-font-size'), priority:document.documentElement.style.getPropertyPriority('--gt-font-size') };
    host = document.createElement('div');
    host.id = 'goshen-universal-host';
    shadow = host.attachShadow({ mode:'open' });
    shadow.innerHTML = `<style>${SHADOW_STYLE}</style><div class="deck" data-collapsed="${collapsed}" data-left="${dockLeft}">
      <div class="bezel" aria-hidden="true"></div><div class="scanlines" aria-hidden="true"></div>
      <section class="dock" aria-label="Terminal companion">
        <header class="handle" tabindex="0" role="group" aria-label="Move HOPPER window" aria-describedby="gt-move-help" title="Drag to move. Arrow keys move; Shift moves farther; Home resets position."><span class="lamp" aria-hidden="true"></span><span class="brand">TERMINAL</span><button class="collapse" aria-label="${collapsed ? 'Expand' : 'Collapse'} HOPPER window" aria-expanded="${!collapsed}">${collapsed ? '+' : '−'}</button><button class="close" aria-label="Turn off terminal">×</button></header>
        <div class="body"><div class="meta"><span class="activity">STANDBY</span><span class="bank" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span></div>
          <button class="pet" aria-label="Pet HOPPER"><pre class="rabbit" aria-hidden="true"></pre></button><p class="mood">HOPPER / STANDBY</p><p class="quip" aria-live="off"></p>
        </div><footer><button class="side" aria-label="Move companion to the ${dockLeft ? 'right' : 'left'}">⇄ MOVE</button><span class="mode">PHOSPHOR MODE</span><button class="exit">OFF</button><button class="resize" aria-label="Resize HOPPER window" aria-describedby="gt-resize-help" title="Drag to resize. Arrow keys resize; Shift changes faster; Home resets size.">◢</button></footer>
      </section><span class="help" id="gt-move-help">Drag this title bar to move. Arrow keys move ten pixels; Shift moves forty. Home restores the corner position.</span><span class="help" id="gt-resize-help">Drag this corner to resize. Arrow keys change width and height; Shift changes forty pixels. Home restores the default size.</span></div>`;
    elements = Object.fromEntries(['deck','dock','handle','resize','rabbit','quip','mood','activity','mode','collapse','side'].map(name => [name,shadow.querySelector(`.${name}`)]));
    listen(shadow.querySelector('.pet'),'click', () => { companion.react('pet',performance.now()); render(); });
    listen(shadow.querySelector('.exit'),'click', pageOff);
    listen(shadow.querySelector('.close'),'click', pageOff);
    listen(elements.collapse,'click', () => {
      endManipulation();
      collapsed = !collapsed;
      setAttribute(elements.deck,'data-collapsed',String(collapsed));
      setAttribute(elements.collapse,'aria-expanded',String(!collapsed));
      setAttribute(elements.collapse,'aria-label',`${collapsed ? 'Expand' : 'Collapse'} HOPPER window`);
      setText(elements.collapse,collapsed ? '+' : '−');
      applyGeometry(); syncAnimation(); render();
    });
    listen(elements.side,'click', () => {
      endManipulation();
      dockLeft = !dockLeft;
      setAttribute(elements.deck,'data-left',String(dockLeft));
      setAttribute(elements.side,'aria-label',`Move companion to the ${dockLeft ? 'right' : 'left'}`);
      dockGeometry.x = null; dockGeometry.y = null; applyGeometry();
    });
    for (const [control,kind] of [[elements.handle,'move'],[elements.resize,'resize']]) {
      listen(control,'pointerdown',event => startManipulation(event,kind));
      listen(control,'pointermove',movePointer);
      listen(control,'pointerup',endPointer);
      listen(control,'pointercancel',endPointer);
      listen(control,'lostpointercapture',endPointer);
      listen(control,'keydown',event => geometryKey(event,kind));
    }
    (document.body || document.documentElement).append(host);
    applyGeometry();
    companion.reset(performance.now());
    applyPreferences();
    observer = new MutationObserver(mutations => {
      if (!enabled) return;
      if (!host.isConnected && document.body) document.body.append(host);
      if (mutations.length > 80 || mutations.some(mutation => mutation.addedNodes?.length > 80)) {
        // A large SPA render should enqueue one incremental pass. Do not spend
        // the observer callback enumerating thousands of overlapping additions.
        applyRootPresence();
        queueScan(document.body || document.documentElement);
        return;
      }
      for (const mutation of mutations) {
        if (mutation.target === document.documentElement && mutation.type === 'attributes') { applyRootPresence(); continue; }
        for (const node of mutation.addedNodes || []) queueScan(node);
      }
    });
    observer.observe(document.documentElement, { subtree:true, childList:true, attributes:true, attributeFilter:ROOT_ATTRIBUTES });
    listen(document,'input',onInput,true);
    listen(document,'pointerdown',onBrowse,{ capture:true, passive:true });
    listen(document,'scroll',onBrowse,{ capture:true, passive:true });
    listen(document,'visibilitychange',onVisibilityChange);
    listen(window,'resize',onViewportResize);
    listen(reducedMotion,'change',applyPreferences);
    unsubscribe = settingsAPI.subscribe(onPreferences);
    if (!document.hidden) tickTimer = setInterval(tick,1000);
    queueScan(document.body || document.documentElement);
  }

  async function enable() {
    if (destroyed) return status();
    lifecycleRevision += 1;
    desired = true;
    if (enabled) return status();
    if (pendingEnable) return pendingEnable;
    pendingEnable = (async () => {
      try { preferences = { ...preferences, ...await settingsAPI.load() }; } catch { /* Defaults keep a reversible local theme usable. */ }
      if (desired && !destroyed && !enabled) {
        try { mount(); } catch (error) { disable(); throw error; }
      }
      return status();
    })();
    try { return await pendingEnable; } finally { pendingEnable = null; }
  }
  function disable() {
    lifecycleRevision += 1;
    endManipulation();
    desired = false;
    enabled = false;
    observer?.disconnect(); observer = null;
    clearTimeout(scanTimer); clearInterval(tickTimer); clearInterval(frameTimer);
    scanTimer = tickTimer = frameTimer = 0;
    for (const remove of listeners.splice(0)) remove();
    unsubscribe(); unsubscribe = () => {};
    clearNativeMarks();
    restore(document.documentElement,rootMarks); rootMarks.clear();
    if (originalFontSize) {
      if (originalFontSize.value) document.documentElement.style.setProperty('--gt-font-size',originalFontSize.value,originalFontSize.priority);
      else document.documentElement.style.removeProperty('--gt-font-size');
    }
    originalFontSize = null;
    host?.remove(); host = shadow = null; elements = {};
    typingUntil = browsingUntil = inputYieldUntil = 0;
    companion.reset(performance.now());
    return status();
  }
  function pageOff() {
    disable();
    // Only a direct dock OFF/close action clears this tab's navigation intent.
    // Controller rollback, ordinary disable(), and local previews stay local.
    try {
      if (globalThis.chrome?.runtime?.id && typeof globalThis.chrome.runtime.sendMessage === 'function') {
        globalThis.chrome.runtime.sendMessage({ type:'goshen:page-off' })?.catch?.(() => {});
      }
    } catch { /* Extension reloads can invalidate an old page context. */ }
  }
  function onPreferences(next) {
    const oldStyle = style();
    preferences = { ...preferences, ...next };
    if (!enabled) return;
    if (style() !== oldStyle) { clearNativeMarks(); queueScan(document.body || document.documentElement); }
    applyPreferences();
  }
  async function onPageRestore(event) {
    if (!event.persisted || destroyed || !globalThis.chrome?.runtime?.id || typeof globalThis.chrome.runtime.sendMessage !== 'function') return;
    const request = ++restoreRequest;
    // Cached appearance is stale until the worker confirms this tab still wants
    // it. Keep the native page usable while that short query is in flight.
    if (enabled) disable();
    const revision = lifecycleRevision;
    try {
      const reply = await globalThis.chrome.runtime.sendMessage({ type:'goshen:restore-intent' });
      if (destroyed || request !== restoreRequest || revision !== lifecycleRevision) return;
      if (reply?.ok && typeof reply.enabled === 'boolean') {
        if (reply.enabled) await enable();
        else disable();
      }
    } catch { /* An invalidated extension context cannot safely change tab intent. */ }
  }
  function destroy() {
    disable(); destroyed = true;
    window.removeEventListener('pageshow',onPageRestore);
    delete globalThis.GoshenUniversal;
    return status();
  }
  globalThis.GoshenUniversal = Object.freeze({ enable, disable, status, destroy, diagnostics });
  // This one lifetime listener also handles a previously disabled BFCache page.
  // It is removed on destroy; normal local previews never query the worker.
  window.addEventListener('pageshow',onPageRestore);
  void enable();
})();
