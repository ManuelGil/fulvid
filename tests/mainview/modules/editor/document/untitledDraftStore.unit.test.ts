import { afterEach, describe, expect, test } from "bun:test";

import {
  deleteUntitledDraft,
  flushUntitledDraftWrites,
  isEmptyUntitledDraftContent,
  listUntitledDrafts,
  putUntitledDraft,
  resetUntitledDraftStoreForTests,
  scheduleUntitledDraftPersist,
  MAX_UNTITLED_DRAFT_CHARS,
} from "../../../../../src/mainview/modules/editor/document/untitledDraftStore.ts";

// Intent: ephemeral Untitled recovery stores only non-empty drafts; bad or empty
// content never becomes a recoverable note; coalesced writes keep the latest text.
describe("untitled draft store", () => {
  afterEach(async () => {
    await flushUntitledDraftWrites();
    resetUntitledDraftStoreForTests();
  });

  test("persists latest content, rejects bad records, and deletes by recovery id", async () => {
    resetUntitledDraftStoreForTests();
    await putUntitledDraft({ recoveryId: "", content: "x", updatedAt: 1 } as never);
    await putUntitledDraft({
      recoveryId: "big",
      content: "x".repeat(MAX_UNTITLED_DRAFT_CHARS + 1),
      updatedAt: 1,
    });
    expect(await listUntitledDrafts()).toEqual([]);

    scheduleUntitledDraftPersist("r1", "first");
    scheduleUntitledDraftPersist("r1", "second");
    await putUntitledDraft({ recoveryId: "r2", content: "# two", updatedAt: 1 });
    await flushUntitledDraftWrites();

    const listed = await listUntitledDrafts();
    expect(listed.map((draft) => draft.recoveryId).sort()).toEqual(["r1", "r2"]);
    expect(listed.find((draft) => draft.recoveryId === "r1")?.content).toBe("second");

    await deleteUntitledDraft("r2");
    expect((await listUntitledDrafts()).map((draft) => draft.recoveryId)).toEqual(["r1"]);
  });

  test("empty and whitespace content never persists and clears an existing draft", async () => {
    resetUntitledDraftStoreForTests();
    expect(isEmptyUntitledDraftContent("")).toBe(true);
    expect(isEmptyUntitledDraftContent(" \n\t ")).toBe(true);
    expect(isEmptyUntitledDraftContent("# Note")).toBe(false);

    await putUntitledDraft({ recoveryId: "empty", content: "", updatedAt: 1 });
    await putUntitledDraft({ recoveryId: "ws", content: "\n\n  ", updatedAt: 2 });
    scheduleUntitledDraftPersist("sched-empty", "   \n");
    await flushUntitledDraftWrites();
    expect(await listUntitledDrafts()).toEqual([]);

    await putUntitledDraft({ recoveryId: "r4", content: "hello", updatedAt: 1 });
    expect((await listUntitledDrafts()).map((draft) => draft.recoveryId)).toEqual(["r4"]);

    scheduleUntitledDraftPersist("r4", "");
    await flushUntitledDraftWrites();
    expect(await listUntitledDrafts()).toEqual([]);

    scheduleUntitledDraftPersist("r4", "hello again");
    await flushUntitledDraftWrites();
    expect(await listUntitledDrafts()).toEqual([
      {
        recoveryId: "r4",
        content: "hello again",
        updatedAt: expect.any(Number),
      },
    ]);
  });
});
