/**
 * Structural Selection - Graph Core stage.
 *
 * Selects relationships that participate in representation topology.
 * Never changes graph semantics, topology, or membership.
 */
import type { ReferenceGraph, ReferenceGraphEdge } from "./graphTypes";

/**
 * Depth for a node the focus BFS never reached. Only the bands matter to
 * `selectStructuralEdges` (focus is 0, neighbor 1, secondary 2), so any value
 * past secondary behaves the same; naming it keeps that intent visible.
 */
const BEYOND_SECONDARY_DEPTH = 3;

export function buildDepthMap(
  graph: ReferenceGraph,
  edges: ReferenceGraphEdge[],
  focusId: string,
): Map<string, number> {
  const adjacency = new Map<string, Set<string>>();

  for (const node of graph.nodes) {
    adjacency.set(node.id, new Set());
  }

  for (const edge of edges) {
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }

  const depths = new Map<string, number>();
  const queue = [focusId];

  depths.set(focusId, 0);

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) {
      break;
    }
    const currentDepth = depths.get(currentId);
    if (currentDepth === undefined) {
      continue;
    }

    for (const neighborId of adjacency.get(currentId) ?? []) {
      if (depths.has(neighborId)) {
        continue;
      }

      depths.set(neighborId, currentDepth + 1);
      queue.push(neighborId);
    }
  }

  for (const node of graph.nodes) {
    if (!depths.has(node.id)) {
      depths.set(node.id, BEYOND_SECONDARY_DEPTH);
    }
  }

  return depths;
}

/**
 * Keeps edges that explain contextual structure:
 * focus spokes and neighbor to secondary links.
 */
export function selectStructuralEdges(
  edges: ReferenceGraphEdge[],
  depthMap: Map<string, number>,
  focusId: string,
): ReferenceGraphEdge[] {
  return edges.filter((edge) => {
    if (edge.source === focusId || edge.target === focusId) {
      return true;
    }

    const sourceDepth = depthMap.get(edge.source) ?? BEYOND_SECONDARY_DEPTH;
    const targetDepth = depthMap.get(edge.target) ?? BEYOND_SECONDARY_DEPTH;
    const minDepth = Math.min(sourceDepth, targetDepth);
    const maxDepth = Math.max(sourceDepth, targetDepth);

    return minDepth === 1 && maxDepth >= 2;
  });
}
