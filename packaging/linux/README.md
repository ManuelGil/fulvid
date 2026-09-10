# Linux packaging

Manual Linux release scripts. GitHub Actions does not call this directory for the `.deb`; it inlines the same Debian steps. Procedure: [linux-release.md](../../docs/linux-release.md).

```text
packaging/linux/
  desktop/     Canonical Debian desktop file (used by deb.sh and Actions)
  metainfo/    Candidate AppStream file (id not adopted)
  flatpak/     Notes only - no manifest
  snap/        Desktop variant + intended snapcraft draft
  appimage/    Desktop variant + notes
```

Identity: [DISTRIBUTION.md](../../docs/DISTRIBUTION.md#identity). Snap, AppImage, and Flatpak are not install paths. Do not add Make targets or CI for them until a real artifact can be validated.
