# Extension Product Contract

Accepted production contract for Fulvid **Extensions** (API v1).

This document records the gates used to promote the system from experimental work to a single production product capability. Production-facing behavior is described in [EXTENSIONS.md](./EXTENSIONS.md). Historical gate language below is retained as the promotion specification; the acceptance record at the end reflects the current production state.

Standing architecture/security detail: [EXTENSIONS.md](./EXTENSIONS.md). Ownership: [ARCHITECTURE.md](./ARCHITECTURE.md). Review posture: [SECURITY-AND-RESILIENCE.md](./SECURITY-AND-RESILIENCE.md).

This document is the **promotion specification**. It does not itself promote the surface, create a commit, tag, or release.

## 0. Purpose

The supported product boundary is:

> **Fulvid is a native Markdown/MDX editor with a production extension system that may execute constrained Lua plugins.**

The Extension Engine and Lua runtime must not be treated as two independent experimental products.

```text
Fulvid
  └── Extensions
       └── Lua extensions
            └── constrained capabilities
```

Lua is an implementation/runtime mechanism inside the Extension product. It is not a second product.

## 1. Promotion decision

Promotion is allowed only when all mandatory gates in this contract are satisfied.

Required product state after promotion:

```text
Extension System:
PRODUCTION

Lua Runtime:
PRODUCTION IMPLEMENTATION OF THE EXTENSION SYSTEM

Editor capability:
PRODUCTION, if and only if its contract is frozen below

Experimental:
NONE within the production extension contract
```

There must not be a state in which:

```text
Extension Engine = production
Lua = experimental
```

or:

```text
Lua = production
Editor extension API = experimental
```

if the product presents Lua plugins as a supported production feature.

If any mandatory capability remains experimental, the entire corresponding public extension surface remains experimental.

## 2. Product contract

The supported product is:

> A local, filesystem-oriented extension system that allows Lua extensions to contribute narrowly scoped commands, notifications, and explicitly defined editor/document transformations through existing Fulvid owners.

The extension system:

- is local-first;
- is filesystem-based;
- is source-first;
- does not create a proprietary document store;
- does not execute MDX;
- does not become a second document model;
- does not become a general scripting environment;
- does not become a general-purpose plugin OS.

## 3. Ownership contract

The Extension System is an **orchestrator**, not an owner of underlying product state.

```text
Extension
    ->
Capability
    ->
Existing Fulvid owner
```

The Extension System must never become an alternative owner for:

```text
live editor text
document selection
filesystem authority
workspace authority
window state
graph state
search state
renderer state
```

In particular:

```text
Monaco owns live editor state.
Focus owns document selection/focus authority.
Filesystem owns disk/content authority.
Graph remains a projection.
BrowserWindow/native host owns window presentation state.
```

An extension may request an operation through an existing seam. It must not obtain the underlying owner object.

## 4. Production Lua contract

### 4.1 Source-only execution

Production Lua extensions:

```text
MUST execute source
MUST NOT execute Lua bytecode
MUST NOT accept binary chunks
MUST NOT expose loadfile/dofile
MUST NOT expose arbitrary load
MUST NOT expose string.dump
```

The source format must remain explicitly defined.

## 5. Guest isolation contract

The production Lua guest must not have arbitrary access to:

```text
io
os
package
debug
require
dofile
loadfile
load
string.dump
```

or equivalent indirect authority.

Removing a global is insufficient by itself.

> A plugin must not be able to recover equivalent prohibited authority through another reachable object, bridge, proxy, closure, metatable, or host reference.

## 6. Host bridge contract

The Lua runtime must not expose arbitrary host objects. Production Lua must use explicit capability-shaped APIs.

Prohibited as general extension mechanisms:

```text
host.call
eval
arbitrary JavaScript
Function
Node/Bun APIs
process
filesystem handles
network handles
renderer internals
Monaco objects
BrowserWindow objects
Vue objects
```

The host bridge must remain an explicit allowlist. A new host capability is a product/security change and requires an explicit contract update.

## 7. Production capability set

The production capability surface must be intentionally small.

Current production candidates:

```text
commands
ui.notify
editor
document
decorations
```

The exact public API must be frozen before promotion. No capability may be considered implicitly available because the host happens to expose an internal function. Only documented capability APIs are public.

## 8. Editor capability promotion

The Editor capability may move from `EXPERIMENTAL` to `PRODUCTION` only when its contract is explicitly frozen.

Production API:

```text
editor.getSelection()
editor.replaceSelection(text)
```

The Lua guest receives **text snapshots**, not Monaco objects.

```text
snapshot
    ->
Lua execution
    ->
validated result
    ->
existing Monaco owner/seam
    ->
document mutation
```

Lua must never receive: `ITextModel`, editor instance, Monaco model/editor, DOM node, Vue component, or host editor object.

## 9. Editor document authority

`editor.getSelection()` refers only to the active editor/document available through the existing application seam.

`editor.replaceSelection()` may modify only the editor/document represented by that invocation.

