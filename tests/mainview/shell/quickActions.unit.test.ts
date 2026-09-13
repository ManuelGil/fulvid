import { describe, expect, test } from "bun:test";

import {
  compareQuickActionsByKeepPriority,
  orderQuickActionsInGroup,
  quickActionGroupOrder,
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

function shuffle<T>(items: readonly T[]): T[] {
  const next = items.slice();
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = (index * 17 + 3) % (index + 1);
    const temporary = next[index]!;
    next[index] = next[swap]!;
    next[swap] = temporary;
  }
  return next;
}

const EXPECTED_FULL_DISPLAY_ORDER = [
  "newDocument",
  "openFile",
  "save",
  "closeAll",
  "openWorkspace",
  "annotateDocument",
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

describe("Quick Action classification", () => {
  test("every action declares group, subgroup, tier, order, and overflowOrder", () => {
    for (const action of quickActions) {
      expect(action.group).toBeTruthy();
      expect(action.subgroup).toBeTruthy();
      expect(action.tier).toBeTruthy();
      expect(Number.isFinite(action.order)).toBe(true);
      expect(Number.isFinite(action.overflowOrder)).toBe(true);
    }
  });

  test("overflowOrder is unique within each tier (ties avoided by metadata)", () => {
    for (const tier of ["core", "secondary", "overflow"] as const) {
      const values = quickActions
        .filter((action) => action.tier === tier)
        .map((action) => action.overflowOrder);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  test("annotation is Edit/document Add/Edit, not a Fulvid toggle", () => {
    const annotation = byId("annotateDocument");
    expect(annotation).toMatchObject({
      group: "edit",
      subgroup: "document",
      tier: "secondary",
      overflowOrder: 50,
    });
    expect(["togglePreview", "toggleWritingFocus", "openExplorer"]).not.toContain(annotation.id);
  });

  test("Preview, Writing Focus, and Explorer stay Fulvid interaction surfaces", () => {
    expect(byId("togglePreview")).toMatchObject({
      group: "fulvid",
      subgroup: "view",
      tier: "secondary",
      overflowOrder: 60,
    });
    expect(byId("toggleWritingFocus")).toMatchObject({
      group: "fulvid",
      subgroup: "mode",
      tier: "secondary",
      overflowOrder: 40,
    });
    expect(byId("openExplorer")).toMatchObject({
      group: "fulvid",
      subgroup: "panels",
      tier: "overflow",
      overflowOrder: 20,
    });
  });
});

describe("Quick Action presentation order (group → subgroup → order)", () => {
  test("file group is document then workspace subgroups", () => {
    const file = orderQuickActionsInGroup(quickActions.filter((action) => action.group === "file"));
    expect(ids(file)).toEqual(["newDocument", "openFile", "save", "closeAll", "openWorkspace"]);
  });

  test("edit group is document → history → clipboard", () => {
    const edit = orderQuickActionsInGroup(quickActions.filter((action) => action.group === "edit"));
    expect(ids(edit)).toEqual(["annotateDocument", "undo", "redo", "cut", "copy", "paste"]);
  });

  test("search and fulvid subgroups stay correctly ordered", () => {
    expect(
      ids(orderQuickActionsInGroup(quickActions.filter((action) => action.group === "search"))),
    ).toEqual(["find", "replace", "openGlobalSearch"]);
    expect(
      ids(orderQuickActionsInGroup(quickActions.filter((action) => action.group === "fulvid"))),
    ).toEqual(["togglePreview", "toggleWritingFocus", "openExplorer"]);
  });

  test("array position does not determine presentation order", () => {
    const reversed = quickActions.slice().reverse();
    const fromCanonical = selectQuickActionsForVisibleCount(quickActions, quickActions.length);
    const fromReversed = selectQuickActionsForVisibleCount(reversed, reversed.length);
    expect(ids(fromCanonical)).toEqual([...EXPECTED_FULL_DISPLAY_ORDER]);
    expect(ids(fromReversed)).toEqual(ids(fromCanonical));
  });

  test("More menu follows group → subgroup → order when everything overflows", () => {
    expect(selectQuickActionsForVisibleCount(quickActions, 0)).toEqual([]);
    const overflow: string[] = [];
    for (const group of quickActionGroupOrder) {
      overflow.push(
        ...ids(orderQuickActionsInGroup(quickActions.filter((action) => action.group === group))),
      );
    }
    expect(overflow).toEqual([...EXPECTED_FULL_DISPLAY_ORDER]);
  });
});

describe("Quick Action overflow (tier → overflowOrder)", () => {
  test("full budget keeps every action in presentation order", () => {
    expect(ids(selectQuickActionsForVisibleCount(quickActions, quickActions.length))).toEqual([
      ...EXPECTED_FULL_DISPLAY_ORDER,
    ]);
  });

  test("overflow-tier actions leave before secondary and core", () => {
    const withoutOverflowTiers = quickActions.filter((action) => action.tier !== "overflow");
    const visible = selectQuickActionsForVisibleCount(quickActions, withoutOverflowTiers.length);
    expect(new Set(ids(visible))).toEqual(new Set(ids(withoutOverflowTiers)));
    expect(visible.some((action) => action.tier === "overflow")).toBe(false);
  });

  test("explicit overflowOrder drops Open Folder before Explorer and Global Search", () => {
    const visibleIds = new Set(
      ids(selectQuickActionsForVisibleCount(quickActions, quickActions.length - 1)),
    );
    expect(visibleIds.has("openWorkspace")).toBe(false);
    expect(visibleIds.has("openExplorer")).toBe(true);
    expect(visibleIds.has("openGlobalSearch")).toBe(true);
  });

  test("Preview, Annotation, and Focus outrank clipboard via overflowOrder", () => {
    const visibleIds = new Set(
      ids(selectQuickActionsForVisibleCount(quickActions, quickActions.length - 6)),
    );
    expect(visibleIds.has("togglePreview")).toBe(true);
    expect(visibleIds.has("annotateDocument")).toBe(true);
    expect(visibleIds.has("toggleWritingFocus")).toBe(true);
    expect(visibleIds.has("cut")).toBe(false);
    expect(visibleIds.has("copy")).toBe(false);
    expect(visibleIds.has("paste")).toBe(false);
  });

  test("core actions survive when only a few buttons fit", () => {
    expect(ids(selectQuickActionsForVisibleCount(quickActions, 5))).toEqual([
      "newDocument",
      "openFile",
      "save",
      "undo",
      "redo",
    ]);
  });

  test("within core, lower overflowOrder leaves first (find before redo)", () => {
    const visibleIds = new Set(ids(selectQuickActionsForVisibleCount(quickActions, 5)));
    expect(visibleIds.has("find")).toBe(false);
    expect(visibleIds.has("redo")).toBe(true);
  });

  test("array position does not determine overflow selection", () => {
    const shuffled = shuffle(quickActions);
    const budget = quickActions.length - 6;
    expect(new Set(ids(selectQuickActionsForVisibleCount(shuffled, budget)))).toEqual(
      new Set(ids(selectQuickActionsForVisibleCount(quickActions, budget))),
    );
  });

  test("equal overflowOrder falls back to command id without a new field", () => {
    const left: QuickActionDefinition = {
      ...byId("cut"),
      id: "cut",
      overflowOrder: 15,
    };
    const right: QuickActionDefinition = {
      ...byId("copy"),
      id: "copy",
      overflowOrder: 15,
    };
    expect(compareQuickActionsByKeepPriority(left, right)).toBe("cut".localeCompare("copy"));
    expect(compareQuickActionsByKeepPriority(right, left)).toBe("copy".localeCompare("cut"));
  });

  test("overflow stickiness remains Preview > Annotation > Focus > Explorer", () => {
    const ranked = [
      byId("togglePreview"),
      byId("annotateDocument"),
      byId("toggleWritingFocus"),
      byId("openExplorer"),
    ];
    // Visible set is chosen by tier → overflowOrder, then shown by group → subgroup → order.
    expect(ids(selectQuickActionsForVisibleCount(ranked, 3))).toEqual([
      "annotateDocument",
      "togglePreview",
      "toggleWritingFocus",
    ]);
    expect(ids(selectQuickActionsForVisibleCount(ranked, 2))).toEqual([
      "annotateDocument",
      "togglePreview",
    ]);
    expect(ids(selectQuickActionsForVisibleCount(ranked, 1))).toEqual(["togglePreview"]);
  });
});

describe("Interaction-model grouping (not feature ownership)", () => {
  test("reordering source definitions does not change Edit or Fulvid presentation", () => {
    const reordered: QuickActionDefinition[] = [
      ...quickActions.filter((action) => action.group !== "edit" && action.group !== "fulvid"),
      byId("paste"),
      byId("openExplorer"),
      byId("redo"),
      byId("toggleWritingFocus"),
      byId("cut"),
      byId("annotateDocument"),
      byId("togglePreview"),
      byId("undo"),
      byId("copy"),
    ];
    expect(
      ids(orderQuickActionsInGroup(reordered.filter((action) => action.group === "edit"))),
    ).toEqual(["annotateDocument", "undo", "redo", "cut", "copy", "paste"]);
    expect(
      ids(orderQuickActionsInGroup(reordered.filter((action) => action.group === "fulvid"))),
    ).toEqual(["togglePreview", "toggleWritingFocus", "openExplorer"]);
    expect(ids(selectQuickActionsForVisibleCount(reordered, reordered.length))).toEqual([
      ...EXPECTED_FULL_DISPLAY_ORDER,
    ]);
  });
});
