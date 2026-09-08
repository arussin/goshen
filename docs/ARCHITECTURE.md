# Architecture

Goshen Terminal is a dependency-free Chrome Manifest V3 extension. It has two adapters and a shared appearance/companion layer. The original website stays responsible for content, navigation, forms, and network requests.

## Components

| File | Responsibility |
| --- | --- |
| `extension/manifest.json` | ChatGPT-only declarative registration, popup, worker, current-tab permissions, and optional HTTP/HTTPS hosts |
| `extension/background.js` | User-requested tab activation/removal, session intent, navigation recovery, and local asset injection |
| `extension/sites.js` | Shared site classification and supported-page policy, imported locally by the worker |
| `extension/settings.js` | Defaults, normalization, local persistence, and change subscriptions |
| `extension/companion.js` | Bounded HOPPER sprite frames and prewritten dialogue from activity/category inputs |
| `extension/content.js`, `content.css` | Dedicated ChatGPT adapter, shell, native element marks, and loading indicators |
| `extension/universal.js`, `universal.css` | Conservative generic page treatment, terminal/frame styles, and event-driven companion |
| `extension/gmail.js` | Gmail-only structural/color helper for surface hierarchy and small monochrome control glyphs |
| `extension/popup.*` | Current-tab actions and shared appearance controls |
| `preview/` | Local demonstration fixtures with simulated activity |
| `scripts/validate.mjs` | Package resource, permission, scope, and executable-code checks |
| `scripts/package.mjs` | Portable deterministic ZIP creation using Node built-ins |
| `scripts/generate-icons.mjs` | Reproducible PNGs from the original 5 × 7 pixel-G terminal mark |

## Activation boundary

ChatGPT's adapter is a declarative content script on `chatgpt.com` and `chat.openai.com`. It reads the saved enabled preference to decide whether to apply the skin. It restores its own frame when ChatGPT rebuilds the page, while retaining the original page nodes.

Universal mode starts on a user-requested current tab. The popup asks the local worker to apply or remove packaged scripts and CSS. `sites.js` classifies supported ordinary web pages and chooses the adapter. The worker remembers active tab intent and reapplies after same-origin navigation or reload while Chrome access remains available. Its declared ChatGPT matches provide ongoing access on those two hosts. Chrome's initial access model is described in [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab); injection details are in [chrome.scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting).

Navigation recovery begins on loading or URL changes instead of waiting for every resource to finish. The worker waits for a usable committed document, uses `injectImmediately` in the isolated world, and pins subsequent operations to the inspected document ID. It rejects the previous document during a pending navigation. If a probe arrives before readiness, it installs a one-shot notifier in the isolated world for `readystatechange` and `DOMContentLoaded`. The worker accepts a signal only when its random token, sender tab/document, and tab generation match the pending attempt; normal permission checks run again before activation. OFF cancels eligibility, and page exit removes the local notifier.

The approximately 3.74-second bounded retry schedule remains a fallback, followed by later URL/completion events. Classification still waits until the document is interactive with a body, avoiding cached color decisions before initial styles are ready. The readiness event removes the need to wait for the next scheduled probe; this is not a guarantee of installed-extension timing. These changes add no permissions or persistent/session-storage fields.

Optional cross-site following declares exactly `http://*/*` and `https://*/*`. The popup requests these only from the user's follow-toggle gesture. The worker requires both a permission grant and that particular tab's follow flag before applying on a different origin. A grant alone never enables every tab. Protected pages or lost permissions pause reapplication. Scripts stay in the isolated main frame; cross-origin frames remain outside this adapter's scope.

The popup sends explicit follow intent to the worker before opening Chrome's permission prompt, without waiting for the permission result to persist that intent. Chrome may close the popup during the prompt. A denied or unavailable grant can therefore leave the selected follow choice paused; the popup exposes **ALLOW WEBSITE ACCESS** for a new user-initiated request. A permission-added event resumes only existing selected tab intents through the ordinary permission checks. Late prompt results never recreate an intent cleared by OFF. This flow uses the existing origin and follow boolean without adding stored fields.

## Settings and state

`globalThis.CyberdeckSettings` remains the shared classic-script API for compatibility with earlier releases. It exposes `defaults`, `normalize`, asynchronous `load`/`save`, and `subscribe`. The `cyberdeck.settings` key remains unchanged. Only supported fields and bounded values are persisted in Chrome's local extension storage.

`enabled` controls automatic ChatGPT styling. It is not a saved list of universally enabled sites. Theme, motion, quips, glow, and related appearance preferences are shared. `universalStyle` selects `terminal` or `frame`; `layout` selects the ChatGPT instrument-rail arrangement.

