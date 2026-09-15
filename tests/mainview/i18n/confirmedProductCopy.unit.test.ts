import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import en from "../../../src/mainview/i18n/en.ts";
import es from "../../../src/mainview/i18n/es.ts";

const REPO_ROOT = join(import.meta.dir, "../../..");
const STALE_WRITING_FOCUS_NAMES = [
  "Focus Mode",
  "Focus mode",
  "focus mode",
  "Modo foco",
  "modo foco",
] as const;
const REMOVED_PRODUCT_PHRASES = [
  "Context root",
  "context root",
  "Raíz de contexto",
  "raíz de contexto",
] as const;

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) collectStrings(nested, out);
  }
}

function assertAbsentPhrases(source: string, phrases: readonly string[]): void {
  for (const phrase of phrases) {
    expect(source.includes(phrase)).toBe(false);
  }
}

// Intent: user-facing copy keeps Writing Focus named correctly and does not
// revive removed Context-root wording. Graph Focus stays a separate concept.
describe("product terminology", () => {
  test("Writing Focus stays current and removed Context-root copy stays gone", () => {
    expect(en.actions.focusMode).toBe("Writing Focus");
    expect(en.actions.exitFocusMode).toBe("Exit Writing Focus");
    expect(en.menu.focusMode).toBe("Writing Focus");
    expect(es.actions.focusMode).toBe("Foco de escritura");
    expect(es.actions.exitFocusMode).toBe("Salir del foco de escritura");
    expect(es.menu.focusMode).toBe("Foco de escritura");
    // Graph Focus is still "Focus" / "Enfocar" - not Writing Focus.
    expect(en.actions.focus).toBe("Focus");
    expect(es.actions.focus).toBe("Enfocar");

    const english: string[] = [];
    const spanish: string[] = [];
    collectStrings(en, english);
    collectStrings(es, spanish);
    const catalogs = `${english.join("\n")}\n${spanish.join("\n")}`;
    assertAbsentPhrases(catalogs, STALE_WRITING_FOCUS_NAMES);
    assertAbsentPhrases(catalogs, REMOVED_PRODUCT_PHRASES);
    expect("tokens" in en.facts).toBe(false);
    expect("scopeAllDocuments" in en.search).toBe(false);

    assertAbsentPhrases(readFileSync(join(REPO_ROOT, "CHANGELOG.md"), "utf8"), [
      ...STALE_WRITING_FOCUS_NAMES,
    ]);
    const releasesDir = join(REPO_ROOT, "docs/releases");
    for (const name of readdirSync(releasesDir)) {
      if (!name.endsWith(".md")) continue;
      assertAbsentPhrases(readFileSync(join(releasesDir, name), "utf8"), [
        ...STALE_WRITING_FOCUS_NAMES,
      ]);
    }
  });
});
