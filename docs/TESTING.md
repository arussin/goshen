# Compatibility and release verification

## 0.3.6 privacy update — submitted for review

The store currently distributes **0.3.5**. The **0.3.6** candidate removes prompt/conversation text inspection, retains optional cross-site following, and adds explicit global removal of optional website access.

Local validation on September 10, 2026: **189 tests — 188 passed, one Windows-specific filename test skipped, zero failures.** All 17 extension files pass package validation. GitHub CI and exact ZIP checks are recorded with the candidate pull request.

Automated coverage includes throwing getters for prompt and response text during startup and later events, generic companion reactions, popup removal feedback, narrower site grants, grant-enumeration failure, required ChatGPT access, delayed permission prompts, stale Follow requests, session restoration, and the existing navigation/OFF boundaries. The release verifier tests exact ZIP/directory equality and rejects changed, extra, missing, linked, or unsupported files.

**Installed-browser verification of 0.3.6 remains unverified.** On September 10, 2026, the maintainer explicitly approved merging PR #1 and submitting 0.3.6 despite the outstanding installed Chrome checks. This waives the gate for this submission; it does not count any unperformed check as passed. The historical 0.3.5 results below do not establish that 0.3.6 or its ZIP passed installation, permission prompts/removal, navigation, popup, ChatGPT, or existing-tab update checks. Refresh open pages after updating to replace earlier injected scripts.

Outstanding installed-browser checks: extract the final 0.3.6 ZIP to a new directory, load it in Chrome, and record:

- [ ] ChatGPT startup, navigation, editable composer, visible generation controls, working/ready transitions, generic HOPPER reactions, and quips/motion disabled.
- [ ] Current-tab themes, same-origin reload/navigation, cross-site Follow, separate-tab isolation, OFF, cached-page restoration, and tab closure.
- [ ] Permission grant, denial and retry with the popup open and closed; delayed grants must not undo OFF or global removal.
- [ ] Global removal with two followed tabs, broad grants, and a single-site grant. Verify optional site access is removed and required ChatGPT access remains.
- [ ] A new deliberate Follow grant after removal, plus worker restart and update with existing tabs.
- [ ] Popup layout, readable success/failure feedback, and all controls fitting or scrolling.
- [x] Exact candidate ZIP reproduction, source-file verification, and configured GitHub CI. The ZIP and extracted directory match all 18 packaged files at source commit `2ec398f61b122e0d7fb7e956c1cb951e7d791f34`; all eight checks across the push/PR runs passed. See the [0.3.6 verification record](releases/v0.3.6-verification.json).

Keep the existing Gmail Chat, Adobe-panel, first-paint, embedded-content, and broader ChatGPT limitations until separately verified. See [source/package verification](VERIFYING.md), [PRIVACY.md](../PRIVACY.md), and the [store guide](WEB-STORE.md).

## Historical 0.3.5 evidence

The following version-specific record is retained as release history.

The previously tested candidate was **0.3.5**. All **153 automated checks**, package validation, and the four-job GitHub CI run pass. The installed Chrome build completed the ChatGPT checks and the ordinary-page activation, navigation, cached-page reactivation, form, color, and HOPPER checks below. Remaining checks are recorded separately. The reported Gmail Chat freeze/blank view remains unresolved.

For the 2026-09-08 installed check, the unpacked extension folder was reloaded and its runtime reported version **0.3.5**. The release ZIP was verified separately; this was not a fresh installation from that ZIP.

The ordinary-page checks used the popup to activate the installed extension on fictional fixtures. The fixture's local theme loader was not used: the page exposed only its own `sites.css` and `sites.js` assets, without the local demo runtime. Form checks used fictional text.

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

