/**
 * Graph Composition - transforms layout geometry into contextual spatial organization.
 */
import type { ReferenceGraphEdge } from "./graphTypes";
import type { LayoutPosition } from "./graphLayout";

const FOCUS_CLEARANCE = 120;
const NEIGHBOR_RADIUS = 168;
const SECONDARY_RADIUS = 310;
const NEIGHBOR_FAN = 1.15;
const SECONDARY_FAN = 1.45;

function buildDegreeMap(edges: ReferenceGraphEdge[]): Map<string, number> {
  const degrees = new Map<string, number>();

  for (const edge of edges) {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
  }

  return degrees;
}

function visibleLabelFromPath(filePath: string): string {
  const segments = filePath.split(/[/\\]/);
  const basename = segments[segments.length - 1] ?? filePath;
  const extensionIndex = basename.lastIndexOf(".");

  if (extensionIndex <= 0) {
    return basename;
  }

  return basename.slice(0, extensionIndex);
}

/** Places nodes into focus-centered regions from Dagre side and order signals. */
export function composeGraphRegions(
  positions: Map<string, LayoutPosition>,
  depthMap: Map<string, number>,
  focusId: string,
  edges: ReferenceGraphEdge[],
): Map<string, LayoutPosition> {
  const focus = positions.get(focusId);

  if (!focus) {
    return positions;
  }

  const degreeById = buildDegreeMap(edges);

  type RegionEntry = {
    id: string;
    side: -1 | 1;
    region: 1 | 2;
    sortY: number;
    degree: number;
  };

  const entries: RegionEntry[] = [];

  for (const [id, position] of positions) {
    if (id === focusId) {
      continue;
    }

    const depth = depthMap.get(id) ?? 2;

    entries.push({
      id,
      side: position.x < focus.x ? -1 : 1,
      region: depth <= 1 ? 1 : 2,
      sortY: position.y,
      degree: degreeById.get(id) ?? 0,
    });
  }

  const result = new Map<string, LayoutPosition>();
  result.set(focusId, { x: 0, y: 0 });

  const groups = new Map<string, RegionEntry[]>();

  for (const entry of entries) {
    const key = `${entry.side}:${entry.region}`;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    group.sort((left, right) => left.sortY - right.sortY || left.id.localeCompare(right.id));

    const side = group[0].side;
    const region = group[0].region;
    const baseRadius = region === 1 ? NEIGHBOR_RADIUS : SECONDARY_RADIUS;
    const fan = region === 1 ? NEIGHBOR_FAN : SECONDARY_FAN;
    const baseAngle = side < 0 ? Math.PI : 0;
    const count = group.length;

    group.forEach((entry, index) => {
      const slot = count === 1 ? 0.5 : index / (count - 1);
      const angle = baseAngle + (slot - 0.5) * fan;

      const stagger = (index % 2 === 0 ? -1 : 1) * (region === 1 ? 14 : 22);
      const degreePush = Math.min(entry.degree, 5) * (region === 1 ? 6 : 9);
      const radius = Math.max(
        FOCUS_CLEARANCE + (region === 1 ? 0 : 90),
        baseRadius + stagger + degreePush,
      );

      result.set(entry.id, {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      });
    });
  }

  return result;
}

export function nodeLabel(
  graph: { focusPath: string; nodes: Array<{ id: string; title: string }> },
  nodeId: string,
): string {
  const node = graph.nodes.find((entry) => entry.id === nodeId);
  const isFocus = nodeId === graph.focusPath;

  if (isFocus) {
    return node?.title?.trim() || visibleLabelFromPath(nodeId);
  }

  return visibleLabelFromPath(nodeId);
}
