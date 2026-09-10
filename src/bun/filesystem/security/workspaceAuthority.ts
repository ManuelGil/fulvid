/**
 * Who may touch what, on the privileged side of the RPC boundary.
 *
 * The renderer never names a filesystem target directly. It names a folder it
 * believes is open and a path inside it, or a grant token this host issued.
 * This module decides whether that claim holds:
 *
 *   - a folder root is authorized only after a native dialog approved it;
 *   - a desktop action reaches only an approved root, something inside a root
 *     authorized this session, or a document this host granted;
 *   - a grant token maps to one absolute path and nothing else.
 *
 * It deliberately does not import the Electrobun runtime, so the rules can be
 * exercised as themselves rather than through a mock of the host.
 */
import { stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";

import { approveWorkspaceRoot, isApprovedWorkspaceRoot } from "../../workspaceGrants";
import { canonicalRoot, WorkspaceBoundaryError } from "./workspacePaths";
import { RpcInputError } from "../rpc/rpcInput";
import {
  filesystemErrorMessage,
  parseFilesystemErrorCode,
} from "../../../mainview/modules/workspace/filesystem/workspaceErrors";

/** Document grants live for the session and are bounded so they cannot grow. */
const MAX_GRANTED_DOCUMENTS = 512;

const grantedDocuments = new Map<string, string>();
/** Canonical roots authorized in this session. */
const authorizedWorkspaceRoots = new Set<string>();

async function assertDirectory(rootPath: string): Promise<void> {
  const information = await stat(rootPath);
  if (!information.isDirectory()) {
    throw new WorkspaceBoundaryError("notADirectory");
  }
}

/**
 * Authorize a folder the person chose in a native dialog.
 *
 * This is the only way a path becomes a folder root. The approval is recorded
 * on the privileged side so a later reopen never has to trust the renderer.
 */
export async function authorizeChosenWorkspaceRoot(path: string): Promise<string> {
  const rootPath = await canonicalRoot(path);
  await assertDirectory(rootPath);
  authorizedWorkspaceRoots.add(rootPath);
  approveWorkspaceRoot(rootPath);
  return rootPath;
}

/**
 * Re-authorize a folder the renderer asks to reopen.
 *
 * The renderer's recent-folder list is a convenience, not an authority: only a
 * path this host approved through a dialog before can come back. A tampered or
 * corrupt recent list therefore cannot widen what Fulvid may read or write.
 */
export async function reauthorizeWorkspaceRoot(path: string): Promise<string> {
  const rootPath = await canonicalRoot(path);
  if (!authorizedWorkspaceRoots.has(rootPath) && !isApprovedWorkspaceRoot(rootPath)) {
    throw new WorkspaceBoundaryError("folderNotOpen");
  }
  await assertDirectory(rootPath);
  authorizedWorkspaceRoots.add(rootPath);
  return rootPath;
}

/** Canonical root for an in-session folder operation. Persistent approvals alone are not enough; use `reauthorizeWorkspaceRoot` to reopen. */
export async function authorizedWorkspaceRoot(path: string): Promise<string> {
  const rootPath = await canonicalRoot(path);
  if (!authorizedWorkspaceRoots.has(rootPath)) {
    throw new WorkspaceBoundaryError("folderNotOpen");
  }
  return rootPath;
}

/** True when `candidate` is strictly inside `root` (the root itself is not inside). */
function isInside(root: string, candidate: string): boolean {
  const within = relative(root, candidate);
  return Boolean(
    within && within !== ".." && !within.startsWith(`..${sep}`) && !isAbsolute(within),
  );
}

/**
 * A path the renderer may name in a desktop action.
 *
 * Reveal and copy are the handlers that take an absolute path.
 * Canonicalizing first means a path that only looks contained - through a
 * symlink or a `..` segment - is measured by where it actually lands.
 */
export async function authorizedDesktopPath(path: string): Promise<string> {
  const canonical = await canonicalRoot(path);
  if (authorizedWorkspaceRoots.has(canonical) || isApprovedWorkspaceRoot(canonical)) {
    return canonical;
  }
  for (const root of authorizedWorkspaceRoots) {
    if (isInside(root, canonical)) {
      return canonical;
    }
  }
  for (const granted of grantedDocuments.values()) {
    if ((await canonicalRoot(granted)) === canonical) {
      return canonical;
    }
  }
  throw new WorkspaceBoundaryError("outsideOpenedFolders");
}

/**
 * Session-only capability: UUID token → one absolute path.
 *
 * Bounded at 512 entries (oldest evicted). The stored path is the sole write
 * target for standalone saves; the renderer cannot substitute another path.
 * Tokens are not persisted across process restarts.
 */
export function grantDocument(absolutePath: string): string {
  if (grantedDocuments.size >= MAX_GRANTED_DOCUMENTS) {
    // Insertion order: retire the oldest grant so a long session cannot grow
    // this map without bound.
    const oldest = grantedDocuments.keys().next();
    if (!oldest.done) {
      grantedDocuments.delete(oldest.value);
    }
  }
  const grantToken = randomUUID();
  grantedDocuments.set(grantToken, absolutePath);
  return grantToken;
}

/** Resolve a grant issued this session. Does not accept a path from the renderer. */
export function grantedPath(grantToken: string): string {
  const absolutePath = grantedDocuments.get(grantToken);
  if (!absolutePath) {
    throw new WorkspaceBoundaryError("grantInvalid");
  }
  return absolutePath;
}

/**
 * Keep host-level failures inside the host.
 *
 * Boundary refusals, input refusals and document conflicts are written for
 * people and travel as they are. Anything else - a raw `ENOENT` carrying an
 * absolute path, a stack from a dependency - becomes a stable message, so the
 * UI never renders host internals. The original stays in the host log.
 */
export function contained<Params, Result>(
  operation: string,
  handler: (params: Params) => Promise<Result>,
): (params: Params) => Promise<Result> {
  return async (params: Params) => {
    try {
      return await handler(params);
    } catch (error) {
      if (
        error instanceof WorkspaceBoundaryError ||
        error instanceof RpcInputError ||
        parseFilesystemErrorCode(error) !== null ||
        (error instanceof Error && (error as { code?: unknown }).code === "DOCUMENT_CONFLICT")
      ) {
        throw error;
      }
      // The host keeps the detail; the renderer gets a code it can localize.
      console.error(`Fulvid RPC "${operation}" failed:`, error);
      throw new Error(filesystemErrorMessage("operationFailed"), { cause: error });
    }
  };
}

/** Test seam: forget every session authorization and grant. */
export function resetWorkspaceAuthority(): void {
  authorizedWorkspaceRoots.clear();
  grantedDocuments.clear();
}
