/**
 * Fulvid's single theme catalog. CSS owns the semantic color values; this
 * catalog owns the persisted IDs, Settings metadata, and Monaco IDs.
 */
export const THEME_PREFERENCES = [
  "system",
  "light",
  "paper",
  "warm-light",
  "soft-light",
  "dark",
  "dark-soft",
  "dark-strong",
  "midnight",
  "high-contrast-light",
  "high-contrast-dark",
  "protanopia",
  "deuteranopia",
  "tritanopia",
  "monochrome",
] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** First-run / missing preference: follow the OS light/dark preference. */
export const DEFAULT_THEME: ThemePreference = "system";

export const THEME_FAMILIES = [
  { id: "system", label: "settings.themeFamilySystem" },
  { id: "light", label: "settings.themeFamilyLight" },
  { id: "dark", label: "settings.themeFamilyDark" },
  { id: "high-contrast", label: "settings.themeFamilyHighContrast" },
  { id: "color-vision", label: "settings.themeFamilyColorVision" },
  { id: "monochrome", label: "settings.themeFamilyMonochrome" },
] as const;

export type ThemeFamily = (typeof THEME_FAMILIES)[number]["id"];

export type ThemeOption = {
  id: ThemePreference;
  family: ThemeFamily;
  mode: "system" | "light" | "dark";
  label: string;
  hint: string;
  preview: readonly ThemePreference[];
};

export const THEME_OPTIONS: readonly ThemeOption[] = [
  {
    id: "system",
    family: "system",
    mode: "system",
    label: "settings.system",
    hint: "settings.systemHint",
    preview: ["light", "dark"],
  },
  {
    id: "light",
    family: "light",
    mode: "light",
    label: "settings.light",
    hint: "settings.lightHint",
    preview: ["light"],
  },
  {
    id: "paper",
    family: "light",
    mode: "light",
    label: "settings.paper",
    hint: "settings.paperHint",
    preview: ["paper"],
  },
  {
    id: "warm-light",
    family: "light",
    mode: "light",
    label: "settings.warmLight",
    hint: "settings.warmLightHint",
    preview: ["warm-light"],
  },
  {
    id: "soft-light",
    family: "light",
    mode: "light",
    label: "settings.softLight",
    hint: "settings.softLightHint",
    preview: ["soft-light"],
  },
  {
    id: "dark",
    family: "dark",
    mode: "dark",
    label: "settings.dark",
    hint: "settings.darkHint",
    preview: ["dark"],
  },
  {
    id: "dark-soft",
    family: "dark",
    mode: "dark",
    label: "settings.darkSoft",
    hint: "settings.darkSoftHint",
    preview: ["dark-soft"],
  },
  {
    id: "dark-strong",
    family: "dark",
    mode: "dark",
    label: "settings.darkStrong",
    hint: "settings.darkStrongHint",
    preview: ["dark-strong"],
  },
  {
    id: "midnight",
    family: "dark",
    mode: "dark",
    label: "settings.midnight",
    hint: "settings.midnightHint",
    preview: ["midnight"],
  },
  {
    id: "high-contrast-light",
    family: "high-contrast",
    mode: "light",
    label: "settings.highContrastLight",
    hint: "settings.highContrastLightHint",
    preview: ["high-contrast-light"],
  },
  {
    id: "high-contrast-dark",
    family: "high-contrast",
    mode: "dark",
    label: "settings.highContrastDark",
    hint: "settings.highContrastDarkHint",
    preview: ["high-contrast-dark"],
  },
  {
    id: "protanopia",
    family: "color-vision",
    mode: "light",
    label: "settings.protanopia",
    hint: "settings.protanopiaHint",
    preview: ["protanopia"],
  },
  {
    id: "deuteranopia",
    family: "color-vision",
    mode: "light",
    label: "settings.deuteranopia",
    hint: "settings.deuteranopiaHint",
    preview: ["deuteranopia"],
  },
  {
    id: "tritanopia",
    family: "color-vision",
    mode: "light",
    label: "settings.tritanopia",
    hint: "settings.tritanopiaHint",
    preview: ["tritanopia"],
  },
  {
    id: "monochrome",
    family: "monochrome",
    mode: "dark",
    label: "settings.monochrome",
    hint: "settings.monochromeHint",
    preview: ["monochrome"],
  },
];

export function themeOptionsForFamily(family: ThemeFamily): readonly ThemeOption[] {
  return THEME_OPTIONS.filter((option) => option.family === family);
}

export function monacoThemeBase(
  theme: ThemePreference,
  prefersLight: boolean,
): "vs" | "vs-dark" | "hc-black" {
  if (theme === "high-contrast-dark") {
    return "hc-black";
  }

  const option = THEME_OPTIONS.find((candidate) => candidate.id === theme);
  const mode = option?.mode === "system" ? (prefersLight ? "light" : "dark") : option?.mode;
  return mode === "light" ? "vs" : "vs-dark";
}

export function resolveMonacoThemeId(
  theme: ThemePreference,
  forcedColors: boolean,
  prefersLight: boolean,
): string {
  if (forcedColors) {
    return prefersLight ? "hc-light" : "hc-black";
  }

  // Every Fulvid theme defines a Monaco theme of the same name.
  const resolved = theme === "system" ? (prefersLight ? "light" : "dark") : theme;
  return `fulvid-monaco-${resolved}`;
}
