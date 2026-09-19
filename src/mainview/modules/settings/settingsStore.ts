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
import {
  DOCUMENT_LOCATION_DESTINATIONS,
  type DocumentLocationDestination,
} from "../editor/document/documentLocation";
import {
  DEFAULT_THEME,
  THEME_PREFERENCES,
  type ThemePreference,
} from "../editor/monaco/monacoThemes";

export type Locale = "de" | "en" | "es" | "fr" | "it" | "nl" | "pt";
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
  /**
   * Presentation only: when false, hide Session Change Markers and Preview.
   * Baseline and change tracking continue for document lifecycle.
   */
  showSessionChanges: boolean;
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
    showMarkdownFormatBar: true,
    showDocumentAnnotations: true,
    showSessionChanges: true,
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

const VALID_LOCALES: readonly Locale[] = ["de", "en", "es", "fr", "it", "nl", "pt"];
const VALID_EDITOR_FONT_FAMILIES: readonly EditorFontFamily[] = ["monospace", "system", "serif"];
const VALID_EDITOR_LINE_HEIGHTS: readonly EditorLineHeight[] = ["auto", "compact", "comfortable"];
const VALID_EDITOR_TAB_SIZES: readonly EditorTabSize[] = [2, 4, 8];
const VALID_EDITOR_DEFAULT_EOL: readonly EditorDefaultEol[] = ["lf", "crlf"];
const VALID_EDITOR_WORD_WRAP: readonly EditorWordWrap[] = ["on", "off", "bounded"];
const VALID_EDITOR_RENDER_WHITESPACE: readonly EditorRenderWhitespace[] = [
  "none",
  "selection",
  "all",
];
const VALID_INTERFACE_TEXT_SCALES: readonly InterfaceTextScale[] = ["small", "normal", "large"];
const VALID_ICON_SCALES: readonly IconScale[] = ["small", "normal", "large"];
const VALID_INTERFACE_DENSITIES: readonly InterfaceDensity[] = ["normal", "compact"];
const VALID_READING_STATISTICS: readonly ReadingStatisticsMode[] = ["off", "words", "wordsAndTime"];

