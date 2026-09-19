/**
 * Shared Markdown/MDX HTML for Preview and HTML Export.
 *
 * One renderer: GFM via marked, MDX inert, DocumentLink for internal links.
 * Do not add a second marked instance or parser for Export.
 */
import { Marked, marked, type TokenizerExtensionFunction } from "marked";

import {
  parseDocumentLinks,
  resolveDocumentLink,
  type DocumentLink,
  type LinkSyntax,
} from "../../document/links/documentLink";
import type { ScannedNote } from "../../workspace/filesystem/workspaceTypes";
import {
  parseMarkdownStructure,
  type MarkdownFence,
  type MarkdownHeading,
} from "./markdownStructure";

export type PreviewFrontmatterState = "none" | "omitted" | "unclosed";

export type MarkdownPreviewResult = {
  html: string;
  empty: boolean;
  frontmatter: PreviewFrontmatterState;
  hasUnsupportedMdx: boolean;
  failed: boolean;
  /** True when inline or block markup density forced the inert fallback. */
  dense: boolean;
};

/** Same cap Preview uses so Export HTML represents the same truncated source. */
export const PREVIEW_RENDER_CHAR_LIMIT = 200_000;

/**
 * Ceiling on inline markup constructs in one render.
 *
 * marked's inline lexer is quadratic in the number of inline constructs, so a
 * document can be inside the character cap and still take a minute to render -
 * long enough to freeze the renderer, which is single-threaded. The character
 * cap measures the wrong dimension for that cost, so density is capped too.
 *
 * Prose does not reach this: the limit is about link/emphasis/code markers, and
 * a document with thousands of them is a generated index or a hostile file, not
 * writing. Over the ceiling, Preview and Export show the source inert instead of
 * blocking, the same way the character cap degrades.
 */
export const PREVIEW_INLINE_MARKUP_LIMIT = 2_000;

/**
 * Count inline constructs whose cost is superlinear upstream.
 *
 * One linear pass over the source. Deliberately approximate: it needs to bound
 * work before marked runs, not to agree with marked's tokenizer.
 */
