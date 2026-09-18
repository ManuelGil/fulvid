import { describe, expect, test } from "bun:test";

import {
  createGraphComputationSession,
  discardedComposedGraph,
  type GraphWorkerHandle,
} from "../../../../src/mainview/modules/graph/graphComputationSession.ts";
import type {
  ComposedGraph,
  ReferenceGraph,
} from "../../../../src/mainview/modules/graph/core/graphTypes.ts";

function reference(focusPath: string): ReferenceGraph {
  return {
    focusPath,
    nodes: [{ id: focusPath, label: focusPath, title: focusPath }],
    edges: [],
  };
}

function silentWorker(): GraphWorkerHandle & { terminated: boolean } {
  const handle: GraphWorkerHandle & { terminated: boolean } = {
    onmessage: null,
    onerror: null,
    terminated: false,
    postMessage() {
      // Never delivers - models a hung/terminated worker.
    },
    terminate() {
      this.terminated = true;
    },
  };
  return handle;
}

function syncFallback(graph: ReferenceGraph): ComposedGraph {
  return {
    focusPath: graph.focusPath,
    nodes: [
      {
        id: graph.focusPath,
        label: "sync",
        title: graph.focusPath,
        x: 0,
        y: 0,
        depth: 0,
      },
    ],
    edges: [],
  };
}

// Intent: terminate/supersede must settle Promises so GraphPage cannot hang
// with isDeriving stuck after worker.terminate().
describe("graph computation session", () => {
  test("compute settles on success, error fallback, supersede, and terminate", async () => {
    const composed: ComposedGraph = {
      focusPath: "ok.md",
      nodes: [{ id: "ok.md", label: "ok", title: "ok", x: 1, y: 2, depth: 0 }],
      edges: [],
    };
    const successSession = createGraphComputationSession({
      createWorker: () => {
        const handle: GraphWorkerHandle = {
          onmessage: null,
          onerror: null,
          postMessage() {
            queueMicrotask(() => {
              handle.onmessage?.({ data: composed } as MessageEvent<ComposedGraph>);
            });
          },
          terminate() {},
        };
        return handle;
      },
      runSync: syncFallback,
    });
    await expect(successSession.compute(reference("ok.md"))).resolves.toEqual(composed);
    expect(successSession.hasActive()).toBe(false);

    const errorSession = createGraphComputationSession({
      createWorker: () => {
        const handle: GraphWorkerHandle = {
          onmessage: null,
          onerror: null,
          postMessage() {
            queueMicrotask(() => {
              handle.onerror?.({} as ErrorEvent);
            });
          },
          terminate() {},
        };
        return handle;
      },
      runSync: syncFallback,
    });
    await expect(errorSession.compute(reference("err.md"))).resolves.toEqual(
      syncFallback(reference("err.md")),
    );

    const workers: Array<ReturnType<typeof silentWorker>> = [];
    const supersedeSession = createGraphComputationSession({
      createWorker: () => {
        const worker = silentWorker();
        workers.push(worker);
        return worker;
      },
      runSync: syncFallback,
    });

    const first = supersedeSession.compute(reference("a.md"));
    expect(supersedeSession.hasActive()).toBe(true);

    const second = supersedeSession.compute(reference("b.md"));
    // First worker was terminated when superseded.
    expect(workers[0]?.terminated).toBe(true);

    const firstResult = await first;
    // Discarded composition stays empty while preserving focusPath.
    expect(firstResult).toEqual({
      focusPath: "a.md",
      nodes: [],
      edges: [],
    });
    expect(firstResult).toEqual(discardedComposedGraph(reference("a.md")));

    supersedeSession.terminate();
    const secondResult = await second;
    expect(secondResult).toEqual(discardedComposedGraph(reference("b.md")));
    expect(supersedeSession.hasActive()).toBe(false);
    expect(workers[1]?.terminated).toBe(true);
  });
});
