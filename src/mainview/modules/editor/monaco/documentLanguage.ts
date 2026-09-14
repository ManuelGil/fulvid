/**
 * Monaco language services for workspace Markdown/MDX models.
 *
 * This file owns one language surface so markers, completions, outline,
 * folding, links, hover, references, and rename share parseDocumentLinks
 * and the shared document lifecycle. Do not add a second parser, resolver,
 * or document store here.
 *
 * Layout:
 * - model registry and path helpers
 * - diagnostic markers
 * - completion catalogs (snippets, note targets)
 * - outline and folding
 * - Monaco providers (links, definition, hover, references, rename)
 * - registerDocumentLanguage (per-model attach)
 */
import * as monaco from "monaco-editor/editor";
import { watch } from "vue";

import {
  candidateNotesForLink,
  resolveDocumentPath,
  uniqueLinkCandidate,
} from "../../document/links/linkSemantics";
import {
  parseDocumentLinks,
  resolveDocumentLink,
  type DocumentLink,
} from "../../document/links/documentLink";
import { readDocument } from "../../workspace/filesystem/workspaceScanner";
import { settings } from "../../settings/settingsStore";
import { i18n } from "../../../i18n";
import { workspaceNotes, workspace } from "../../../app/workspaceState";
import { openOrActivate } from "../document/documentBuffers";
import {
  fenceLanguageQuery,
  MARKDOWN_TABLE_SNIPPET,
  markdownSnippetKind,
  mdxCompletionKind,
} from "../markdown/markdownCompletion";
import { offsetToPosition } from "../markdown/markdownFormat";
import { findMarkdownHeading, parseMarkdownStructure } from "../markdown/markdownStructure";
import {
  collectHeadingReferences,
  fragmentAnchorRange,
  headingForFragmentLink,
  linkPartAtOffset,
  planHeadingRename,
  semanticEntityAt,
} from "../markdown/headingReferences";

type ModelRegistration = {
  rootPath: string;
  contentDisposable: monaco.IDisposable;
};

type DocumentContext = {
  rootPath: string;
  notes: NonNullable<typeof workspace.value>["scannedNotes"];
};

type LinkReference = {
  location: monaco.languages.Location;
  link: DocumentLink;
  versionId: number;
};

const models = new Map<string, ModelRegistration>();
const roots = new Set<string>();
const markerSchedulers = new Set<() => void>();
let stopContextWatch: (() => void) | null = null;
let providersRegistered = false;
const FRONTMATTER_MARKER_OWNER = "editor-frontmatter";

function scheduleAllMarkers(): void {
  for (const schedule of markerSchedulers) {
    schedule();
  }
}

/**
 * What markers depend on across the folder, in a form cheap enough to recompute
 * on every edit: which documents exist, how large they are, what they are
 * called, and the links they carry. Concatenating every document body here made
 * each keystroke in a large folder rebuild a multi-megabyte string.
 */
