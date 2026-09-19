/** Graph-local representation parameters, separate from shell or Focus state. */
export type GraphViewState = {
  depth: number;
};

/** Allowed Projection depth values - Graph-local only. */
export const GRAPH_DEPTH_STEPS = [1, 2, 3, 4, 5] as const;

export const DEFAULT_GRAPH_VIEW_STATE: GraphViewState = { depth: 2 };

export function clampGraphDepth(depth: number): number {
  return GRAPH_DEPTH_STEPS.reduce((best, step) =>
    Math.abs(step - depth) < Math.abs(best - depth) ? step : best,
  );
}
