# Security

HEISS UI is built to run on your own machine. By default it binds to `127.0.0.1`.

Only set `HOST=0.0.0.0` on a network you trust. The app can open local folders and talk to your ComfyUI server, so never expose it directly to the public internet.

The Private Vault encrypts private generations at rest and keeps them behind a password. It's meant to keep things out of casual view, not to protect against someone with administrator access to the machine. See the Private Vault section in the README for the details.

## Reporting a vulnerability

Please report security issues privately through a [GitHub security advisory](https://github.com/tristmeister/HEISS-UI/security/advisories/new) rather than a public issue.
