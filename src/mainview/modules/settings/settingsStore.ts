/**
 * User settings: schema, defaults, localStorage persistence, and the reactive
 * store.
 *
 * This is the only persisted preference source. Link mode is copied into
 * `linkSemantics` so parse/resolve stay free of this module. Layout widths
 * live in `layoutStore`, not here. Search query options are URL state.
 */
import { ref, watch } from "vue";
import { setDocumentLinkSettings, type LinkResolutionMode } from "../document/links/linkSemantics";
import type { LinkSyntax } from "../document/links/documentLink";
import type { DocumentLocationDestination } from "../editor/document/documentLocation";
import { DOCUMENT_LOCATION_DESTINATIONS } from "../editor/document/documentLocation";
import {
  DEFAULT_THEME,
  THEME_PREFERENCES,
  type ThemePreference,
} from "../editor/monaco/monacoThemes";

export type Locale = "en" | "es";
export type LinkMode = LinkSyntax;
export type WorkspaceStartup = "none" | "last";
export type StatusbarIndicator =
  "document" | "language" | "linkMode" | "workspace" | "characters" | "eol";
export type ReadingStatisticsMode = "off" | "words" | "wordsAndTime";
export type EditorFontFamily = "monospace" | "system" | "serif";
export type EditorLineHeight = "auto" | "compact" | "comfortable";
export type EditorTabSize = 2 | 4 | 8;
export type EditorDefaultEol = "lf" | "crlf";
export type EditorWordWrap = "on" | "off" | "bounded";
export type EditorRenderWhitespace = "none" | "selection" | "all";
export type InterfaceTextScale = "small" | "normal" | "large";
export type IconScale = "small" | "normal" | "large";
export type InterfaceDensity = "normal" | "compact";

export interface StatusbarSettings {
  enabled: boolean;
  indicators: Record<StatusbarIndicator, boolean>;
}

export interface EditorSettings {
  fontSize: number;
  fontFamily: EditorFontFamily;
  lineHeight: EditorLineHeight;
  tabSize: EditorTabSize;
  /**
   * Line endings for Untitled documents, and for opened files that have none
   * yet. Existing documents with LF or CRLF keep that document's ending.
   * Independent of the operating system.
   */
  defaultEol: EditorDefaultEol;
  insertSpaces: boolean;
  wordWrap: EditorWordWrap;
  /**
   * Monaco indent-on-enter/paste only. List, quote, fence, and table
   * continuation on Enter is always on (`markdownEnter`) and is not this flag.
   */
  autoIndent: boolean;
  lineNumbers: boolean;
  minimap: boolean;
  stickyScroll: boolean;
  renderWhitespace: EditorRenderWhitespace;
  /**
   * When true, remove trailing spaces/tabs from the active model via Monaco
   * edits immediately before Save / Save As. Default off - explicit, not silent.
   */
  trimTrailingWhitespaceOnSave: boolean;
  showMarkdownFormatBar: boolean;
  /**
   * Preferred default for document annotation glyph/hover presentation.
   * Session visibility can diverge until restart, settings change, or reset.
   * Does not persist annotation content or positions.
   */
  showDocumentAnnotations: boolean;
  readingStatistics: ReadingStatisticsMode;
  /** Writing Focus only. Ignored when Writing Focus is off. */
  typewriterScrolling: boolean;
  /**
   * Where to present the active document location (same projection everywhere).
   * Showing a path never grants filesystem access.
   */
  documentLocation: DocumentLocationDestination;
}

export interface FulvidSettings {
  locale: Locale;
  appearance: {
    theme: ThemePreference;
    interfaceTextScale: InterfaceTextScale;
    iconScale: IconScale;
    density: InterfaceDensity;
    reducedMotion: boolean;
    statusbar: StatusbarSettings;
  };
  editor: EditorSettings;
  workspace: {
    showHiddenFiles: boolean;
    workspaceStartup: WorkspaceStartup;
    /**
     * Confirm closing the open folder, and confirm closing dirty tabs.
     * Saved documents close without a prompt.
     */
    confirmClose: boolean;
  };
  links: {
    /** Exclusive syntax. Changing this does not rewrite existing files. */
    linkMode: LinkMode;
    resolution: LinkResolutionMode;
    /** New file / Save As when the name has no extension. Never renames existing files. */
    defaultExtension: "md" | "markdown" | "mdx";
    /** Document Context lists only. Graph still uses every resolved link. */
    showIncomingLinks: boolean;
    showOutgoingLinks: boolean;
  };
  preview: {
    /** Preview pane beside the editor. Not a save; Export HTML uses the same renderer. */
    enabled: boolean;
  };
}

