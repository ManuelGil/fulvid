/**
 * Layout - Graph Core stage. Geometry only: ordering, ranking, coordinates.
 */
import dagre from "@dagrejs/dagre";

import type { ReferenceGraph, ReferenceGraphEdge } from "./graphTypes";

const DAGRE_GRAPH_OPTIONS = {
  rankdir: "LR",
  align: "UL",
  nodesep: 56,
  ranksep: 110,
  edgesep: 18,
  marginx: 28,
  marginy: 28,
} as const;

const NODE_WIDTH = 132;
const NODE_HEIGHT = 44;
const FOCUS_NODE_WIDTH = 168;
const FOCUS_NODE_HEIGHT = 56;

export type LayoutPosition = {
  x: number;
  y: number;
};

/** Assigns ranked coordinates via Dagre over structurally selected edges. */
export function layoutReferenceGraph(
  graph: ReferenceGraph,
  edges: ReferenceGraphEdge[],
): Map<string, LayoutPosition> {
  const dagreGraph = new dagre.graphlib.Graph();

  dagreGraph.setGraph({ ...DAGRE_GRAPH_OPTIONS });
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  for (const node of graph.nodes) {
    const isFocus = node.id === graph.focusPath;

    dagreGraph.setNode(node.id, {
      width: isFocus ? FOCUS_NODE_WIDTH : NODE_WIDTH,
      height: isFocus ? FOCUS_NODE_HEIGHT : NODE_HEIGHT,
    });
  }

  const addedEdges = new Set<string>();

  for (const edge of edges) {
    const edgeKey = `${edge.source}->${edge.target}`;

    if (addedEdges.has(edgeKey)) {
      continue;
    }

    addedEdges.add(edgeKey);
    dagreGraph.setEdge(edge.source, edge.target);
  }

  dagre.layout(dagreGraph);

  const positions = new Map<string, LayoutPosition>();

  for (const node of graph.nodes) {
    const layoutNode = dagreGraph.node(node.id) as { x: number; y: number };

    positions.set(node.id, {
      x: layoutNode.x,
      y: layoutNode.y,
    });
  }

  return positions;
}
