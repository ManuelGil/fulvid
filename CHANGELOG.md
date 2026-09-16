# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file is updated as part of the change, not reconstructed when a version is tagged. Add user-facing entries under `Unreleased`. When a version is released, move those entries under that version and start a new empty `Unreleased` section. Do not log every commit or internal refactor. Do not rewrite a published version except to correct a factual error. A release is not documentarily complete until this file lists it.

## [Unreleased]

### Added

- **Extensions (API v1)**: local Lua packs under `userData/extensions/` add commands through existing owners (notify, untitled, Monaco selection/document/decorations). Source-only Lua/Wasm on the Bun host; no marketplace, network, filesystem, or live Monaco authority. Reference packs: `extensions/`. Guide: [docs/EXTENSIONS.md](docs/EXTENSIONS.md).
- **Extension API expansion**: Lua packs may use least-privilege `document` (`getText` / `getCursor` / `reveal` / `createUntitled`), `decorations` (set/clear with host styles or validated `appearance`), selection replace under `editor`, and generic `template.render` under `templates`. Snapshot/apply stays Bun-runtime -> renderer-apply through existing owners. No `fulvid.date` or command `prompts` - product template semantics (ADR sections, defaults, naming) live in packs.
- **Generic `templates` capability**: `template.render(source, variables)` substitutes escaped `{{name}}` only (bounded strings). Optional `clock.isoDate()` returns a UTC `YYYY-MM-DD` for pack-built context. No sections/partials/lambdas, no host variable factories, no ADR/domain knowledge.

### Changed

- **Extension management**: Settings → Extensions supports install from folder, uninstall with confirmation, and reload inventory. File → Extensions opens that section. Install validates then copies atomically into `userData/extensions/<id>/`; uninstall unloads, deletes only that pack, and clears its allowance. No marketplace or package manager.
- **Extension identity**: canonical pack id is `publisher.name` (e.g. `imgildev.todo-decorator`, `fulvid.host-notify`). Publisher `local` is reserved; persisted allowances migrate former `local.*` ids once. Compact package metadata (`displayName`, `description`, `author`, `license`, optional URLs/keywords) is validated on the manifest — not a marketplace.
- **Extensions host surface**: removed declarative host actions (`notify`, `createUntitledFromTemplate`). Packs use `entry.lua` / `init.lua`. Seed Markdown and rich template context are pack-owned; Fulvid only interpolates when `templates` is granted.
- **Extensions documentation**: host docs describe only the generic extension contract. Pack-specific product vocabulary is not part of Fulvid.
- **Extension host internals**: flatter command/engine maps, guest reduction folded into the Lua engine module, thinner registry orchestration.
- **Extension host ceremony**: removed unused discovery helpers, re-exports, value-box wrappers, and redundant ID recomputation on the load path.

## [0.8.0] - 2026-09-14

### Added

- **New Document from selection**: File -> New and Quick Actions open an untitled buffer with the exact selected editor text and, when the source is a folder document, a `formatDocumentLink` backlink (no line-address references). Save As persists it like any other untitled tab.
- **Trim trailing whitespace**: Edit / Quick Actions removes trailing spaces and tabs before each line ending via Monaco edits (undoable). Settings -> Editor -> Trim trailing whitespace on Save is off by default.

### Changed

- **New Document from README** with a folder open: File -> New and Quick Actions prompt and write at the Folder root (Explorer New still writes in the selected directory). Without a folder, README remains an untitled seeded buffer until Save As.
- Document links with duplicate stem/alias/title matches stay **first-wins**; hover and Context can show the other matches as honesty. An unresolved link with exactly one near-match may offer that candidate as a soft open (definition / Inspector).
- Writing Focus: hide chrome, keep capabilities (Quick Actions and other keep-list surfaces stay usable). Still independent of native Full Screen.

## [0.7.0] - 2026-09-13

### Added

- **New Document from README**: create a Markdown document prefilled with a single built-in README-shaped body (title from the parent folder when created in Explorer). Blank **New Document** remains available. File -> New, Quick Actions, and Explorer New expose both; the editor tab New control still creates a blank document. Not a template manager or template gallery.
- **Insert document link** and **Insert table of contents** (Edit menu and Quick Actions): insert a Markdown or Wikilink to a Folder document (optionally a heading) using the active `linkMode`, or a deterministic same-document heading TOC. Ordinary source text only - no live TOC sync and no second document model.
- Settings Search: find preferences on the Settings page by label, description, and category in the current language. Does not search documents or the Folder.
- Explorer rename preserves resolvable document references: after a successful filesystem rename, Fulvid rewrites DocumentLink targets that already pointed at that document (open buffers and closed scanned notes), keeping labels and `#` fragments. Partial link-update failures are reported; this is not a multi-file transaction or generic refactor.

### Changed

- Appearance defaults to the operating system light/dark preference (`system`). Choosing Light or Dark in Settings still forces that skin.
- Global Search keeps exact text and regular expression matching over Folder document bodies (and open buffers). Extra strategies (fuzzy, words, boolean, proximity, pattern, path) are removed; obsolete strategy values in a saved Search URL fall back to literal.
- Graph and Document Context always use the open Folder. The separate Context root preference is gone.
- Object menus: clearer Explorer and Search path actions, tab Close others / Close all when several tabs are open, and the native WebView/browser context menu is suppressed so Fulvid’s own menus own right-click.

### Removed

- Global Search strategies beyond literal and regular expression.
- Context root as a user-facing Folder limit for facts and link resolution.

## [0.6.0] - 2026-09-12

### Added

- Session-local document annotations: short plain-text notes on tracked positions in the open document. Primary entry: Quick Actions **Add annotation** / **Edit annotation** (same `annotateDocument` command as Navigate -> Annotate and the glyph margin). Not persistent; not part of the Markdown/MDX file.
- Show/Hide document annotations presentation (View menu), with Settings -> Editor preferred default. Hiding does not delete annotations.

