/**
 * Local Settings Search projection.
 *
 * Catalog is static metadata for discoverability only. Preference values stay
 * in settingsStore. Matching uses the currently visible locale strings.
 */

export type SettingsSearchCategory =
  | "general"
  | "editor"
  | "appearance"
  | "markdown"
  | "preview"
  | "workspace"
  | "extensions"
  | "accessibility"
  | "keyboard";

export type SettingsSearchEntry = {
  readonly id: string;
  readonly category: SettingsSearchCategory;
  readonly labelKey: string;
  readonly hintKey?: string;
  /** Locale-stable aliases when the translated label alone is a poor query target. */
  readonly terms?: readonly string[];
};

export type SettingsSearchHit = {
  readonly id: string;
  readonly category: SettingsSearchCategory;
  readonly label: string;
  readonly hint: string;
  readonly categoryLabel: string;
};

export const SETTINGS_SEARCH_CATEGORY_LABEL: Readonly<Record<SettingsSearchCategory, string>> = {
  general: "settings.general",
  editor: "settings.editor",
  appearance: "settings.appearance",
  markdown: "settings.markdown",
  preview: "settings.preview",
  workspace: "settings.workspace",
  extensions: "settings.extensions",
  accessibility: "settings.accessibility",
  keyboard: "settings.keyboard",
};

/**
 * One row per focusable preference (or read-only Settings target).
 * Order is the default result order after rank ties.
 */
