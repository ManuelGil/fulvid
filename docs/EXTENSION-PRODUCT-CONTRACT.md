# Extension product contract (record)

Fulvid Extensions (API v1) is a production host capability. Lua is the runtime inside that capability, not a second product.

Day-to-day contracts:

- Host / security / budgets: [EXTENSIONS.md](./EXTENSIONS.md)
- Author API and lifecycle: [EXTENSION-AUTHOR-CONTRACT.md](./EXTENSION-AUTHOR-CONTRACT.md)
- Ownership: [ARCHITECTURE.md](./ARCHITECTURE.md)

## What shipped

- Local packs under `userData/extensions/<id>/` (folder copy or Settings install)
- Capabilities: `lua`, `commands`, `ui`, `editor`, `document`, `decorations`, `templates`
- Source-only Lua in Wasm; no filesystem, network, process, or raw Monaco
- Fail-closed discovery; one pack failure does not take down Fulvid
- Product packs live in sibling `fulvid-extensions/extensions/` (`imgildev.*`)
- Reference packs for contract proof live under `fulvid-extensions/tests/extensions/` (`acme.*`)

## Absent by design

No marketplace, plugin OS, generic event bus, raw CSS/DOM, status-bar framework, or package manager.
