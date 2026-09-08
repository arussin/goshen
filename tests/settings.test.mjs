import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../extension/settings.js', import.meta.url), 'utf8');
const key = 'cyberdeck.settings';
const expectedDefaults = {
  enabled: true, theme: 'amber', layout: 'deck', universalStyle: 'terminal', scanlines: 18,
  glow: 35, motion: true, quips: true, respectReducedMotion: false, fontSize: 15,
};
const plain = (value) => JSON.parse(JSON.stringify(value));
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

function environment({ initial, extension = true, malformed = false, blocked = false, writeBlocked = false } = {}) {
  const listeners = new Set();
  const pageListeners = new Map();
  const state = {
    data: initial ? { [key]: plain(initial) } : {},
    writes: [],
    localReads: 0,
    localWrites: 0,
    failGet: false,
    failSet: false,
  };
  const runtime = { id: 'local-test-extension' };
  const notify = (changes, area = 'local') => {
    for (const listener of listeners) listener(plain(changes), area);
  };
  function asyncStorage(callback, action, fail) {
    if (!callback) return Promise.resolve().then(() => {
      if (fail) throw new Error('Storage unavailable');
      return action();
    });
    queueMicrotask(() => {
      if (fail) runtime.lastError = { message: 'Storage unavailable' };
      try { callback(fail ? undefined : action()); }
      finally { delete runtime.lastError; }
    });
    return undefined;
  }
  const chrome = {
    runtime,
    storage: {
      local: {
        get(request, callback) {
          return asyncStorage(callback, () => plain(state.data), state.failGet);
        },
        set(values, callback) {
          return asyncStorage(callback, () => {
            const oldValue = state.data[key];
            Object.assign(state.data, plain(values));
            state.writes.push(plain(values));
            queueMicrotask(() => notify({ [key]: { oldValue, newValue: state.data[key] } }));
          }, state.failSet);
        },
      },
      onChanged: {
        addListener(listener) { listeners.add(listener); },
        removeListener(listener) { listeners.delete(listener); },
      },
    },
  };
  let localValue = malformed ? '{invalid' : (initial ? JSON.stringify(initial) : null);
  const context = vm.createContext({
    console, Promise, setTimeout, clearTimeout, queueMicrotask,
    location: { protocol: 'http:', hostname: 'localhost' },
    ...(extension ? { chrome } : {}),
    localStorage: {
      getItem() {
        state.localReads++;
        if (blocked) throw new Error('Browser storage disabled');
        return localValue;
      },
      setItem(storageKey, value) {
        state.localWrites++;
        if (blocked || writeBlocked) throw new Error('Browser storage disabled');
        localValue = value;
      },
    },
    addEventListener(name, listener) {
      if (!pageListeners.has(name)) pageListeners.set(name, new Set());
      pageListeners.get(name).add(listener);
    },
    removeEventListener(name, listener) { pageListeners.get(name)?.delete(listener); },
  });
  context.window = context;
  vm.runInContext(source, context, { filename: 'settings.js' });
  return { settings: context.CyberdeckSettings, state, notify, pageListeners,
    reinject() { vm.runInContext(source, context); return context.CyberdeckSettings; },
    listenerCount: () => listeners.size,
  };
}

test('missing and malformed preferences produce the usable default deck', () => {
  const { settings } = environment();
  assert.deepEqual(plain(settings.defaults), expectedDefaults);
  for (const input of [undefined, null, false, 12, 'green', []]) {
    assert.deepEqual(plain(settings.normalize(input)), expectedDefaults);
  }
});

test('normalization keeps supported choices and explicit off values, ignoring unknown data', () => {
  const { settings } = environment();
  const result = plain(settings.normalize({
    enabled: false, motion: false, quips: false, respectReducedMotion: true, theme: 'ice', layout: 'focus', universalStyle: 'frame',
    scanlines: 0, glow: 0, fontSize: 20, conversation: 'must not persist',
  }));
  assert.deepEqual(result, {
    enabled: false, motion: false, quips: false, respectReducedMotion: true, theme: 'ice', layout: 'focus', universalStyle: 'frame',
    scanlines: 0, glow: 0, fontSize: 20,
  });
  assert.deepEqual(plain(settings.normalize({ theme: 'bogus', layout: 'bogus', universalStyle: 'bogus', enabled: 'false', motion: {}, quips: 'false', respectReducedMotion: 'true' })), expectedDefaults);
});

test('reinjecting shared preferences preserves one API and one storage listener', () => {
  const env = environment();
  assert.equal(env.reinject(), env.settings);
  assert.equal(env.reinject(), env.settings);
  assert.equal(env.listenerCount(), 1);
});

