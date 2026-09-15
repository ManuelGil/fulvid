# Blank note

## Purpose

Creates an untitled Markdown note with a dated heading from a pack-local template.

## Why it belongs in an extension

Personal or team note shapes should not bloat Fulvid’s built-in “New Document from README” catalog. Packs keep those shapes local and removable.

## Capabilities used

- `templates`
- `commands` (`createUntitledFromTemplate`)

## How it works

```text
Extensions menu -> local.blank-note.createBlankNote
    ↓
load templates/blank-note.md (contained in the pack)
    ↓
expand {date}
    ↓
existing untitled-document owner
```

## What to copy

- Template file path relative to the pack root
- Declarative command -> `createUntitledFromTemplate`
- `{date}` token expansion (host-owned)

## What not to copy

- The empty heading / Notes section - replace with your own structure
- Do not treat this as a Fulvid product template library

## Security boundary

Template paths must stay inside the pack. The pack cannot execute Lua/JS/MDX and cannot touch the filesystem beyond the host’s untitled-create path.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | Extension API v1 manifest, template, and command |
| `templates/blank-note.md` | Markdown body (`{date}` expanded by the host) |
| `README.md` | This reference note |
