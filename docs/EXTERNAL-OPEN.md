# External open

How something outside Fulvid asks Fulvid to open a file or a folder.

This is the internal layer, plus the Linux desktop `Exec` field that feeds it.
**Packaged OS delivery is not complete:** Electrobun 2.0.1 does not forward
launcher arguments to the Bun host, and there is no browser extension. What
exists is the contract, the single host-side handler, one argv adapter, and a
desktop entry that is ready to pass local paths once the launcher does. See
[Status](#status) for exactly what is wired today.

## What an external open request is

A statement of intent, and nothing else:

> Something outside Fulvid asked to open this resource.

It is not a grant. A request carries no token, no capability, no command, and
no trust. A path that arrives in a request is treated exactly as a path typed
into Fulvid's own Open dialog: the host decides whether it may be opened, using
the checks it already had.

```text
external source
      │
      ▼
ExternalOpenRequest        { kind, path, source }
      │
      ▼
parseExternalOpenRequest   shape only, no I/O
      │
      ▼
takePendingExternalOpens   resolves through existing host authority
      │                    file   -> readSelectedDocument + grantDocument
      │                    folder -> authorizeChosenWorkspaceRoot
      ▼
ResolvedExternalOpen       a grant snapshot, an authorized root, or a refusal
      │
      ▼
applyPendingExternalOpens  file   -> openOrActivate  (-> selectDocument -> Focus)
                           folder -> selectRecentWorkspace (-> scan -> load)
```

## The contract

`src/mainview/desktop/externalOpen.ts`. Types only, so the host can import it.

```ts
type ExternalOpenRequest = {
  kind: "file" | "folder";
  path: string; // absolute, in the host platform's own semantics
  source: ExternalOpenSource;
};
```

`kind` is two kinds rather than a flag because they end in different
lifecycles. A request whose kind disagrees with what is on disk is **refused**,
not reinterpreted: a directory sent as a file is `unsupportedDocument`, a file
sent as a folder is `notADirectory`.

`path` must be absolute. A relative path has no meaning across a process
boundary - there is no agreed working directory - and guessing one would invent
a target the sender did not name. `isAbsolute` is the host platform's own rule,
so drive letters and UNC paths remain valid on Windows. Nothing is normalized
here; the existing authorities canonicalize.

`source` is **descriptive only**: for logs, and for telling a person what
happened. The host never branches on it. If it did, the source would become a
privilege and every future adapter would become a security boundary. An
unrecognised source is recorded as `unknown` rather than refused, so a new
adapter naming itself cannot fail an otherwise valid request.

Fields outside the contract are dropped during parsing. `command`, `trusted`,
`capabilities`, `grantToken`, `rootPath` and anything else do not survive.

## Who validates, and who holds authority

| Concern | Owner | Note |
| --- | --- | --- |
| Request shape | `parseExternalOpenRequest` | `src/bun/external/externalOpen.ts`. No I/O |
| File access | `readSelectedDocument` + `grantDocument` | Unchanged. The Open dialog's own path |
| Folder access | `authorizeChosenWorkspaceRoot` | Unchanged. The Folder dialog's own path |
| Containment | `workspacePaths` | Unchanged, and applies to everything inside an opened folder |
| Document lifecycle | `openOrActivate` | Pairs Focus through `selectDocument` |
| Folder lifecycle | `selectRecentWorkspace` -> `loadWorkspace` | Same scan, same preflight (Markdown/MDX present, or a partial scan), same ceilings |

**Filesystem authority does not move.** There is no second authority, no
"external" grant kind, and no path in this layer that skips a check. A request
naming something the host would refuse from its own dialog is refused here for
the same reason and with the same error code.

What a request earns is exactly what the equivalent dialog earns:

- **A file** grants that one document. It does **not** authorize the folder
  containing it, then or on a later reopen.
- **A folder** becomes an authorized root, and everything inside it is
  contained as usual. Sibling folders gain nothing.

## Delivery

External open is a **pull**, not a push. A request can arrive before the webview
exists, so the host queues it and the renderer drains it once, at startup,
through `takePendingExternalOpens` on the RPC channel that already exists.

That is deliberate: no socket, no named pipe, no localhost listener, no daemon,
no new transport of any kind. There is no permanent attack surface here to
solve a problem that does not yet need external communication.

The queue is bounded (8) and drained once. Duplicate requests are safe without
any idempotency machinery: `openGrantedDocument` already dedupes by absolute
path, and `loadWorkspace` already discards superseded folder loads.

An external request outranks the remembered folder - someone asked for this one
now - so `bootstrapWorkspace` only restores the last folder when nothing
external opened one.

## Status

### What exists

| Piece | State |
| --- | --- |
| Contract, handler, queue, drain | Implemented and tested |
| argv adapter (`src/bun/external/startupArguments.ts`) | Implemented and tested |
| Linux desktop `Exec=… %F` | Prepared in all three variants |
| Debian wrapper `exec /opt/fulvid/bin/launcher "$@"` | Already forwards what the desktop environment expanded |

`%F` is the Freedesktop field code for one or more local paths, each its own
argument. `%f` would force one process per file; `%U` would admit `file:` URLs
this adapter does not parse. `MimeType` stays `text/markdown;text/x-markdown;`,
which `shared-mime-info` already maps to `.md` and `.markdown`.

### What blocks packaged delivery

Electrobun 2.0.1's launcher drops the arguments. Verified against
`package/src/launcher/main.zig` in v2.0.1: it collects OS arguments, consumes
them for uninstall parsing and the private `--automation` flag, then spawns the
runtime as `[runtime, Resources/main.js]` without appending the rest. The child
inherits the environment, which this layer does not read. The same spawn shape
is still present in Electrobun `v2.0.2-beta.27` (not a stable release).

So `fulvid note.md` reaches the launcher and stops there. The argv adapter works
when the host runs directly, which is how it is tested.

**This is an Electrobun launcher capability gap, not a Bun limitation.** Host Bun
and the Hutch-pinned Bun runtime both accept `process.argv` / `Bun.argv` normally
when the process is started with those arguments. Fulvid must not work around
the missing forward with an environment variable, socket, named pipe, localhost
listener, or daemon. Any of those would be the second authority this layer
exists to avoid.

#### Upstream tracking (Electrobun)

| Concern | Upstream | Role for Fulvid |
| --- | --- | --- |
| Argv forwarding (Linux/Windows launcher) | [blackboardsh/electrobun#483](https://github.com/blackboardsh/electrobun/issues/483) | **Primary** open request: packaged launcher must append remaining OS arguments when spawning the app runtime |
| Argv drop on Electrobun 2.0.1 Linux | [blackboardsh/electrobun#554](https://github.com/blackboardsh/electrobun/issues/554) | Independent Fulvid reproduction / confirmation of #483 against 2.0.1 - not a separate defect class |
| macOS Markdown / existing UTI associations | [blackboardsh/electrobun#551](https://github.com/blackboardsh/electrobun/issues/551) | Independent: `fileAssociations` must be able to claim existing types such as Markdown, not only app-specific UTIs |
| Single-instance / running-instance handoff | [blackboardsh/electrobun#465](https://github.com/blackboardsh/electrobun/issues/465) | Independent: a second launch must be able to route an open to an already running instance without a Fulvid-invented IPC surface |

### Deliberately not done

| Not done | Why |
| --- | --- |
| `.mdx` and `inode/directory` MIME | Advertising a handler before delivery works only opens a blank window. There is no IANA type for MDX either |
| Windows registry association | Electrobun 2.0.1 registers none usefully for Markdown, and Explorer would pass the path to the same launcher that drops argv (#483 / #554) |
| macOS `fileAssociations` for Markdown | Blocked on #551 (existing UTI) plus a post-startup `open-url` adapter; argv is the wrong channel on macOS |
| Single-instance / warm start | Blocked on #465. A second `fulvid note.md` is a second process with its own bounded queue. Cross-process handoff is a communication surface Fulvid will not invent |
| Browser extension | No channel exists or is designed |

A `.desktop` entry cannot hand a path to an already running instance either;
that needs D-Bus activation or a lock Fulvid does not have.

## Upstream Watch

Packaged Native OS Integration (Open with / associations / warm start) stays
**deferred** until a **stable** Electrobun release closes the gaps above. Do not
treat `2.0.2-beta.*` as delivery. Reopen Fulvid work only when:

1. **Argv forwarding** - A stable Electrobun release documents and ships launcher
   forwarding of remaining OS arguments to the Bun (or Cottontail) host on Linux
   and Windows (#483 closed or equivalent in release notes). Re-verify with a
   packaged Fulvid build; Fulvid already has the argv adapter and Linux `%F`
   desktop wiring.
2. **File associations** - Stable Electrobun can register for existing types
   such as Markdown on macOS (#551) and can register Windows/Linux associations
   that actually reach the host once argv forwarding exists. Only then expand
   MIME / registry / `fileAssociations` beyond the prepared Linux Markdown MIME.
3. **Running-instance handoff** - Stable Electrobun provides an official
   single-instance or open-url-to-running-instance contract (#465) that Fulvid
   can drain through the existing external-open queue without sockets, pipes,
   daemons, or a second authority.

Until then: keep the external-open funnel as the sole authority; keep desktop
`Exec=… %F` ready; do not advertise handlers Fulvid cannot receive.

## Adding an adapter later

An adapter converts a channel's representation into an `ExternalOpenRequest` and
hands it to `enqueueExternalOpenRequest`. That is all it does.

`startupArguments.ts` is the worked example: about thirty lines, and none of them
is a security decision. It resolves argv against the process directory - a
convention of that channel - classifies each path with a `stat`, and stops.

**Security must never live in an adapter.** If a future adapter needs to decide
what may be opened, the design is wrong: that decision belongs in the handler,
where it is written once and tested once.

## Tests

- `tests/bun/external/externalOpen.unit.test.ts` - contract shape, refusals
  (including relative paths), field stripping, source coercion, queue bounds.
- `tests/bun/external/externalOpen.integration.test.ts` - resolution through the
  real authorities: grant scope, kind/disk disagreement, symlinked folders,
  refusal reporting, replay, concurrent drain, and the argv adapter.
- `tests/packaging/linuxDesktop.unit.test.ts` - canonical and variant desktop
  files share MIME, use an unquoted `%F`, and the Debian wrapper still forwards
  `"$@"`.
