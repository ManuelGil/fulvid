/**
 * Resolve Fulvid UI locale from preference + OS locale tags.
 *
 * Precedence: explicit preference -> OS language if in the allowlist -> English.
 * Regional tags (de-DE, pt_BR) match by primary language subtag only.
 */

export const SUPPORTED_LOCALES = ["de", "en", "es", "fr", "it", "nl", "pt"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_PREFERENCES = ["system", ...SUPPORTED_LOCALES] as const;
export type LocalePreference = (typeof LOCALE_PREFERENCES)[number];

export const DEFAULT_LOCALE_PREFERENCE: LocalePreference = "system";
export const FALLBACK_LOCALE: Locale = "en";

/**
 * Normalize BCP 47 / POSIX-ish locale tags to lowercase hyphen form.
 * Returns "" when the value cannot yield a language subtag.
 */
export function normalizeLocaleTag(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  // Drop encoding / charset and glibc modifiers: es_ES.UTF-8@euro -> es_ES
  const withoutSuffix = trimmed.split(/[.@]/, 2)[0] ?? "";
  const normalized = withoutSuffix
    .replace(/[_\s./]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  if (!normalized || normalized === "c" || normalized === "posix") {
    return "";
  }
  const primary = normalized.split("-", 1)[0] ?? "";
  if (!/^[a-z]{2,3}$/.test(primary)) {
    return "";
  }
  return normalized;
}

/** Map a locale tag to a Fulvid catalog locale, or null when unsupported. */
export function matchSupportedLocale(raw: unknown): Locale | null {
  const tag = normalizeLocaleTag(raw);
  if (!tag) {
    return null;
  }
  const primary = tag.split("-", 1)[0] ?? "";
  return (SUPPORTED_LOCALES as readonly string[]).includes(primary) ? (primary as Locale) : null;
}

/**
 * Resolve the active UI locale.
 * Explicit catalog preferences win; "system" (and unknown values) walk osTags.
 */
export function resolveLocalePreference(
  preference: unknown,
  osTags: readonly unknown[] = [],
): Locale {
  if (
    typeof preference === "string" &&
    preference !== "system" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(preference)
  ) {
    return preference as Locale;
  }
  for (const tag of osTags) {
    const match = matchSupportedLocale(tag);
    if (match) {
      return match;
    }
  }
  return FALLBACK_LOCALE;
}

/**
 * OS / WebView locale candidates. Prefer navigator.languages order, then
 * navigator.language. Inject `source` in tests; do not invent tags.
 */
export function readOsLocaleTags(
  source: { languages?: readonly string[]; language?: string } | undefined = typeof navigator !==
  "undefined"
    ? navigator
    : undefined,
): string[] {
  if (!source) {
    return [];
  }
  const tags: string[] = [];
  if (Array.isArray(source.languages)) {
    for (const tag of source.languages) {
      if (typeof tag === "string" && tag.trim()) {
        tags.push(tag);
      }
    }
  }
  if (typeof source.language === "string" && source.language.trim()) {
    tags.push(source.language);
  }
  return tags;
}
