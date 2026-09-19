/**
 * Graph Renderer - communicates visual hierarchy. Does not compute Graph Core.
 */
import Graph from "graphology";
import Sigma from "sigma";

import type {
  ComposedGraph,
  ComposedGraphNode,
  HoverDetails,
  ReferenceGraphEdge,
  RendererInteraction,
} from "../core/graphTypes";

const MAX_VISIBLE_LABEL_LENGTH = 20;
const FOCUS_LABEL_LENGTH = 42;
const SECONDARY_LABEL_LENGTH = 10;
const FOCUS_NODE_SIZE = 24;
const HIGHLIGHTED_NODE_SIZE = 14.5;
const NEIGHBOR_NODE_SIZE = 12;
const SECONDARY_NODE_SIZE = 5.5;
const FOCUS_BORDER_SIZE = 3.6;
const FOCUS_EDGE_SIZE = 3.4;
const NEIGHBOR_EDGE_SIZE = 1.85;
const SECONDARY_EDGE_SIZE = 0.75;
const ACTIVE_EDGE_SIZE = 3.4;
const DIMMED_EDGE_SIZE = 0.4;
const LABEL_OFFSET_Y = 9;
const STAGE_PADDING = 48;
const ZOOM_STEP = 1.16;
const HOVER_LEAVE_MS = 140;
const CAMERA_FRAME_MS = 260;
const CAMERA_ZOOM_MS = 160;
const CAMERA_CENTER_MS = 220;
const FRAME_RETRY_LIMIT = 16;

type CameraIntent = {
  x: number;
  y: number;
  ratio: number;
  angle: number;
};

/**
 * With Sigma autoRescale, graph coordinates live in normalized framed space.
 * Camera {0.5, 0.5, ratio: 1} frames the full current projection.
 */
const PROJECTION_FRAME: CameraIntent = {
  x: 0.5,
  y: 0.5,
  ratio: 1,
  angle: 0,
};

/** Visual progression: focus, direct neighbors, expanded ring, remaining nodes. */
const DEPTH_OPACITY: Record<number, number> = {
  0: 1,
  1: 0.98,
  2: 0.28,
  3: 0.16,
  4: 0.1,
  5: 0.07,
};

const depthOpacity = (depth: number): number => DEPTH_OPACITY[depth] ?? DEPTH_OPACITY[5];

let themeColorHost: HTMLElement | undefined;

const cssVar = (name: string, fallback = "#888888"): string => {
  const host = themeColorHost ?? document.documentElement;
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;width:0;height:0;visibility:hidden;pointer-events:none;";
  host.appendChild(probe);

  probe.style.color = `var(${name})`;
  const color = getComputedStyle(probe).color;
  probe.style.color = "";

  if (color && color !== "transparent" && color !== "rgba(0, 0, 0, 0)") {
    probe.remove();
    return color;
  }

  probe.style.backgroundColor = `var(${name})`;
  const background = getComputedStyle(probe).backgroundColor;
  probe.remove();

  if (background && background !== "transparent" && background !== "rgba(0, 0, 0, 0)") {
    return background;
  }

  return fallback;
};

const interfaceTextScale = (): number => {
  const value = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--ui-text-scale"),
  );
  return Number.isFinite(value) && value > 0 ? value : 1;
};

const graphLabelSize = (baseSize: number): number =>
  Math.max(9, Math.round(baseSize * interfaceTextScale()));

const graphFontFamily = (): string =>
  getComputedStyle(themeColorHost ?? document.body).fontFamily ||
  '"IBM Plex Sans", "Segoe UI", ui-sans-serif, system-ui, sans-serif';

const forcedColorsActive = (): boolean =>
  typeof window !== "undefined" && window.matchMedia("(forced-colors: active)").matches;

const withAlpha = (color: string, alpha: number): string => {
  const match = color.match(/rgba?\(([^)]+)\)/);

  if (!match) {
    return color;
  }

  const parts = match[1].split(",").map((part) => part.trim());

  if (parts.length < 3) {
    return color;
  }

  return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
};