function contextSignature(): string {
  return workspaceNotes.value
    .map(
      (note) =>
        `${note.path}\u0000${note.content?.length ?? 0}\u0000${
          note.title
        }\u0000${note.aliases.join("\u0003")}\u0000${note.documentLinks
          .map((link) => `${link.syntax}:${link.raw}`)
          .join("\u0002")}`,
    )
    .join("\u0001");
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function absolutePath(rootPath: string, relativePath: string): string {
  return `${normalizePath(rootPath)}/${relativePath.replace(/\\/g, "/")}`;
}

function relativePath(rootPath: string, absoluteDocumentPath: string): string | null {
  const root = normalizePath(rootPath);
  const target = normalizePath(absoluteDocumentPath);
  if (target === root) {
    return "";
  }
  if (!target.startsWith(`${root}/`)) {
    return null;
  }
  return target.slice(root.length + 1);
}

function modelKey(model: monaco.editor.ITextModel): string {
  return model.uri.toString();
}

function contextForModel(model: monaco.editor.ITextModel): DocumentContext | null {
  const registration = models.get(modelKey(model));
  const currentWorkspace = workspace.value;
  if (
    !registration ||
    !currentWorkspace ||
    normalizePath(currentWorkspace.path) !== registration.rootPath
  ) {
    return null;
  }
  return {
    rootPath: registration.rootPath,
    notes: workspaceNotes.value,
  };
}

function modelForPath(
  rootPath: string,
  relativeDocumentPath: string,
): monaco.editor.ITextModel | null {
  const uri = monaco.Uri.file(absolutePath(rootPath, relativeDocumentPath));
  for (const [key, registration] of models) {
    if (key !== uri.toString()) {
      continue;
    }
    const model = monaco.editor.getModels().find((candidate) => candidate.uri.toString() === key);
    if (model) {
      return model;
    }
    registration.contentDisposable.dispose();
    models.delete(key);
  }
  return null;
}

function rootForResource(resource: monaco.Uri): string | null {
  const resourcePath = normalizePath(resource.fsPath);
  return (
    [...roots]
      .filter((root) => resourcePath === root || resourcePath.startsWith(`${root}/`))
      .sort((left, right) => right.length - left.length)[0] ?? null
  );
}

function documentLinksForModel(model: monaco.editor.ITextModel): DocumentLink[] {
  return parseDocumentLinks(model.getValue(), settings.value.links.linkMode);
}

function rangeForOffsets(
  model: monaco.editor.ITextModel,
  start: number,
  end: number,
): monaco.Range {
  const startPosition = model.getPositionAt(start);
  const endPosition = model.getPositionAt(end);
  return new monaco.Range(
    startPosition.lineNumber,
    startPosition.column,
    endPosition.lineNumber,
    endPosition.column,
  );
}

function rangeForLink(model: monaco.editor.ITextModel, link: DocumentLink): monaco.Range {
  return rangeForOffsets(model, link.range.start, link.range.end);
}

function rangeForTextOffsets(text: string, start: number, end: number): monaco.Range {
  const startPosition = offsetToPosition(text, start);
  const endPosition = offsetToPosition(text, end);
  return new monaco.Range(
    startPosition.lineNumber,
    startPosition.column,
    endPosition.lineNumber,
    endPosition.column,
  );
}

function revealPositionForAnchor(
  content: string,
  anchor: string | undefined,
): { lineNumber: number; column: number } | undefined {
  if (!anchor) {
    return undefined;
  }
  const heading = findMarkdownHeading(content, anchor);
  return heading ? { lineNumber: heading.lineNumber, column: 1 } : undefined;
}

function linkAtPosition(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): DocumentLink | null {
  const offset = model.getOffsetAt(position);
  return (
    documentLinksForModel(model).find(
      (link) => offset >= link.range.start && offset <= link.range.end,
    ) ?? null
  );
}

function unresolvedLinksForModel(
  model: monaco.editor.ITextModel,
  context: DocumentContext,
  links: DocumentLink[],
): DocumentLink[] {
  const modelRelativePath = relativePath(context.rootPath, model.uri.fsPath);
  const savedNote = context.notes.find((note) => note.path === modelRelativePath);
  return links.filter(
    (link) =>
      !resolveDocumentLink(link, context.notes, undefined, modelRelativePath ?? savedNote?.path)
        .path,
  );
}

function formatLinkTarget(link: DocumentLink, target: string): string {
  const withAnchor = `${target}${link.anchor ? `#${link.anchor}` : ""}`;
  if (link.syntax === "markdown") {
    return link.raw.replace(link.target, withAnchor);
  }
  return `[[${withAnchor}${link.label ? `|${link.label}` : ""}]]`;
}

function markerForLink(
  model: monaco.editor.ITextModel,
  link: DocumentLink,
  context: DocumentContext,
): monaco.editor.IMarkerData {
  const candidates = candidateNotesForLink(link.target, context.notes);
  const suffix =
    candidates.length > 0
      ? ` ${i18n.global.t("links.candidates", {
          items: candidates.map((candidate) => candidate.path).join(", "),
        })}`
      : "";
  const range = rangeForLink(model, link);
  return {
    severity: monaco.MarkerSeverity.Warning,
    message: `${i18n.global.t("links.unresolved", {
      target: link.target,
    })}${suffix}`,
    startLineNumber: range.startLineNumber,
    startColumn: range.startColumn,
    endLineNumber: range.endLineNumber,
    endColumn: range.endColumn,
  };
}

function contentForPath(context: DocumentContext, relativePath: string): string | null {
  const liveModel = modelForPath(context.rootPath, relativePath);
  if (liveModel) {
    return liveModel.getValue();
  }
  return context.notes.find((note) => note.path === relativePath)?.content ?? null;
}

function sourcePathForModel(
  model: monaco.editor.ITextModel,
  context: DocumentContext | null,
): string | null {
  if (!context) {
    return null;
  }
  return relativePath(context.rootPath, model.uri.fsPath);
}

function openHeadingDocuments(
  model: monaco.editor.ITextModel,
  context: DocumentContext | null,
): { path: string | null; content: string; model: monaco.editor.ITextModel }[] {
  const currentPath = sourcePathForModel(model, context);
  const documents: { path: string | null; content: string; model: monaco.editor.ITextModel }[] = [
    { path: currentPath, content: model.getValue(), model },
  ];
  if (!context) {
    return documents;
  }
  for (const [key, registration] of models) {
    if (registration.rootPath !== context.rootPath || key === modelKey(model)) {
      continue;
    }
    const openModel = monaco.editor
      .getModels()
      .find((candidate) => candidate.uri.toString() === key);
    if (!openModel) {
      continue;
    }
    documents.push({
      path: relativePath(context.rootPath, openModel.uri.fsPath),
      content: openModel.getValue(),
      model: openModel,
    });
  }
  return documents;
}

function headingLookupDocuments(
  model: monaco.editor.ITextModel,
  context: DocumentContext | null,
): { path: string | null; content: string }[] {
  const open = openHeadingDocuments(model, context);
  const documents: { path: string | null; content: string }[] = open.map(({ path, content }) => ({
    path,
    content,
  }));
  const seen = new Set(documents.map((document) => document.path));
  if (!context) {
    return documents;
  }
  for (const note of context.notes) {
    if (seen.has(note.path) || note.content === undefined) {
      continue;
    }
    seen.add(note.path);
    documents.push({ path: note.path, content: note.content });
  }
  return documents;
}

function rangeForTextRange(
  model: monaco.editor.ITextModel,
  range: { start: number; end: number },
): monaco.Range {
  return rangeForOffsets(model, range.start, range.end);
}

function dedupeLocations(locations: monaco.languages.Location[]): monaco.languages.Location[] {
  const seen = new Set<string>();
  return locations.filter((location) => {
    const key = `${location.uri.toString()}:${location.range.startLineNumber}:${location.range.startColumn}:${location.range.endLineNumber}:${location.range.endColumn}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function markerForMissingAnchor(
  model: monaco.editor.ITextModel,
  link: DocumentLink,
): monaco.editor.IMarkerData {
  const range = rangeForLink(model, link);
  return {
    severity: monaco.MarkerSeverity.Warning,
    message: i18n.global.t("links.missingAnchor", {
      anchor: link.anchor ?? "",
    }),
    startLineNumber: range.startLineNumber,
    startColumn: range.startColumn,
    endLineNumber: range.endLineNumber,
    endColumn: range.endColumn,
  };
}

function invalidLinkMarkers(model: monaco.editor.ITextModel): monaco.editor.IMarkerData[] {
  const lines = model.getLinesContent();
  const structure = parseMarkdownStructure(model.getValue());
  const ignoredLines = new Set<number>();
  if (structure.frontmatterEndLine !== null) {
    for (let line = 1; line <= structure.frontmatterEndLine; line += 1) {
      ignoredLines.add(line);
    }
  }
  for (const fence of structure.fences) {
    for (let line = fence.startLine; line <= fence.endLine; line += 1) {
      ignoredLines.add(line);
    }
  }

  return lines.flatMap((line, index) => {
    const lineNumber = index + 1;
    if (ignoredLines.has(lineNumber)) {
      return [];
    }
    const isWikilink = settings.value.links.linkMode === "wikilink";
    const opening = isWikilink ? "[[" : "](";
    const start = line.indexOf(opening);
    const closing = isWikilink ? "]]" : ")";
    if (start < 0 || line.slice(start + opening.length).includes(closing)) {
      return [];
    }
    return [
      {
        severity: monaco.MarkerSeverity.Warning,
        message: i18n.global.t("links.invalid"),
        startLineNumber: lineNumber,
        startColumn: start + 1,
        endLineNumber: lineNumber,
        endColumn: line.length + 1,
      },
    ];
  });
}

function relativeLinkPath(sourcePath: string, targetPath: string): string {
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

function sourceRelativePrefix(query: string, sourcePath: string): string {
  const segments = sourcePath.split("/").filter(Boolean);
  segments.pop();
  for (const segment of query.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/").toLowerCase();
}

/** Snippet catalogs for the completion provider. Prefix matching lives in markdownCompletion. */
const MARKDOWN_SNIPPETS = {
  heading: {
    token: "#",
    label: "snippetHeading",
    detail: "snippetHeadingDetail",
    insertText: "# ${1:Heading}",
  },
  list: {
    token: "- ",
    label: "snippetList",
    detail: "snippetListDetail",
    insertText: "- ${1:List item}",
  },
  orderedList: {
    token: "1. ",
    label: "snippetOrderedList",
    detail: "snippetOrderedListDetail",
    insertText: "1. ${1:List item}",
  },
  fence: {
    token: "```",
    label: "snippetCode",
    detail: "snippetCodeDetail",
    insertText: "```$1\n$0\n```",
  },
  quote: {
    token: "> ",
    label: "snippetQuote",
    detail: "snippetQuoteDetail",
    insertText: "> ${1:Quote}",
  },
  link: {
    token: "[",
    label: "snippetLink",
    detail: "snippetLinkDetail",
    insertText: "[${1:Label}](${2:target.md})",
  },
  image: {
    token: "![",
    label: "snippetImage",
    detail: "snippetImageDetail",
    insertText: "![${1:Alt text}](${2:image.png})",
  },
  table: {
    token: "|",
    label: "snippetTable",
    detail: "snippetTableDetail",
    insertText: MARKDOWN_TABLE_SNIPPET,
  },
  frontmatter: {
    token: "---",
    label: "snippetFrontmatter",
    detail: "snippetFrontmatterDetail",
    insertText: "---\ntitle: ${1:Title}\n---\n$0",
  },
} as const;

function markdownSnippetItems(
  api: typeof monaco,
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): monaco.languages.CompletionItem[] {
  const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
  const kind = markdownSnippetKind(before, model.getLanguageId(), position.lineNumber);
  if (!kind) {
    return [];
  }

  const snippet = MARKDOWN_SNIPPETS[kind];
  return [
    {
      label: i18n.global.t(`documentLanguage.${snippet.label}`),
      detail: i18n.global.t(`documentLanguage.${snippet.detail}`),
      kind: api.languages.CompletionItemKind.Snippet,
      insertText: snippet.insertText,
      insertTextRules: api.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      range: new api.Range(
        position.lineNumber,
        position.column - snippet.token.length,
        position.lineNumber,
        position.column,
      ),
    },
  ];
}

const FENCE_LANGUAGE_SUGGESTIONS = [
  ["typescript", "fenceTypeScript"],
  ["javascript", "fenceJavaScript"],
  ["json", "fenceJson"],
  ["bash", "fenceBash"],
  ["css", "fenceCss"],
  ["html", "fenceHtml"],
  ["python", "fencePython"],
  ["sql", "fenceSql"],
  ["yaml", "fenceYaml"],
] as const;

function fenceLanguageItems(
  api: typeof monaco,
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): monaco.languages.CompletionItem[] {
  const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
  const query = fenceLanguageQuery(before);
  if (query === null) {
    return [];
  }

  const queryStart = position.column - query.length;
  return FENCE_LANGUAGE_SUGGESTIONS.map(([language, labelKey]) => ({
    label: i18n.global.t(`documentLanguage.${labelKey}`),
    detail: i18n.global.t("documentLanguage.fenceLanguageDetail", { language }),
    kind: api.languages.CompletionItemKind.Keyword,
    insertText: language,
    filterText: `${language} ${i18n.global.t(`documentLanguage.${labelKey}`)}`,
    range: new api.Range(position.lineNumber, queryStart, position.lineNumber, position.column),
  }));
}

function mdxSnippetItems(
  api: typeof monaco,
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): monaco.languages.CompletionItem[] {
  const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
  const kind = mdxCompletionKind(model.getLanguageId(), before);
  if (kind === "element") {
    const typedTag = before.match(/<([A-Za-z][\w.-]*)?$/)?.[0] ?? "<";
    return [
      {
        label: i18n.global.t("documentLanguage.snippetMdxElement"),
        detail: i18n.global.t("documentLanguage.snippetMdxElementDetail"),
        kind: api.languages.CompletionItemKind.Snippet,
        insertText: "<${1:Component}>${2:content}</${1:Component}>",
        insertTextRules: api.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        range: new api.Range(
          position.lineNumber,
          position.column - typedTag.length,
          position.lineNumber,
          position.column,
        ),
      },
    ];
  }

  if (kind === "attribute") {
    const typedAttribute = before.match(/<([A-Za-z][\w.-]*)\s+([A-Za-z][\w-]*)?$/)?.[2] ?? "";
    const attributes = [
      ["className", "snippetMdxClassName"],
      ["id", "snippetMdxId"],
      ["title", "snippetMdxTitle"],
    ] as const;
    return attributes.map(([attribute, labelKey]) => ({
      label: i18n.global.t(`documentLanguage.${labelKey}`),
      detail: i18n.global.t("documentLanguage.snippetMdxAttributeDetail"),
      kind: api.languages.CompletionItemKind.Property,
      insertText: `${attribute}="${"${1:value}"}"`,
      insertTextRules: api.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      range: new api.Range(
        position.lineNumber,
        position.column - typedAttribute.length,
        position.lineNumber,
        position.column,
      ),
    }));
  }

  if (kind === "expression") {
    const expression = before.match(/\{(\w*)$/)?.[1] ?? "";
    return [
      {
        label: i18n.global.t("documentLanguage.snippetMdxExpression"),
        detail: i18n.global.t("documentLanguage.snippetMdxExpressionDetail"),
        kind: api.languages.CompletionItemKind.Snippet,
        insertText: "{${1:expression}}",
        insertTextRules: api.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        range: new api.Range(
          position.lineNumber,
          position.column - expression.length - 1,
          position.lineNumber,
          position.column,
        ),
      },
    ];
  }

  return [];
}

function hasUnbalancedYamlDelimiters(value: string): boolean {
  const pairs: Record<string, string> = { "[": "]", "{": "}" };
  const stack: string[] = [];
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const character of value) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (pairs[character]) {
      stack.push(pairs[character]);
    } else if (character === stack[stack.length - 1]) {
      stack.pop();
    } else if (Object.values(pairs).includes(character)) {
      return true;
    }
  }

  return Boolean(quote || stack.length > 0);
}

function frontmatterMarkers(model: monaco.editor.ITextModel): monaco.editor.IMarkerData[] {
  const value = model.getValue();
  if (!/^---\r?\n/.test(value)) {
    return [];
  }
  const lines = value.split(/\r?\n/);
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex < 0) {
    return [
      {
        severity: monaco.MarkerSeverity.Warning,
        message: i18n.global.t("frontmatter.unclosed"),
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: Math.max(2, lines[0]?.length ?? 3),
      },
    ];
  }
  return lines.slice(1, closingIndex).flatMap((line, index) => {
    const trimmed = line.trim();
    const keyMatch = trimmed.match(/^[A-Za-z0-9_"'-]+\s*:\s*(.*)$/);
    const looksLikeYaml =
      !trimmed ||
      trimmed.startsWith("#") ||
      /^[-?]\s+/.test(trimmed) ||
      /^[[{,}\]]/.test(trimmed) ||
      /^[A-Za-z0-9_"'-]+\s*:/.test(trimmed);
    if (looksLikeYaml && !hasUnbalancedYamlDelimiters(keyMatch?.[1] ?? "")) {
      return [];
    }
    const lineNumber = index + 2;
    return [
      {
        severity: monaco.MarkerSeverity.Warning,
        message: i18n.global.t("frontmatter.invalidLine"),
        startLineNumber: lineNumber,
        startColumn: 1,
        endLineNumber: lineNumber,
        endColumn: Math.max(2, line.length + 1),
      },
    ];
  });
}

function updateMarkers(model: monaco.editor.ITextModel): void {
  monaco.editor.setModelMarkers(model, FRONTMATTER_MARKER_OWNER, frontmatterMarkers(model));
  const context = contextForModel(model);
  if (!context) {
    monaco.editor.setModelMarkers(model, "editor-document-links", invalidLinkMarkers(model));
    return;
  }
  const links = documentLinksForModel(model);
  const unresolved = unresolvedLinksForModel(model, context, links);
  const sourcePath = relativePath(context.rootPath, model.uri.fsPath);
  const missingAnchors = links.filter((link) => {
    if (!link.anchor || unresolved.includes(link)) {
      return false;
    }
    const resolved = resolveDocumentLink(link, context.notes, undefined, sourcePath ?? undefined);
    const content = resolved.path ? contentForPath(context, resolved.path) : null;
    return content !== null && !findMarkdownHeading(content, link.anchor);
  });
  monaco.editor.setModelMarkers(model, "editor-document-links", [
    ...invalidLinkMarkers(model),
    ...unresolved.map((link) => markerForLink(model, link, context)),
    ...missingAnchors.map((link) => markerForMissingAnchor(model, link)),
  ]);
}

/**
 * Unclosed frontmatter markers for untitled/standalone models that are not
 * registered with the workspace language services.
 */
export function registerFrontmatterDiagnostics(
  model: monaco.editor.ITextModel,
): monaco.IDisposable {
  let markerTimer: ReturnType<typeof setTimeout> | null = null;
  const update = (): void => {
    monaco.editor.setModelMarkers(model, FRONTMATTER_MARKER_OWNER, frontmatterMarkers(model));
  };
  const scheduleUpdate = (): void => {
    if (markerTimer) {
      clearTimeout(markerTimer);
    }
    markerTimer = setTimeout(() => {
      markerTimer = null;
      update();
    }, 80);
  };
  const disposable = model.onDidChangeContent(scheduleUpdate);
  update();
  return {
    dispose() {
      disposable.dispose();
      if (markerTimer) {
        clearTimeout(markerTimer);
        markerTimer = null;
      }
      monaco.editor.setModelMarkers(model, FRONTMATTER_MARKER_OWNER, []);
    },
  };
}

async function findLinkLocations(
  rootPath: string,
  notes: DocumentContext["notes"],
  targetPath: string,
  targetAnchor?: string,
): Promise<LinkReference[]> {
  const locations: LinkReference[] = [];

  for (const note of notes) {
    const sourceModel = modelForPath(rootPath, note.path);
    const links = sourceModel
      ? documentLinksForModel(sourceModel)
      : note.documentLinks.filter((link) => settings.value.links.linkMode === link.syntax);

    for (const link of links) {
      const sourcePath = sourceModel ? relativePath(rootPath, sourceModel.uri.fsPath) : note.path;
      if (
        resolveDocumentLink(link, notes, undefined, sourcePath ?? undefined).path !== targetPath
      ) {
        continue;
      }
      if (targetAnchor && link.anchor?.toLowerCase() !== targetAnchor.toLowerCase()) {
        continue;
      }
      const fragmentRange = targetAnchor ? fragmentAnchorRange(link) : null;
      const sourceRange = sourceModel
        ? fragmentRange
          ? rangeForTextRange(sourceModel, fragmentRange)
          : rangeForLink(sourceModel, link)
        : new monaco.Range(1, 1, 1, 1);
      const versionId = sourceModel?.getVersionId() ?? 0;
      if (!sourceModel) {
        const snapshot = await readDocument(rootPath, note.path);
        const closedRange = fragmentRange
          ? rangeForTextOffsets(snapshot.content, fragmentRange.start, fragmentRange.end)
          : rangeForTextOffsets(snapshot.content, link.range.start, link.range.end);
        locations.push({
          location: {
            uri: monaco.Uri.file(absolutePath(rootPath, note.path)),
            range: closedRange,
          },
          link,
          versionId,
        });
        continue;
      }
      locations.push({
        location: {
          uri: monaco.Uri.file(absolutePath(rootPath, note.path)),
          range: sourceRange,
        },
        link,
        versionId,
      });
    }
  }

  return locations;
}

function completionItems(
  api: typeof monaco,
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  context: DocumentContext,
): monaco.languages.CompletionItem[] {
  const line = model.getLineContent(position.lineNumber);
  const before = line.slice(0, position.column - 1);
  const linkMode = settings.value.links.linkMode;
  const markdownStart = before.lastIndexOf("[");
  const markdownTargetStart = before.lastIndexOf("](") + 2;
  const isMarkdownLink =
    linkMode === "markdown" &&
    markdownStart >= 0 &&
    markdownTargetStart > 1 &&
    /^!?\[[^\]\n]*\]\([^)\n]*$/.test(before.slice(markdownStart));
  const wikilinkStart = before.lastIndexOf("[[");
  const isWikilinkLink =
    linkMode === "wikilink" &&
    wikilinkStart >= 0 &&
    /^\[\[[^\]\n]*$/.test(before.slice(wikilinkStart));
  if (!isMarkdownLink && !isWikilinkLink) {
    return [];
  }

  const targetStart = isMarkdownLink ? markdownTargetStart : wikilinkStart + 2;
  const targetText = before.slice(targetStart);
  const hashIndex = targetText.indexOf("#");
  const pathQuery = (hashIndex < 0 ? targetText : targetText.slice(0, hashIndex)).trim();
  const sourcePath = relativePath(context.rootPath, model.uri.fsPath);

  if (hashIndex >= 0) {
    const targetPath = pathQuery
      ? resolveDocumentPath(
          pathQuery,
          context.notes,
          settings.value.links.resolution,
          sourcePath ?? undefined,
        ).path
      : sourcePath;
    const targetContent = pathQuery
      ? targetPath
        ? contentForPath(context, targetPath)
        : null
      : model.getValue();
    if (!targetContent) {
      return [];
    }
    const headingQuery = targetText
      .slice(hashIndex + 1)
      .trim()
      .toLowerCase();
    const headingRange = new api.Range(
      position.lineNumber,
      targetStart + hashIndex + 2,
      position.lineNumber,
      position.column,
    );
    return parseMarkdownStructure(targetContent)
      .headings.filter(
        (heading) =>
          !headingQuery ||
          heading.text.toLowerCase().includes(headingQuery) ||
          heading.anchor.includes(headingQuery),
      )
      .slice(0, 30)
      .map((heading) => ({
        label: heading.text,
        kind: api.languages.CompletionItemKind.Reference,
        detail: `#${heading.anchor}`,
        insertText: heading.anchor,
        filterText: `${heading.text} ${heading.anchor}`,
        range: headingRange,
      }));
  }

  const relativePrefix = pathQuery.startsWith("./") || pathQuery.startsWith("../");
  const candidateNotes = relativePrefix
    ? context.notes
        .filter((note) =>
          note.path.toLowerCase().startsWith(sourceRelativePrefix(pathQuery, sourcePath ?? "")),
        )
        .slice(0, 30)
    : pathQuery.length > 0
      ? candidateNotesForLink(pathQuery, context.notes, 30)
          .map((candidate) => context.notes.find((note) => note.path === candidate.path))
          .filter((note): note is DocumentContext["notes"][number] => Boolean(note))
      : context.notes.slice(0, 30);
  return candidateNotes.map((note) => {
    const insertText = relativePrefix ? relativeLinkPath(sourcePath ?? "", note.path) : note.path;
    return {
      label: note.title,
      kind: api.languages.CompletionItemKind.Reference,
      detail: note.path,
      insertText,
      filterText: `${note.title} ${note.path}`,
      range: new api.Range(
        position.lineNumber,
        targetStart + 1,
        position.lineNumber,
        position.column,
      ),
    };
  });
}

/** Heading outline from parseMarkdownStructure. Nested by ATX/setext depth. */
export function documentSymbolsForModel(
  api: typeof monaco,
  model: monaco.editor.ITextModel,
): monaco.languages.DocumentSymbol[] {
  const lines = model.getLinesContent();
  const headings = parseMarkdownStructure(model.getValue()).headings;
  const symbols: monaco.languages.DocumentSymbol[] = [];
  const stack: monaco.languages.DocumentSymbol[] = [];
  headings.forEach((heading, index) => {
    const line = lines[heading.lineNumber - 1] ?? "";
    const nextHeading = headings
      .slice(index + 1)
      .find((candidate) => candidate.depth <= heading.depth);
    const endLine = nextHeading ? nextHeading.lineNumber - 1 : lines.length;
    const endLineText = lines[endLine - 1] ?? "";
    const indent = line.match(/^ {0,3}/)?.[0].length ?? 0;
    const symbol: monaco.languages.DocumentSymbol = {
      name: heading.text,
      detail: `h${heading.depth}`,
      kind: api.languages.SymbolKind.String,
      range: new api.Range(
        heading.lineNumber,
        1,
        Math.max(endLine, heading.lineNumber),
        endLineText.length + 1,
      ),
      selectionRange: new api.Range(
        heading.lineNumber,
        indent + 1,
        heading.lineNumber,
        line.length + 1,
      ),
      children: [],
      tags: [],
    };
    while (stack.length > 0 && Number(stack[stack.length - 1]?.detail.slice(1)) >= heading.depth) {
      stack.pop();
    }
    if (stack.length > 0) {
      stack[stack.length - 1]?.children?.push(symbol);
    } else {
      symbols.push(symbol);
    }
    stack.push(symbol);
  });
  return symbols;
}

/** Fold frontmatter, fences, and heading sections. Same structure as the outline. */
export function foldingRangesForModel(
  api: typeof monaco,
  model: monaco.editor.ITextModel,
): monaco.languages.FoldingRange[] {
  const lines = model.getLinesContent();
  const ranges: monaco.languages.FoldingRange[] = [];
  const structure = parseMarkdownStructure(model.getValue());
  if (structure.frontmatterEndLine !== null) {
    ranges.push({
      start: 1,
      end: structure.frontmatterEndLine,
      kind: api.languages.FoldingRangeKind.Comment,
    });
  }

  for (const fence of structure.fences) {
    ranges.push({
      start: fence.startLine,
      end: fence.endLine,
      kind: api.languages.FoldingRangeKind.Region,
    });
  }

  structure.headings.forEach((heading, index) => {
    const nextHeading = structure.headings
      .slice(index + 1)
      .find((candidate) => candidate.depth <= heading.depth);
    const end = nextHeading ? nextHeading.lineNumber - 1 : lines.length;
    if (end > heading.lineNumber) {
      ranges.push({
        start: heading.lineNumber,
        end,
        kind: api.languages.FoldingRangeKind.Region,
      });
    }
  });

  return ranges.sort((left, right) => left.start - right.start || left.end - right.end);
}

function isInsideFence(model: monaco.editor.ITextModel, lineNumber: number): boolean {
  return parseMarkdownStructure(model.getValue()).fences.some(
    (fence) => lineNumber > fence.startLine && lineNumber < fence.endLine,
  );
}

/**
 * Register Monaco language providers once per process.
 *
 * Providers: outline, folding, document links, Ctrl/Cmd-click open via
 * openOrActivate, definition, completions, hover, Find References, quick
 * fixes, and heading/fragment rename. F2 does not rename files.
 */
function createProviders(api: typeof monaco): monaco.IDisposable[] {
  const languages = ["markdown", "mdx"];
  const disposables: monaco.IDisposable[] = [];

  disposables.push(
    api.languages.registerDocumentSymbolProvider(languages, {
      provideDocumentSymbols(model) {
        return documentSymbolsForModel(api, model);
      },
    }),
  );

  disposables.push(
    api.languages.registerFoldingRangeProvider(languages, {
      provideFoldingRanges(model) {
        return foldingRangesForModel(api, model);
      },
    }),
  );

  disposables.push(
    api.languages.registerLinkProvider(languages, {
      provideLinks(model) {
        const context = contextForModel(model);
        if (!context) {
          return { links: [] };
        }
        const sourcePath = relativePath(context.rootPath, model.uri.fsPath);
        return {
          links: documentLinksForModel(model)
            .map((link) => {
              const resolved = resolveDocumentLink(
                link,
                context.notes,
                undefined,
                sourcePath ?? undefined,
              );
              if (!resolved.path) {
                return null;
              }
              return {
                range: rangeForLink(model, link),
                url: link.anchor
                  ? api.Uri.file(absolutePath(context.rootPath, resolved.path)).with({
                      fragment: link.anchor,
                    })
                  : api.Uri.file(absolutePath(context.rootPath, resolved.path)),
                tooltip: i18n.global.t("links.open", {
                  path: resolved.path,
                }),
              };
            })
            .filter(
              (
                link,
              ): link is {
                range: monaco.Range;
                url: monaco.Uri;
                tooltip: string;
              } => Boolean(link),
            ),
        };
      },
    }),
  );

  disposables.push(
    api.editor.registerLinkOpener({
      open(resource) {
        const rootPath = rootForResource(resource);
        if (!rootPath) {
          return false;
        }
        const relativeDocumentPath = relativePath(rootPath, resource.fsPath);
        if (!relativeDocumentPath) {
          return false;
        }
        const note = workspace.value?.scannedNotes.find(
          (candidate) => candidate.path === relativeDocumentPath,
        );
        const targetModel = modelForPath(rootPath, relativeDocumentPath);
        const targetContent = targetModel?.getValue() ?? note?.content;
        void openOrActivate({
          kind: "workspace",
          rootPath,
          path: relativeDocumentPath,
          ...(targetContent && resource.fragment
            ? {
                reveal: revealPositionForAnchor(targetContent, resource.fragment),
              }
            : {}),
        });
        return true;
      },
    }),
  );

  disposables.push(
    api.languages.registerDefinitionProvider(languages, {
      provideDefinition(model, position) {
        const context = contextForModel(model);
        const link = linkAtPosition(model, position);
        if (!context || !link) {
          return undefined;
        }
        const sourcePath = relativePath(context.rootPath, model.uri.fsPath);
        const resolved = resolveDocumentLink(
          link,
          context.notes,
          undefined,
          sourcePath ?? undefined,
        );
        const targetPath =
          resolved.path ?? uniqueLinkCandidate(link.target, context.notes)?.path ?? null;
        if (!targetPath) {
          return undefined;
        }
        const targetContent = contentForPath(context, targetPath);
        const targetPosition =
          targetContent && link.anchor && resolved.path
            ? revealPositionForAnchor(targetContent, link.anchor)
            : undefined;
        return [
          {
            uri:
              link.anchor && resolved.path
                ? api.Uri.file(absolutePath(context.rootPath, targetPath)).with({
                    fragment: link.anchor,
                  })
                : api.Uri.file(absolutePath(context.rootPath, targetPath)),
            range: new api.Range(
              targetPosition?.lineNumber ?? 1,
              targetPosition?.column ?? 1,
              targetPosition?.lineNumber ?? 1,
              targetPosition?.column ?? 1,
            ),
          },
        ];
      },
    }),
  );

  disposables.push(
    api.languages.registerCompletionItemProvider(languages, {
      triggerCharacters: ["[", "#", "|", "`", " "],
      provideCompletionItems(model, position) {
        const context = contextForModel(model);
        const insideFence = isInsideFence(model, position.lineNumber);
        return {
          suggestions: [
            ...(!insideFence && context ? completionItems(api, model, position, context) : []),
            ...(!insideFence ? markdownSnippetItems(api, model, position) : []),
            ...fenceLanguageItems(api, model, position),
          ],
        };
      },
    }),
  );

  disposables.push(
    api.languages.registerCompletionItemProvider("mdx", {
      triggerCharacters: ["<", "{"],
      provideCompletionItems(model, position) {
        if (isInsideFence(model, position.lineNumber)) {
          return { suggestions: [] };
        }
        return { suggestions: mdxSnippetItems(api, model, position) };
      },
    }),
  );

  disposables.push(
    api.languages.registerHoverProvider(languages, {
      provideHover(model, position) {
        const context = contextForModel(model);
        const link = linkAtPosition(model, position);
        if (!context || !link) {
          return undefined;
        }

        const sourcePath = relativePath(context.rootPath, model.uri.fsPath);
        const resolved = resolveDocumentLink(
          link,
          context.notes,
          undefined,
          sourcePath ?? undefined,
        );
        const targetContent = resolved.path ? contentForPath(context, resolved.path) : null;
        const targetHeading =
          resolved.path && link.anchor && targetContent
            ? findMarkdownHeading(targetContent, link.anchor)
            : undefined;
        const headingText = link.anchor
          ? `\n\n${i18n.global.t("links.heading", {
              anchor: link.anchor,
              status: targetHeading
                ? targetHeading.text
                : i18n.global.t("links.missingAnchorStatus"),
            })}`
          : "";
        const alsoMatchesText =
          resolved.path && resolved.alsoMatches.length > 0
            ? `\n\n${i18n.global.t("links.alsoMatches", {
                items: resolved.alsoMatches.join(", "),
              })}`
            : "";
        const candidates = resolved.path ? [] : candidateNotesForLink(link.target, context.notes);
        const candidateText =
          candidates.length > 0
            ? `\n\n${i18n.global.t("links.candidates", {
                items: candidates.map((candidate) => candidate.path).join(", "),
              })}`
            : "";
        return {
          range: rangeForLink(model, link),
          contents: [
            {
              value: resolved.path
                ? `**${link.label ?? link.target}**\n\n${resolved.path}${headingText}${alsoMatchesText}`
                : `**${i18n.global.t("links.unresolvedTitle")}**\n\n${link.target}${candidateText}`,
            },
          ],
        };
      },
    }),
  );

  disposables.push(
    api.languages.registerReferenceProvider(languages, {
      async provideReferences(model, position) {
        const context = contextForModel(model);
        const sourcePath = sourcePathForModel(model, context);
        const linkMode = settings.value.links.linkMode;
        const notes = context?.notes ?? [];
        const documents = headingLookupDocuments(model, context);
        const entity = semanticEntityAt(
          model.getValue(),
          model.getOffsetAt(position),
          linkMode,
          notes,
          sourcePath,
        );
        const fragmentLink = !entity ? linkAtPosition(model, position) : null;
        const headingTarget = entity
          ? { heading: entity.heading, documentPath: sourcePath }
          : fragmentLink?.anchor
            ? headingForFragmentLink(fragmentLink, sourcePath, notes, documents)
            : null;

        if (headingTarget) {
          const references = collectHeadingReferences(
            headingTarget.heading,
            headingTarget.documentPath,
            documents,
            notes,
            linkMode,
          );
          const locations: monaco.languages.Location[] = references.map((reference) => {
            const open =
              reference.documentPath === sourcePath
                ? model
                : context && reference.documentPath
                  ? modelForPath(context.rootPath, reference.documentPath)
                  : reference.documentPath === null
                    ? model
                    : null;
            const content =
              open?.getValue() ??
              documents.find((document) => document.path === reference.documentPath)?.content ??
              model.getValue();
            return {
              uri:
                open?.uri ??
                (context && reference.documentPath
                  ? api.Uri.file(absolutePath(context.rootPath, reference.documentPath))
                  : model.uri),
              range: open
                ? rangeForTextRange(open, reference.range)
                : rangeForTextOffsets(content, reference.range.start, reference.range.end),
            };
          });
          if (context && headingTarget.documentPath) {
            const covered = new Set(
              documents
                .map((document) => document.path)
                .filter((path): path is string => Boolean(path)),
            );
            const unread = notes.filter((note) => !covered.has(note.path));
            if (unread.length > 0) {
              locations.push(
                ...(
                  await findLinkLocations(
                    context.rootPath,
                    unread,
                    headingTarget.documentPath,
                    headingTarget.heading.anchor,
                  )
                ).map((reference) => reference.location),
              );
            }
          }
          return dedupeLocations(locations);
        }

        const link = linkAtPosition(model, position);
        if (
          !context ||
          !link ||
          link.anchor ||
          linkPartAtOffset(link, model.getOffsetAt(position)) === "label"
        ) {
          return [];
        }
        const resolved = resolveDocumentLink(link, notes, undefined, sourcePath ?? undefined);
        return resolved.path
          ? dedupeLocations(
              (await findLinkLocations(context.rootPath, notes, resolved.path)).map(
                (reference) => reference.location,
              ),
            )
          : [];
      },
    }),
  );

  disposables.push(
    api.languages.registerCodeActionProvider(languages, {
      provideCodeActions(model, range) {
        const context = contextForModel(model);
        if (!context) {
          return { actions: [], dispose() {} };
        }
        const unresolved = unresolvedLinksForModel(
          model,
          context,
          documentLinksForModel(model),
        ).filter((link) => rangeForLink(model, link).intersectRanges(range));
        const actions = unresolved.flatMap((link) => {
          const candidates = candidateNotesForLink(link.target, context.notes);
          const preferred = candidates.length === 1;
          return candidates.map((candidate) => ({
            title: i18n.global.t("links.linkTo", {
              path: candidate.path,
            }),
            kind: "quickfix",
            isPreferred: preferred,
            edit: {
              edits: [
                {
                  resource: model.uri,
                  versionId: model.getVersionId(),
                  textEdit: {
                    range: rangeForLink(model, link),
                    text: formatLinkTarget(link, candidate.path),
                  },
                },
              ],
            },
          }));
        });
        return { actions, dispose() {} };
      },
    }),
  );

  disposables.push(
    api.languages.registerRenameProvider(languages, {
      resolveRenameLocation(model, position) {
        const context = contextForModel(model);
        const entity = semanticEntityAt(
          model.getValue(),
          model.getOffsetAt(position),
          settings.value.links.linkMode,
          context?.notes ?? [],
          sourcePathForModel(model, context),
        );
        if (!entity) {
          return {
            range: new api.Range(position.lineNumber, 1, position.lineNumber, 1),
            text: "",
            rejectReason: i18n.global.t("documentLanguage.renameUnsupported"),
          };
        }
        return {
          range: rangeForTextRange(model, entity.range),
          text: entity.heading.text,
        };
      },
      provideRenameEdits(model, position, newName) {
        const context = contextForModel(model);
        const sourcePath = sourcePathForModel(model, context);
        const notes = context?.notes ?? [];
        const entity = semanticEntityAt(
          model.getValue(),
          model.getOffsetAt(position),
          settings.value.links.linkMode,
          notes,
          sourcePath,
        );
        if (!entity) {
          return {
            edits: [],
            rejectReason: i18n.global.t("documentLanguage.renameUnsupported"),
          };
        }
        const documents = headingLookupDocuments(model, context);
        const openDocuments = openHeadingDocuments(model, context);
        const references = collectHeadingReferences(
          entity.heading,
          sourcePath,
          documents,
          notes,
          settings.value.links.linkMode,
        );
        const plan = planHeadingRename(
          entity.heading,
          sourcePath,
          model.getValue(),
          newName,
          references,
          new Set(openDocuments.map((document) => document.path)),
        );
        if (!plan) {
          return {
            edits: [],
            rejectReason: i18n.global.t("documentLanguage.renameUnsupported"),
          };
        }
        return {
          edits: plan.edits.map((edit) => {
            const target =
              edit.documentPath === sourcePath
                ? model
                : (openDocuments.find((document) => document.path === edit.documentPath)?.model ??
                  model);
            return {
              resource: target.uri,
              versionId: target.getVersionId(),
              textEdit: {
                range: rangeForTextRange(target, { start: edit.start, end: edit.end }),
                text: edit.text,
              },
            };
          }),
        };
      },
    }),
  );

  return disposables;
}

export function ensureDocumentLanguageProviders(api: typeof monaco): void {
  if (!providersRegistered) {
    createProviders(api);
    providersRegistered = true;
  }
}

/**
 * Attach Fulvid Markdown language services to one workspace model.
 *
 * Markers, completions, and navigation all go through parseDocumentLinks
 * and openOrActivate. Providers are registered once per process; this call
 * only tracks the model so markers can refresh with folder evidence.
 */
export function registerDocumentLanguage(
  api: typeof monaco,
  model: monaco.editor.ITextModel,
  rootPath: string,
): monaco.IDisposable {
  const key = modelKey(model);
  const normalizedRootPath = normalizePath(rootPath);
  roots.add(normalizedRootPath);
  let markerTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleMarkers = (): void => {
    if (markerTimer) {
      clearTimeout(markerTimer);
    }
    markerTimer = setTimeout(() => {
      markerTimer = null;
      updateMarkers(model);
    }, 80);
  };
  markerSchedulers.add(scheduleMarkers);
  const contentDisposable = model.onDidChangeContent(scheduleAllMarkers);
  if (!stopContextWatch) {
    stopContextWatch = watch(contextSignature, scheduleAllMarkers);
  }
  const stopLinkModeWatch = watch(
    () => [settings.value.links.linkMode, settings.value.links.resolution],
    scheduleAllMarkers,
  );
  models.set(key, { rootPath: normalizedRootPath, contentDisposable });

  ensureDocumentLanguageProviders(api);
  updateMarkers(model);

  return {
    dispose() {
      contentDisposable.dispose();
      if (markerTimer) {
        clearTimeout(markerTimer);
        markerTimer = null;
      }
      stopLinkModeWatch();
      markerSchedulers.delete(scheduleMarkers);
      models.delete(key);
      if (models.size === 0) {
        stopContextWatch?.();
        stopContextWatch = null;
      }
      if (
        ![...models.values()].some((registration) => registration.rootPath === normalizedRootPath)
      ) {
        roots.delete(normalizedRootPath);
      }
      monaco.editor.setModelMarkers(model, "editor-document-links", []);
      monaco.editor.setModelMarkers(model, FRONTMATTER_MARKER_OWNER, []);
    },
  };
}