const INLINE_MARKUP_RE = /!?\[|\]\(|`|~~|\bhttps?:\/\/|[*_]{1,2}(?=[^\s*_])/g;

function countInlineMarkup(source: string): number {
  INLINE_MARKUP_RE.lastIndex = 0;
  let count = 0;
  while (INLINE_MARKUP_RE.exec(source) !== null) {
    count += 1;
    if (count > PREVIEW_INLINE_MARKUP_LIMIT) {
      return count;
    }
  }
  return count;
}

/**
 * Ceiling on block constructs that are ambiguous between a setext underline
 * and a list item.
 *
 * A line holding nothing but `-`, `*` or `+` directly under paragraph text can
 * be read either way, and resolving it costs marked superlinear time: 4,000
 * such lines - 16 kB, well inside the character cap, with no inline markup at
 * all - take over twenty seconds and freeze the single-threaded renderer.
 *
 * Writing does not produce this shape. A real setext underline is a run
 * (`---`), and a real list item has content after its marker; both are far
 * below this ceiling. Over it, Preview and Export show the source inert, the
 * same way the character and inline-markup caps degrade.
 */
export const PREVIEW_BLOCK_MARKER_LIMIT = 500;

const BARE_LIST_MARKER_RE = /^ {0,3}[-*+]$/;

/**
 * Count bare list markers that sit directly under a non-blank line, outside
 * fenced code. One linear pass; fenced content is free because marked never
 * resolves the ambiguity there.
 */
function countAmbiguousBlockMarkers(
  lines: readonly string[],
  fences: readonly MarkdownFence[],
): number {
  let fenceIndex = 0;
  let count = 0;
  for (let index = 1; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    while (fenceIndex < fences.length && fences[fenceIndex].endLine <= lineNumber) {
      fenceIndex += 1;
    }
    const fence = fences[fenceIndex];
    if (fence && lineNumber > fence.startLine && lineNumber < fence.endLine) {
      continue;
    }
    if ((lines[index - 1] ?? "").trim() === "") {
      continue;
    }
    if (BARE_LIST_MARKER_RE.test(lines[index] ?? "")) {
      count += 1;
      if (count > PREVIEW_BLOCK_MARKER_LIMIT) {
        return count;
      }
    }
  }
  return count;
}

export type MarkdownPreviewDocument = {
  html: string;
  preview: MarkdownPreviewResult;
};

type PreviewSource = {
  text: string;
  lineOffset: number;
  frontmatter: PreviewFrontmatterState;
};

const JSX_TAG_RE = /<\/?[A-Z][\w.-]*[\s/>]/;

/** Preview-only: closed frontmatter is omitted; unclosed YAML stays in the body. Link parse uses a stricter ignore range. */
function stripFrontmatter(content: string): PreviewSource {
  const closed = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (closed) {
    return {
      text: content.slice(closed[0].length),
      lineOffset: closed[0].split(/\r?\n/).length - 1,
      frontmatter: "omitted",
    };
  }

  const firstLine = content.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (firstLine === "---") {
    return { text: content, lineOffset: 0, frontmatter: "unclosed" };
  }

  return { text: content, lineOffset: 0, frontmatter: "none" };
}

/**
 * True when a line outside fenced code looks like JSX.
 *
 * Fences are walked with a cursor rather than searched per line: scanning the
 * whole fence list for every line is quadratic, and a document of code blocks
 * reaches the character cap long before it reaches a readable length.
 */
function hasUnsupportedMdx(lines: readonly string[], fences: readonly MarkdownFence[]): boolean {
  let fenceIndex = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    while (fenceIndex < fences.length && fences[fenceIndex].endLine <= lineNumber) {
      fenceIndex += 1;
    }
    const fence = fences[fenceIndex];
    if (fence && lineNumber > fence.startLine && lineNumber < fence.endLine) {
      continue;
    }
    if (JSX_TAG_RE.test(lines[index] ?? "")) {
      return true;
    }
  }
  return false;
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

function documentHref(path: string, anchor?: string): string {
  return `#document/${encodeURIComponent(path)}${anchor ? `#${encodeURIComponent(anchor)}` : ""}`;
}

function renderInternalDocumentAnchor(
  path: string,
  innerHtml: string,
  options?: { anchor?: string; title?: string | null },
): string {
  const titleValue = options?.title ? ` title="${escapeHtml(options.title)}"` : "";
  return `<a href="${escapeHtml(documentHref(path, options?.anchor))}" data-document-path="${escapeHtml(
    path,
  )}"${
    options?.anchor ? ` data-document-anchor="${escapeHtml(options.anchor)}"` : ""
  }${titleValue}>${innerHtml}</a>`;
}

function renderResolvedLink(
  link: DocumentLink,
  label: string,
  notes: ScannedNote[],
  sourcePath?: string,
): string {
  const resolved = resolveDocumentLink(link, notes, undefined, sourcePath);
  if (!resolved.path) {
    return escapeHtml(label);
  }
  return renderInternalDocumentAnchor(resolved.path, escapeHtml(label), { anchor: link.anchor });
}

/**
 * Shared Markdown/MDX HTML for Preview and Export.
 *
 * GFM via marked. MDX is inert: JSX is escaped, not executed. Document links
 * go through parseDocumentLinks / resolveDocumentLink - do not add a second
 * parser or renderer here.
 */
