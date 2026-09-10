# Compatibility

What Fulvid runs on, what CI actually exercises, and what that does not mean.

These checks live in three independent workflows. They do not publish. They do not share `needs` with each other or with `release.yml`. The release gate stays off.

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

Runtime needs the system webview: WebKitGTK 4.1, GTK 3, soup-3, JavaScriptCore 4.1, and Ayatana/dbusmenu. Those are the Debian `Depends` of the `.deb`. Ubuntu 20.04 and Debian 11 do not ship WebKitGTK 4.1 in a form we can use. They are unsupported.

| Image | Role |
| --- | --- |
| Ubuntu 24.04 (`ubuntu-24.04`) | Tested. Build, `.deb`, launch under Xvfb, filesystem smoke |
| Ubuntu 22.04 (`ubuntu-22.04`) | Tested. Same checks. Previous LTS that still has WebKitGTK 4.1. The GitHub image starts deprecation in September 2026 |
| Debian 13 (`debian:13` container) | Tested separately from Ubuntu. Same checks |
| Ubuntu 26.04 | Current Ubuntu LTS. Supported as a WebKitGTK 4.1 host. **Not tested** here: the GitHub runner image is still preview |
| Ubuntu 20.04, Debian 11, 32-bit | Unsupported |

Build compatibility (Electrobun + Vite + Bun 1.4.0) and runtime compatibility (those shared libraries present at launch) are different. The Linux jobs install the libraries, then package, then launch.

Local smoke after a Linux package:

```bash
FULVID_SMOKE_LAUNCH=1 bun run smoke:compatibility
```

Without `FULVID_SMOKE_LAUNCH`, the script still checks `dist/` and the filesystem editing loop.

## Windows

Packaging is 64-bit only (`win-x64`). GitHub does not offer Windows 10 or Windows 11 x64 desktop runners. Windows 11 Arm runners exist; Fulvid does not ship `win-arm64`.

| Image | Role |
| --- | --- |
| Windows Server 2025 (`windows-2025`) | Tested. Stand-in for a current Windows 11 x64 stack (WebView2) |
| Windows Server 2022 (`windows-2022`) | Tested. Stand-in for a Windows 10-era x64 stack |
| Windows 10 x64, Windows 11 x64 | Supported desktop targets. Not tested as those SKUs |
| Windows 11 Arm, 32-bit | Unsupported |

No Authenticode and no secrets on these jobs.

## macOS

The published artifact is Apple Silicon. Intel packaging scripts exist; they are not an Actions publish target and there is no current Intel compatibility job.

| Image | Role |
| --- | --- |
| macOS 26 (`macos-26`) | Tested. Apple Silicon |
| macOS 15 (`macos-15`) | Tested. Previous Apple Silicon image |
| Intel macOS | Not a published channel. Not tested |
| macOS 14 | GitHub image is retiring. Not in the matrix |

No Apple signing secrets on these jobs.

## What the smoke covers

`bun run smoke:compatibility` (`scripts/compatibilitySmoke.ts`):

1. The Vite shell in `dist/` is present
2. The real filesystem loop creates, reads, writes, and scans a temporary folder
3. When `FULVID_SMOKE_LAUNCH=1`, the packaged binary starts and is then stopped

It is not UI automation. It does not click the GTK file dialog.

`bun run validate` stays the contributor gate (format, lint, types, tests, web build). Compatibility CI packages the desktop app. Run `bun run smoke` locally when you change lifecycle or Graph and have a display.

## Not this CI

- GitHub Releases
- Snap, AppImage, Flatpak
- Signing
- Changing `false && startsWith(github.ref, 'refs/tags/v')`
