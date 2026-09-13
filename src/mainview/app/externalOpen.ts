/**
 * Applying external open requests, through the lifecycles that already own them.
 *
 * The host has already decided what may be opened; by the time a request
 * reaches here it is a grant snapshot or an authorized root, never a path to
 * act on. This module only routes each one to its existing owner:
 *
 *   file   -> openOrActivate       (the buffer table, which calls selectDocument)
 *   folder -> selectRecentWorkspace (the folder lifecycle, which scans and loads)
 *
 * It writes no Focus state and no active tab of its own - `openOrActivate`
 * pairs Focus through `selectDocument`, and it must stay the only thing that
 * does. Dirty buffers, open tabs and confirmations behave as they do for any
 * other open, because it is the same open.
 */
import { desktopRequest } from "../desktop/electrobunClient";
import type { ResolvedExternalOpen } from "../desktop/externalOpen";
import { notify } from "./notify";
import { relativeDocumentPath, selectRecentWorkspace, workspace } from "./workspaceState";
import { openOrActivate } from "../modules/editor/document/documentBuffers";
import { describeFilesystemError } from "../modules/workspace/filesystem/workspaceScanner";
import { filesystemErrorMessage } from "../modules/workspace/filesystem/workspaceErrors";

async function applyFolder(resolved: Extract<ResolvedExternalOpen, { kind: "folder" }>) {
  // The same path a recent folder takes: re-authorize, then load. The host
  // approved this root a moment ago, so the re-authorization succeeds without
  // the renderer ever being the authority for it.
  await selectRecentWorkspace(resolved.rootPath);
}

async function applyFile(resolved: Extract<ResolvedExternalOpen, { kind: "file" }>) {
  // Attach to the open folder when the document lives inside it, so it behaves
  // like a folder document rather than a standalone one - exactly what the
  // Open dialog does with its own snapshot.
  const rootPath = workspace.value?.path ?? null;
  const attachment =
    rootPath && resolved.snapshot.absolutePath
      ? relativeDocumentPath(rootPath, resolved.snapshot.absolutePath)
      : null;
  await openOrActivate({
    kind: "granted",
    snapshot: resolved.snapshot,
    ...(attachment && rootPath ? { attachment: { rootPath, path: attachment } } : {}),
  });
}

/**
 * Drain and apply everything the host is holding.
 *
 * Folders are applied before files so a requested document can attach to a
 * requested folder rather than opening standalone beside it.
 *
 * Returns whether a folder was opened, so startup can skip restoring the last
 * folder: an explicit request outranks a remembered one.
 */
export async function applyPendingExternalOpens(): Promise<{ openedFolder: boolean }> {
  let resolvedRequests: ResolvedExternalOpen[];
  try {
    resolvedRequests = await desktopRequest().takePendingExternalOpens({});
  } catch {
    // No host, or a host that does not answer: startup continues unchanged.
    return { openedFolder: false };
  }

  let openedFolder = false;
  for (const resolved of resolvedRequests) {
    try {
      if (resolved.kind === "folder") {
        await applyFolder(resolved);
        openedFolder = true;
      }
    } catch (error) {
      notify(describeFilesystemError(error, "workspace.openWorkspaceError"));
    }
  }

  for (const resolved of resolvedRequests) {
    try {
      if (resolved.kind === "file") {
        await applyFile(resolved);
      } else if (resolved.kind === "rejected") {
        // A request Fulvid refused is said out loud. Silently ignoring one
        // leaves the person watching an app that opened nothing.
        notify(
          describeFilesystemError(
            new Error(filesystemErrorMessage(resolved.reason)),
            "workspace.openDocumentError",
          ),
        );
      }
    } catch (error) {
      notify(describeFilesystemError(error, "workspace.openDocumentError"));
    }
  }

  return { openedFolder };
}
