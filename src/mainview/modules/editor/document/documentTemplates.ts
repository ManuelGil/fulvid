/**
 * Seed text for "New Document from README".
 *
 * Templates are not document types, stored notes, or a second lifecycle -
 * only the initial buffer/file body for that explicit creation path.
 * Exactly one built-in core template: a README-shaped Markdown document.
 * Mustache interpolates the title; the result is ordinary Markdown.
 *
 * Extension packs embed their own seed Markdown in entry.lua via
 * `document.createUntitled` - not this README Mustache path.
 * "New Document" (blank) does not use this module.
 */
import Mustache from "mustache";

type DocumentTemplateId = "readme";

type DocumentTemplateContext = {
  /** H1 title. Defaults to README when missing or empty after normalization. */
  title?: string;
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

const TEMPLATE_BODIES: Record<DocumentTemplateId, string> = {
  readme: README_TEMPLATE_BODY,
};

/** Collapse whitespace; empty -> fallback. Does not invent product metadata. */
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
 * Render a built-in core template.
 * Context values are Mustache-escaped (HTML entities) so hostile folder names
 * stay inert through Preview; the output must contain no Mustache tags.
 */
export function renderDocumentTemplate(
  id: DocumentTemplateId = "readme",
  context: DocumentTemplateContext = {},
): string {
  const title = normalizeDocumentTemplateTitle(context.title);
  return Mustache.render(TEMPLATE_BODIES[id], { title });
}
