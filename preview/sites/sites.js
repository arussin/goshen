/* The optional local demo loads the exact extension files. It is not proof of installation. */
(() => {
  'use strict';
  const navigation = document.querySelector('.qa-controls');
  for (const [action, label] of [['back', 'Back'], ['forward', 'Forward'], ['slow', 'Slow-load check'], ['parse', 'Slow-DOM check']]) {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.qaAction = action; button.textContent = label;
    navigation?.append(button);
  }
  // Expose only the lifecycle result, so browser checks can distinguish a
  // restored page from a fresh load without inspecting extension internals.
  window.addEventListener('pageshow', event => {
    document.documentElement.dataset.qaRestored = String(event.persisted);
  });
  const slow = Math.min(10000,Math.max(0,Number(new URLSearchParams(location.search).get('slow'))||0));
  if (slow) {
    const root = document.documentElement;
    const output = document.createElement('div');
    output.className = 'qa-status'; output.dataset.qaLoading = '';
    document.querySelector('.qa')?.append(output);
    const showTiming = () => {
      output.textContent = `Loading check: interactive ${root.dataset.qaInteractiveMs || 'pending'} ms / DOM event ${root.dataset.qaDomMs || 'pending'} ms / Goshen ${root.dataset.qaThemeMs || 'pending'} ms / full load ${root.dataset.qaLoadMs || 'pending'} ms. A local image waits ${slow} ms.`;
    };
    const interactive = () => { if (document.readyState !== 'loading' && !root.dataset.qaInteractiveMs) { root.dataset.qaInteractiveMs=String(Math.round(performance.now())); showTiming(); } };
    document.addEventListener('readystatechange', interactive);
    interactive();
    document.addEventListener('DOMContentLoaded', () => { root.dataset.qaDomMs=String(Math.round(performance.now())); showTiming(); }, {once:true});
    window.addEventListener('load', () => { root.dataset.qaLoadMs=String(Math.round(performance.now())); showTiming(); }, {once:true});
    const themeObserver = new MutationObserver(() => {
      if (root.getAttribute('data-gt-universal') === 'true' && !root.dataset.qaThemeMs) {
        root.dataset.qaThemeMs=String(Math.round(performance.now())); showTiming();
      }
    });
    themeObserver.observe(root,{attributes:true,attributeFilter:['data-gt-universal']});
    const signal = document.createElement('img');
    signal.alt=''; signal.width=1; signal.height=1; signal.setAttribute('aria-hidden','true');
    signal.style.cssText='position:absolute;pointer-events:none;opacity:0';
    signal.src=`/preview/slow-signal.svg?ms=${slow}`;
    document.body.append(signal);
    showTiming();
  }
  const originalBody = document.body.innerHTML;
  let added = 0;
  let loading = false;
  const status = message => { const node = document.querySelector('[data-qa-status]'); if (node) node.textContent = message; };
  function loadScript(path) {
    return new Promise((resolve,reject) => { const script = document.createElement('script'); script.src = new URL(path,location.href).href; script.onload = resolve; script.onerror = () => reject(new Error(`Could not load local test file: ${path}`)); document.head.append(script); });
  }
  async function saveOptions() {
    if (!globalThis.CyberdeckSettings) { status('These controls configure the local test. Use the extension popup for an installed extension.'); return; }
    await globalThis.CyberdeckSettings.save({ universalStyle:document.querySelector('[data-qa-style]').value,theme:document.querySelector('[data-qa-theme]').value });
  }
  async function localDemo() {
    if (loading) return;
    if (document.getElementById('goshen-universal-host') && !globalThis.GoshenUniversal) { status('An installed Goshen extension is active. Use its popup; no local demo was loaded.'); return; }
    loading = true; status('Loading the local theme test…');
    try {
      if (!globalThis.CyberdeckSettings) await loadScript('../../extension/settings.js');
      if (!globalThis.GoshenCompanion) await loadScript('../../extension/companion.js');
      if (!globalThis.GoshenGmail) await loadScript('../../extension/gmail.js');
      // This fictional fixture opts into the real classifier only in its local
      // page script. The installed extension keeps its strict Gmail host check.
      if (document.documentElement.dataset.qaProfile === 'gmail') {
        globalThis.GoshenGmail = Object.freeze({ ...globalThis.GoshenGmail, matches: () => true });
      }
      await saveOptions();
      if (!document.getElementById('qa-universal-style')) { const link = document.createElement('link'); link.id = 'qa-universal-style'; link.rel = 'stylesheet'; link.href = new URL('../../extension/universal.css',location.href).href; document.head.append(link); }
      if (!globalThis.GoshenUniversal) await loadScript('../../extension/universal.js');
      await globalThis.GoshenUniversal.enable();
      status('Local theme test active. This checks the shared runtime, not Chrome extension installation.');
    } catch (error) { status(error.message); } finally { loading = false; }
  }
  document.addEventListener('click',event => {
    const button = event.target.closest('[data-qa-action]'); if (!button) return;
    const action = button.dataset.qaAction;
    if (action === 'demo') void localDemo();
    if (action === 'off') { if (globalThis.GoshenUniversal) { globalThis.GoshenUniversal.disable(); status('Local theme test off. Original page appearance restored.'); } else status('No local demo is active. Use the extension popup or its OFF control for an installed extension.'); }
    if (action === 'add') { const card = document.createElement('article'); card.className = 'card'; card.innerHTML = `<div class="card-body"><span class="card-tag">Added now</span><h3>Fresh arrival ${++added}</h3><p>This card was added after the page loaded. Its colors should follow an active terminal theme.</p><a href="#top">Return to the top</a></div>`; document.querySelector('[data-card-list]').append(card); status('A new card was appended to the page.'); }
    if (action === 'rebuild') { const body = document.createElement('body'); body.id = 'top'; body.innerHTML = originalBody; document.body.replaceWith(body); status('The page body was rebuilt. An active companion should recover automatically.'); }
    if (action === 'dialog') document.querySelector('dialog').showModal();
    if (action === 'close-dialog') document.querySelector('dialog').close();
    if (action === 'showcase') document.documentElement.classList.toggle('qa-showcase');
    if (action === 'back') history.back();
    if (action === 'forward') history.forward();
    if (action === 'slow') { const url = new URL(location.href); url.searchParams.set('slow','8000'); location.assign(url); }
    if (action === 'parse') { const url = new URL(location.href); url.searchParams.set('slow','8000'); url.searchParams.set('parse','2400'); location.assign(url); }
  });
  document.addEventListener('change',event => { if (event.target.matches('[data-qa-style],[data-qa-theme]')) void saveOptions().catch(error => status(error.message)); });
  document.addEventListener('submit',event => { if (!event.target.matches('[data-local-form]')) return; event.preventDefault(); status('Demo form checked locally. Nothing was submitted or sent.'); });
})();
