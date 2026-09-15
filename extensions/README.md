# Extensions

Local-first Fulvid **Extensions** — declarative and Lua packs that contribute commands and document workflows through existing Fulvid owners.

Authoritative contracts:

- Product / promotion: [`docs/EXTENSION-PRODUCT-CONTRACT.md`](../docs/EXTENSION-PRODUCT-CONTRACT.md)
- Architecture & security: [`docs/EXTENSIONS.md`](../docs/EXTENSIONS.md)

## Install model

Extensions load from:

```text
userData/extensions/<id>/
```

This repository’s `extensions/` packs are **production examples** you can copy into that directory. There is no marketplace.

Restart Fulvid after copying (discovery is startup-only).

## First-release examples

| Id | Workflow |
| --- | --- |
| `local.capability-notify` | Command → host `notify` |
| `local.declarative-pack` | Template → untitled blank note (`{date}` expanded) |
| `local.sort-lines` | Lua + editor: sort selected lines A→Z |

## Product boundary

```text
Fulvid
  └── Extensions
       ├── declarative extensions
       └── Lua extensions → constrained capabilities
```

Lua is a **supported extension runtime**, not a separate product and not a general scripting environment.

**Extensions are locally installed executable code.** Fulvid constrains their capabilities but does not provide an OS-level sandbox.

## Extension API v1

Manifests require `"api": 1`.

Production capabilities: `commands`, `templates`, `ui`, `lua`, `editor`.

Editor (`getSelection` / `replaceSelection`) uses snapshot → Lua (text only) → reject-stale apply through Monaco. See [`docs/EXTENSIONS.md`](../docs/EXTENSIONS.md).

## Layout

```text
extensions/
  README.md
  local.capability-notify/manifest.json
  local.declarative-pack/manifest.json
  local.declarative-pack/templates/blank-note.md
  local.sort-lines/manifest.json
  local.sort-lines/entry.lua
```

Disposable runtime experiments (not the production set): `tests/extensions/fixtures/`.
