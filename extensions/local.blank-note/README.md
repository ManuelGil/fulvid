# Blank note

## Purpose

Creates an untitled blank note with a heading and a date placeholder.

## Why it belongs in an extension

Document seed text is extension product behavior. Fulvid only bridges `document.createUntitled` to the existing untitled-document owner.

## Capabilities used

- `lua`
- `commands`
- `ui`
- `document` (`document.createUntitled`)

## How it works

```text
Extensions menu -> local.blank-note.createBlankNote
    ↓
Lua run()
    ↓
document.createUntitled(markdown) -> untitled owner
ui.notify -> toast
```

## What to copy

- Closed `api: 1` manifest with `document` + `entry`
- Embed seed Markdown in `entry.lua` (no host template loader)

## What not to copy

- Expecting the host to expand `{date}` or load pack `.md` templates

## Security boundary

No filesystem write into the Folder. Untitled creation goes through the host document owner with size budgets. Guest `os` is unavailable; date text is a static placeholder.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | Extension API v1 manifest |
| `entry.lua` | Seed body + command registration |
| `README.md` | This reference note |
