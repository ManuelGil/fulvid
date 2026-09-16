/**
 * Ownership for extension decorations: packs pick colors; Fulvid paints safely.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  appearanceClassKey,
  cssClassForExtensionAppearance,
  cssClassForExtensionDecoration,
  ensureExtensionAppearanceStyles,
  EXTENSION_DECORATION_OVERVIEW_HEX,
  monacoDecorationOptionsForExtensionStyle,
  monacoDecorationOptionsForRange,
  parseDecorationAppearance,
  parseDecorationColor,
  parseExtensionDecorationRanges,
  resetExtensionAppearanceStylesForTests,
} from "../../src/mainview/extensions/decorationCapability.ts";

const DECORATION_CAPABILITY = join(
  import.meta.dir,
  "../../src/mainview/extensions/decorationCapability.ts",
);
const MONACO_HOST = join(
  import.meta.dir,
  "../../src/mainview/modules/editor/monaco/MonacoHost.vue",
);
const TODO_INIT = join(
  import.meta.dir,
  "../../../fulvid-extensions/extensions/imgildev.todo-decorator/init.lua",
);
const MDX_INIT = join(
  import.meta.dir,
  "../../../fulvid-extensions/extensions/imgildev.mdx-comments/init.lua",
);

describe("extension-owned decoration appearance", () => {
  test("packs own decoration colors; host has no product markers", () => {
    const capability = readFileSync(DECORATION_CAPABILITY, "utf8");
    const monacoHost = readFileSync(MONACO_HOST, "utf8");
    for (const source of [capability, monacoHost]) {
      expect(source).not.toMatch(/\bTODO\b/);
      expect(source).not.toMatch(/\bFIXME\b/);
      expect(source).not.toMatch(/\bBUG\b/);
      expect(source).not.toMatch(/\bHACK\b/);
      expect(source).not.toMatch(/\{\/\*/);
      expect(source).not.toMatch(/mdxComments/i);
      expect(source).not.toMatch(/Better Comments/i);
    }

    const todo = readFileSync(TODO_INIT, "utf8");
    expect(todo).toContain('word = "TODO"');
    expect(todo).toContain('backgroundColor = "#d29922"');
    expect(todo).toContain('word = "FIXME"');
    expect(todo).toContain('backgroundColor = "#ff7b72"');
    expect(todo).toContain("appearance =");
    expect(todo).not.toMatch(/style\s*=\s*"warn"/);

    const mdx = readFileSync(MDX_INIT, "utf8");
    expect(mdx).toContain('prefix = "!"');
    expect(mdx).toContain('backgroundColor = "#ff7b72"');
    expect(mdx).toContain('prefix = "?"');
    expect(mdx).toContain('backgroundColor = "#4a7fc4"');
    expect(mdx).toContain("appearance =");
    expect(mdx).not.toMatch(/style\s*=\s*"info"/);
  });

  test("accepts hex/rgba appearance and rejects CSS escape hatches", () => {
    expect(parseDecorationColor("#d29922")).toEqual({ ok: true, color: "#d29922" });
    expect(parseDecorationColor("rgba(255, 123, 114, 0.35)").ok).toBe(true);
    expect(parseDecorationColor("url(https://evil)").ok).toBe(false);
    expect(parseDecorationColor("red; } body {").ok).toBe(false);
    expect(parseDecorationColor("var(--warning-text)").ok).toBe(false);
    expect(parseDecorationAppearance({ backgroundColor: "#abc", bold: true }).ok).toBe(true);
    expect(
      parseDecorationAppearance({ backgroundColor: "#abc", color: "expression(alert(1))" }).ok,
    ).toBe(false);
  });

  test("ranges require exactly one of style or appearance", () => {
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

  test("appearance options map to distinct host-authored class names", () => {
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
  });

  test("closed style tokens map to host chips", () => {
    for (const style of ["info", "warn", "error"] as const) {
      const options = monacoDecorationOptionsForExtensionStyle(style);
      expect(options.inlineClassName).toBe(cssClassForExtensionDecoration(style));
      expect(options.overviewRulerColor).toBe(EXTENSION_DECORATION_OVERVIEW_HEX[style]);
    }
  });

  test("appearance paint path differs from style tokens", () => {
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
