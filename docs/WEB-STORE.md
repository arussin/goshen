# Chrome Web Store release guide

## 0.3.6 privacy candidate — not submitted

The store currently distributes **0.3.5**. The candidate retains optional cross-site following, removes prompt and answer-text inspection, and adds **REMOVE CROSS-SITE ACCESS**. Automatic ChatGPT styling and ordinary per-tab themes remain available. HOPPER keeps generic event reactions; keyword-specific remarks and response-length-based activity are removed.

Complete the candidate checks in [TESTING.md](TESTING.md), including an installed copy extracted from the exact ZIP, before uploading 0.3.6. Preserve the existing 0.3.5 ZIP. Reproduce the candidate ZIP twice, compare it with [the verifier](VERIFYING.md), and record the final source commit and SHA-256. The [0.3.5 verification record](releases/v0.3.5-verification.json) connects its preserved upload ZIP to exact source bytes; it does not verify Google's installed build.

The separately saved 0.3.5 description edit adds only the MIT/open-source disclosure and source links. A saved dashboard draft is not a submitted or published listing change.

### Candidate description additions and replacement

Add after the opening paragraph:

> Open source under the MIT License. Inspect the source code and privacy design at https://github.com/arussin/goshen. Select the source tag matching your installed version; development branches may contain unreleased changes.

Replace 0.3.5's local text-check sentence only when the 0.3.6 package is submitted:

> Goshen runs locally without analytics, remote code, or an AI service of its own. It does not read your typed prompts or conversation text. It uses page structure, visible controls, and interaction events for styling and decorative reactions. Appearance preferences stay on your device. Active tab origins and follow choices remain in browser-session storage.

Extend the optional Follow bullet:

> Optionally enable Follow this tab across sites. Chrome requests access to all ordinary HTTP/HTTPS websites; Goshen automatically follows only the tabs where you enable this option. Remove cross-site access revokes that optional access for every tab. Automatic ChatGPT access is separate.

Retain all existing compatibility limitations. Do not claim open source, a checksum, or passing automated tests proves the extension is safe.

### Candidate privacy and reviewer updates

The manifest retains `storage`, `activeTab`, `scripting`, automatic ChatGPT matches, and optional HTTP/HTTPS host patterns. Follow still needs the user's Chrome permission grant. Its per-tab behavior does not narrow the underlying browser permission. Turning an individual Follow choice off leaves the permission in place; the separate global removal action requests revocation and verifies no optional website grants remain, including narrower site grants.

Update the website-content explanation to structural elements, computed colors, visible controls, and interaction events. Remove the old prompt-keyword and answer-length explanations for this candidate. The current tab address still selects an adapter; explicit global removal also checks currently followed tabs' addresses to limit their records to current origins. Full addresses are not stored. Review each dashboard category against its current definition and the exact candidate policy; do not infer “no user data” from local-only processing.

Ask reviewers to enable Follow on two tabs, remove cross-site access, confirm following is off for both and optional access is gone, then deliberately grant Follow again. Include permission denial, popup closure, delayed grants, and OFF races. The ChatGPT activity display now uses visible generation controls for coarse working/ready states. Keep the unresolved Gmail Chat limitation.

## Historical 0.3.5 release preparation and evidence

The following material records 0.3.5's behavior and release preparation. Its text-inspection descriptions apply to 0.3.5, not the 0.3.6 candidate. Do not reuse those sentences for the candidate submission.

This guide prepares **Goshen Terminal 0.3.5** for a first store release. It includes draft listing copy and the maintainer's upload checklist. A prepared ZIP or completed checklist does not mean Google has reviewed or approved the extension.

