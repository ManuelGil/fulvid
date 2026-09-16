# Extension authoring DX audit

Audit of whether a third party can build Fulvid extensions from the public contract alone (API v1).  
**No API inflation** — confidence that the existing small API is usable.

Evidence directory: `/tmp/fulvid-extension-author-dx/`

Fresh pack: [`acme.heading-nav`](../../fulvid-extensions/tests/extensions/acme.heading-nav/) (Markdown heading navigator — not TODO / MDX / ADR / line-length). Lives under `tests/extensions/` (reference), not the production catalog.

---

## A. Author experience verdict

**Yes.** A developer can go idea → manifest → Lua → documented API → folder install → discover → debug → update → remove without modifying Fulvid for ordinary editor ideas (navigate, analyze, decorate, transform selection, seed untitled docs).

Fulvid remains a small secure host; the contract stays narrow.

## B. Fresh-author journey (friction)

Built `acme.heading-nav` using only `EXTENSION-AUTHOR-CONTRACT.md` + `acme.line-length` as layout example.

| # | Friction | Severity | Resolution |
| --- | --- | --- | --- |
| 1 | Manifest errors were terse (`invalid publisher`) without expected shape | Medium | Improved validator reasons (field + expected) |
| 2 | Unclear that `actions[].id` must match `commands.register` | Medium | Documented + load already fails with `action "…" is not registered` |
| 3 | Missing capability looks like Lua nil (`attempt to index … 'document'`) | Low | Documented as intentional; do not invent softer stubs |
| 4 | Install path: copy vs Settings Install / Reload inventory | Low | Documented in author contract |
| 5 | Editing: only `replaceSelection` — authors may expect range edit | Info | Documented honestly; deferred as API candidate |
| 6 | `activation: "startup"` appears in schema but unimplemented | Low | Already warned; left reserved |
| 7 | Version must be `x.y.z` not `1.0` | Low | Error now states semver expectation |

No reverse-engineering of host internals was required to ship heading-nav.

## C. Public API audit (summary)

| API | Purpose | Cap | Limits / failure |
| --- | --- | --- | --- |
| `commands.register` | Register menu/inventory commands | lua+commands | load only; id pattern; ≤16 |
| `clock.isoDate` | UTC calendar day | lua | string only |
| `ui.notify` | Toast | ui | ≤500 chars; silent under doc activation |
| `editor.getSelection` | Read selection | editor | bounded |
| `editor.replaceSelection` | Write selection / insert | editor | stale stamps fail |
| `document.getText` | Read buffer | document | ≤512 KiB |
| `document.getCursor` | Cursor | document | 1-based |
| `document.reveal` | Navigate | document | active doc stamp |
| `document.createUntitled` | New buffer | document | after return |
| `decorations.set/clear` | Visual marks | decorations | ≤500; style XOR appearance |
| `template.render` | `{{name}}` escape | templates | strings only |

Full detail: [EXTENSION-AUTHOR-CONTRACT.md](./EXTENSION-AUTHOR-CONTRACT.md).

## D. Manifest audit

Required: `publisher`, `name`, `displayName`, `description`, `version`, `api`, `capabilities` (+ `entry` with lua).  
Optional: `id`, activation fields, package metadata.  
Invalid manifests → **blocked** with actionable reason.  
Lua/placement errors → **failed**.

## E. Documentation gaps (concrete)

Addressed in this pass:

- Install / reload / remove workflow
- Actions must match registered commands
- Nil globals when capability missing
- Editing boundary honesty
- Failure message examples
- Second minimal example (`heading-nav`)
- Manifest error expected shapes

## F. API changes

**None** for heading-nav. Existing `getText` + `getCursor` + `reveal` + `notify` + Navigate menus suffice.

Manifest **reason strings only** improved (DX, not new surface).

## G. Rejected API candidates

| Candidate | Class |
| --- | --- |
| `editor.replaceRange` / full `setText` | useful but deferrable |
| Status bar / panels / widgets | architecturally dangerous |
| Generic event bus | rejected |
| Filesystem / network / raw Monaco / CSS / DOM | architecturally dangerous |
| Package manager / ZIP marketplace | rejected |
| Soft stubs for missing capabilities | convenience only — keep nil fail-closed |

## H. Reference extension

`acme.line-length` remains the document-activation + decoration litmus.  
`acme.heading-nav` is the command-only navigation example. Both live under `fulvid-extensions/tests/extensions/` (reference/contract). Small, copyable, independent. No scaffolding framework.

## I. Security UX

Restrictions are understandable when documented as absences (table in author contract). Consent for failed packs stays explicit; menus do not bypass block/fail. Capability isolation ≠ OS sandbox (still stated in EXTENSIONS.md).

## J. GUI evidence

Evidence: `/tmp/fulvid-extension-author-dx/`

| Check | Result |
| --- | --- |
| Real `Fulvid-dev` binary built and launched | Yes (`ebuild.out`, `app-stdout.log`) |
| Folder-copy → discover → `acme.heading-nav` loaded | Yes (`SUMMARY.json`) |
| Navigate command ids present | Yes (`headingNext` / `headingPrevious`) |
| `headingNext` reveal behavior | Yes (line 5) |
| Folder remove → pack gone; Fulvid relaunches | Yes |
| Settings inventory OCR | Not captured — Linux HTML-menu xdotool clicks flaky this session; same contract verified via discovery on live `userData` |

Honest note: do not treat Settings OCR as proven here. The binary + folder-copy + load + invoke + remove path is.

## Independence thought experiment

| Question | Answer |
| --- | --- |
| Copy pack into another Fulvid without Fulvid source? | **Yes** |
| Change semantics/style/commands without modifying Fulvid? | **Yes**, within declared capabilities |

## Success criterion

Demonstrably met: public contract + folder copy + small API is enough; Fulvid did not grow into a plugin SDK.
