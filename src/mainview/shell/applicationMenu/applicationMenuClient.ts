import { ref } from "vue";

import { desktopRequest } from "../../desktop/electrobunClient";
import type { ApplicationMenuSupport } from "../../desktop/desktopRpc";
import type { PresentedMenuBar } from "./applicationMenuModel";
import { toNativeApplicationMenu } from "./applicationMenuNative";

/** Host-reported support. `null` until the host answers; do not show HTML yet. */
export const applicationMenuSupport = ref<ApplicationMenuSupport | null>(null);

export function usesNativeApplicationMenu(): boolean {
  return applicationMenuSupport.value?.native === true;
}

/** HTML menubar when the host reports no native Application Menu. */
export function usesHtmlApplicationMenuFallback(): boolean {
  return applicationMenuSupport.value?.native === false;
}

export async function resolveApplicationMenuSupport(): Promise<ApplicationMenuSupport> {
  try {
    const support = await desktopRequest().getApplicationMenuSupport({});
    applicationMenuSupport.value = support;
    return support;
  } catch {
    const support: ApplicationMenuSupport = {
      native: false,
      platform: "other",
      fallbackReason: "rpc-unavailable",
    };
    applicationMenuSupport.value = support;
    return support;
  }
}

export async function syncNativeApplicationMenu(menus: readonly PresentedMenuBar[]): Promise<void> {
  if (!usesNativeApplicationMenu()) {
    return;
  }
  await desktopRequest().setApplicationMenu({
    items: toNativeApplicationMenu(menus),
  });
}

export async function quitApplication(): Promise<void> {
  await desktopRequest().quitApplication({});
}
