# DataLens Security

DataLens connects to your databases and necessarily handles sensitive
credentials. This document explains how those credentials are stored, the
limits of that protection, and how to report vulnerabilities.

## How credentials are stored

| Data | Storage location |
|------|------------------|
| Connection metadata (host, port, database, username, options) | VS Code `globalState` (plaintext on disk) |
| Passwords, SSH passwords/passphrases/private keys, AWS secret keys, GCP service-account keys | VS Code **SecretStorage** |

DataLens **never** writes secret fields to `globalState`. On startup it also
migrates any secrets left in plaintext by older versions (≤ 1.0.0) into
SecretStorage and strips them from `globalState`.

VS Code SecretStorage is backed by the OS keychain where available
(macOS Keychain, Windows Credential Manager / DPAPI, libsecret on Linux).

## Known limitation: SecretStorage is not isolated between extensions

VS Code's `SecretStorage` API does **not** isolate secrets between extensions.
Any other installed extension can, in principle, read secrets stored by
DataLens, and extension identity (the lowercased `publisher.name`) is
spoofable. Microsoft has stated this is by design and not treated as a
security vulnerability.

**Implications and mitigations:**

- Only install extensions you trust. A malicious extension can read stored
  database credentials regardless of which extension stored them.
- For high-value production databases, set
  **`dbViewer.security.storePasswords: false`**. DataLens then never persists
  the password (or SSH password) and prompts you for it at connect time. The
  credential lives only in memory for the duration of the session.
- Prefer short-lived / scoped credentials (e.g. cloud IAM auth, rotating
  passwords) for production connections where possible.

## Webview security

DataLens renders result grids, charts, and ERDs in VS Code webviews, which can
display attacker-influenced database content. The webviews are locked down:

- A strict Content-Security-Policy (`default-src 'none'`) with a
  per-render, cryptographically-random nonce gating script execution.
- `localResourceRoots` restricted to the extension's own `dist` folders.
- No `eval`; scripts load only from the bundled assets and a pinned CDN origin.

## Reporting a vulnerability

Please report security issues privately to **sitharaj.info@gmail.com** rather
than opening a public issue. Include reproduction steps and affected versions.
We aim to acknowledge reports within 72 hours.
