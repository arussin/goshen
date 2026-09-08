# Compatibility and release verification

The current candidate is **0.3.5**. All **153 automated checks** and package validation pass. Its installed-extension retest remains pending, and the reported Gmail Chat freeze/blank view is unresolved.

A passed local fixture checks the shared styling runtime. It does not establish that Chrome's installed-extension activation, permissions, or navigation behave correctly. Earlier installed-build results are useful evidence, but do not replace the current release checks below.

## Run the checks

Use Node.js 20 or newer; no dependency installation is needed.

```sh
npm test
npm run validate
npm run preview
```

Open the [fixture gallery](http://127.0.0.1:4173/preview/sites/index.html) after starting the preview server. Use its navigation to reach Workspace and Journal, or open the [fictional mail fixture](http://127.0.0.1:4173/preview/sites/mail.html). The [ChatGPT preview](http://127.0.0.1:4173/preview/index.html) uses simulated conversations.

For an installed-extension check, load `extension` in Chrome and activate it from its popup. Leave the fixture's **Load local theme** button untouched. Record the extension version, Chrome version, operating system, viewport, selected theme/style, and result. Use fictional data for forms and screenshots.

The configured CI matrix covers Windows and Linux with Node 20 and 22. Confirm the actual workflow results before a release; configuration alone is not a passing run.

## Compatibility matrix

| Area | Reproduce and check | Evidence and remaining work |
| --- | --- | --- |
| ChatGPT conversation | Open a fresh chat, type and send a harmless prompt, wait for completion, and open native menus. Keep one terminal shell and an editable composer. | A completed response and stable shell passed on an earlier installed build; current 0.3.5 retest pending. Voice, uploads, canvas, and all menus are not covered. |
| Popup controls | Open the popup, inspect status, turn the terminal on, change a setting, then turn it off. | Strict API argument tests pass. Current installed status/enable/disable check pending. |
| Navigation and isolation | Activate Gallery, navigate to Journal, reload, and open a separate tab. Only the chosen tab should be themed. | Earlier installed checks passed; current release retest pending. |
| Cross-site following | Enable follow, exercise grant and denial, navigate to a different site, and confirm an unrelated tab stays off. Retry paused access, then turn follow off. | Granted following and isolation passed on an earlier installed build. Current grant/denial/retry checks pending; permission logic has automated coverage. |
| OFF and history | Turn a page off, navigate away, and return through Back/reload. It should stay off. Then turn the terminal on for another page in that tab and return to the cached page; both dock and colors should recover. | OFF through history passed earlier. The missing-stylesheet regression has automated coverage; current installed cached-page restoration is pending. |
| Forms and page updates | In Workspace, edit a form, open the native dialog, add a card, rebuild the body, switch styles, and turn the terminal off. Preserve entered text and native controls. | Local checks passed for interaction, dynamic styling, recovery, and removal. |
| Colors and artwork | In Workspace, inspect the nested opaque card, modern-color panel, artwork caption, and explicit-preservation sample. Toggle the theme off. | Local checks passed: neutral panels theme, captions and explicit samples retain native colors, and OFF restores original values. Current Adobe check pending. |
| Gallery and article | Inspect SVG artwork, long text, code, links, and horizontal overflow in green and ice themes. | Local visual checks passed; gallery SVG fills stayed unchanged. |
| HOPPER | Pet, collapse, move, and resize it with pointer and keyboard. Test motion/quips off and reduced motion. Keep every control reachable. | Automated and local geometry checks passed at default, minimum, enlarged, and compact sizes. A small viewport check does not cover every site's mobile layout. |
| Gmail and embedded Chat | Inspect inbox hierarchy and ordinary controls, then use embedded Chat with the terminal on and off. | Earlier bounded style/container checks passed. Embedded Chat responsiveness and the freeze/blank-view report remain unresolved. No claim that all Gmail lag is fixed. |
| Unsupported pages | Try a Chrome internal page and a protected store page. Expect a clear unsupported state and no injection. | Policy tests pass. Closed shadow roots, cross-origin frames, canvas, and embedded media may remain native. |
| Performance | Run **Slow-load check**, then add 500 fictional mail rows while typing and interacting with HOPPER. Check that the page responds and OFF cleans up. | Local runtime checks passed; current installed startup and real-site performance remain unverified. |

## Automated regression coverage

| Boundary | Required behavior |
| --- | --- |
| Chrome API arguments | Each injected argument must serialize correctly; absent optional values must not cross the API as `undefined`. |
| Cached-page restoration | Restore missing CSS through the queued activation path before confirming success; require the sender's exact document, current intent, and permission. |
| OFF and navigation races | Late replies, stale documents, tab replacement, and pending readiness signals cannot undo OFF or activate the wrong document. |
| Permissions and storage | Follow choices remain separate from Chrome grants; retained state contains only the documented preferences and tab intent fields. |
| Native appearance | Preserve excluded content and its ink, theme eligible neutral child panels, retain unsupported color spaces, and remove owned changes on disable. |
| Work limits | Batch style reads/writes, reduce work during interaction, and pause scanning/activity while hidden. |
| Packaging | Validate local assets and scope, check JavaScript syntax, and produce deterministic ZIP bytes without overwriting a different same-version archive. |

## Loading and performance expectations

A brief native or white/light background during loading is expected. Goshen waits for a document it can inspect and style; the theme is not guaranteed to appear before the browser's first paint.

The fictional mail benchmark previously themed 504 rows and 6,003 icon paths in 796ms, sampled every 250ms, while typing remained usable. It recorded a 3.2ms maximum scan slice, 25ms maximum additional UI-heartbeat delay, and no scanner errors. These are one local Chromium run's measurements, not performance guarantees or proof about an actual inbox. Re-run the fixture on the release candidate rather than treating those numbers as a threshold.

## Current release gates

- [x] Run the complete automated suite and package validation for 0.3.5: 153 passed, no failures or skips; 17 extension files validated.
- [ ] Install the exact 0.3.5 distributable in Chrome and complete the popup, ChatGPT, navigation, and cached-page checks above.
- [ ] Verify optional permission denial/retry, tab closure cleanup, and isolation on the installed candidate.
- [ ] Recheck Adobe's neutral panels and current installed startup behavior.
- [ ] Resolve or explicitly retain the Gmail Chat limitation in the release description; do not advertise it as verified.
- [ ] Confirm the release commit's CI results and that its screenshots, privacy disclosures, and compatibility claims match the candidate.

A Web Store listing must not imply broader compatibility than this evidence supports. For conflicts, **FRAME ONLY** and **TERMINAL OFF** remain the user-facing fallback. See the [Web Store release guide](WEB-STORE.md) for listing preparation, [CONTRIBUTING.md](../CONTRIBUTING.md) for packaging, and [PRIVACY.md](../PRIVACY.md) for access and storage disclosures.
