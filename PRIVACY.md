# Goshen Terminal privacy

Goshen Terminal changes the appearance of browser pages locally. It does not operate a server, send analytics, or transmit page content.

Goshen Terminal's use of user data complies with the Chrome Web Store User Data Policy, including its [Limited Use requirements](https://developer.chrome.com/docs/webstore/program-policies/limited-use). Data is used only for the local appearance and activity features described in this policy. It is not sold, used for advertising or credit decisions, or transferred to third parties.

## When the extension can access a page

The dedicated ChatGPT content script is declared only for `https://chatgpt.com/*` and `https://chat.openai.com/*`. Its saved enabled preference controls whether it applies the ChatGPT skin.

On other websites, universal mode starts after you invoke Goshen Terminal and activate the current tab. Chrome's temporary `activeTab` access and `scripting` API allow packaged scripts and styles to be applied to that tab's main frame. A session-only tab record lets Goshen reapply after same-origin navigation or reload while access remains available. Navigation to another origin pauses the default behavior.

**Follow this tab across sites** requests the optional host patterns `http://*/*` and `https://*/*` through Chrome's permission prompt. They are not granted at installation. After approval, only tabs with their own enabled follow setting receive automatic reapplication on other supported sites. The extension does not request browsing-history access or inject into cross-origin frames. Browser-protected pages remain unsupported.

The popup sends the explicit follow choice to the worker before requesting permission, so closing the popup does not lose that choice. If the popup closes and permission is denied or remains unavailable, the saved choice can stay paused; **ALLOW WEBSITE ACCESS** lets you retry. A saved choice is not a grant. Other-site injection still checks Chrome's actual permission, and OFF clears the tab's choice even if a permission response arrives later. No additional fields are stored for this flow.

The popup and background worker inspect the current tab's address to choose an adapter and reject unsupported pages. Only its origin (scheme, hostname, and port), tab ID, and follow flag enter session storage. Full paths, query strings, fragments, page titles, and browsing history are not stored or transmitted.

## What the page scripts inspect

The ChatGPT adapter identifies the sidebar, conversation, composer, visible message elements, and visible generation controls. It counts visible messages and temporarily checks the length of visible assistant text to detect incoming text. A short check of composer keywords can choose a preset rabbit remark about greetings, thanks, coding, coffee, or creativity. Only that category is passed to the companion; prompt text and categories are not saved or sent elsewhere.

Universal mode identifies page elements to apply conservative visual styling. Its companion reacts to interaction events such as typing or submitting a form without reading the field's typed text. It does not infer a model's state or interpret arbitrary website content.

On Gmail, a local appearance helper checks structural roles/classes and computed colors to distinguish navigation, search, inbox rows, and small monochrome control glyphs. It does not read message text, senders, subjects, or recipient addresses. Embedded Chat frames remain outside the treatment.

Neither mode sends prompts, generates answers, intercepts website requests, exports content, or stores conversation text. The original website continues to operate under its own privacy terms. Decorative light panels and rabbit poses are not measurements of hidden processing.

## Saved information

Appearance preferences are stored in `chrome.storage.local` under the existing `cyberdeck.settings` key. Keeping that key preserves settings from earlier versions. Preferences include automatic ChatGPT enablement, theme, layout, scanlines, glow, animation, rabbit quips, following system reduced motion, text size, and the universal treatment style. They are not synchronized through Chrome sync.

Active tab records are stored under `goshen.tab-intents` in `chrome.storage.session`, not local or sync storage. Each record contains a tab ID, one origin, and a boolean follow setting. OFF/EXIT and tab closure clear the relevant record. Chrome clears session storage when the extension is disabled, reloaded, or updated, and when the browser restarts. This is an active-tab list for the current session, not a browsing-history log. See [Chrome's session-storage documentation](https://developer.chrome.com/docs/extensions/reference/api/storage#property-session).

Visible activity, elapsed session time, companion pose, preset remarks, and the companion window's position and size are transient page state. Window geometry remains in memory for the current document only.

Scanner diagnostics keep aggregate counts, queue sizes, errors, and elapsed processing times in page memory. They do not contain field values, messages, or element text and are not saved or transmitted. Navigation readiness checks keep temporary document IDs, random request tokens, tab generations, and retry state in memory without changing the stored tab-record fields. A one-shot readiness signal carries its token between the extension's isolated page script and local worker, not to a network service.

The optional local preview stores appearance preferences in browser local storage, falling back to session memory if unavailable. Preview conversations are simulated and separate from ChatGPT.

## Permissions and packaged code

| Permission | Purpose |
| --- | --- |
| `storage` | Save appearance preferences locally and active tab intent in session memory |
| `activeTab` | Obtain temporary access to the tab where you invoke the extension |
| `scripting` | Apply and remove packaged scripts/styles for that chosen tab |
| Optional `http://*/*`, `https://*/*` | Follow explicitly enabled tabs across sites, only after a Chrome permission prompt |

A local service worker coordinates these actions and watches navigation loading, URL changes, and completion for tabs with active intent. A not-yet-ready document can notify it when parsing reaches an interactive state; sender/document/token validation and a fresh permission check are required before activation. OFF invalidates the pending attempt. Readiness notifications and retries add no permissions. The extension has no analytics, advertising, remote scripts, remote fonts, external network calls, API keys, or tracking cookies. ChatGPT is the only declarative automatic content-script scope; universal reapplication is limited by the tab's active intent and available permissions.

## Control and removal

Disable automatic ChatGPT styling through its power control, which also clears the current tab's intent. Use **TERMINAL OFF** or the companion's **OFF** control to remove universal styling and clear that tab's intent. Closing a tab also clears its record. Turning off **Follow this tab across sites** limits that tab to its current origin; Chrome's broader permission grant may remain until you remove website access in the extension's Chrome settings.

While a theme is off, its activity timers and observers stop. A lightweight page-restoration listener remains until the runtime is destroyed; it can ask the worker whether an enabled tab may resume, but does not restore a cleared tab intent or read page content. For an eligible universal page, the worker reinstates any missing packaged styles through its normal permission-checked activation path, targeting only the sender's exact document. This restores appearance without adding permissions, stored fields, or page-content collection.

Turn off **Rabbit quips** to hide companion remarks, and **Ambient animation** to stop continuous decorative motion. Reset restores default appearance preferences.

Remove the extension on `chrome://extensions` to uninstall it and remove its extension storage. Clear the preview site's browser data to remove its separate preferences.

Goshen Terminal is an independent project and is not affiliated with OpenAI or Google.
