import { afterEach, describe, expect, test } from "bun:test";

import {
  activeToastTimerCount,
  dismissToast,
  notify,
  toasts,
} from "../../../src/mainview/app/notify.ts";

afterEach(() => {
  for (const toast of [...toasts.value]) {
    dismissToast(toast.id);
  }
});

// Intent: visible toasts stay capped and overflow must not leave orphan timers.
describe("session toasts", () => {
  test("notify burst keeps at most three visible toasts and three live timers", () => {
    for (let index = 0; index < 10; index += 1) {
      notify(`message-${index}`, { ms: 60_000 });
    }
    expect(toasts.value).toHaveLength(3);
    expect(toasts.value.map((toast) => toast.message)).toEqual([
      "message-7",
      "message-8",
      "message-9",
    ]);
    expect(activeToastTimerCount()).toBe(3);
  });
});
