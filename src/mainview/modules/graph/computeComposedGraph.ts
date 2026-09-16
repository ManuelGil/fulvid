import { runGraphCore } from "./core/graphCore";
import GraphCoreWorker from "./core/graphCoreWorker?worker";
import { createGraphComputationSession } from "./graphComputationSession";
import type { ComposedGraph, ReferenceGraph } from "./core/graphTypes";

const session = createGraphComputationSession({
  createWorker: () => new GraphCoreWorker(),
  runSync: runGraphCore,
});

/** Layout reference graph nodes/edges off the main thread, with sync fallback. */
export function computeComposedGraph(referenceGraph: ReferenceGraph): Promise<ComposedGraph> {
  return session.compute(referenceGraph);
}

/** Stop the active worker and settle its Promise (unmount / clear Focus). */
export function terminateActiveGraphWorker(): void {
  session.terminate();
}
