import { describe, expect, test } from "bun:test";

import {
  canCloseOtherEditorTabs,
  editorTabContextActions,
} from "../../../src/mainview/modules/editor/editorTabContextMenu.ts";
import {
  explorerContextMenuLabelKey,
  explorerFileContextActionIds,
  explorerFolderContextActionIds,
  explorerPathActionLabelKeys,
} from "../../../src/mainview/modules/workspace/explorer/explorerContextMenu.ts";

// Intent: object menus expose only filesystem/product-grounded actions.
// Folder menus must not reintroduce Context-root operations.
describe("object context menu semantics", () => {
  test("Explorer and tab menus stay filesystem-grounded", () => {
    expect(explorerContextMenuLabelKey("file")).toBe("files.documentActions");
    expect(explorerContextMenuLabelKey("directory")).toBe("files.folderActions");
    expect(explorerPathActionLabelKeys.copy).toBe("menu.copyPath");
    expect(explorerPathActionLabelKeys.reveal).toBe("menu.revealInFolder");

    const fileActions = [...explorerFileContextActionIds()];
    const folderActions = [...explorerFolderContextActionIds()];
    expect(fileActions).toEqual(["rename", "reveal", "copy", "delete"]);
    expect(folderActions).toEqual(["reveal", "copy"]);
    // Removed product concept: Context root must not return via menu actions.
    expect(fileActions.some((id) => id.toLowerCase().includes("context"))).toBe(false);
    expect(folderActions.some((id) => id.toLowerCase().includes("context"))).toBe(false);

    expect(canCloseOtherEditorTabs(1)).toBe(false);
    expect(canCloseOtherEditorTabs(2)).toBe(true);
    expect(
      editorTabContextActions(1, { close: "Close", closeOthers: "Close others" }).map(
        (action) => action.id,
      ),
    ).toEqual(["close"]);
    expect(
      editorTabContextActions(2, { close: "Close", closeOthers: "Close others" }).map(
        (action) => action.id,
      ),
    ).toEqual(["close", "close-others"]);
  });

  test("Explorer file actions stay bound to the invoked row kind", () => {
    // Rename/Delete are file-only; folder menus must not grow destructive IDs.
    // ExplorerPanel freezes contextTarget at open so selection changes cannot
    // retarget these IDs onto a different row.
    expect(explorerFileContextActionIds()).toContain("rename");
    expect(explorerFileContextActionIds()).toContain("delete");
    expect(explorerFolderContextActionIds()).not.toContain("rename");
    expect(explorerFolderContextActionIds()).not.toContain("delete");
  });
});
