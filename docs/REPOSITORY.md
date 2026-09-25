# Repository

Where Fulvid code and tests live.

Ownership: [ARCHITECTURE.md](./ARCHITECTURE.md). Vocabulary: [CONCEPTS.md](./CONCEPTS.md). Extensions contract: [EXTENSIONS.md](./EXTENSIONS.md). Production promotion gates: [EXTENSION-PRODUCT-CONTRACT.md](./EXTENSION-PRODUCT-CONTRACT.md). Annotations: [ANNOTATIONS.md](./ANNOTATIONS.md). Graph: [GRAPH.md](./GRAPH.md).

```text
README.md
CONTRIBUTING.md
SECURITY.md
LICENSE
assets/                  Application icon
assets/screenshots/      Window captures
examples/                Demo folder for local checks and those captures
extensions/              Empty by design (extension packs live in fulvid-extensions)
src/bun/                 Desktop host and filesystem RPC
src/bun/extensions/      Extension discovery (userData/extensions); lua/ host runtime
src/bun/filesystem/      io/, rpc/, scanning/, security/
src/mainview/extensions/ Manifest contract, registry, editor capability / seam
src/mainview/pages/      Routes: editor/, search/, graph/, settings/
src/mainview/modules/    workspace/, editor/, search/, quickOpen/, graph/, document/, settings/
src/mainview/app/        Bootstrap, router, layout, folder lifecycle
src/mainview/shell/      Menus, sidebars, AppIcon.vue
src/mainview/i18n/       UI locale catalogs (en/es/de/fr/it/nl/pt); see I18N.md
src/mainview/styles/
tests/                   Mirrors src/bun, src/mainview, and scripts/
tests/extensions/        Extension contract/security tests (+ disposable fixtures/)
scripts/                 validate, doctor, icons, smoke, compatibility / lua packaged smoke
packaging/linux/         Manual Linux release and desktop/metainfo stubs
packaging/windows/       Windows packaging (Actions)
packaging/macos/         macOS packaging (Actions)
docs/                    Includes EXTENSIONS.md + EXTENSION-PRODUCT-CONTRACT.md
.github/workflows/       validate, release, compatibility-*, dependency-security
```

`pages/` are routes. `modules/` are capabilities.

| Surface | Path |
| --- | --- |
| Editor | `pages/editor/EditorPage.vue` (`/editor`) |
| Explorer | `modules/workspace/explorer/ExplorerPanel.vue` |
| Global Search | `pages/search/SearchPage.vue` (`/search`) |
| Quick Open | `modules/quickOpen/` + DialogHost (`Ctrl/Cmd+P`) |
| Graph | `pages/graph/GraphPage.vue` (`/graph`) |
| Settings | `pages/settings/SettingsPage.vue` (`/settings`) |
| Document Context | `modules/document/inspector/InspectorDrawer.vue` |
| Outline | `modules/editor/outline/OutlinePanel.vue` |
| Preview | `modules/editor/preview/PreviewPane.vue` |

Tests mirror `src/` and `scripts/`. Names are `.unit.test.ts`, `.integration.test.ts`, and `.smoke.test.ts`. Unit tests are the exception; see [CONTRIBUTING.md](../CONTRIBUTING.md#testing). Smoke is `bun run smoke`, not part of `bun run test`.

Product copy uses **Folder**. Host code may keep `workspace*` identifiers.

Distribution: [DISTRIBUTION.md](./DISTRIBUTION.md).

## Documentation map

| Need | Start here |
| --- | --- |
| Product vocabulary | [CONCEPTS.md](./CONCEPTS.md) |
| Ownership / architecture | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| Enforceable rules | [INVARIANTS.md](./INVARIANTS.md) |
| Security contract | [SECURITY-AND-RESILIENCE.md](./SECURITY-AND-RESILIENCE.md) |
| Extensions | [EXTENSIONS.md](./EXTENSIONS.md) |
| Platforms / CI smoke | [compatibility.md](./compatibility.md) |
| Packaging / Releases | [DISTRIBUTION.md](./DISTRIBUTION.md) |
| Contributor actions | [../CONTRIBUTING.md](../CONTRIBUTING.md) |
| User-facing history | [../CHANGELOG.md](../CHANGELOG.md), [releases/](./releases/) |
| Historical security evidence | [security/](./security/) (not the living control list) |