`goshen.tab-intents` in `chrome.storage.session` stores active tab IDs with one origin and a cross-site-follow boolean. Origins are normalized without URL paths, query strings, or fragments. OFF/EXIT and tab closure clear intent; the ChatGPT power control also clears the current tab's intent. Session storage survives service-worker restarts but is cleared by browser restart or extension disable/reload/update. It is not a persistent website history or appearance setting. Navigation work is serialized per tab and pinned to an inspected document; cancellation and generation checks prevent late activation from undoing OFF or targeting a replacement document. `tabs.onReplaced` transfers eligible intent to Chrome's replacement tab ID.

On a persisted `pageshow`, each adapter asks the worker whether its restored document is still eligible. The worker scopes that request to the trusted content-script sender's tab and main frame, verifies the current origin and permissions, and rechecks cancellation before replying. Page-supplied tab IDs cannot select another tab. A single lightweight `pageshow` listener remains while the theme is off to handle restored documents; activity timers, observers, and interaction handlers stop. Runtime destruction also removes that listener.

For a universal page, the restore request also requires Chrome's sender document ID and runs through the queued activation path pinned to that exact document. This reinstalls any missing packaged CSS before confirming that the page is active; a cached runtime alone is insufficient. Intent, permissions, and operation generation are checked again, so OFF, navigation, or a stale sender cannot revive the wrong page. The existing stylesheet-removal path remains unchanged. ChatGPT's restore query remains an eligibility check for its dedicated adapter.

The ChatGPT adapter's initial preference load also checks its lifecycle revision before applying, so an older load cannot invalidate a newer restored-page decision.

Page-local state includes observer targets, extension-owned nodes, timer handles, selected companion pose, activity, universal activation, and companion-window geometry. Dragging the title bar moves the window; dragging its grip resizes it. Both controls support arrow keys, larger Shift increments, and Home resets. Position and size remain in the current document's memory only. Teardown must release active resources and remove owned changes without removing native content.

## Companion and activity

The companion accepts normalized activity events and returns text art, a mood label, and an optional preset quip. It does not call an AI service. Generic pages provide interaction events without reading typed field content.

The ChatGPT adapter can derive a small keyword category from the composer and inspect visible controls and answer-text length for activity. Raw prompt text is not passed to the companion or stored. Visible thinking labels and remounted old messages must not be mistaken for new answer text. Activity indicators describe observable UI behavior, not hidden model processing.

Animation uses the master motion setting and optional system reduced-motion following. Quip visibility and occasional rotation are independent of sprite motion. Controls must retain readable state when animation is disabled.

## DOM and CSS boundaries

Adapters add extension-owned chrome and narrowly scoped markers rather than replacing or moving native application nodes. Generic styles keep the native layout intact. The frame treatment offers a lighter alternative where broader surface styling conflicts with a page.

An image-backed region keeps its artwork and transparent captions native, but an opaque neutral child panel forms a new surface and can receive terminal colors. Explicit `data-gt-preserve` regions, protected media/semantic regions, and Gmail message content remain excluded throughout their subtree. When content stays native, its original ink is retained so an ancestor's themed text color cannot wash it out.

Color parsing accepts legacy and modern RGB/RGBA, numeric or percentage channels/alpha, and `color(srgb)`. It also recognizes exact neutrals in supported linear/P3 and Lab/LCH families: equal channels or zero chroma/opponent coordinates, as appropriate. Colored wide-gamut or perceptual values and unknown functions remain native; there is no arbitrary gamut conversion.

Closed shadow roots, canvas-rendered interfaces, cross-origin frames, protected browser pages, and media can remain outside the treatment. Do not work around those limits by escalating to all-site access or overriding page security.

The generic adapter loads a local Gmail helper but only uses its classifier on the Gmail mail surface. The helper examines roles/classes and computed colors, preserving inbox read/unread/selected hierarchy and adjusting eligible small monochrome SVG control glyphs. It excludes message-body graphics, color logos, gradient/reference paints, and embedded Chat. It does not inspect mail text. The synthetic mail fixture contains fictional content and does not connect to an account.

Generic scanning coalesces overlapping subtrees and schedules its first pass after 1ms. Each pass groups computed-style reads before applying its marker writes. The normal classification budget is up to 256 nodes or 6ms; during interaction it falls to 24 nodes or 2ms, with additional yielding between passes. These are loop budgets, not hard wall-clock guarantees for individual style queries or the following writes. Hidden pages pause scans and activity timers. Local diagnostic counters track work, queue sizes, errors, and elapsed slices without collecting element text; they remain in page memory.

## Build and validation

No bundler is required. Chrome loads the source files directly. Node's built-in test runner exercises state, lifecycle, permissions, and packaging. Validation resolves declarative and dynamic assets and rejects remote code/network primitives or unnecessarily broad permissions.

The ZIP packager sorts paths, uses UTF-8 names and a fixed DOS timestamp, includes CRC32 values, and writes stored entries without compression. It collects only `extension` plus root `LICENSE` and optional `NOTICE`. Existing same-version archives are reused only when the bytes match. This keeps local releases reviewable and reproducible across operating systems.

These checks cannot establish universal website compatibility. Release notes should distinguish automated checks, local fixtures, actual installed-extension tests, and unverified views.
