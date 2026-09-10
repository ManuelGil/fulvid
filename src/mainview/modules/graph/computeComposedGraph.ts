import { runGraphCore } from "./core/graphCore";
import GraphCoreWorker from "./core/graphCoreWorker?worker";
import type { ComposedGraph, ReferenceGraph } from "./core/graphTypes";

let activeWorker: Worker | null = null;

/** Layout reference graph nodes/edges off the main thread, with sync fallback. */
export function computeComposedGraph(referenceGraph: ReferenceGraph): Promise<ComposedGraph> {
  return new Promise((resolve) => {
    activeWorker?.terminate();
    activeWorker = null;

    try {
      const worker = new GraphCoreWorker();
      activeWorker = worker;

      worker.onmessage = (event: MessageEvent<ComposedGraph>) => {
        if (activeWorker === worker) {
          activeWorker = null;
        }
        worker.terminate();
        resolve(event.data);
      };

      worker.onerror = () => {
        if (activeWorker === worker) {
          activeWorker = null;
        }
        worker.terminate();
        resolve(runGraphCore(referenceGraph));
      };

      worker.postMessage(referenceGraph);
    } catch {
      resolve(runGraphCore(referenceGraph));
    }
  });
}

export function terminateActiveGraphWorker(): void {
  activeWorker?.terminate();
  activeWorker = null;
}
