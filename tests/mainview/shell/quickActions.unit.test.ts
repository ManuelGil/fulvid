import { describe, expect, test } from "bun:test";

import {
  orderQuickActionsInGroup,
  quickActions,
  selectQuickActionsForVisibleCount,
  type QuickActionDefinition,
} from "../../../src/mainview/shell/commands.ts";

function ids(actions: readonly QuickActionDefinition[]): string[] {
  return actions.map((action) => action.id);
}

function byId(id: string): QuickActionDefinition {
  const action = quickActions.find((entry) => entry.id === id);
  if (!action) {
    throw new Error(`missing quick action ${id}`);
  }
  return action;
}

const EXPECTED_FULL_DISPLAY_ORDER = [
  "newDocument",
  "newDocumentFromReadme",
  "newDocumentFromSelection",
  "openFile",
  "save",
  "closeAll",
  "openWorkspace",
  "annotateDocument",
  "insertDocumentLink",
  "insertTableOfContents",
  "undo",
  "redo",
  "cut",
  "copy",
  "paste",
  "find",
  "replace",
  "openGlobalSearch",
  "togglePreview",
  "toggleWritingFocus",
  "openExplorer",
] as const;

// Intent: Quick Actions follow the interaction model, not source order.
// Overflow keeps writing/preview chrome ahead of clipboard and folder chrome.
describe("Quick Actions", () => {
  test("orders by interaction model and keeps Writing Focus over clipboard when space is scarce", () => {
    const reversed = quickActions.slice().reverse();
    expect(ids(selectQuickActionsForVisibleCount(reversed, reversed.length))).toEqual([
      ...EXPECTED_FULL_DISPLAY_ORDER,
    ]);
    expect(
      ids(orderQuickActionsInGroup(reversed.filter((action) => action.group === "edit"))),
    ).toEqual([
      "annotateDocument",
      "insertDocumentLink",
      "insertTableOfContents",
      "undo",
      "redo",
      "cut",
      "copy",
      "paste",
    ]);
    expect(byId("annotateDocument").group).toBe("edit");
    expect(byId("toggleWritingFocus").group).toBe("fulvid");

    expect(ids(selectQuickActionsForVisibleCount(quickActions, 5))).toEqual([
      "newDocument",
      "openFile",
      "save",
      "undo",
      "redo",
    ]);

    const ranked = [
      byId("togglePreview"),
      byId("annotateDocument"),
      byId("toggleWritingFocus"),
      byId("openExplorer"),
    ];
    expect(ids(selectQuickActionsForVisibleCount(ranked, 3))).toEqual([
      "annotateDocument",
      "togglePreview",
      "toggleWritingFocus",
    ]);

    const visibleIds = new Set(
      ids(selectQuickActionsForVisibleCount(quickActions, quickActions.length - 7)),
    );
    expect(visibleIds.has("toggleWritingFocus")).toBe(true);
    expect(visibleIds.has("cut")).toBe(false);
    expect(visibleIds.has("insertTableOfContents")).toBe(false);
  });
});
