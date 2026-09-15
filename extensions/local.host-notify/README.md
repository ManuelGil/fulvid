# Host notify

## Purpose

Posts a single host notification confirming that Extensions are available.

## Why it belongs in an extension

It is the smallest complete declarative command workflow. Authors reuse it when they need a menu command that only notifies - without Lua and without growing Fulvid’s core menus.

## Capabilities used

- `commands`
- `ui` (host action `notify`)

## How it works

```text
Extensions menu -> local.host-notify.sayReady
    ↓
host notify owner
    ↓
toast
```

## What to copy

- Closed `api: 1` manifest
- Namespaced command id (`<extensionId>.<commandId>`)
- Declarative `action: "notify"` with a static message

## What not to copy

- The specific confirmation copy - write messages that match your workflow

## Security boundary

This pack cannot access the filesystem, network, process APIs, Monaco, or Lua. It only triggers the existing notify owner.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | Extension API v1 manifest and command |
| `README.md` | This reference note |
