# Architecture

Who owns behavior in Fulvid.

Vocabulary: [CONCEPTS.md](./CONCEPTS.md). Rules: [INVARIANTS.md](./INVARIANTS.md). Graph pipeline: [GRAPH.md](./GRAPH.md).

Every user-visible behavior has **one owner**. Pages and the shell choose what is on screen; they do not own product rules. Reuse the document session, buffers, document-link parse/resolve (`documentLink` + `linkSemantics`), Preview renderer, and filesystem RPC. Do not add a second store, parser, renderer, resolver, or lifecycle.

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

Quick Open does not scan, index, or own document lifecycle. No Folder open → empty candidates. Partial / truncated scans expose whatever the scan already loaded; they do not invent a second walk.

Activation uses the same seam as Explorer and Search: `openOrActivate({ kind: "workspace", rootPath, path })` → `selectDocument`. Candidate paths are not grants; read/open still goes through filesystem containment.

Overlay/focus: DialogHost / `dialogs.ts` (`promptQuickOpen`) with Teleport, Escape, Tab trap, and `restoreUsableFocus`. `.dialog-host` already stays usable under Writing Focus. Do not add a second dialog or focus manager. Do not touch native Full Screen.

## Selection and Focus

UI selection uses `selectDocument`: it sets `activeId` and, for in-folder documents, Focus. Virtual and standalone tabs clear Focus. `activateDocument` only moves `activeId`; it is session-internal.

Explorer, Search, links, Graph, and Document Context open a document through `openOrActivate`, which then calls `selectDocument`. Focus never gates the editor. Peek does not change Focus.

Graph consumes Focus. It does not follow the editor tab. It does not decide Focus.

## Document I/O

The Filesystem owner handles read, write, create, rename, and delete. The renderer reaches disk only through that RPC.

Folder targets are `rootPath` + `relativePath`, checked by `assertWithinWorkspace`, written with temp+rename, with mtime conflict detection before the replace. Open File and Save As are main-process dialogs. There is no generic absolute-path RPC. A grant issued at dialog time is required for later standalone saves.

HTML Export is a separate dialog that writes `.html` only, using the Preview renderer. Containment and grants: [INVARIANTS.md](./INVARIANTS.md).

## Shell

`/editor` fills the main slot. The shell owns the application menu, Quick Actions, left sidebar (navigation and Folder lifecycle), right sidebar, and optional Statusbar. Those regions are siblings. On the editor route, Writing Focus collapses the left sidebar to the compact rail (restored on exit), hides shell chrome without mutating settings persistence, expands the editor surface, and may keep a quiet document-location line when Settings -> Document location is Main panel (`documentLocation` projection). PageShell owns Writing Focus padding/gap so rhythm styles cannot reintroduce vertical space above Monaco. Native Full Screen is owned by the Bun host `BrowserWindow`, not by the shell. Window title updates use one host capability (`setWindowTitle`) when that destination is selected.

The WebView/browser default context menu (including Inspect Element) is suppressed at app start (`suppressNativeContextMenu.ts`). Contextual actions use Fulvid-owned `ContextMenu.vue` where the product already provides them. Do not add a global context-menu manager.

### Quick Actions toolbar

Owner: shell (`QuickActionsToolbar.vue` + `commands.ts`). Not the Markdown format bar (`EditorToolbar.vue`), which is editor-page chrome.

`quickActions` is **shell command metadata** for this toolbar. It is not a generic command/action registry.

**Groups describe the user's interaction model, not feature ownership.** Command handlers and module ownership stay where they already are; toolbar `group` / `subgroup` only answer what kind of interaction the button represents.

| Concern | Rule |
| --- | --- |
| Declaration | Every Quick Action sets `group`, `subgroup`, `tier`, `order`, `overflowOrder`, Lucide alias via `AppIcon`, and label key |
| Groups | `file` → `edit` → `search` → `fulvid` (separators only: File \| Edit \| Search \| Fulvid \| More) |
| Subgroups | Exact taxonomy: file `document`/`workspace`; edit `document`/`history`/`clipboard`; search `document`/`workspace`; fulvid `view`/`mode`/`panels`. Metadata only — no subgroup separators |
| Priority (`tier`) | `core` > `secondary` > `overflow` |
| `order` | Presentation only: within a group, `subgroup` then `order` (toolbar and More). Independent of `overflowOrder` |
| `overflowOrder` | Leave order only: within a tier, lower leaves first. Independent of `order`. Prefer unique values per tier; equal values fall back to command `id` |
| Selection | `selectQuickActionsForVisibleCount` owns visibility via `tier` → `overflowOrder` (not array index) |
| Annotation | Edit / `document` — contextual Add/Edit on the open document (`annotateDocument`). Not a Fulvid chrome action; Show/Hide stays View + Settings |
| Fulvid surfaces | `view` (Preview), `mode` (Writing Focus), `panels` (Explorer). One visual Fulvid group; no subgroup separators |
| Overflow stickiness | Preview > Annotation > Writing Focus > Explorer (remain visible longer). Preview / Annotation / Writing Focus stay ahead of clipboard. Explorer is overflow-tolerant (Folder / left nav remain). Writing Focus may enter More earlier (`Ctrl/Cmd+Shift+Enter`; Writing Focus keeps `.quick-actions`) |
| Icons | Toolbar → `AppIcon` → Lucide only. Semantic aliases (`annotations` → Highlighter) |
| Geometry | Icon ~15px; hit target `--hit-min` (36px); group gap 1px; toolbar gap `$space-compact`; divider `$space-tight` |
| Labels | `aria-label` is the localized action string (contextual for Preview, annotation Add/Edit, Writing Focus). `title` may append `(shortcut)` when a shortcut exists |
| Toggles | `aria-pressed` only for Preview, Writing Focus, and Explorer — never for Add/Edit annotation |
| More menu | Same metadata and `group → subgroup → order`. Disabled toolbar actions stay disabled in More |

