import { afterEach, beforeEach, describe, expect, test } from "bun:test";

const store = new Map<string, string>();

// The layout store reads and writes localStorage at import time, so the stub
// has to exist before the module is loaded.
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
  clear: () => {
    store.clear();
  },
};

const STORAGE_KEY = "fulvid.layout.v1";

async function loadLayout(persisted: string | null) {
  store.clear();
  if (persisted !== null) {
    store.set(STORAGE_KEY, persisted);
  }
  // A fresh module instance per case, so each one reads its own state.
  const module = await import(`../../../src/mainview/app/layoutStore?case=${Math.random()}`);
  return module as typeof import("../../../src/mainview/app/layoutStore");
}

beforeEach(() => {
  store.clear();
});

afterEach(() => {
  store.clear();
});

// Intent: make persisted geometry safe at startup and within usable bounds.
// Growth boundary: add cases only for new fields or clamp rules.
describe("persisted layout", () => {
  test("unparseable state degrades to defaults instead of failing startup", async () => {
    for (const corrupt of ["{{{", "", "null", '"a string"', "[1,2,3]", "7"]) {
      const { layout } = await loadLayout(corrupt);

      expect(layout.value.sidebarWidth).toBe(252);
      expect(layout.value.previewRatio).toBeCloseTo(0.42);
      expect(layout.value.rightSidebar).toBeNull();
    }
  });

  test("out-of-range dimensions are clamped into usable limits", async () => {
    const { layout } = await loadLayout(
      JSON.stringify({
        sidebarWidth: 99999,
        inspectorWidth: -5,
        contextualWidth: Number.MAX_SAFE_INTEGER,
        previewRatio: 12,
      }),
    );

    expect(layout.value.sidebarWidth).toBe(360);
    expect(layout.value.inspectorWidth).toBe(260);
    expect(layout.value.contextualWidth).toBe(440);
    expect(layout.value.previewRatio).toBeCloseTo(0.65);
  });
});
