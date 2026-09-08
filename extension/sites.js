/* Site policy and packaged adapters. This registry has no page or network access. */
(() => {
  'use strict';
  const adapters = Object.freeze({
    chatgpt: Object.freeze({
      label: 'ChatGPT terminal',
      scripts: Object.freeze(['settings.js', 'companion.js', 'content.js']),
      styles: Object.freeze(['content.css']),
    }),
    universal: Object.freeze({
      label: 'Universal terminal',
      scripts: Object.freeze(['settings.js', 'companion.js', 'gmail.js', 'universal.js']),
      styles: Object.freeze(['universal.css']),
    }),
  });

  function resolve(address) {
    let url;
    try { url = new URL(address); } catch { return { mode: 'unsupported', host: 'This page', reason: 'Open a website, then choose TERMINAL ON.' }; }
    const host = url.hostname || 'This page';
    if (!['https:', 'http:'].includes(url.protocol)) {
      return { mode: 'unsupported', host, reason: 'Chrome does not allow the terminal on browser pages, extension pages, or local files.' };
    }
    if (host === 'chromewebstore.google.com' || (host === 'chrome.google.com' && /^\/webstore(?:\/|$)/.test(url.pathname))) {
      return { mode: 'unsupported', host, reason: 'Chrome protects the extension store from page modifications.' };
    }
    const tailored = url.protocol === 'https:' && ['chatgpt.com', 'chat.openai.com'].includes(host);
    return { mode: tailored ? 'chatgpt' : 'universal', host, origin: url.origin };
  }

  globalThis.GoshenSites = Object.freeze({ adapters, resolve });
})();
