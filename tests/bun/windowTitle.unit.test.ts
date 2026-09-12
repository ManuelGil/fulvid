import { describe, expect, test } from "bun:test";

import { isPresentableWindowTitle, setNativeWindowTitle } from "../../src/bun/windowTitle.ts";

// Intent: one host capability sets the window title and fails closed.
describe("native window title", () => {
  test("sets the host title and rejects non-presentable input", () => {
    let title = "Fulvid";
    expect(
      setNativeWindowTitle(
        {
          setTitle: (next) => {
            title = next;
          },
        },
        "Fulvid - docs/index.md",
      ),
    ).toBe(true);
    expect(title).toBe("Fulvid - docs/index.md");
    expect(setNativeWindowTitle(null, "x")).toBe(false);
    expect(
      setNativeWindowTitle(
        {
          setTitle: () => {
            throw new Error("gone");
          },
        },
        "x",
      ),
    ).toBe(false);
    expect(isPresentableWindowTitle("")).toBe(false);
    expect(isPresentableWindowTitle("   ")).toBe(false);
    expect(isPresentableWindowTitle("a\nb")).toBe(false);
    expect(isPresentableWindowTitle("ok")).toBe(true);
    expect(setNativeWindowTitle({ setTitle: () => undefined }, "bad\0title")).toBe(false);
  });
});