export const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
  {
    id: "general.locale",
    category: "general",
    labelKey: "settings.locale",
    hintKey: "settings.localeHint",
    terms: ["language", "idioma", "i18n"],
  },
  {
    id: "general.reset",
    category: "general",
    labelKey: "settings.resetToDefaults",
    hintKey: "settings.resetToDefaultsHint",
    terms: ["defaults", "restore"],
  },
  {
    id: "general.about",
    category: "general",
    labelKey: "settings.about",
    hintKey: "settings.aboutDescription",
    terms: ["version", "license"],
  },
  {
    id: "editor.fontSize",
    category: "editor",
    labelKey: "settings.editorFontSize",
    hintKey: "settings.editorFontSizeHint",
  },
  {
    id: "editor.fontFamily",
    category: "editor",
    labelKey: "settings.editorFontFamily",
    hintKey: "settings.editorFontFamilyHint",
  },
  {
    id: "editor.lineHeight",
    category: "editor",
    labelKey: "settings.editorLineHeight",
    hintKey: "settings.editorLineHeightHint",
  },
  {
    id: "editor.tabSize",
    category: "editor",
    labelKey: "settings.editorTabSize",
    hintKey: "settings.editorTabSizeHint",
  },
  {
    id: "editor.defaultEol",
    category: "editor",
    labelKey: "settings.editorDefaultEol",
    hintKey: "settings.editorDefaultEolHint",
    terms: ["eol", "lf", "crlf", "line endings"],
  },
  {
    id: "editor.insertSpaces",
    category: "editor",
    labelKey: "settings.editorInsertSpaces",
    hintKey: "settings.editorInsertSpacesHint",
  },
  {
    id: "editor.autoIndent",
    category: "editor",
    labelKey: "settings.editorAutoIndent",
    hintKey: "settings.editorAutoIndentHint",
  },
  {
    id: "editor.wordWrap",
    category: "editor",
    labelKey: "settings.editorWordWrap",
    hintKey: "settings.editorWordWrapHint",
  },
  {
    id: "editor.lineNumbers",
    category: "editor",
    labelKey: "settings.editorLineNumbers",
    hintKey: "settings.editorLineNumbersHint",
  },
  {
    id: "editor.minimap",
    category: "editor",
    labelKey: "settings.editorMinimap",
    hintKey: "settings.editorMinimapHint",
    terms: ["minimap", "minimapa"],
  },
  {
    id: "editor.stickyScroll",
    category: "editor",
    labelKey: "settings.editorStickyScroll",
    hintKey: "settings.editorStickyScrollHint",
  },
  {
    id: "editor.whitespace",
    category: "editor",
    labelKey: "settings.editorWhitespace",
    hintKey: "settings.editorWhitespaceHint",
  },
  {
    id: "editor.trimTrailingWhitespaceOnSave",
    category: "editor",
    labelKey: "settings.trimTrailingWhitespaceOnSave",
    hintKey: "settings.trimTrailingWhitespaceOnSaveHint",
    terms: ["trailing", "trim", "whitespace", "espacios"],
  },
  {
    id: "editor.readingStatistics",
    category: "editor",
    labelKey: "settings.readingStatistics",
    hintKey: "settings.readingStatisticsHint",
    terms: ["word count", "reading time"],
  },
  {
    id: "editor.typewriterScrolling",
    category: "editor",
    labelKey: "settings.typewriterScrolling",
    hintKey: "settings.typewriterScrollingHint",
  },
  {
    id: "editor.documentLocation",
    category: "editor",
    labelKey: "settings.documentLocation",
    hintKey: "settings.documentLocationHint",
  },
  {
    id: "editor.markdownFormatBar",
    category: "editor",
    labelKey: "settings.markdownFormatBar",
    hintKey: "settings.markdownFormatBarHint",
  },
  {
    id: "editor.showDocumentAnnotations",
    category: "editor",
    labelKey: "settings.showDocumentAnnotations",
    hintKey: "settings.showDocumentAnnotationsHint",
  },
  {
    id: "editor.showSessionChanges",
    category: "editor",
    labelKey: "settings.showSessionChanges",
    hintKey: "settings.showSessionChangesHint",
    terms: ["session change", "marker", "before", "preview"],
  },
  {
    id: "appearance.theme",
    category: "appearance",
    labelKey: "settings.theme",
    hintKey: "settings.themeHint",
    terms: ["dark", "light", "system", "contrast"],
  },
  {
    id: "appearance.interfaceTextSize",
    category: "appearance",
    labelKey: "settings.interfaceTextSize",
    hintKey: "settings.interfaceTextSizeHint",
  },
  {
    id: "appearance.iconSize",
    category: "appearance",
    labelKey: "settings.interfaceIconSize",
    hintKey: "settings.interfaceIconSizeHint",
  },
  {
    id: "appearance.density",
    category: "appearance",
    labelKey: "settings.density",
    hintKey: "settings.densityHint",
  },
  {
    id: "appearance.statusbarEnabled",
    category: "appearance",
    labelKey: "settings.statusbarEnabled",
    hintKey: "settings.statusbarEnabledHint",
  },
  {
    id: "appearance.statusbar.document",
    category: "appearance",
    labelKey: "settings.statusbarDocument",
    hintKey: "settings.statusbarDocumentHint",
  },
  {
    id: "appearance.statusbar.language",
    category: "appearance",
    labelKey: "settings.statusbarLanguage",
    hintKey: "settings.statusbarLanguageHint",
  },
  {
    id: "appearance.statusbar.linkMode",
    category: "appearance",
    labelKey: "settings.statusbarLinkMode",
    hintKey: "settings.statusbarLinkModeHint",
  },
  {
    id: "appearance.statusbar.workspace",
    category: "appearance",
    labelKey: "settings.statusbarWorkspace",
    hintKey: "settings.statusbarWorkspaceHint",
  },
  {
    id: "appearance.statusbar.characters",
    category: "appearance",
    labelKey: "settings.statusbarCharacters",
    hintKey: "settings.statusbarCharactersHint",
  },
  {
    id: "appearance.statusbar.eol",
    category: "appearance",
    labelKey: "settings.statusbarEol",
    hintKey: "settings.statusbarEolHint",
  },
  {
    id: "workspace.showHidden",
    category: "workspace",
    labelKey: "settings.showHidden",
    hintKey: "settings.showHiddenHint",
  },
  {
    id: "workspace.confirmClose",
    category: "workspace",
    labelKey: "settings.confirmClose",
    hintKey: "settings.confirmCloseHint",
  },
  {
    id: "workspace.startup",
    category: "workspace",
    labelKey: "settings.workspaceStartup",
    hintKey: "settings.workspaceStartupNoneHint",
    terms: ["startup", "reopen", "last folder"],
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
    labelKey: "settings.extensions",
    hintKey: "settings.extensionsHint",
    terms: ["installed extensions", "load state", "capabilities"],
  },
  {
    id: "accessibility.reducedMotion",
    category: "accessibility",
    labelKey: "settings.reducedMotion",
    hintKey: "settings.reducedMotionHint",
  },
  {
    id: "markdown.linkMode",
    category: "markdown",
    labelKey: "settings.linkMode",
    hintKey: "settings.linkModeHint",
    terms: ["wikilink", "markdown links"],
  },
  {
    id: "markdown.resolution",
    category: "markdown",
    labelKey: "settings.resolution",
    hintKey: "settings.resolutionHint",
  },
  {
    id: "markdown.defaultExtension",
    category: "markdown",
    labelKey: "settings.defaultExtension",
    hintKey: "settings.defaultExtensionHint",
    terms: ["mdx", ".md", "extension"],
  },
  {
    id: "markdown.showOutgoingLinks",
    category: "markdown",
    labelKey: "settings.showOutgoingLinks",
    hintKey: "settings.showOutgoingLinksHint",
  },
  {
    id: "markdown.showIncomingLinks",
    category: "markdown",
    labelKey: "settings.showIncomingLinks",
    hintKey: "settings.showIncomingLinksHint",
  },
  {
    id: "preview.enabled",
    category: "preview",
    labelKey: "settings.showPreview",
    hintKey: "settings.showPreviewHint",
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

  const scored: { entry: SettingsSearchEntry; rank: number; index: number }[] = [];
  for (const [index, entry] of entries.entries()) {
    const label = translate(entry.labelKey);
    const hint = entry.hintKey ? translate(entry.hintKey) : "";
    const categoryLabel = translate(SETTINGS_SEARCH_CATEGORY_LABEL[entry.category]);
    const rank = matchRank(entry, normalized, label, hint, categoryLabel);
    if (rank === null) {
      continue;
    }
    scored.push({ entry, rank, index });
  }

  scored.sort((a, b) => a.rank - b.rank || a.index - b.index);

  return scored.map(({ entry }) => ({
    id: entry.id,
    category: entry.category,
    label: translate(entry.labelKey),
    hint: entry.hintKey ? translate(entry.hintKey) : "",
    categoryLabel: translate(SETTINGS_SEARCH_CATEGORY_LABEL[entry.category]),
  }));
}

const FOCUSABLE_CONTROL = "button, input, select, textarea";

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
