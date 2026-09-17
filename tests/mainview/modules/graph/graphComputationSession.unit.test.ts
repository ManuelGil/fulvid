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
  test("superseding a silent worker settles the prior Promise without hanging", async () => {
    const workers: Array<ReturnType<typeof silentWorker>> = [];
    const session = createGraphComputationSession({
      createWorker: () => {
        const worker = silentWorker();
        workers.push(worker);
        return worker;
      },
      runSync: syncFallback,
    });

    const first = session.compute(reference("a.md"));
    expect(session.hasActive()).toBe(true);

    const second = session.compute(reference("b.md"));
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

    session.terminate();
    const secondResult = await second;
    expect(secondResult).toEqual(discardedComposedGraph(reference("b.md")));
    expect(session.hasActive()).toBe(false);
    expect(workers[1]?.terminated).toBe(true);
  });

  test("successful worker message settles with composed data", async () => {
    const composed: ComposedGraph = {
      focusPath: "ok.md",
      nodes: [{ id: "ok.md", label: "ok", title: "ok", x: 1, y: 2, depth: 0 }],
      edges: [],
    };
    const session = createGraphComputationSession({
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

    await expect(session.compute(reference("ok.md"))).resolves.toEqual(composed);
    expect(session.hasActive()).toBe(false);
  });

  test("worker error falls back to sync layout", async () => {
    const session = createGraphComputationSession({
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

    await expect(session.compute(reference("err.md"))).resolves.toEqual(
      syncFallback(reference("err.md")),
    );
  });
});
