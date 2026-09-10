import type { SerializableMenuItem } from "../../desktop/desktopRpc";
import type { PresentedMenuBar, PresentedMenuItem } from "./applicationMenuModel";

export function toNativeApplicationMenu(
  menus: readonly PresentedMenuBar[],
): SerializableMenuItem[] {
  return menus.map((menu) => ({
    label: menu.label,
    submenu: toNativeItems(menu.items),
  }));
}

function toNativeItems(items: readonly PresentedMenuItem[]): SerializableMenuItem[] {
  return items.map((item) => {
    if (item.type === "separator") {
      return { type: "separator" };
    }
    if (item.type === "submenu") {
      return {
        label: item.label,
        submenu: toNativeItems(item.items),
      };
    }
    if (item.type === "role") {
      return {
        label: item.label,
        role: item.role,
        enabled: item.enabled,
      };
    }
    return {
      label: item.label,
      action: item.id,
      enabled: item.enabled,
      checked: item.checked,
      accelerator: item.accelerator,
    };
  });
}
