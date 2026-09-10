# AppImage

Notes only. No Fulvid AppImage is produced.

Electrobun names `Fulvid-Setup.AppImage` in its helpers. It does not emit that file. Do not wrap the `.deb` in an AppImage. WebKitGTK 4.1 stays on the host, same as the `.deb`. Do not bundle `libwebkit2gtk-4.1`.

`fulvid.desktop` here uses `Exec=fulvid`. Icon: `assets/fulvid.png`.

If an AppImage is ever built, the public name should be `fulvid_<version>_linux-x64.AppImage` and it should be hashed in `SHA256SUMS` like the `.deb`.

Public status: [DISTRIBUTION.md](../../../docs/DISTRIBUTION.md).
