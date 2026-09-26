# Architecture

Who owns behavior in Fulvid.

Vocabulary: [CONCEPTS.md](./CONCEPTS.md). Rules: [INVARIANTS.md](./INVARIANTS.md). Graph pipeline: [GRAPH.md](./GRAPH.md).

Every user-visible behavior has **one owner**. Pages and the shell choose what is on screen; they do not own product rules. Reuse the document session, buffers, document-link parse/resolve (`documentLink` + `linkSemantics`), Preview renderer, and filesystem RPC. Do not add a second store, parser, renderer, resolver, or lifecycle. **No new owner without a concrete new observable behavior.**

## Owners

| Owner | Owns |
| --- | --- |
| Document Session | Open documents and `activeId` |
| Document buffers | Monaco models, dirty/`savedVersionId`, virtual vs persisted identity, grants, `selectDocument`, `openOrActivate`. Blank New Document uses an empty model. New Document from README seeds via `documentTemplates.renderDocumentTemplate` (one README body; not a template subsystem); with a folder open, File/Quick Actions / Explorer write through `seededWorkspaceDocument` / exclusive create rather than untitled-only seeding |
| Editor | Commands, Preview split, Outline, Monaco host, Writing Focus chrome overlay, session document annotations |
| Explorer | Folder file tree in the right sidebar |
| Search | `/search` and Search sidebar options (exact text or regular expression over document bodies) |
| Quick Open | Keyboard document picker by identity in the open Folder (`Ctrl/Cmd+P`); not content search; not a Command Palette |
| Graph | Focus-scoped visualization of resolved links |
| Document Context | References and facts for the focused or peeked document |
| Focus | Folder-scoped Graph/Context target; Peek |
| Settings | Persistence in `settingsStore.ts` |
| Filesystem | Scan and document I/O through one RPC boundary |

Local find (`Ctrl/Cmd+F`) belongs to Monaco, not Search. Global Search is `Ctrl/Cmd+Shift+F`. Graph depth belongs only to Graph.

### Quick Open

Candidates are a **temporary projection** of `workspace.scannedNotes` (Folder scan owned by `workspaceState`; discovery by Filesystem scan). Identity fields: `title`, `name` (filename), `path` (folder-relative). See [`quickOpenCandidates.ts`](../src/mainview/modules/quickOpen/quickOpenCandidates.ts). DialogHost reads the live scan while open (refresh / close Folder update the list).

Quick Open does not scan, index, or own document lifecycle. No Folder open -> empty candidates. Partial / truncated scans expose whatever the scan already loaded; they do not invent a second walk.

Activation uses the same seam as Explorer and Search: `openOrActivate({ kind: "workspace", rootPath, path })` -> `selectDocument`. Candidate paths are not grants; read/open still goes through filesystem containment.

Overlay/focus: DialogHost / `dialogs.ts` (`promptQuickOpen`) with Teleport, Escape, Tab trap, and `restoreUsableFocus`. `.dialog-host` already stays usable under Writing Focus. Do not add a second dialog or focus manager. Do not touch native Full Screen.

## Selection and Focus

UI selection uses `selectDocument`: it sets `activeId` and, for in-folder documents, Focus. Virtual and standalone tabs clear Focus. `activateDocument` only moves `activeId`; it is session-internal.

Explorer, Search, links, Graph, and Document Context open a document through `openOrActivate`, which then calls `selectDocument`. Focus never gates the editor. Peek does not change Focus.

Graph consumes Focus. It does not follow the editor tab. It does not decide Focus.

## Document I/O

The Filesystem owner handles read, write, create, rename, and delete. The renderer reaches disk only through that RPC.

Folder targets are `rootPath` + `relativePath`, checked first by lexical `assertWithinWorkspace` and then by `assertCanonicallyContained` (symlink/realpath), written with temp+rename, with mtime conflict detection before the replace. Open File and Save As are main-process dialogs. There is no generic absolute-path RPC. A grant issued at dialog time is required for later standalone saves.

