# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file is updated as part of the change, not reconstructed when a version is tagged. Add user-facing entries under `Unreleased`. When a version is released, move those entries under that version and start a new empty `Unreleased` section. Do not log every commit or internal refactor. Do not rewrite a published version except to correct a factual error. A release is not documentarily complete until this file lists it.

## [Unreleased]

### Changed

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

[0.1.0]: https://github.com/ManuelGil/fulvid/releases/tag/v0.1.0
