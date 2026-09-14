# Product concepts

Fulvid is a standalone desktop editor for Markdown and MDX. The file on disk is the source of truth. Context, Search, Preview, Outline, and Graph are derived from that filesystem and from open buffers.

Ownership: [ARCHITECTURE.md](./ARCHITECTURE.md). Rules: [INVARIANTS.md](./INVARIANTS.md).

## Workflow

Open a document, edit, save, open another. Writing comes first. Folder browsing, Search, Context, and Graph are optional. The editor works without a folder. Graph and Document Context need an open folder and a focused in-folder document.

Opening a folder looks recursively for `.md`, `.markdown`, and `.mdx`. If the scan finishes and finds none, Fulvid says so and does not load that folder. A partial scan never claims the folder is empty of documents. Finding an `.mdx` file does not run MDX.

Fulvid does not run MDX or document HTML. It does not score notes, infer links, or use embeddings. There is no Command Palette. Quick Open (`Ctrl/Cmd+P`) opens a document by title, filename, or relative path in the open Folder. Monaco is the only editor. Preview and Export HTML share one inert renderer. Fulvid is not a plugin marketplace. Declarative local packs under `userData/extensions` may declare host actions (`notify`, `createUntitledFromTemplate`); they never become a platform runtime or Lua host.

## Vocabulary

Product copy uses **Folder**, never Workspace. Host code may still use `workspace*` names.

| Term | Meaning |
| --- | --- |
| **Folder** | Optional open directory for scan, Explorer, Global Search, Graph, and Context |
| **Workspace** | Host/code name (`workspace*`) for the same open folder |
| **Document** | Untitled buffer (`untitled:N`) or a persisted `.md`, `.markdown`, or `.mdx` file |
| **Tab** | One open buffer in the editor session |
| **Editor** | Monaco writing surface |
| **Search** | Folder-wide content search at `/search` (`Ctrl/Cmd+Shift+F`, or `/`). Exact text or regular expression over document bodies from the Folder scan (and open buffers). Not Quick Open; not Monaco find |
| **Quick Open** | Open a document by title, filename, or relative path in the open Folder (`Ctrl/Cmd+P`). Candidates come from the Folder scan (`scannedNotes`), not a second index. Not content search; not a Command Palette |
| **Graph** | Visualization of resolved document links around Focus |
| **Preview** | Inert HTML of the active buffer |
| **Export HTML** | Same renderer as Preview, written to a `.html` file |
| **Outline** | Headings in the active document |
| **Document Context** | References and facts for the focused or peeked document |
| **Reference** | A resolved incoming or outgoing document link used by Context |
| **Explorer** | Folder file tree |
| **Document link** | Link parsed in the active Markdown or Wikilink mode |
| **Focus** | Folder-scoped target for Graph and Document Context |
| **Peek** | Read another document in Context without changing Focus |
| **Writing Focus** | Strong writing presentation: collapses the left sidebar to the compact rail, hides secondary chrome (tabs/statusbar/format bar), expands the editor surface, optional quiet document location. Session-only. Hides chrome, not capabilities — Quick Actions and other keep-list surfaces stay usable. Not Graph Focus. Independent of native Full Screen. Shortcut: `Ctrl/Cmd+Shift+Enter` |
| **Annotation** | Temporary plain-text note on a tracked line in the open document (**document annotation**). Session-local and document-local; not source, not persistent, not searchable. Primary actions: **Add annotation** / **Edit annotation** (Quick Actions, Navigate, glyph margin). **Show/Hide document annotations** is presentation only (View + Settings). See [ANNOTATIONS.md](./ANNOTATIONS.md) |

Settings choose one `linkMode`: `"markdown"` (default) or `"wikilink"`. That mode governs scan, resolution, editor providers, Preview, references, rename, and Graph.

**Find references** (`Shift+F12`) lists heading and fragment locations. **Rename heading** (`F2`) rewrites that heading and known fragment targets as text. F2 does not rename files.

**Explorer rename** changes a document’s folder-relative path. After the filesystem rename, Fulvid rewrites DocumentLink targets that already resolved to that document (preferring live open-buffer text), using source-relative paths and preserving labels and `#` fragments. Closed scanned notes use the existing `writeDocument` path. This is not a generic refactor and not a multi-file transaction — a partial link-update failure is reported after a successful rename.

**Insert document link** (Edit menu / Quick Actions) picks a Folder document via Quick Open, optionally a heading from that document’s structure, and inserts a Markdown or Wikilink string using the active `linkMode`. **Insert table of contents** inserts a deterministic Markdown list of same-document heading links from `parseMarkdownStructure`. Neither command scans the disk, keeps live TOC state, or changes Preview/Graph.

Local find is Monaco (`Ctrl/Cmd+F`). Global Search is `/search` (`Ctrl/Cmd+Shift+F`). Quick Open asks which document to open by identity; Global Search asks where text appears.

**Document location.** Folder documents are oriented by their folder-relative path (compact when long). Settings choose where that identity appears: main panel, window title, or hidden (tabs/Explorer/accessibility still identify the document). Tabs stay on the basename unless open tabs collide, then they add path segments until unique. Untitled and standalone keep their labels. Showing a path is not a grant and does not browse the Folder.

## Markdown and MDX

| Extension | Monaco id | Notes |
| --- | --- | --- |
| `.md`, `.markdown` | `markdown` | Standard Markdown |
| `.mdx` | `mdx` | Same editor; MDX is not executed |

Language id and `linkMode` are independent. New documents default to `.mdx`. **New Document** creates a blank Markdown/MDX buffer or file (`content` empty). **New Document from README** seeds the same creation paths with the single built-in README-shaped Markdown body (`documentTemplates.renderDocumentTemplate`). Both appear under File → New; Quick Actions expose blank as core and README as secondary/More; the editor tab New control creates a blank document. Explorer offers blank and README creation (toolbar and folder context → New). For README creation in Explorer, the H1 uses the immediate parent folder name; without filesystem context the H1 is `README`. Filename prompts stay responsible for file identity; the H1 is independent. Mustache interpolates the title at creation time only. There is no template manager, picker, or additional built-in templates. Save writes the source file. Export HTML cannot overwrite a note.

Title, aliases, tags, and links come from the document body and optional frontmatter. Same inputs produce the same facts.

## Settings

Groups: General, Editor, Appearance, Markdown, Preview, Folder, Accessibility, Keyboard. Interface scale never changes Monaco document typography. General includes Reset settings, which restores persisted preferences to built-in defaults without changing documents, tabs, Folder, or files. Layout widths stay in layout state, not settings. Settings Search finds preferences on this page by label, description, and category in the current language; it does not search documents or the folder.

The initial appearance of Fulvid follows the operating system preference (`system`). Choosing Light or Dark in Settings forces that skin; an explicit persisted choice takes priority over the default.

Line endings (LF or CRLF) belong to the document, not to the operating system. Opening a file keeps its endings. Untitled documents use Settings -> New document line endings (LF by default). The statusbar shows the active document's ending; click to switch. Save writes that ending. Changing it does not write until Save.
