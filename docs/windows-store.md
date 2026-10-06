# Windows and Microsoft Store

How Fulvid is built for Windows, what Electrobun 2.0.1 produces, and the path to a Microsoft Store listing. Audited on Windows 11 24H2 (build 26100, x64) with Electrobun 2.0.1 / Hutch 0.24.3, Bun 1.4.2, WebView2 Runtime 154.

**Status: ready to upload, not yet submitted.** `fulvid_1.1.0_win-x64.msix` builds with the Store identity, passes MakeAppx unpacking and a block-by-block block map check, and its content launches (from the unpacked package). It has not been installed as a package or run through the Windows App Certification Kit (`appcert.exe` requires an elevated session). See [Submission](#submission).

## Store identity

From Partner Center (Fulvid > Product management > Product identity). Values are case-sensitive and must match exactly.

| Field | Value |
| --- | --- |
| Package/Identity/Name | `imgildev.Fulvid` |
| Package/Identity/Publisher | `CN=A78087F6-DF94-4D2F-8347-B7436A28BB44` |
| Package/Properties/PublisherDisplayName | `imgildev` |
| Package Family Name | `imgildev.Fulvid_gg7q8rg8tnsce` (derived by Windows; not a manifest field) |
| Store ID | `9NJJX2BGLFDM` (listing reference; not a manifest field) |

`package-msix.ps1` uses these values by default. `MSIX_IDENTITY_NAME`, `MSIX_PUBLISHER`, and `MSIX_PUBLISHER_DISPLAY_NAME` override them only when all three are set; a partial override fails the build, and any override that differs from the Store identity is recorded as `"artifact": "not-for-store"` in `msix-build.json`.

The Electrobun identifier `fulvid.imgil.dev` is a different thing: it names the app's data folder (`%LOCALAPPDATA%\fulvid.imgil.dev`) and stays unchanged.

## Platform policy

| Platform | Target |
| --- | --- |
| Windows 11 x64 | Microsoft Store (MSIX) and direct download (GitHub Releases) |
| Windows 10 | Not a target. No Windows 10-specific work is done or kept. |
| Windows Server | Not a target. |
| Windows on Arm, 32-bit | Not a target (see [Architecture](#architecture)). |
| Linux | Unchanged; see [compatibility.md](./compatibility.md). |
| macOS | Unchanged; see [compatibility.md](./compatibility.md). |

This is a Windows packaging decision. It lives in `packaging/windows/`, the Windows CI jobs, and this document; it does not change shared code or the Linux and macOS builds.

## What Electrobun produces

`electrobun build --env=stable` writes `build/stable-win-x64/` and `artifacts/`:

| File | What it is |
| --- | --- |
| `Fulvid-Setup.exe` + `.installer/` | Per-user installer. Needs the `.installer/` folder beside it, so it ships as a zip. |
| `stable-win-x64-Fulvid.tar.zst` | Update bundle: the complete app tree (`Fulvid/bin`, `Fulvid/Resources`). |
| `stable-win-x64-update.json` | Update metadata. |

`packaging/windows/package.ps1` renames these to `fulvid_<version>_win-x64-Setup.zip`, `fulvid_<version>_win-x64.tar.zst`, and `fulvid_<version>_win-x64-update.json`. Those three, plus `build.log`, `release-manifest.json`, and `SHA256SUMS`, are the GitHub Release assets.

Observed behavior of `Fulvid-Setup.exe`:

- Extracts to `%LOCALAPPDATA%\fulvid.imgil.dev\stable\app`. No UAC prompt.
- Creates Desktop and Start Menu shortcuts.
- Registers `HKCU\...\Uninstall\fulvid.imgil.dev.stable` with a `QuietUninstallString` (`uninstall.exe --uninstall --quiet`). Quiet uninstall works and removes the files, the shortcuts, and the key.
- Finishes with a modal "Installation complete" dialog. **There is no silent install:** every switch tried (`--quiet`, `/S`, `/quiet`, `--silent`, `/silent`, `/VERYSILENT`) exits 1 without installing.
- The `.exe`/`.dll` files have no version resource (ProductName, FileVersion, etc. are empty) and are unsigned. Electrobun 2.0.1 has no option to set either.

At runtime the app keeps its data in `%LOCALAPPDATA%\fulvid.imgil.dev\stable\`: `window-frame.json`, `extensions\`, and the WebView2 user data folder. The only write next to its binaries is Electrobun's native debug log, `bin\app.log`. The app doesn't depend on it: a copy of the app tree in a read-only folder starts and renders normally, without the log.

## Why MSIX and not EXE/MSI

The Store accepts EXE/MSI installers only if [all of these hold](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msi/app-package-requirements): a single `.exe` or `.msi`, a silent install, a standalone/offline installer, and every PE file signed with a certificate from the Microsoft Trusted Root Program. The Electrobun installer fails the first three, and its PE files sit inside a compressed payload where an Authenticode step can't reach them. Meeting those rules would mean a second, third-party installer around Electrobun.

MSIX doesn't need any of that. The update bundle already holds the complete app tree. Fulvid doesn't self-update (no `release.baseUrl`; it only reads `Updater.localInfo.channel()`), so Store-managed updates conflict with nothing. The Store signs MSIX packages itself, so no certificate is needed for the Store build.

`packaging/windows/package-msix.ps1`:

1. Extracts the update bundle with `System32\tar.exe`. The app tree becomes the package root.
2. Checks that `version.json` matches `package.json`, that the identifier is `fulvid.imgil.dev`, and that every `.exe`/`.dll` is x64.
3. Inspects the PE certificate directory of every `.exe`/`.dll` and repairs only the known Hutch defect (see [PE certificate repair](#pe-certificate-repair)).
4. Generates the tile/logo PNGs from `assets/fulvid.png`.
5. Renders [packaging/windows/msix/AppxManifest.xml.in](../packaging/windows/msix/AppxManifest.xml.in) with the [Store identity](#store-identity): full-trust desktop app, entry point `bin\launcher.exe`, `runFullTrust`.
6. Runs `makeappx pack`, then checks the package for the manifest, the launcher, Bun, `glue.wasm`, and `index.html`.

Output goes to `artifacts-msix/`: `fulvid_<version>_win-x64.msix` (unsigned; this is the file to upload), `msix-build.json`, and `SHA256SUMS`. The hashes in both describe that unsigned file. It is kept apart from `artifacts/` so the GitHub Release set doesn't change.

### PE certificate repair

Hutch 0.24.3 embeds the app icon into the packaged `bun.exe` (Bun 1.4.0). That rewrite drops Bun's Authenticode signature, but the PE header's certificate entry (`IMAGE_DIRECTORY_ENTRY_SECURITY`) still points past the end of the file: offset 88,815,616, size 10,328, file size 88,664,064. SignTool, and therefore the Store's own signing, refuse such a package with `0x800700C1` ("File has malformed certificate"); Microsoft documents this as a [bad PE certificate](https://learn.microsoft.com/windows/msix/package/signing-known-issues).

`package-msix.ps1` zeroes exactly those 8 bytes, only when the entry is non-zero and runs past the end of the file. File size, code, sections, imports, and timestamps are unchanged; the file is re-inspected afterwards and must report no certificate. Any other PE inconsistency (bad headers, misaligned or overlapping table, invalid `WIN_CERTIFICATE`, overflow) fails the build instead of being repaired. Valid signatures are left alone. Each repair is logged with SHA-256 before and after and recorded under `peCertificateRepairs` in `msix-build.json`. The Hutch cache is never modified, and the repair only applies to the MSIX staging copy, not to the Setup zip.

What the manifest intentionally leaves out:

- **File type associations.** Electrobun 2.0.1 doesn't forward launcher arguments to the Bun host ([EXTERNAL-OPEN.md](./EXTERNAL-OPEN.md)), so an "Open with Fulvid" entry would launch the app without the file.
- **Pre-release versions.** MSIX versions are `Major.Minor.Build.0`; the Store reserves the fourth part. `1.1.0` becomes `1.1.0.0`. A version like `1.2.0-beta.1` gets no MSIX (`-SkipPrerelease` in CI).

### Behavior inside the package

These follow from MSIX rules. The packaged content was launched from the unpacked `.msix` (window, WebView2, no external connections, clean exit), but not from an installed package:

- The app runs from the read-only `WindowsApps` folder. The read-only test above covers this; `bin\app.log` is not written there.
- Writes to `%LOCALAPPDATA%\fulvid.imgil.dev\` are redirected to the package's private storage. Settings from a Setup.exe install aren't shared with the Store install, and uninstalling the package removes them.
- Files the user opens or saves through the native dialogs are ordinary filesystem access under `runFullTrust`.
- Bun, Wasmoon (`glue.wasm` loaded from `Resources/app/bun`), and Monaco are files inside the package; nothing is fetched remotely.

## WebView2

`bundleCEF: false` makes Electrobun use the system WebView2. The loader is statically linked into `libNativeWrapper.dll`. It looks up the Evergreen runtime (`EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`); there is no Fixed Version runtime and no bootstrapper.

The Evergreen WebView2 Runtime [is part of Windows 11](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution), so a clean Windows 11 install has it and works offline. Fulvid adds no Fixed Version runtime, no bootstrapper, and no runtime download, and the MSIX declares no dependency for it.

The manifest declares `MinVersion="10.0.22000.0"` (Windows 11) and `MaxVersionTested="10.0.26100.0"` (24H2, the audit machine). That minimum is the product target, not a workaround: Windows 10 is outside it (see [Platform policy](#platform-policy)). Raise `MaxVersionTested` only after testing on a newer build.

## Updates

The Store build has one update path: the Microsoft Store. 1.1.0 ships as package version `1.1.0.0`; 1.1.1 ships as `1.1.1.0` with the same identity, and the Store installs it over the old one.

Electrobun's updater stays inert:

- `electrobun.config.ts` has no `release.baseUrl`, so `Resources/version.json` has `"baseUrl": ""`.
- Fulvid only calls `Updater.localInfo.channel()`. It never checks for, downloads, or applies an update.

The package does contain Electrobun's update helpers (`bspatch.exe`, `zig-zstd.exe`, `launcher.exe --apply-update`), but nothing calls them. If `release.baseUrl` is ever set, the Store build must keep it empty: an update would try to write into the read-only package folder.

## Privacy

Audited in the source (`src/`), the packaged bundle, and a launch with network monitoring:

- No telemetry, analytics, or crash/error reporting, and no such dependency in `package.json`.
- No document content leaves the machine. Preview and Export HTML render images as placeholders, so documents trigger no network requests ([SECURITY-AND-RESILIENCE.md](./SECURITY-AND-RESILIENCE.md)).
- Network use is limited to:
  - a `HEAD` request to the local Vite dev server (`127.0.0.1:5173`), only in the `dev` channel;
  - opening the sponsor page, or an `https:`/`mailto:` link the user clicks, in the default browser.
- Wasmoon's built-in `unpkg.com` fallback is never used: Fulvid always passes the packaged `glue.wasm` path.
- A packaged launch made no external TCP connections from `launcher.exe` or `bun.exe`.

WebView2 is a Windows component and follows Windows' own diagnostic data settings; Fulvid doesn't configure it.

The public privacy policy is [privacy-policy.html](./privacy-policy.html), a static page served by GitHub Pages from `docs/` on `main` (`docs/.nojekyll` turns off Jekyll). Its URL is `https://manuelgil.me/fulvid/privacy-policy.html` once Pages is enabled for the repository: the account's GitHub Pages domain is `manuelgil.me`.

## runFullTrust

The manifest declares the restricted capability `runFullTrust`. Partner Center asks for a justification of each restricted capability on the submission's *Submission options* page ([capability declarations](https://learn.microsoft.com/windows/apps/package-and-deploy/app-capability-declarations)). Suggested text, limited to what Fulvid does:

> Fulvid is a Win32 desktop application packaged with MSIX (Electrobun framework, `Windows.FullTrustApplication` entry point). Its native launcher starts a bundled Bun runtime process that hosts the application and renders the UI with the system WebView2. These are ordinary desktop processes running at medium integrity, outside the UWP app container; runFullTrust is what allows this packaged Win32 application to run. Fulvid uses it for nothing else: no elevation, no services, no drivers.

Microsoft's documentation states that a medium-integrity packaged app needs `runFullTrust`. Removing it would not simplify certification; the package would not run.

## Architecture

x64 only. ARM64 is not offered:

- Electrobun 2.0.1 publishes its build tooling (Hutch) for `windows-x64` only; there is no `windows-arm64` host build.
- `electrobun.config.ts` has no Windows architecture setting.
- The packaged `bun.exe`, `launcher.exe`, and DLLs are all x64 (`verify.ps1` and `package-msix.ps1` check this).

An x64 MSIX also runs under emulation on Windows 11 ARM64 devices, but that is untested.

## Signing

| Build | Signed by | Notes |
| --- | --- | --- |
| Local (`bun run release`) | Nobody | Expected. |
| CI Setup zip | `sign-authenticode.ps1`, only when `WINDOWS_CERTIFICATE` / `WINDOWS_CERTIFICATE_PASSWORD` secrets exist | Signs `Fulvid-Setup.exe` only; the app binaries inside the payload stay unsigned. |
| MSIX (local and CI) | Nobody | Uploaded unsigned to Partner Center. |
| Store MSIX delivered to users | Microsoft | The Store signs the package during publishing. |

No production certificate is needed or kept for the Store build. The self-signed `CN=Fulvid Development` certificate was only used once, locally, to confirm that the repaired package signs. It is not a production identity and does not match the Store `Publisher`. Sideloading the Store package for a test would need a separate test certificate whose subject is `CN=A78087F6-DF94-4D2F-8347-B7436A28BB44`, applied to a copy of the `.msix`, never to the file uploaded to Partner Center.

## Building

Windows, from the repo root. PowerShell 7 (`pwsh`) is required for `package.ps1`; `package-msix.ps1` also runs on Windows PowerShell 5.1.

```powershell
pwsh -File packaging/windows/package.ps1        # app + Setup zip into artifacts/
pwsh -File packaging/windows/verify.ps1
pwsh -File packaging/windows/package-msix.ps1   # MSIX into artifacts-msix/ (needs Windows SDK makeappx)
```

From Git Bash, `bun run release` fails at `hutch electrobun: command failed: tar` (`tar: Cannot connect to D: resolve failed`). Git's GNU tar shadows Windows' bsdtar. `package.ps1` puts System32 first; for a bare `bun run release`, do the same:

```bash
PATH="/c/Windows/System32:$PATH" bun run release
```

Without the Windows SDK, `-StageOnly` builds and checks `build/msix-stage/` (manifest included) without packing.

## CI

`release.yml`, job **Windows**, after the existing package/sign/verify steps:

- **Package MSIX (Microsoft Store)** runs `package-msix.ps1 -SkipPrerelease`, using the `makeappx.exe` from the Windows SDK on `windows-2025`.
- **Upload MSIX** saves the workflow artifact `fulvid-windows-msix`. It is not attached to the GitHub Release.

`compatibility-windows.yml` also builds the MSIX, so a broken layout fails on `main`.

Both use the [Store identity](#store-identity) built into the script. The repository variables `MSIX_IDENTITY_NAME`, `MSIX_PUBLISHER`, and `MSIX_PUBLISHER_DISPLAY_NAME`, which `release.yml` passes through, are optional overrides; leave them unset.

## Submission

Partner Center accepts a single-architecture `.msix` directly; no `.msixbundle` or `.msixupload` is needed. In the Fulvid submission:

1. **Packages:** upload `artifacts-msix/fulvid_1.1.0_win-x64.msix` (from a local build, or the `fulvid-windows-msix` artifact of a tagged Release run).
2. **Submission options:** paste the [runFullTrust](#runfulltrust) justification.
3. **Store listing and properties:** description, screenshots (`assets/screenshots/`), the [privacy policy](#privacy) URL, and age rating.

The Windows App Certification Kit is an optional pre-check. It needs an elevated session: `appcert.exe test -appxpackagepath <msix> -reportoutputpath <report.xml>`. It isn't installed on the `windows-2025` runner.
