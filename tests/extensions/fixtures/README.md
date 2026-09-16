# Disposable extension contract fixtures

These packs live under **tests** only. They are **not** Fulvid product examples and are never shipped.

| Fixture | Why it exists |
| --- | --- |
| `test.contract-lua-notify` | Real pack load/register/invoke for notify (also packaged smoke) |
| `test.contract-lua-editor` | Real pack load for editor selection/replace seam |

Host discovery, budgets, and isolation otherwise use inline temp packs. Product packs live in sibling `fulvid-extensions`.

Packaged smoke may copy `test.contract-lua-notify` into a temp `userData/extensions`. Fixture ids use publisher `test`.
