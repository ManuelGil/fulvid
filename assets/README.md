# Application icon

`logo.png` is the source. Do not overwrite it, redraw it, or invent a vector substitute.

Derived files are produced from that PNG by `scripts/generateIcons.sh`. They are versioned because Linux, Windows, and macOS CI do not share the same icon tools, and Electrobun expects these inputs already present:

| File | Role |
| --- | --- |
| `logo.png` | Source, 512x512 RGBA |
| `fulvid.png` | Linux Electrobun (`build.linux.icon`) and Debian hicolor 512x512 |
| `fulvid.ico` | Windows Electrobun (`build.win.icon`) |
| `macos/fulvid.iconset/` | macOS Electrobun (`build.mac.icons`) |

Regenerate on Ubuntu with ImageMagick (`convert`), `optipng`, and `icotool`:

```bash
bash scripts/generateIcons.sh
```

Electrobun converts the iconset to `.icns` with `iconutil` during a macOS build. That step is not run on Linux. There is no checked-in `.icns` and no 1024x1024 `@2x` frame: the source is 512x512 and is not upscaled.

`AppIcon.vue` is UI chrome, not this application icon.

Window captures: [screenshots/README.md](./screenshots/README.md).
