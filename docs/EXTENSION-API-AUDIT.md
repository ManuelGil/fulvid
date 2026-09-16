# Extension API audit (third-party author lens)

Snapshot after pushing TODO / MDX / ADR ownership into packs and curating `fulvid-extensions`.

## Capability matrix (hypothetical extensions)

| Extension idea | Possible with current API? | Sufficient APIs | Missing? | Notes |
| --- | --- | --- | --- | --- |
| Markdown word counter | **Yes** | `getText`, `notify`, command or document activation | — | |
| Heading navigator | **Yes** | `getText`, `reveal`, commands | — | |
| JSON formatter | **Partial** | `getSelection` / `replaceSelection` | full-buffer replace | Format selection today; whole-file needs user select-all or future range edit |
| Line-length ruler | **Yes** | document activation, `getText`, `appearance` | — | Litmus: `acme.line-length` |
| Spell / highlight | **Yes** | activation + `appearance` | — | No dictionary in host — pack-owned |
| Document statistics | **Yes** | `getText`, `notify` | status-bar API (rejected) | |
| Selection transformer | **Yes** | `getSelection`, `replaceSelection` | — | Empty selection = insert at cursor |
| Markdown link checker | **Yes** | `getText`, decorations | open-link (absent by design) | |
| Code/comment highlighter | **Yes** | decorations | — | |
| Frontmatter helper | **Partial** | `getText`, selection edit | range replace | Edit via selection or recreate untitled |
| Timestamp inserter | **Yes** | `clock.isoDate`, empty-selection `replaceSelection` | was: clock gated on templates | **Fixed:** clock always with Lua |
| Markdown table formatter | **Yes** | selection transform | — | |

## Broader categories

| Category | Covered? |
| --- | --- |
| Text transformation | Yes (selection) |
| Analysis | Yes (`getText` + notify/decorate) |
| Navigation | Yes (`reveal`) |
| Visual decoration | Yes (`appearance` / `style`) |
| Document generation | Yes (`createUntitled` + `template.render`) |
| Selection manipulation | Yes |
| Editor assistance | Partial (no multi-range edit, no status bar) |
| Metadata | Yes (parse `getText`; date via `clock`) |
| Formatting | Partial (selection-scoped) |
| Interactive commands | Yes |

## Required table

| Capability | Current API | Generic? | Sufficient? | Missing? | Action |
| --- | --- | --- | --- | --- | --- |
| Live document changes | `activation: document` + host debounce | Yes | Yes | Event bus | Keep narrow seam; document it |
| Read text | `document.getText` | Yes | Yes | — | Keep |
| Selection | `editor.getSelection` | Yes | Yes | — | Keep |
| Safe edits | `editor.replaceSelection` | Yes | Partial | range / multi-edit | **Reject** for now (see below) |
| Decorations | `set`/`clear` + style/appearance | Yes | Yes | — | Keep |
| Commands | `commands.register` + menus | Yes | Yes | — | Keep |
| Notifications | `ui.notify` | Yes | Yes | — | Keep |
| Templates | `template.render` | Yes | Yes | — | Keep |
| Clock | `clock.isoDate` | Yes | Yes (after fix) | was templates-gated | **Decouple from templates** |
| Document creation | `document.createUntitled` | Yes | Yes | — | Keep |

## 1. Public API contract

See [EXTENSION-AUTHOR-CONTRACT.md](./EXTENSION-AUTHOR-CONTRACT.md).

## 2. Missing generic primitives (implemented)

- **`clock.isoDate()` available to every Lua pack** — not only `templates`. Needed by timestamp/metadata extensions without pulling Mustache.

## 3. Rejected APIs (do not add)

| Tempting API | Why reject |
| --- | --- |
| `document.setText` / full buffer rewrite | High blast radius; selection + createUntitled cover many cases; revisit only if multiple real packs need it |
| `editor.replaceRange` / multi-edit transactions | Useful but expands stale semantics; wait for second independent product need |
| Status bar / custom UI widgets | Domain presentation ownership; breaks “existing owners only” |
| Generic event bus | Document activation is enough; bus invites cross-extension coupling |
| Raw Monaco / CSS / DOM | Security + ownership violation |
| `fs` / `net` / `process` | Absent by design |
| Per-API micro reference packs | Recreates artificial coverage zoo |

## 4. Ownership violations

| Finding | Status |
| --- | --- |
| `LEGACY_EXTENSION_ID_MIGRATION` maps former `local.todo-decorator` / `mdx-comments` / `adr-templates` | Keep for allowance migration only — not runtime product logic |
| No TODO/FIXME/MDX/ADR parsers in host decoration/template code | Clean |
| Product packs only in `fulvid-extensions` | Clean |

## 5. Documentation gaps (addressed)

- Author-facing Lua signatures, silent activation, debounce, reentrancy → `EXTENSION-AUTHOR-CONTRACT.md`
- Live document section linked from `EXTENSIONS.md`
- Litmus pack `acme.line-length` (under `fulvid-extensions/tests/extensions/`) for discoverability without TODO/ADR/MDX

## Success criterion

An independent developer can build useful extensions (word count, rulers, heading jump, selection transforms, ADR-like templates, decorations) from the author contract + one small example, without modifying Fulvid for ordinary ideas — while Fulvid stays a small host.
