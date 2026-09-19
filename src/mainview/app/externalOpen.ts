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
import { openGrantedSnapshot, selectRecentWorkspace } from "./workspaceState";
import { describeFilesystemError } from "../modules/workspace/filesystem/workspaceScanner";
import { filesystemErrorMessage } from "../modules/workspace/filesystem/workspaceErrors";

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
        // The same path a recent folder takes: re-authorize, then load. The host
        // approved this root a moment ago, so the re-authorization succeeds
        // without the renderer ever being the authority for it.
        await selectRecentWorkspace(resolved.rootPath);
        openedFolder = true;
      }
    } catch (error) {
      notify(describeFilesystemError(error, "workspace.openWorkspaceError"));
    }
  }

  for (const resolved of resolvedRequests) {
    try {
      if (resolved.kind === "file") {
        // Exactly what the Open dialog does with its own snapshot.
        await openGrantedSnapshot(resolved.snapshot);
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
