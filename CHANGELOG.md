# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file is updated as part of the change, not reconstructed when a version is tagged. Add user-facing entries under `Unreleased`. When a version is released, move those entries under that version and start a new empty `Unreleased` section. Do not log every commit or internal refactor. Do not rewrite a published version except to correct a factual error. A release is not documentarily complete until this file lists it.

## [Unreleased]

## [0.3.0] - 2026-09-10

### Added

- Native Full Screen for the application window (View menu). Host-owned window fullscreen, not web Document Fullscreen, not a Vue UI mode, and not persisted. Independent of Writing Focus. Shortcuts: F11 on Windows and Linux; Ctrl+Cmd+F on macOS. Normal window bounds are not written while the window is fullscreen.
- Writing Focus on the editor route: hides and inerts the editor chrome that should step aside (sidebars, tabs, format bar, idle right rail, statusbar) while Monaco stays the editor, typewriter presentation continues, and Preview, empty state, dialogs, context menus, toasts, the Linux on-screen application menu, and Quick Actions stay usable. Session-only; announced through the existing live region; not Graph Focus; not Full Screen; not persisted. Shortcuts remain Ctrl+Shift+F on Windows and Linux and Cmd+Shift+F on macOS.
- Writing Focus in Quick Actions (Fulvid group, beside Preview): enter/exit labels, pressed state when active, and the shared Focus toggle—discoverability for the existing capability, not a second owner.

### Changed

- Writing Focus and Full Screen compose independently: either, both, or neither. Neither turns the other on.
- Focus restore paths refuse disconnected, disabled, or inert targets so dialogs and context menus do not return keyboard focus into hidden chrome.

### Fixed

- Quick Actions no longer become hidden or inert with Writing Focus, so the Fulvid Focus control can turn the mode off from the toolbar. Narrow-viewport overlay inert behavior is unchanged.

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

[Unreleased]: https://github.com/ManuelGil/fulvid/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/ManuelGil/fulvid/releases/tag/v0.3.0
[0.2.0]: https://github.com/ManuelGil/fulvid/releases/tag/v0.2.0
[0.1.0]: https://github.com/ManuelGil/fulvid/releases/tag/v0.1.0
