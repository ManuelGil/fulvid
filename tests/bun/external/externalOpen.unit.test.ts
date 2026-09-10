import { afterEach, describe, expect, test } from "bun:test";

import {
  enqueueExternalOpenRequest,
  parseExternalOpenRequest,
  resetPendingExternalOpens,
  takePendingExternalOpens,
} from "../../../src/bun/external/externalOpen";
import { MAX_PENDING_EXTERNAL_OPENS } from "../../../src/mainview/desktop/externalOpen";
import { parseFilesystemErrorCode } from "../../../src/mainview/modules/workspace/filesystem/workspaceErrors.ts";

afterEach(() => {
  resetPendingExternalOpens();
});

// Intent: an external request is intent, never privilege - shape is checked
// before any host work, and nothing outside the contract survives parsing.
// Growth boundary: add cases only for new contract fields or refusal codes.
describe("external open contract", () => {
  test("accepts a well-formed request and drops everything outside the contract", () => {
    expect(
      parseExternalOpenRequest({ kind: "file", path: "/notes/a.md", source: "shell" }),
    ).toEqual({ kind: "file", path: "/notes/a.md", source: "shell" });
    expect(
      parseExternalOpenRequest({ kind: "folder", path: "/notes", source: "os-context-menu" }),
    ).toEqual({ kind: "folder", path: "/notes", source: "os-context-menu" });

    const parsed = parseExternalOpenRequest({
      kind: "file",
      path: "/notes/a.md",
      source: "shell",
      command: "rm -rf /",
      trusted: true,
      capabilities: ["filesystem"],
      grantToken: "00000000-0000-0000-0000-000000000000",
      rootPath: "/",
    });
    expect(Object.keys(parsed).sort()).toEqual(["kind", "path", "source"]);

    // The source is descriptive. A new adapter naming itself must not fail an
    // otherwise valid request, nor widen what it may do.
    expect(parseExternalOpenRequest({ kind: "file", path: "/a.md" }).source).toBe("unknown");
    expect(parseExternalOpenRequest({ kind: "file", path: "/a.md", source: "root" }).source).toBe(
      "unknown",
    );
  });

  test("refuses malformed requests with a controlled code, never a raw throw", () => {
    const malformed: unknown[] = [
      null,
      {},
      { kind: "execute", path: "/bin/sh" },
      { kind: "file", path: "" },
      { kind: "file", path: 42 },
      { kind: "file", path: "/a\0.md" },
      { kind: "file", path: "/a\nb.md" },
      { kind: "file", path: `/${"a".repeat(9000)}.md` },
      // A relative path has no agreed base across a process boundary.
      { kind: "file", path: "notes/a.md" },
      { kind: "file", path: "../a.md" },
    ];

    for (const value of malformed) {
      let thrown: unknown;
      expect(() => {
        try {
          parseExternalOpenRequest(value);
        } catch (error) {
          thrown = error;
          throw error;
        }
      }).toThrow();
      expect(parseFilesystemErrorCode(thrown)).not.toBeNull();
    }
  });

  test("a __proto__ payload does not pollute", () => {
    parseExternalOpenRequest(
      JSON.parse('{"kind":"file","path":"/a.md","__proto__":{"polluted":true}}'),
    );

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("a refused request queues nothing", async () => {
    expect(() => enqueueExternalOpenRequest({ kind: "execute", path: "/bin/sh" })).toThrow();

    await expect(takePendingExternalOpens()).resolves.toEqual([]);
  });

  test("the queue is bounded and drains once", async () => {
    for (let index = 0; index < MAX_PENDING_EXTERNAL_OPENS + 20; index += 1) {
      enqueueExternalOpenRequest({ kind: "file", path: `/a${index}.md`, source: "shell" });
    }

    const drained = await takePendingExternalOpens();
    expect(drained).toHaveLength(MAX_PENDING_EXTERNAL_OPENS);
    await expect(takePendingExternalOpens()).resolves.toEqual([]);
  });
});
