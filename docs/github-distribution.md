# GitHub Actions release

How `.github/workflows/release.yml` packages Fulvid. Public status and artifact names: [DISTRIBUTION.md](./DISTRIBUTION.md).

This is the main packaging path. It does not use the Linux Makefile or `packaging/linux/` for the `.deb`.

The workflow runs on pull requests, pushes to `main`, version tags `v*`, and `workflow_dispatch`. Contributor checks (`validate.yml`) run `bun run validate` and do not package. Compatibility CI is three other workflows ([compatibility.md](./compatibility.md)). Those package and smoke per OS. They never publish.

## Jobs

Three platform jobs always build, package, and upload workflow artifacts. A fourth job publishes only when the gate in [DISTRIBUTION.md](./DISTRIBUTION.md#publication) is on and the ref is a `v*` tag.

- Linux: Electrobun stable build, public names, `.deb` via `dpkg-deb`, checksums, upload. Desktop file comes from [packaging/linux/desktop/fulvid.desktop](../packaging/linux/desktop/fulvid.desktop).
- Windows and macOS: [packaging/windows/](../packaging/windows/) and [packaging/macos/](../packaging/macos/).

On a version tag, each platform job rewrites `package.json` and `electrobun.config.ts` to match the tag (the `v` prefix is stripped) before packaging. That only sets the artifact version.

## Publish job

It waits for all three platforms. If any fails, nothing is published.

It downloads `fulvid-linux/`, `fulvid-windows/`, and `fulvid-macos/`, renames shared metadata (`SHA256SUMS`, `release-manifest.json`, `build.log`) with a platform suffix, and calls `softprops/action-gh-release` with `GITHUB_TOKEN`. That job is the only one with `contents: write`.

- If no Release exists for the tag, one is created (`Fulvid <tag>`).
- The action sets `generate_release_notes: true` (GitHub's commit list). When attaching a Release by hand, use the matching file under [releases/](./releases/) (`v0.12.0.md` for the current published notes; use `vX.Y.Z.md` for the version you are shipping).
- If a Release already exists, new assets are uploaded. `overwrite_files: false`, so a name already on the Release fails the upload.
- A re-run does not replace existing assets.

## Signing

GitHub Actions does not use the project PGP key. Linux CI does not write `.asc` files.

On trusted events (`push`, tags, `workflow_dispatch`), Windows Authenticode and Apple signing run only when the matching secrets are present. Secrets are not passed on `pull_request`. The Linux job and the publish job do not receive them. Missing secrets must not skip a platform.
