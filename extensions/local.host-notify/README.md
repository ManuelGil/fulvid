# Host notify

## Purpose

Posts a single host notification confirming that Extensions are available.

## Why it belongs in an extension

It is the smallest complete Lua command workflow. Authors reuse it when they need a menu command that only notifies - without growing Fulvid’s core menus.

## Capabilities used

- `lua`
- `commands`
- `ui` (`ui.notify`)

## How it works

```text
Extensions menu -> local.host-notify.sayReady
    ↓
Lua run()
    ↓
ui.notify -> host notify owner -> toast
```

## What to copy

- Closed `api: 1` manifest with `entry`
- Namespaced command id (`<extensionId>.<commandId>`)
- `commands.register` + `ui.notify` during invoke

## What not to copy

- The specific confirmation copy - write messages that match your workflow

## Security boundary

This pack cannot access the filesystem, network, process APIs, or Monaco. It only triggers the existing notify owner through the Lua bridge.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | Extension API v1 manifest |
| `entry.lua` | Command registration |
| `README.md` | This reference note |
