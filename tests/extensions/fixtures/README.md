# Disposable extension contract fixtures

These packs live under **tests** only. They are **not** Fulvid product examples.

- Product reference packs: `extensions/fulvid.host-notify`, `fulvid.blank-note`, `fulvid.sort-lines`
- Fixtures here exercise discovery, isolation, budgets, and editor seams for permanent contract tests
- They are **not** a permanent attack corpus and must not be presented as installable user examples

Packaged smoke may copy `test.contract-lua-notify` into a temp `userData/extensions` for runtime verification only.

Fixture ids use publisher `test` (e.g. `test.contract-lua-notify`). Do not use reserved publisher `local`.
