/**
 * Map Fulvid editor settings onto Monaco option names.
 *
 * This is a translation layer, not a second settings store.
 */
import type { EditorSettings } from "../../settings/settingsStore";

const FONT_FAMILY_STACKS = {
  monospace: 'ui-monospace, "SFMono-Regular", "Cascadia Mono", Menlo, Consolas, monospace',
  system: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
} as const;

function lineHeightFor(fontSize: number, preference: EditorSettings["lineHeight"]): number {
  if (preference === "compact") {
    return Math.round(fontSize * 1.35);
  }
  if (preference === "comfortable") {
    return Math.round(fontSize * 1.55);
  }
  return 0;
}

export type MonacoEditorPreferences = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  tabSize: EditorSettings["tabSize"];
  insertSpaces: boolean;
  wordWrap: EditorSettings["wordWrap"];
  wordWrapColumn: 100;
  wrappingIndent: "same";
  autoIndent: "full" | "none";
  autoIndentOnPaste: boolean;
  lineNumbers: "on" | "off";
  minimap: { enabled: boolean };
  renderWhitespace: EditorSettings["renderWhitespace"];
  stickyScroll: {
    enabled: boolean;
    defaultModel: "outlineModel";
    maxLineCount: 4;
  };
};

/**
 * Translate editor settings into Monaco `updateOptions`.
 *
 * `autoIndent` is Monaco indent-on-enter/paste. It does not gate Fulvid's
 * list/quote/fence/table continuation (`markdownEnter`), which stays on.
 * Writing Focus overlays minimap, sticky scroll, and typewriter separately.
 */
export function monacoEditorPreferences(editorSettings: EditorSettings): MonacoEditorPreferences {
  return {
    fontFamily: FONT_FAMILY_STACKS[editorSettings.fontFamily],
    fontSize: editorSettings.fontSize,
    lineHeight: lineHeightFor(editorSettings.fontSize, editorSettings.lineHeight),
    tabSize: editorSettings.tabSize,
    insertSpaces: editorSettings.insertSpaces,
    wordWrap: editorSettings.wordWrap,
    wordWrapColumn: 100,
    wrappingIndent: "same",
    autoIndent: editorSettings.autoIndent ? "full" : "none",
    autoIndentOnPaste: editorSettings.autoIndent,
    lineNumbers: editorSettings.lineNumbers ? "on" : "off",
    minimap: { enabled: editorSettings.minimap },
    renderWhitespace: editorSettings.renderWhitespace,
    stickyScroll: {
      enabled: editorSettings.stickyScroll,
      defaultModel: "outlineModel",
      maxLineCount: 4,
    },
  };
}
