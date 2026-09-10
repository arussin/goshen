# Verify a Goshen release

Goshen ships ordinary JavaScript, HTML, CSS, and local assets. There is no compilation, bundling, minification, or dependency download in its packaging step. The package script copies the release's `extension/` files and root `LICENSE` and `NOTICE` files when present into a deterministic ZIP: sorted paths, fixed timestamps, and stored file bytes.

The verifier below can establish exact byte equality with selected source. **A matching hash does not prove software is safe.** Inspect the source and permissions separately. A hash is useful only if you trust where its expected value came from.

## What is being verified

| Check | Meaning | Limitation |
| --- | --- | --- |
| Release ZIP versus independently reproduced ZIP | Exact archive bytes match the selected source and packaging process | Does not identify what Google installed |
| Unpacked directory versus source | Every expected file matches, with no extra files | Does not authenticate the directory, Chrome signatures, or the selected source |
| GitHub build attestation, if supplied | Signed provenance associates an artifact with a build workflow | Does not establish safe behavior or equality with Google's installed package |
| Chrome Web Store signature | Integrity and identity of the store package | Does not connect that package to a public Git commit |

No source-equivalence claim for Google's installed build is made merely by publishing an upload-ZIP checksum. Current releases do not gain an attestation simply because this document describes one.

## Choose the exact source

Use the source for the version you are checking, pinned to the full commit recorded in the release. Review the source and the verifier before running them. A mutable branch such as `main` may contain unreleased changes. Do not compare 0.3.5's ZIP with a 0.3.6 source tree.

The selected source directory must contain `extension/` and the root notices from that release. Preserve file bytes when obtaining it: checkout settings such as Git's automatic line-ending conversion can change a reproducible ZIP. Use a fresh checkout with `core.autocrlf=false` before checkout, or an exact export of the recorded commit. The verifier compares actual bytes and does not normalize line endings.

The 0.3.6 candidate uses the repository's `.gitattributes` policy to preserve LF line endings for packaged text. Historical 0.3.5 must retain its original commit bytes, including mixed line endings in `extension/popup.js`. Do not apply the candidate's LF normalization to historical source or overwrite the original 0.3.5 ZIP. Obtain that historical commit with `core.autocrlf=false` before checkout, or use an exact Git export. A line-ending difference remains a verification failure even if the text looks identical in an editor.

The verifier runs from this repository but accepts another release's source directory through `--source`. It uses this repository's reviewed ZIP packager; it neither imports nor executes scripts from the selected source. Older source exports do not need to include this verifier. No current-version validation is imposed on the selected release.

## Compare the upload ZIP

Requires Node.js 20 or later. No installation step or third-party libraries are needed. In these commands, replace the example paths with your own; `--source` is the repository/export root, not its `extension/` subdirectory.

```text
node scripts/verify-release.mjs --source "C:/releases/goshen-0.3.5-source" --archive "C:/releases/Goshen-Terminal-0.3.5.zip" --inventory
```

For the current checkout and a package made from it:

```text
node scripts/verify-release.mjs --source . --archive dist/Goshen-Terminal-0.3.6.zip --inventory
```

The command reconstructs the expected ZIP **in memory**, compares all archive bytes, and prints JSON with expected and actual SHA-256 values. `--inventory` adds each expected file's relative path, length, and SHA-256. It does not create, overwrite, extract, or repair an archive. If archive bytes differ, it reports the mismatch without attempting a per-file ZIP analysis.

A release publisher can save this output alongside an independently reviewed release commit and the unchanged upload ZIP. Users should reproduce the result themselves; a publisher-provided checksum alone is only the publisher's assertion.

## Compare an unpacked or installed directory

```text
node scripts/verify-release.mjs --source "C:/releases/goshen-0.3.5-source" --directory "C:/releases/goshen-0.3.5-unpacked" --inventory
```

For an installed extension, first check Goshen's ID and version in Chrome's extension details. The store ID is `jlhlihmmbllkllglociipkhafbpmhcle`. Chromium documents finding the active profile in `chrome://version` under **Profile Path**. On desktop Chrome, locate the corresponding `Extensions/<extension-id>/<version-directory>` within that profile and select that version directory explicitly. Check its manifest version against the selected release. Do not select the entire profile. Close Chrome before making a copy for comparison so an automatic update cannot change the files during the check. Work with the copy; do not edit installed extension files.

The verifier reads only the explicit source inputs and target directory. It performs no network requests, browser interaction, profile discovery, or recursive search elsewhere. It rejects symbolic links and special files within the selected tree. Use stable directories: it is not a sandbox against another process concurrently replacing files or directory ancestors.

All missing, changed, extra, or unsupported files are listed. Manifest formatting changes, PNG changes, and Chrome's `_metadata` files are **not** silently ignored. The comparison covers package files; empty directories are not part of the package inventory.

Chrome creates a signed CRX wrapper and may rewrite the installed manifest and images and add verification metadata. Consequently an authentic store installation may fail this strict comparison. Such a result means **exact verification is incomplete**, not that malware has been found. Review every difference separately; do not remove files or relax the checks just to obtain a passing result. This utility does not verify CRX signatures or decode Google's signed metadata. Recheck after each version update; a previous match says nothing about a later version.

Exit codes:

- `0`: exact match for the specified comparison.
- `1`: completed comparison with differences; verification failed.
- `2`: invalid arguments, unreadable input, or unsafe source/target input; verification did not complete.

## Provenance and limitations

For future releases, GitHub Actions can attach a signed build attestation to the exact ZIP it produces. Consumers can verify the expected repository, source commit, and signer workflow using GitHub's CLI. This would strengthen the connection between source and release artifact; it still would not prove equality with Google's installed files or prove safe behavior. An extension's own “verified” badge or self-reported hash cannot independently prove its honesty.

Relevant primary sources:

- [Chrome extension distribution and store signing](https://developer.chrome.com/docs/extensions/how-to/distribute)
- [Chromium CRX3 package format](https://chromium.googlesource.com/chromium/src/+/HEAD/components/crx_file/crx3.proto)
- [Chromium installer: manifest rewriting, image sanitization, and metadata](https://chromium.googlesource.com/chromium/src/+/HEAD/extensions/browser/sandboxed_unpacker.cc)
- [Chromium signed content-verification metadata](https://chromium.googlesource.com/chromium/src/+/HEAD/extensions/browser/verified_contents.h)
- [Chromium profile location documentation](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/user_data_dir.md)
- [GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations)
- [GitHub CLI verification options and trust limitations](https://cli.github.com/manual/gh_attestation_verify)
