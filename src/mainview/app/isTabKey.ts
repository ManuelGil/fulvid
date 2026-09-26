/**
 * Tab identity for shortcut handlers.
 *
 * On Linux/X11 (and some WebKitGTK builds), Shift+Tab / Ctrl+Shift+Tab is
 * reported as `key: "ISO_Left_Tab"` while `code` stays `"Tab"`. Ctrl+Tab still
 * uses `key: "Tab"`. Matching only `"Tab"` drops Ctrl/Cmd+Shift+Tab.
 */
export function isTabKey(event: Pick<KeyboardEvent, "key" | "code">): boolean {
  return event.key === "Tab" || event.key === "ISO_Left_Tab" || event.code === "Tab";
}
