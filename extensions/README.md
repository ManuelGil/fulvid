# Extensions (repository fixtures)

This directory holds a **minimal set of long-lived fixtures** for Fulvid’s declarative extension boundary.

Authoritative Extension Engine contract (capabilities, absent-by-design, budgets, runtime replacement, removal, contract tests): [`docs/EXTENSIONS.md`](../docs/EXTENSIONS.md).

It is **not**:

- a marketplace or plugin catalog;
- official Fulvid product features;
- the runtime load path (that is `userData/extensions`);
- a permanent Lua product surface;
- a place for temporary product-gap workarounds.

It **is**:

- documentation-as-data for `extension → capability → owner`;
- durable examples of **declarative** packs;
- samples you can copy into `userData/extensions` to exercise discovery.

> These fixtures demonstrate composition and limits of extensibility. They are **not** recommended core features and must not be treated as a roadmap of product templates.

## Permanent fixtures (keep small)

| Id | Teaches |
| --- | --- |
| `local.capability-notify` | Declared command → host `notify` only (no Monaco, no FS) |
| `local.declarative-pack` | Declared template + `createUntitledFromTemplate` (product-neutral body) |

Do not add product-shaped packs (bug report, meeting, ADR, etc.) here. Those age into “missing core features.” Prefer disposable experiments outside the permanent set, or user-local packs under userData.

## Status

| Layer | Status |
| --- | --- |
| Fixtures (JSON + Markdown) | Present — copy into userData to load |
| Discovery (`userData/extensions`, `api: 0`) | **Implemented** (declarative + optional `lua` capability) |
| Host actions | `notify`, `createUntitledFromTemplate`; Lua packs use host-only `lua` invoke |
| Lua / wasmoon 1.16.0 | **Present** in `src/bun/extensions/lua/` — host-only Wasm, embedded PUC Lua **5.4.5**, budgets, reduced guest environment, source-only entry, failure isolation. Capability `editor` is **EXPERIMENTAL**. No filesystem capability. No `host.call`. Capability isolation ≠ OS sandbox. Details: [`docs/EXTENSIONS.md`](../docs/EXTENSIONS.md). Packaged `glue.wasm` → `bun/glue.wasm`; see `docs/compatibility.md`. Disposable fixtures under `tests/extensions/fixtures/`. |

## UI extension boundary

Path: `extension → declared capability / command → existing owner → presentation`. An extension is never an owner. The Extension Engine does not become the owner of filesystem, document, editor, window, search, graph, or renderer authority.

| Kind | Meaning today |
| --- | --- |
| **Current** | Host discovers `userData/extensions`, validates `api: 0` manifests, registers declarative commands/templates, invokes existing owners. Optional `lua` + experimental `editor` per [`docs/EXTENSIONS.md`](../docs/EXTENSIONS.md). Failures are isolated per pack. Namespaced ids: `<extensionId>.<commandId>` |
| **Future seam** | Additional capabilities only via an explicit security/design decision — not a routine API widening |
| **Forbidden** | Monaco internals, filesystem/grants, BrowserWindow, process, network, Vue internals, arbitrary HTML/SVG/DOM, MDX execution, Focus / Writing Focus / Graph policy, generic `host.call`, bytecode entry, undeclared executable surfaces (declarative packs must not ship executable `main` / JS entry; Lua `entry.lua` only when capability `lua` is declared) |

Never: `extension → Vue/Monaco/filesystem`. Do not invent a second owner to “make an extension work.”

Contract tests: `tests/extensions/` (see [`docs/EXTENSIONS.md`](../docs/EXTENSIONS.md#tests-as-security-contracts)).

## Layout

```text
extensions/
  README.md
  local.capability-notify/manifest.json
  local.declarative-pack/manifest.json
  local.declarative-pack/templates/sample.md
```

Ids use the `local.*` prefix so they never look like a public registry. The load path is `Utils.paths.userData/extensions/<id>/`.

## Relation to `examples/`

| Path | Meaning |
| --- | --- |
| `examples/demo-workspace/` | Demo **notes** for Open folder / screenshots |
| `extensions/` | **Extension-boundary fixtures** (manifests), not a notes folder |

## Local artifacts

Only generated state is gitignored (`extensions/**/.cache/`, `extensions/**/dist/`). Manifests and templates stay tracked.
