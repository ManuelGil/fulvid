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

export type ExplorerContextActionId = "rename" | "move" | "reveal" | "copy" | "delete";

/** i18n keys for Explorer file-row context actions. */
export const explorerFileContextActionLabelKeys: Record<
  ExplorerContextActionId,
  "files.rename" | "files.move" | "menu.revealInFolder" | "menu.copyPath" | "files.delete"
> = {
  rename: "files.rename",
  move: "files.move",
  reveal: explorerPathActionLabelKeys.reveal,
  copy: explorerPathActionLabelKeys.copy,
  delete: "files.delete",
};

/** File row: filesystem document operations only. */
export function explorerFileContextActionIds(): readonly ExplorerContextActionId[] {
  return ["rename", "move", "reveal", "copy", "delete"];
}

export type ExplorerFolderContextActionId = "reveal" | "copy";

/** Folder row: filesystem reveal and path copy only (New actions are a submenu). */
export function explorerFolderContextActionIds(): readonly ExplorerFolderContextActionId[] {
  return ["reveal", "copy"];
}
