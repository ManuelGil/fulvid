import { describe, expect, test } from "bun:test";

import { canPersistWindowFrame, toggleNativeFullScreen } from "../../src/bun/windowFullScreen.ts";

// Intent: one host capability toggles native fullscreen on BrowserWindow.
// Fail closed on host errors; never persist fullscreen frames as normal bounds.
describe("native fullscreen", () => {
  test("toggles on the host, fails closed, and blocks frame persistence while fullscreen", () => {
    let fullScreen = false;
    const window = {
      isFullScreen: () => fullScreen,
      setFullScreen: (next: boolean) => {
        fullScreen = next;
      },
    };

    expect(toggleNativeFullScreen(window)).toBe(true);
    expect(fullScreen).toBe(true);
    expect(canPersistWindowFrame(true)).toBe(false);

    expect(toggleNativeFullScreen(window)).toBe(false);
    expect(fullScreen).toBe(false);
    expect(canPersistWindowFrame(false)).toBe(true);

    expect(
      toggleNativeFullScreen({
        isFullScreen: () => false,
        setFullScreen: () => {
          throw new Error("gone");
        },
      }),
    ).toBe(false);
  });
});
