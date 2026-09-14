# Invariants

Rules implementations should preserve.

Domain: [CONCEPTS.md](./CONCEPTS.md). Ownership: [ARCHITECTURE.md](./ARCHITECTURE.md). Graph pipeline: [GRAPH.md](./GRAPH.md).

## Product

| Rule | Meaning |
| --- | --- |
| Metadata optional | Frontmatter is optional; a filename is enough to identify a document |
| Determinism | Same folder scan and settings produce the same derived facts |
| Document identity | Virtual IDs are `untitled:N`. Persisted identity is one canonical `absolutePath`; the buffer `id` is `file:${absolutePath}` |
| Document writes | Folder writes stay contained. Replace uses temp+rename. Standalone writes require a dialog-issued grant |
| Document links | Exactly one active link mode; Markdown is the default, Wikilink the alternative |
| Session ownership | `DocumentSession.activeId` owns the editor selection. The active buffer never derives from Focus |
| Selection seam | UI selection uses `selectDocument`. `activateDocument` is session-internal |
| Focus ownership | Focus is folder-scoped Graph/Context metadata. Graph consumes Focus and does not own it |
| Writing Focus / Full Screen | Writing Focus is session editor chrome only: it may hide or inert secondary chrome but must keep deliberate capability surfaces usable (`WRITING_FOCUS_KEPT_SELECTORS`, including Quick Actions). Native Full Screen is BrowserWindow state on the host. Either may be on, off, or combined; neither owns the other, grants, containment, Preview, or document selection |
| Extension UI boundary | Path: `extension → declared capability/command → existing owner → presentation`. An extension is never an owner. Declarative discovery loads `userData/extensions` (`api: 0`); invalid packs fail in isolation. Host actions today: `notify`, `createUntitledFromTemplate`, plus host-only `lua` invoke for Phase 2 packs. Lua runs only in Bun via wasmoon. Enforced guest budgets: source size, command count, notify length, wall-clock execution (thread/`functionTimeout` hooks — not Promise.race), and Wasm heap (`setMemoryMax`). Capability isolation ≠ OS sandbox. They never own Monaco, filesystem/grants, BrowserWindow, Focus/Writing Focus policy, Graph, Preview HTML, Vue internals, or arbitrary DOM/SVG. Icon identifiers are closed declarative names (`appIcons` / `CommandIcon`). Repo `extensions/` fixtures document Phase 1 and are not the load path; Lua spike fixtures under `tests/extensions/fixtures/` are disposable. Do not fix a UI bug by inventing a second owner of the same behavior |
| Quit and dirty buffers | When Settings → Confirm before closing is on, Quit asks before discarding unsaved tabs, using the same confirmation owner as closing dirty tabs. Host `quitApplication` runs only after that gate. Menu Quit is a command, not an OS quit role that bypasses the renderer |

| Document location | Editor chrome projects `DocumentBuffer` fields into a compact relative path (or Untitled / standalone basename). Settings choose main panel, window title, or hidden. Tabs use basename unless open tabs collide (then add segments until unique). Path display is not navigation and not authorization |
| Search ownership | Local find uses the active Monaco model. Global Search uses Folder scan document bodies (plus open buffer overlays) with exact text or regular expression matching only |
| Quick Open ownership | Quick Open matches document identity (`title`, filename, relative path) from `workspace.scannedNotes` in the open Folder only. It does not search content, own a scan, or bypass `openOrActivate` / filesystem containment |
| Semantic rename | F2 renames a heading or fragment in document text. It never renames a file or document ID |
| File rename references | Explorer rename may rewrite DocumentLink targets that already resolved to the renamed path. It reuses parse/resolve and existing writes; it is not a transaction or link index |
| Preview and Export | Preview and Export HTML share `renderMarkdownPreview`. Save writes source. Export writes `.html` |
| Folder startup | `workspaceStartup` is `none` or `last`. Untitled is available in both cases |
| Folder preflight | Opening a folder loads it only when the scan found `.md` / `.markdown` / `.mdx`, or when the scan was partial. A complete scan with none of those files is said out loud and does not become the open folder. Preflight does not grant access, execute MDX, or walk the tree a second time |
| Line endings | EOL is document state on the Monaco model. Existing files keep LF or CRLF. Untitled and files with no line break use `editor.defaultEol` (not the OS). Explicit change uses the model and persists only through the existing Save path |
| Document annotations | Session-local plain-text notes on model-owned Monaco decorations. Presentation visibility is separate from existence. They do not dirty the document, write disk, or persist annotation content across close/reopen. Not Graph, Search, Outline, Preview, or diagnostics. See [ANNOTATIONS.md](./ANNOTATIONS.md) |