An extension must not be able to select, activate, open, read, or modify another document, obtain document handles, or retain live editor authority unless a future explicit capability contract introduces such authority. That future capability must not be inferred from `editor`.

## 10. Editor size contract

The production Editor capability must retain the explicit resource boundary of **256 KiB** for the applicable selection/replacement contract.

The boundary is contractual. Permanent tests must protect `limit - 1`, `limit`, and `limit + 1`, and mutation verification must show that changing the effective boundary fails the relevant permanent test.

## 11. Editor TOCTOU contract

The snapshot/apply model must document its concurrency semantics. The production contract must explicitly choose one of:

```text
A. apply against current active editor
B. reject stale invocation
C. bind operation to document identity/version
```

A silent assumption is not acceptable for production.

If the implementation retains a live-apply TOCTOU that can cause an extension to mutate the wrong document, that is a **promotion blocker** until resolved or eliminated from the production contract.

## 12. Runtime resource contract

Every production Lua invocation must enforce:

```text
source-size limit
execution-time limit
guest-memory limit
command-registration limit
notification-size limit
editor selection/replacement limit
```

Limits are enforced by the runtime/host. Exceeding a budget fails in isolation and must not crash Fulvid, hang indefinitely, poison another extension, corrupt global extension state, or bypass capability restrictions.

Authoritative constants: `LUA_EXTENSION_LIMITS` in `src/bun/extensions/lua/luaLimits.ts`.

## 13. Failure isolation

A malformed, crashing, timing-out, or memory-exhausting extension must not prevent unrelated valid extensions from loading or leave the host unusable. Discovery and invocation remain fail-closed and continue to neighbors.

## 14. Cross-extension isolation

Extensions must not obtain authority over one another (command shadowing, shared mutable capability objects, cross-extension host references, state poisoning, identity confusion). Namespaced extension identity remains stable.

## 15. Filesystem security contract

Retain canonical containment, entry validation, template containment, symlink/junction-aware resolution where applicable, source-only loading, and fail-closed path validation. No extension capability may silently bypass Fulvid’s existing filesystem security model. The Extension System does not create a new filesystem authority.

## 16. OS sandbox honesty

Production status must never imply that Lua plugins are OS-sandboxed.

> Fulvid uses capability restrictions and Wasm guest isolation; this is not equivalent to an OS-level security sandbox.

Extensions are local executable code selected/installed by the user.

## 17. Runtime provenance contract

Currently validated provenance:

```text
Wasmoon:
1.16.0

Embedded PUC Lua:
5.4.5
```

Runtime upgrades must revalidate Lua provenance, advisories, guest restrictions, bytecode/memory/interrupt behavior, host bridge behavior, packaged `glue.wasm`, and supported platforms. A runtime upgrade must not silently change the security contract.

## 18. Portability contract

Production support requires Linux x64, Windows x64, and macOS arm64 to preserve the same logical extension contract. Platform differences may exist in implementation details; they must not silently change capability authority, path containment semantics, guest restrictions, resource limits, failure isolation, or extension identity. A platform-specific security bypass is a production blocker.

## 19. Packaged runtime contract

Development-mode success is insufficient. The production artifact must verify packaged `glue.wasm`, discovery, Lua execution, guest restrictions, execution/memory budgets, and capability restrictions. See [compatibility.md](./compatibility.md) and `bun run smoke:lua-packaged`.

## 20. Versioning contract

The Extension API requires an explicit version describing the **public extension contract**, not the Lua engine version. Changing capability semantics, argument types, security authority, resource semantics, editor behavior, or failure behavior is an API change. Upgrading Wasmoon internally is not necessarily an API change if the public contract remains unchanged.

## 21. Compatibility contract

A production extension must not depend on undocumented implementation details. Undocumented access to host internals, runtime objects, internal modules, renderer/Monaco objects, or filesystem internals is unsupported even if technically reachable.

## 22. Extension package contract

A production extension package must have a deterministic identity and manifest. Unknown security-sensitive fields must fail closed. The loader must not interpret arbitrary manifest fields as executable instructions. Executable Lua must be explicitly represented by the production extension contract.

## 23. Installation / discovery contract

Discovery remains local, filesystem-based, deterministic, and failure-isolated. Malformed packs must not poison discovery. Valid packs remain discoverable after unrelated invalid packs.

## 24. Security review contract

Promotion requires review of Lua provenance, relevant CVEs, guest restrictions, host bridge, filesystem containment, resource limits, failure isolation, cross-extension isolation, editor authority, packaged runtime, and supported platforms.

A future runtime replacement requires repeating the relevant security assessment: **revalidate the boundary**, not the historical test session.

## 25. Permanent test contract

Permanent tests under `tests/extensions/` protect stable product/security invariants (discovery isolation, manifest validation, identity, containment, template safety, guest restrictions, source-only execution, budgets, capability restrictions, notification/editor limits, editor authority, cross-extension isolation, packaged runtime smoke).

The documented contract is the specification. Tests provide executable enforcement.

