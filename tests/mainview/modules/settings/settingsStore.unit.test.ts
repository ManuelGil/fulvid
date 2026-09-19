import { describe, expect, test } from "bun:test";

import {
  appearanceDatasetFor,
  defaultSettings,
  patchSettings,
  reloadSettings,
  resetSettingsToDefaults,
  sanitizeSettings,
  SETTINGS_STORAGE_KEY,
  settings,
} from "../../../../src/mainview/modules/settings/settingsStore";

const memoryStorage = new Map<string, string>();

function installMemoryLocalStorage(): void {
  (globalThis as { localStorage?: Storage }).localStorage = {
    get length() {
      return memoryStorage.size;
    },
    clear() {
      memoryStorage.clear();
    },
    getItem(key: string) {
      return memoryStorage.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      memoryStorage.set(key, value);
    },
    removeItem(key: string) {
      memoryStorage.delete(key);
    },
    key() {
      return null;
    },
  } as Storage;
}
// Intent: persisted settings fail closed. Unknown concepts must not hydrate.
describe("settings sanitize", () => {
  test("accepts current fields, rejects unsupported enums, and resets to defaults", () => {
    expect(defaultSettings().appearance.theme).toBe("system");
    expect(sanitizeSettings({}).appearance.theme).toBe("system");

    const next = sanitizeSettings({
      locale: "es",
      appearance: {
        theme: "not-a-theme",
        interfaceTextScale: "huge",
        reducedMotion: "yes",
      },
      editor: {
        fontSize: "big",
        tabSize: 3,
        defaultEol: "native",
      },
      // Unknown / retired shapes must not become live settings.
      workspace: { reopenLast: true },
      links: { syntaxes: ["wikilink"], resolution: "guess" },
      templates: { meeting: true },
      contextRoot: "/notes",
      contextRoots: ["/notes"],
    });

    expect(next.locale).toBe("es");
    // Invalid theme falls back to the same first-run default (system), not an arbitrary skin.
    expect(next.appearance.theme).toBe("system");
    expect(next.editor.fontSize).toBe(14);
    expect(next.editor.defaultEol).toBe("lf");
    // Unknown workspace/link keys are ignored; current defaults apply.
    expect(next.workspace.workspaceStartup).toBe("none");
    expect(next.links.linkMode).toBe("markdown");
    expect(next.links.resolution).toBe("both");
    expect(next).not.toHaveProperty("templates");
    expect(next).not.toHaveProperty("contextRoot");
    expect(next).not.toHaveProperty("contextRoots");
    expect(sanitizeSettings({ locale: "ja" }).locale).toBe("en");
    expect(sanitizeSettings({ appearance: { theme: "constructor" } }).appearance.theme).toBe(
      "system",
    );
    expect(sanitizeSettings({ appearance: { theme: "light" } }).appearance.theme).toBe("light");
    expect(sanitizeSettings({ appearance: { theme: "dark" } }).appearance.theme).toBe("dark");
    expect(
      sanitizeSettings({
        workspace: { workspaceStartup: "last" },
        links: { linkMode: "wikilink" },
      }).workspace.workspaceStartup,
    ).toBe("last");
    expect(
      sanitizeSettings({
        workspace: { workspaceStartup: "last" },
        links: { linkMode: "wikilink" },
      }).links.linkMode,
    ).toBe("wikilink");
    expect(appearanceDatasetFor(defaultSettings().appearance).theme).toBe("system");
    expect(sanitizeSettings({ editor: { defaultEol: "crlf" } }).editor.defaultEol).toBe("crlf");
    expect(defaultSettings().editor.showSessionChanges).toBe(true);
    expect(
      sanitizeSettings({ editor: { showSessionChanges: false } }).editor.showSessionChanges,
    ).toBe(false);
    expect(
      sanitizeSettings({
        editor: { showSessionChangePreview: false },
      }).editor.showSessionChanges,
    ).toBe(false);
    expect(
      sanitizeSettings({
        editor: { showSessionChanges: true, showSessionChangePreview: false },
      }).editor.showSessionChanges,
    ).toBe(true);
    expect(
      sanitizeSettings({
        editor: { showSessionChangePreview: false },
      }).editor,
    ).not.toHaveProperty("showSessionChangePreview");

    const beforeJson = JSON.stringify(settings.value);
    try {
      patchSettings({
        locale: "es",
        editor: {
          ...settings.value.editor,
          documentLocation: "window-title",
          typewriterScrolling: false,
        },
      });
      resetSettingsToDefaults();
      expect(settings.value).toEqual(defaultSettings());
      expect(settings.value).toEqual(sanitizeSettings({}));
    } finally {
      settings.value = sanitizeSettings(JSON.parse(beforeJson));
    }
  });

  test("corrupt settings JSON heals storage to defaults on reload", () => {
    installMemoryLocalStorage();
    memoryStorage.clear();
    const before = JSON.parse(JSON.stringify(settings.value)) as ReturnType<typeof defaultSettings>;
    try {
      memoryStorage.set(SETTINGS_STORAGE_KEY, "{not-json");
      reloadSettings();
      expect(settings.value).toEqual(defaultSettings());
      expect(JSON.parse(memoryStorage.get(SETTINGS_STORAGE_KEY) ?? "null")).toEqual(
        defaultSettings(),
      );
    } finally {
      memoryStorage.clear();
      settings.value = before;
    }
  });
});
