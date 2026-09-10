/**
 * The one host-side handler for external open requests.
 *
 * Every future integration — a Windows shell verb, a Linux desktop entry, a
 * browser extension, a file manager — converts whatever it receives into an
 * `ExternalOpenRequest` and hands it here. None of them implements security.
 * This module is where a request is validated, and the existing host
 * authorities are where it is resolved:
 *
 *   file   -> readSelectedDocument + grantDocument   (as the Open dialog does)
 *   folder -> authorizeChosenWorkspaceRoot           (as the Folder dialog does)
 *
 * There is no second filesystem authority here, and no "external" grant kind.
 * A request that names a path Fulvid would refuse from its own dialog is
 * refused here too, for the same reason and with the same error code.
 *
 * Validation is cheap and does no I/O: a queued request touches the filesystem
 * only when the renderer drains it, so a launch is not slowed by resolving
 * paths nobody has asked for yet, and a file that disappears between launch and
 * drain is reported rather than assumed.
 */
import { isAbsolute } from "node:path";

import {
  isExternalOpenSource,
  MAX_EXTERNAL_OPEN_PATH_LENGTH,
  MAX_PENDING_EXTERNAL_OPENS,
  type ExternalOpenRequest,
  type ExternalOpenSource,
  type ResolvedExternalOpen,
} from "../../mainview/desktop/externalOpen";
import { parseFilesystemErrorCode } from "../../mainview/modules/workspace/filesystem/workspaceErrors";
import { readSelectedDocument } from "../filesystem/io/documentIo";
import {
  authorizeChosenWorkspaceRoot,
  grantDocument,
} from "../filesystem/security/workspaceAuthority";
import { hasControlCharacters } from "../filesystem/security/workspacePaths";
import { RpcInputError } from "../filesystem/rpc/rpcInput";

const pending: ExternalOpenRequest[] = [];

/**
 * Turn an untrusted value into a request, or refuse it.
 *
 * Shape only — whether the path may be opened is the resolver's decision, made
 * by the same authorities the dialogs use. Refusals are the boundary's own
 * codes so the renderer can say them in the reader's language.
 */
export function parseExternalOpenRequest(value: unknown): ExternalOpenRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RpcInputError("invalidRequest");
  }
  const candidate = value as Record<string, unknown>;

  const kind = candidate.kind;
  if (kind !== "file" && kind !== "folder") {
    throw new RpcInputError("invalidRequest");
  }

  const path = candidate.path;
  if (typeof path !== "string" || path.length === 0) {
    throw new RpcInputError("invalidTarget");
  }
  if (path.length > MAX_EXTERNAL_OPEN_PATH_LENGTH) {
    throw new RpcInputError("invalidTarget");
  }
  if (path.includes("\0") || hasControlCharacters(path)) {
    throw new RpcInputError("invalidTarget");
  }
  // A relative path has no meaning across a process boundary: there is no
  // agreed working directory to resolve it against, and guessing one would
  // invent a target the sender did not name. `isAbsolute` is the host
  // platform's own rule, so drive letters and UNC paths stay valid on Windows.
  if (!isAbsolute(path)) {
    throw new RpcInputError("invalidTarget");
  }

  // An unrecognised source is recorded as unknown rather than refused: the
  // source never decides anything, so a new adapter naming itself must not be
  // able to fail a request that is otherwise fine.
  const source: ExternalOpenSource = isExternalOpenSource(candidate.source)
    ? candidate.source
    : "unknown";

  return { kind, path, source };
}

/**
 * Accept a request for later delivery.
 *
 * Returns whether it was queued. Over the bound, the request is dropped: a
 * queue that grows without limit is a resource an adapter should not be able
 * to consume.
 */
export function enqueueExternalOpenRequest(value: unknown): boolean {
  const request = parseExternalOpenRequest(value);
  if (pending.length >= MAX_PENDING_EXTERNAL_OPENS) {
    return false;
  }
  pending.push(request);
  return true;
}

async function resolveExternalOpenRequest(
  request: ExternalOpenRequest,
): Promise<ResolvedExternalOpen> {
  try {
    if (request.kind === "folder") {
      // The same call the Folder dialog makes: canonical root, must be a
      // directory, approval recorded host-side.
      const rootPath = await authorizeChosenWorkspaceRoot(request.path);
      return { kind: "folder", source: request.source, rootPath };
    }
    // The same call the Open dialog makes: supported extension, size cap, and
    // a grant for exactly this one path — not for the folder holding it.
    const snapshot = await readSelectedDocument(request.path);
    return {
      kind: "file",
      source: request.source,
      snapshot: { ...snapshot, grantToken: grantDocument(snapshot.absolutePath) },
    };
  } catch (error) {
    // A refusal is an outcome, not a crash: the rest of the queue still runs,
    // and the person is told which request could not be opened.
    const reason = parseFilesystemErrorCode(error);
    if (!reason) {
      console.error("Fulvid external open failed:", error);
    }
    return { kind: "rejected", source: request.source, reason: reason ?? "operationFailed" };
  }
}

/**
 * Hand every waiting request to the renderer, resolved.
 *
 * Draining clears the queue, so a request is delivered once. Requests resolve
 * in order and independently; one refusal does not discard the others.
 */
export async function takePendingExternalOpens(): Promise<ResolvedExternalOpen[]> {
  const requests = pending.splice(0, pending.length);
  const resolved: ResolvedExternalOpen[] = [];
  for (const request of requests) {
    resolved.push(await resolveExternalOpenRequest(request));
  }
  return resolved;
}

/** Test seam: forget anything queued but never delivered. */
export function resetPendingExternalOpens(): void {
  pending.length = 0;
}
