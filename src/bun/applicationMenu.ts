/**
 * Host-side Application Menu: apply a renderer-built tree and forward clicks.
 */
import { ApplicationMenu, Utils } from "electrobun/main";

import {
  electrobunApplicationMenuFallbackReason,
  electrobunNativeApplicationMenuSupported,
} from "../mainview/desktop/electrobunApplicationMenu";
import type {
  ApplicationMenuSupport,
  DesktopPlatform,
  SerializableMenuItem,
} from "../mainview/desktop/desktopRpc";

type MenuClickPayload = { action?: string; data?: { action?: string } };

function desktopPlatform(): DesktopPlatform {
  if (
    process.platform === "darwin" ||
    process.platform === "win32" ||
    process.platform === "linux"
  ) {
    return process.platform;
  }
  return "other";
}

export function applicationMenuSupport(): ApplicationMenuSupport {
  const platform = desktopPlatform();
  const native = electrobunNativeApplicationMenuSupported(platform);
  return {
    native,
    platform,
    fallbackReason: native ? undefined : electrobunApplicationMenuFallbackReason(platform),
  };
}

export function installNativeApplicationMenu(sendClick: (action: string) => void): void {
  // Registers the click handler on every OS. Electrobun 2.0.1 only draws a
  // native bar on macOS and Windows; Linux is a documented no-op
  // (electrobunApplicationMenu.ts).
  // Placeholder until the renderer syncs the real menu. Do not use role
  // "quit" here - that would bypass the renderer's dirty-document guard.
  ApplicationMenu.setApplicationMenu([
    {
      label: "Fulvid",
      submenu: [{ label: "Fulvid", action: "openAbout" }],
    },
  ]);
  ApplicationMenu.on("application-menu-clicked", (event: unknown) => {
    const action = menuClickAction(event);
    if (action) {
      sendClick(action);
    }
  });
}

export function setNativeApplicationMenu(items: SerializableMenuItem[]): boolean {
  ApplicationMenu.setApplicationMenu(items);
  return true;
}

export function quitApplication(): boolean {
  return Utils.quit();
}

function menuClickAction(event: unknown): string | null {
  if (!event || typeof event !== "object") {
    return null;
  }
  const payload = event as MenuClickPayload;
  const action = payload.action ?? payload.data?.action;
  return typeof action === "string" && action.length > 0 ? action : null;
}
