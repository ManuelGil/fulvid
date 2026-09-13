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
