/** Settings categories in navigation order, with their label keys. */
export const SETTINGS_CATEGORIES = [
  { id: "language", label: "settings.language" },
  { id: "editorText", label: "settings.editorText" },
  { id: "editing", label: "settings.editing" },
  { id: "files", label: "settings.files" },
  { id: "editorDisplay", label: "settings.editorDisplay" },
  { id: "writing", label: "settings.writing" },
  { id: "theme", label: "settings.themeCategory" },
  { id: "interface", label: "settings.interface" },
  { id: "accessibility", label: "settings.accessibility" },
  { id: "statusbar", label: "settings.statusbar" },
  { id: "folder", label: "settings.folder" },
  { id: "links", label: "settings.links" },
  { id: "context", label: "settings.context" },
  { id: "preview", label: "settings.preview" },
  { id: "extensions", label: "settings.extensions" },
  { id: "keyboard", label: "settings.keyboard" },
  { id: "about", label: "settings.about" },
] as const;

export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number]["id"];

/**
 * Arrow-key delta for the Settings category tablist.
 * Compact layout is a 2-column CSS grid with full-width group labels, so
 * index+/-2 does not match visual neighbors - keep linear movement.
 */
export function settingsCategoryNavDelta(key: string, compact: boolean): number {
  if (compact) {
    if (key === "ArrowRight" || key === "ArrowDown") {
      return 1;
    }
    if (key === "ArrowLeft" || key === "ArrowUp") {
      return -1;
    }
    return 0;
  }
  if (key === "ArrowDown") {
    return 1;
  }
  if (key === "ArrowUp") {
    return -1;
  }
  return 0;
}
