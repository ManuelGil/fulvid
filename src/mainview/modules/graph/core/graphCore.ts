/**
 * Graph Core pipeline - membership in, geometry out.
 *
 *   filterRenderableEdges -> depth map -> structural edges -> layout -> composition
 *
 * Stages must not change Search, Explorer, Focus, or document identity.
 * Representation (Sigma) starts after this function returns.
 */
import { composeGraphRegions, nodeLabel } from "./graphComposition";
import { layoutReferenceGraph } from "./graphLayout";
import { filterRenderableEdges } from "./graphProjection";
import { buildDepthMap, selectStructuralEdges } from "./graphStructuralSelection";
import type { ComposedGraph, ReferenceGraph } from "./graphTypes";

export function runGraphCore(graph: ReferenceGraph): ComposedGraph {
  if (graph.nodes.length === 0) {
    return { focusPath: graph.focusPath, nodes: [], edges: [] };
  }

  const renderable = filterRenderableEdges(graph);
  const focusId = graph.focusPath;
  const depthMap = buildDepthMap(graph, renderable, focusId);
  const structural = selectStructuralEdges(renderable, depthMap, focusId);
  const layoutEdges = structural.length > 0 ? structural : renderable;
  const ranked = layoutReferenceGraph(graph, layoutEdges);
  const composed = composeGraphRegions(ranked, depthMap, focusId, layoutEdges);

  return {
    focusPath: focusId,
    nodes: graph.nodes.map((node) => {
      // The composition stage preserves every node after the empty-graph check.
      const position = composed.get(node.id)!;

      return {
        id: node.id,
        label: nodeLabel(graph, node.id),
        title: node.title,
        x: position.x,
        y: position.y,
        depth: depthMap.get(node.id) ?? 3,
      };
    }),
    edges: layoutEdges,
  };
}
