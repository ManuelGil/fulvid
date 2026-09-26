import { describe, expect, test } from "bun:test";

import { electrobunDevProcessEnv, linuxWebViewPaintEnv } from "../../scripts/linuxWebViewEnv";

describe("linuxWebViewPaintEnv", () => {
  test("is a no-op on Windows and macOS", () => {
    const poisoned = {
      WEBKIT_DISABLE_COMPOSITING_MODE: "1",
      GDK_BACKEND: "wayland",
      FULVID_KEEP_GDK_BACKEND: "1",
    };
    expect(linuxWebViewPaintEnv("darwin", poisoned)).toEqual({});
    expect(linuxWebViewPaintEnv("win32", poisoned)).toEqual({});
  });

  test("views:// profile defaults compositing disable and X11", () => {
    expect(linuxWebViewPaintEnv("linux", {})).toEqual({
      WEBKIT_DISABLE_COMPOSITING_MODE: "1",
      GDK_BACKEND: "x11",
    });
  });

  test("HMR profile forces X11 only and does not set compositing disable", () => {
    expect(linuxWebViewPaintEnv("linux", {}, { disableCompositing: false })).toEqual({
      GDK_BACKEND: "x11",
    });
  });

  test("respects an explicit compositing value on views://", () => {
    expect(
      linuxWebViewPaintEnv("linux", {
        WEBKIT_DISABLE_COMPOSITING_MODE: "0",
      }),
    ).toEqual({
      GDK_BACKEND: "x11",
    });
  });

  test("FULVID_KEEP_GDK_BACKEND skips GDK override", () => {
    expect(linuxWebViewPaintEnv("linux", { FULVID_KEEP_GDK_BACKEND: "1" })).toEqual({
      WEBKIT_DISABLE_COMPOSITING_MODE: "1",
    });
    expect(
      linuxWebViewPaintEnv(
        "linux",
        { FULVID_KEEP_GDK_BACKEND: "1" },
        { disableCompositing: false },
      ),
    ).toEqual({});
  });
});

describe("electrobunDevProcessEnv", () => {
  test("merges the paint profile into the process env on Linux only", () => {
    const base = {
      PATH: "/usr/bin",
      WEBKIT_DISABLE_COMPOSITING_MODE: "1",
      GDK_BACKEND: "wayland",
    };
    expect(electrobunDevProcessEnv("win32", base)).toEqual(base);
    expect(electrobunDevProcessEnv("darwin", base, { disableCompositing: false })).toEqual(base);
    expect(electrobunDevProcessEnv("linux", { PATH: "/bin" })).toMatchObject({
      PATH: "/bin",
      WEBKIT_DISABLE_COMPOSITING_MODE: "1",
      GDK_BACKEND: "x11",
    });
  });

  test("Linux HMR clears inherited WEBKIT_DISABLE_COMPOSITING_MODE", () => {
    const next = electrobunDevProcessEnv(
      "linux",
      {
        PATH: "/bin",
        WEBKIT_DISABLE_COMPOSITING_MODE: "1",
        GDK_BACKEND: "wayland",
      },
      { disableCompositing: false },
    );
    expect(next.PATH).toBe("/bin");
    expect(next.GDK_BACKEND).toBe("x11");
    expect(next.WEBKIT_DISABLE_COMPOSITING_MODE).toBeUndefined();
  });
});
