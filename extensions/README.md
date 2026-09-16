# Extensions - reference packs

These directories are **real reference extensions** maintained with Fulvid. They are intentionally small, useful examples of the **production Extension API v1**.

They are not empty scaffolds or stubs.

Copy a pack into:

```text
userData/extensions/<id>/
```

Or use Settings → Extensions → Install from Folder…. Then reload the inventory or restart Fulvid. There is no marketplace.

## Canonical contract

```text
Fulvid Extensions
API: 1

Capabilities:
  lua
  commands
  ui
  editor
  document
  decorations
```

Full contract: [`docs/EXTENSIONS.md`](../docs/EXTENSIONS.md).

**Lua** is the supported extension runtime - not a separate product and not a general scripting environment.

**Extensions are locally installed executable code.** Fulvid constrains capabilities (and isolates Wasm guest memory) but does **not** provide an OS-level sandbox.

## Reference packs

| Id | Pattern demonstrated |
| --- | --- |
| [`fulvid.host-notify`](./fulvid.host-notify/) | Lua `ui.notify` |
| [`fulvid.blank-note`](./fulvid.blank-note/) | Lua `document.createUntitled` |
| [`fulvid.sort-lines`](./fulvid.sort-lines/) | Lua `editor` selection transform with reject-stale apply |

Each pack has a README covering purpose, why it is an extension, capabilities, data flow, what to copy / not copy, and its security boundary.

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
  fulvid.host-notify/
  fulvid.blank-note/
  fulvid.sort-lines/
```

Identity is `publisher.name` (`fulvid.*` here). Official product packs (`imgildev.*`) live in the sibling `fulvid-extensions` repository. Do not use the reserved publisher `local`.
