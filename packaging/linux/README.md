# Linux packaging

Linux packaging scripts and desktop/metainfo stubs.

- **Release workflow** (`release.yml`): inlines Debian packaging steps; uses `desktop/fulvid.desktop` and `runtime-libraries.tsv` from this tree. It does not call `make` or `package.sh`.
- **Compatibility Linux** (`compatibility-linux.yml`): runs `package.sh` (which sources `lib.sh` and `deb.sh`) for package + smoke.
- **Manual maintainer path**: `make` + scripts here. Procedure: [linux-release.md](../../docs/linux-release.md).

```text
packaging/linux/
  desktop/     Canonical Debian desktop file (used by deb.sh and Actions)
  metainfo/    Candidate AppStream file (id not adopted)
  flatpak/     Notes only - no manifest
  snap/        Desktop variant + intended snapcraft draft
  appimage/    Desktop variant + notes
```

Identity: [DISTRIBUTION.md](../../docs/DISTRIBUTION.md#identity). Snap, AppImage, and Flatpak are not install paths. Do not add Make targets or CI for them until a real artifact can be validated.
