export type ReferenceGraphNode = {
  id: string;
  label: string;
  title: string;
};

export type ReferenceGraphEdge = {
  source: string;
  target: string;
};

/** Reference Graph Projection output - deterministic membership and explicit wikilinks. */
export type ReferenceGraph = {
  focusPath: string;
  nodes: ReferenceGraphNode[];
  edges: ReferenceGraphEdge[];
};

export type ComposedGraphNode = {
  id: string;
  label: string;
  title: string;
  x: number;
  y: number;
  depth: number;
};

/** Graph Core output after Composition - ready for Rendering. */
export type ComposedGraph = {
  focusPath: string;
  nodes: ComposedGraphNode[];
  edges: ReferenceGraphEdge[];
};

export type HoverDetails = {
  title: string;
  incoming: string[];
  outgoing: string[];
  x: number;
  y: number;
};

export type RendererInteraction = {
  hoveredNodeId: string | null;
  selectedNodeId: string | null;
};