/** Single source of defaults for load, sanitize fallbacks, and reset. */
const DEFAULT_SETTINGS: FulvidSettings = {
  locale: "en",
  appearance: {
    theme: DEFAULT_THEME,
    interfaceTextScale: "normal",
    iconScale: "normal",
    density: "normal",
    reducedMotion: false,
    statusbar: {
      enabled: true,
      indicators: {
        document: true,
        language: true,
        linkMode: true,
        workspace: true,
        characters: true,
        eol: true,
      },
    },
  },
  editor: {
    fontSize: 14,
    fontFamily: "monospace",
    lineHeight: "auto",
    tabSize: 2,
    defaultEol: "lf",
    insertSpaces: true,
    wordWrap: "on",
    autoIndent: true,
    lineNumbers: true,
    minimap: false,
    stickyScroll: true,
    renderWhitespace: "selection",
    trimTrailingWhitespaceOnSave: false,
    showMarkdownFormatBar: false,
    showDocumentAnnotations: true,
    readingStatistics: "wordsAndTime",
    typewriterScrolling: true,
    documentLocation: "main-panel",
  },
  workspace: {
    showHiddenFiles: true,
    workspaceStartup: "none",
    confirmClose: true,
  },
  links: {
    linkMode: "markdown",
    resolution: "both",
    defaultExtension: "mdx",
    showIncomingLinks: true,
    showOutgoingLinks: true,
  },
  preview: {
    enabled: false,
  },
};

const STORAGE_KEY = "fulvid.settings.v1";

/** Storage key for tests and recovery tooling - not a second settings authority. */
export const SETTINGS_STORAGE_KEY = STORAGE_KEY;

const VALID_THEMES = new Set<ThemePreference>(THEME_PREFERENCES);
const VALID_LOCALES = new Set<Locale>(["en", "es"]);
const VALID_EDITOR_FONT_FAMILIES = new Set<EditorFontFamily>(["monospace", "system", "serif"]);
const VALID_EDITOR_LINE_HEIGHTS = new Set<EditorLineHeight>(["auto", "compact", "comfortable"]);
const VALID_EDITOR_TAB_SIZES = new Set<EditorTabSize>([2, 4, 8]);
const VALID_EDITOR_DEFAULT_EOL = new Set<EditorDefaultEol>(["lf", "crlf"]);
const VALID_EDITOR_WORD_WRAP = new Set<EditorWordWrap>(["on", "off", "bounded"]);
const VALID_EDITOR_RENDER_WHITESPACE = new Set<EditorRenderWhitespace>([
  "none",
  "selection",
  "all",
]);
const VALID_INTERFACE_TEXT_SCALES = new Set<InterfaceTextScale>(["small", "normal", "large"]);
const VALID_ICON_SCALES = new Set<IconScale>(["small", "normal", "large"]);
const VALID_INTERFACE_DENSITIES = new Set<InterfaceDensity>(["normal", "compact"]);
const VALID_READING_STATISTICS = new Set<ReadingStatisticsMode>(["off", "words", "wordsAndTime"]);

function themeFromPersistedAppearance(
  appearance: Partial<FulvidSettings["appearance"]>,
): ThemePreference {
  const persistedTheme = appearance.theme as string;
  return VALID_THEMES.has(persistedTheme as ThemePreference)
    ? (persistedTheme as ThemePreference)
    : DEFAULT_THEME;
}

