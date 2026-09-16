import { describe, expect, test } from "bun:test";

import {
  appearanceDatasetFor,
  defaultSettings,
  patchSettings,
  resetSettingsToDefaults,
  sanitizeSettings,
  settings,
} from "../../../../src/mainview/modules/settings/settingsStore";

// Intent: persisted settings stay backward-compatible and fail-closed.
// Unknown product concepts (Context root, templates) must not hydrate.
describe("settings migration", () => {
  test("migrates legacy values, rejects unsupported enums, and resets to defaults", () => {
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
      workspace: { reopenLast: true },
      links: { syntaxes: ["wikilink"], resolution: "guess" },
      // Removed concepts must not reappear as live settings shape.
      templates: { meeting: true },
      contextRoot: "/notes",
      contextRoots: ["/notes"],
    });

    expect(next.locale).toBe("es");
    // Invalid theme falls back to the same first-run default (system), not an arbitrary skin.
    expect(next.appearance.theme).toBe("system");
    expect(next.editor.fontSize).toBe(14);
    expect(next.editor.defaultEol).toBe("lf");
    expect(next.workspace.workspaceStartup).toBe("last");
    expect(next.links.linkMode).toBe("wikilink");
    expect(next.links.resolution).toBe("both");
    expect(next).not.toHaveProperty("templates");
    expect(next).not.toHaveProperty("contextRoot");
    expect(next).not.toHaveProperty("contextRoots");
    expect(sanitizeSettings({ locale: "fr" }).locale).toBe("en");
    expect(sanitizeSettings({ appearance: { theme: "constructor" } }).appearance.theme).toBe(
      "system",
    );
    expect(sanitizeSettings({ appearance: { theme: "light" } }).appearance.theme).toBe("light");
    expect(sanitizeSettings({ appearance: { theme: "dark" } }).appearance.theme).toBe("dark");
    expect(appearanceDatasetFor(defaultSettings().appearance).theme).toBe("system");
    expect(sanitizeSettings({ editor: { defaultEol: "crlf" } }).editor.defaultEol).toBe("crlf");

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
});
