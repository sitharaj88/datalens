# How your credentials are stored

DataLens is careful with the credentials you trust it with.

- **Passwords, SSH keys, and cloud secrets** are stored in VS Code
  **SecretStorage** (backed by your OS keychain), never in plaintext settings.
- **Connection metadata** (host, port, database, username) is stored separately
  and contains no secrets.
- Older versions that stored some secrets in plaintext are **automatically
  migrated** into SecretStorage on first launch.

## One important limitation

VS Code's SecretStorage is **not isolated between extensions** — another
installed extension could, in principle, read stored secrets. So:

- Only install extensions you trust.
- For high-value production databases, set
  **`dbViewer.security.storePasswords: false`**. DataLens then never persists the
  password and prompts you for it at connect time.

See **SECURITY.md** in the repository for full details and how to report issues.
