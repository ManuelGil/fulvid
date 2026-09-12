import { describe, expect, test } from "bun:test";

import { confirmAndQuit, shouldConfirmQuit } from "../../../src/mainview/app/applicationQuit.ts";

// Intent: Quit must not discard dirty buffers silently when confirmClose is on.
// Growth boundary: only when quit/dirty confirmation rules change.
describe("application quit guard", () => {
  test("requires confirmation only when confirmClose is on and something is dirty", () => {
    expect(shouldConfirmQuit({ dirtyCount: 0, confirmCloseEnabled: true })).toBe(false);
    expect(shouldConfirmQuit({ dirtyCount: 2, confirmCloseEnabled: false })).toBe(false);
    expect(shouldConfirmQuit({ dirtyCount: 1, confirmCloseEnabled: true })).toBe(true);
  });

  test("cancelling confirmation leaves the application running", async () => {
    let quitCalls = 0;
    const quit = await confirmAndQuit({
      dirtyCount: 2,
      confirmCloseEnabled: true,
      confirm: async () => false,
      quit: async () => {
        quitCalls += 1;
      },
    });
    expect(quit).toBe(false);
    expect(quitCalls).toBe(0);
  });

  test("accepting confirmation quits after the existing confirm path", async () => {
    let quitCalls = 0;
    const quit = await confirmAndQuit({
      dirtyCount: 1,
      confirmCloseEnabled: true,
      confirm: async () => true,
      quit: async () => {
        quitCalls += 1;
      },
    });
    expect(quit).toBe(true);
    expect(quitCalls).toBe(1);
  });

  test("quits without prompting when nothing is dirty", async () => {
    let confirmCalls = 0;
    let quitCalls = 0;
    const quit = await confirmAndQuit({
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
    expect(quit).toBe(true);
    expect(confirmCalls).toBe(0);
    expect(quitCalls).toBe(1);
  });
});