## 26. Test removal rule

A permanent security/contract test must not be removed merely because the implementation changed, the test became inconvenient, coverage appears redundant, the code path looks obvious, or another test happens to pass.

It may be removed only when:

1. the protected contract is intentionally removed or changed; and
2. the documentation is updated; and
3. an equivalent or stronger verification mechanism exists.

## 27. Temporary red-team corpus

Large adversarial corpora remain disposable. The repository should contain minimal permanent regressions and stable contract tests, not every historical attack payload.

## 28. Removal contract

The Extension System must remain removable as a coherent subsystem. Complete removal must account for discovery, manifest validation, host registry, runtime, `glue.wasm`, menus, i18n, userData paths, dependencies, packaging, documentation, tests, fixtures, and security/compatibility references. See [EXTENSIONS.md](./EXTENSIONS.md#extension-system-removal-checklist).

## 29. Runtime replacement contract

If Wasmoon is replaced, the runtime may change; the extension authority model must not silently expand. The replacement must preserve source-only execution, guest isolation, capability scoping, resource limits, failure isolation, host ownership, filesystem boundaries, and editor authority, and must pass this production contract before becoming the shipped runtime.

## 30. Capability addition contract

Adding a capability requires explicit review defining owner, authority, arguments, resource limits, failure semantics, security boundary, cross-extension implications, tests, documentation, and compatibility implications. No internal host function becomes a public extension API merely because it is convenient.

## 31. Product UX contract

Users should experience **Extensions** (Lua packs), not a second conceptual "Lua Engine" product. Lua implementation details are not a second user-facing product.

## 32. Documentation contract

The authoritative extension contract must remain discoverable from the existing documentation structure and must distinguish product contract, implementation detail, security invariant, experimental/research material, and historical information.

Once promoted, production documentation must not continue describing the production path as a spike, experiment, prototype, or future seam.

## 33. Promotion gates

Promotion is blocked if any of the following is true:

```text
FAIL: Editor can modify the wrong document
FAIL: Lua can obtain arbitrary host objects
FAIL: Lua can execute arbitrary bytecode
FAIL: Lua can recover prohibited host authority
FAIL: filesystem containment can be bypassed
FAIL: resource limits are unenforced
FAIL: hostile extension can permanently poison discovery
FAIL: hostile extension can compromise another extension
FAIL: packaged runtime differs materially from validated runtime
FAIL: supported platform has a security-specific behavior divergence
FAIL: public API remains undocumented
FAIL: public API is still described as experimental
FAIL: permanent tests do not protect documented security boundaries
FAIL: known high/critical applicable vulnerability remains unresolved
```

## 34. Promotion criteria

The Engine becomes production when all mandatory gates are `PASS` and:

```text
Extension System:
PRODUCTION

Lua:
SUPPORTED RUNTIME

Editor capability:
PRODUCTION

Experimental extension surface:
NONE
```

Wasmoon, Wasm, `glue.wasm`, and Lua 5.4.5 may remain implementation details. They are not themselves the product contract.

## 35. Final product statement

> Fulvid supports local extensions, including constrained Lua plugins, whose capabilities operate through existing Fulvid owners without granting arbitrary filesystem, network, process, host, or editor authority.

Anything beyond that requires a new explicit architectural and security decision.

## 36. Final acceptance record

Recorded after first-release productization (Editor reject-stale, Extension API v1, production examples). No commit, tag, release, or branch promotion is implied by this record alone.

```text
Extension API:
v1 (manifest "api": 1)

Lua runtime:
wasmoon 1.16.0 (SUPPORTED implementation detail)

Embedded Lua:
5.4.5 (build-source provenance)

Production capabilities:
commands, ui, lua, editor, document, decorations

Editor:
PRODUCTION

  Strategy B - reject stale (documentId + alternativeVersionId +
  selection offsets). Lua receives text only.

Linux x64:
PASS (packaged Lua smoke verified; see compatibility.md)

Windows x64:
PASS (packaged Lua smoke verified via Compatibility CI)

macOS arm64:
PASS (packaged Lua smoke verified via Compatibility CI)

Packaged runtime:
PASS

Security assessment:
PASS (capability/guest/budget/isolation; ≠ OS sandbox)

CVE assessment:
PASS (prior patch-dependent Lua CVEs vs 5.4.5 build-source identity)

Permanent contract tests:
PASS (including absolute 256 KiB editor boundary and stale rejection)

Documentation:
PASS (production surface no longer labeled experimental)

Removal/replacement contract:
PASS

Final state:
READY FOR PRODUCTION
```

### First-release workflows

1. Command -> notify (`fulvid.host-notify`)
2. Template -> untitled blank note (`fulvid.blank-note`)
3. Selection transform -> sort lines (`fulvid.sort-lines`)

### Remaining honesty (not blockers)

- Capability isolation ≠ OS sandbox
- No marketplace - local filesystem packages only
- Full interactive GUI smoke of every menu path is not substituted for contract tests; packaged runtime matrix remains the cross-platform gate
