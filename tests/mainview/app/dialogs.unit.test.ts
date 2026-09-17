import { describe, expect, test } from "bun:test";

import {
  activeDialog,
  cancelDialog,
  confirmDialog,
  promptFilename,
  promptQuickOpen,
  submitConfirm,
  submitFilename,
  submitQuickOpen,
} from "../../../src/mainview/app/dialogs.ts";

// Intent: DialogHost owns dialog lifecycle through this module - replace dismisses
// the prior request, cancel/submit resolve exactly once, empty submit is a no-op.
describe("dialog lifecycle", () => {
  test("replace, cancel, and empty-submit resolve without leaving dialogs hanging", async () => {
    const first = promptFilename({ title: "First", label: "Name" });
    expect(activeDialog.value?.kind).toBe("filename");

    const second = confirmDialog("Overwrite?", { initialFocus: "cancel" });
    await expect(first).resolves.toBeNull();
    expect(activeDialog.value?.kind).toBe("confirm");
    expect(activeDialog.value).toMatchObject({
      kind: "confirm",
      initialFocus: "cancel",
    });

    submitConfirm(true);
    await expect(second).resolves.toBe(true);
    expect(activeDialog.value).toBeNull();

    const filename = promptFilename({ title: "Name", label: "File" });
    cancelDialog();
    await expect(filename).resolves.toBeNull();
    expect(activeDialog.value).toBeNull();

    const confirm = confirmDialog("Quit?");
    cancelDialog();
    await expect(confirm).resolves.toBe(false);
    expect(activeDialog.value).toBeNull();

    const named = promptFilename({ title: "Name", label: "File" });
    submitFilename("   ");
    expect(activeDialog.value?.kind).toBe("filename");
    submitFilename("note.md");
    await expect(named).resolves.toBe("note.md");

    const quickOpen = promptQuickOpen();
    submitQuickOpen("");
    expect(activeDialog.value?.kind).toBe("quickOpen");
    submitQuickOpen("docs/guide.md");
    await expect(quickOpen).resolves.toBe("docs/guide.md");
    expect(activeDialog.value).toBeNull();
  });
});
