/**
 * Contextual Markdown/MDX completion decisions.
 *
 * Monaco owns the widget, snippets, and accept keys. This module only answers
 * which Fulvid suggestion belongs at the current prefix.
 */

export type MarkdownSnippetKind =
  | "heading"
  | "list"
  | "orderedList"
  | "fence"
  | "quote"
  | "link"
  | "image"
  | "table"
  | "frontmatter";

export type MdxCompletionKind = "element" | "attribute" | "expression";

const SNIPPET_TOKENS = [
  ["![", "image"],
  ["[", "link"],
  ["#", "heading"],
  ["- ", "list"],
  ["1. ", "orderedList"],
  ["```", "fence"],
  ["> ", "quote"],
  ["|", "table"],
] as const;

export const MARKDOWN_TABLE_SNIPPET =
  "| ${1:Header} | ${2:Header} |\n| --- | --- |\n| ${3:Cell} | ${4:Cell} |";

export function isWritingLanguage(languageId: string): languageId is "markdown" | "mdx" {
  return languageId === "markdown" || languageId === "mdx";
}

export function markdownSnippetKind(
  before: string,
  languageId: string,
  lineNumber: number,
): MarkdownSnippetKind | null {
  if (/\]\([^)\n]*$/.test(before) || /\[\[[^\]\n]*$/.test(before) || before.trim().length === 0) {
    return null;
  }

  const token = SNIPPET_TOKENS.find(([prefix]) => before.endsWith(prefix))?.[1] ?? null;
  if (token) {
    return token;
  }

  if (isWritingLanguage(languageId) && lineNumber === 1 && before === "---") {
    return "frontmatter";
  }

  return null;
}

export function fenceLanguageQuery(before: string): string | null {
  const match = before.match(/(?:^|\s)(`{3,}|~{3,})([A-Za-z0-9_-]*)$/);
  return match ? (match[2] ?? "") : null;
}

export function mdxCompletionKind(languageId: string, before: string): MdxCompletionKind | null {
  if (languageId !== "mdx") {
    return null;
  }
  if (/<([A-Za-z][\w.-]*)?$/.test(before)) {
    return "element";
  }
  if (/<([A-Za-z][\w.-]*)\s+([A-Za-z][\w-]*)?$/.test(before)) {
    return "attribute";
  }
  if (/\{\w*$/.test(before)) {
    return "expression";
  }
  return null;
}
