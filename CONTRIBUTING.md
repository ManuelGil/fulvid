# Contributing

Thanks for contributing to Fulvid.

Read [docs/CONCEPTS.md](docs/CONCEPTS.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing behavior. Local setup is in the README.

## Before you change architecture

1. Which owner is responsible? ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md))
2. Does it keep the invariants? ([docs/INVARIANTS.md](docs/INVARIANTS.md))
3. For Graph: extend the projection/layout pipeline or the Sigma view, not both ([docs/GRAPH.md](docs/GRAPH.md))
4. Is there a simpler approach?

Improve an existing owner before adding a file, helper, or abstraction. One user-visible behavior, one owner. Do not add an interface, factory, event bus, or extra module for a single consumer. Duplicate a few lines when the responsibilities should evolve separately.

Keep pull requests focused.

## Practical rules

- UI selection goes through `selectDocument`. `activateDocument` is session-internal. Surfaces open a document through `openOrActivate`. Do not wire editor buffers to Focus changes.
- Folder I/O uses `assertWithinWorkspace` (lexical) plus `assertCanonicallyContained` (symlink/realpath). Standalone Open and Save As use host dialogs and grants. No generic absolute-path read/write RPC.
- Preview and Export HTML share `renderMarkdownPreview`. Do not add a second Markdown renderer.
- Dispose canvas, workers, and observers with their owner ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#resources)).
- Presentation tokens: [`src/mainview/styles/`](src/mainview/styles/). Chrome icons: [`AppIcon.vue`](src/mainview/shell/AppIcon.vue). Quick Actions rules (groups, overflow tiers, a11y): [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#quick-actions-toolbar). Do not fork Monaco or edit `node_modules` for icons; widget Codicons are remapped in `monacoLucideIcons.ts`. Launcher icon: [`assets/README.md`](assets/README.md).
- UI wording: [docs/I18N.md](docs/I18N.md). Settings hints should say what changes, when it applies, and give a concrete example.
- Releases: [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md). Actions is the main path. The Linux Makefile is a local helper.
- User-facing changes: add an entry under `Unreleased` in [CHANGELOG.md](CHANGELOG.md) in the same change. When a version is released, move those entries under that version, open a new empty `Unreleased` section, bump `package.json` / `electrobun.config.ts`, and add `docs/releases/vX.Y.Z.md`. Do not reconstruct a version from git history at the last minute, log every commit, or rewrite a published version except to fix a factual error.
- Trust, filesystem, Preview, CSP, and packaging: [docs/SECURITY-AND-RESILIENCE.md](docs/SECURITY-AND-RESILIENCE.md). Update that document when a listed review trigger fires. Report vulnerabilities via [SECURITY.md](SECURITY.md).
- Extensions (local packs under `userData/extensions`, API v1): [docs/EXTENSIONS.md](docs/EXTENSIONS.md). Packs live in sibling [`fulvid-extensions`](../fulvid-extensions/); Fulvid ships none. Extend through existing owners - do not give packs filesystem, network, process, or live Monaco authority. Contract tests: `tests/extensions/`.

## Desktop toolchain

Electrobun 2 uses Hutch for its devkit. `bun run build` prepares the ignored `.hutch/` projection. `bun run prepare:electrobun` can do that explicitly.

TypeScript 6 is deliberate: TypeScript 7 has no programmatic API yet, and `vue-tsc` / `typescript-eslint` still need the TypeScript 6 API.

Builds use the system webview (`bundleCEF: false`): WKWebView, WebView2, or WebKitGTK.

During `bun run dev`, Vite prebundles Vue and selected Monaco entrypoints (`optimizeDeps.include`) and sets `optimizeDeps.noDiscovery`. The Monaco worker stays outside `optimizeDeps`; optimizing that entry breaks the worker on WebKitGTK. Production uses a separate Rolldown group for Monaco.

### Linux Wayland + `dev:hmr` console noise

Electrobun 2.0.1's Linux native wrapper forces `GDK_BACKEND=x11`, so a Wayland session runs the GTK/WebKitGTK window through XWayland. On that path you may see:

```text
X11 Error: GLXBadWindow (code 168)
ERROR: WebKit encountered an internal error. This is a WebKit bug.
... WebLoaderStrategy.cpp ... internallyFailedLoadTimerFired()
```

Classification (reproduced on Ubuntu 24.04 / Wayland / AMD Mesa / WebKitGTK 2.52.x / Electrobun 2.0.1):

| Message | When | Meaning |
| --- | --- | --- |
| `GLXBadWindow` | HMR and `views://` (no Vite) | XWayland/GLX + WebKit accelerated compositing under Electrobun's forced X11 backend. Not Fulvid application logic. |
| `internallyFailedLoadTimerFired` | Mainly while loading from Vite HMR (`http://127.0.0.1:5173`) | WebKitGTK NetworkProcess internal failures during concurrent Vite module loads. Can drop the HMR WebSocket after it has already connected (`[vite] connected` then `server connection lost`). Does **not** appear on the packaged `views://` path in the same session. |

Impact: the window still starts (`Fulvid started`); Fulvid remains interactive in normal use. These lines are runtime diagnostics, not a Fulvid Annotations/filesystem/security failure. The HMR URL (`ws://127.0.0.1:5173/`, protocol `vite-hmr`) matches the page origin and works from Bun/Chromium. WebKitGTK can still drop the HMR socket under NetworkProcess churn; reconnects are expected until upstream WebKit/Electrobun improve.

Controlled mitigation matrix (about 55s each, same machine/WebKitGTK 2.52.6/Vite 8.2.2/Electrobun 2.0.1, three EditorPage touches):

| Mitigation | reconnect effect | notes |
| --- | --- | --- |
| `server.warmup.clientFiles` | material drop in `connection lost`/min | keep |
| expanded HTTP warmup (extra Monaco/Vue URLs) | **increased** failures and reconnects | do not expand |
| minimal HTTP wait (`/`, `/@vite/client`, `/main.ts`) | readiness gate only | keep small |
| `forwardConsole: false` | no change in reconnect rate | keep for Cursor-agent console hygiene (Vite auto-enables forwardConsole when an agent is detected) |
| `__electrobun` stub | not an HMR metric | keep for rare Vite-HTTP preload race |
| `WEBKIT_DISABLE_COMPOSITING_MODE=1` | separate from HMR; targets `GLXBadWindow` | Linux HMR only |

What Fulvid does:

- `vite.config.ts` `server.warmup.clientFiles` pre-transforms the first-paint graph (measured reduction in HMR reconnect rate; does not silence WebKit).
- `scripts/devHmr.ts` waits only for `/`, `/@vite/client`, and `/main.ts` before `electrobun dev` (do not expand this list without new measurements).
- `vite.config.ts` sets `server.forwardConsole: false` so Cursor-agent sessions do not pipe console over the HMR socket (Vite's default is agent-detected `true`, otherwise `false`). This is not a proven reconnect fix.
- `electrobunClient.ts` installs a minimal `window.__electrobun` bridge if preload has not yet, so Electroview.init does not throw under Vite HTTP.
- `scripts/devHmr.ts` defaults `WEBKIT_DISABLE_COMPOSITING_MODE=1` on Linux when unset (same profile as Linux compatibility CI) for `GLXBadWindow`, not for `WebLoaderStrategy` failures.
- Does **not** filter or hide WebKit/GLX messages.
- Does **not** switch to CEF, add a WebView watchdog, or auto-restart the renderer.
- Does **not** set compositing env in packaged production code; override locally if needed: `WEBKIT_DISABLE_COMPOSITING_MODE=1`.

Upstream direction: Electrobun native Wayland support (remove forced `GDK_BACKEND=x11`) plus WebKitGTK NetworkProcess stability under heavy ESM load. Re-test HMR after Electrobun/WebKitGTK upgrades. No exact upstream bug matching this Vite+Electrobun HMR scenario was identified; related WebKit work exists around NetworkProcess kills under load (RealtimeKit).

When upgrading the desktop stack, re-check:

| Trigger | Where | Why it matters |
| --- | --- | --- |
| Electrobun upgrade that documents Linux ApplicationMenu | `electrobunApplicationMenu.ts`, `applicationMenu.ts`, HTML menubar in `App.vue` | Electrobun 2.0.1 implements the native bar on macOS and Windows only. Linux uses the HTML fallback on purpose. Switch Linux to native only after a packaged GTK/WebKitGTK build shows a real native bar, and confirm the HTML bar is gone. |
| Electrobun stable launcher argv forward, file associations, or single-instance | [docs/EXTERNAL-OPEN.md](docs/EXTERNAL-OPEN.md) Upstream Watch | Packaged Open-with / associations / warm start stay deferred on Electrobun gaps (#483/#554, #551, #465), not on Bun. Do not invent IPC workarounds. |
| Electrobun / webview / `views://` change, enabling CEF, or Vite HMR change | `src/mainview/index.html` CSP, `src/bun/index.ts` view URL | `script-src` / `worker-src` / `style-src` are unset. Vite HMR inlines scripts, Monaco injects styles, and `'self'` on `views://` is unverified. Re-test `bun run dev:hmr` and a packaged build on each OS. |
| Monaco or Vite worker-strategy change | `monacoSetup.ts`, `computeComposedGraph.ts`, `vite.config.ts` | Workers are Vite `?worker` constructors. The Monaco import uses a filesystem path because 0.56's `exports` map doubles `esm/vs`. |
| Bun/runtime gains compare-and-replace | `writeAtomically` / `writeDocument` in `documentIo.ts` | Save is mtime `stat` then temp+rename. That is not an indivisible check+replace. Do not add advisory locks in the meantime. |

These are toolchain notes, not product invariants.

## Testing

Static checks and integration carry most of the signal. A unit test is an exception: it must protect an isolable, stable property. Coverage and test count are not quality metrics.

| Layer | Command | Purpose |
| --- | --- | --- |
| Static | `bun run validate` | Format, i18n, lint, typecheck, unit + integration, build, whitespace, doctor |
| i18n | `bun run i18n:check` | [docs/I18N.md](docs/I18N.md) |
| Dependencies | `bun run deps:check` | Frozen lockfile and known-vulnerability audit |
| Format / lint / types | `bun run format:check`, `bun run lint`, `bun run typecheck` | Prettier, ESLint, `vue-tsc` |
| Unit | `bun run test:unit` | `*.unit.test.ts` |
| Integration | `bun run test:integration` | `*.integration.test.ts` |
| Smoke | `bun run smoke` | `*.smoke.test.ts` plus built shell; optional desktop launch |
| Compatibility smoke | `bun run smoke:compatibility` | Packaged-app CI check (`FULVID_SMOKE_LAUNCH=1` to start the binary) |
| Aggregate | `bun run test` | Unit plus integration (what CI validate runs) |

Write a unit test when the property is deterministic, lives in one module, and integration would bury it. Do not add a unit test to raise coverage, restate TypeScript, freeze private structure, wrap a trivial helper, or duplicate an integration test.

Use integration when the behavior crosses modules, the filesystem, document lifecycle, or the RPC trust boundary. `documentLifecycle.smoke.test.ts` is the reference for a real editing loop. Graph canvas behavior is smoke or manual.

### Cross-platform contract

Fulvid supports Linux, Windows, and macOS. Tests protect the product contract, not accidental properties of the machine that wrote them.

| Do | Do not |
| --- | --- |
| Use `os.tmpdir()` and `tests/support/platform.linkDirectory` | Hardcode `/tmp`, `/home/...`, or Unix-only `symlink` for directory escape cases |
| Assert containment / refuse-don't-fix for Windows-looking paths (`C:\\...`, `C:foo`, `..\\`) even on Linux CI | Assume `/` is the only separator, or that drive letters are "absolute" via Node `isAbsolute` alone |
| Treat `Ctrl` (Windows/Linux) and `Cmd` (macOS) as distinct modifiers; Full Screen is `F11` vs `Ctrl+Cmd+F` | Equate Ctrl with Cmd in shortcut or binding tests |
| Keep EOL/encoding asserts model-owned (LF/CRLF explicit) | Assume OS default EOL, locale, or timezone |
| Skip or inject faults when POSIX `chmod` denial is unavailable (`posixModeBitsDenyAccess`) | Pretend Windows applies Unix mode bits |

`bun run validate` runs the same unit + integration suite on Linux, Windows, and macOS (`validate.yml`). Compatibility workflows package and smoke per OS; they do not replay the full containment suite as a red team. DialogHost keyboard focus trapping, native menus, and fullscreen hit-testing still need a display - they are not proven by unit tests alone.

Put a bug regression at the level where it happens. If TypeScript already makes a state impossible, do not assert that in a unit test.

Before a pull request, run `bun run validate`. When changing lifecycle, Graph, or packaging, also run `bun run smoke` on a machine with a display.

Compatibility CI is three separate workflows (Linux, Windows, macOS). They package and smoke; they do not replace `validate` and they do not publish. Which OS images are tested versus only supported: [docs/compatibility.md](docs/compatibility.md).

## Dependencies

Bun 1.4.2 (host/CI) and `bun.lock` are authoritative for development scripts. Electrobun 2.0.1's Hutch toolchain still pins **Bun 1.4.0** for the packaged `mainProcess: "bun"` runtime - that app runtime is not the host Bun. Run `bun run deps:check` before dependency changes. `bun run deps:outdated` lists updates without applying them. Recheck nested `brace-expansion` when upgrading Bun or Vue tooling. `package.json` `overrides` pin transitive advisories; do not drop a pin without an advisory or a replacement.

Monthly security automation is `.github/workflows/dependency-security.yml`. It is maintainer process, not packaging.
