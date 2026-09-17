/**
 * Ownership for extension decorations: packs pick colors; Fulvid paints safely.
 */
import { describe, expect, test } from "bun:test";

import {
  appearanceClassKey,
  cssClassForExtensionAppearance,
  cssClassForExtensionDecoration,
  ensureExtensionAppearanceStyles,
  EXTENSION_DECORATION_OVERVIEW_HEX,
  monacoDecorationOptionsForRange,
  parseDecorationAppearance,
  parseDecorationColor,
  parseExtensionDecorationRanges,
  resetExtensionAppearanceStylesForTests,
} from "../../src/mainview/extensions/decorationCapability.ts";

describe("extension-owned decoration appearance", () => {
  test("rejects CSS escapes; ranges require style XOR appearance", () => {
    expect(parseDecorationColor("#d29922")).toEqual({ ok: true, color: "#d29922" });
    expect(parseDecorationColor("rgba(255, 123, 114, 0.35)").ok).toBe(true);
    expect(parseDecorationColor("url(https://evil)").ok).toBe(false);
    expect(parseDecorationColor("red; } body {").ok).toBe(false);
    expect(parseDecorationColor("var(--warning-text)").ok).toBe(false);
    expect(parseDecorationAppearance({ backgroundColor: "#abc", bold: true }).ok).toBe(true);
    expect(
      parseDecorationAppearance({ backgroundColor: "#abc", color: "expression(alert(1))" }).ok,
    ).toBe(false);

    expect(
      parseExtensionDecorationRanges([
        { startLine: 1, startColumn: 1, endLine: 1, endColumn: 4, style: "warn" },
      ]).ok,
    ).toBe(true);
    expect(
      parseExtensionDecorationRanges([
        {
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: 4,
          appearance: { backgroundColor: "#d29922" },
        },
      ]).ok,
    ).toBe(true);
    expect(
      parseExtensionDecorationRanges([
        {
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: 4,
          style: "warn",
          appearance: { backgroundColor: "#d29922" },
        },
      ]).ok,
    ).toBe(false);
    expect(
      parseExtensionDecorationRanges([{ startLine: 1, startColumn: 1, endLine: 1, endColumn: 4 }])
        .ok,
    ).toBe(false);
  });

  test("appearance and closed styles map to distinct host class names", () => {
    resetExtensionAppearanceStylesForTests();
    const gold = {
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 5,
      appearance: { backgroundColor: "#d29922", color: "#0d1117", bold: true, glyph: true },
    } as const;
    const coral = {
      startLine: 2,
      startColumn: 1,
      endLine: 2,
      endColumn: 6,
      appearance: { backgroundColor: "#ff7b72", color: "#0d1117", bold: true, glyph: true },
    } as const;
    const goldOpts = monacoDecorationOptionsForRange(gold);
    const coralOpts = monacoDecorationOptionsForRange(coral);
    expect(goldOpts.inlineClassName).toBe(cssClassForExtensionAppearance(gold.appearance));
    expect(coralOpts.inlineClassName).toBe(cssClassForExtensionAppearance(coral.appearance));
    expect(goldOpts.inlineClassName).not.toBe(coralOpts.inlineClassName);
    expect(appearanceClassKey(gold.appearance)).not.toBe(appearanceClassKey(coral.appearance));
    expect(goldOpts.overviewRulerColor).toBe("#d29922");
    expect(coralOpts.overviewRulerColor).toBe("#ff7b72");

    if (typeof document !== "undefined") {
      ensureExtensionAppearanceStyles(gold.appearance);
      ensureExtensionAppearanceStyles(coral.appearance);
      const sheet = document.getElementById("fulvid-extension-appearance-styles");
      expect(sheet?.textContent).toContain("#d29922");
      expect(sheet?.textContent).toContain("#ff7b72");
      expect(sheet?.textContent).not.toContain("url(");
    }

    for (const style of ["info", "warn", "error"] as const) {
      const options = monacoDecorationOptionsForRange({
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 4,
        style,
      });
      expect(options.inlineClassName).toBe(cssClassForExtensionDecoration(style));
      expect(options.overviewRulerColor).toBe(EXTENSION_DECORATION_OVERVIEW_HEX[style]);
    }

    const styled = monacoDecorationOptionsForRange({
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 4,
      style: "warn",
    });
    const owned = monacoDecorationOptionsForRange({
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 4,
      appearance: { backgroundColor: "#d29922", color: "#0d1117", bold: true },
    });
    expect(styled.inlineClassName.startsWith("fulvid-ext-decoration-")).toBe(true);
    expect(owned.inlineClassName.startsWith("fulvid-ext-a-")).toBe(true);
    expect(owned.overviewRulerColor).toBe("#d29922");
  });
});
