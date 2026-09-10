# External open

How something outside Fulvid asks Fulvid to open a file or a folder.

This is the internal layer only. **No operating-system integration and no
browser extension is implemented.** What exists is the contract, the single
host-side handler that resolves it, and one worked adapter. See
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
boundary — there is no agreed working directory — and guessing one would invent
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

An external request outranks the remembered folder — someone asked for this one
now — so `bootstrapWorkspace` only restores the last folder when nothing
external opened one.

## Status

### Supported today

| Channel | Status |
| --- | --- |
| Launch arguments (`src/bun/external/startupArguments.ts`) | Adapter implemented and tested |

With one caveat, verified rather than assumed: **the Electrobun launcher does
not forward its arguments to the Bun host.** Running
`/opt/fulvid/bin/launcher /path/to/note.md` spawns the host with only the script
path on its command line, and nothing arrives by environment either. So the argv
adapter works when the host runs directly, and is the seam a file association
will use — but a packaged `Fulvid` invoked with a path opens nothing today.
Making that work is a launcher change, not a change to this layer.

### Prepared, not implemented

None of the following exists. They are listed because the contract was shaped so
each becomes a thin adapter, not because any of them is wired.

| Channel | What it would need |
| --- | --- |
| Windows shell verb / file association | Launcher argv forwarding, then a registry entry |
| Linux desktop entry (`%f` / `%U`) | Launcher argv forwarding, then `MimeType` handling |
| macOS `Open With` / `application:openFiles:` | An Electrobun open-files event, then an adapter |
| File managers, shell integrations | Nothing beyond the above |
| Browser extension | A channel, which does not exist and is not designed |
| Requests to an **already running** Fulvid | Single-instance handoff, which does not exist |

That last row is the real gap. Today a request is only queued before the window
opens. Delivering one to a running instance needs a single-instance mechanism,
which is out of scope here precisely because it is the part that would add a
communication surface.

## Adding an adapter later

An adapter converts a channel's representation into an `ExternalOpenRequest` and
hands it to `enqueueExternalOpenRequest`. That is all it does.

`startupArguments.ts` is the worked example: about thirty lines, and none of them
is a security decision. It resolves argv against the process directory — a
convention of that channel — classifies each path with a `stat`, and stops.

**Security must never live in an adapter.** If a future adapter needs to decide
what may be opened, the design is wrong: that decision belongs in the handler,
where it is written once and tested once.

## Tests

- `tests/bun/external/externalOpen.unit.test.ts` — contract shape, refusals
  (including relative paths), field stripping, source coercion, queue bounds.
- `tests/bun/external/externalOpen.integration.test.ts` — resolution through the
  real authorities: grant scope, kind/disk disagreement, symlinked folders,
  refusal reporting, replay, concurrent drain, and the argv adapter.
