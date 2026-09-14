import { afterEach, beforeEach, describe, expect, test } from "bun:test";

const store = new Map<string, string>();

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
  const module = await import(`../../../src/mainview/app/layoutStore?case=${Math.random()}`);
  return module as typeof import("../../../src/mainview/app/layoutStore");
}

beforeEach(() => {
  store.clear();
});

afterEach(() => {
  store.clear();
});

// Intent: persisted geometry stays safe at startup and within usable bounds.
describe("persisted layout", () => {
  test("corrupt or out-of-range layout degrades to usable defaults", async () => {
    const { layout: corrupt } = await loadLayout("{{{");
    expect(corrupt.value.sidebarWidth).toBe(252);
    expect(corrupt.value.previewRatio).toBeCloseTo(0.42);

    const { layout } = await loadLayout(
      JSON.stringify({
        sidebarWidth: 99999,
        inspectorWidth: -5,
        previewRatio: 12,
      }),
    );
    expect(layout.value.sidebarWidth).toBe(360);
    expect(layout.value.inspectorWidth).toBe(260);
    expect(layout.value.previewRatio).toBeCloseTo(0.65);
  });
});
