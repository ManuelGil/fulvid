import { describe, expect, test } from "bun:test";

import {
  FALLBACK_LOCALE,
  matchSupportedLocale,
  normalizeLocaleTag,
  readOsLocaleTags,
  resolveLocalePreference,
} from "../../../src/mainview/i18n/resolveLocale";

// Intent: OS -> Fulvid locale mapping is allowlist-only, preference-aware, and fail-closed to English.
describe("resolveLocale", () => {
  test("normalizes tags and matches only the supported allowlist", () => {
    expect(normalizeLocaleTag("en-US")).toBe("en-us");
    expect(normalizeLocaleTag("en_GB")).toBe("en-gb");
    expect(normalizeLocaleTag("pt-BR")).toBe("pt-br");
    expect(normalizeLocaleTag("es_ES.UTF-8")).toBe("es-es");
    expect(normalizeLocaleTag("fr_FR.UTF-8@euro")).toBe("fr-fr");
    expect(normalizeLocaleTag("  NL_nl  ")).toBe("nl-nl");
    expect(normalizeLocaleTag("C")).toBe("");
    expect(normalizeLocaleTag("POSIX")).toBe("");
    expect(normalizeLocaleTag("")).toBe("");
    expect(normalizeLocaleTag(null)).toBe("");
    expect(normalizeLocaleTag(42)).toBe("");
    expect(normalizeLocaleTag("!!!")).toBe("");

    expect(matchSupportedLocale("de")).toBe("de");
    expect(matchSupportedLocale("de-DE")).toBe("de");
    expect(matchSupportedLocale("de_AT")).toBe("de");
    expect(matchSupportedLocale("fr-FR")).toBe("fr");
    expect(matchSupportedLocale("es-MX")).toBe("es");
    expect(matchSupportedLocale("pt-BR")).toBe("pt");
    expect(matchSupportedLocale("it_IT.UTF-8")).toBe("it");
    expect(matchSupportedLocale("nl-NL")).toBe("nl");
    expect(matchSupportedLocale("en-US")).toBe("en");

    expect(matchSupportedLocale("ja")).toBeNull();
    expect(matchSupportedLocale("zh-CN")).toBeNull();
    expect(matchSupportedLocale("")).toBeNull();
    expect(matchSupportedLocale(undefined)).toBeNull();
    expect(matchSupportedLocale("not a locale")).toBeNull();
    expect(matchSupportedLocale("123")).toBeNull();
  });

  test("resolves explicit preference over OS, then OS over English", () => {
    expect(resolveLocalePreference("system", ["de-DE"])).toBe("de");
    expect(resolveLocalePreference("system", ["fr_CA.UTF-8"])).toBe("fr");
    expect(resolveLocalePreference("system", ["ja-JP", "es-MX"])).toBe("es");
    expect(resolveLocalePreference("system", ["ja-JP"])).toBe(FALLBACK_LOCALE);
    expect(resolveLocalePreference("system", [])).toBe(FALLBACK_LOCALE);
    expect(resolveLocalePreference("system", [null, "", "!!!"])).toBe(FALLBACK_LOCALE);
    expect(resolveLocalePreference("system")).toBe(FALLBACK_LOCALE);

    expect(resolveLocalePreference("en", ["de-DE"])).toBe("en");
    expect(resolveLocalePreference("it", ["fr-FR"])).toBe("it");
    const persisted = "de" as const;
    expect(resolveLocalePreference(persisted, ["en-US"])).toBe("de");
    expect(resolveLocalePreference(persisted, ["zh-CN"])).toBe("de");

    expect(resolveLocalePreference("ja", ["nl-NL"])).toBe("nl");
    expect(resolveLocalePreference(undefined, ["pt-BR"])).toBe("pt");
    expect(resolveLocalePreference({}, [])).toBe(FALLBACK_LOCALE);

    expect(
      readOsLocaleTags({
        languages: ["de-DE", "en-US"],
        language: "fr-FR",
      }),
    ).toEqual(["de-DE", "en-US", "fr-FR"]);
    expect(readOsLocaleTags({ language: "es-ES" })).toEqual(["es-ES"]);
    expect(readOsLocaleTags({ languages: ["", "  "], language: "" })).toEqual([]);
    expect(readOsLocaleTags(undefined)).toEqual([]);
  });
});
