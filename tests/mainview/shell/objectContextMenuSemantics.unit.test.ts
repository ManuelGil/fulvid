import { describe, expect, test } from "bun:test";

import {
  canCloseOtherEditorTabs,
  editorTabContextActions,
} from "../../../src/mainview/modules/editor/editorTabContextMenu.ts";
import {
  explorerContextMenuLabelKey,
  explorerPathActionLabelKeys,
} from "../../../src/mainview/modules/workspace/explorer/explorerContextMenu.ts";

// Intent: object-context menus name their object and copy/reveal paths accurately.
// Growth boundary: add a case only if file/folder naming or path-action keys change.
describe("object context menu semantics", () => {
  test("names Explorer menus by entry kind", () => {
    expect(explorerContextMenuLabelKey("file")).toBe("files.documentActions");
    expect(explorerContextMenuLabelKey("directory")).toBe("files.folderActions");
  });

  test("uses Copy Path and Reveal in Folder for Explorer path actions", () => {
    expect(explorerPathActionLabelKeys.copy).toBe("menu.copyPath");
    expect(explorerPathActionLabelKeys.reveal).toBe("menu.revealInFolder");
  });

  test("omits Close others when fewer than two tabs are open", () => {
    expect(canCloseOtherEditorTabs(0)).toBe(false);
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
});
