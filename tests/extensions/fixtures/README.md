# Disposable Lua extension fixtures

These packs are **not** part of the production `extensions/` example set.

- Production examples: `local.capability-notify`, `local.declarative-pack`, `local.sort-lines` (copy into `userData/extensions`).
- Fixtures here are disposable runtime experiments and may be deleted without changing the Extension API v1 contract.
- They are **not** a permanent attack corpus. Permanent verification: `tests/extensions/*.unit.test.ts` and [`docs/EXTENSIONS.md`](../../../docs/EXTENSIONS.md).

Copy a pack into `userData/extensions/<id>/` only when experimenting locally. Restart Fulvid after copying (discovery is startup-only).
