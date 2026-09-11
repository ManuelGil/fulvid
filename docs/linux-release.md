# Manual Linux release

Local helper for a Linux artifact set. It does not replace GitHub Actions and does not publish a GitHub Release.

The Makefile runs `packaging/linux/` (`package.sh`, `release.sh`, `verify.sh`, `clean.sh`). It does not build Windows, macOS, Snap, Flatpak, or AppImage.

Debian desktop file: [packaging/linux/desktop/fulvid.desktop](../packaging/linux/desktop/fulvid.desktop). Actions copies the same file.

## Requirements

- Linux x86_64
- [Bun](https://bun.sh) 1.4.0 or newer
- `dpkg-deb`
- `gpg` and the matching private key in the local GnuPG keyring, if you want a signed set

Public key: [`security/signing-key.asc`](../security/signing-key.asc).

## Commands

From the repository root:

```bash
make package
make release
make verify-release
make clean
```

`bun run release` is the Electrobun stable app build, not this packaging flow.

- `make package` builds Electrobun stable output, applies public names, builds the `.deb`, and writes `SHA256SUMS`.
- `make release` runs `make package`, then writes `build.log` and `release-manifest.json`, refreshes checksums, signs when the private key is available, and verifies.
- `make verify-release` checks an existing `artifacts/` directory. It does not rebuild.
- `make clean` removes generated `build/`, `dist/`, and `artifacts/` output.

Signed (default when the key is in the keyring):

```bash
make release
```

Non-interactive:

```bash
FULVID_SIGNING_PASSPHRASE='...' make release
```

Unsigned local check:

```bash
FULVID_RELEASE_SIGN=0 make release
bash packaging/linux/verify.sh --allow-unsigned
```

A signed set includes the `.deb`, the `-Setup.tar.gz` archive, their `.asc` files when signed, the update pair, `SHA256SUMS`, and `SHA256SUMS.asc`. Artifact names use the version in `package.json`: [DISTRIBUTION.md](./DISTRIBUTION.md#artifacts).

```bash
make verify-release
gpg --import security/signing-key.asc
gpg --verify artifacts/SHA256SUMS.asc artifacts/SHA256SUMS
(cd artifacts && sha256sum -c SHA256SUMS)
```

Copy the files you need onto a GitHub Release yourself. Use the matching file under [releases/](./releases/) as the body (`v0.3.0.md` for this version).
