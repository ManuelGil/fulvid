/** Accessible name keys for Explorer object-context menus by entry kind. */
export function explorerContextMenuLabelKey(
  kind: "file" | "directory",
): "files.documentActions" | "files.folderActions" {
  return kind === "directory" ? "files.folderActions" : "files.documentActions";
}

/** Path-copy and OS-reveal labels for Explorer (and peers that copy/reveal paths). */
export const explorerPathActionLabelKeys = {
  reveal: "menu.revealInFolder",
  copy: "menu.copyPath",
} as const;

export type ExplorerContextActionId = "rename" | "reveal" | "copy" | "delete";

/** File row: filesystem document operations only. */
export function explorerFileContextActionIds(): readonly ExplorerContextActionId[] {
  return ["rename", "reveal", "copy", "delete"];
}

/** Folder row: filesystem reveal and path copy only. */
export function explorerFolderContextActionIds(): readonly ExplorerContextActionId[] {
  return ["reveal", "copy"];
}
