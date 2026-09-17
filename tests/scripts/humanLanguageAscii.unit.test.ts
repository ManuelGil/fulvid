/**
 * Human-language / ASCII contract for repository-controlled text.
 *
 * Ambiguous Unicode symbols (arrows, math relations, typographic dashes,
 * decorative status marks) must not appear in product/docs/scripts source.
 * Spanish letters and inverted punctuation stay in the Spanish catalog and
 * i18n policy docs. Unicode letters may appear in tests that exercise paths
 * or localization.
 *
 * This file stays ASCII aside from \\u escapes that name the forbidden set.
 */
import { describe, expect, test } from "bun:test";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "../..");

// Built from code points so this audit file does not embed the symbols.
const FORBIDDEN_SYMBOL = new RegExp(
  "[" +
    [
      0x2192,
      0x2190,
      0x2194,
      0x2191,
      0x2193,
      0x21d2,
      0x21d0,
      0x21c4,
      0x21b3,
      0x21b5, // arrows
      0x2260,
      0x2264,
      0x2265,
      0x00b1,
      0x00d7,
      0x00f7,
      0x2248,
      0x221e, // math
      0x2026,
      0x2014,
      0x2013,
      0x201c,
      0x201d,
      0x2018,
      0x2019,
      0x00ab,
      0x00bb,
      0x2022, // typography
      0x2713,
      0x2717,
      0x2714,
      0x2718,
      0x26a0,
      0x2605,
      0x2606, // status
      0x25cf,
      0x25cb,
      0x25c6,
      0x25c7,
      0x25b8,
      0x25be, // shapes
      0x2318,
      0x2325,
      0x2303,
      0x21e7, // modifier glyphs
    ]
      .map((code) => String.fromCodePoint(code))
      .join("") +
    "]",
  "u",
);

const SPANISH_LETTER = new RegExp(
  "[" +
    [
      0x00e1, 0x00e9, 0x00ed, 0x00f3, 0x00fa, 0x00f1, 0x00fc, 0x00c1, 0x00c9, 0x00cd, 0x00d3,
      0x00da, 0x00d1, 0x00dc, 0x00bf, 0x00a1,
    ]
      .map((code) => String.fromCodePoint(code))
      .join("") +
    "]",
  "u",
);

const SCAN_ROOTS = ["src", "tests", "docs", "scripts", "packaging", ".github"] as const;

const ROOT_FILES = [
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "package.json",
  "electrobun.config.ts",
] as const;

const ALLOWED_SUFFIX = new Set([
  ".ts",
  ".vue",
  ".scss",
  ".css",
  ".html",
  ".md",
  ".json",
  ".yml",
  ".yaml",
  ".desktop",
  ".sh",
  ".txt",
]);

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }
      files.push(...(await listFiles(path)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const dot = entry.name.lastIndexOf(".");
    const suffix = dot >= 0 ? entry.name.slice(dot) : "";
    if (ALLOWED_SUFFIX.has(suffix)) {
      files.push(path);
    }
  }
  return files;
}

function allowNonAscii(relativePath: string, ch: string): boolean {
  if (!SPANISH_LETTER.test(ch)) {
    return false;
  }
  if (relativePath === "src/mainview/i18n/es.ts") {
    return true;
  }
  if (relativePath === "docs/I18N.md") {
    return true;
  }
  if (relativePath.startsWith("tests/") && relativePath.endsWith(".unit.test.ts")) {
    return true;
  }
  return false;
}

describe("human-language ASCII contract", () => {
  test("repository-controlled text avoids ambiguous Unicode symbols", async () => {
    const files: string[] = [];
    for (const root of SCAN_ROOTS) {
      const absolute = join(ROOT, root);
      try {
        await stat(absolute);
      } catch {
        continue;
      }
      files.push(...(await listFiles(absolute)));
    }
    for (const name of ROOT_FILES) {
      const absolute = join(ROOT, name);
      try {
        await stat(absolute);
        files.push(absolute);
      } catch {
        // optional
      }
    }

    const violations: string[] = [];
    for (const file of files) {
      const relativePath = relative(ROOT, file).replaceAll("\\", "/");
      const text = await readFile(file, "utf8");
      for (const [index, line] of text.split(/\r?\n/).entries()) {
        for (const ch of line) {
          const code = ch.codePointAt(0) ?? 0;
          if (code < 128) {
            continue;
          }
          if (FORBIDDEN_SYMBOL.test(ch)) {
            violations.push(`${relativePath}:${index + 1} forbidden symbol ${JSON.stringify(ch)}`);
            continue;
          }
          if (allowNonAscii(relativePath, ch)) {
            continue;
          }
          violations.push(
            `${relativePath}:${index + 1} unexpected non-ASCII ${JSON.stringify(ch)}`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