export function sanitizeSettings(value: unknown): FulvidSettings {
  const source = value && typeof value === "object" ? (value as Partial<FulvidSettings>) : {};

  const appearance: Partial<FulvidSettings["appearance"]> =
    source.appearance && typeof source.appearance === "object" ? source.appearance : {};
  const appearanceStatusbar: Partial<StatusbarSettings> =
    appearance.statusbar && typeof appearance.statusbar === "object" ? appearance.statusbar : {};
  const statusbarIndicators: Partial<Record<StatusbarIndicator, boolean>> =
    appearanceStatusbar.indicators && typeof appearanceStatusbar.indicators === "object"
      ? appearanceStatusbar.indicators
      : {};
  const editor: Partial<FulvidSettings["editor"]> =
    source.editor && typeof source.editor === "object" ? source.editor : {};

  const workspace: Partial<FulvidSettings["workspace"]> =
    source.workspace && typeof source.workspace === "object" ? source.workspace : {};
  const links: Partial<FulvidSettings["links"]> =
    source.links && typeof source.links === "object" ? source.links : {};
  const preview: Partial<FulvidSettings["preview"]> =
    source.preview && typeof source.preview === "object" ? source.preview : {};
  const linkMode: LinkMode =
    links.linkMode === "markdown" || links.linkMode === "wikilink"
      ? links.linkMode
      : DEFAULT_SETTINGS.links.linkMode;
  const workspaceStartup: WorkspaceStartup =
    workspace.workspaceStartup === "none" || workspace.workspaceStartup === "last"
      ? workspace.workspaceStartup
      : DEFAULT_SETTINGS.workspace.workspaceStartup;

  return {
    locale: VALID_LOCALES.has(source.locale as Locale)
      ? (source.locale as Locale)
      : DEFAULT_SETTINGS.locale,
    appearance: {
      theme: themeFromPersistedAppearance(appearance),
      interfaceTextScale: VALID_INTERFACE_TEXT_SCALES.has(
        appearance.interfaceTextScale as InterfaceTextScale,
      )
        ? (appearance.interfaceTextScale as InterfaceTextScale)
        : DEFAULT_SETTINGS.appearance.interfaceTextScale,
      iconScale: VALID_ICON_SCALES.has(appearance.iconScale as IconScale)
        ? (appearance.iconScale as IconScale)
        : DEFAULT_SETTINGS.appearance.iconScale,
      density: VALID_INTERFACE_DENSITIES.has(appearance.density as InterfaceDensity)
        ? (appearance.density as InterfaceDensity)
        : DEFAULT_SETTINGS.appearance.density,
      reducedMotion:
        typeof appearance.reducedMotion === "boolean"
          ? appearance.reducedMotion
          : DEFAULT_SETTINGS.appearance.reducedMotion,
      statusbar: {
        enabled:
          typeof appearanceStatusbar.enabled === "boolean"
            ? appearanceStatusbar.enabled
            : DEFAULT_SETTINGS.appearance.statusbar.enabled,
        indicators: {
          document:
            typeof statusbarIndicators.document === "boolean"
              ? statusbarIndicators.document
              : DEFAULT_SETTINGS.appearance.statusbar.indicators.document,
          language:
            typeof statusbarIndicators.language === "boolean"
              ? statusbarIndicators.language
              : DEFAULT_SETTINGS.appearance.statusbar.indicators.language,
          linkMode:
            typeof statusbarIndicators.linkMode === "boolean"
              ? statusbarIndicators.linkMode
              : DEFAULT_SETTINGS.appearance.statusbar.indicators.linkMode,
          workspace:
            typeof statusbarIndicators.workspace === "boolean"
              ? statusbarIndicators.workspace
              : DEFAULT_SETTINGS.appearance.statusbar.indicators.workspace,
          characters:
            typeof statusbarIndicators.characters === "boolean"
              ? statusbarIndicators.characters
              : DEFAULT_SETTINGS.appearance.statusbar.indicators.characters,
          eol:
            typeof statusbarIndicators.eol === "boolean"
              ? statusbarIndicators.eol
              : DEFAULT_SETTINGS.appearance.statusbar.indicators.eol,
        },
      },
    },
    editor: {
      fontSize:
        typeof editor.fontSize === "number" && Number.isFinite(editor.fontSize)
          ? Math.min(24, Math.max(10, editor.fontSize))
          : DEFAULT_SETTINGS.editor.fontSize,
      fontFamily: VALID_EDITOR_FONT_FAMILIES.has(editor.fontFamily as EditorFontFamily)
        ? (editor.fontFamily as EditorFontFamily)
        : DEFAULT_SETTINGS.editor.fontFamily,
      lineHeight: VALID_EDITOR_LINE_HEIGHTS.has(editor.lineHeight as EditorLineHeight)
        ? (editor.lineHeight as EditorLineHeight)
        : DEFAULT_SETTINGS.editor.lineHeight,
      tabSize: VALID_EDITOR_TAB_SIZES.has(editor.tabSize as EditorTabSize)
        ? (editor.tabSize as EditorTabSize)
        : DEFAULT_SETTINGS.editor.tabSize,
      defaultEol: VALID_EDITOR_DEFAULT_EOL.has(editor.defaultEol as EditorDefaultEol)
        ? (editor.defaultEol as EditorDefaultEol)
        : DEFAULT_SETTINGS.editor.defaultEol,
      insertSpaces:
        typeof editor.insertSpaces === "boolean"
          ? editor.insertSpaces
          : DEFAULT_SETTINGS.editor.insertSpaces,
      wordWrap: VALID_EDITOR_WORD_WRAP.has(editor.wordWrap as EditorWordWrap)
        ? (editor.wordWrap as EditorWordWrap)
        : DEFAULT_SETTINGS.editor.wordWrap,
      autoIndent:
        typeof editor.autoIndent === "boolean"
          ? editor.autoIndent
          : DEFAULT_SETTINGS.editor.autoIndent,
      lineNumbers:
        typeof editor.lineNumbers === "boolean"
          ? editor.lineNumbers
          : DEFAULT_SETTINGS.editor.lineNumbers,
      minimap:
        typeof editor.minimap === "boolean" ? editor.minimap : DEFAULT_SETTINGS.editor.minimap,
      stickyScroll:
        typeof editor.stickyScroll === "boolean"
          ? editor.stickyScroll
          : DEFAULT_SETTINGS.editor.stickyScroll,
      renderWhitespace: VALID_EDITOR_RENDER_WHITESPACE.has(
        editor.renderWhitespace as EditorRenderWhitespace,
      )
        ? (editor.renderWhitespace as EditorRenderWhitespace)
        : DEFAULT_SETTINGS.editor.renderWhitespace,
      trimTrailingWhitespaceOnSave:
        typeof (editor as { trimTrailingWhitespaceOnSave?: unknown })
          .trimTrailingWhitespaceOnSave === "boolean"
          ? (editor as { trimTrailingWhitespaceOnSave: boolean }).trimTrailingWhitespaceOnSave
          : DEFAULT_SETTINGS.editor.trimTrailingWhitespaceOnSave,
      showMarkdownFormatBar:
        typeof (editor as { showMarkdownFormatBar?: unknown }).showMarkdownFormatBar === "boolean"
          ? (editor as { showMarkdownFormatBar: boolean }).showMarkdownFormatBar
          : DEFAULT_SETTINGS.editor.showMarkdownFormatBar,
      showDocumentAnnotations:
        typeof (editor as { showDocumentAnnotations?: unknown }).showDocumentAnnotations ===
        "boolean"
          ? (editor as { showDocumentAnnotations: boolean }).showDocumentAnnotations
          : DEFAULT_SETTINGS.editor.showDocumentAnnotations,
      readingStatistics: VALID_READING_STATISTICS.has(
        editor.readingStatistics as ReadingStatisticsMode,
      )
        ? (editor.readingStatistics as ReadingStatisticsMode)
        : DEFAULT_SETTINGS.editor.readingStatistics,
      typewriterScrolling:
        typeof editor.typewriterScrolling === "boolean"
          ? editor.typewriterScrolling
          : DEFAULT_SETTINGS.editor.typewriterScrolling,
      documentLocation: DOCUMENT_LOCATION_DESTINATIONS.includes(
        editor.documentLocation as DocumentLocationDestination,
      )
        ? (editor.documentLocation as DocumentLocationDestination)
        : DEFAULT_SETTINGS.editor.documentLocation,
    },
    workspace: {
      showHiddenFiles:
        typeof workspace.showHiddenFiles === "boolean"
          ? workspace.showHiddenFiles
          : DEFAULT_SETTINGS.workspace.showHiddenFiles,
      workspaceStartup,
      confirmClose:
        typeof workspace.confirmClose === "boolean"
          ? workspace.confirmClose
          : DEFAULT_SETTINGS.workspace.confirmClose,
    },
    links: {
      linkMode,
      resolution:
        links.resolution === "stem" || links.resolution === "path" || links.resolution === "both"
          ? links.resolution
          : DEFAULT_SETTINGS.links.resolution,
      defaultExtension:
        links.defaultExtension === "md" ||
        links.defaultExtension === "markdown" ||
        links.defaultExtension === "mdx"
          ? links.defaultExtension
          : DEFAULT_SETTINGS.links.defaultExtension,
      showIncomingLinks:
        typeof links.showIncomingLinks === "boolean"
          ? links.showIncomingLinks
          : DEFAULT_SETTINGS.links.showIncomingLinks,
      showOutgoingLinks:
        typeof links.showOutgoingLinks === "boolean"
          ? links.showOutgoingLinks
          : DEFAULT_SETTINGS.links.showOutgoingLinks,
    },
    preview: {
      enabled:
        typeof preview.enabled === "boolean" ? preview.enabled : DEFAULT_SETTINGS.preview.enabled,
    },
  };
}