**Status recorded 2026-09-10:** The 0.3.5 source and privacy policy are publicly available, GitHub CI passed, and private vulnerability reporting is enabled. The Chrome Web Store submission contains the 0.3.5 package, listing images, privacy declarations, and reviewer instructions. Core installed-browser checks for the first unlisted preview have passed, including ChatGPT, ordinary-page activation, navigation, cached-page reactivation, OFF, HOPPER, and controlled delayed startup. Goshen Terminal 0.3.5 was submitted September 8 with automatic publication disabled, then approved by Google and manually published on September 10, 2026 as a **Free, Unlisted** early preview. [Install Goshen Terminal from the Chrome Web Store](https://chromewebstore.google.com/detail/jlhlihmmbllkllglociipkhafbpmhcle). Remaining compatibility and permission-path limitations are recorded in [TESTING.md](TESTING.md).

The recommended first release is **Unlisted**, using one store item and a small group of testers. Anyone with an unlisted item's link can install it; choose **Private** if installation must be restricted to named testers. All visibility choices undergo the same policy review. [Distribution options](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution).

## 1. Finish the release checks

Before submitting the candidate, record results against the exact installed version in [TESTING.md](TESTING.md):

- Verify the popup's **Terminal on** and **Terminal off** controls in installed Chrome, including an ordinary page and ChatGPT.
- Check same-site navigation, reload, optional cross-site following, permission denial/retry, an untouched second tab, and OFF through Back/reload. Include a cached page whose theme was previously turned off.
- Complete a ChatGPT response and check its composer, loading indicators, and return to idle. Check readable controls, narrow windows, and HOPPER movement/resizing.
- Reproduce and resolve the Gmail Chat freeze/blank-view report before claiming support for that view. Keep the limitation in the listing while unresolved; local fictional inbox checks do not establish embedded Chat compatibility.
- Check the latest color and startup changes on representative real pages. Record remaining limitations without presenting fixture timings as installed-browser performance.

Fresh installed-browser verification of the 0.3.5 candidate is a release gate. Its core smoke checks are complete; the current compatibility matrix distinguishes these results from the remaining permission-path and broader compatibility checks. Retain those limitations in the preview's release claims.

Run `npm test`, `npm run validate`, and `npm run package` against the release source. Package again to verify reproducibility. The candidate archive is `dist/Goshen-Terminal-0.3.5.zip`, with `manifest.json` at its root. It should contain only the extension files and the root license, plus a notice if one is added. Tests, previews, documentation, and old archives belong outside the installed package.

Review the commit, run the configured GitHub CI successfully, and associate the final source with a version tag such as `v0.3.5`. Record the ZIP's SHA-256 in the release notes, preserve earlier archives, and verify the uploaded ZIP matches that checksum. Publish the reviewed source and privacy policy at stable public URLs before using them in the listing. Confirm a working private security-reporting channel and update [SECURITY.md](../SECURITY.md). These are project release practices; the local packaging script does not publish to GitHub or the store.

## 2. Set up the publisher account

1. Open the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) using the Google account that should own the extension. Choose a durable account whose mail is monitored. Registration includes accepting Google's agreements and paying a one-time fee; use the amount and currency shown in the dashboard. The official registration guide does not specify a current amount. [Account registration](https://developer.chrome.com/docs/webstore/register).
2. Enable Google Account 2-Step Verification before publishing or updating. [2-Step Verification requirement](https://developer.chrome.com/blog/policy-update-2sv).
3. Set the publisher name, verify the contact email, and enable useful review/status notifications. Review which contact details will be public. [Account setup](https://developer.chrome.com/docs/webstore/set-up-account).
4. Declare Trader or Non-Trader status according to the publisher's actual circumstances. This is the publisher's decision; a free extension does not settle it. Complete any requested verification. Google's guidance states that trader identity and contact information are displayed publicly. [Trader verification FAQ](https://developer.chrome.com/docs/webstore/program-policies/trader-verification-faq).

Account registration, payment, identity declarations, submission, and publication are separate actions for the publisher to complete.

## 3. Prepare the store images

| Asset | Upload requirements | Goshen content |
| --- | --- | --- |
| Extension icon | 128 × 128 PNG in the package | Original Goshen mark; for square artwork, follow the 96 × 96 artwork and transparent-padding guidance |
| Small promotional tile | 440 × 280 | Goshen Terminal branding and a clear view of HOPPER |
| Screenshots | At least 1, at most 5; 1280 × 800 preferred, or 640 × 400; square corners and no outer padding | ChatGPT terminal, a generic page, and appearance controls are useful starting views |
| Marquee image | Optional 1400 × 560 | Prepare only if a larger promotional image is useful |

These dimensions and mandatory assets come from [Google's image guide](https://developer.chrome.com/docs/webstore/images). Check each image at its displayed size. Use the candidate's actual interface with fictional content; remove private account details, developer controls, and unrelated browser chrome. Clearly identify simulated content. Demonstration images show appearance and must not imply that a live integration passed checks it has not completed.

Prepared assets:

- [128px extension icon](../extension/icons/icon-128.png).
- [ChatGPT layout](images/chatgpt-preview.jpg), [generic gallery](images/universal-preview.jpg), and [fictional inbox](images/mail-preview.jpg): 1280 × 800 JPEGs with built-in Scanlines 40 and Glow 60. These are shared-runtime demo captures, not proof of installed-browser compatibility.
- [Small promotional tile](images/store-promo.jpg): 440 × 280 JPEG, with editable [SVG artwork](images/store-promo.svg). This is promotional artwork, not a screenshot. Regenerate the SVG with `node scripts/generate-store-art.mjs`.

The brighter effects are optional settings, not new defaults. Keep public test fixtures, regression tests, and development instructions in the source repository; they are useful contribution material and do not belong in the installed ZIP. Publish an audited source snapshot rather than copying a working directory with local logs, recovery exports, or old release kits.

## 4. Prepared listing copy

Use the following copy after confirming it matches the candidate. **Goshen Terminal** is a Chrome extension that styles websites, not a Chrome browser theme. Choose the closest current category; **Just for Fun** is a suggested fit for its decorative purpose. See Google's [listing best practices](https://developer.chrome.com/docs/webstore/best-practices).

### Name

Goshen Terminal

### Short description from the manifest

A phosphor terminal for the web. Activate on your chosen tab, with a reactive pixel rabbit and tailored ChatGPT support.

The store takes this text from the package's `description` field; changing it requires a manifest update and a new package. [Prepare the manifest](https://developer.chrome.com/docs/webstore/prepare#review-your-manifest).

### Single purpose

Customize the appearance of ChatGPT and user-selected browser tabs with a retro terminal interface and an optional decorative companion.

### Detailed description

Give familiar websites a vintage terminal feel. Goshen Terminal adds phosphor colors, subtle scanlines, glowing panels, and HOPPER, a small pixel rabbit that reacts to visible activity.

ChatGPT gets a dedicated conversation frame and instrument rail. Other websites keep their original layout beneath a lighter terminal treatment.

- Choose amber, green, or ice and adjust glow, scanlines, and text size.
- Switch between terminal colors and a frame that keeps a website's own colors and fonts.
- Move and resize HOPPER on generic pages.
- Control ambient animation and prewritten rabbit quips independently, or follow system reduced motion.
- Use Terminal on for a chosen tab. The theme follows navigation within the same site; Terminal off clears that tab's activation.
- Optionally enable Follow this tab across sites. Chrome requests broader website access, and Goshen follows only the tabs where you enable this option.

Goshen runs locally without analytics, remote code, or an AI service of its own. Appearance preferences stay on your device. Active tab origins and follow choices remain in browser-session storage. The ChatGPT companion uses brief local text checks for preset reactions; conversation text is not saved or transmitted by Goshen.

This is an early preview. Some websites may have contrast or layout conflicts, and a page's native background can appear briefly during loading. Try Frame only or Terminal off when a page conflicts. Browser-protected pages and embedded frames are outside universal mode's scope. Embedded Gmail Chat has an unresolved freeze/blank-view report; its responsiveness is not verified. ChatGPT voice, uploads, canvas, and every native menu are not comprehensively tested.

HOPPER's remarks and lights are decorative, not AI answers or measurements of hidden reasoning. Goshen Terminal is independent of OpenAI and Google.

## 5. Complete the privacy fields

Use the single-purpose text above and the following explanations for the permissions present in the candidate. Answer the remote-code question **No**: Goshen executes packaged code only. The dashboard's declarations must agree with the package and public privacy policy. [Privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy).

| Permission or access | Prepared justification |
| --- | --- |
| `storage` | Save appearance preferences on the device and retain enabled tab origins and follow choices for the browser session. No Chrome sync storage is used. |
| `activeTab` | Obtain temporary access when the user invokes Goshen on a tab, so that tab can be inspected and styled. |
| `scripting` | Insert and remove the extension's packaged styles and scripts in the permitted tab's main frame, including navigation recovery. |
| ChatGPT content-script matches | Apply the dedicated ChatGPT interface on `https://chatgpt.com/*` and `https://chat.openai.com/*` while automatic ChatGPT styling is enabled. |
| Optional `http://*/*` and `https://*/*` | Support the user's explicit Follow this tab across sites choice. Chrome requests access from that gesture. Automatic application still requires an enabled record for the individual tab and a current permission grant. |

### Data-category worksheet

Local processing still requires disclosure. Do not select “no user data” merely because Goshen has no server, or treat the absence of Chrome's `history` permission as the absence of browsing-related data handling. [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).

This is a code-based mapping for checking the dashboard's current category definitions, not a record of completed checkbox selections:

| Dashboard category to review | Relevant local behavior |
| --- | --- |
| Website content | Page structure and styling are inspected; ChatGPT activity checks briefly inspect visible answer length and composer keywords. |
| Web history / browsing activity | The current address chooses an adapter; an enabled tab's origin is kept in session storage. Full paths and a browsing-history log are not saved. |
| User activity | Input, pointer, scroll, and visible response events drive decorative reactions. Generic input field text is not read. |
| Personal communications | Include this if the current definition covers ChatGPT messages or prompts: the dedicated adapter makes the brief text checks described above. Gmail's color helper does not read mail text. |

Review all remaining categories against the actual code and dashboard definitions. Keep the declarations consistent with [PRIVACY.md](../PRIVACY.md), including local-only processing, retention, and removal. Certify the Limited Use statements only after confirming the candidate matches them. The policy includes an affirmative [Limited Use commitment](https://developer.chrome.com/docs/webstore/program-policies/limited-use).

Enter a stable, publicly readable privacy-policy URL. A local Markdown path is insufficient. The repository's privacy page can be used once the current policy has actually been published there and opens while signed out. Confirm the support and homepage URLs similarly; do not invent a store URL before an item exists.

## 6. Upload and submit for review

1. In the dashboard, create the first item and upload the final ZIP. Check that its displayed version is **0.3.5**. For later releases, update this same item.
2. Fill in the store listing, language/category, images, homepage, and support details. Complete the privacy fields and policy URL.
3. Choose **Unlisted** for the first rollout, or **Private** for access-controlled testing. Choose the regions appropriate for the publisher's completed account declarations.
4. Add testing instructions, review the displayed draft, and resolve dashboard validation errors.
5. When ready, choose **Submit for review** and turn off automatic publication after approval. This uses deferred publishing, leaving a separate publication decision after review. Google currently allows 30 days to publish an approved staged submission before it returns to draft. [Upload and deferred-publishing steps](https://developer.chrome.com/docs/webstore/publish).

Reviews can take days or weeks, and broad optional host access may receive closer scrutiny. Review approval is determined by Google; local validation does not predict the outcome. [Review process](https://developer.chrome.com/docs/webstore/review-process).

### Prepared reviewer instructions

Goshen requires no separate account, subscription, or API key. For universal mode, open an ordinary HTML website, invoke the Goshen Terminal popup, and select Terminal on. Change phosphor colors and switch between Terminal colors and Frame only. Move or resize HOPPER, then use Terminal off to restore the page. Re-enable and navigate within the same site to check persistence. Follow this tab across sites is optional and requires Chrome's website-access prompt; a separate tab should stay unchanged.

The dedicated interface activates on ChatGPT while Automatic on ChatGPT is enabled. Testing ChatGPT's own conversation features may require the reviewer's ChatGPT access; Goshen does not provide or bypass that service. HOPPER follows visible controls and text activity and uses prewritten remarks. Embedded Gmail Chat is not a verified surface in this preview.

Add any concrete steps the current dashboard requests. If reviewer credentials are required for a feature, arrange dedicated access through the dashboard's private testing-instructions field, never the public repository or listing. [Testing instructions](https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions).

## 7. Release and maintain the item

After approval, verify the staged version, visibility, privacy declarations, links, and images before publishing. Test the store-installed build with the initial audience and record issues before changing visibility to Public. Keep one item for normal updates; a separate parallel beta has additional labeling requirements described in the distribution guide.

Each code update needs a higher manifest version and a complete replacement ZIP, followed by review. Keep `package.json`, the manifest, source tag, release notes, and archive aligned. Refresh permissions and data disclosures whenever behavior changes. [Updating a store item](https://developer.chrome.com/docs/webstore/update).

Keep the final ZIP and checksum with the matching GitHub release, preserve the previous source and archive, monitor the verified publisher inbox, and keep the support and security-reporting channels working.