HTML Export is a separate dialog that writes `.html` only, using the Preview renderer. Containment and grants: [INVARIANTS.md](./INVARIANTS.md).

## Shell

`/editor` fills the main slot. The shell owns the application menu, Quick Actions, left sidebar (navigation and Folder lifecycle), right sidebar, and optional Statusbar. Those regions are siblings. On the editor route, Writing Focus collapses the left sidebar to the compact rail (restored on exit), hides shell chrome without mutating settings persistence, expands the editor surface, and may keep a quiet document-location line when Settings -> Interface -> Document location is Main panel (`documentLocation` projection). PageShell owns Writing Focus padding/gap so rhythm styles cannot reintroduce vertical space above Monaco. Native Full Screen is owned by the Bun host `BrowserWindow`, not by the shell. Window title updates use one host capability (`setWindowTitle`) when that destination is selected.

The WebView/browser default context menu (including Inspect Element) is suppressed at app start (`suppressNativeContextMenu.ts`). Contextual actions use Fulvid-owned `ContextMenu.vue` where the product already provides them. Do not add a global context-menu manager.

### Quick Actions toolbar

Owner: shell (`QuickActionsToolbar.vue` + `commands.ts`). Not the Markdown format bar (`EditorToolbar.vue`), which is editor-page chrome.

`quickActions` is **shell command metadata** for this toolbar. It is not a generic command/action registry.

**Groups describe the user's interaction model, not feature ownership.** Command handlers and module ownership stay where they already are; toolbar `group` / `subgroup` only answer what kind of interaction the button represents.

| Concern | Rule |
| --- | --- |
| Declaration | Every Quick Action sets `group`, `subgroup`, `tier`, `order`, `overflowOrder`, Lucide alias via `AppIcon`, and label key |
| Groups | `file` -> `edit` -> `search` -> `fulvid` (separators only: File \| Edit \| Search \| Fulvid \| More) |
| Subgroups | Exact taxonomy: file `document`/`workspace`; edit `document`/`history`/`clipboard`; search `document`/`workspace`; fulvid `view`/`mode`/`panels`. Metadata only - no subgroup separators |
| Priority (`tier`) | `core` > `secondary` > `overflow` |
| `order` | Presentation only: within a group, `subgroup` then `order` (toolbar and More). Independent of `overflowOrder` |
| `overflowOrder` | Leave order only: within a tier, lower leaves first. Independent of `order`. Prefer unique values per tier; equal values fall back to command `id` |
| Selection | `selectQuickActionsForVisibleCount` owns visibility via `tier` -> `overflowOrder` (not array index) |
| Annotation | Edit / `document` - contextual Add/Edit on the open document (`annotateDocument`). Not a Fulvid chrome action; Show/Hide stays View + Settings |
| Fulvid surfaces | `view` (Preview), `mode` (Writing Focus), `panels` (Explorer). One visual Fulvid group; no subgroup separators |
| Overflow stickiness | Preview > Annotation > Writing Focus > Explorer (remain visible longer). Preview / Annotation / Writing Focus stay ahead of clipboard. Explorer is overflow-tolerant (Folder / left nav remain). Writing Focus may enter More earlier (`Ctrl/Cmd+Shift+Enter`; Writing Focus keeps `.quick-actions`) |
| Icons | Toolbar -> `AppIcon` -> Lucide only. Semantic aliases (`annotations` -> Highlighter) |
| Geometry | Icon ~15px; hit target `--hit-min` (36px); group gap 1px; toolbar gap `$space-compact`; divider `$space-tight` |
| Labels | `aria-label` is the localized action string (contextual for Preview, annotation Add/Edit, Writing Focus). `title` may append `(shortcut)` when a shortcut exists |
| Toggles | `aria-pressed` only for Preview, Writing Focus, and Explorer - never for Add/Edit annotation |
| More menu | Same metadata and `group -> subgroup -> order`. Disabled toolbar actions stay disabled in More |