const cameraDuration = (ms: number): number => {
  const root = document.documentElement;
  if (root.dataset.reducedMotion === "true") {
    return 0;
  }
  if (
    root.dataset.reducedMotion !== "false" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return 0;
  }
  return ms;
};

const truncateLabel = (label: string, maxLength = MAX_VISIBLE_LABEL_LENGTH): string => {
  const trimmed = label.trim();

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(0, maxLength - 3))}...`;
};

const labelLengthForDepth = (depth: number): number => {
  if (depth === 0) {
    return FOCUS_LABEL_LENGTH;
  }

  if (depth === 1) {
    return MAX_VISIBLE_LABEL_LENGTH;
  }

  return SECONDARY_LABEL_LENGTH;
};

const drawNodeLabelBelow = (
  context: CanvasRenderingContext2D,
  data: {
    x: number;
    y: number;
    size: number;
    label?: string | null;
    labelColor?: string;
    labelSize?: number;
    labelWeight?: string;
    labelHalo?: boolean;
  },
  settings: {
    labelSize: number;
    labelFont: string;
    labelWeight: string;
    labelColor: { attribute?: string; color?: string };
  },
): void => {
  if (!data.label) {
    return;
  }

  const fontSize = data.labelSize ?? settings.labelSize;
  const font = settings.labelFont;
  const weight = data.labelWeight ?? settings.labelWeight;
  const color =
    data.labelColor ??
    (settings.labelColor.attribute
      ? cssVar("--graph-label-color")
      : (settings.labelColor.color ?? cssVar("--graph-label-color")));

  context.font = `${weight} ${fontSize}px ${font}`;
  context.textAlign = "center";
  context.textBaseline = "top";

  const textX = data.x;
  const textY = data.y + data.size + LABEL_OFFSET_Y;

  if (data.labelHalo) {
    const metrics = context.measureText(data.label);
    const padX = 6;
    const padY = 3;
    const width = metrics.width + padX * 2;
    const height = fontSize + padY * 2;
    context.fillStyle = cssVar("--graph-label-halo");
    context.beginPath();
    const radius = 4;
    const left = textX - width / 2;
    const top = textY - padY;
    context.moveTo(left + radius, top);
    context.arcTo(left + width, top, left + width, top + height, radius);
    context.arcTo(left + width, top + height, left, top + height, radius);
    context.arcTo(left, top + height, left, top, radius);
    context.arcTo(left, top, left + width, top, radius);
    context.closePath();
    context.fill();
  }

  context.fillStyle = color;
  context.fillText(data.label, textX, textY);
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
};

export type GraphRendererEvents = {
  onHover: (details: HoverDetails | null) => void;
  onNodeClick: (nodeId: string) => void;
  onNodeDoubleClick?: (nodeId: string) => void;
};

export type GraphRenderer = {
  mount: (
    container: HTMLDivElement,
    interaction: RendererInteraction,
    events: GraphRendererEvents,
    getConnectionDetails: (nodeId: string) => Omit<HoverDetails, "x" | "y">,
  ) => void;
  syncGraph: (graph: ComposedGraph) => void;
  /** Zoom in. */
  zoomIn: () => void;
  /** Zoom out. */
  zoomOut: () => void;
  /** Highlight a node without changing Graph Core. */
  setHighlightedNode: (nodeId: string | null) => void;
  /** Move toward a visible node. */
  centerOnNode: (nodeId: string) => void;
  /** Pan to the Focus document at the current zoom. */
  centerOnFocus: () => void;
  /** Match Sigma to the container size. */
  resize: () => void;
  dispose: () => void;
};

export function getNodeConnectionDetails(
  nodeId: string,
  nodes: ComposedGraphNode[],
  edges: ReferenceGraphEdge[],
): Omit<HoverDetails, "x" | "y"> {
  const titleForNodeId = (id: string): string => {
    const node = nodes.find((entry) => entry.id === id);

    return node?.title ?? node?.label ?? id;
  };

  const incoming = new Set<string>();
  const outgoing = new Set<string>();

  for (const edge of edges) {
    if (edge.target === nodeId) {
      incoming.add(titleForNodeId(edge.source));
    }

    if (edge.source === nodeId) {
      outgoing.add(titleForNodeId(edge.target));
    }
  }

  return {
    title: titleForNodeId(nodeId),
    incoming: [...incoming].sort((left, right) => left.localeCompare(right)),
    outgoing: [...outgoing].sort((left, right) => left.localeCompare(right)),
  };
}

/** Identity of a composed projection: same focus, geometry and edges. */
export function graphSignature(composed: ComposedGraph): string {
  const nodeIds = composed.nodes
    .map((node) => `${node.id}:${node.x},${node.y},${node.depth}`)
    .join("\0");
  const edgeIds = composed.edges.map((edge) => `${edge.source}->${edge.target}`).join("\0");

  return `${composed.focusPath}|${nodeIds}|${edgeIds}`;
}

export function createGraphRenderer(): GraphRenderer {
  let graph: Graph | undefined;
  let renderer: Sigma | undefined;
  let latestNodes: ComposedGraphNode[] = [];
  let latestEdges: ReferenceGraphEdge[] = [];
  let focusPath = "";
  let interaction: RendererInteraction = {
    hoveredNodeId: null,
    selectedNodeId: null,
  };
  let getConnectionDetails: (nodeId: string) => Omit<HoverDetails, "x" | "y"> = () => ({
    title: "",
    incoming: [],
    outgoing: [],
  });
  let events: GraphRendererEvents = {
    onHover: () => {},
    onNodeClick: () => {},
  };
  let projectionSignature: string | null = null;
  let hoverLeaveTimer: ReturnType<typeof setTimeout> | null = null;
  let frameGeneration = 0;
  let lastViewport = { width: 0, height: 0 };

  const isNodeConnectedToSelection = (nodeId: string): boolean => {
    if (!interaction.selectedNodeId) {
      return false;
    }

    return latestEdges.some(
      (edge) =>
        (edge.source === interaction.selectedNodeId && edge.target === nodeId) ||
        (edge.target === interaction.selectedNodeId && edge.source === nodeId),
    );
  };

  const isEdgeHighlighted = (source: string, target: string): boolean => {
    if (
      interaction.selectedNodeId &&
      (source === interaction.selectedNodeId || target === interaction.selectedNodeId)
    ) {
      return true;
    }

    if (
      interaction.hoveredNodeId &&
      (source === interaction.hoveredNodeId || target === interaction.hoveredNodeId)
    ) {
      return true;
    }

    return false;
  };

  const hasActiveInteraction = (): boolean =>
    Boolean(interaction.hoveredNodeId || interaction.selectedNodeId);

  const applyNodeReducer = (node: string, data: Record<string, unknown>) => {
    const renderNode = latestNodes.find((entry) => entry.id === node);
    const isFocus = node === focusPath;
    const isSelected = interaction.selectedNodeId === node;
    const isHovered = interaction.hoveredNodeId === node;
    const isHighlighted = isSelected || isHovered || isNodeConnectedToSelection(node);
    const nodeDepth = renderNode?.depth ?? 3;
    const rawLabel = renderNode?.label ?? "";
    const showLabel = nodeDepth <= 1 || isHovered || isSelected;

    let size = SECONDARY_NODE_SIZE;
    if (isFocus) {
      size = FOCUS_NODE_SIZE;
    } else if (nodeDepth <= 1) {
      size = NEIGHBOR_NODE_SIZE;
    }

    if (isHighlighted && !isFocus) {
      size = Math.max(size, HIGHLIGHTED_NODE_SIZE);
    }

    let nodeColor = cssVar("--graph-node-default-color");
    let borderColor = cssVar("--graph-node-default-border");
    let borderSize = 0.5;

    if (nodeDepth <= 1 && !isFocus) {
      nodeColor = cssVar("--graph-node-neighbor-color");
      borderColor = cssVar("--graph-node-neighbor-border");
      borderSize = 1.2;
    }

    if (isFocus) {
      nodeColor = cssVar("--graph-node-focus-color");
      borderColor = cssVar("--graph-node-focus-border");
      borderSize = FOCUS_BORDER_SIZE;
    }

    if (isHighlighted && !isFocus) {
      nodeColor = cssVar("--graph-node-highlight");
      borderColor = cssVar("--graph-node-highlight");
      borderSize = 1.8;
    }

    if (isHighlighted && isFocus) {
      borderSize = FOCUS_BORDER_SIZE + 0.6;
    }

    const forcedColors = forcedColorsActive();
    const depthAlpha = forcedColors ? 1 : depthOpacity(nodeDepth);
    let visualAlpha = depthAlpha;
    if (isHighlighted) {
      visualAlpha = Math.max(depthAlpha, 0.98);
    } else if (!forcedColors && hasActiveInteraction() && !isFocus && nodeDepth > 1) {
      visualAlpha = Math.min(depthAlpha, 0.11);
    }

    nodeColor = withAlpha(nodeColor, visualAlpha);
    borderColor = withAlpha(borderColor, visualAlpha);

    let zIndex = 0;
    if (isFocus) {
      zIndex = isSelected || isHovered ? 4 : 3;
    } else if (isHighlighted) {
      zIndex = 2;
    } else if (nodeDepth <= 1) {
      zIndex = 1;
    }

    const labelColorVar = isFocus || nodeDepth <= 1 ? "--graph-label-color" : "--graph-label-muted";

    return {
      ...data,
      color: nodeColor,
      borderColor,
      borderSize,
      size,
      label: showLabel ? truncateLabel(rawLabel, labelLengthForDepth(isFocus ? 0 : nodeDepth)) : "",
      labelColor: withAlpha(
        cssVar(labelColorVar),
        forcedColors || isFocus
          ? 1
          : nodeDepth <= 1
            ? Math.max(visualAlpha, 0.9)
            : Math.min(visualAlpha, 0.48),
      ),
      labelSize: graphLabelSize(isFocus ? 15 : nodeDepth <= 1 ? 12 : 9),
      labelWeight: isFocus ? "700" : nodeDepth <= 1 ? "600" : "500",
      labelHalo: isFocus || isHovered || isSelected,
      zIndex,
    };
  };

  const applyEdgeReducer = (edge: string, data: Record<string, unknown>) => {
    if (!graph?.hasEdge(edge)) {
      return data;
    }

    const source = graph.source(edge);
    const target = graph.target(edge);
    const highlighted = isEdgeHighlighted(source, target);
    const activeInteraction = hasActiveInteraction();
    const forcedColors = forcedColorsActive();
    const touchesFocus = focusPath !== "" && (source === focusPath || target === focusPath);
    const sourceDepth = latestNodes.find((node) => node.id === source)?.depth ?? 3;
    const targetDepth = latestNodes.find((node) => node.id === target)?.depth ?? 3;
    const minDepth = Math.min(sourceDepth, targetDepth);
    const edgeAlpha = forcedColors
      ? 1
      : Math.min(depthOpacity(sourceDepth), depthOpacity(targetDepth));

    let edgeColor: string;
    let edgeSize: number;
    let edgeZIndex: number;

    if (touchesFocus) {
      edgeColor = withAlpha(cssVar("--graph-edge-focus"), Math.max(edgeAlpha, 0.94));
      edgeSize = FOCUS_EDGE_SIZE;
      edgeZIndex = 2;
    } else if (minDepth <= 1) {
      edgeColor = withAlpha(
        cssVar("--graph-edge-color"),
        forcedColors ? 1 : Math.min(Math.max(edgeAlpha, 0.55), 0.78),
      );
      edgeSize = NEIGHBOR_EDGE_SIZE;
      edgeZIndex = 1;
    } else {
      edgeColor = withAlpha(
        cssVar("--graph-edge-color"),
        forcedColors ? 1 : Math.min(edgeAlpha, 0.22),
      );
      edgeSize = SECONDARY_EDGE_SIZE;
      edgeZIndex = 0;
    }

    if (activeInteraction) {
      if (highlighted) {
        edgeColor = withAlpha(cssVar("--graph-edge-highlight"), 0.95);
        edgeSize = ACTIVE_EDGE_SIZE;
        edgeZIndex = 2;
      } else {
        edgeColor = withAlpha(
          cssVar("--graph-edge-dimmed"),
          forcedColors ? 1 : Math.min(edgeAlpha, 0.12),
        );
        edgeSize = DIMMED_EDGE_SIZE;
        edgeZIndex = 0;
      }
    }

    return {
      ...data,
      color: edgeColor,
      size: edgeSize,
      zIndex: edgeZIndex,
    };
  };

  const syncGraphNodes = (nodes: ComposedGraphNode[]) => {
    if (!graph) {
      return;
    }

    const nextIds = new Set(nodes.map((node) => node.id));
    const defaultNodeColor = cssVar("--graph-node-default-color");

    for (const existingId of graph.nodes()) {
      if (!nextIds.has(existingId)) {
        graph.dropNode(existingId);
      }
    }

    for (const node of nodes) {
      const attributes = {
        x: node.x,
        y: node.y,
        size: SECONDARY_NODE_SIZE,
        label: node.label,
        color: defaultNodeColor,
      };

      if (graph.hasNode(node.id)) {
        graph.mergeNodeAttributes(node.id, attributes);
      } else {
        graph.addNode(node.id, attributes);
      }
    }
  };

  const addRenderableEdges = (edges: ReferenceGraphEdge[]): void => {
    if (!graph) {
      return;
    }

    const nodeIds = new Set(latestNodes.map((node) => node.id));
    const defaultEdgeColor = cssVar("--graph-edge-color");

    for (const edge of edges) {
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
        continue;
      }

      const edgeId = `${edge.source}->${edge.target}`;

      if (graph.hasEdge(edgeId)) {
        continue;
      }

      const touchesFocus =
        focusPath !== "" && (edge.source === focusPath || edge.target === focusPath);

      graph.addEdgeWithKey(edgeId, edge.source, edge.target, {
        size: touchesFocus ? FOCUS_EDGE_SIZE : NEIGHBOR_EDGE_SIZE,
        color: defaultEdgeColor,
        type: touchesFocus ? "arrow" : "line",
        zIndex: touchesFocus ? 1 : 0,
      });
    }
  };

  const animateCamera = (state: CameraIntent, duration: number): void => {
    const camera = renderer?.getCamera();
    if (!camera) {
      return;
    }

    if (duration <= 0) {
      camera.setState(state);
      renderer?.refresh();
      return;
    }

    void camera.animate(state, { duration: cameraDuration(duration) });
  };

  const viewportIsValid = (): boolean => {
    if (!renderer) {
      return false;
    }

    const { width, height } = renderer.getDimensions();
    return width > 1 && height > 1;
  };

  /**
   * Focus is on-screen in viewport pixels (framed-graph -> viewport).
   * Used after resize to detect a broken view without storing camera state.
   */
  const isFocusOnScreen = (): boolean => {
    if (!renderer || !focusPath || latestNodes.length === 0) {
      return latestNodes.length === 0;
    }

    const display = renderer.getNodeDisplayData(focusPath);
    if (!display) {
      return false;
    }

    const point = renderer.framedGraphToViewport({
      x: display.x,
      y: display.y,
    });
    const { width, height } = renderer.getDimensions();
    const pad = 24;

    return point.x >= -pad && point.x <= width + pad && point.y >= -pad && point.y <= height + pad;
  };

  /**
   * Show the full projection. With autoRescale, camera identity {0.5, 0.5, 1}
   * is the correct frame - never bbox math in raw layout coordinates.
   */
  const frameProjection = (duration: number, generation: number): void => {
    if (!renderer || generation !== frameGeneration) {
      return;
    }

    if (latestNodes.length === 0) {
      return;
    }

    renderer.resize(true);
    renderer.refresh();

    if (!viewportIsValid()) {
      return;
    }

    const viewport = renderer.getDimensions();
    lastViewport = { width: viewport.width, height: viewport.height };
    animateCamera({ ...PROJECTION_FRAME }, duration);
  };

  const scheduleFrame = (duration: number, generation: number, attempt = 0): void => {
    requestAnimationFrame(() => {
      if (!renderer || generation !== frameGeneration) {
        return;
      }

      renderer.resize(true);
      renderer.refresh();

      if (!viewportIsValid() && attempt < FRAME_RETRY_LIMIT) {
        scheduleFrame(duration, generation, attempt + 1);
        return;
      }

      // One extra frame so node display data exists after process().
      if (attempt === 0) {
        scheduleFrame(duration, generation, 1);
        return;
      }

      frameProjection(duration, generation);
    });
  };

  const ensureMounted = (container: HTMLDivElement) => {
    if (graph || renderer) {
      return;
    }

    themeColorHost = container.closest<HTMLElement>(".graph-workbench") ?? container;

    graph = new Graph({ multi: true });
    const rendererSettings = {
      defaultEdgeType: "arrow",
      renderEdgeLabels: false,
      stagePadding: STAGE_PADDING,
      labelDensity: 0.7,
      labelGridCellSize: 100,
      labelRenderedSizeThreshold: 0,
      labelFont: graphFontFamily(),
      labelSize: graphLabelSize(12),
      labelWeight: "600",
      labelColor: { attribute: "labelColor" },
      defaultDrawNodeLabel: drawNodeLabelBelow,
      minEdgeThickness: 1.05,
      // autoRescale (default true) maps layout -> framed space; camera {0.5,0.5,1} frames it.
      autoRescale: true,
      autoCenter: true,
      // Without a max zoom-out, large neighborhoods stay visible in the viewport.
      minCameraRatio: 0.05,
      maxCameraRatio: null,
      allowInvalidContainer: true,
      zoomDuration: CAMERA_ZOOM_MS,
      zoomingRatio: ZOOM_STEP,
      enableCameraRotation: false,
      defaultNodeCursor: "pointer",
      defaultEdgeCursor: "default",
      defaultMouseCursor: "grab",
    } as ConstructorParameters<typeof Sigma>[2];
    renderer = new Sigma(graph, container, rendererSettings);

    renderer.resize(true);
    renderer.getCamera().setState({ ...PROJECTION_FRAME });
    renderer.setSetting("nodeReducer", applyNodeReducer);
    renderer.setSetting("edgeReducer", applyEdgeReducer);

    interaction.selectedNodeId = focusPath || interaction.selectedNodeId;

    renderer.on("enterNode", ({ node, event }) => {
      if (hoverLeaveTimer) {
        clearTimeout(hoverLeaveTimer);
        hoverLeaveTimer = null;
      }
      interaction.hoveredNodeId = node;
      events.onHover({
        ...getConnectionDetails(node),
        x: event.x,
        y: event.y,
      });
      renderer?.refresh();
    });

    renderer.on("leaveNode", () => {
      if (hoverLeaveTimer) {
        clearTimeout(hoverLeaveTimer);
      }
      hoverLeaveTimer = setTimeout(() => {
        hoverLeaveTimer = null;
        interaction.hoveredNodeId = null;
        events.onHover(null);
        renderer?.refresh();
      }, HOVER_LEAVE_MS);
    });

    renderer.on("mousemoveNode" as "enterNode", ({ node, event }) => {
      if (interaction.hoveredNodeId !== node) {
        return;
      }

      events.onHover({
        ...getConnectionDetails(node),
        x: event.x,
        y: event.y,
      });
    });

    renderer.on("clickNode", ({ node, event }) => {
      event.preventSigmaDefault();
      interaction.selectedNodeId = node;
      events.onNodeClick(node);
      renderer?.refresh();
    });

    renderer.on("doubleClickNode", ({ node, event }) => {
      event.preventSigmaDefault();
      interaction.selectedNodeId = node;
      events.onNodeDoubleClick?.(node);
      renderer?.refresh();
    });

    renderer.on("doubleClickStage", ({ event }) => {
      event.preventSigmaDefault();
    });

    renderer.on("clickStage", () => {
      interaction.selectedNodeId = focusPath || null;
      renderer?.refresh();
    });
  };

  return {
    mount(container, nextInteraction, nextEvents, nextGetConnectionDetails) {
      interaction = nextInteraction;
      events = nextEvents;
      getConnectionDetails = nextGetConnectionDetails;
      ensureMounted(container);
    },

    syncGraph(composed) {
      const hadProjection = projectionSignature !== null;

      latestNodes = composed.nodes;
      latestEdges = composed.edges;
      focusPath = composed.focusPath;
      interaction.selectedNodeId = composed.focusPath;
      syncGraphNodes(latestNodes);
      graph?.clearEdges();
      addRenderableEdges(latestEdges);
      renderer?.refresh();

      const signature = graphSignature(composed);
      if (signature !== projectionSignature) {
        projectionSignature = signature;
        const generation = ++frameGeneration;
        scheduleFrame(hadProjection ? CAMERA_FRAME_MS : 0, generation);
      }
    },

    resize() {
      if (!renderer) {
        return;
      }

      renderer.resize(true);
      renderer.refresh();

      const viewport = renderer.getDimensions();
      const becameValid =
        (lastViewport.width <= 1 || lastViewport.height <= 1) &&
        viewport.width > 1 &&
        viewport.height > 1;
      lastViewport = { width: viewport.width, height: viewport.height };

      if (latestNodes.length === 0) {
        return;
      }

      // New valid size, or Focus left the viewport - reframe. Never leave graph off-screen.
      if (becameValid || !isFocusOnScreen()) {
        const generation = ++frameGeneration;
        scheduleFrame(0, generation);
      }
    },

    zoomIn() {
      const camera = renderer?.getCamera();
      if (!camera) {
        return;
      }

      const ratio = camera.getBoundedRatio(camera.ratio / ZOOM_STEP);
      animateCamera({ x: camera.x, y: camera.y, ratio, angle: camera.angle }, CAMERA_ZOOM_MS);
    },

    zoomOut() {
      const camera = renderer?.getCamera();
      if (!camera) {
        return;
      }

      const ratio = camera.getBoundedRatio(camera.ratio * ZOOM_STEP);
      animateCamera({ x: camera.x, y: camera.y, ratio, angle: camera.angle }, CAMERA_ZOOM_MS);
    },

    setHighlightedNode(nodeId: string | null) {
      interaction.selectedNodeId = nodeId ?? focusPath;
      renderer?.refresh();
    },

    centerOnNode(nodeId: string) {
      if (!renderer) {
        return;
      }

      const display = renderer.getNodeDisplayData(nodeId);
      const camera = renderer.getCamera();
      if (!display || !camera) {
        return;
      }

      // Display coords are framed-graph space (autoRescale).
      animateCamera(
        {
          x: display.x,
          y: display.y,
          ratio: camera.ratio,
          angle: camera.angle,
        },
        CAMERA_CENTER_MS,
      );
    },

    centerOnFocus() {
      if (!focusPath || !renderer) {
        return;
      }

      const display = renderer.getNodeDisplayData(focusPath);
      const camera = renderer.getCamera();
      if (!display || !camera) {
        return;
      }

      // Here - pan only; never recompute global framing.
      animateCamera(
        {
          x: display.x,
          y: display.y,
          ratio: camera.ratio,
          angle: 0,
        },
        CAMERA_CENTER_MS,
      );
    },

    dispose() {
      frameGeneration += 1;
      if (hoverLeaveTimer) {
        clearTimeout(hoverLeaveTimer);
        hoverLeaveTimer = null;
      }

      renderer?.kill();
      graph?.clear();
      graph = undefined;
      renderer = undefined;
      latestNodes = [];
      latestEdges = [];
      focusPath = "";
      projectionSignature = null;
      lastViewport = { width: 0, height: 0 };
      themeColorHost = undefined;
    },
  };
}
