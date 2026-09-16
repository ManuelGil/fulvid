/**
 * Generic extension template.render contract - no ADR/product knowledge.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  EXTENSION_TEMPLATE_LIMITS,
  parseExtensionTemplateVariables,
  renderExtensionTemplate,
} from "../../src/bun/extensions/lua/extensionTemplateRender.ts";

const RENDER_MODULE = join(
  import.meta.dir,
  "../../src/bun/extensions/lua/extensionTemplateRender.ts",
);

describe("extension template.render", () => {
  test("interpolates string variables and leaves missing keys empty", () => {
    const rendered = renderExtensionTemplate("Hello {{name}} - {{missing}}!", {
      name: "world",
    });
    expect(rendered).toEqual({ ok: true, text: "Hello world - !" });
  });

  test("escapes HTML in values; rejects sections and unescaped syntax", () => {
    const escaped = renderExtensionTemplate("x={{v}}", { v: "<script>" });
    expect(escaped.ok).toBe(true);
    if (escaped.ok) {
      expect(escaped.text).toBe("x=&lt;script&gt;");
      expect(escaped.text).not.toContain("<script>");
    }
    expect(renderExtensionTemplate("{{#x}}y{{/x}}", { x: "1" }).ok).toBe(false);
    expect(renderExtensionTemplate("{{{raw}}}", { raw: "a" }).ok).toBe(false);
    expect(renderExtensionTemplate("{{&raw}}", { raw: "a" }).ok).toBe(false);
    expect(renderExtensionTemplate("{{>partial}}", {}).ok).toBe(false);
  });

  test("enforces variable and size bounds", () => {
    expect(parseExtensionTemplateVariables({ ok: true }).ok).toBe(false);
    expect(parseExtensionTemplateVariables({ "bad-key": "x" }).ok).toBe(false);
    expect(parseExtensionTemplateVariables({ nested: { a: "1" } }).ok).toBe(false);
    const tooMany: Record<string, string> = {};
    for (let i = 0; i < EXTENSION_TEMPLATE_LIMITS.maxVariables + 1; i += 1) {
      tooMany[`k${i}`] = "v";
    }
    expect(parseExtensionTemplateVariables(tooMany).ok).toBe(false);
    expect(
      renderExtensionTemplate("a".repeat(EXTENSION_TEMPLATE_LIMITS.maxTemplateChars + 1), {}).ok,
    ).toBe(false);
  });

  test("generic engine source has no ADR product knowledge", () => {
    const source = readFileSync(RENDER_MODULE, "utf8");
    expect(source).not.toMatch(/\bADR\b/);
    expect(source).not.toMatch(/fileNamePascalCase/);
    expect(source).not.toMatch(/timestampISO/);
    expect(source).not.toMatch(/getVariables/);
    expect(source).not.toMatch(/\bauthor\b/);
    expect(source).not.toMatch(/\blicense\b/);
  });
});