Do not add a ToolbarManager, action plugin registry, or parallel Writing Focus/Full Screen toolbar. Writing Focus keeps `.quick-actions` usable; Full Screen does not change Quick Action ownership.

The right sidebar shows one panel: Explorer, Search options (on `/search`), Document Context, or Outline. Search, Graph, and Settings are pages. Sidebars do not own `activeId`.

### Extension UI boundary

Presentation may be extension-capable; **authority does not**. An extension is never an owner.

The Extension System orchestrates declared capabilities; it does not become the owner of filesystem, document, editor, window, search, graph, or renderer authority.

Path: `extension -> declared capability / command -> existing owner -> existing presentation`.

| Category | Surfaces / rules |
| --- | --- |
| **Current** | Discovery loads `userData/extensions` at startup (**Extension API v1**). Invalid packs fail in isolation. Packs are not shipped inside Fulvid; install from sibling [`fulvid-extensions`](../../fulvid-extensions/) or any local folder. **Lua:** supported runtime via wasmoon (embedded PUC Lua 5.4.5 / Wasm) with `commands.register` / `ui.notify` / `editor` / `document` / `decorations` under `LUA_EXTENSION_LIMITS`. Snapshot + host-only identity stamps -> Lua text-only -> reject-stale apply through Monaco. Capability isolation is not an OS sandbox. Full contract: [`EXTENSIONS.md`](./EXTENSIONS.md). |
| **Additional capabilities** | Only via an explicit security/design decision - not a routine API widening |
| **Core-controlled** | Focus, dirty state, document selection, Writing Focus policy, grants, filesystem, Graph, Preview inertness, native Full Screen, right-rail panel set, Statusbar indicators, tabs chrome |
| **Forbidden** | Monaco internals, filesystem/grants/containment, BrowserWindow / native window APIs, parallel IPC channels, process, network, Vue internals, arbitrary DOM/HTML/SVG injection, MDX execution, extension-owned dirty/selection state, generic `host.call` bridges, bytecode entry, undeclared executable surfaces |

Do not add a second command bus. Do not let a button call filesystem or Monaco directly. Do not fix a UI problem by inventing a second owner of the same behavior.

Discovery: `src/bun/extensions/`. Lua host runtime: `src/bun/extensions/lua/`. Registry / host dispatch: `src/mainview/extensions/`. Contract tests: `tests/extensions/`.

Authoritative contract: [`EXTENSIONS.md`](./EXTENSIONS.md). Packs: sibling [`fulvid-extensions`](../../fulvid-extensions/).


## Document links

[`documentLink.ts`](../src/mainview/modules/document/links/documentLink.ts) parses the active link mode (Markdown or Wikilink, not both). Path/stem/alias/title resolution lives in [`linkSemantics.ts`](../src/mainview/modules/document/links/linkSemantics.ts) (`resolveDocumentPath`). Duplicate matches stay **first-wins**; `alsoMatches` is scan-derived honesty for UI, not a second identity. An unresolved target with exactly one near-match may surface `uniqueLinkCandidate` for soft open. Scan, Monaco providers, Preview, Export, Graph, and Document Context reuse that pair - not a second resolver.

Insert document link / TOC format strings in [`markdownAuthoring.ts`](../src/mainview/modules/editor/markdown/markdownAuthoring.ts) and insert them through Monaco; they reuse `linkMode` and `parseMarkdownStructure` and are not a second document model. Trim trailing whitespace is Monaco range edits (optional pre-write when Save confirms); not a formatter or sanitation subsystem.

Explorer file rename plans inbound target rewrites in [`documentPathRename.ts`](../src/mainview/modules/document/links/documentPathRename.ts) from the same parse/resolve pair, then applies them through Monaco buffers or existing `writeDocument` - not a refactoring subsystem or link database.

`linkMode` default is `"markdown"`. F2 rename applies text edits to open buffers. It does not rename files or change document identity.