Do not add a ToolbarManager, action plugin registry, or parallel Writing Focus/Full Screen toolbar. Writing Focus keeps `.quick-actions` usable; Full Screen does not change Quick Action ownership.

The right sidebar shows one panel: Explorer, Search options (on `/search`), Document Context, or Outline. Search, Graph, and Settings are pages. Sidebars do not own `activeId`.

### Extension UI boundary

Presentation may become extension-capable later; **authority does not**. An extension is never an owner.

The Extension Engine orchestrates declared capabilities; it does not become the owner of filesystem, document, editor, window, search, graph, or renderer authority.

Path: `extension → declared capability / command → existing owner → existing presentation`.

| Category | Surfaces / rules |
| --- | --- |
| **Current** | Discovery loads `userData/extensions` at startup (**Extension API v1**). Invalid packs fail in isolation. Permanent examples under [`extensions/`](../extensions/). Host actions: `notify`, `createUntitledFromTemplate`. **Lua:** supported runtime via wasmoon (embedded PUC Lua 5.4.5 / Wasm) with `commands.register` / `ui.notify` under `LUA_EXTENSION_LIMITS`. **Editor (PRODUCTION):** `editor.getSelection` / `editor.replaceSelection` — text snapshot + host-only identity stamps → Lua text-only → reject-stale apply through Monaco. Capability isolation ≠ OS sandbox. Full contract: [`EXTENSIONS.md`](./EXTENSIONS.md). |
| **Future seam** | Additional capabilities only via an explicit security/design decision — not a routine API widening |
| **Core-controlled** | Focus, dirty state, document selection, Writing Focus policy, grants, filesystem, Graph, Preview inertness, native Full Screen, right-rail panel set, Statusbar indicators, tabs chrome |
| **Forbidden** | Monaco internals, filesystem/grants/containment, BrowserWindow / native window APIs, parallel IPC channels, process, network, Vue internals, arbitrary DOM/HTML/SVG injection, MDX execution, extension-owned dirty/selection state, generic `host.call` bridges, bytecode entry, undeclared executable surfaces |

Do not add a second command bus. Do not let a button call filesystem or Monaco directly. Do not fix a UI problem by inventing a second owner of the same behavior.

Discovery: `src/bun/extensions/`. Lua host runtime: `src/bun/extensions/lua/`. Registry / host dispatch: `src/mainview/extensions/`. Contract tests: `tests/extensions/`.

Authoritative contract: [`EXTENSIONS.md`](./EXTENSIONS.md). Fixtures: [`extensions/README.md`](../extensions/README.md).


## Document links

[`documentLink.ts`](../src/mainview/modules/document/links/documentLink.ts) parses the active link mode (Markdown or Wikilink, not both). Path/stem/alias/title resolution lives in [`linkSemantics.ts`](../src/mainview/modules/document/links/linkSemantics.ts) (`resolveDocumentPath`). Duplicate matches stay **first-wins**; `alsoMatches` is scan-derived honesty for UI, not a second identity. An unresolved target with exactly one near-match may surface `uniqueLinkCandidate` for soft open. Scan, Monaco providers, Preview, Export, Graph, and Document Context reuse that pair — not a second resolver.

Insert document link / TOC format strings in [`markdownAuthoring.ts`](../src/mainview/modules/editor/markdown/markdownAuthoring.ts) and insert them through Monaco; they reuse `linkMode` and `parseMarkdownStructure` and are not a second document model. Trim trailing whitespace is Monaco range edits (optional pre-write when Save confirms); not a formatter or sanitation subsystem.

Explorer file rename plans inbound target rewrites in [`documentPathRename.ts`](../src/mainview/modules/document/links/documentPathRename.ts) from the same parse/resolve pair, then applies them through Monaco buffers or existing `writeDocument` — not a refactoring subsystem or link database.

`linkMode` default is `"markdown"`. F2 rename applies text edits to open buffers. It does not rename files or change document identity.

## Preview

`renderMarkdownPreview` produces Preview HTML. Export wraps the same function (`exportMarkdownPreviewDocument`). Do not add a second Markdown renderer.

## Resources

If a component owns a canvas, worker, observer, or subscription, that resource dies with the component. No resource may outlive its owner.

`MonacoHost` owns the editor instance and detaches the current model on unmount. `documentBuffers` owns text models and disposes them when the document closes or the session ends. Closing or changing a folder only detaches attachment metadata; it must not dispose an open buffer.

Ignore superseded async results. Do not keep workers or renderers alive across routes without an owner, cache disposed renderers, or teleport GPU/worker components without matching dispose.

Vite/Monaco HMR is `bun run dev:hmr`: [CONTRIBUTING.md](../CONTRIBUTING.md#desktop-toolchain).
