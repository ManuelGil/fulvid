/**
 * Tab identity for shortcut handlers.
 *
 * Some WebKit builds report Shift+Tab / Ctrl+Shift+Tab as
 * `key: "ISO_Left_Tab"` while `code` stays `"Tab"`. Matching only `"Tab"`
 * drops those chords; `code === "Tab"` covers layout-specific `key` values.
 */
export function isTabKey(event: Pick<KeyboardEvent, "key" | "code">): boolean {
  return event.key === "Tab" || event.key === "ISO_Left_Tab" || event.code === "Tab";
}
