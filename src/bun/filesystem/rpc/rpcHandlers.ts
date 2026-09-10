/**
 * The privileged side of the RPC boundary.
 *
 * Every handler treats its parameters as untrusted input: it validates shape
 * and type, resolves paths against an authority the renderer cannot forge, and
 * returns a controlled error rather than a host-level one. The renderer holds
 * no capability to name an arbitrary filesystem target - it can only ask for a
 * document inside a folder the person opened, or for a grant it was handed.
 *
 * Wiring only. The rules themselves live in `workspaceAuthority`, which stays
 * free of the Electrobun runtime so they can be exercised directly.
 */
import { Utils } from "electrobun/main";

import {
  listWorkspaceEntries,
  scanWorkspace as scanWorkspaceOnDisk,
} from "../scanning/scanDirectory";
import {
  createDocument as createDocumentOnDisk,
  deleteDocument as deleteDocumentOnDisk,
  readDocument as readDocumentOnDisk,
  renameDocument as renameDocumentOnDisk,
  writeDocument as writeDocumentOnDisk,
  grantDetachedWorkspaceDocument,
  readSelectedDocument,
  saveSelectedDocument,
  saveSelectedHtmlExport,
  writeGrantedDocument,
} from "../io/documentIo";
import {
  authorizeChosenWorkspaceRoot,
  authorizedDesktopPath,
  authorizedWorkspaceRoot,
  contained,
  grantDocument,
  grantedPath,
  reauthorizeWorkspaceRoot,
} from "../security/workspaceAuthority";
import {
  optionalBoolean,
  optionalMtime,
  optionalString,
  requireBasename,
  requireDefaultExtension,
  requireDocumentContent,
  requireGrantToken,
  requireLinkMode,
  requireMtime,
  requireString,
} from "./rpcInput";

async function pickNativePath(options: {
  allowedFileTypes: string;
  canChooseFiles: boolean;
  canChooseDirectory: boolean;
}): Promise<string | null> {
  const chosenPaths = await Utils.openFileDialog({
    startingFolder: Utils.paths.home,
    allowedFileTypes: options.allowedFileTypes,
    canChooseFiles: options.canChooseFiles,
    canChooseDirectory: options.canChooseDirectory,
    allowsMultipleSelection: false,
  });
  return chosenPaths[0] ?? null;
}

