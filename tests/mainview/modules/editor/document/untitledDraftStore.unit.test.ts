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

describe("untitled draft store", () => {
  afterEach(async () => {
    await flushUntitledDraftWrites();
    resetUntitledDraftStoreForTests();
  });

  test("puts, lists, and deletes drafts", async () => {
    resetUntitledDraftStoreForTests();
    await putUntitledDraft({
      recoveryId: "r1",
      content: "# one",
      updatedAt: 2,
    });
    await putUntitledDraft({
      recoveryId: "r2",
      content: "# two",
      updatedAt: 1,
    });
    const listed = await listUntitledDrafts();
    expect(listed.map((draft) => draft.recoveryId)).toEqual(["r2", "r1"]);
    await deleteUntitledDraft("r2");
    expect((await listUntitledDrafts()).map((draft) => draft.recoveryId)).toEqual(["r1"]);
  });

  test("ignores malformed and oversized records", async () => {
    resetUntitledDraftStoreForTests();
    await putUntitledDraft({
      recoveryId: "",
      content: "x",
      updatedAt: 1,
    } as never);
    await putUntitledDraft({
      recoveryId: "big",
      content: "x".repeat(MAX_UNTITLED_DRAFT_CHARS + 1),
      updatedAt: 1,
    });
    expect(await listUntitledDrafts()).toEqual([]);
  });

  test("coalesced writes keep the latest content", async () => {
    resetUntitledDraftStoreForTests();
    scheduleUntitledDraftPersist("r3", "first");
    scheduleUntitledDraftPersist("r3", "second");
    await flushUntitledDraftWrites();
    expect(await listUntitledDrafts()).toEqual([
      {
        recoveryId: "r3",
        content: "second",
        updatedAt: expect.any(Number),
      },
    ]);
  });

  test("empty and whitespace-only content does not persist", async () => {
    resetUntitledDraftStoreForTests();
    expect(isEmptyUntitledDraftContent("")).toBe(true);
    expect(isEmptyUntitledDraftContent(" \n\t ")).toBe(true);
    expect(isEmptyUntitledDraftContent("# Note")).toBe(false);

    await putUntitledDraft({ recoveryId: "empty", content: "", updatedAt: 1 });
    await putUntitledDraft({ recoveryId: "ws", content: "\n\n  ", updatedAt: 2 });
    expect(await listUntitledDrafts()).toEqual([]);

    scheduleUntitledDraftPersist("sched-empty", "   \n");
    await flushUntitledDraftWrites();
    expect(await listUntitledDrafts()).toEqual([]);
  });

  test("non-empty draft is removed when content becomes empty, then can return", async () => {
    resetUntitledDraftStoreForTests();
    await putUntitledDraft({
      recoveryId: "r4",
      content: "hello",
      updatedAt: 1,
    });
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
