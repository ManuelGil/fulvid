# Extensions

Fulvid's local **Extensions** system (API v1): small packs that add commands and document workflows through existing Fulvid owners.

**Boundary:** Fulvid is the host (runtime, capabilities, generic primitives). Extensions own product behavior - matching rules, labels, commands, and document semantics live only inside each installed pack. Deleting an extension must not require changing Fulvid core. The host discovers packs from `userData/extensions/` manifests; it has no built-in catalog of third-party packs.

| Audience | Start here |
| --- | --- |
| User | What Extensions can and cannot do (below); install by copying a pack into `userData/extensions/` |
| Extension author | Capability tables + [reference packs](../extensions/) |
| Maintainer | Ownership, budgets, footprint, and [tests as security contracts](#tests-as-security-contracts) |

Related: [ARCHITECTURE.md](./ARCHITECTURE.md) · [CONCEPTS.md](./CONCEPTS.md) · [SECURITY-AND-RESILIENCE.md](./SECURITY-AND-RESILIENCE.md) · [`extensions/README.md`](../extensions/README.md)

Lua is a **supported extension runtime** inside Extensions - not a second product and not a general scripting environment.

**Extensions are locally installed executable code.** Fulvid constrains capabilities (and isolates Wasm guest memory) but does **not** provide an OS-level sandbox. There is no marketplace, account, or cloud install path.


## Architectural contract

```text
Extension
    ->
Declared capability
    ->
Existing host owner
```

The Extension System orchestrates extension capabilities; it does not become the owner of the underlying product behavior.

An extension capability must call an existing owner or seam rather than recreate ownership inside the Extension System.

| Concern | Owner (not the Extension System) |
| --- | --- |
| Filesystem authority | Bun filesystem host (`src/bun/filesystem/`) |
| Document selection / Focus | Session + Focus owners ([ARCHITECTURE.md](./ARCHITECTURE.md)) |
| Live editor text, dirty, undo | Monaco / `MonacoHost` |
| Window fullscreen | BrowserWindow / native host |
| Search | Global Search / local find owners |
| Graph | Graph projection |
| Renderer / Preview inertness | Preview owner |

Never: `extension -> Vue / Monaco / filesystem` as a direct authority path.

## What Extensions is not

The Extension System is **not**:

- a general scripting environment
- a plugin OS
- a Node runtime for extensions
- a process launcher
- a filesystem sandbox
- a network sandbox
- a marketplace
- a second application runtime
- a second document model
- a second editor model
- a Monaco wrapper
- a general RPC bus

**Capability isolation ≠ OS sandbox.** Declared capabilities, reduced guest globals, Wasm guest heap ceilings, and wall-clock execution budgets constrain what an extension may ask the host to do. They do **not** place the guest in a separate OS process with kernel isolation. Do not oversell Lua/Wasm as equivalent to an OS process sandbox.

## Current capability surface

Load path: `userData/extensions/<id>/` at startup (**Extension API v1**, `"api": 1`). Repository packs under [`extensions/`](../extensions/) are production examples to copy into that path - not the load path itself.

All packs that contribute commands use Lua (`entry.lua`). There is no declarative host-action path.

| Capability / surface | Authority owner | Permitted operation | Explicitly absent | Limits | Failure |
| --- | --- | --- | --- | --- | --- |
| `lua` + `commands` | Lua host runtime -> registry | `commands.register` then host invoke of `run()` | Manifest command tables; generic bridges; host prompts | `LUA_EXTENSION_LIMITS` (source, commands, execution, memory) | Load/invoke fails closed; neighbors continue |
| `ui` | UI notify owner | `ui.notify(message)` | Arbitrary DOM/HTML/SVG; date helpers | `maxNotifyMessageChars` | Oversized notify rejected |
| `editor` | Monaco via editor seam | `editor.getSelection` / `editor.replaceSelection` | Live Monaco objects; full-buffer access; document activation; navigation; identity stamps in Lua | `maxEditorSelectionChars` | Rejected / fail closed / stale rejected; see Editor section |
| `document` | Untitled / document snapshot via seam | `document.getText` / `document.getCursor` / `document.reveal` / `document.createUntitled` | Filesystem write; activate/open document; live model; host template loader | `maxDocumentTextChars` (512 KiB); createUntitled reuses `maxTemplateBytes` | Rejected / fail closed |
| `decorations` | Monaco decorations via seam | `decorations.set(ranges)` / `decorations.clear()` (closed `style` tokens **or** validated `appearance` colors; per-extension) | Arbitrary CSS/HTML/JS; live decoration APIs; product marker semantics; keystroke auto-refresh | `maxDecorationRanges` (500) | Rejected / fail closed / stale rejected |
| `templates` | Generic Mustache substitute + UTC calendar date | `template.render(source, variables)` - escaped `{{name}}` only; string→string vars. Optional `clock.isoDate()` → `YYYY-MM-DD` (UTC) for pack-built context | Sections/partials/unescaped HTML; lambdas; filesystem; product variable factories (`getVariables`, ADR metadata); date/time subsystems | Template/output reuse `maxTemplateBytes`; 64 vars; key/value caps | Rejected / fail closed |

Guest APIs are only the surfaces above. There is no generic `host.call`. There is no Lua `fulvid.date` or command `prompts`.

Decoration paint has two mutually exclusive range fields:

- `style`: host severity tokens only - `info`, `warn`, `error` (generic chips; no product meaning).
- `appearance`: extension-owned structured colors (`backgroundColor`, optional `color` / `bold` / `overviewColor` / `glyph`). Fulvid validates hex/`rgba(...)` only and synthesizes host-authored CSS classes - guests never supply CSS, HTML, or JS.

Fulvid does not assign meaning to document text when applying decorations. Packs that care about `TODO`/`FIXME`, MDX comment tags, or any other product marker own that mapping and their colors themselves.

`template.render` is intentionally domain-free: packs supply both the template text and the variable table. Fulvid does not invent ADR (or any other product) variable names, defaults, naming transforms, or clocks for interpolation. `clock.isoDate()` is a generic UTC calendar string only - packs decide whether to put it in their context.

## Absent by design

These capabilities are **absent by design**. Adding one is an architectural/security change, not a routine extension of the API:

```text
fs
net
process
host.call
arbitrary JavaScript
arbitrary UI
Monaco object exposure
document activation from Lua
arbitrary document access
arbitrary workspace access
bytecode execution
Lua package/module loading
```

Absence is intentional containment, not an unfinished backlog item. A future addition requires a new explicit security and design decision, documentation, and contract tests - together.

## Editor

Editor capability under Extension API v1.

Protocol:

```text
snapshot (text + host-only identity stamps)
    ↓
Lua (text only)
    ↓
validate stamps still current
    ↓
Monaco owner/seam apply
```

**Stale operations are rejected.** If the active document, Monaco content version, or selection offsets change between snapshot and apply, the command fails with a localized error and performs no mutation.

Host-only snapshot stamps (never exposed to Lua):

- active `documentId`
- Monaco `alternativeVersionId`
- primary selection `startOffset` / `endOffset`

- Selection text is a **bounded snapshot** (`editor.getSelection()`).
- Lua does **not** receive a live Monaco object, model, range, or document id.
- Replacement is queued and applied through the existing Monaco owner/seam after Lua returns **only if** stamps still match; otherwise the command fails with a localized stale error and no mutation.
- Undo / dirty follow the Monaco model (same as other `executeEdits`).
- The size boundary (`LUA_EXTENSION_LIMITS.maxEditorSelectionChars` / `EDITOR_EXTENSION_LIMITS`) is **contractual** (256 KiB).
- The capability does **not** grant arbitrary document or editor authority.

Contract detail: `src/mainview/extensions/editorCapability.ts`.
Permanent stale test: `rejects stale editor apply when document or selection stamps change`.

## Security and resource budgets

Authoritative constants: `EXTENSION_PACK_LIMITS` in `src/mainview/extensions/extensionManifest.ts` (manifest, create-untitled body, notify) and `LUA_EXTENSION_LIMITS` in `src/bun/extensions/lua/luaLimits.ts` (Lua source/execution/memory/commands; notify reuses the pack limit). Editor mirrors via `EDITOR_EXTENSION_LIMITS` in `src/mainview/extensions/editorCapability.ts`.

| Budget | Constant | Security purpose |
| --- | --- | --- |
| Manifest size | `maxManifestBytes` | Caps discovery DTO input |
| Create untitled body | `maxTemplateBytes` | Caps `document.createUntitled` body (name retained) |
| Lua source size | `maxSourceBytes` | Caps guest source accepted at load |
| Execution timeout | `maxExecutionMs` | Interrupts runaway guest work |
| Guest memory | `maxWasmMemoryBytes` | Caps Wasm guest heap growth |
| Command count | `maxCommandsPerExtension` | Caps registrations per pack |
| Notification size | `maxNotifyMessageChars` | Caps notify payload |
| Editor selection / replace | `maxEditorSelectionChars` | Caps snapshot and replacement text |
| Document text | `maxDocumentTextChars` | Caps `document.getText` snapshot (512 KiB UTF-16) |
| Decoration | `maxDecorationRanges` | Caps ranges per `decorations.set` |
| Create untitled | `maxCreateUntitledChars` (= `maxTemplateBytes`) | Caps `document.createUntitled` body |

A budget is a **security/resource boundary**, not merely a performance optimization. Changing a budget value is a contract change and must keep permanent verification that pins observable boundary behavior (not only relative `limit + 1` derived from the constant).

## Runtime provenance

| Item | Established value |
| --- | --- |
| Wasmoon | `1.16.0` |
| Embedded PUC Lua | `5.4.5` (build-source identity: wasmoon `1.16.0` pins PUC submodule with `LUA_VERSION_RELEASE "5"`; shipped `glue.wasm` strings expose only `Lua 5.4`) |

Runtime upgrades (Wasmoon or replacement) require re-evaluation of:

- embedded Lua version / patch identity
- relevant CVEs and advisories
- guest restrictions
- memory behavior
- execution interruption
- packaged `glue.wasm` artifact
- cross-platform packaged behavior (`docs/compatibility.md`, `bun run smoke:lua-packaged`)

Do not assume a Wasmoon upgrade preserves the same Lua patch.

## Runtime replacement and removal boundaries

The runtime **implementation** may change (Wasmoon upgraded, replaced, removed, or another language/runtime used). The **authority model must not silently expand**.

If the runtime is upgraded, replaced, moved, or partially reused, preserve at minimum:

```text
source-only execution
no bytecode execution
no arbitrary module loading
no filesystem mount
no network authority
no process authority
no arbitrary host object injection
no arbitrary JS bridge
explicit capability surface
execution budget
memory budget
failure isolation
per-extension isolation
host ownership boundaries
```

Future runtimes need not use Wasm. They must not quietly become a privileged scripting engine.

**Reuse:** Reusing the runtime implementation elsewhere in Fulvid does **not** imply reusing or expanding its authority. Reuse must preserve capability scoping, existing owner boundaries, guest restrictions, resource budgets, failure isolation, source-only execution, and no arbitrary host bridge.

## Extension System removal checklist

If the Extension System is removed from Fulvid, complete removal should account for:

```text
discovery                         src/bun/extensions/
manifest validation               src/mainview/extensions/extensionManifest.ts
host registry                     src/mainview/extensions/extensionRegistry.ts
runtime                           src/bun/extensions/lua/
packaged glue.wasm                electrobun.config.ts copy -> bun/glue.wasm
menu integration                  Application Menu -> Extensions
userData extension paths          Utils.paths.userData/extensions
documentation                     docs/EXTENSIONS.md, ARCHITECTURE, INVARIANTS, CONCEPTS, compatibility
i18n strings                      extension-related catalog keys
tests                             tests/extensions/
temporary fixtures                tests/extensions/fixtures/
reference packs                   extensions/
build/package configuration       packaging + Electrobun copy rules
dependencies                      wasmoon (and related)
security documentation            SECURITY-AND-RESILIENCE.md
compatibility documentation       docs/compatibility.md Lua packaged matrix
```

Partial removal that leaves dead capability owners, orphaned menus, stale discovery directories, unused runtime dependencies, misleading docs, obsolete security assumptions, fixtures presented as supported product features, or tests for deleted architecture is incomplete.

This is a checklist, not a removal script.

## Footprint (removability map)

| Area | Path |
| --- | --- |
| Host discovery | `src/bun/extensions/` |
| Lua runtime | `src/bun/extensions/lua/` |
| Manifest / registry / editor seam | `src/mainview/extensions/` |
| Permanent contract tests | `tests/extensions/` |
| Declarative fixtures | `extensions/` |
| Disposable Lua fixtures | `tests/extensions/fixtures/` |
| Packaged glue | `electrobun.config.ts` -> `bun/glue.wasm` |
| Packaged smoke | `scripts/luaPackagedSmoke.ts` (`bun run smoke:lua-packaged`) |
| Docs | this file; cross-links in ARCHITECTURE, INVARIANTS, CONCEPTS, SECURITY-AND-RESILIENCE, compatibility |

## Tests as security contracts

Permanent tests under `tests/extensions/` protect architectural and security boundaries. They are **contract tests**, not merely implementation coverage.

| Question | Primary permanent coverage |
| --- | --- |
| Can an extension escape containment / own Monaco or filesystem? | `extensionUiBoundary.unit.test.ts`, `extensionFixtures.unit.test.ts` |
| Can it execute bytecode? | Load path rejects bytecode (`extensionLuaRuntime` / runtime) |
| Can it recover prohibited Lua globals? | `lua guest environment` - dangerous stdlib absent after reduction |
| Can it bypass execution limits? | `lua execution and memory budgets` - interrupt on load/invoke |
| Can it bypass memory limits? | same - controlled memory failure + neighbor isolation |
| Can it exceed capability limits? | notify size; command registration; editor size tests |
| Can malformed packs poison discovery? | `extensionDiscovery.unit.test.ts` - isolation / fail closed |
| Can one extension affect another? | failed pack does not block valid neighbor (Lua + editor suites) |
| Can editor access exceed its contract? | `extensionEditorCapability.unit.test.ts` |
| Can the editor size boundary regress (including constant mutation)? | `pins selection and replace boundary at 256 KiB` |
| Can the packaged runtime execute correctly? | `bun run smoke:lua-packaged` (platform matrix in `compatibility.md`) |

### Protecting contract tests

A test protecting a documented security boundary may only be removed when the boundary itself is intentionally removed or replaced, **and** the replacement contract is documented and covered by an equivalent or stronger verification mechanism.

```text
documented boundary
        <->
permanent verification
```

If the implementation changes but the boundary remains, the verification must survive. If the boundary changes intentionally, documentation and tests change together.

### Permanent tests vs temporary attack corpora

| Kind | Role |
| --- | --- |
| **Permanent tests** | Stable architectural/security invariants in `tests/extensions/` |
| **Temporary attack corpus** | Exploratory adversarial verification (may stay ephemeral / outside Git) |

Large fuzzing or red-team corpora need not be stored in the repository. The permanent suite retains only minimal regression tests for discovered defects or stable invariants.

## Security review status

```text
Extension System:
PRODUCTION (Extension API v1)

Lua runtime:
SUPPORTED IMPLEMENTATION DETAIL (wasmoon / Wasm)

Editor:
PRODUCTION
```

Honest trust model:

```text
Capability isolation ≠ OS sandbox
```

Extensions are locally installed executable code. Fulvid constrains capabilities; it does not provide an OS-level sandbox.

Platform packaging verification for the Lua runtime: [compatibility.md](./compatibility.md). That matrix is not a claim of complete cross-platform adversarial security coverage.

Promotion gates and acceptance record (historical specification for how the surface became production): [EXTENSION-PRODUCT-CONTRACT.md](./EXTENSION-PRODUCT-CONTRACT.md).

## Terminology

Use repository terms: **Extensions** / **Extension System**, **extension**, **capability**, **pack**, **host**, **guest**, **owner**, **seam**.

Do not introduce competing names (`plugin host`, `plugin sandbox`, `script host`, `extension application`, `extension VM`, `Lua Engine` as a second product) unless this repository intentionally defines them.
