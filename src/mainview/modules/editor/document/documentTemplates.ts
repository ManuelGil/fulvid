/**
 * Seed text for "New Document from README".
 *
 * Templates are not document types, stored notes, or a second lifecycle —
 * only the initial buffer/file body for that explicit creation path.
 * Exactly one built-in template: a README-shaped Markdown document.
 * Mustache interpolates the title; the result is ordinary Markdown.
 *
 * "New Document" (blank) does not use this module.
 */
import Mustache from "mustache";

export type DocumentTemplateId = "readme";

export type DocumentTemplateContext = {
  /** H1 title. Defaults to README when missing or empty after normalization. */
  title?: string;
};

export type DocumentTemplate = {
  id: DocumentTemplateId;
  body: string;
};

/** Deterministic fallback when creation has no folder context. */
export const DEFAULT_README_TITLE = "README";

/**
 * Substantial, language-neutral README a person could keep as real documentation.
 * Only Mustache variable: {{title}}. No dates, frontmatter, or PKM sections.
 */
const README_TEMPLATE_BODY = `# {{title}}

Brief description of this document or folder.

## Overview

What this covers and who it is for.

-

## Getting started

1.
2.
3.

## Contents

- [Overview](#overview)
- [Getting started](#getting-started)
- [Usage](#usage)
- [Configuration](#configuration)
- [Notes](#notes)
- [References](#references)

## Usage

How to use what this document describes.

-

### Example

Write ordinary Markdown. Link to nearby documents with relative paths:

    See [related notes](./notes.md) for details.

Use headings, lists, and fenced code when they help the reader.

## Configuration

Optional settings or conventions for this area.

-

## Notes

-

## References

- [Related document](./related.md)
- [External resource](https://example.com)
`;

export const DOCUMENT_TEMPLATES: readonly DocumentTemplate[] = [
  {
    id: "readme",
    body: README_TEMPLATE_BODY,
  },
];

/** Collapse whitespace; empty → fallback. Does not invent product metadata. */
export function normalizeDocumentTemplateTitle(raw: string | undefined | null): string {
  if (raw == null) {
    return DEFAULT_README_TITLE;
  }
  const collapsed = raw.replace(/\s+/g, " ").trim();
  return collapsed || DEFAULT_README_TITLE;
}

/**
 * Title from Explorer creation context: immediate parent folder name.
 * Nested paths use the last segment, not the workspace root.
 * Creating at the folder root uses the workspace root basename when provided.
 */
export function documentTemplateTitleFromParentPath(
  parentRelativePath: string,
  workspaceRootName?: string | null,
): string {
  const segments = parentRelativePath.split(/[/\\]/).filter(Boolean);
  const immediate = segments.at(-1);
  if (immediate) {
    return normalizeDocumentTemplateTitle(immediate);
  }
  return normalizeDocumentTemplateTitle(workspaceRootName);
}

/**
 * Render a built-in template. Unknown ids yield "".
 * Context values are Mustache-escaped (HTML entities) so hostile folder names
 * stay inert through Preview; the output must contain no Mustache tags.
 */
export function renderDocumentTemplate(
  id: DocumentTemplateId = "readme",
  context: DocumentTemplateContext = {},
): string {
  const template = DOCUMENT_TEMPLATES.find((entry) => entry.id === id);
  if (!template) {
    return "";
  }
  const title = normalizeDocumentTemplateTitle(context.title);
  return Mustache.render(template.body, { title });
}
