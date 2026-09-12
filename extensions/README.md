# Extensions (repository fixtures)

This directory holds a **minimal set of long-lived fixtures** for Fulvid’s future extension boundary.

It is **not**:

- a marketplace or plugin catalog;
- official Fulvid product features;
- installable plugins (Fulvid does **not** load this directory today);
- a runtime, SDK, or permission system;
- a place for temporary product-gap workarounds.

It **is**:

- documentation-as-data for `extension → capability → owner`;
- durable examples of **declarative** packs;
- architecture teaching aids for future contributors.

> These fixtures demonstrate composition and limits of extensibility. They are **not** recommended core features and must not be treated as a roadmap of product templates.

## Permanent fixtures (keep small)

| Id | Teaches |
| --- | --- |
| `local.capability-notify` | Declared command → `notify` only (no Monaco, no FS) |
| `local.declarative-pack` | Declared template + `createUntitledFromTemplate` (product-neutral body) |

Do not add product-shaped packs (bug report, meeting, ADR, etc.) here. Those age into “missing core features.” Prefer disposable experiments outside the permanent set, or user-local packs once a loader exists.

## Status

| Layer | Status |
| --- | --- |
| Fixtures (JSON + Markdown) | Present — **not loaded** |
| Discovery / loader | **Not implemented** |
| Lua / wasmoon | **Not implemented** |

Contract tests: `tests/extensions/extensionFixtures.unit.test.ts` (permanent set size, allowed capabilities/actions, no executable artifacts).

## Layout

```text
extensions/
  README.md
  local.capability-notify/manifest.json
  local.declarative-pack/manifest.json
  local.declarative-pack/templates/sample.md
```

Ids use the `local.*` prefix so they never look like a public registry.

## Relation to `examples/`

| Path | Meaning |
| --- | --- |
| `examples/demo-workspace/` | Demo **notes** for Open folder / screenshots |
| `extensions/` | **Extension-boundary fixtures** (manifests), not a notes folder |

## Research

- `docs/research/2026-09-10-lua-extension-engine.md`
- `docs/research/2026-09-10-small-core-unix-extensibility.md`
- `docs/research/2026-09-11-extension-workspace-and-risk.md` (initial inventory)
- `docs/research/2026-09-11-extension-fixtures-longevity.md` (**fixture set decision**)

## Local artifacts

Only generated state is gitignored (`extensions/**/.cache/`, `extensions/**/dist/`). Manifests and templates stay tracked.
