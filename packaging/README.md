# Distribution packaging

Templates for third-party package managers. Each one points at the assets of a GitHub release, so they can only be filled in after a release exists.

```bash
node packaging/update.mjs 0.1.0      # downloads the release assets' checksums and rewrites the manifests
```

| Target        | Where it is submitted                                                               | Notes                                                                                                                                                                                                                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Homebrew cask | `transmission-helm/homebrew-tap` (our own tap)                                      | Users run `brew tap transmission-helm/tap && brew install --cask --no-quarantine transmission-helm`. Homebrew quarantines downloads by default; `--no-quarantine` lets the unsigned app open directly. Submitting to the main `homebrew-cask` repo requires ~75 GitHub stars or similar notability; start with the tap. |
| winget        | Pull request to `microsoft/winget-pkgs`                                             | Three YAML manifests under `manifests/t/TransmissionHelm/TransmissionHelm/<version>/`. The installer must be the `-setup.exe`; winget validates the SHA256 and runs the installer silently (`/S` is supported by our NSIS build).                                                                                       |
| Flathub       | New repo under `flathub/` created by their reviewers from a PR to `flathub/flathub` | Electron apps use the `org.electronjs.Electron2.BaseApp` base app and are built from the Linux `.zip`/AppImage or from source. Review usually takes 1–3 weeks.                                                                                                                                                          |

Keep the app ID `app.transmissionhelm.desktop` consistent across all three.
