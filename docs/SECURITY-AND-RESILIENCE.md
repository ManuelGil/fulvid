# Security and resilience

What Fulvid is designed to keep true, which boundaries are reviewed, how those properties are checked, and which risks remain.

This is not a claim that Fulvid is secure. It is a contract: properties the product is expected to preserve, the surfaces that must be re-examined when they change, and the evidence from reviews so far. Product rules live in [INVARIANTS.md](./INVARIANTS.md). Ownership lives in [ARCHITECTURE.md](./ARCHITECTURE.md). How to report a vulnerability: [SECURITY.md](../SECURITY.md).

## Purpose

Fulvid is a local editor for ordinary Markdown and MDX files. People open their own folders. The host process can read and write those files. The document on screen is untrusted data.

This document exists so that later versions, later operating systems, and later reviews still know:

- which properties must remain true
- which surfaces to re-test
- which limits are intentional
- which risks are known and unfinished
- what evidence already exists

A review dated in this repository is evidence. It is not the contract.

## Product security model

The file on disk is the source of truth. The editor shows and saves that text. Fulvid does not run MDX, does not compile document HTML, and does not keep a second copy of the note inside the app. Vocabulary: [CONCEPTS.md](./CONCEPTS.md).

The **host** (the Bun process under `src/bun`) is the authority for the filesystem. The **renderer** (the window under `src/mainview`) is untrusted. It may ask for a document inside a folder the person opened, or for a grant this host issued. It may never name an arbitrary path. Every filesystem request is checked again on the host, even if the UI already checked it.

A **folder** is optional. Opening one uses a native dialog. Approvals persist on the host. The renderer's recent-folder list is a convenience; a path this host never approved is refused.

**Preview** and **Export HTML** share one inert renderer. Embedded HTML is escaped. Images are placeholders (no network). Document links can only open a document already in the open folder. External links are `https:` and `mailto:` only.

**Grants** cover standalone Open and Save As: a token maps to one absolute path, after a native dialog. The grant table is bounded.

Packaging and GitHub Releases: [DISTRIBUTION.md](./DISTRIBUTION.md). Tested OS images: [compatibility.md](./compatibility.md).

## Security properties

These are expected to remain true. They are restated here for review, not copied as a second architecture. The enforceable rules are in [INVARIANTS.md](./INVARIANTS.md).

### Folder containment

A document operation must not reach a path outside an approved folder root. Lexical checks are not enough: the host also resolves the real path so a symlink cannot walk out of the folder.

### Host authority

Filesystem RPC parameters are validated on the host for type, shape, and size. Renderer checks are never the last word.

### Inert documents

MDX is source. Preview and Export must not execute document-provided code, JSX, or HTML. A broken link does not create a file.

### No silent data loss

A save that did not reach disk must not clear dirty. Creating a document is an exclusive create. An external change to a file that is also being saved is a conflict, not a silent overwrite.

### Bounded derived work

Folder scans, Preview, Export, Search, and Graph are derived from files and open buffers. That work is bounded. A partial scan or a degraded Preview is reported, not silent.

### Graph is a projection

Graph shows resolved links around Focus. It is not a store and not a second copy of the documents. [GRAPH.md](./GRAPH.md).

### Error containment

Host failures cross the RPC as error codes. Host paths, errno values, and stacks must not reach the UI.

### Persisted state is not authority

Corrupt settings, layout, or recent-folder lists must not grant filesystem access. Fulvid still starts.

## Boundaries under continuous review

These surfaces need another look whenever they change. This is not a checklist of every file.

- Folder roots, grants, and path containment, including symlinks
- Filesystem RPC and the host–renderer bridge
- Preview, Export HTML, and the Markdown/MDX parser
- Document open, save, create, rename, delete, and external file changes
- Folder scan, Search, and Graph projection
- Resource ceilings (scan, Preview, analysis, grants)
- Content Security Policy on the packaged page
- Packaging, install layout, and shipped artifacts
- Dependency and workflow supply chain

Windows junction and reparse-point containment, and macOS equivalent attacks, are review items. They are not covered by the Linux adversarial review recorded below.

## Resource and availability limits

Intentional ceilings in the implementation. A ceiling is a bound, not a proof that work is cheap.

| Limit | Kind | Role |
| --- | --- | --- |
| Preview and Export stop at 200,000 characters | Intentional | Caps source fed to the renderer |
| Preview and Export stop at 2,000 inline-markup markers | Intentional | Caps density; `marked`'s inline lexer is quadratic upstream |
| Folder scan stops at 5,000 documents and depth 24 | Intentional | Caps Explorer, Search, Graph, and Context input |
| Per-file scan analysis reads at most 2 MiB | Intentional | One huge file degrades to a partial analysis |
| Open/save document size at most 32 MiB | Intentional | RPC and I/O bound |
| At most 512 standalone grants | Intentional | Bounds the grant table |
| Global Search: 25 matches per document, 500 collected | Intentional | Caps retrieval, not a time budget |

Unreadable or vanished entries during a scan are skipped and counted. That is a robustness behavior, not a resource ceiling.

**Residual cost under the ceilings:** documents just under the density limit can still take about a second to Preview. A single 200,000-character line with no markup can take longer, still inside the character cap. Both are bounded. Both remain if `marked` stays quadratic.

**Upstream:** `marked` is a known quadratic dependency. The density ceiling bounds the consequence. It does not remove the cause. Revisit the ceiling on any `marked` upgrade.

## Validation

Automated coverage that is actually in the repository:

