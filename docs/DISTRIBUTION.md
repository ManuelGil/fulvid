# Distribution

GitHub Releases is the only public download channel. No version is published yet. Until then, run Fulvid from source (see the README).

Release notes for a tag live under [releases/](./releases/) and are copied onto that GitHub Release by hand. The chronological list of user-facing changes is [CHANGELOG.md](../CHANGELOG.md).

## Identity

| Item | Value |
| --- | --- |
| Product | Fulvid |
| Command and Debian package | `fulvid` |
| Electrobun identifier | `fulvid.imgil.dev` |
| Linux desktop file | `fulvid.desktop` ([packaging/linux/desktop/fulvid.desktop](../packaging/linux/desktop/fulvid.desktop)) |
| Icon | `fulvid` / `assets/fulvid.png` |
| License | MIT |
| Version | `package.json` and `electrobun.config.ts` |

Packaging variants may change only `Exec`. Name, Comment, Icon, StartupWMClass, Categories, and MIME stay the same. MIME is `text/markdown;text/x-markdown;` only. Do not add `.mdx` as MIME, and do not add `inode/directory`, until a packaged Fulvid actually receives those paths. Canonical `Exec` is `/usr/bin/fulvid %F`. Variants use `fulvid %F`. `%F` must stay an unquoted argument of its own so the desktop environment can pass local files and folders. The Debian wrapper already forwards those arguments to the Electrobun launcher (`exec /opt/fulvid/bin/launcher "$@"`). The launcher does not yet forward them to the Bun host (Electrobun [#483](https://github.com/blackboardsh/electrobun/issues/483); see [EXTERNAL-OPEN.md](./EXTERNAL-OPEN.md) Upstream Watch).

## Artifacts

Names look like `fulvid_<version>_<platform-architecture>...`.

| Platform | Public install files |
| --- | --- |
| Linux x64 | `fulvid_<version>_linux-x64.deb`, `fulvid_<version>_linux-x64-Setup.tar.gz` |
| Windows x64 | `fulvid_<version>_win-x64-Setup.zip` |
| macOS Apple Silicon | `fulvid_<version>_macos-arm64.dmg` |

There is no 32-bit build. Intel macOS packaging exists in the repo; GitHub Actions publishes Apple Silicon only.

Which OS images compatibility CI actually runs, and how that differs from a supported desktop SKU: [compatibility.md](./compatibility.md). That CI does not publish.

A set may also include update bundles (`.tar.zst` / `.app.tar.zst` plus `-update.json`), `SHA256SUMS`, `release-manifest.json`, and `build.log`. The update pair is not the install path. `release-manifest.json` and `build.log` are for maintainers.

Canary packaging exists for development. Canary builds are not published as GitHub Releases.

### Linux

The `.deb` and the `-Setup.tar.gz` archive are what Linux packaging produces today. The `.deb` sits next to the archive; it does not replace it.

| Format | Status |
| --- | --- |
| Debian (`.deb`) | Produced by current packaging. Not downloadable until a GitHub Release exists. |
| Linux archive | Produced by current packaging. Same set as the `.deb`. |
| Snap | Notes and a draft only. No Store listing. |
| AppImage | Notes only. No `.AppImage` is produced. |
| Flatpak / Flathub | Notes only. Not submitted. No manifest. |

Those last three are not install paths. Durable constraints live next to the stubs: [packaging/linux/](../packaging/linux/).

### Windows

GitHub Actions calls [packaging/windows/](../packaging/windows/). Authenticode is optional and only runs when certificate secrets are present.

### macOS

GitHub Actions calls [packaging/macos/](../packaging/macos/). Apple signing and notarization are optional and only run when Apple secrets are present.

## How builds are made

```text
Tag v*
  release.yml -> Linux + Windows + macOS artifacts -> GitHub Release

Push to main
  validate.yml -> contributor gate
  compatibility-*.yml -> package + smoke (does not publish)

Pull request
  validate.yml -> contributor gate

Manual Linux helper
  make + packaging/linux/ -> local artifacts; does not publish
```

Actions is the main path for official releases. Linux packaging in `release.yml` does not use Make. Windows and macOS CI call the platform scripts under `packaging/`.

The Actions and Make paths do not share an implementation. Their files do not need to be byte-identical. Each path must be consistent with itself.

Maintainer procedures: [github-distribution.md](./github-distribution.md), [linux-release.md](./linux-release.md).

## Publication

Official GitHub Releases are created only from version tags.

Publish job condition in `.github/workflows/release.yml`:

```text
if: startsWith(github.ref, 'refs/tags/v')
```

- A push of tag `v*` builds all three platforms and publishes.
- `workflow_dispatch` on the Release workflow builds artifacts for diagnosis and never publishes.
- Pull requests and pushes to `main` never run the Release publish job.

Who can create or move `v*` tags is a GitHub repository permission.

Release body notes live under [releases/](./releases/) (`v1.0.0.md` for the current release notes; use `vX.Y.Z.md` for the version you are shipping). Actions generates a commit list automatically; replace or append the curated notes on the Release when needed.


## Verification

These are different things.

**Checksums.** `SHA256SUMS` lists hashes for that set. Actions names the files `SHA256SUMS.linux`, `SHA256SUMS.windows`, and `SHA256SUMS.macos` so they can coexist on one Release.

```bash
cd artifacts
sha256sum -c SHA256SUMS
```

A matching hash means the file matches the listed digest. It does not by itself prove who produced the set.

**Project PGP.** Used only by the manual Linux path when the private key is in the local keyring. Typical outputs: `SHA256SUMS.asc` and `.asc` next to the `.deb` and the Linux archive. Public key: [`security/signing-key.asc`](../security/signing-key.asc). GitHub Actions does not sign with this key.

```bash
gpg --import security/signing-key.asc
gpg --verify SHA256SUMS.asc SHA256SUMS
sha256sum -c SHA256SUMS
```

**Platform signing.** Optional. Windows Authenticode and Apple signing/notarization run in Release CI only when secrets are configured. Linux CI does not add a Debian package signature. Missing credentials do not skip packaging. Unsigned artifacts are expected when those secrets are absent.

## Generated output

Packaging writes to `build/`, `dist/`, and `artifacts/`. Those directories are not committed. Private keys and platform certificates are never stored in git.
