/* Shared classic script. Preferences only; never stores conversation content. */
(() => {
  'use strict';
  if (globalThis.CyberdeckSettings) return;
  const KEY = 'cyberdeck.settings';
  const defaults = Object.freeze({ enabled: true, theme: 'amber', layout: 'deck', universalStyle: 'terminal', scanlines: 18, glow: 35, motion: true, quips: true, respectReducedMotion: false, fontSize: 15 });
  const listeners = new Set();
  const extension = Boolean(globalThis.chrome?.runtime?.id);
  const preview = !extension && (globalThis.location?.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(globalThis.location?.hostname || ''));
  let memory = { ...defaults };
  let previewStorageAvailable = true;
  let pending = Promise.resolve();

  function number(value, min, max, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
  }

  function normalize(value) {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
      enabled: typeof input.enabled === 'boolean' ? input.enabled : defaults.enabled,
      theme: ['amber', 'green', 'ice'].includes(input.theme) ? input.theme : defaults.theme,
      layout: ['deck', 'focus'].includes(input.layout) ? input.layout : defaults.layout,
      universalStyle: ['terminal', 'frame'].includes(input.universalStyle) ? input.universalStyle : defaults.universalStyle,
      scanlines: number(input.scanlines, 0, 40, defaults.scanlines),
      glow: number(input.glow, 0, 60, defaults.glow),
      motion: typeof input.motion === 'boolean' ? input.motion : defaults.motion,
      quips: typeof input.quips === 'boolean' ? input.quips : defaults.quips,
      respectReducedMotion: typeof input.respectReducedMotion === 'boolean' ? input.respectReducedMotion : defaults.respectReducedMotion,
      fontSize: number(input.fontSize, 13, 20, defaults.fontSize)
    };
  }

  function emit(value) {
    for (const listener of listeners) {
      try { listener({ ...value }); } catch (error) { console.error('Goshen Terminal preference listener:', error); }
    }
  }

  function storage() {
    if (!extension || !globalThis.chrome?.storage?.local) throw new Error('Chrome preference storage is unavailable. Reload the extension and try again.');
    return globalThis.chrome.storage.local;
  }

  async function load() {
    if (extension) return normalize((await storage().get(KEY))[KEY]);
    if (!preview) throw new Error('Terminal preferences require the Chrome extension or a local preview.');
    if (previewStorageAvailable) {
      try {
        const value = globalThis.localStorage?.getItem(KEY);
        if (value) memory = normalize(JSON.parse(value));
      } catch { previewStorageAvailable = false; }
    }
    return { ...memory };
  }

  function save(patch) {
    const update = patch && typeof patch === 'object' && !Array.isArray(patch) ? { ...patch } : {};
    const operation = pending.then(async () => {
      const value = normalize({ ...await load(), ...update });
      if (extension) {
        await storage().set({ [KEY]: value });
      } else {
        memory = value;
        if (previewStorageAvailable) {
          try { globalThis.localStorage?.setItem(KEY, JSON.stringify(value)); } catch { previewStorageAvailable = false; }
        }
        emit(value);
      }
      return { ...value };
    });
    pending = operation.catch(() => {});
    return operation;
  }

  function subscribe(callback) {
    if (typeof callback !== 'function') throw new TypeError('A preference listener must be a function.');
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  if (extension && globalThis.chrome?.storage?.onChanged) {
    globalThis.chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, KEY)) emit(normalize(changes[KEY].newValue));
    });
  } else if (preview) {
    globalThis.addEventListener?.('storage', event => {
      if (!previewStorageAvailable) return;
      if (event.key !== KEY && event.key !== null) return;
      try { memory = normalize(event.newValue ? JSON.parse(event.newValue) : null); emit(memory); } catch { /* Ignore corrupted preview storage events. */ }
    });
  }

  globalThis.CyberdeckSettings = Object.freeze({ defaults, normalize, load, save, subscribe });
})();
