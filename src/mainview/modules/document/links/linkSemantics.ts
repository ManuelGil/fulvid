/**
 * Path/stem/alias/title resolution and Context reach stats.
 *
 * `buildFocusGraph` is a directed outgoing BFS for Document Context counts.
 * The Graph page uses undirected `projectReferenceGraph` instead. Do not merge
 * the two: incoming-only neighbors appear on Graph but not in Context reach.
 *
 * Nodes represent notes. Edges represent configured explicit document links.
 * Neither graph is persisted domain state.
 */
import type { ScannedNote } from "../../workspace/filesystem/workspaceTypes";
import type { DocumentLink, LinkSyntax } from "./documentLink";

export type LinkResolutionMode = "stem" | "path" | "both";

export interface DocumentLinkSettings {
  linkMode: LinkSyntax;
  resolution: LinkResolutionMode;
}

const DEFAULT_DOCUMENT_LINK_SETTINGS: DocumentLinkSettings = {
  linkMode: "markdown",
  resolution: "both",
};

let activeDocumentLinkSettings: DocumentLinkSettings = {
  ...DEFAULT_DOCUMENT_LINK_SETTINGS,
};

/**
 * Process-local copy of link mode/resolution so parse and resolve stay free of
 * `settingsStore`. Settings writes here; tests inject the same way. Not a
 * second settings source of truth — only a seam for the semantic module.
 */
export function setDocumentLinkSettings(settings: Partial<DocumentLinkSettings>): void {
  activeDocumentLinkSettings = {
    linkMode:
      settings.linkMode === "markdown" || settings.linkMode === "wikilink"
        ? settings.linkMode
        : activeDocumentLinkSettings.linkMode,
    resolution:
      settings.resolution === "stem" ||
      settings.resolution === "path" ||
      settings.resolution === "both"
        ? settings.resolution
        : activeDocumentLinkSettings.resolution,
  };
}

export function getDocumentLinkSettings(): DocumentLinkSettings {
  return {
    linkMode: activeDocumentLinkSettings.linkMode,
    resolution: activeDocumentLinkSettings.resolution,
  };
}

type LinkLike = Pick<DocumentLink, "raw" | "syntax" | "target">;

export interface GraphNode {
  id: string;
  label: string;
}

export interface GraphEdge {
  source: string;
  target: string;
}

/**
 * Edges connect nodes within the projection only, deduplicated per
 * source→target pair - the product-wide definition of a reference.
 */
