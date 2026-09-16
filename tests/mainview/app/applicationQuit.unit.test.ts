import { describe, expect, test } from "bun:test";

import { confirmAndQuit, shouldConfirmQuit } from "../../../src/mainview/app/applicationQuit.ts";

// Intent: Quit must not discard dirty buffers silently when confirmClose is on.
describe("application quit guard", () => {
  test("confirm matrix: dirty+enabled prompts; cancel protects; confirm and clean quit", async () => {
    expect(shouldConfirmQuit({ dirtyCount: 0, confirmCloseEnabled: true })).toBe(false);
    expect(shouldConfirmQuit({ dirtyCount: 2, confirmCloseEnabled: false })).toBe(false);
    expect(shouldConfirmQuit({ dirtyCount: 1, confirmCloseEnabled: true })).toBe(true);

    let quitCalls = 0;
    const cancelled = await confirmAndQuit({
      dirtyCount: 2,
      confirmCloseEnabled: true,
      confirm: async () => false,
      quit: async () => {
        quitCalls += 1;
      },
    });
    expect(cancelled).toBe(false);
    expect(quitCalls).toBe(0);

    const confirmed = await confirmAndQuit({
      dirtyCount: 1,
      confirmCloseEnabled: true,
      confirm: async () => true,
      quit: async () => {
        quitCalls += 1;
      },
    });
    expect(confirmed).toBe(true);
    expect(quitCalls).toBe(1);

    let confirmCalls = 0;
    const clean = await confirmAndQuit({
      dirtyCount: 0,
      confirmCloseEnabled: true,
      confirm: async () => {
        confirmCalls += 1;
        return true;
      },
      quit: async () => {
        quitCalls += 1;
      },
    });
    expect(clean).toBe(true);
    expect(confirmCalls).toBe(0);
    expect(quitCalls).toBe(2);
  });
});
