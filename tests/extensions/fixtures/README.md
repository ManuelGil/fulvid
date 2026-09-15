# Disposable Lua extension fixtures

These packs are **not** part of the permanent `extensions/` architectural set.

- Permanent fixtures document the declarative boundary (`local.capability-notify`, `local.declarative-pack`).
- Fixtures here exercise the Bun-host Lua runtime (notify, experimental editor selection) and may be deleted without changing product contracts.
- They are **not** a permanent attack corpus. Permanent security/architecture verification lives in `tests/extensions/*.unit.test.ts` and is described in [`docs/EXTENSIONS.md`](../../../docs/EXTENSIONS.md).

Copy a pack into `userData/extensions/<id>/` only when experimenting locally. Restart Fulvid after copying (discovery is startup-only).
