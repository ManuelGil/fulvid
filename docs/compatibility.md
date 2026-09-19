# Compatibility

What Fulvid runs on, what CI actually exercises, and what that does not mean.

These checks live in three independent workflows. They do not publish. They do not share `needs` with each other or with `release.yml`.

```text
.github/workflows/compatibility-linux.yml
.github/workflows/compatibility-windows.yml
.github/workflows/compatibility-macos.yml
```

## Words

| Word | Means |
| --- | --- |
| **Tested** | A GitHub-hosted job built, packaged, and ran the compatibility smoke on that image |
| **Supported** | A platform we intend people to run. It may be tested, or it may share the same runtime as a tested image |
| **Unsupported** | Not a product target. Compiling there by accident is not support |

A green compile is not a supported OS. A missing CI image is not a claim that the OS works.

## Linux (Debian-based x64)

Runtime needs the system libraries Electrobun 2.0.1 `libNativeWrapper.so` links: WebKitGTK 4.1, GTK 3, soup-3, JavaScriptCore 4.1, Ayatana AppIndicator 3, and dbusmenu. The Debian `Depends` and `bun run doctor` read the same list: [packaging/linux/runtime-libraries.tsv](../packaging/linux/runtime-libraries.tsv). Ubuntu 20.04 and Debian 11 do not ship WebKitGTK 4.1 in a form we can use. They are unsupported.

Electrobun's CLI (`electrobun.cjs`) and Vite's CLI start with `#!/usr/bin/env node` and declare Node >= 18. That is a build-host requirement. The packaged app does not need Node. `debian:13` has no `node`; the Debian compatibility job installs Node 20. Ubuntu runners already provide it.

| Image | Role |
| --- | --- |
| Ubuntu 24.04 (`ubuntu-24.04`) | Tested. Build, `.deb`, launch under Xvfb, filesystem smoke |
| Debian 13 (`debian:13` container) | Tested separately from Ubuntu. Same checks |
| Ubuntu 26.04 | Current Ubuntu LTS. Supported as a WebKitGTK 4.1 host. **Not tested** here: the GitHub runner image is still preview |
| Ubuntu 22.04, Debian 12 | Unsupported. Electrobun 2.0.1 ships Cottontail 0.5.0 (`GLIBC_2.38`, `GLIBCXX_3.4.32`) and `libNativeWrapper.so` (`GLIBC_2.38`, `GLIBCXX_3.4.32`). Ubuntu 22.04 is glibc 2.35; Debian 12 is glibc 2.36 |
| Ubuntu 20.04, Debian 11, 32-bit | Unsupported |

Build compatibility (Electrobun + Vite + Bun 1.4.2 host/CI) and runtime compatibility (those shared libraries present at launch) are different. The packaged Bun runtime remains Electrobun's Hutch pin (1.4.0 with Electrobun 2.0.1). The Linux jobs install the libraries, then package, then launch.

Local smoke after a Linux package:

```bash
FULVID_SMOKE_LAUNCH=1 bun run smoke:compatibility
```

Without `FULVID_SMOKE_LAUNCH`, the script still checks `dist/` and the filesystem editing loop.