## Preview

`renderMarkdownPreview` produces Preview HTML. Export wraps the same function (`exportMarkdownPreviewDocument`). Do not add a second Markdown renderer.

## Resources

If a component owns a canvas, worker, observer, or subscription, that resource dies with the component. No resource may outlive its owner.

`MonacoHost` owns the editor instance and detaches the current model on unmount. `documentBuffers` owns text models and disposes them when the document closes or the session ends. Closing or changing a folder only detaches attachment metadata; it must not dispose an open buffer.

Ignore superseded async results. Do not keep workers or renderers alive across routes without an owner, cache disposed renderers, or teleport GPU/worker components without matching dispose.

Vite/Monaco HMR is `bun run dev:hmr`: [CONTRIBUTING.md](../CONTRIBUTING.md#desktop-toolchain).

## Memory footprint and future considerations

### Baseline

Linux packaged Fulvid **1.0.0** (Electrobun 2.0.1, Bun 1.4.0, WebKitGTK 2.52.6, Ubuntu 24.04.5 / Wayland / x86_64), cold launch, **5-run median** across the Fulvid process tree (`smaps_rollup`):

| Mark | Median RSS | Median PSS |
| --- | --- | --- |
| Early peak (~5 s) | ~596.8 MiB | ~369.4 MiB |
| Idle (~60 s) | ~550.9 MiB | ~322.9 MiB |

This is a **Linux packaged benchmark reference**, not a cross-platform guarantee and not a claim about Electrobun or WebKit in isolation.

A diagnostic shell-floor build (Monaco removed from the running editor path) measured ~479.5 MiB RSS / ~256.0 MiB PSS idle. The Monaco stack therefore accounts for roughly **~67 MiB PSS** of the measured baseline.

### Interpretation

Prefer **PSS** over summed RSS when comparing physical footprint: shared library pages counted fully in each process make sum-RSS overstate unique usage. Do not treat virtual address space (`VmSize`) as RAM.

The dominant measured idle cost is the **WebKitGTK content process** and the **Bun / native host**, not Graph, Preview, i18n catalogs, or empty-extension discovery. No evidence from this investigation established an application-level memory leak.

Fulvid's current UX intentionally keeps the editor ready on launch. Deferring Monaco until first interaction may reduce idle memory, but that would be a product/UX change rather than a transparent implementation optimization.

### Future engineering rules

- Keep feature-specific functionality lazy when it is not required at startup.
- Do not eagerly initialize Graph/Sigma, Preview, extension runtimes, or other optional subsystems.
- Avoid loading large libraries on the critical startup path unless the feature is required for the initial editor experience.
- Do not duplicate document content or create parallel caches/indexes solely for convenience.
- Dispose listeners, timers, Monaco resources, WebView resources, and other lifecycle-bound objects at their existing owner boundary (see [Resources](#resources)).
- Avoid retaining hidden views, editors, models, parsed documents, graph data, or other large structures after their lifecycle ends.
- Prefer measuring before optimizing. Treat RSS and PSS separately.
- Do not trade security or editor behavior for arbitrary memory targets.

### When to investigate again

Revisit only with evidence such as: unbounded growth under a normal workload; a significant regression from the baseline above; retention after closing/discarding large documents or views; a new feature with a substantial persistent allocation; a WebKit/Bun/runtime upgrade that materially changes the footprint; or reproducible user reports of excessive consumption.

When investigating: reproduce first; use the **packaged** build; isolate the responsible process; measure RSS and PSS; compare to this baseline; attribute the increase to application code, WebKit, runtime, or native dependencies; avoid speculative optimization.

### Runtime maintenance

WebKitGTK evolves independently of Fulvid and can include memory-management and security fixes. Supported-distro/runtime upgrades should be **benchmarked**, not assumed to improve or worsen memory. Example: WebKitGTK 2.52.6 included a memory-usage improvement for pages using font variations; that does not imply a later version is better without measurement.
