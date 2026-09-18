import { describe, expect, test } from "bun:test";

import {
  SETTINGS_SEARCH_ENTRIES,
  matchSettingsSearch,
  type SettingsSearchEntry,
} from "../../../../src/mainview/modules/settings/settingsSearch";
import { defaultSettings } from "../../../../src/mainview/modules/settings/settingsStore";

const EN: Record<string, string> = {
  "settings.editorDisplay": "Editor display",
  "settings.themeCategory": "Theme",
  "settings.preview": "Preview",
  "settings.accessibility": "Accessibility",
  "settings.keyboard": "Keyboard shortcuts",
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
};

function translateWith(catalog: Record<string, string>): (key: string) => string {
  return (key) => catalog[key] ?? key;
}

// Intent: Settings Search projects static preference metadata in the active locale.
// Growth boundary: one semantic test - quiet empty query, locale hits, label>hint rank.
describe("settings search", () => {
  test("matches locale preference text without inventing settings; labels outrank hints", () => {
    const before = structuredClone(defaultSettings());

    expect(matchSettingsSearch("", translateWith(EN))).toEqual([]);
    expect(matchSettingsSearch("zz-no-such-setting", translateWith(EN))).toEqual([]);

    const byLabel = matchSettingsSearch("minimap", translateWith(EN));
    expect(byLabel.map((hit) => hit.id)).toEqual(["editor.minimap"]);
    expect(byLabel[0]).toMatchObject({
      category: "editorDisplay",
      label: "Minimap",
      categoryLabel: "Editor display",
    });
    expect(matchSettingsSearch("minimapa", translateWith(ES)).map((hit) => hit.id)).toEqual([
      "editor.minimap",
    ]);

    const rankingEntries: SettingsSearchEntry[] = [
      {
        id: "hint-only",
        category: "theme",
        labelKey: "settings.theme",
        hintKey: "settings.editorMinimapHint",
      },
      {
        id: "label-hit",
        category: "editorDisplay",
        labelKey: "settings.editorMinimap",
        hintKey: "settings.themeHint",
      },
    ];
    expect(
      matchSettingsSearch("miniature", translateWith(EN), rankingEntries).map((hit) => hit.id),
    ).toEqual(["hint-only"]);
    expect(
      matchSettingsSearch("minimap", translateWith(EN), rankingEntries).map((hit) => hit.id),
    ).toEqual(["label-hit"]);

    expect(new Set(SETTINGS_SEARCH_ENTRIES.map((entry) => entry.id)).size).toBe(
      SETTINGS_SEARCH_ENTRIES.length,
    );
    expect(defaultSettings()).toEqual(before);
  });
});