### Changed

- Document annotations discoverability: Quick Actions primary action is contextual Add/Edit annotation in the Edit group; Show/Hide stays on View. Preview / Annotation / Writing Focus stay ahead of clipboard when the toolbar is narrow; Highlighter icon; guide in [docs/ANNOTATIONS.md](docs/ANNOTATIONS.md).
- Quick Actions use explicit `subgroup`, `order`, and `overflowOrder` so toolbar and More-menu order are not tied to array position. Groups follow the user interaction model (not feature ownership). Global Search uses a distinct `file-search` icon from local Find.
- More menu mirrors disabled Quick Actions. Writing Focus no longer steals keyboard focus to the sidebar rail when collapsing or restoring it.

## [0.5.0] - 2026-09-12

- Settings -> General: Reset settings restores persisted preferences to built-in defaults (documents, Folder, tabs, and files stay unchanged).


- Settings -> Document location: choose Main panel, Window title, or Hidden for the same document-path projection (never a grant).

### Changed

- Strong Writing Focus: collapses the left sidebar to the compact rail (restores it on exit), hides tabs/statusbar/format bar, expands the editor surface, and keeps document identity according to Document location. Still independent of Full Screen.
- Document orientation: compact relative paths, collision-aware tab labels, and less redundant chrome (no Folder absolute path as document identity; Preview header no longer repeats the path).

## [0.4.0] - 2026-09-11

### Added

- Quick Open (`Ctrl/Cmd+P`): filter documents in the open Folder by title, filename, or relative path and open the selection. Keyboard-first; not content search; not a Command Palette. Opens through the existing folder document path and does not add grants or bypass containment.

### Changed

- Keyboard: `Ctrl/Cmd+P` opens Quick Open. Global Search moves to `Ctrl/Cmd+Shift+F`. Writing Focus moves to `Ctrl/Cmd+Shift+Enter` so those chords do not compete. Monaco local find stays `Ctrl/Cmd+F`.

## [0.3.0] - 2026-09-10

### Added

- Native Full Screen from the View menu. Host window fullscreen (not web Document Fullscreen), independent of Writing Focus, and not persisted. F11 on Windows and Linux; Ctrl+Cmd+F on macOS. Normal window bounds are not saved while the window is fullscreen.
- Writing Focus in Quick Actions (Fulvid group, beside Preview), using the same Writing Focus toggle as the menu and shortcut.
- Back to top control in the editor for long documents. It appears after you scroll down and returns to the start of the document without changing the text.

### Changed

- Writing Focus on the editor route now hides the chrome that gets in the way of writing (sidebars, tabs, format bar, statusbar) while Monaco stays the editor. Session-only; not Graph Focus; not Full Screen. Shortcuts: Ctrl+Shift+Enter on Windows and Linux and Cmd+Shift+Enter on macOS (see 0.4.0 keyboard note - Global Search took Ctrl/Cmd+Shift+F).

## [0.2.0] - 2026-09-10

### Added

- Opening a folder (including an external folder request) loads it only when the scan finds Markdown or MDX, or when the scan was partial. A finished scan with neither kind of document is reported in the reader's language and does not become the open folder.
- Line endings: LF and CRLF belong to the document. Open keeps the file's ending. Untitled uses the New document line endings setting (LF by default, not the OS). The statusbar shows LF or CRLF; click to switch. Save writes the active ending.

### Changed

- When no folder is open, recent folders sit with the empty state instead of at the bottom of the window.
- The statusbar groups document, mode, format, stats, and folder context, and hides document-only items when nothing is open.
- Keyboard and accessibility of the existing chrome: Explorer tree selection follows arrow keys, Search results expose the existing context menu from the query field, dialogs without a title use the message as their accessible name, and focus returns after the last tab closes.
- Documented the standing security and resilience contract. The 2026-09-09 adversarial review is kept as historical evidence.

## [0.1.0] - 2026-09-09

First release of Fulvid, a standalone desktop editor for Markdown and MDX.

### Added

- Desktop app for Linux, Windows, and macOS that edits `.md`, `.markdown`, and `.mdx` on the local filesystem. There is no account, vault format, or cloud workspace.
- Markdown and MDX in the same window. MDX is syntax-highlighted as source and is never executed.
- Native Open File, Save As, and Open Folder. Untitled tabs until a path is chosen. Save writes the source file.
- Optional folder workflow: Explorer, Global Search, Outline, Graph, and Document Context. Those views read the same files on disk.
- Session link mode: Markdown (default) or Wikilink. Missing targets stay visible. Fulvid does not create a file because a link points at a missing path.
- Inert Preview and Export HTML from the same renderer. Export writes a `.html` file and cannot overwrite a Markdown or MDX note.
- English and Spanish application chrome. Document text, filenames, and link targets are not translated.

[Unreleased]: https://github.com/ManuelGil/fulvid/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/ManuelGil/fulvid/releases/tag/v0.8.0
[0.7.0]: https://github.com/ManuelGil/fulvid/releases/tag/v0.7.0
[0.6.0]: https://github.com/ManuelGil/fulvid/releases/tag/v0.6.0
[0.5.0]: https://github.com/ManuelGil/fulvid/releases/tag/v0.5.0
[0.4.0]: https://github.com/ManuelGil/fulvid/releases/tag/v0.4.0
[0.3.0]: https://github.com/ManuelGil/fulvid/releases/tag/v0.3.0
[0.2.0]: https://github.com/ManuelGil/fulvid/releases/tag/v0.2.0
[0.1.0]: https://github.com/ManuelGil/fulvid/releases/tag/v0.1.0
