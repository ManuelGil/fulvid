# Extensions - reference packs

These directories are **real reference extensions** maintained with Fulvid. They are intentionally small, useful examples of the **production Extension API v1**.

They are not empty scaffolds or stubs.

Copy a pack into:

```text
userData/extensions/<id>/
```

Then restart Fulvid (discovery is startup-only). There is no marketplace.

## Canonical contract

```text
Fulvid Extensions
API: 1

Capabilities:
  commands
  templates
  ui
  lua
  editor
```

Full contract: [`docs/EXTENSIONS.md`](../docs/EXTENSIONS.md).

**Lua** is a supported extension runtime inside Extensions - not a separate product and not a general scripting environment.

**Extensions are locally installed executable code.** Fulvid constrains capabilities (and isolates Wasm guest memory) but does **not** provide an OS-level sandbox.

## Reference packs

| Id | Pattern demonstrated |
| --- | --- |
| [`local.host-notify`](./local.host-notify/) | Declarative command -> host `notify` |
| [`local.blank-note`](./local.blank-note/) | Declarative template -> untitled document |
| [`local.sort-lines`](./local.sort-lines/) | Lua + editor: selection transform with reject-stale apply |

Each pack has a README covering purpose, why it is an extension, capabilities, data flow, what to copy / not copy, and its security boundary.

## Declarative vs Lua

| Kind | When to use |
| --- | --- |
| Declarative | Static commands/templates that call existing host actions |
| Lua (`entry.lua`) | Bounded transformations when static declaration is not enough |

## Adding another permanent example

Add a pack here only when it:

1. performs a useful user-visible action;
2. demonstrates a reusable production pattern;
3. uses only the public Extension API v1 surface;
4. stays small enough to read in one sitting;
5. includes a README in the format above.

Do not add empty scaffolds, diagnostic pings, or test-only fixtures here. Contract/security fixtures live under `tests/extensions/`.

## Layout

```text
extensions/
  README.md
  local.host-notify/
  local.blank-note/
  local.sort-lines/
```
