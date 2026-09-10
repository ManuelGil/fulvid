# Snap

Notes only. Fulvid is not on the Snap Store. There is no `snap/snapcraft.yaml` and no Snap CI.

| File | Role |
| --- | --- |
| `fulvid.desktop` | Same identity as Debian; `Exec=fulvid` |
| `intended-snapcraft.yaml` | Draft. Not built. |

Intended shape if a prototype is built later: `confinement: strict`, `base: core24`, GNOME extension (WebKitGTK 4.1), `bundleCEF: false`. Portals for files. Do not grant `home`, `network`, `removable-media`, or `personal-files`. Do not use classic confinement.

If a recent folder cannot be reopened after a sandbox restart, re-prompt through the native dialog. Do not widen `workspaceAuthority`.

Public status: [DISTRIBUTION.md](../../../docs/DISTRIBUTION.md).
