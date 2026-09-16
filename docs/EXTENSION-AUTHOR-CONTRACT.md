# Extension author contract (API v1)

Public contract for building an independent Fulvid extension. Prefer this document over reading host internals.

Fulvid is a **small host**. The API is intentionally narrow. Host tests validate the host; this contract is what packs may call.

## Pack layout

```text
publisher.name/
  manifest.json
  init.lua          # or any relative .lua entry
  README.md         # recommended
```

Folder name under `userData/extensions/` **must equal** `manifest.id` (`publisher.name`).

No build step, bundler, TypeScript, or package manager is required.

## Install / update / remove

| Step | What to do |
| --- | --- |
| Install | Copy the pack folder into `userData/extensions/<id>/`, **or** Settings -> Extensions -> Install from Folder... |
| Discover | Restart Fulvid, or Settings -> Extensions -> **Reload inventory** |
| Update | Replace files in that folder (same `id`), then Reload inventory / restart |
| Remove | Delete the folder, **or** Settings -> Extensions -> Uninstall |

After Reload/restart the inventory converges to the filesystem. There is no marketplace and no ZIP installer.

If the pack is **blocked** (manifest/path invalid) or **failed** (Lua/load error), Settings shows a concise reason. Explicit **Allow** consent can retry a failed pack; menus never silently bypass a blocked/failed state.

## Manifest (minimum)

```json
{
  "publisher": "acme",
  "name": "heading-nav",
  "id": "acme.heading-nav",
  "displayName": "Heading Navigator",
  "version": "1.0.0",
  "api": 1,
  "description": "Jump to the next or previous Markdown heading.",
  "capabilities": ["lua", "commands", "ui", "document"],
  "entry": "init.lua",
  "activation": "command",
  "actions": [
    { "id": "headingNext", "menu": "navigate", "order": 100, "title": "Next heading" },
    { "id": "headingPrevious", "menu": "navigate", "order": 110, "title": "Previous heading" }
  ]
}
```

### Required fields

| Field | Rule |
| --- | --- |
| `publisher` | `/^[a-z][a-z0-9-]*$/` - not `local` (reserved) |
| `name` | `/^[a-z][a-z0-9-]*$/` |
| `displayName` | non-empty human title |
| `description` | non-empty |
| `version` | semver `MAJOR.MINOR.PATCH` (optional pre-release/build suffix) |
| `api` | integer `1` |
| `capabilities` | non-empty closed list |
| `entry` | relative `.lua` path when `lua` is present |

`id` is optional; when present it **must** equal `publisher.name`.

### Optional fields

`activation`, `documentAction`, `actions`, `author`, `license`, `homepage`, `repository`, `bugs`, `keywords`.

### Capabilities (closed)

`lua`, `commands`, `ui`, `editor`, `document`, `decorations`, `templates`.

- `lua` requires `commands` + `ui` + `entry`.
- Other caps require `lua`.
- Missing capability ⇒ that API global is **nil** in Lua (e.g. calling `document.getText` without `document` fails with an attempt to index nil).

### Menu targets (closed)

`file.new`, `edit`, `view`, `navigate`, `help`.

### Actions <-> commands

Every `actions[].id` and `documentAction` **must** match a `commands.register({ id = ... })` id after load. Otherwise discovery marks the pack **failed** (`action "..." is not registered` / `documentAction "..." is not registered`).

### Activation

| Mode | Behavior |
| --- | --- |
| `command` (default) | Commands run from menus / Settings inventory |
| `document` | Requires `documentAction`. Host silently re-invokes that command after live buffer changes (debounced) |

`activation: "startup"` is reserved in the schema but **not implemented** - do not rely on it.

Validation failures return a short reason (`what` + expected shape). Packs with invalid manifests appear as **blocked** in Settings.

## Lua APIs

Guest has no `os` / `io` / `require` / `load` / `host.call`.

### Always (with `lua`)

| API | When | Notes |
| --- | --- | --- |
| `commands.register({ id, title, run })` | load only | Id `/^[a-z][a-zA-Z0-9]*$/`; ≤16 commands |
| `clock.isoDate()` | load + invoke | UTC `YYYY-MM-DD` only - not a date framework |

### `ui`

| API | Notes |
| --- | --- |
| `ui.notify(message)` | invoke only; ≤500 chars; ≤16/invoke; suppressed when host uses silent document activation |

### `editor` (editing boundary)

| API | Notes |
| --- | --- |
| `editor.getSelection()` | bounded selection snapshot string |
| `editor.replaceSelection(text)` | **only generic write primitive**; empty selection inserts at cursor; stale selection rejected |