Linux compatibility CI launches under Xvfb with `GDK_BACKEND=x11` and `WEBKIT_DISABLE_COMPOSITING_MODE=1`. On a local Wayland desktop, Electrobun 2.0.1 still forces X11 (XWayland); `GLXBadWindow` and occasional WebKit `internallyFailedLoadTimerFired` lines during `bun run dev:hmr` are documented under [CONTRIBUTING.md](../CONTRIBUTING.md#linux-wayland--devhmr-console-noise). They are not treated as Fulvid application regressions.

## Windows

Packaging is 64-bit only (`win-x64`). GitHub does not offer Windows 10 or Windows 11 x64 desktop runners. Windows 11 Arm runners exist; Fulvid does not ship `win-arm64`.

| Image | Role |
| --- | --- |
| Windows Server 2025 (`windows-2025`) | Tested. Stand-in for a current Windows 11 x64 stack (WebView2) |
| Windows 10 x64, Windows 11 x64 | Supported desktop targets. Not tested as those SKUs |
| Windows Server 2022 | Not in the compatibility matrix (older stand-in dropped as redundant with Server 2025) |
| Windows 11 Arm, 32-bit | Unsupported |

No Authenticode and no secrets on these jobs.

## macOS

The published artifact is Apple Silicon. Intel packaging scripts exist; they are not an Actions publish target and there is no current Intel compatibility job.

| Image | Role |
| --- | --- |
| macOS 26 (`macos-26`) | Tested. Apple Silicon |
| macOS 15 | Not in the compatibility matrix (previous image dropped as redundant with macOS 26) |
| Intel macOS | Not a published channel. Not tested |
| macOS 14 | GitHub image is retiring. Not in the matrix |

No Apple signing secrets on these jobs.

## Lua packaged runtime (distinct from platform support)

`platform supported` (desktop Fulvid runs) is not the same as `Lua packaged runtime verified` (wasmoon `glue.wasm` ships and initializes inside the Electrobun artifact).

| Platform | Desktop compatibility CI | Lua packaged smoke (`bun run smoke:lua-packaged`) |
| --- | --- | --- |
| Linux x64 | Tested | **Verified** (local + Compatibility Linux CI) |
| Windows x64 | Tested | **Verified** (Compatibility Windows CI - Server 2025) |
| macOS arm64 | Tested | **Verified** (Compatibility macOS CI - 26 Apple Silicon) |

Evidence (Compatibility CI): [Windows run 34909418780](https://github.com/ManuelGil/fulvid/actions/runs/34909418780), [macOS run 34909421392](https://github.com/ManuelGil/fulvid/actions/runs/34909421392). Packaged Lua runtime is verified on the three supported desktop architectures above.

The Lua smoke checks packaged `bun/glue.wasm`, Wasm init, discovery + `ui.notify`, invalid-pack isolation, and lightweight interrupt/memory probes against the packaged module. It does not launch the UI and does not replace `smoke:compatibility`.

Editor APIs (`editor.getSelection` / `editor.replaceSelection`) are **PRODUCTION** under Extension API v1. Snapshot includes selection text plus host-only identity stamps; apply rejects stale operations. Capability isolation is not an OS sandbox. Full contract: [EXTENSIONS.md](./EXTENSIONS.md).

## What the smoke covers


`bun run smoke:compatibility` (`scripts/compatibilitySmoke.ts`):

1. The Vite shell in `dist/` is present
2. The real filesystem loop creates, reads, writes, and scans a temporary folder
3. When `FULVID_SMOKE_LAUNCH=1`, the packaged binary starts and stays loaded long enough to observe, then is stopped. On Linux and Windows the build-tree `launcher` is Electrobun's self-extractor; the smoke requires the installed runtime (`fulvid.imgil.dev`) to remain alive if the extractor exits. `Fulvid-Setup.exe` is not the runtime.

It is not UI automation. It does not click the GTK file dialog.

`bun run validate` stays the contributor gate (format, lint, types, tests, web build). Compatibility CI packages the desktop app. Run `bun run smoke` locally when you change lifecycle or Graph and have a display.

Lua packaged smoke (after packaging on the current OS): `bun run smoke:lua-packaged` checks that Electrobun copied `bun/glue.wasm`, that Wasm initializes from those bytes, that discovery + `ui.notify` + invalid-pack isolation work against a temp `userData/extensions`, and that interrupt/memory budgets still fire against the packaged module. It does not replace launch smoke and is not UI automation. See the Lua packaged matrix above.

## Not this CI

- GitHub Releases
- Snap, AppImage, Flatpak
- Signing
- Changing the publish gate (`true`/`false` && `startsWith(github.ref, 'refs/tags/v')`) in `release.yml`
