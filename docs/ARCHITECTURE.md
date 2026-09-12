# Architecture

Who owns behavior in Fulvid.

Vocabulary: [CONCEPTS.md](./CONCEPTS.md). Rules: [INVARIANTS.md](./INVARIANTS.md). Graph pipeline: [GRAPH.md](./GRAPH.md).

Every user-visible behavior has **one owner**. Pages and the shell choose what is on screen; they do not own product rules. Reuse the document session, buffers, DocumentLink resolver, Preview renderer, and filesystem RPC. Do not add a second store, parser, renderer, resolver, or lifecycle.

## Owners

| Owner | Owns |
| --- | --- |
| Document Session | Open documents and `activeId` |
| Document buffers | Monaco models, dirty/`savedVersionId`, virtual vs persisted identity, grants, `selectDocument`, `openOrActivate` |
| Editor | Commands, Preview split, Outline, Monaco host, Writing Focus chrome overlay |
| Explorer | Folder file tree in the right sidebar |
| Search | `/search` and Search sidebar options (content strategies) |
| Quick Open | Keyboard document picker by identity in the open Folder (`Ctrl/Cmd+P`); not content search; not a Command Palette |
| Graph | Focus-scoped visualization of resolved links |
| Document Context | References and facts for the focused or peeked document |
| Focus | Folder-scoped Graph/Context target; Peek |
| Context | Scoping facts and link resolution to a context root |
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

The right sidebar shows one panel: Explorer, Search options (on `/search`), Document Context, or Outline. Search, Graph, and Settings are pages. Sidebars do not own `activeId`.

## Document links

[`documentLink.ts`](../src/mainview/modules/document/links/documentLink.ts) is the only resolver for the active link mode (Markdown or Wikilink, not both). Scan, Monaco providers, Preview, Export, and Graph use it.

`linkMode` default is `"markdown"`. F2 rename applies text edits to open buffers. It does not rename files or change document identity.

## Preview

`renderMarkdownPreview` produces Preview HTML. Export wraps the same function (`exportMarkdownPreviewDocument`). Do not add a second Markdown renderer.

## Resources

If a component owns a canvas, worker, observer, or subscription, that resource dies with the component. No resource may outlive its owner.

`MonacoHost` owns the editor instance and detaches the current model on unmount. `documentBuffers` owns text models and disposes them when the document closes or the session ends. Closing or changing a folder only detaches attachment metadata; it must not dispose an open buffer.

Ignore superseded async results. Do not keep workers or renderers alive across routes without an owner, cache disposed renderers, or teleport GPU/worker components without matching dispose.

Vite/Monaco HMR is `bun run dev:hmr`: [CONTRIBUTING.md](../CONTRIBUTING.md#desktop-toolchain).
