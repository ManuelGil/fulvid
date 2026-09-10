/** Shared search scope rules for SearchPage and SearchSidebar. */

import type { LocationQueryRaw } from "vue-router";

export function isContextSearchScope(routeScope: unknown, hasCustomContext: boolean): boolean {
  return routeScope === "context" && hasCustomContext;
}

export function searchScopeQuery(
  currentQuery: LocationQueryRaw,
  scope: "folder" | "context",
): LocationQueryRaw {
  return {
    ...currentQuery,
    scope: scope === "context" ? "context" : undefined,
  };
}