## Graph

| Rule | Meaning |
| --- | --- |
| Visualization only | Graph shows resolved links around Focus. It is not a knowledge graph or a second store |
| Not the product center | Graph must not redefine Search, Explorer, Folder, or Document Context |
| Depth is Graph-local | Graph depth must not affect other features |
| Link count is not quality | Reference count is not a score |

## Resources

Canvas, workers, observers, and subscriptions die with their owner. See [ARCHITECTURE.md](./ARCHITECTURE.md#resources).

## Preview

Markdown Preview is secondary and inert. Embedded HTML is escaped. `.mdx` goes through the Markdown layer only. No document code, JSX, or component runtime executes.

Images are inert placeholders (no network). Document links go through `openOrActivate` and can only reach a document already in the open folder. External targets are `https:` and `mailto:` only; every other scheme renders as `#`. The pane refuses navigation that is not a document link, by click and by keyboard.

Export HTML uses this same renderer and the same source-size cap.

## Trust boundary

The renderer is untrusted. It may ask for a document inside a folder the person opened, or for a grant this host issued. It may never name an arbitrary filesystem target. Every rule below is enforced in the Bun host, in `src/bun/filesystem/`, regardless of what the UI already checked. Standing review of these properties: [SECURITY-AND-RESILIENCE.md](./SECURITY-AND-RESILIENCE.md).

| Rule | Meaning |
| --- | --- |
| Host-side validation | Every RPC parameter is checked for type, shape, and size in `rpcInput`. Renderer validation is never authority |
| Folder approval | A folder root is authorized only by a host-side decision: a native dialog, or an external open request the host resolved. Approvals persist host-side in `workspaceGrants` |
| Folder authority | `workspaceAuthority.ts` decides what the renderer may reach: approved roots, in-root paths, or grant tokens |
| Reopening a folder | The renderer's recent list is a convenience. Reopening a path this host never approved is refused |
| Folder containment | `workspacePaths` checks lexically, then canonically through `realpath`. A symlink cannot move a target out of the root |
| Supported formats | `.md`, `.markdown`, and `.mdx` only, matched case-insensitively on the privileged side |
| Desktop actions | Reveal and copy accept only an approved root, something inside an authorized root, or a granted document |
| Grants | A grant token maps to one absolute path, is shaped like a UUID, and the grant table is bounded |
| Error containment | Failures cross the boundary as codes from `filesystemErrors`. No host path, errno, or stack reaches the UI |
| Scan ceilings | A folder scan is bounded in document count and depth, and per-file analysis is capped. A partial scan is reported, never silent |
| External open | An external request is intent, never privilege. It earns exactly what the equivalent dialog earns, through the same authorities. See [EXTERNAL-OPEN.md](./EXTERNAL-OPEN.md) |
| Save integrity | A save that did not reach disk never clears dirty. Creating a document is an exclusive create, so a concurrent create is reported rather than overwritten |

## Persisted state

Persisted state is treated as potentially corrupt or tampered with. Settings, layout, and folder approvals each sanitize on read: an invalid part is discarded and its default applied, and Fulvid still starts. Persisted state can never grant a capability. A recent-folder entry does not authorize a folder.

## Content Security Policy

`src/mainview/index.html` sets `object-src 'none'`, `frame-src 'none'`, `base-uri 'none'`, and `form-action 'none'`. These close the active-content vectors a document could reach. Preview escaping is what keeps document content inert.

Omitted `script-src` / `style-src` / `worker-src` directives are a packaging constraint, not this contract. See the comment in `src/mainview/index.html`.

## Claims to avoid

The product should not imply health scores, embeddings, semantic similarity, or AI-generated metadata.
