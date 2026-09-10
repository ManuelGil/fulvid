import { describe, expect, test } from "bun:test";

import { sanitizeSettings } from "../../../../src/mainview/modules/settings/settingsStore";

// Intent: keep persisted settings backward-compatible and fail-closed per field.
// Growth boundary: add cases only for migrations or new validation domains.
describe("settings migration", () => {
  test("migrates a single legacy link syntax and startup preference", () => {
    const settings = sanitizeSettings({
      workspace: { reopenLast: true },
      links: { syntaxes: ["wikilink"] },
    });

    expect(settings.links.linkMode).toBe("wikilink");
    expect(settings.workspace.workspaceStartup).toBe("last");
    expect(settings.links.defaultExtension).toBe("mdx");
  });

  test("keeps the valid parts of a partly corrupt file", () => {
    const settings = sanitizeSettings({
      locale: "es",
      appearance: {
        theme: "not-a-theme",
        interfaceTextScale: "huge",
        iconScale: 2,
        density: "tight",
        reducedMotion: "yes",
      },
      editor: {
        fontSize: "big",
        fontFamily: "comic-sans",
        lineHeight: "huge",
        tabSize: 3,
        insertSpaces: "yes",
        wordWrap: "always",
        autoIndent: "sometimes",
        lineNumbers: "yes",
        minimap: "always",
        stickyScroll: 1,
        renderWhitespace: "boundary",
      },
      workspace: { showHiddenFiles: 1, workspaceStartup: "always" },
      links: { linkMode: "wikilink", resolution: "guess", defaultExtension: "exe" },
    });

    // The value that made sense is kept; each invalid one falls back alone.
    expect(settings.locale).toBe("es");
    expect(settings.links.linkMode).toBe("wikilink");
    expect(settings.appearance.theme).toBe("dark");
    expect(settings.appearance.interfaceTextScale).toBe("normal");
    expect(settings.appearance.iconScale).toBe("normal");
    expect(settings.appearance.density).toBe("normal");
    expect(settings.appearance.reducedMotion).toBe(false);
    expect(settings.editor.fontSize).toBe(14);
    expect(settings.editor.fontFamily).toBe("monospace");
    expect(settings.editor.lineHeight).toBe("auto");
    expect(settings.editor.tabSize).toBe(2);
    expect(settings.editor.insertSpaces).toBe(true);
    expect(settings.editor.wordWrap).toBe("on");
    expect(settings.editor.autoIndent).toBe(true);
    expect(settings.editor.lineNumbers).toBe(true);
    expect(settings.editor.minimap).toBe(false);
    expect(settings.editor.stickyScroll).toBe(true);
    expect(settings.editor.renderWhitespace).toBe("selection");
    expect(settings.editor.readingStatistics).toBe("wordsAndTime");
    expect(settings.editor.typewriterScrolling).toBe(true);
    expect(settings.workspace.workspaceStartup).toBe("none");
    expect(settings.links.resolution).toBe("both");
    expect(settings.links.defaultExtension).toBe("mdx");
    expect(settings.links.showIncomingLinks).toBe(true);
    expect(settings.links.showOutgoingLinks).toBe(true);
  });

  test("never accepts a locale or theme outside the supported set", () => {
    // Persisted state must not be able to select something the app cannot run.
    expect(sanitizeSettings({ locale: "fr" }).locale).toBe("en");
    expect(sanitizeSettings({ locale: "__proto__" }).locale).toBe("en");
    expect(sanitizeSettings({ appearance: { theme: "constructor" } }).appearance.theme).toBe(
      "dark",
    );
    expect(sanitizeSettings({ appearance: { theme: "high-contrast-dark" } }).appearance.theme).toBe(
      "high-contrast-dark",
    );
  });

  test("defaults unknown fields and migrates the legacy reading indicator", () => {
    const defaults = sanitizeSettings({});
    expect(defaults.editor.readingStatistics).toBe("wordsAndTime");
    expect(defaults.editor.typewriterScrolling).toBe(true);
    expect(defaults.links.showIncomingLinks).toBe(true);
    expect(defaults).not.toHaveProperty("templates");
    expect(
      sanitizeSettings({ editor: { readingStatistics: "wpm" } }).editor.readingStatistics,
    ).toBe("wordsAndTime");

    const honored = sanitizeSettings({
      editor: { readingStatistics: "words", typewriterScrolling: false },
      links: { showIncomingLinks: false, showOutgoingLinks: false },
    });
    expect(honored.editor.readingStatistics).toBe("words");
    expect(honored.editor.typewriterScrolling).toBe(false);
    expect(honored.links.showIncomingLinks).toBe(false);

    const legacy = sanitizeSettings({
      appearance: { statusbar: { indicators: { reading: false } } },
    });
    expect(legacy.editor.readingStatistics).toBe("off");
    expect(
      (legacy.appearance.statusbar.indicators as { reading?: boolean }).reading,
    ).toBeUndefined();
  });
});
