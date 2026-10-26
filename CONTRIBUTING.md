# Contributing to Transmission Helm

Thanks for helping out. This document covers how the project is organised, how to get a working setup, and what a good pull request looks like.

## Getting started

Requirements: Node.js 24 (see `.nvmrc`), npm, and for macOS packaging Xcode with its command-line tools. Docker is optional but useful for testing against a real Transmission daemon.

```bash
git clone https://github.com/transmission-helm/transmission-helm.git
cd transmission-helm
npm install
make dev        # run from source with hot reload
make check      # lint + typecheck + unit tests (what CI runs)
make help       # every other task
```

`make daemon` starts a throwaway Transmission 4.1 daemon in Docker on `127.0.0.1:9091` with no password; add a connection to it from the app. `make daemon-stop` removes it.

## Project layout

```
src/main/       Electron main process: RPC client, polling, settings, tray, menu, IPC handlers
src/preload/    The window.helm bridge exposed to the renderer (sandboxed, context-isolated)
src/renderer/   Svelte 5 UI: pages, components, inspector, dialogs, state store
src/shared/     Types and pure helpers used on both sides (RPC wire types, formatting, settings)
tests/          Vitest unit tests (never launch Electron)
scripts/        Dev helpers: Docker daemon, mock daemon, icon and license generators
build/          Packaging resources: icons, entitlements, afterPack hook
docs/           Design brief and signing guide
```

Key rules that keep the app safe and testable:

- **All network I/O happens in the main process.** The renderer never talks to the daemon; it calls `window.helm` and receives snapshots. New capabilities go: type in `src/shared/ipc.ts` → bridge in `src/preload/index.ts` → handler in `src/main/ipc.ts`.
- **Passwords never leave the main process in plaintext.** They are stored through Electron's safeStorage (OS keychain). The renderer only learns whether a password is saved.
- **No module under test may import `electron` at load time.** Inject what you need (see `Encryptor`, `FetchLike`, `setTimeoutFn`) so Vitest can run it.
- **Follow the RPC spec literally.** Keys are snake_case as Transmission 4.1+ sends them; nothing is renamed.
- **Design tokens only.** Colors, radii, row heights and spacing come from `src/renderer/src/app.css`. Both themes and both densities must keep working. The visual brief is in `docs/design.md`.
- **No new runtime dependencies without discussion.** Open an issue first.

## Making changes

1. Branch from `main`.
2. Keep the change focused. Unrelated refactors belong in their own PR.
3. Add or update unit tests for pure logic (`tests/`). UI behaviour that cannot be unit-tested should be described in the PR with how you verified it (a screenshot against the Docker daemon is ideal).
4. Run `make check` before pushing. CI runs the same plus an unpacked build on macOS, Windows and Linux.
5. Use Prettier formatting (`make format`); ESLint must be clean.

### Commit messages

Short imperative subject line (under 72 characters), optional body explaining why. Reference issues with `Fixes #123` where applicable.

### Pull requests

Describe what changed and why, list anything you could not test, and include screenshots for UI changes in light and dark mode.

## Reporting bugs

Open an issue with: your OS and version, the Transmission version (shown in the status footer), steps to reproduce, and what you expected. Logs from `npm run dev` or the error shown in the app help a lot. Never paste passwords or session IDs.

## Releasing (maintainers)

1. Update `version` in `package.json` and add a section to `CHANGELOG.md`.
2. Commit, then tag and push: `git tag v0.1.0 && git push origin main --tags`.
3. The Release workflow builds installers for all three platforms and attaches them to a draft GitHub release. Review the draft, edit the notes, and publish.

macOS builds are signed and notarized when the Apple certificate and notarization secrets are configured in the repository settings; unsigned builds are produced otherwise.

### App icon on macOS 26 and later

macOS 26 shows icons that are not in Apple's Icon Composer format on a grey "legacy" plate. The icon source lives in `build/AppIcon.icon` (an `icon.json` manifest plus `Assets/wheel.svg`); `build/afterPack.cjs` compiles it with Xcode's `actool` during every macOS build into `Assets.car` and sets `CFBundleIconName`. Without Xcode the hook skips and the classic `icon.icns` is used. Edit the manifest by opening `build/AppIcon.icon` in Icon Composer (bundled with Xcode 26+).

## License

By contributing you agree that your contributions are licensed under the MIT License that covers the project.
