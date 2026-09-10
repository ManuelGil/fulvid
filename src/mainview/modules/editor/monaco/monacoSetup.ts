/**
 * Register Markdown/MDX languages and Monaco themes for this process.
 *
 * Not an LSP. Completions, markers, and navigation live in
 * `documentLanguage.ts` and attach per workspace model.
 */
import * as monaco from "monaco-editor/editor";
import "monaco-editor/languages/definitions/markdown/register";
import {
  conf as markdownConfiguration,
  language as markdownTokens,
} from "monaco-editor/languages/definitions/markdown/markdown";
// monaco-editor 0.56.0 `exports` rewrites `monaco-editor/esm/vs/...` onto a
// doubled `esm/vs` path. The filesystem import avoids that map. Prefer a
// package export (`monaco-editor/editor/editor.worker`) only after an upgrade
// where Vite 8 + WebKitGTK still load the worker.
import MonacoEditorWorker from "../../../../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker";
import { monacoThemeBase, type ThemePreference, resolveMonacoThemeId } from "./monacoThemes";

type MonacoEnvironment = {
  getWorker: (workerId: string, label: string) => Worker;
};

type MonacoPalette = {
  background: string;
  foreground: string;
  muted: string;
  heading: string;
  link: string;
  code: string;
  selection: string;
  selectionForeground: string;
  lineHighlight: string;
  border: string;
  widgetBackground: string;
  accent: string;
};

let initialized = false;

