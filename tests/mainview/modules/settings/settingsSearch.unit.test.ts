import { describe, expect, test } from "bun:test";

import {
  SETTINGS_SEARCH_ENTRIES,
  matchSettingsSearch,
  type SettingsSearchEntry,
} from "../../../../src/mainview/modules/settings/settingsSearch";
import { defaultSettings } from "../../../../src/mainview/modules/settings/settingsStore";

const EN: Record<string, string> = {
  "settings.general": "General",
  "settings.editor": "Editor",
  "settings.appearance": "Appearance",
  "settings.markdown": "Markdown",
  "settings.preview": "Preview",
  "settings.workspace": "Folder",
  "settings.accessibility": "Accessibility",
  "settings.keyboard": "Keyboard",
  "settings.editorMinimap": "Minimap",
  "settings.editorMinimapHint":
    "A miniature map of the file beside the editor. Hidden automatically while Writing Focus is on.",
  "settings.locale": "Language",
  "settings.localeHint": "Changes Fulvid's menus, Settings, and messages right away.",
  "settings.theme": "Theme",
  "settings.themeHint": "Windows, menus, and the editor change together.",
  "settings.showPreview": "Show Markdown preview",
  "settings.showPreviewHint": "Show a formatted preview beside the editor.",
};

const ES: Record<string, string> = {
  ...EN,
  "settings.editorMinimap": "Minimapa",
  "settings.editorMinimapHint":
    "Un mapa miniatura del archivo junto al editor. Se oculta automáticamente con Enfoque de escritura.",
  "settings.locale": "Idioma",
};

function translateWith(catalog: Record<string, string>): (key: string) => string {
  return (key) => catalog[key] ?? key;
}

// Intent: Settings Search is a local projection over static preference metadata.
// It must not invent preference values or depend on Global Search / filesystem.
describe("settings search", () => {
  test("empty query stays quiet; matches use locale strings; order is deterministic", () => {
    const before = structuredClone(defaultSettings());

    expect(matchSettingsSearch("", translateWith(EN))).toEqual([]);
    expect(matchSettingsSearch("   ", translateWith(EN))).toEqual([]);
    expect(matchSettingsSearch("zz-no-such-setting", translateWith(EN))).toEqual([]);

    const byLabel = matchSettingsSearch("minimap", translateWith(EN));
    expect(byLabel.map((hit) => hit.id)).toEqual(["editor.minimap"]);
    expect(byLabel[0]).toMatchObject({
      category: "editor",
      label: "Minimap",
      categoryLabel: "Editor",
    });

    expect(
      matchSettingsSearch("miniature map", translateWith(EN)).some(
        (hit) => hit.id === "editor.minimap",
      ),
    ).toBe(true);

    expect(matchSettingsSearch("minimapa", translateWith(ES)).map((hit) => hit.id)).toEqual([
      "editor.minimap",
    ]);

    const first = matchSettingsSearch("preview", translateWith(EN)).map((hit) => hit.id);
    const second = matchSettingsSearch("preview", translateWith(EN)).map((hit) => hit.id);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);

    expect(new Set(SETTINGS_SEARCH_ENTRIES.map((entry) => entry.id)).size).toBe(
      SETTINGS_SEARCH_ENTRIES.length,
    );
    expect(defaultSettings()).toEqual(before);
  });

  test("label matches outrank hint matches", () => {
    const entries: SettingsSearchEntry[] = [
      {
        id: "hint-only",
        category: "appearance",
        labelKey: "settings.theme",
        hintKey: "settings.editorMinimapHint",
      },
      {
        id: "label-hit",
        category: "editor",
        labelKey: "settings.editorMinimap",
        hintKey: "settings.themeHint",
      },
    ];

    // Hint contains "miniature map"; label is exactly "Minimap".
    expect(
      matchSettingsSearch("miniature", translateWith(EN), entries).map((hit) => hit.id),
    ).toEqual(["hint-only"]);
    expect(matchSettingsSearch("minimap", translateWith(EN), entries).map((hit) => hit.id)).toEqual(
      ["label-hit"],
    );
  });
});