export function renderMarkdownPreview(
  content: string,
  notes: ScannedNote[],
  linkMode: LinkSyntax,
  imageLabel: (alt: string) => string = (alt) => `[Image: ${escapeHtml(alt)}]`,
  sourcePath?: string,
): MarkdownPreviewResult {
  const previewSource = stripFrontmatter(content);
  const source = previewSource.text;
  const structure = parseMarkdownStructure(source);
  const sourceLines = source.split(/\r?\n/);
  const unsupportedMdx = hasUnsupportedMdx(sourceLines, structure.fences);
  if (source.trim().length === 0) {
    return {
      html: "",
      empty: true,
      frontmatter: previewSource.frontmatter,
      hasUnsupportedMdx: unsupportedMdx,
      failed: false,
      dense: false,
    };
  }

  if (
    countInlineMarkup(source) > PREVIEW_INLINE_MARKUP_LIMIT ||
    countAmbiguousBlockMarkers(sourceLines, structure.fences) > PREVIEW_BLOCK_MARKER_LIMIT
  ) {
    // Show the document rather than blocking on it. Escaped, so the inert
    // fallback is exactly as safe as the rendered path.
    return {
      html: `<pre>${escapeHtml(source)}</pre>`,
      empty: false,
      frontmatter: previewSource.frontmatter,
      hasUnsupportedMdx: unsupportedMdx,
      failed: false,
      dense: true,
    };
  }

  const links = parseDocumentLinks(source, linkMode).filter((link) => link.syntax === "markdown");
  const renderer = new marked.Renderer();

  renderer.html = ({ text }) => {
    const escaped = escapeHtml(text);
    return JSX_TAG_RE.test(text)
      ? `<span class="markdown-preview__inert">${escaped}</span>`
      : escaped;
  };
  // Heading identity comes from the token's own source text, not from the
  // order headings happen to appear in the output. marked also emits headings
  // the line-based structure does not claim - one nested in a list or a block
  // quote - and counting positions handed those a neighbour's anchor and sent
  // a click to an unrelated line.
  let headingCursor = 0;
  const takeStructureHeading = (raw: string, depth: number): MarkdownHeading | null => {
    const firstRawLine = raw.split("\n", 1)[0]?.trim() ?? "";
    for (let index = headingCursor; index < structure.headings.length; index += 1) {
      const heading = structure.headings[index];
      if (heading.depth !== depth) {
        continue;
      }
      if ((sourceLines[heading.lineNumber - 1] ?? "").trim() !== firstRawLine) {
        continue;
      }
      headingCursor = index + 1;
      return heading;
    }
    return null;
  };
  renderer.heading = function ({ tokens, depth, raw }) {
    const label = this.parser.parseInline(tokens);
    const heading = takeStructureHeading(raw, depth);
    if (!heading) {
      return `<h${depth}>${label}</h${depth}>\n`;
    }
    return `<h${depth} id="${escapeHtml(heading.anchor)}" role="button" tabindex="0" data-source-line="${
      heading.lineNumber + previewSource.lineOffset
    }">${label}</h${depth}>\n`;
  };
  renderer.image = ({ text }) => `<span class="markdown-preview__image">${imageLabel(text)}</span>`;
  renderer.checkbox = ({ checked }) =>
    `<input type="checkbox" disabled tabindex="-1"${checked ? " checked" : ""}>`;
  renderer.link = function ({ href, title, tokens }) {
    const pathTarget = href.split("#", 1)[0];
    const anchorTarget = href.includes("#") ? href.slice(href.indexOf("#") + 1) : undefined;
    const sourceLink = links.find(
      (link) => link.target === pathTarget && link.anchor === anchorTarget,
    );
    const label = this.parser.parseInline(tokens);

    if (sourceLink) {
      const resolved = resolveDocumentLink(sourceLink, notes, undefined, sourcePath);
      if (resolved.path) {
        return renderInternalDocumentAnchor(resolved.path, label, {
          anchor: sourceLink.anchor,
          title,
        });
      }
    }

    const titleValue = title ? ` title="${escapeHtml(title)}"` : "";
    // Non-document URLs are display-only in Preview: never tab stops or navigable.
    // Document links remain real anchors via renderInternalDocumentAnchor.
    return `<span class="markdown-preview__external"${titleValue}>${label}</span>`;
  };

  const wikilinkTokenizer: TokenizerExtensionFunction = (value) => {
    const link = parseDocumentLinks(value, "wikilink").find(
      (candidate) => candidate.range.start === 0,
    );
    if (!link) {
      return undefined;
    }
    return {
      type: "documentWikilink",
      raw: link.raw,
      text: link.label ?? link.target,
      documentLink: link,
    };
  };

  const parser = new Marked();
  if (linkMode === "wikilink") {
    parser.use({
      extensions: [
        {
          name: "documentWikilink",
          level: "inline",
          start: (sourceText: string) => {
            const index = sourceText.indexOf("[[");
            return index >= 0 ? index : undefined;
          },
          tokenizer: wikilinkTokenizer,
          renderer: (token) => {
            const link = token.documentLink as DocumentLink;
            return renderResolvedLink(link, link.label ?? link.target, notes, sourcePath);
          },
        },
      ],
    });
  }

  try {
    return {
      html: parser.parse(source, {
        async: false,
        gfm: true,
        renderer,
      }),
      empty: false,
      frontmatter: previewSource.frontmatter,
      hasUnsupportedMdx: unsupportedMdx,
      failed: false,
      dense: false,
    };
  } catch {
    return {
      html: `<pre>${escapeHtml(source)}</pre>`,
      empty: false,
      frontmatter: previewSource.frontmatter,
      hasUnsupportedMdx: unsupportedMdx,
      failed: true,
      dense: false,
    };
  }
}

