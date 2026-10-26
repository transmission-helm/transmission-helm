# Security policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private vulnerability reporting on this repository ("Security" tab → "Report a vulnerability"). You will get an acknowledgement within a few days.

## Scope notes

- Transmission Helm stores daemon passwords through the operating system's credential store (Keychain, DPAPI, libsecret/KWallet) and never writes them to disk in plaintext.
- All daemon communication happens in the Electron main process; the renderer is sandboxed with context isolation and has no Node.js access.
- Peer IP addresses are never sent to third-party services; country lookup uses a locally downloaded database.
