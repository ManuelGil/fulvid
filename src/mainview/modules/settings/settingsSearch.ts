/**
 * Local Settings Search projection.
 *
 * Catalog is static metadata for discoverability only. Preference values stay
 * in settingsStore. Matching uses the currently visible locale strings.
 */
import { SETTINGS_CATEGORIES, type SettingsCategory } from "./settingsCategoryNav";

export type SettingsSearchEntry = {
  readonly id: string;
  readonly category: SettingsCategory;
  readonly labelKey: string;
  readonly hintKey?: string;
  /** Locale-stable aliases when the translated label alone is a poor query target. */
  readonly terms?: readonly string[];
};

export type SettingsSearchHit = {
  readonly id: string;
  readonly category: SettingsCategory;
  readonly label: string;
  readonly hint: string;
  readonly categoryLabel: string;
};

/**
 * One row per focusable preference (or read-only Settings target).
 * Entry `id` values are stable DOM anchors (`data-settings-id`).
 */
export const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
  {
    id: "general.locale",
    category: "language",
    labelKey: "settings.locale",
    hintKey: "settings.localeHint",
    terms: ["language", "idioma", "i18n"],
  },
  {
    id: "general.reset",
    category: "about",
    labelKey: "settings.resetToDefaults",
    hintKey: "settings.resetToDefaultsHint",
    terms: ["defaults", "restore"],
  },
  {
    id: "editor.fontSize",
    category: "editorText",
    labelKey: "settings.editorFontSize",
    hintKey: "settings.editorFontSizeHint",
  },
  {
    id: "editor.fontFamily",
    category: "editorText",
    labelKey: "settings.editorFontFamily",
    hintKey: "settings.editorFontFamilyHint",
  },
  {
    id: "editor.lineHeight",
    category: "editorText",
    labelKey: "settings.editorLineHeight",
    hintKey: "settings.editorLineHeightHint",
  },
  {
    id: "editor.tabSize",
    category: "editing",
    labelKey: "settings.editorTabSize",
    hintKey: "settings.editorTabSizeHint",
  },
  {
    id: "editor.insertSpaces",
    category: "editing",
    labelKey: "settings.editorInsertSpaces",
    hintKey: "settings.editorInsertSpacesHint",
  },
  {
    id: "editor.autoIndent",
    category: "editing",
    labelKey: "settings.editorAutoIndent",
    hintKey: "settings.editorAutoIndentHint",
  },
  {
    id: "editor.wordWrap",
    category: "editing",
    labelKey: "settings.editorWordWrap",
    hintKey: "settings.editorWordWrapHint",
  },
  {
    id: "editor.defaultEol",
    category: "files",
    labelKey: "settings.editorDefaultEol",
    hintKey: "settings.editorDefaultEolHint",
    terms: ["eol", "lf", "crlf", "line endings"],
  },
  {
    id: "editor.trimTrailingWhitespaceOnSave",
    category: "files",
    labelKey: "settings.trimTrailingWhitespaceOnSave",
    hintKey: "settings.trimTrailingWhitespaceOnSaveHint",
    terms: ["trailing", "trim", "whitespace", "espacios"],
  },
  {
    id: "markdown.defaultExtension",
    category: "files",
    labelKey: "settings.defaultExtension",
    hintKey: "settings.defaultExtensionHint",
    terms: ["mdx", ".md", "extension"],
  },
  {
    id: "editor.lineNumbers",
    category: "editorDisplay",
    labelKey: "settings.editorLineNumbers",
    hintKey: "settings.editorLineNumbersHint",
  },
  {
    id: "editor.showSessionChanges",
    category: "editorDisplay",
    labelKey: "settings.showSessionChanges",
    hintKey: "settings.showSessionChangesHint",
    terms: ["session change", "marker", "before", "preview"],
  },
  {
    id: "editor.showDocumentAnnotations",
    category: "editorDisplay",
    labelKey: "settings.showDocumentAnnotations",
    hintKey: "settings.showDocumentAnnotationsHint",
  },
  {
    id: "editor.minimap",
    category: "editorDisplay",
    labelKey: "settings.editorMinimap",
    hintKey: "settings.editorMinimapHint",
    terms: ["minimap", "minimapa"],
  },
  {
    id: "editor.stickyScroll",
    category: "editorDisplay",
    labelKey: "settings.editorStickyScroll",
    hintKey: "settings.editorStickyScrollHint",
  },
  {
    id: "editor.whitespace",
    category: "editorDisplay",
    labelKey: "settings.editorWhitespace",
    hintKey: "settings.editorWhitespaceHint",
  },
  {
    id: "editor.typewriterScrolling",
    category: "writing",
    labelKey: "settings.typewriterScrolling",
    hintKey: "settings.typewriterScrollingHint",
  },
  {
    id: "editor.markdownFormatBar",
    category: "writing",
    labelKey: "settings.markdownFormatBar",
    hintKey: "settings.markdownFormatBarHint",
  },
  {
    id: "appearance.theme",
    category: "theme",
    labelKey: "settings.theme",
    hintKey: "settings.themeHint",
    terms: ["dark", "light", "system", "contrast"],
  },
  {
    id: "appearance.interfaceTextSize",
    category: "interface",
    labelKey: "settings.interfaceTextSize",
    hintKey: "settings.interfaceTextSizeHint",
  },
  {
    id: "appearance.iconSize",
    category: "interface",
    labelKey: "settings.interfaceIconSize",
    hintKey: "settings.interfaceIconSizeHint",
  },
  {
    id: "appearance.density",
    category: "interface",
    labelKey: "settings.density",
    hintKey: "settings.densityHint",
  },
  {
    id: "editor.documentLocation",
    category: "interface",
    labelKey: "settings.documentLocation",
    hintKey: "settings.documentLocationHint",
  },
  {
    id: "accessibility.reducedMotion",
    category: "accessibility",
    labelKey: "settings.reducedMotion",
    hintKey: "settings.reducedMotionHint",
    terms: ["motion", "animation", "accessibility"],
  },
  {
    id: "appearance.statusbarEnabled",
    category: "statusbar",
    labelKey: "settings.statusbarEnabled",
    hintKey: "settings.statusbarEnabledHint",
  },
  {
    id: "appearance.statusbar.document",
    category: "statusbar",
    labelKey: "settings.statusbarDocument",
    hintKey: "settings.statusbarDocumentHint",
  },
  {
    id: "appearance.statusbar.language",
    category: "statusbar",
    labelKey: "settings.statusbarLanguage",
    hintKey: "settings.statusbarLanguageHint",
  },
  {
    id: "appearance.statusbar.linkMode",
    category: "statusbar",
    labelKey: "settings.statusbarLinkMode",
    hintKey: "settings.statusbarLinkModeHint",
  },
  {
    id: "appearance.statusbar.workspace",
    category: "statusbar",
    labelKey: "settings.statusbarWorkspace",
    hintKey: "settings.statusbarWorkspaceHint",
  },
  {
    id: "appearance.statusbar.characters",
    category: "statusbar",
    labelKey: "settings.statusbarCharacters",
    hintKey: "settings.statusbarCharactersHint",
  },
  {
    id: "appearance.statusbar.eol",
    category: "statusbar",
    labelKey: "settings.statusbarEol",
    hintKey: "settings.statusbarEolHint",
  },
  {
    id: "editor.readingStatistics",
    category: "statusbar",
    labelKey: "settings.readingStatistics",
    hintKey: "settings.readingStatisticsHint",
    terms: ["word count", "reading time"],
  },
  {
    id: "workspace.startup",
    category: "folder",
    labelKey: "settings.workspaceStartup",
    hintKey: "settings.workspaceStartupNoneHint",
    terms: ["startup", "reopen", "last folder"],
  },
  {
    id: "workspace.confirmClose",
    category: "folder",
    labelKey: "settings.confirmClose",
    hintKey: "settings.confirmCloseHint",
  },
  {
    id: "workspace.showHidden",
    category: "folder",
    labelKey: "settings.showHidden",
    hintKey: "settings.showHiddenHint",
  },
  {
    id: "markdown.linkMode",
    category: "links",
    labelKey: "settings.linkMode",
    hintKey: "settings.linkModeHint",
    terms: ["wikilink", "markdown links"],
  },
  {
    id: "markdown.resolution",
    category: "links",
    labelKey: "settings.resolution",
    hintKey: "settings.resolutionHint",
  },
  {
    id: "markdown.showOutgoingLinks",
    category: "context",
    labelKey: "settings.showOutgoingLinks",
    hintKey: "settings.showOutgoingLinksHint",
  },
  {
    id: "markdown.showIncomingLinks",
    category: "context",
    labelKey: "settings.showIncomingLinks",
    hintKey: "settings.showIncomingLinksHint",
  },
  {
    id: "preview.enabled",
    category: "preview",
    labelKey: "settings.showPreview",
    hintKey: "settings.showPreviewHint",
    terms: ["preview", "vista previa"],
  },
  {
    id: "extensions.section",
    category: "extensions",
    labelKey: "settings.extensions",
    hintKey: "settings.extensionsHint",
    terms: ["extension", "plugin", "pack", "blocked", "lua"],
  },
  {
    id: "extensions.list",
    category: "extensions",
    labelKey: "settings.extensionsInstalled",
    hintKey: "settings.extensionsHint",
    terms: ["installed extensions", "load state", "capabilities"],
  },
  {
    id: "keyboard.section",
    category: "keyboard",
    labelKey: "settings.keyboard",
    hintKey: "settings.shortcutsNavigation",
    terms: ["shortcut", "atajo", "hotkey"],
  },
  {
    id: "keyboard.quickOpen",
    category: "keyboard",
    labelKey: "settings.shortcutQuickOpen",
    terms: ["ctrl+p", "cmd+p"],
  },
  {
    id: "keyboard.writingFocus",
    category: "keyboard",
    labelKey: "settings.shortcutFocus",
    terms: ["writing focus", "enfoque de escritura"],
  },
  {
    id: "keyboard.fullscreen",
    category: "keyboard",
    labelKey: "settings.shortcutFullscreen",
    terms: ["f11", "full screen"],
  },
  {
    id: "keyboard.globalSearch",
    category: "keyboard",
    labelKey: "settings.shortcutGlobalSearch",
    terms: ["ctrl+shift+f"],
  },
  {
    id: "general.about",
    category: "about",
    labelKey: "settings.about",
    hintKey: "settings.aboutDescription",
    terms: ["version", "license"],
  },
  {
    id: "general.sponsor",
    category: "about",
    labelKey: "settings.sponsor",
    hintKey: "settings.sponsorHint",
    terms: ["donate", "sponsor", "github", "support"],
  },
];

