/**
 * Global Search hits over folder scan evidence.
 *
 * This is retrieval, not Find References and not Graph. It does not open
 * buffers or rewrite links. Matching lives in `searchStrategies.ts`; this
 * module applies collection caps, grouping, and file-type filters.
 */
import { documentFileType, type ScannedNote } from "../workspace/filesystem/workspaceTypes";
import { runSearchStrategy } from "./searchStrategies";
import type {
  SearchDocumentGroup,
  SearchHit,
  SearchQueryOptions,
  SearchRun,
} from "./searchStrategies";

export { highlightSearchSnippet } from "./searchStrategies";

const MAX_MATCHES_PER_DOCUMENT = 25;
const MAX_COLLECTED_MATCHES = 500;

export function runDocumentSearch(
  notes: readonly ScannedNote[],
  query: string,
  options: SearchQueryOptions = {},
): SearchRun {
  return runSearchStrategy(notes, query, options, {
    maxPerDocument: MAX_MATCHES_PER_DOCUMENT,
    maxCollected: MAX_COLLECTED_MATCHES,
  });
}

/**
 * Content search over scanned documents.
 *
 * ScannedNote is only the technical workspace index here; each hit points to
 * the persisted document path and its exact editor position.
 */
export function searchDocuments(
  notes: ScannedNote[],
  query: string,
  options: SearchQueryOptions = {},
): SearchHit[] {
  return runDocumentSearch(notes, query, options).hits;
}

export function groupSearchHits(hits: readonly SearchHit[]): SearchDocumentGroup[] {
  const groups: SearchDocumentGroup[] = [];
  const indexByPath = new Map<string, number>();

  for (const hit of hits) {
    const existing = indexByPath.get(hit.note.path);
    if (existing !== undefined) {
      groups[existing]?.matches.push(hit.match);
      continue;
    }
    indexByPath.set(hit.note.path, groups.length);
    groups.push({ note: hit.note, matches: [hit.match] });
  }

  return groups;
}

export function sortSearchGroups(
  groups: readonly SearchDocumentGroup[],
  sort: "path" | "matches",
): SearchDocumentGroup[] {
  return [...groups].sort((left, right) => {
    if (sort === "matches") {
      const byCount = right.matches.length - left.matches.length;
      if (byCount !== 0) {
        return byCount;
      }
    }
    return left.note.path.localeCompare(right.note.path);
  });
}

export function limitSearchGroups(
  groups: readonly SearchDocumentGroup[],
  maxMatches: number,
): SearchDocumentGroup[] {
  const limited: SearchDocumentGroup[] = [];
  let remaining = maxMatches;
  for (const group of groups) {
    if (remaining <= 0) {
      break;
    }
    limited.push({
      note: group.note,
      matches: group.matches.slice(0, remaining),
    });
    remaining -= Math.min(group.matches.length, remaining);
  }
  return limited;
}

export function filterNotesByFileType<T extends { path: string }>(
  notes: readonly T[],
  fileType: "all" | "md" | "markdown" | "mdx",
): T[] {
  if (fileType === "all") {
    return [...notes];
  }
  return notes.filter((note) => documentFileType(note.path) === fileType);
}