- **Unit tests** — Preview inertness and density timing; link resolution scale and semantics; RPC parameter shape and size; `selectDocument` ↔ Focus pairing; Writing Focus ⊥ native Full Screen; extension fixture contracts
- **Integration tests** — folder containment (lexical and canonical, including symlinks); grants; External Open resolve path; scan skip of unreadable or vanished entries; scan ceilings; document I/O and exclusive create; RPC error containment
- **Smoke** — real editing loop; optional packaged launch (`bun run smoke:compatibility`)
- **Compatibility CI** — package and launch on the images in [compatibility.md](./compatibility.md). That is runtime compatibility, not a filesystem red team
- **Contributor gate** — `bun run validate` (format, translations, lint, types, tests, web build, doctor)
- **Dependency health** — frozen lockfile and advisory audit (`bun run deps:check`)

These layers are the Security Harness v0 surface: they protect stable trust and ownership frontiers in place. There is no separate `tests/security-harness/` tree and no second security owner in production code.

Adversarial harnesses used in the 2026-09-09 review are **not** in the repository. They were sandbox scripts. What landed is the regression tests each finding earned. Treat that review as a completed campaign, not as a repeating CI job.

Artifact inspection (package modes, no maintainer scripts, pinned Actions SHAs) is a packaging and workflow review, not a unit test.

## Known risks and boundaries

Living risks. Fixed defects from past reviews belong in [evidence history](#evidence-and-audit-history), not here.

**A compromised renderer can call every RPC handler.** Electrobun's preload exposes the bridge to page scripts. That is the framework's design. Authority therefore lives in the host: validation, native-dialog folder approval, and canonical containment. The renderer's reach is whatever the handlers allow, not whatever the bridge can invoke.

**Content Security Policy is partial.** `object-src`, `frame-src`, `base-uri`, and `form-action` are `'none'`. `script-src`, `style-src`, `img-src`, and `worker-src` are unset because Vite HMR injects inline scripts, Monaco injects styles, and whether `'self'` matches the `views://` scheme on each system webview has not been verified in a packaged run. Document inertness is kept by escaping, not by those omitted directives. Comment in `src/mainview/index.html`.

**Check-then-write is not atomic** between the modification-time check and the rename in save. Closing that window needs kernel operations Bun does not expose. The window is narrow; exclusive create already covers concurrent create.

**`marked` remains quadratic** in inline markup. See [Resource and availability limits](#resource-and-availability-limits).

**Linux adversarial filesystem coverage does not stand in for Windows or macOS.** Compatibility CI packages and launches those platforms. It did not replay the containment attack suite against junctions or reparse points.

**Packaging must declare modes.** Staging directories from `mktemp` are private by default. The Linux `.deb` sets the staging root to `755` so the archive does not inherit the builder's umask. Other packaging paths should keep doing the same rather than inheriting environment modes.

## Review triggers

Re-read this document and re-run the relevant tests (and, when the change is large, a new adversarial pass) when any of the following happens:

- Filesystem containment, grants, or the RPC/native bridge changes
- Markdown/MDX parsing, Preview, Export, or the CSP changes
- Scan, Search, Graph, or save/write semantics change
- Resource ceilings change, or `marked` / Monaco / Vite / Electrobun / Bun is upgraded
- A new OS or architecture is claimed as supported
- Packaging, install layout, or the public distribution channel changes
- A relevant upstream vulnerability appears, or Fulvid starts processing a new kind of input

## Evidence and audit history

Standing properties above. Details of a completed review: [security/2026-09-09-red-team.md](./security/2026-09-09-red-team.md).

### 2026-09-09 — Linux x64 adversarial review (Fulvid 0.1.0)

Attacks were executed, not only read from source. **No trust-boundary vulnerability was found.** Five defects (two robustness, two performance, one packaging) were found, fixed, and covered by regression tests in the same cycle.

**Covered**

- Preview and Export: 168 payload classes on both surfaces (336 outputs). No execution finding. MDX escaped and inert; images placeholders; dangerous URL schemes reduced to `#`.
- Filesystem: 68 attacks. No containment escape. Traversal, symlink escape, TOCTOU swap-to-symlink, grant forgery, and several data-loss races all held.
- RPC: 4290 validator calls and 264 I/O calls. Hostile values and prototype-pollution shapes did not leak host errors through the boundary.
- Search and Graph cost on the inputs tried was linear after the link-index fix. Symlink cycles in the walk terminate.
- Linux artifacts: no source maps or secret-shaped files in the shipped JS/HTML; Actions pinned to commit SHAs; `.deb` has no maintainer scripts.

**Found and fixed** (not current product bugs)

| ID | Kind | What happened | Mitigation still in force |
| --- | --- | --- | --- |
| F-01 | Performance | Dense inline Markdown froze Preview/Export for about a minute (`marked` quadratic) | Density ceiling; degrade to escaped source |
| F-02 | Robustness | One unreadable subdirectory aborted the whole folder scan | Skip and count; tell the person |
| F-03 | Robustness | A file listed then deleted mid-scan aborted the folder open | Same skip path on the analysis pass |
| F-04 | Performance | Link resolution was quadratic in folder size | Lookup tables per scan, invalidated on rescan |
| F-05 | Packaging | Linux `.deb` recorded the staging directory as mode `0700` | `chmod 755` on the staging root |

**Not covered in that review**

- Windows junctions and reparse points
- macOS filesystem attacks
- Repeating the attack harnesses in CI (they were not committed)

**Regressions in tree**

```bash
bun test .unit.test.ts          # Preview density (F-01), link resolution scale (F-04)
bun test .integration.test.ts   # scan skip (F-02, F-03), containment, grants, RPC errors
```

Linux `.deb` root mode: inspect `./` after `bash packaging/linux/deb.sh`.
