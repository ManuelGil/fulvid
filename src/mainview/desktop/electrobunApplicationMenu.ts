/**
 * Native Application Menu: macOS and Windows only in Electrobun 2.0.1,
 * matching Electrobun's current public docs. This is not unfinished Fulvid
 * wiring. Fulvid already calls `setApplicationMenu` on every platform.
 *
 * On Linux the FFI is a no-op; Fulvid shows the HTML menubar instead. Do not
 * treat the symbol existing as support.
 *
 * Revisit after an Electrobun upgrade that documents Linux ApplicationMenu:
 * test a packaged GTK/WebKitGTK build, then enable linux here only if a real
 * menu bar appears. Enabling the flag without that hides the HTML bar with
 * nothing native; leaving it false after native menus land can show both the
 * install stub and the HTML bar.
 */
import type { ApplicationMenuFallbackReason, DesktopPlatform } from "./desktopRpc";

export const ELECTROBUN_LINUX_APPLICATION_MENU_UNWIRED = "electrobun-2.0.1-linux-unwired" as const;

export function electrobunNativeApplicationMenuSupported(platform: DesktopPlatform): boolean {
  return platform === "darwin" || platform === "win32";
}

export function electrobunApplicationMenuFallbackReason(
  platform: DesktopPlatform,
): ApplicationMenuFallbackReason | undefined {
  if (electrobunNativeApplicationMenuSupported(platform)) {
    return undefined;
  }
  if (platform === "linux") {
    return ELECTROBUN_LINUX_APPLICATION_MENU_UNWIRED;
  }
  return "rpc-unavailable";
}
