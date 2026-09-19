/**
 * Reference Graph Projection - undirected, focus-scoped membership for the Graph page.
 *
 * Distinct from `buildFocusGraph` (directed outgoing BFS for Context stats).
 * Consumes Graph View State; never Shell or editor `activeId`.
 */
import { resolveWorkspaceEdges } from "../../document/links/linkSemantics";
import type { ScannedNote } from "../../workspace/filesystem/workspaceTypes";

import type { GraphViewState } from "./graphViewState";
import type { ReferenceGraph, ReferenceGraphEdge } from "./graphTypes";

function buildUndirectedAdjacency(edges: ReferenceGraphEdge[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();

  for (const edge of edges) {
    if (!adjacency.has(edge.source)) {
      adjacency.set(edge.source, new Set());
    }
    if (!adjacency.has(edge.target)) {
      adjacency.set(edge.target, new Set());
    }
    adjacency.get(edge.source)!.add(edge.target);
    adjacency.get(edge.target)!.add(edge.source);
  }

  return adjacency;
}

function memberPathsFromFocus(
  focusPath: string,
  adjacency: Map<string, Set<string>>,
  depth: number,
): Set<string> {
  const members = new Set<string>([focusPath]);
  const queue: Array<{ path: string; currentDepth: number }> = [
    { path: focusPath, currentDepth: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    if (current.currentDepth >= depth) {
      continue;
    }

    for (const neighbor of adjacency.get(current.path) ?? []) {
      if (members.has(neighbor)) {
        continue;
      }
      members.add(neighbor);
      queue.push({ path: neighbor, currentDepth: current.currentDepth + 1 });
    }
  }

  return members;
}

export function projectReferenceGraph(
  focusPath: string,
  notes: ScannedNote[],
  viewState: GraphViewState,
): ReferenceGraph {
  const notesByPath = new Map(notes.map((note) => [note.path, note]));
  const workspaceEdges = resolveWorkspaceEdges(notes);
  const adjacency = buildUndirectedAdjacency(workspaceEdges);
  const members = memberPathsFromFocus(focusPath, adjacency, viewState.depth);

  const edges: ReferenceGraphEdge[] = [];
  const seen = new Set<string>();

  for (const edge of workspaceEdges) {
    if (!members.has(edge.source) || !members.has(edge.target)) {
      continue;
    }

    const key = `${edge.source}->${edge.target}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    edges.push(edge);
  }

  return {
    focusPath,
    nodes: [...members].map((path) => ({
      id: path,
      label:
        notesByPath.get(path)?.title ??
        path
          .split(/[/\\]/)
          .pop()
          ?.replace(/\.(md|markdown|mdx)$/i, "") ??
        path,
      title: notesByPath.get(path)?.title ?? path,
    })),
    edges,
  };
}

/** Keeps only edges with concrete endpoints inside the projection. */
export function filterRenderableEdges(graph: ReferenceGraph): ReferenceGraphEdge[] {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));

  return graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
}
