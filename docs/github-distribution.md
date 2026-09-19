# GitHub Actions release

How `.github/workflows/release.yml` packages Fulvid and publishes GitHub Releases. Artifact names: [DISTRIBUTION.md](./DISTRIBUTION.md).

This is the official packaging path for version tags. It does not use the Linux Makefile for the `.deb`.

## When it runs

| Event | Effect |
| --- | --- |
| Push tag `v*` | Build Linux, Windows, and macOS, then publish a GitHub Release |
| `workflow_dispatch` | Build and upload workflow artifacts only. Does **not** publish |

Contributor checks (`validate.yml`) run on pull requests and pushes to `main`. Compatibility CI (`compatibility-*.yml`) packages and smokes on pushes to `main` and never publishes.

## Jobs

Three platform jobs build, package, and upload workflow artifacts on the pinned runners (`ubuntu-24.04`, `windows-2025`, `macos-26`). The `windows-2025` value is the GitHub-hosted runner image for Windows desktop CI, not a Windows Server product target. A fourth job publishes only when the ref is `refs/tags/v*`.

- Linux: Electrobun stable build, public names, `.deb` via `dpkg-deb`, checksums, upload. Desktop file: [packaging/linux/desktop/fulvid.desktop](../packaging/linux/desktop/fulvid.desktop).
- Windows and macOS: [packaging/windows/](../packaging/windows/) and [packaging/macos/](../packaging/macos/).

On a version tag, each platform job rewrites `package.json` and `electrobun.config.ts` to match the tag (the `v` prefix is stripped) before packaging.

## Publish job

It waits for all three platforms (`needs: [linux, windows, macos]`). If any fails, nothing is published.

Condition:

```text
if: startsWith(github.ref, 'refs/tags/v')
```

It downloads `fulvid-linux/`, `fulvid-windows/`, and `fulvid-macos/`, renames shared metadata (`SHA256SUMS`, `release-manifest.json`, `build.log`) with a platform suffix, and calls `softprops/action-gh-release` with `GITHUB_TOKEN`. That job is the only one with `contents: write`.

- If no Release exists for the tag, one is created (`Fulvid <tag>`).
- The action sets `generate_release_notes: true` (GitHub's commit list). When attaching notes by hand, use the matching file under [releases/](./releases/) (`v1.0.0.md` for the current release notes; use `vX.Y.Z.md` for the version you are shipping).
- If a Release already exists, new assets are uploaded. `overwrite_files: false`, so a name already on the Release fails the upload.
- A re-run does not replace existing assets.

## Signing

GitHub Actions does not use the project PGP key. Linux CI does not write `.asc` files.

Windows Authenticode and Apple signing/notarization run only when the matching secrets are present. Missing secrets must not skip a platform.
