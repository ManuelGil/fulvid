# Sort lines

## Purpose

Alphabetically sorts the lines in the current primary selection.

## Why it belongs in an extension

Line sorting is a recurring editing chore that is not part of Fulvid’s Markdown format toolbar. Keeping it as an extension avoids adding another core editing command while still teaching the production editor pattern.

## Capabilities used

- `lua`
- `commands`
- `ui`
- `editor`

## How it works

```text
snapshot (selection text + host-only stamps)
    ↓
editor.getSelection() in Lua
    ↓
sort lines
    ↓
editor.replaceSelection(sorted)
    ↓
host verifies stamps still current
    ↓
Monaco executeEdits (or reject stale)
```

Lua never receives Monaco objects, document ids, or version stamps.

## What to copy

- Source-only `entry.lua` + `commands.register`
- Text-only `getSelection` / `replaceSelection`
- Bounded transforms that stay inside the 256 KiB editor limit
- Optional `ui.notify` for empty/insufficient selection

## What not to copy

- Reimplementing Markdown bold/italic/code - those already live in Fulvid core
- Assuming apply always succeeds - handle empty selection and rely on host stale rejection

## Security boundary

No filesystem, network, process, `require`, `load`, or host bridge. Execution and memory budgets apply. Stale document/selection/version stamps reject with zero mutation.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | Extension API v1 + `lua`/`editor` capabilities |
| `entry.lua` | Registers `sortLines` and performs the transform |
| `README.md` | This reference note |
