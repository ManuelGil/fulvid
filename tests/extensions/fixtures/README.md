# Disposable Lua extension fixtures

These packs are **not** part of the permanent `extensions/` architectural set.

- Permanent fixtures document the declarative boundary (`local.capability-notify`, `local.declarative-pack`).
- Fixtures here exercise the Bun-host Lua runtime (notify, experimental editor selection) and may be deleted without changing product contracts.

Copy a pack into `userData/extensions/<id>/` only when experimenting locally. Restart Fulvid after copying (discovery is startup-only).
