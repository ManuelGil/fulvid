# Repository

Where Fulvid code and tests live.

Ownership: [ARCHITECTURE.md](./ARCHITECTURE.md). Vocabulary: [CONCEPTS.md](./CONCEPTS.md). Extension Engine contract: [EXTENSIONS.md](./EXTENSIONS.md). Annotations: [ANNOTATIONS.md](./ANNOTATIONS.md). Graph: [GRAPH.md](./GRAPH.md).

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
src/bun/extensions/      Extension discovery (userData/extensions); lua/ host runtime
src/bun/filesystem/      io/, rpc/, scanning/, security/
src/mainview/extensions/ Manifest contract, registry, editor capability / seam
src/mainview/pages/      Routes: editor/, search/, graph/, settings/
src/mainview/modules/    workspace/, editor/, search/, quickOpen/, graph/, document/, settings/
src/mainview/app/        Bootstrap, router, layout, folder lifecycle
src/mainview/shell/      Menus, sidebars, AppIcon.vue
src/mainview/i18n/       EN/ES catalogs; see I18N.md
src/mainview/styles/
tests/                   Mirrors src/bun, src/mainview, and scripts/
tests/extensions/        Extension Engine contract tests (+ disposable fixtures/)
scripts/                 validate, doctor, icons, smoke, compatibility / lua packaged smoke
packaging/linux/         Manual Linux release and desktop/metainfo stubs
packaging/windows/       Windows packaging (Actions)
packaging/macos/         macOS packaging (Actions)
docs/                    Includes EXTENSIONS.md (Extension Engine contract)
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