export type SettingsTranslate = (key: string) => string;

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Rank: label prefix -> label -> category -> hint -> terms. Lower is better.
 * Empty query yields no hits (Settings UI stays in its normal category view).
 */
function matchRank(
  entry: SettingsSearchEntry,
  query: string,
  label: string,
  hint: string,
  categoryLabel: string,
): number | null {
  const labelNorm = normalizeSearchText(label);
  const hintNorm = normalizeSearchText(hint);
  const categoryNorm = normalizeSearchText(categoryLabel);

  if (labelNorm.startsWith(query)) {
    return 0;
  }
  if (labelNorm.includes(query)) {
    return 1;
  }
  if (categoryNorm.includes(query)) {
    return 2;
  }
  if (hintNorm.includes(query)) {
    return 3;
  }
  if (entry.terms?.some((term) => normalizeSearchText(term).includes(query))) {
    return 4;
  }
  return null;
}

/**
 * Project catalog rows that match `query` using translated label/hint/category.
 * Does not read or write preference values.
 */
export function matchSettingsSearch(
  query: string,
  translate: SettingsTranslate,
  entries: readonly SettingsSearchEntry[] = SETTINGS_SEARCH_ENTRIES,
): SettingsSearchHit[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) {
    return [];
  }

  const scored: { hit: SettingsSearchHit; rank: number; index: number }[] = [];
  for (const [index, entry] of entries.entries()) {
    const label = translate(entry.labelKey);
    const hint = entry.hintKey ? translate(entry.hintKey) : "";
    const categoryLabel = translate(
      // Every category id comes from SETTINGS_CATEGORIES.
      SETTINGS_CATEGORIES.find((category) => category.id === entry.category)!.label,
    );
    const rank = matchRank(entry, normalized, label, hint, categoryLabel);
    if (rank === null) {
      continue;
    }
    scored.push({
      hit: { id: entry.id, category: entry.category, label, hint, categoryLabel },
      rank,
      index,
    });
  }

  scored.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return scored.map(({ hit }) => hit);
}

const FOCUSABLE_CONTROL = "button, input, select, textarea, a[href]";

/**
 * Scroll a Settings control into view and focus a usable target.
 * Returns false when the anchor is missing (category not mounted yet).
 */
export function focusSettingsSearchTarget(settingId: string): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  const host = document.querySelector<HTMLElement>(`[data-settings-id="${CSS.escape(settingId)}"]`);
  if (!host) {
    return false;
  }

  host.scrollIntoView({ block: "nearest", inline: "nearest" });

  const control = host.matches(FOCUSABLE_CONTROL)
    ? host
    : host.querySelector<HTMLElement>(FOCUSABLE_CONTROL);
  if (control && !control.hasAttribute("disabled") && !(control as HTMLInputElement).disabled) {
    control.focus({ preventScroll: true });
    return true;
  }

  if (host.tabIndex < 0) {
    host.focus({ preventScroll: true });
    return true;
  }

  return false;
}