test('display controls cannot escape their safe ranges or inject CSS values', () => {
  const { settings } = environment();
  const low = settings.normalize({ scanlines: -100, glow: -100, fontSize: -100 });
  assert.equal(low.scanlines, 0);
  assert.equal(low.glow, 0);
  assert.equal(low.fontSize, 13);
  const high = settings.normalize({ scanlines: 1000, glow: 1000, fontSize: 1000 });
  assert.equal(high.scanlines, 40);
  assert.equal(high.glow, 60);
  assert.equal(high.fontSize, 20);
  for (const invalid of [NaN, Infinity, 'url(https://invalid.test)', {}]) {
    const values = settings.normalize({ scanlines: invalid, glow: invalid, fontSize: invalid });
    assert.equal(values.scanlines, expectedDefaults.scanlines);
    assert.equal(values.glow, expectedDefaults.glow);
    assert.equal(values.fontSize, expectedDefaults.fontSize);
  }
});

test('loading and saving Chrome preferences keeps unrelated settings and stores no unknown fields', async () => {
  const { settings, state } = environment({ initial: { ...expectedDefaults, theme: 'green', glow: 21 } });
  assert.equal((await settings.load()).theme, 'green');
  const saved = await settings.save({ layout: 'focus', conversation: 'private text' });
  assert.equal(saved.layout, 'focus');
  assert.equal(saved.theme, 'green');
  assert.equal(saved.glow, 21);
  assert.deepEqual(state.data[key], plain(saved));
  assert.deepEqual(Object.keys(state.writes.at(-1)), [key]);
  assert.deepEqual(Object.keys(state.data[key]).sort(), Object.keys(expectedDefaults).sort());
  assert.equal(state.localReads + state.localWrites, 0, 'The extension must not expose preferences through host-page localStorage');
});

test('existing installations retain their appearance when new preferences are introduced', async () => {
  const { settings, state } = environment({ initial: {
    enabled: true, theme: 'green', layout: 'focus', scanlines: 0,
    glow: 12, motion: false, fontSize: 18,
  } });
  const loaded = await settings.load();
  assert.equal(loaded.quips, true);
  assert.equal(loaded.respectReducedMotion, false);
  assert.equal(loaded.motion, false, 'An existing choice to disable motion must remain disabled');
  await settings.save({ quips: false, respectReducedMotion: true });
  assert.deepEqual(state.data[key], {
    enabled: true, theme: 'green', layout: 'focus', universalStyle: 'terminal', scanlines: 0,
    glow: 12, motion: false, quips: false, respectReducedMotion: true, fontSize: 18,
  });
});

test('simultaneous same-context control changes do not overwrite each other', async () => {
  const { settings, state } = environment();
  await settings.load();
  await Promise.all([
    settings.save({ theme: 'green' }),
    settings.save({ glow: 12 }),
    settings.save({ layout: 'focus' }),
  ]);
  assert.equal(state.data[key].theme, 'green');
  assert.equal(state.data[key].glow, 12);
  assert.equal(state.data[key].layout, 'focus');
});

test('external settings updates are normalized, other storage keys ignored, and unsubscribe works', async () => {
  const { settings, notify } = environment();
  await settings.load();
  const events = [];
  const unsubscribe = settings.subscribe((value) => events.push(plain(value)));
  notify({ unrelated: { newValue: 5 } });
  notify({ [key]: { newValue: { ...expectedDefaults, theme: 'ice', glow: 100 } } }, 'sync');
  assert.equal(events.length, 0);
  notify({ [key]: { newValue: { ...expectedDefaults, theme: 'ice', glow: 100 } } });
  await nextTurn();
  assert.equal(events.length, 1);
  assert.equal(events[0].theme, 'ice');
  assert.equal(events[0].glow, 60);
  unsubscribe();
  notify({ [key]: { newValue: expectedDefaults } });
  await nextTurn();
  assert.equal(events.length, 1);
});

test('preview survives malformed or disabled browser storage', async () => {
  for (const options of [{ malformed: true }, { blocked: true }]) {
    const { settings } = environment({ extension: false, ...options });
    assert.deepEqual(plain(await settings.load()), expectedDefaults);
    const result = await settings.save({ theme: 'green' });
    assert.equal(result.theme, 'green');
    assert.equal((await settings.load()).theme, 'green');
  }
});

test('Chrome storage failures are reported without using page storage, and a later save can recover', async () => {
  const { settings, state } = environment();
  state.failGet = true;
  await assert.rejects(settings.load(), /Storage unavailable/);
  state.failGet = false;
  state.failSet = true;
  await assert.rejects(settings.save({ theme: 'green' }), /Storage unavailable/);
  assert.equal(state.writes.length, 0);
  assert.equal(state.localReads + state.localWrites, 0);
  state.failSet = false;
  assert.equal((await settings.save({ layout: 'focus' })).layout, 'focus');
  assert.equal(state.data[key].theme, 'amber', 'A failed theme change must not be reported as persisted');
});

test('preview retains session changes when reads work but persistence is blocked', async () => {
  const { settings } = environment({ extension: false, initial: expectedDefaults, writeBlocked: true });
  assert.equal((await settings.load()).theme, 'amber');
  await settings.save({ theme: 'green' });
  assert.equal((await settings.load()).theme, 'green');
  await settings.save({ layout: 'focus' });
  const latest = await settings.load();
  assert.equal(latest.theme, 'green');
  assert.equal(latest.layout, 'focus');
});