function loadSettings(): FulvidSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return structuredClone(DEFAULT_SETTINGS);
    }
    const sanitized = sanitizeSettings(JSON.parse(raw));
    // Rewrite old settings after sanitizing so removed preferences do not
    // remain as a second source of truth in localStorage.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
    } catch {
      // A read-only or full storage must not prevent the app from starting.
    }
    return sanitized;
  } catch {
    // Corrupt JSON must not remain as a permanent poison pill: heal storage so
    // the next cold start does not keep hitting the same catch path.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS));
    } catch {
      // A read-only or full storage must not prevent the app from starting.
    }
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function appearanceDatasetFor(
  appearance: FulvidSettings["appearance"],
): Record<string, string> {
  return {
    theme: appearance.theme,
    interfaceTextScale: appearance.interfaceTextScale,
    iconScale: appearance.iconScale,
    density: appearance.density,
  };
}

export const settings = ref<FulvidSettings>(loadSettings());
setDocumentLinkSettings(settings.value.links);

/**
 * Re-read persisted settings into the live ref (corrupt-storage heal / tests).
 * Does not invent a second settings owner.
 */
export function reloadSettings(): void {
  settings.value = loadSettings();
  setDocumentLinkSettings(settings.value.links);
}

/** Clone of the built-in defaults. Does not read localStorage. */
export function defaultSettings(): FulvidSettings {
  return structuredClone(DEFAULT_SETTINGS);
}

