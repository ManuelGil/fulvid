/**
 * Visual decoration contract: closed style tokens remain generic host chips;
 * appearance paint is host-authored from validated colors (no guest CSS).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  cssClassForExtensionDecoration,
  ensureExtensionDecorationStyles,
  EXTENSION_DECORATION_OVERVIEW_HEX,
  monacoDecorationOptionsForExtensionStyle,
  monacoDecorationOptionsForRange,
} from "../../src/mainview/extensions/decorationCapability.ts";

const MONACO_HOST = join(
  import.meta.dir,
  "../../src/mainview/modules/editor/monaco/MonacoHost.vue",
);
const DECORATION_CAPABILITY = join(
  import.meta.dir,
  "../../src/mainview/extensions/decorationCapability.ts",
);

describe("extension decoration visual contract", () => {
  test("closed style tokens still map to host chips", () => {
    for (const style of ["info", "warn", "error"] as const) {
      const options = monacoDecorationOptionsForExtensionStyle(style);
      expect(options.inlineClassName).toBe(cssClassForExtensionDecoration(style));
      expect(options.overviewRulerColor).toBe(EXTENSION_DECORATION_OVERVIEW_HEX[style]);
    }
  });

  test("appearance ranges use distinct paint path from style tokens", () => {
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

  test("MonacoHost applies style + appearance ensure paths", () => {
    const source = readFileSync(MONACO_HOST, "utf8");
    expect(source).toContain("ensureExtensionDecorationStyles()");
    expect(source).toContain("ensureExtensionAppearanceStyles");
    expect(source).toContain("monacoDecorationOptionsForRange");
    const capability = readFileSync(DECORATION_CAPABILITY, "utf8");
    expect(capability).toContain("fulvid-extension-appearance-styles");
    expect(typeof ensureExtensionDecorationStyles).toBe("function");
  });
});