/** A persisted value when it is one of `allowed`, otherwise the default. */
function oneOf<T>(allowed: readonly T[], value: unknown, fallback: T): T {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

/** A persisted boolean, otherwise the default. */
function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** A nested settings group, or an empty one when storage holds something else. */
function group<T>(value: T | undefined): Partial<T> {
  return value && typeof value === "object" ? value : {};
}

/**
 * Current key `showSessionChanges`; accept legacy `showSessionChangePreview` so a
 * previously disabled preference is not silently turned back on. loadSettings
 * rewrites storage to the sanitized shape (legacy key dropped).
 */
function resolveShowSessionChanges(editor: object): boolean {
  const record = editor as {
    showSessionChanges?: unknown;
    showSessionChangePreview?: unknown;
  };
  if (typeof record.showSessionChanges === "boolean") {
    return record.showSessionChanges;
  }
  if (typeof record.showSessionChangePreview === "boolean") {
    return record.showSessionChangePreview;
  }
  return DEFAULT_SETTINGS.editor.showSessionChanges;
}

export function sanitizeSettings(value: unknown): FulvidSettings {
  const source = group(value as Partial<FulvidSettings> | undefined);
  const appearance = group(source.appearance);
  const statusbar = group(appearance.statusbar);
  const indicators = group(statusbar.indicators);
  const editor = group(source.editor);
  const workspace = group(source.workspace);
  const links = group(source.links);
  const preview = group(source.preview);
  const defaults = DEFAULT_SETTINGS;

  return {
    locale: oneOf(VALID_LOCALES, source.locale, defaults.locale),
    appearance: {
      theme: oneOf(THEME_PREFERENCES, appearance.theme, DEFAULT_THEME),
      interfaceTextScale: oneOf(
        VALID_INTERFACE_TEXT_SCALES,
        appearance.interfaceTextScale,
        defaults.appearance.interfaceTextScale,
      ),
      iconScale: oneOf(VALID_ICON_SCALES, appearance.iconScale, defaults.appearance.iconScale),
      density: oneOf(VALID_INTERFACE_DENSITIES, appearance.density, defaults.appearance.density),
      reducedMotion: booleanOr(appearance.reducedMotion, defaults.appearance.reducedMotion),
      statusbar: {
        enabled: booleanOr(statusbar.enabled, defaults.appearance.statusbar.enabled),
        indicators: {
          document: booleanOr(
            indicators.document,
            defaults.appearance.statusbar.indicators.document,
          ),
          language: booleanOr(
            indicators.language,
            defaults.appearance.statusbar.indicators.language,
          ),
          linkMode: booleanOr(
            indicators.linkMode,
            defaults.appearance.statusbar.indicators.linkMode,
          ),
          workspace: booleanOr(
            indicators.workspace,
            defaults.appearance.statusbar.indicators.workspace,
          ),
          characters: booleanOr(
            indicators.characters,
            defaults.appearance.statusbar.indicators.characters,
          ),
          eol: booleanOr(indicators.eol, defaults.appearance.statusbar.indicators.eol),
        },
      },
    },
    editor: {
      fontSize:
        typeof editor.fontSize === "number" && Number.isFinite(editor.fontSize)
          ? Math.min(24, Math.max(10, editor.fontSize))
          : defaults.editor.fontSize,
      fontFamily: oneOf(VALID_EDITOR_FONT_FAMILIES, editor.fontFamily, defaults.editor.fontFamily),
      lineHeight: oneOf(VALID_EDITOR_LINE_HEIGHTS, editor.lineHeight, defaults.editor.lineHeight),
      tabSize: oneOf(VALID_EDITOR_TAB_SIZES, editor.tabSize, defaults.editor.tabSize),
      defaultEol: oneOf(VALID_EDITOR_DEFAULT_EOL, editor.defaultEol, defaults.editor.defaultEol),
      insertSpaces: booleanOr(editor.insertSpaces, defaults.editor.insertSpaces),
      wordWrap: oneOf(VALID_EDITOR_WORD_WRAP, editor.wordWrap, defaults.editor.wordWrap),
      autoIndent: booleanOr(editor.autoIndent, defaults.editor.autoIndent),
      lineNumbers: booleanOr(editor.lineNumbers, defaults.editor.lineNumbers),
      minimap: booleanOr(editor.minimap, defaults.editor.minimap),
      stickyScroll: booleanOr(editor.stickyScroll, defaults.editor.stickyScroll),
      renderWhitespace: oneOf(
        VALID_EDITOR_RENDER_WHITESPACE,
        editor.renderWhitespace,
        defaults.editor.renderWhitespace,
      ),
      trimTrailingWhitespaceOnSave: booleanOr(
        editor.trimTrailingWhitespaceOnSave,
        defaults.editor.trimTrailingWhitespaceOnSave,
      ),
      showMarkdownFormatBar: booleanOr(
        editor.showMarkdownFormatBar,
        defaults.editor.showMarkdownFormatBar,
      ),
      showDocumentAnnotations: booleanOr(
        editor.showDocumentAnnotations,
        defaults.editor.showDocumentAnnotations,
      ),
      showSessionChanges: resolveShowSessionChanges(editor),
      readingStatistics: oneOf(
        VALID_READING_STATISTICS,
        editor.readingStatistics,
        defaults.editor.readingStatistics,
      ),
      typewriterScrolling: booleanOr(
        editor.typewriterScrolling,
        defaults.editor.typewriterScrolling,
      ),
      documentLocation: oneOf(
        DOCUMENT_LOCATION_DESTINATIONS,
        editor.documentLocation,
        defaults.editor.documentLocation,
      ),
    },
    workspace: {
      showHiddenFiles: booleanOr(workspace.showHiddenFiles, defaults.workspace.showHiddenFiles),
      workspaceStartup: oneOf(
        ["none", "last"],
        workspace.workspaceStartup,
        defaults.workspace.workspaceStartup,
      ),
      confirmClose: booleanOr(workspace.confirmClose, defaults.workspace.confirmClose),
    },
    links: {
      linkMode: oneOf(["markdown", "wikilink"], links.linkMode, defaults.links.linkMode),
      resolution: oneOf(["stem", "path", "both"], links.resolution, defaults.links.resolution),
      defaultExtension: oneOf(
        ["md", "markdown", "mdx"],
        links.defaultExtension,
        defaults.links.defaultExtension,
      ),
      showIncomingLinks: booleanOr(links.showIncomingLinks, defaults.links.showIncomingLinks),
      showOutgoingLinks: booleanOr(links.showOutgoingLinks, defaults.links.showOutgoingLinks),
    },
    preview: {
      enabled: booleanOr(preview.enabled, defaults.preview.enabled),
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