GitHub CI passed for source commit [`8aeac9d`](https://github.com/arussin/goshen/commit/8aeac9d5b1f26dd81673ca25ad895770017d4ebe) on Windows and Linux with Node 20 and 22. All four jobs completed successfully, including tests, validation, packaging, and reproducibility checks. [Workflow results](https://github.com/arussin/goshen/actions/runs/34279097053).

The same four jobs also passed for the documentation-only follow-up [`e14dc399`](https://github.com/arussin/goshen/commit/e14dc3990a60cb96b7333b1a8cd13c7e58bbd74b). [Follow-up workflow results](https://github.com/arussin/goshen/actions/runs/34281984290). The preserved 0.3.5 installable and source ZIPs still match their recorded SHA-256 sums; the source ZIP is the original `8aeac9d` snapshot and does not include later testing-note updates.

## Compatibility matrix

| Area | Reproduce and check | Evidence and remaining work |
| --- | --- | --- |
| ChatGPT conversation | Open a fresh chat, type and send a harmless prompt, wait for completion, and open native menus. Keep one terminal shell and an editable composer. | Installed 0.3.5 passed on 2026-09-08: a harmless prompt completed in a temporary chat, the native thinking-effort menu opened, one terminal shell remained, the composer stayed editable, and activity returned from working to ready. The terminal settings panel opened and closed; Green phosphor applied and Amber was restored. Voice, uploads, canvas, and all menus are not covered. |
| Popup controls | Open the popup, inspect status, turn the terminal on, change a setting, then turn it off. | Installed 0.3.5 activation through the popup passed; the in-page OFF control removed the theme. This does not cover every popup setting or status transition. Strict API argument tests pass. |
| Navigation and isolation | Activate Gallery, navigate to Workspace, reload, and open a separate tab. Only the chosen tab should be themed. | Installed 0.3.5 passed: same-site navigation and reload retained the terminal with one host; a separate fixture tab remained unthemed. |
| Cross-site following | Enable follow, exercise grant and denial, navigate to a different site, and confirm an unrelated tab stays off. Retry paused access, then turn follow off. | Installed 0.3.5 followed the chosen tab to a public GitHub page while a separate fixture tab stayed off. Return through Back restored the cached Workspace with its theme and form values. A fresh permission prompt, denial/retry, and turning follow off remain unverified on this candidate; permission logic has automated coverage. |
| OFF and history | Turn a page off, navigate away, and return through Back/reload. It should stay off. Then turn the terminal on for another page in that tab and return to the cached page; both dock and colors should recover. | Installed 0.3.5 passed OFF → navigate to Journal → Back to cached Workspace: the page stayed off and retained form values. Ordinary cached ON restoration also passed. Turning ON in Journal and going Back to the formerly OFF cached Workspace restored one terminal host, dark body/panel colors, and both entered form values. The fixture confirmed cached restoration; this also covers the missing-stylesheet regression. A subsequent OFF survived cached Back and a fresh reload, leaving no terminal host and the native body appearance. |
| Forms and page updates | In Workspace, edit a form, open the native dialog, add a card, rebuild the body, switch styles, and turn the terminal off. Preserve entered text and native controls. | Installed 0.3.5 passed name/note editing, native dialog opening and cancellation, and styling a dynamically added card. Entered text survived page updates, cached history restoration, and OFF. Body replacement and style switching have local coverage but were not repeated in this installed check. |
| Colors and artwork | In Workspace, inspect the nested opaque card, modern-color panel, artwork caption, and explicit-preservation sample. Toggle the theme off. | Installed 0.3.5 darkened the opaque white and modern-color panels, kept the explicit-preservation paper sample unchanged, and restored native panels on OFF. Local checks also cover captions and artwork. Current Adobe check pending. |
| Gallery and article | Inspect SVG artwork, long text, code, links, and horizontal overflow in green and ice themes. | Local visual checks passed; gallery SVG fills stayed unchanged. |
| HOPPER | Pet, collapse, move, and resize it with pointer and keyboard. Test motion/quips off and reduced motion. Keep every control reachable. | Installed 0.3.5 passed headpat reactions, a 40px keyboard move, and a pointer drag of 250px horizontally and 120px vertically. The universal dock had no dock/body scroll overflow at minimum 220×280, default 260×340, and enlarged 360×380 sizes. Collapse to 44px kept OFF reachable; default geometry was restored. On ChatGPT, a headpat changed the rabbit art and quip, and nine lamp elements had active CSS animations. Motion/quips-off and reduced-motion behavior retain automated/local coverage but were not repeated here; these sizes do not establish every site's mobile compatibility. |
| Gmail and embedded Chat | Inspect inbox hierarchy and ordinary controls, then use embedded Chat with the terminal on and off. | Earlier bounded style/container checks passed. Embedded Chat responsiveness and the freeze/blank-view report remain unresolved. No claim that all Gmail lag is fixed. |
| Unsupported pages | Try a Chrome internal page and a protected store page. Expect a clear unsupported state and no injection. | Policy tests pass. Closed shadow roots, cross-origin frames, canvas, and embedded media may remain native. |
| Performance | Run **Slow-load check** and **Slow-DOM check**, then add 500 fictional mail rows while typing and interacting with HOPPER. Check that the page responds and OFF cleans up. | Installed 0.3.5 activated on the delayed-DOM fixture 166ms after the document became interactive, before its delayed image finished loading; one terminal host remained and no local demo style was injected. See the measurements below. The earlier local mail benchmark has not been repeated on this installed candidate; real-site performance remains unverified. |

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

In one controlled installed 0.3.5 **Slow-DOM check** on 2026-09-08, the fixture recorded document interactive and DOM readiness at 2,466ms, the terminal at 2,632ms, and full load at 8,120ms. Activation therefore followed interactive by 166ms and did not wait for the roughly eight-second delayed image. The page had one terminal host and no local demo style. This is a single delayed-fixture measurement, not a first-paint guarantee or a real Gmail benchmark.

The fictional mail benchmark previously themed 504 rows and 6,003 icon paths in 796ms, sampled every 250ms, while typing remained usable. It recorded a 3.2ms maximum scan slice, 25ms maximum additional UI-heartbeat delay, and no scanner errors. These are one local Chromium run's measurements, not performance guarantees or proof about an actual inbox. Re-run the fixture on the release candidate rather than treating those numbers as a threshold.

## Historical 0.3.5 release gates

- [x] Run the complete automated suite and package validation for 0.3.5: 153 passed, no failures or skips; 17 extension files validated.
- [x] Verify the reloaded unpacked 0.3.5 runtime on ChatGPT: completed response, working-to-ready activity, editable composer, native menu, and one stable terminal shell.
- [x] Verify installed ordinary-page popup activation, same-site navigation/reload, cross-site following, separate-tab isolation, forms, color restoration, and HOPPER geometry.
- [x] Verify cached ON restoration and OFF persistence through navigation and Back with form values preserved; verify subsequent OFF also survives a fresh reload.
- [x] Complete ON-on-B → Back-to-cached-OFF-A reactivation on installed 0.3.5; both the dock and colors recovered, with form values preserved.
- [ ] Verify optional permission denial/retry and tab closure cleanup on the installed candidate.
- [x] Measure installed startup on the controlled delayed-DOM fixture; activation preceded completion of the delayed image.
- [ ] Recheck Adobe's neutral panels and repeat the mail interaction benchmark on the installed candidate.
- [x] Explicitly retain the unresolved Gmail Chat limitation in the saved release description; do not advertise it as verified.
- [x] Confirm the release source commit's four-job CI run passed.
- [x] Confirm the final screenshots, privacy disclosures, and compatibility claims match the candidate and recorded test results.

A Web Store listing must not imply broader compatibility than this evidence supports. For conflicts, **FRAME ONLY** and **TERMINAL OFF** remain the user-facing fallback. See the [Web Store release guide](WEB-STORE.md) for listing preparation, [CONTRIBUTING.md](../CONTRIBUTING.md) for packaging, and [PRIVACY.md](../PRIVACY.md) for access and storage disclosures.

The core installed smoke checks for an initial unlisted preview have passed. The preview can explicitly retain the unresolved Gmail Chat report, unverified Adobe panels, brief native first paint, and native rendering in protected or embedded content. It must not claim that these cases, the pending permission paths, or all ChatGPT features have passed. A reproducible failure of activation, OFF, or cached-page reactivation on an otherwise working ordinary page should be fixed before submission.