export const filesystemRpcHandlers = {
  openWorkspace: contained("openWorkspace", async (params: unknown) => {
    const requestedPath = optionalString(params, "path", "");
    if (requestedPath) {
      return reauthorizeWorkspaceRoot(requestedPath);
    }
    const selectedPath = await pickNativePath({
      allowedFileTypes: "*",
      canChooseFiles: false,
      canChooseDirectory: true,
    });
    return selectedPath ? authorizeChosenWorkspaceRoot(selectedPath) : null;
  }),
  pickAndOpenDocument: contained("pickAndOpenDocument", async () => {
    const selectedPath = await pickNativePath({
      allowedFileTypes: "*.md,*.markdown,*.mdx",
      canChooseFiles: true,
      canChooseDirectory: false,
    });
    if (!selectedPath) {
      return null;
    }
    const snapshot = await readSelectedDocument(selectedPath);
    return {
      ...snapshot,
      grantToken: grantDocument(snapshot.absolutePath),
    };
  }),
  pickAndSaveDocument: contained("pickAndSaveDocument", async (params: unknown) => {
    const basename = requireBasename(params);
    const content = requireDocumentContent(params);
    const defaultExtension = requireDefaultExtension(params);
    const overwrite = optionalBoolean(params, "overwrite", false);

    const selectedFolder = await pickNativePath({
      allowedFileTypes: "*",
      canChooseFiles: false,
      canChooseDirectory: true,
    });
    if (!selectedFolder) {
      return { status: "cancelled" as const };
    }
    const result = await saveSelectedDocument(
      selectedFolder,
      basename,
      content,
      defaultExtension,
      overwrite,
    );
    if (result.status === "exists") {
      return result;
    }
    return {
      ...result,
      grantToken: grantDocument(result.absolutePath),
    };
  }),
  pickAndSaveHtmlExport: contained("pickAndSaveHtmlExport", async (params: unknown) => {
    const basename = requireBasename(params);
    const content = requireDocumentContent(params);
    const overwrite = optionalBoolean(params, "overwrite", false);

    const selectedFolder = await pickNativePath({
      allowedFileTypes: "*",
      canChooseFiles: false,
      canChooseDirectory: true,
    });
    if (!selectedFolder) {
      return { status: "cancelled" as const };
    }
    const result = await saveSelectedHtmlExport(selectedFolder, basename, content, overwrite);
    if (result.status === "exists") {
      return { status: "exists" as const, absolutePath: result.absolutePath };
    }
    return { status: "saved" as const, absolutePath: result.absolutePath };
  }),
  writeGrantedDocument: contained("writeGrantedDocument", async (params: unknown) => {
    const grantToken = requireGrantToken(params);
    const result = await writeGrantedDocument(
      grantedPath(grantToken),
      requireDocumentContent(params),
      requireMtime(params),
    );
    return { ...result, grantToken };
  }),
  grantDetachedWorkspaceDocument: contained(
    "grantDetachedWorkspaceDocument",
    async (params: unknown) => {
      const rootPath = await authorizedWorkspaceRoot(requireString(params, "rootPath"));
      const result = await grantDetachedWorkspaceDocument(
        rootPath,
        requireString(params, "relativePath"),
      );
      return { ...result, grantToken: grantDocument(result.absolutePath) };
    },
  ),
  scanWorkspace: contained("scanWorkspace", async (params: unknown) => {
    const rootPath = await authorizedWorkspaceRoot(requireString(params, "path"));
    const scan = await scanWorkspaceOnDisk(rootPath, {
      includeHidden: optionalBoolean(params, "includeHidden", false),
      linkMode: requireLinkMode(params),
    });
    return {
      path: rootPath,
      scannedNotes: scan.scannedNotes,
      truncated: scan.truncated,
      skipped: scan.skipped,
    };
  }),
  listDirectory: contained("listDirectory", async (params: unknown) =>
    listWorkspaceEntries(
      await authorizedWorkspaceRoot(requireString(params, "rootPath")),
      optionalString(params, "relativePath", ""),
      { includeHidden: optionalBoolean(params, "includeHidden", false) },
    ),
  ),
  revealInExplorer: contained("revealInExplorer", async (params: unknown) => {
    Utils.showItemInFolder(await authorizedDesktopPath(requireString(params, "path")));
    return true;
  }),
  copyPath: contained("copyPath", async (params: unknown) => {
    Utils.clipboardWriteText(await authorizedDesktopPath(requireString(params, "path")));
    return true;
  }),
  readDocument: contained("readDocument", async (params: unknown) =>
    readDocumentOnDisk(
      await authorizedWorkspaceRoot(requireString(params, "rootPath")),
      requireString(params, "relativePath"),
    ),
  ),
  writeDocument: contained("writeDocument", async (params: unknown) =>
    writeDocumentOnDisk(
      await authorizedWorkspaceRoot(requireString(params, "rootPath")),
      requireString(params, "relativePath"),
      requireDocumentContent(params),
      optionalMtime(params),
      requireLinkMode(params),
    ),
  ),
  createDocument: contained("createDocument", async (params: unknown) =>
    createDocumentOnDisk(
      await authorizedWorkspaceRoot(requireString(params, "rootPath")),
      requireString(params, "relativePath"),
      requireDocumentContent(params),
      requireLinkMode(params),
    ),
  ),
  renameDocument: contained("renameDocument", async (params: unknown) =>
    renameDocumentOnDisk(
      await authorizedWorkspaceRoot(requireString(params, "rootPath")),
      requireString(params, "relativePath"),
      requireString(params, "nextRelativePath"),
      optionalMtime(params),
      requireLinkMode(params),
    ),
  ),
  deleteDocument: contained("deleteDocument", async (params: unknown) =>
    deleteDocumentOnDisk(
      await authorizedWorkspaceRoot(requireString(params, "rootPath")),
      requireString(params, "relativePath"),
      optionalMtime(params),
    ),
  ),
};
