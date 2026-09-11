# Goshen Terminal

A vintage terminal theme for ChatGPT and the browser tabs you choose, with phosphor colors and a pixel rabbit named HOPPER. ChatGPT gets a dedicated layout; other websites keep their own layout.

**[Install Goshen Terminal for Chrome](https://adamrussin.com/goshen)** · Free · Chrome 106 or newer

![ChatGPT in the amber theme with the conversation panel and HOPPER](docs/images/chatgpt-preview.jpg)

![A website in the green theme with HOPPER in a floating window](docs/images/universal-preview.jpg)

![An inbox in the amber theme with navigation and message rows](docs/images/mail-preview.jpg)

## Get started

1. Open the [Chrome Web Store listing](https://adamrussin.com/goshen) and choose **Add to Chrome**.
2. Pin **Goshen Terminal** from Chrome's Extensions menu.
3. Refresh an open ChatGPT tab. On another website, open the extension and choose **TERMINAL ON**.

The Chrome Store currently has **0.3.5**. Version **0.3.7** is awaiting Google's review. It removes prompt-text inspection, adds **REMOVE CROSS-SITE ACCESS**, and fixes re-enabling Follow afterward.

## Make it yours

In the extension popup:

- Choose **amber, green, or ice**, and adjust glow and scanlines.
- Use the full ChatGPT layout or switch to **FOCUS** to hide the instrument rail.
- Choose **TERMINAL COLORS** on other websites, or **FRAME ONLY** to keep their colors and fonts.
- Adjust **ChatGPT text size**. It works reliably on ChatGPT; results on other websites vary.
- Turn animations and rabbit quips on or off, or follow your system's reduced-motion preference.

On other websites, drag HOPPER's title bar to move the window or its lower-right corner to resize it. HOPPER's preset reactions and activity lights are decorative.

## Keep it on as you browse

The terminal stays with an activated tab through reloads and same-site navigation. **TERMINAL OFF** restores the page. Turning it off or closing the tab clears its activation.

Enable **Follow this tab across sites** to keep it on across websites. Chrome asks for access to all websites: a broad permission, although Goshen follows only tabs you explicitly enable.

Turning Follow off stops that tab's following but leaves Chrome's permission in place. From 0.3.6, **REMOVE CROSS-SITE ACCESS** revokes optional website access for every tab. Automatic ChatGPT access is separate. If access is paused, reopen the popup and choose **ALLOW WEBSITE ACCESS**.

## Privacy and source verification

Goshen processes pages locally, with no analytics, remote code, or page-content uploads. Preferences stay on your device; active tab records last only for the browser session. Website access can include sensitive pages, so grant cross-site access only if you need it. See the [privacy policy](PRIVACY.md) for each version's behavior.

The extension runs the JavaScript and CSS in this repository directly. The [verification guide](docs/VERIFYING.md) shows how to compare the files installed in Chrome with the source and reproduce the release ZIP checksum.

## Install from source

Download or clone this repository. At `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the `extension` folder containing `manifest.json`.

After replacing an unpacked installation's files, click **Reload** on Chrome's extensions page, then refresh your browser tabs. Refreshing a webpage alone does not reload the extension.

## Known limitations

Some websites have conflicting styles, imperfect contrast, or a brief light background while loading. Try **FRAME ONLY** or **TERMINAL OFF** if a page looks wrong. Chrome's internal pages, the Web Store, extension pages, and local files are unsupported. Embedded Gmail Chat has a reported freeze or blank-view issue.

[Report a problem](https://github.com/arussin/goshen/issues) with the site, Chrome version, and steps to reproduce it. Remove private information from screenshots. See [compatibility notes](docs/TESTING.md) and [contributing](CONTRIBUTING.md) for more detail.

Released under the [MIT License](LICENSE). Independent of OpenAI and Google.
