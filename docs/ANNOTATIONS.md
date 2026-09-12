# Document annotations

Session-local notes attached to positions in the live Monaco model.

Product vocabulary: [CONCEPTS.md](./CONCEPTS.md). Ownership: [ARCHITECTURE.md](./ARCHITECTURE.md).

## What an annotation is

A temporary, document-local piece of plain-text user context on a tracked Monaco decoration range. It is not part of Markdown/MDX source, not persistent, not searchable, and not a diagnostic.

| Piece | Owner |
| --- | --- |
| Tracked range / decoration | Monaco model (`deltaDecorations`) |
| Annotation text + decoration id | Fulvid `documentAnnotations.ts` (`WeakMap` by model) |
| Session visibility (glyph/hover on/off) | `documentAnnotationVisibility.ts` (`documentAnnotationsVisible`) |
| Preferred visibility default | `settings.editor.showDocumentAnnotations` (persisted; not annotation content) |
| Commands / dialogs / toasts | Editor page + App command path + DialogHost |
| Quick Actions / View menu toggle | Same `toggleDocumentAnnotations` command |

## Existence ≠ visibility ≠ navigation

| Concern | Meaning |
| --- | --- |
| Existence | Annotation text + tracked range on the live model |
| Visibility | Whether glyph and hover are presented |
| Navigation | Next/previous still move the cursor to anchors while hidden |

Hiding annotations does not delete them, disable commands, clear state, or dispose tracked ranges. Creating or editing while hidden keeps presentation off until the user shows annotations again.

## Guarantees (Phase 1)

- Session-local and document-local: die with model dispose / tab close / app restart
- Survive tab switches while the model stays alive
- Do not dirty the document, write files, create sidecars, or use IPC/grants
- At most one annotation per line; soft cap of 32; text capped at 200 plain characters
- Hover (when visible) shows escaped plain text
- Navigate next/previous by document position with wrap, including while hidden
- Glyph margin infrastructure stays enabled; only annotation glyph/hover options are cleared when hidden
- Show/Hide control: Quick Actions + View menu; Writing Focus may hide Quick Actions chrome, menu remains available
- Reset settings restores the preferred default and syncs session visibility; it does not delete annotations

## Collapse / delete policy

If Monaco drops the decoration range, Fulvid prunes that annotation when listing. It does not reattach by text match, heading, fingerprint, or line number.

## Configuration

| Setting | Persisted | Purpose |
| --- | --- | --- |
| `editor.showDocumentAnnotations` | Yes | Preferred default for presentation at startup / settings change / reset |

Rejected as settings (implementation limits or non-goals): max annotation count, max text length, glyph vs overview ruler, Writing Focus–specific annotation preference.

## Explicitly deferred

- Lifecycle stress under heavy undo/redo and pathological counts
- Glyph collision with other glyph-margin consumers
- Deeper screen-reader inspection of glyph hits
- Monaco upgrade revalidation of stickiness and hover escaping
- Richer discovery UI (panels, cards, balloons)

## Out of scope

Persistence of annotation content/positions, sidecars, Graph/Search/Outline/Preview integration, collaboration, rich text, AnnotationManager/Store services, semantic or fuzzy reattachment.
