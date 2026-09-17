import type { ComposedGraph, ReferenceGraph } from "./core/graphTypes";

/** Minimal Worker surface used by Graph layout off the main thread. */
export type GraphWorkerHandle = {
  onmessage: ((event: MessageEvent<ComposedGraph>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: ReferenceGraph): void;
  terminate(): void;
};

type ActiveComputation = {
  worker: GraphWorkerHandle;
  referenceGraph: ReferenceGraph;
  resolve: (value: ComposedGraph) => void;
  settled: boolean;
};

/**
 * Cheap placeholder when a computation is superseded or terminated.
 * Callers discard via layout generation; settling prevents hanging Promises.
 */
export function discardedComposedGraph(referenceGraph: ReferenceGraph): ComposedGraph {
  return {
    focusPath: referenceGraph.focusPath,
    nodes: [],
    edges: [],
  };
}

/**
 * Owns at most one in-flight Graph worker. Terminate/supersede always settles
 * the prior Promise (no hang). Not a Graph store - layout still lives in GraphPage.
 */
export function createGraphComputationSession(options: {
  createWorker: () => GraphWorkerHandle;
  runSync: (graph: ReferenceGraph) => ComposedGraph;
}): {
  compute: (referenceGraph: ReferenceGraph) => Promise<ComposedGraph>;
  terminate: () => void;
  hasActive: () => boolean;
} {
  let active: ActiveComputation | null = null;

  function settleActive(result: ComposedGraph | "discard"): void {
    const current = active;
    if (!current || current.settled) {
      return;
    }
    current.settled = true;
    try {
      current.worker.terminate();
    } catch {
      // Worker may already be dead.
    }
    if (active === current) {
      active = null;
    }
    current.resolve(result === "discard" ? discardedComposedGraph(current.referenceGraph) : result);
  }

  return {
    compute(referenceGraph: ReferenceGraph): Promise<ComposedGraph> {
      return new Promise((resolve) => {
        settleActive("discard");

        try {
          const worker = options.createWorker();
          const computation: ActiveComputation = {
            worker,
            referenceGraph,
            resolve,
            settled: false,
          };
          active = computation;

          worker.onmessage = (event: MessageEvent<ComposedGraph>) => {
            if (active === computation && !computation.settled) {
              settleActive(event.data);
            } else {
              try {
                worker.terminate();
              } catch {
                // ignore
              }
            }
          };

          worker.onerror = () => {
            if (active === computation && !computation.settled) {
              computation.settled = true;
              try {
                worker.terminate();
              } catch {
                // ignore
              }
              if (active === computation) {
                active = null;
              }
              resolve(options.runSync(referenceGraph));
            }
          };

          worker.postMessage(referenceGraph);
        } catch {
          resolve(options.runSync(referenceGraph));
        }
      });
    },
    terminate(): void {
      settleActive("discard");
    },
    hasActive(): boolean {
      return active !== null && !active.settled;
    },
  };
}