/**
 * Restore every persisted preference to DEFAULT_SETTINGS in one assignment.
 * Does not touch documents, Folder, layout, session chrome, or grants.
 * The settings watcher persists and reapplies appearance / link mode.
 * Callers that own session presentation (e.g. annotation visibility) sync
 * from the restored preference separately.
 */
export function resetSettingsToDefaults(): void {
  settings.value = defaultSettings();
}

function applyAppearance(appearance: FulvidSettings["appearance"]): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  Object.assign(root.dataset, appearanceDatasetFor(appearance));
  if (appearance.reducedMotion) {
    root.dataset.reducedMotion = "true";
  } else {
    delete root.dataset.reducedMotion;
  }
}

/**
 * Merge a partial update into the persisted settings, then sanitize.
 *
 * Nested objects replace field-by-field, not wholesale, so a locale patch
 * cannot drop editor preferences. Invalid values fall back per field.
 */
export function patchSettings(partial: Partial<FulvidSettings>): void {
  const nextSettings: FulvidSettings = {
    locale: partial.locale ?? settings.value.locale,
    appearance: {
      ...settings.value.appearance,
      ...partial.appearance,
      statusbar: {
        ...settings.value.appearance.statusbar,
        ...partial.appearance?.statusbar,
        indicators: {
          ...settings.value.appearance.statusbar.indicators,
          ...partial.appearance?.statusbar?.indicators,
        },
      },
    },
    editor: {
      ...settings.value.editor,
      ...partial.editor,
    },
    workspace: {
      ...settings.value.workspace,
      ...partial.workspace,
    },
    links: {
      ...settings.value.links,
      ...partial.links,
    },
    preview: {
      ...settings.value.preview,
      ...partial.preview,
    },
  };
  settings.value = sanitizeSettings(nextSettings);
}

watch(
  settings,
  (value) => {
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      } catch {
        // A read-only or full storage must not prevent appearance updates.
      }
    }
    applyAppearance(value.appearance);
    setDocumentLinkSettings(value.links);
  },
  { deep: true },
);

applyAppearance(settings.value.appearance);