const EXPORT_PREVIEW_STYLES = `body{max-width:48rem;margin:2rem auto;padding:0 1.25rem;color:#1a1a1a;font-family:system-ui,sans-serif;line-height:1.6}
@media(prefers-color-scheme:dark){body{color:#f2f2f2}}
h1,h2,h3,h4,h5,h6{line-height:1.25}
table{width:100%;border-collapse:collapse}
th,td{border:1px solid #8884;padding:.35em .55em;text-align:start}
pre{overflow:auto;padding:.75rem;border:1px solid #8884}
blockquote{margin-left:0;padding-left:1rem;border-left:2px solid #8888}
code,.markdown-preview__inert{font-family:ui-monospace,monospace}
.markdown-preview__image,.markdown-preview__inert{opacity:.75}`;

function stripPreviewChrome(html: string): string {
  return html
    .replaceAll(' role="button"', "")
    .replaceAll(' tabindex="0"', "")
    .replace(/\sdata-source-line="[^"]*"/g, "");
}

function adaptPreviewHtmlForExport(html: string, sourcePath?: string): string {
  return stripPreviewChrome(html).replace(
    /<a\b([^>]*)>([\s\S]*?)<\/a>/g,
    (full: string, attrs: string, inner: string) => {
      const documentPath = /\bdata-document-path="([^"]*)"/.exec(attrs)?.[1];
      if (!documentPath) {
        return full;
      }
      const decodedPath = documentPath.replaceAll("&amp;", "&");
      const documentAnchor = /\bdata-document-anchor="([^"]*)"/.exec(attrs)?.[1];
      if (sourcePath && decodedPath === sourcePath && documentAnchor) {
        return `<a href="#${documentAnchor}">${inner}</a>`;
      }
      return inner;
    },
  );
}

/**
 * Wrap Preview HTML as a standalone HTML document.
 *
 * Uses the same renderer and character cap as the Preview pane so Export
 * cannot diverge. Strips editor chrome (source-line, tabindex). Does not write
 * disk; callers use the HTML export RPC, which is not a document grant or save.
 */
export function exportMarkdownPreviewDocument(
  content: string,
  notes: ScannedNote[],
  linkMode: LinkSyntax,
  options: {
    title: string;
    sourcePath?: string;
    imageLabel?: (alt: string) => string;
  },
): MarkdownPreviewDocument {
  const preview = renderMarkdownPreview(
    content.slice(0, PREVIEW_RENDER_CHAR_LIMIT),
    notes,
    linkMode,
    options.imageLabel,
    options.sourcePath,
  );
  const body = adaptPreviewHtmlForExport(preview.html, options.sourcePath);
  return {
    preview,
    html: `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
<style>${EXPORT_PREVIEW_STYLES}</style>
</head>
<body>
${body}
</body>
</html>
`,
  };
}