export interface FocusGraph {
  focusPath: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Strip anchors, aliases, and extensions for path/stem lookup. */
function normalizeTarget(target: string): string {
  return target
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/#.*/, "")
    .replace(/\|.*/, "")
    .replace(/\.(md|markdown|mdx)$/i, "");
}

function resolveSourceRelativeTarget(
  target: string,
  sourcePath: string | undefined,
): string | null {
  const normalized = target.trim().replace(/\\/g, "/");
  if (!sourcePath || (!normalized.startsWith("./") && !normalized.startsWith("../"))) {
    return normalized;
  }

  const segments = sourcePath.replace(/\\/g, "/").split("/").filter(Boolean);
  segments.pop();
  for (const segment of normalized.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (segments.length === 0) {
        return null;
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

function resolveNotePath(target: string, notesByStem: Map<string, ScannedNote[]>): string | null {
  const normalized = normalizeTarget(target);
  const stem = normalized.split("/").pop() ?? normalized;
  const candidates = notesByStem.get(stem.toLowerCase());

  if (!candidates || candidates.length === 0) {
    return null;
  }

  if (candidates.length === 1) {
    return candidates[0].path;
  }

  const exact = candidates.find(
    (note) => normalizeTarget(note.path).toLowerCase() === normalized.toLowerCase(),
  );
  return exact?.path ?? candidates[0].path;
}

function buildNotesByStem(notes: ScannedNote[]): Map<string, ScannedNote[]> {
  const map = new Map<string, ScannedNote[]>();

  function add(key: string, note: ScannedNote): void {
    const existing = map.get(key) ?? [];
    existing.push(note);
    map.set(key, existing);
  }

  for (const note of notes) {
    add(normalizeTarget(note.name).toLowerCase(), note);
  }

  return map;
}

export type DocumentResolutionReason = "exact-path" | "stem" | "alias" | "title" | null;

/**
 * Map a link target string to a scanned note path.
 *
 * Resolution is evidence-only (path, stem, alias, title). It does not create
 * documents, rewrite links, or consult open buffers.
 */
export function resolveDocumentPath(
  target: string,
  notes: ScannedNote[],
  resolution: LinkResolutionMode = activeDocumentLinkSettings.resolution,
  sourcePath?: string,
): { path: string | null; reason: DocumentResolutionReason } {
  const sourceRelativeTarget = resolveSourceRelativeTarget(target, sourcePath);
  if (sourceRelativeTarget === null) {
    return { path: null, reason: null };
  }
  if (!sourceRelativeTarget && sourcePath) {
    return { path: sourcePath, reason: "exact-path" };
  }
  const normalizedTarget = normalizeTarget(sourceRelativeTarget).toLowerCase();
  if (!normalizedTarget) {
    return { path: null, reason: null };
  }

  const targetWithoutDecorators = sourceRelativeTarget
    .trim()
    .replace(/#.*/, "")
    .replace(/\|.*/, "");
  const hasPathHint =
    targetWithoutDecorators.includes("/") ||
    targetWithoutDecorators.includes("\\") ||
    /\.(md|markdown|mdx)$/i.test(targetWithoutDecorators);

  if (resolution !== "stem" && hasPathHint) {
    const exactPath = notes.find(
      (note) => normalizeTarget(note.path).toLowerCase() === normalizedTarget,
    );
    if (exactPath) {
      return { path: exactPath.path, reason: "exact-path" };
    }
  }

  if (resolution !== "path") {
    const notesByStem = buildNotesByStem(notes);
    const stemPath = resolveNotePath(target, notesByStem);
    if (stemPath) {
      return { path: stemPath, reason: "stem" };
    }

    const normalizedLink = normalizeLinkText(target);
    const aliasMatch = notes.find((note) =>
      note.aliases.some((alias) => normalizeLinkText(alias) === normalizedLink),
    );
    if (aliasMatch) {
      return { path: aliasMatch.path, reason: "alias" };
    }

    const titleMatch = notes.find((note) => normalizeLinkText(note.title) === normalizedLink);
    if (titleMatch) {
      return { path: titleMatch.path, reason: "title" };
    }
  }

  return { path: null, reason: null };
}

function linksForNote(note: ScannedNote): LinkLike[] {
  return note.documentLinks.filter((link) => activeDocumentLinkSettings.linkMode === link.syntax);
}

/** Directed outgoing neighborhood for Context reach stats. Not the Graph page model. */
export function buildFocusGraph(
  focusPath: string,
  notes: ScannedNote[],
  depth: number,
): FocusGraph {
  const notesByPath = new Map(notes.map((note) => [note.path, note]));
  const nodePaths = new Set<string>([focusPath]);
  const edges: FocusGraph["edges"] = [];
  const seenEdges = new Set<string>();
  const queue: Array<{ path: string; currentDepth: number }> = [
    { path: focusPath, currentDepth: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const note = notesByPath.get(current.path);
    if (!note) {
      continue;
    }

    for (const link of linksForNote(note)) {
      const targetPath = resolveDocumentPath(
        link.target,
        notes,
        activeDocumentLinkSettings.resolution,
        current.path,
      ).path;
      if (!targetPath || targetPath === current.path) {
        continue;
      }

      if (!nodePaths.has(targetPath)) {
        if (current.currentDepth >= depth) {
          continue;
        }
        nodePaths.add(targetPath);
        queue.push({ path: targetPath, currentDepth: current.currentDepth + 1 });
      }

      const key = `${current.path}->${targetPath}`;
      if (!seenEdges.has(key)) {
        seenEdges.add(key);
        edges.push({ source: current.path, target: targetPath });
      }
    }
  }

  return {
    focusPath,
    nodes: [...nodePaths].map((path) => ({
      id: path,
      label: notesByPath.get(path)?.title ?? path.split(/[/\\]/).pop() ?? path,
    })),
    edges,
  };
}

/**
 * Every resolved reference between two distinct documents in the given
 * notes, deduplicated per source→target pair - the single definition of a
 * reference product-wide. One pass over the evidence, shared by workspace
 * structure facts, per-note reference counts, and the Document Context panel.
 */
export function resolveWorkspaceEdges(notes: ScannedNote[]): GraphEdge[] {
  const notePaths = new Set(notes.map((note) => note.path));
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  for (const note of notes) {
    for (const link of linksForNote(note)) {
      const target = resolveDocumentPath(
        link.target,
        notes,
        activeDocumentLinkSettings.resolution,
        note.path,
      ).path;
      if (!target || target === note.path || !notePaths.has(target)) {
        continue;
      }

      const key = `${note.path}->${target}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      edges.push({ source: note.path, target });
    }
  }

  return edges;
}

/**
 * Configured link targets on a note that do not resolve to any document in scope.
 * Evidence only - never suggests a repair.
 */
export function unresolvedDocumentLinks(note: ScannedNote, notes: ScannedNote[]): string[] {
  const unresolved: string[] = [];
  const seen = new Set<string>();

  for (const link of linksForNote(note)) {
    if (
      resolveDocumentPath(link.target, notes, activeDocumentLinkSettings.resolution, note.path).path
    ) {
      continue;
    }

    const key = link.target.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unresolved.push(link.target);
  }

  return unresolved.sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" }),
  );
}

export type LinkCandidateReason = "title" | "alias" | "filename";

export type LinkCandidate = {
  path: string;
  reason: LinkCandidateReason;
};

const MIN_PARTIAL_LINK_MATCH_LENGTH = 3;

/** Fuzzy display form for alias/title matching. Not a filesystem path. */
function normalizeLinkText(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/#.*/, "")
    .replace(/\|.*/, "")
    .replace(/\.(md|markdown|mdx)$/i, "")
    .toLowerCase()
    .replace(/[_/-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function candidateReason(linkNormalized: string, note: ScannedNote): LinkCandidateReason | null {
  if (linkNormalized.length === 0) {
    return null;
  }

  const title = normalizeLinkText(note.title);
  const stem = normalizeLinkText(note.name.replace(/\.(md|markdown|mdx)$/i, ""));
  const aliases = note.aliases.map(normalizeLinkText).filter(Boolean);

  if (aliases.some((alias) => alias === linkNormalized)) {
    return "alias";
  }
  if (title === linkNormalized) {
    return "title";
  }
  if (stem === linkNormalized) {
    return "filename";
  }

  // Containment only for meaningful fragments - avoid one-letter noise.
  if (linkNormalized.length < MIN_PARTIAL_LINK_MATCH_LENGTH) {
    return null;
  }

  if (
    title.includes(linkNormalized) ||
    (linkNormalized.includes(title) && title.length >= MIN_PARTIAL_LINK_MATCH_LENGTH)
  ) {
    return "title";
  }

  if (
    aliases.some(
      (alias) =>
        alias.includes(linkNormalized) ||
        (linkNormalized.includes(alias) && alias.length >= MIN_PARTIAL_LINK_MATCH_LENGTH),
    )
  ) {
    return "alias";
  }

  if (
    stem.includes(linkNormalized) ||
    (linkNormalized.includes(stem) && stem.length >= MIN_PARTIAL_LINK_MATCH_LENGTH)
  ) {
    return "filename";
  }

  return null;
}

const REASON_ORDER: Record<LinkCandidateReason, number> = {
  alias: 0,
  title: 1,
  filename: 2,
};

/**
 * Existing documents that resemble an unresolved document-link target.
 * Deterministic near-matches only - never invents a link or ranks by score.
 */
export function candidateNotesForLink(
  link: string,
  notes: ScannedNote[],
  limit = 3,
): LinkCandidate[] {
  const linkNormalized = normalizeLinkText(link);
  if (linkNormalized.length === 0) {
    return [];
  }

  const matches: LinkCandidate[] = [];

  for (const note of notes) {
    const reason = candidateReason(linkNormalized, note);
    if (!reason) {
      continue;
    }
    matches.push({ path: note.path, reason });
  }

  matches.sort(
    (left, right) =>
      REASON_ORDER[left.reason] - REASON_ORDER[right.reason] || left.path.localeCompare(right.path),
  );

  return matches.slice(0, limit);
}

/**
 * How one document connects to the rest of the scope - the outgoing and
 * incoming sides of the same reference evidence.
 */
export function noteConnections(
  focusPath: string,
  notes: ScannedNote[],
): { references: string[]; referencedBy: string[] } {
  const references: string[] = [];
  const referencedBy: string[] = [];

  for (const edge of resolveWorkspaceEdges(notes)) {
    if (edge.source === focusPath) {
      references.push(edge.target);
    } else if (edge.target === focusPath) {
      referencedBy.push(edge.source);
    }
  }

  return { references, referencedBy };
}

/**
 * Raw link texts on `source` that resolve to `targetPath`.
 * Structural evidence for why two documents are connected.
 */
export function resolvingDocumentLinks(
  source: ScannedNote,
  targetPath: string,
  notes: ScannedNote[],
): string[] {
  const matches: string[] = [];
  const seen = new Set<string>();

  for (const link of linksForNote(source)) {
    if (
      resolveDocumentPath(link.target, notes, activeDocumentLinkSettings.resolution, source.path)
        .path !== targetPath
    ) {
      continue;
    }

    const key = link.raw.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    matches.push(link.raw);
  }

  return matches;
}
