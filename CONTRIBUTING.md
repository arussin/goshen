# Contributing to Goshen Terminal

Goshen Terminal is licensed under the [MIT License](LICENSE). Keep contributions focused, preserve the original website's behavior, and include useful validation with changes.

The project repository is [arussin/goshen](https://github.com/arussin/goshen). Use [issues](https://github.com/arussin/goshen/issues) for ordinary bugs and feature requests, and [pull requests](https://github.com/arussin/goshen/pulls) for proposed source changes.

## Local setup

Use Node.js 20 or newer. No npm dependencies or build step are required. Load `extension` as an unpacked extension in Chrome, as described in [README.md](README.md). Reload it on `chrome://extensions` after changing extension files, then refresh the affected page.

```sh
npm test
npm run validate
npm run preview
```

Tests run through Node's built-in test runner. Validation checks permissions, automatic site scope, local resources, scripts, and dynamically injected assets. The preview server is optional and local; its conversation is simulated.

## Keep changes focused

- Preserve native website behavior, accessibility, and layout.
- Keep new assets and code local. Do not add analytics, network services, or API credentials.
- Use the existing preference normalizer and preserve the storage key for migration.
- Keep universal mode dependent on explicit current-tab activation and session intent. Cross-site following must require both the user-approved optional permission and that tab's own follow setting.
- Treat website markup and text as untrusted data. Do not execute it or turn it into extension HTML.
- Ensure disable stops activity observers, interaction handlers, and timers, and removes styles and extension-owned marks. The lightweight restored-page listener may remain until runtime destruction; it must check current worker eligibility before reactivation.
- Add regression coverage for meaningful bugs or behavior changes, especially loss of native functionality and permissions.

The main boundaries are described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Visual choices are described in [DESIGN.md](DESIGN.md).

The terminal icon is drawn from an original pixel grid in `scripts/generate-icons.mjs`. Run `npm run icons` to regenerate all four packaged sizes with Node built-ins. Keep the resulting PNGs checked in; identical source should produce identical bytes. Mail examples and README screenshots must use fictional fixture content or public pages, never personal account captures.

## Reporting compatibility problems

Include the extension version, Chrome version, operating system, viewport size, selected mode, and shortest reproducible steps. A public website address or a small standalone HTML fixture is more useful than a screenshot alone. Explain expected behavior and what changed after enabling Goshen.

Remove private conversation text, account names, tokens, private URLs, and personal information from reports and screenshots. For security concerns, follow [SECURITY.md](SECURITY.md) instead of filing technical exploit details in a public issue.

## Manual checks before a release

Check the installed extension on ChatGPT and representative generic pages. Record each result and its version; a passed local fixture does not replace a live check.

1. ChatGPT: stable startup and navigation, editable composer, native menus, actual response activity, and skin removal.
2. Universal mode: activate only the chosen tab, try both styles, change theme, and verify same-origin reload/navigation preserves it. Check OFF stays off after reload and tab closure removes its session record.
3. Cross-site follow: test permission grant and denial with the popup open and closed, retry paused access, verify a grant does not activate unrelated tabs, and verify protected pages or lost access pause reapplication. OFF must win over late permission results.
4. Normal pages: long articles, forms, links, menus, images, selection, keyboard focus, and narrow windows remain usable.
5. Companion: idle and event reactions, quip off, motion off, system reduced-motion behavior, title-bar dragging, resizing, and keyboard geometry controls.
6. Unsupported pages: clear feedback without extra automatic permissions or breaking the page.
7. Popup: all controls fit or scroll, errors are readable, and saved settings reflect the selected tab's mode.

## Packaging and release preparation

```sh
npm test
npm run validate
npm run package
```

Packaging uses Node built-ins and writes a reproducible ZIP in `dist`. Files under `extension` appear at the archive root. Root `LICENSE` and optional `NOTICE` files are included. Source documentation, previews, local configuration, and old archives are not bundled into the extension.

Before publication:

1. Verify the license is included and check ownership/attribution of any new bundled assets.
2. Keep `package.json`, `extension/manifest.json`, and visible version marks aligned.
3. Run checks, complete relevant live tests, and describe remaining limitations accurately.
4. Run packaging twice and confirm the second run verifies the existing archive. Different bytes with the same version are rejected; bump the version for a changed release.
5. Extract the ZIP into a new folder and load that folder in Chrome to verify the actual distributable.
6. Review staged files for secrets, personal machine paths, private screenshots, and generated output.
7. Configure the repository's security-reporting channel and confirm workflow permissions before publishing.

Repository changes, release publication, and Chrome Web Store submission are separate actions. These local scripts do not publish anything. Include only reviewed source files in a commit; generated ZIPs belong in a separately reviewed release, not the source tree.
