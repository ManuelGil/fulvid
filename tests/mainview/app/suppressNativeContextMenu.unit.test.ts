import { describe, expect, test } from "bun:test";

import { installNativeContextMenuSuppression } from "../../../src/mainview/app/suppressNativeContextMenu.ts";

describe("native context menu suppression", () => {
  test("cancels the default action without stopping other listeners", () => {
    const target = new EventTarget();
    let otherListenerSawEvent = false;
    const dispose = installNativeContextMenuSuppression(target);
    target.addEventListener("contextmenu", () => {
      otherListenerSawEvent = true;
    });

    const event = new Event("contextmenu", { cancelable: true, bubbles: true });
    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(otherListenerSawEvent).toBe(true);
    dispose();
  });
});
