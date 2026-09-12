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
      │                    file   → readSelectedDocument + grantDocument
      │                    folder → authorizeChosenWorkspaceRoot
      ▼
ResolvedExternalOpen       a grant snapshot, an authorized root, or a refusal
      │
      ▼
applyPendingExternalOpens  file   → openOrActivate  (→ selectDocument → Focus)
                           folder → selectRecentWorkspace (→ scan → load)
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
| Folder lifecycle | `selectRecentWorkspace` → `loadWorkspace` | Same scan, same preflight (Markdown/MDX present, or a partial scan), same ceilings |

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
inherits the environment, which this layer does not read.

So `fulvid note.md` reaches the launcher and stops there. The argv adapter works
when the host runs directly, which is how it is tested.

**This is an Electrobun change, not a Fulvid one.** Fulvid must not work around
it with an environment variable, socket, named pipe, localhost listener, or
daemon. Any of those would be the second authority this layer exists to avoid.

### Deliberately not done

| Not done | Why |
| --- | --- |
| `.mdx` and `inode/directory` MIME | Advertising a handler before delivery works only opens a blank window. There is no IANA type for MDX either |
| Windows registry association | Electrobun 2.0.1 registers none, and Explorer would pass the path to the same launcher that drops it |
| macOS `fileAssociations` | macOS delivers `file:` URLs on `open-url`, not argv. That is a different adapter, and it would need a drain after startup |
| Single-instance / warm start | A second `fulvid note.md` is a second process with its own bounded queue. Handing a request across processes is a communication surface |
| Browser extension | No channel exists or is designed |

A `.desktop` entry cannot hand a path to an already running instance either;
that needs D-Bus activation or a lock Fulvid does not have.

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
