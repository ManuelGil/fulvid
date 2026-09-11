/**
 * Simple identity matching for Quick Open.
 *
 * Compares a trimmed, case-insensitive query against title, filename, and
 * relative path only. Not content search; not fuzzy ranking.
 */

import type { QuickOpenCandidate } from "./quickOpenCandidates";

/** Cap visible rows so a full 5_000-document folder stays keyboard-usable. */
export const MAX_QUICK_OPEN_VISIBLE = 50;

export type QuickOpenMatchResult = {
  readonly matches: readonly QuickOpenCandidate[];
  /** Total matches before the visible cap. */
  readonly total: number;
};

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * Lower rank is better. Prefix on title → name → path, then substring hits.
 * `null` means no match.
 */
function matchRank(candidate: QuickOpenCandidate, query: string): number | null {
  const title = candidate.title.toLowerCase();
  const name = candidate.name.toLowerCase();
  const path = candidate.path.toLowerCase();

  if (title.startsWith(query)) {
    return 0;
  }
  if (name.startsWith(query)) {
    return 1;
  }
  if (path.startsWith(query)) {
    return 2;
  }
  if (title.includes(query) || name.includes(query) || path.includes(query)) {
    return 3;
  }
  return null;
}

function compareByPath(a: QuickOpenCandidate, b: QuickOpenCandidate): number {
  return a.path.localeCompare(b.path);
}

/**
 * Filter and order candidates for the picker.
 *
 * Empty query: every candidate, sorted by path.
 * Non-empty: matches on title / name / path, ordered by prefix preference then path.
 */
export function matchQuickOpenCandidates(
  candidates: readonly QuickOpenCandidate[],
  query: string,
): QuickOpenMatchResult {
  const normalized = normalizeQuery(query);

  let ordered: QuickOpenCandidate[];
  if (!normalized) {
    ordered = [...candidates].sort(compareByPath);
  } else {
    const ranked: { candidate: QuickOpenCandidate; rank: number }[] = [];
    for (const candidate of candidates) {
      const rank = matchRank(candidate, normalized);
      if (rank !== null) {
        ranked.push({ candidate, rank });
      }
    }
    ranked.sort((a, b) => a.rank - b.rank || compareByPath(a.candidate, b.candidate));
    ordered = ranked.map((entry) => entry.candidate);
  }

  return {
    matches: ordered.slice(0, MAX_QUICK_OPEN_VISIBLE),
    total: ordered.length,
  };
}
