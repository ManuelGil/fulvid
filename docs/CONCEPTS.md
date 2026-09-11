# Product concepts

Fulvid is a standalone desktop editor for Markdown and MDX. The file on disk is the source of truth. Context, Search, Preview, Outline, and Graph are derived from that filesystem and from open buffers.

Ownership: [ARCHITECTURE.md](./ARCHITECTURE.md). Rules: [INVARIANTS.md](./INVARIANTS.md).

## Workflow

Open a document, edit, save, open another. Writing comes first. Folder browsing, Search, Context, and Graph are optional. The editor works without a folder. Graph and Document Context need an open folder and a focused in-folder document.

Opening a folder looks recursively for `.md`, `.markdown`, and `.mdx`. If the scan finishes and finds none, Fulvid says so and does not load that folder. A partial scan never claims the folder is empty of documents. Finding an `.mdx` file does not run MDX.

Fulvid does not run MDX or document HTML. It does not score notes, infer links, or use embeddings. There is no Command Palette. Quick Open (document identity in the open Folder) is reserved on `Ctrl/Cmd+P`; its picker UI is not shipped yet. Monaco is the only editor. Preview and Export HTML share one inert renderer.

## Vocabulary

Product copy uses **Folder**, never Workspace. Host code may still use `workspace*` names.

| Term | Meaning |
| --- | --- |
| **Folder** | Optional open directory for scan, Explorer, Global Search, Graph, and Context |
| **Workspace** | Host/code name (`workspace*`) for the same open folder |
| **Document** | Untitled buffer (`untitled:N`) or a persisted `.md`, `.markdown`, or `.mdx` file |
| **Tab** | One open buffer in the editor session |
| **Editor** | Monaco writing surface |
| **Search** | Folder-wide content search at `/search` (`Ctrl/Cmd+Shift+F`, or `/`) |
| **Quick Open** | Open a document by title, filename, or relative path in the open Folder (`Ctrl/Cmd+P`). Candidates come from the Folder scan (`scannedNotes`), not a second index. Not content search; not a Command Palette. Picker UI ships after shortcut/command prep |
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
| **Context root** | Folder that limits facts and link resolution |
| **Focus mode** | Session writing overlay: hide editor chrome, typewriter, hide minimap. Not Graph Focus. Independent of native Full Screen. Shortcut: `Ctrl/Cmd+Shift+Enter` |

Settings choose one `linkMode`: `"markdown"` (default) or `"wikilink"`. That mode governs scan, resolution, editor providers, Preview, references, rename, and Graph.

**Find references** (`Shift+F12`) lists heading and fragment locations. **Rename heading** (`F2`) rewrites that heading and known fragment targets as text. F2 does not rename files.

Local find is Monaco (`Ctrl/Cmd+F`). Global Search is `/search` (`Ctrl/Cmd+Shift+F`). Quick Open asks which document to open by identity; Global Search asks where text appears.

## Markdown and MDX

| Extension | Monaco id | Notes |
| --- | --- | --- |
| `.md`, `.markdown` | `markdown` | Standard Markdown |
| `.mdx` | `mdx` | Same editor; MDX is not executed |

Language id and `linkMode` are independent. New documents default to `.mdx`. Save writes the source file. Export HTML cannot overwrite a note.

Title, aliases, tags, and links come from the document body and optional frontmatter. Same inputs produce the same facts.

## Settings

Groups: General, Editor, Appearance, Markdown, Preview, Folder, Accessibility, Keyboard. Interface scale never changes Monaco document typography.

Line endings (LF or CRLF) belong to the document, not to the operating system. Opening a file keeps its endings. Untitled documents use Settings → New document line endings (LF by default). The statusbar shows the active document's ending; click to switch. Save writes that ending. Changing it does not write until Save.
