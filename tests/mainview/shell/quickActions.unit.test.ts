import { describe, expect, test } from "bun:test";

import {
  orderQuickActionsInGroup,
  quickActions,
  selectQuickActionsForVisibleCount,
  toAriaKeyshortcuts,
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

function indexOfId(ordered: readonly string[], id: string): number {
  const index = ordered.indexOf(id);
  if (index < 0) {
    throw new Error(`missing id ${id}`);
  }
  return index;
}

// Intent: Quick Actions follow the interaction model, not source order.
// Overflow keeps writing/preview chrome ahead of clipboard and folder chrome.
describe("Quick Actions", () => {
  test("orders by interaction model and keeps Writing Focus over clipboard when space is scarce", () => {
    const reversed = quickActions.slice().reverse();
    const full = ids(selectQuickActionsForVisibleCount(reversed, reversed.length));
    // Relative order invariants - not a brittle full-catalog snapshot.
    expect(indexOfId(full, "newDocument")).toBeLessThan(indexOfId(full, "openFile"));
    expect(indexOfId(full, "openFile")).toBeLessThan(indexOfId(full, "save"));
    expect(indexOfId(full, "undo")).toBeLessThan(indexOfId(full, "cut"));
    expect(indexOfId(full, "toggleWritingFocus")).toBeLessThan(indexOfId(full, "openExplorer"));

    const editOrdered = ids(
      orderQuickActionsInGroup(reversed.filter((action) => action.group === "edit")),
    );
    expect(indexOfId(editOrdered, "annotateDocument")).toBeLessThan(
      indexOfId(editOrdered, "insertTableOfContents"),
    );
    expect(indexOfId(editOrdered, "undo")).toBeLessThan(indexOfId(editOrdered, "cut"));
    expect(indexOfId(editOrdered, "cut")).toBeLessThan(indexOfId(editOrdered, "paste"));

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
      ids(selectQuickActionsForVisibleCount(quickActions, quickActions.length - 8)),
    );
    expect(visibleIds.has("toggleWritingFocus")).toBe(true);
    expect(visibleIds.has("cut")).toBe(false);
    expect(visibleIds.has("insertTableOfContents")).toBe(false);

    // ARIA tokens must expand the platform-neutral Ctrl/Cmd notation.
    expect(toAriaKeyshortcuts("Ctrl/Cmd+S")).toBe("Control+S Meta+S");
    expect(toAriaKeyshortcuts("Ctrl/Cmd+P")).toBe("Control+P Meta+P");
    expect(toAriaKeyshortcuts("F11")).toBe("F11");
    expect(toAriaKeyshortcuts("Ctrl+Cmd+F")).toBe("Control+Meta+F");
    expect(toAriaKeyshortcuts(undefined)).toBeUndefined();
  });
});
