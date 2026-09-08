# Security reporting

Report security concerns privately through the project repository, [arussin/goshen](https://github.com/arussin/goshen).

Do not include exploit details, credentials, private page content, or personal information in a public issue. Open the repository's [Security tab](https://github.com/arussin/goshen/security) and use **Report a vulnerability** if available. If that entry is unavailable, use a [non-sensitive contact request](https://github.com/arussin/goshen/issues/new) to ask the maintainer for a private channel before sharing technical details.

Useful private reports include the extension version, Chrome version, affected mode, reproduction steps using a harmless test page, expected access boundaries, and observed impact. Avoid sending real conversation data or credentials.

The intended security boundaries are:

- Automatic content scripts are restricted to the two declared ChatGPT hosts.
- Universal mode begins with user-chosen current-tab access; same-origin reapplication requires active session intent.
- Cross-site following requires an explicit optional HTTP/HTTPS permission grant and that tab's own enabled follow setting. The grant alone must not activate other tabs.
- No remote code, telemetry, request interception, or stored page content. Session state is limited to active tab IDs, origins, and follow flags, without full URL paths or history.
- Website text and markup remain untrusted; extension settings are normalized before use.

Please report the affected version and use a minimal, harmless reproduction. Do not attach account exports or private conversations.
