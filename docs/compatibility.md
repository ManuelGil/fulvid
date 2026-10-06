# Compatibility

What Fulvid runs on, what CI actually exercises, and what that does not mean.

These checks live in three independent workflows. They do not publish. They do not share `needs` with each other or with `release.yml`.

```text
.github/workflows/compatibility-linux.yml
.github/workflows/compatibility-windows.yml
.github/workflows/compatibility-macos.yml
```

## When compatibility CI runs

| Event | Effect |
| --- | --- |
| Push to `main` | Package + smoke on the pinned OS images |
| `workflow_dispatch` | Same package + smoke, on demand |
| Pull request | Does **not** run (PRs use `validate.yml` only) |
| Tag `v*` | Does **not** run (official packaging is `release.yml`) |

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
| Ubuntu 26.04 | Supported as a WebKitGTK 4.1 host. **Not tested** in this matrix (no GitHub-hosted job yet) |
| Ubuntu 22.04, Debian 12 | Unsupported. Electrobun 2.0.1 ships Cottontail 0.5.0 (`GLIBC_2.38`, `GLIBCXX_3.4.32`) and `libNativeWrapper.so` (`GLIBC_2.38`, `GLIBCXX_3.4.32`). Ubuntu 22.04 is glibc 2.35; Debian 12 is glibc 2.36 |
| Ubuntu 20.04, Debian 11, 32-bit | Unsupported |

Build compatibility (Electrobun + Vite + Bun 1.4.2 host/CI) and runtime compatibility (those shared libraries present at launch) are different. The packaged Bun runtime remains Electrobun's Hutch pin (1.4.0 with Electrobun 2.0.1). The Linux jobs install the libraries, then package, then launch.

The encoding boundary (`src/bun/filesystem/io/documentText.ts`) runs on that packaged Bun, not the host one, so the Web APIs it depends on were checked against the packaged binary itself (`build/<env>-linux-x64/Fulvid*/bin/bun`, Bun 1.4.0). `TextDecoder("utf-16le")`, `TextDecoder("utf-16be")`, `TextDecoder("utf-8", { fatal: true })` with `ignoreBOM`, and `TextEncoder` all behave there as they do on the host: the four supported encodings round-trip and re-detect, and malformed UTF-8 and UTF-16 are refused rather than replaced with U+FFFD. Verified on Linux x64. The macOS and Windows packaged runtimes use the same Bun version but different binaries and have not been checked this way.

Local smoke after a Linux package:

```bash
FULVID_SMOKE_LAUNCH=1 bun run smoke:compatibility
```

Without `FULVID_SMOKE_LAUNCH`, the script still checks `dist/` and re-runs the filesystem editing-loop integration test.

Linux compatibility CI launches under Xvfb with `GDK_BACKEND=x11` and `WEBKIT_DISABLE_COMPOSITING_MODE=1`. On a local Wayland desktop, Electrobun 2.0.1 still forces X11 (XWayland); `GLXBadWindow` and occasional WebKit `internallyFailedLoadTimerFired` lines during `bun run dev:hmr` are documented under [CONTRIBUTING.md](../CONTRIBUTING.md#linux-wayland--devhmr-console-noise). They are not treated as Fulvid application regressions.

## Windows

Packaging is 64-bit only (`win-x64`). Fulvid targets Windows 11 x64 desktop (WebView2), for both the Microsoft Store MSIX and the GitHub Release download. Windows 10 and Windows Server are not targets, and there is no compatibility matrix for them.

GitHub-hosted CI for Windows uses the `windows-2025` runner label (the current GitHub image for Windows jobs). That label names the runner image, not a Fulvid platform. Job titles are simply **Windows**.

| Image / target | Role |
| --- | --- |
| Windows 11 x64 | Supported desktop target. Compatibility and Validate run Windows packaging/smoke on the `windows-2025` GitHub runner as a stand-in |
| Windows 10, Windows Server | Not targets |
| Windows 11 Arm, 32-bit | Unsupported |

No Authenticode and no secrets on Compatibility Windows jobs. Compatibility Windows also builds the Store MSIX (not uploaded). WebView2, ARM64, and the Store path: [windows-store.md](./windows-store.md).

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
| Windows x64 | Tested | **Verified** (Compatibility Windows CI) |
| macOS arm64 | Tested | **Verified** (Compatibility macOS CI - 26 Apple Silicon) |

Evidence: Compatibility Linux / Windows / macOS workflows on `main` (see When compatibility CI runs). Packaged Lua runtime is verified on the three supported desktop architectures above.

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

- GitHub Releases (see [DISTRIBUTION.md](./DISTRIBUTION.md); tags `v*` via `release.yml`)
- Snap, AppImage, Flatpak
- Signing