Possible today: insert at cursor, replace/transform selection, seed a new buffer via `document.createUntitled`.  
**Not** available: arbitrary range rewrite / multi-cursor / full-buffer `setText`. Prefer selection + untitled composition over wishing for a larger editor API.

### `document`

| API | Notes |
| --- | --- |
| `document.getText()` | full buffer snapshot (≤512 KiB) |
| `document.getCursor()` | `{ line, column }` 1-based |
| `document.reveal(line, column)` | scroll/focus |
| `document.createUntitled(markdown)` | new untitled tab after return |

### `decorations`

| API | Notes |
| --- | --- |
| `decorations.set(ranges)` | ≤500 ranges; each needs **exactly one** of `style` or `appearance` |
| `decorations.clear()` | clear this pack's decorations |

`style`: `"info"` \| `"warn"` \| `"error"` (host chips).  
`appearance`: `{ backgroundColor, color?, bold?, overviewColor?, glyph? }` - hex/`rgba` only; host synthesizes CSS. Extension owns meaning; Fulvid owns safe rendering. No raw CSS / Monaco decoration objects.

Ownership: each pack's decorations are cleared/replaced by that pack only. Stale document stamps fail closed (next change retries).

### `templates`

| API | Notes |
| --- | --- |
| `template.render(source, variables)` | escaped `{{name}}` only; string->string vars |

## Live document contract

For `activation: "document"`:

1. Host watches the active Monaco model (`contentChange`) and active buffer identity.
2. Debounce ≈ **180 ms**; newer changes cancel in-flight work.
3. Host runs each pack's `documentAction` **sequentially** with `{ silent: true }` (no toasts).
4. Snapshot includes host-only stamps (`documentId`, `alternativeVersionId`). Lua never sees stamps.
5. `decorations.set` / `clear` apply only if stamps still match; otherwise fail closed - next change retries.
6. Parallel Lua invokes are rejected (reentrancy). Do not return async `run` results.
7. Switching documents / clearing / replacing text triggers another activation cycle for the new active buffer. Save is **not** a special activation event.

Mental model:

```text
live editor document
        |
document activation (debounced)
        |
extension reads current state
        |
extension produces result (decorate / notify / ...)
```

Extensions do **not** subscribe to a generic event bus. Do not poll the filesystem for document changes.

## Stale edits

`editor.replaceSelection` applies only if selection stamps still match.  
`document.reveal` checks active `documentId`.  
`document.createUntitled` is not stamp-gated.

## Security (understandable boundaries)

These absences are intentional, not missing features:

| Absent | Why |
| --- | --- |
| Filesystem / network / process | Host owns IO; packs stay portable and reviewable |
| Arbitrary JS / DOM / raw CSS | Renderer stays inert; decorations use validated appearance |
| Dynamic Lua loading (`require` / `load`) | Fixed entry source only |
| Raw Monaco objects | Host owns editor authority |

Also not planned: full-buffer rewrite, range multi-edit, status-bar/widgets, generic event bus, marketplace/package manager.

Budgets: source 64 KiB, exec 2s, Wasm memory 8 MiB, selection/replace 256 KiB, decoration ranges 500.

Capability / limit failures surface as concise invoke or load errors (`missing capability` via nil globals, `execution limit exceeded`, decoration parse errors). One failed pack does not take down Fulvid, other packs, editing, or native menus.

## Failure messages

Typical discovery reasons (Settings inventory):

| Situation | Example reason |
| --- | --- |
| Bad manifest | `invalid extension version: expect semver...` |
| Lua syntax | `lua:1: '}' expected near 'title'` |
| Missing API (no cap) | `lua:2: attempt to index a nil value (global 'document')` |
| Menu action mismatch | `action "missing" is not registered` |

Reasons are single-line and bounded - no full source dumps, RPC payloads, or document contents.

## Independence

```text
extension A -> Fulvid API <- extension B
```

Never `extension A -> extension B`. No shared pack runtime.

A third-party pack must be copyable into another Fulvid install without any Fulvid source. Pack semantics (rules, labels, templates, visuals) change only inside the pack.

## Examples

| Pack | Role |
| --- | --- |
| [`acme.line-length`](../../fulvid-extensions/tests/extensions/acme.line-length/) | Reference litmus: document activation + `appearance` decorations + Help command |
| [`acme.heading-nav`](../../fulvid-extensions/tests/extensions/acme.heading-nav/) | Reference fresh-author DX: command activation + Navigate + `getText` / `reveal` / `notify` |

These live under `fulvid-extensions/tests/extensions/` - **not** the production catalog (`extensions/imgildev.*`). Neither is a product pack.

## Related

- [EXTENSIONS.md](./EXTENSIONS.md) - architecture, budgets, absences; production vs reference packs
- [fulvid-extensions](../../fulvid-extensions/) - production catalog + reference packs
