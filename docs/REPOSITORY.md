# Repository

Where Fulvid code and tests live.

Ownership: [ARCHITECTURE.md](./ARCHITECTURE.md). Vocabulary: [CONCEPTS.md](./CONCEPTS.md). Annotations: [ANNOTATIONS.md](./ANNOTATIONS.md). Graph: [GRAPH.md](./GRAPH.md).

```text
README.md
CONTRIBUTING.md
SECURITY.md
LICENSE
assets/                  Application icon
assets/screenshots/      Window captures
examples/                Demo folder for local checks and those captures
extensions/              Extension-boundary fixtures (copy into userData/extensions to load)
src/bun/                 Desktop host and filesystem RPC
src/bun/extensions/      Declarative extension discovery (userData/extensions)
src/bun/filesystem/      io/, rpc/, scanning/, security/
src/mainview/pages/      Routes: editor/, search/, graph/, settings/
src/mainview/modules/    workspace/, editor/, search/, quickOpen/, graph/, document/, settings/
src/mainview/extensions/ Manifest contract + registry / host action dispatch
src/mainview/app/        Bootstrap, router, layout, folder lifecycle
src/mainview/shell/      Menus, sidebars, AppIcon.vue / appIcons.ts
src/mainview/i18n/       EN/ES catalogs; see I18N.md
src/mainview/styles/
tests/                   Mirrors src/bun, src/mainview, scripts/, and extensions/
scripts/                 validate, doctor, icons, smoke, compatibility smoke
packaging/linux/         Manual Linux release and desktop/metainfo stubs
packaging/windows/       Windows packaging (Actions)
packaging/macos/         macOS packaging (Actions)
docs/
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

Tests mirror `src/`, `scripts/`, and `extensions/`. Names are `.unit.test.ts`, `.integration.test.ts`, and `.smoke.test.ts`. Unit tests are the exception; see [CONTRIBUTING.md](../CONTRIBUTING.md#testing). Smoke is `bun run smoke`, not part of `bun run test`. Security and architecture frontiers are protected by those existing layers (filesystem, External Open, Focus/selection, Graph projection, Preview inertness, Writing Focus ⊥ Full Screen, extension fixtures) — not by a separate `tests/security-harness/` tree.

Product copy uses **Folder**. Host code may keep `workspace*` identifiers.

Distribution: [DISTRIBUTION.md](./DISTRIBUTION.md).
