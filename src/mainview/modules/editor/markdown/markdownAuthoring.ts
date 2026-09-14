/**
 * Small Markdown authoring helpers: link strings and TOC from existing structure.
 *
 * Not a structural-editing framework. Consumers insert the returned text via Monaco.
 * Link syntax follows the single settings `linkMode`. Anchors use `headingAnchor`
 * / `parseMarkdownStructure` elsewhere — this module does not re-parse headings.
 */
import type { LinkSyntax } from "../../document/links/documentLink";
import type { MarkdownHeading } from "./markdownStructure";

export type FormatDocumentLinkInput = {
  /** Visible label; sanitized for the active link syntax. */
  label: string;
  /**
   * Document target path (folder-relative or `./…`). Empty when linking only
   * to a heading in the current document (`#anchor` / `[[#anchor]]`).
   */
  target: string;
  /** Heading fragment without `#`. */
  anchor?: string;
  linkMode: LinkSyntax;
};

/** Relative path from one folder-relative document path to another. */
export function relativeDocumentLinkPath(sourcePath: string, targetPath: string): string {
  if (!sourcePath) {
    return targetPath;
  }
  const sourceSegments = sourcePath.split("/").filter(Boolean);
  sourceSegments.pop();
  const targetSegments = targetPath.split("/").filter(Boolean);
  let common = 0;
  while (
    common < sourceSegments.length &&
    common < targetSegments.length &&
    sourceSegments[common] === targetSegments[common]
  ) {
    common += 1;
  }
  const upward = sourceSegments.slice(common).map(() => "..");
  const downward = targetSegments.slice(common);
  const relative = [...upward, ...downward].join("/");
  return upward.length === 0 ? `./${relative}` : relative;
}

function sanitizeMarkdownLabel(label: string): string {
  return label.replace(/[[\]]/g, "").trim() || "link";
}

function sanitizeWikilinkLabel(label: string): string {
  return label.replace(/[[\]|]/g, "").trim() || "link";
}

/**
 * Build a single document/section link in the active `linkMode`.
 * Result is ordinary Markdown/wikilink source — no HTML.
 */
export function formatDocumentLink(input: FormatDocumentLinkInput): string {
  const anchor = input.anchor?.trim() || "";
  const target = input.target.trim();
  const href = `${target}${anchor ? `#${anchor}` : ""}`;

  if (input.linkMode === "wikilink") {
    const label = sanitizeWikilinkLabel(input.label);
    if (!href) {
      return `[[${label}]]`;
    }
    const showLabel = label && label !== target && label !== anchor && label !== href;
    return showLabel ? `[[${href}|${label}]]` : `[[${href}]]`;
  }

  const label = sanitizeMarkdownLabel(input.label);
  return `[${label}](${href || "#"})`;
}

export type DocumentFromSelectionInput = {
  selection: string;
  /** Folder-relative path of the source document when a backlink should be appended. */
  sourcePath?: string;
  sourceLabel?: string;
  linkMode: LinkSyntax;
};

/**
 * Body for a new untitled document seeded from the editor selection.
 * Optional backlink uses {@link formatDocumentLink} only - never line addresses.
 * The selected text is preserved exactly; the link is appended after it.
 */
export function buildDocumentFromSelection(input: DocumentFromSelectionInput): string {
  const body = input.selection;
  const sourcePath = input.sourcePath?.trim();
  if (!sourcePath) {
    return body;
  }
  const link = formatDocumentLink({
    label: input.sourceLabel?.trim() || sourcePath,
    target: sourcePath,
    linkMode: input.linkMode,
  });
  const separator = body.length === 0 || body.endsWith("\n") ? "\n" : "\n\n";
  return `${body}${separator}${link}\n`;
}

export type TableOfContentsOptions = {
  linkMode: LinkSyntax;
};

/**
 * Deterministic TOC from already-parsed headings of the current document.
 * Same-document fragment links only. Empty headings → empty string.
 */
export function buildMarkdownTableOfContents(
  headings: readonly MarkdownHeading[],
  options: TableOfContentsOptions,
): string {
  if (headings.length === 0) {
    return "";
  }
  const minDepth = Math.min(...headings.map((heading) => heading.depth));
  const lines = headings.map((heading) => {
    const indent = "  ".repeat(Math.max(0, heading.depth - minDepth));
    const link = formatDocumentLink({
      label: heading.text,
      target: "",
      anchor: heading.anchor,
      linkMode: options.linkMode,
    });
    return `${indent}- ${link}`;
  });
  return `${lines.join("\n")}\n`;
}