function tokenColor(value: string, fallback: string): string {
  const normalized = value.trim().replace(/^#/, "");
  return /^[0-9a-f]{6,8}$/i.test(normalized) ? normalized : fallback.replace(/^#/, "");
}

function cssThemeColor(variable: string, fallback: string): string {
  if (typeof document === "undefined") {
    return fallback;
  }

  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || fallback;
}

function currentMonacoPalette(): MonacoPalette {
  return {
    background: cssThemeColor("--background", "#0d1117"),
    foreground: cssThemeColor("--text-primary", "#c9d1d9"),
    muted: cssThemeColor("--text-muted", "#8b949e"),
    heading: cssThemeColor("--text-heading", "#d2a8ff"),
    link: cssThemeColor("--text-link", "#58a6ff"),
    code: cssThemeColor("--text-code", "#ffa657"),
    selection: cssThemeColor("--selection", "#264f78"),
    selectionForeground: cssThemeColor("--selection-foreground", "#ffffff"),
    lineHighlight: cssThemeColor("--surface-hover", "#161b22"),
    border: cssThemeColor("--border", "#30363d"),
    widgetBackground: cssThemeColor("--surface-elevated", "#161b22"),
    accent: cssThemeColor("--accent-text", "#58a6ff"),
  };
}

function configureWorker(): void {
  const environment = globalThis as typeof globalThis & {
    MonacoEnvironment?: MonacoEnvironment;
  };

  // Return Vite's worker constructor so Monaco never falls through to its
  // default URL/blob loader. CSP for workers lives in src/mainview/index.html.
  environment.MonacoEnvironment = {
    getWorker: () => new MonacoEditorWorker(),
  };
}

function markdownTokensWithWikilinks(): typeof markdownTokens {
  const tokenizer = markdownTokens.tokenizer as Record<string, unknown>;
  const linecontent = Array.isArray(tokenizer.linecontent) ? tokenizer.linecontent : [];
  return {
    ...markdownTokens,
    tokenizer: {
      ...tokenizer,
      linecontent: [[/\[\[[^\]\n]+\]\]/, "string.link"], ...linecontent],
    },
  } as typeof markdownTokens;
}

function markdownLanguageConfiguration(): typeof markdownConfiguration {
  // Monaco already closes (), [], {}, and <>. Fulvid adds quotes/backticks
  // and indent rules; list/quote/fence continuation lives in markdownEnter.
  return {
    ...markdownConfiguration,
    brackets: [...(markdownConfiguration.brackets ?? []), ["<", ">"]],
    autoClosingPairs: [
      ...(markdownConfiguration.autoClosingPairs ?? []),
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: "`", close: "`" },
    ],
    surroundingPairs: [
      ...(markdownConfiguration.surroundingPairs ?? []),
      { open: "{", close: "}" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: "<", close: ">" },
    ],
    indentationRules: {
      increaseIndentPattern:
        /^\s*(?:(?:[-+*]|\d+[.)])\s+.+|>\s+.+|(?:`{3,}|~{3,})\s*[A-Za-z0-9_-]*\s*)$/,
      decreaseIndentPattern: /^\s*(?:(?:[-+*]|\d+[.)])\s*|>\s*|(?:`{3,}|~{3,})\s*)$/,
      indentNextLinePattern: /^\s*(?:`{3,}|~{3,})\s*[A-Za-z0-9_-]*\s*$/,
    },
  };
}

function registerLanguages(): void {
  const registered = new Set(monaco.languages.getLanguages().map((language) => language.id));

  if (!registered.has("mdx")) {
    monaco.languages.register({
      id: "mdx",
      extensions: [".mdx"],
      aliases: ["MDX"],
    });
  }

  // Keep Monaco's Markdown language services intact while adding the active
  // document-link syntax as a token-only visual rule. MDX has no bundled
  // language, so it reuses the same configuration and tokenization.
  const markdownWithWikilinks = markdownTokensWithWikilinks();
  const markdownConfigurationWithEditing = markdownLanguageConfiguration();
  monaco.languages.setMonarchTokensProvider("markdown", markdownWithWikilinks);
  monaco.languages.setLanguageConfiguration("markdown", markdownConfigurationWithEditing);
  monaco.languages.setLanguageConfiguration("mdx", markdownConfigurationWithEditing);
  monaco.languages.setMonarchTokensProvider("mdx", markdownWithWikilinks);
}

function defineTheme(
  name: string,
  base: "vs" | "vs-dark" | "hc-black",
  palette: MonacoPalette,
): void {
  monaco.editor.defineTheme(name, {
    base,
    inherit: true,
    rules: [
      { token: "comment", foreground: tokenColor(palette.muted, "#7a8491") },
      { token: "string", foreground: tokenColor(palette.code, "#953800") },
      { token: "variable.source", foreground: tokenColor(palette.code, "#953800") },
      { token: "string.link", foreground: tokenColor(palette.link, "#0969da") },
      { token: "string.target", foreground: tokenColor(palette.link, "#0969da") },
      { token: "keyword", foreground: tokenColor(palette.heading, "#8250df") },
      { token: "keyword.table.header", foreground: tokenColor(palette.heading, "#8250df") },
      { token: "strong", foreground: tokenColor(palette.foreground, "#24292f"), fontStyle: "bold" },
      {
        token: "emphasis",
        foreground: tokenColor(palette.foreground, "#24292f"),
        fontStyle: "italic",
      },
      { token: "variable", foreground: tokenColor(palette.code, "#953800") },
      { token: "tag", foreground: tokenColor(palette.heading, "#8250df") },
    ],
    colors: {
      "editor.background": palette.background,
      "editor.foreground": palette.foreground,
      "editorLineNumber.foreground": palette.muted,
      "editorLineNumber.activeForeground": palette.foreground,
      "editorCursor.foreground": palette.accent,
      "editor.selectionBackground": palette.selection,
      "editor.selectionForeground": palette.selectionForeground,
      "editor.inactiveSelectionBackground": palette.selection,
      "editor.lineHighlightBackground": palette.lineHighlight,
      "editor.lineHighlightBorder": palette.border,
      "editorIndentGuide.background": palette.border,
      "editorIndentGuide.activeBackground": palette.accent,
      "editorWidget.background": palette.widgetBackground,
      "editorWidget.border": palette.border,
      "editorSuggestWidget.background": palette.widgetBackground,
      "editorSuggestWidget.border": palette.border,
      "editorSuggestWidget.selectedBackground": palette.selection,
      "editorHoverWidget.background": palette.widgetBackground,
      "editorHoverWidget.border": palette.border,
      "input.background": palette.widgetBackground,
      "input.border": palette.border,
      "inputOption.activeBackground": palette.selection,
      "inputOption.activeBorder": palette.accent,
      "editor.findMatchBackground": palette.selection,
      "editor.findMatchHighlightBackground": palette.selection,
      "editor.findRangeHighlightBackground": palette.selection,
      "editorStickyScroll.background": palette.background,
      "editorStickyScrollGutter.background": palette.background,
      "editorStickyScrollHover.background": palette.lineHighlight,
      "editorStickyScroll.border": palette.border,
      "editorOverviewRuler.border": palette.border,
    },
  });
}

/** Idempotent process setup. Safe to call before every `createModel`. */
export function initializeMonaco(): typeof monaco {
  if (!initialized) {
    configureWorker();
    registerLanguages();
    initialized = true;
  }

  return monaco;
}

export function currentMonacoTheme(theme: ThemePreference): string {
  return resolveMonacoThemeId(
    theme,
    window.matchMedia("(forced-colors: active)").matches,
    window.matchMedia("(prefers-color-scheme: light)").matches,
  );
}

/** Apply the theme built from CSS variables. High-contrast OS themes skip the custom palette. */
export function applyMonacoTheme(theme: ThemePreference): void {
  const themeId = currentMonacoTheme(theme);
  if (themeId !== "hc-light" && themeId !== "hc-black") {
    const base = monacoThemeBase(theme, window.matchMedia("(prefers-color-scheme: light)").matches);
    defineTheme(themeId, base, currentMonacoPalette());
  }
  monaco.editor.setTheme(themeId);
}

export function languageForPath(path: string): "markdown" | "mdx" {
  // Monaco already owns .md/.markdown. .mdx is Fulvid's extra language and
  // keeps the same Markdown editing surface plus MDX completions.
  return path.toLowerCase().endsWith(".mdx") ? "mdx" : "markdown";
}
