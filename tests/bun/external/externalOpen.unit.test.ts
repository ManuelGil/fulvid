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

// Intent: an external request is intent, never privilege. Extra fields cannot
// widen grants; malformed shapes refuse with a controlled code and queue nothing.
describe("external open contract", () => {
  test("accepts only the contract shape, refuses malformed input, and bounds the pending queue", async () => {
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

    parseExternalOpenRequest(
      JSON.parse('{"kind":"file","path":"/a.md","__proto__":{"polluted":true}}'),
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    for (const value of [
      null,
      { kind: "execute", path: "/bin/sh" },
      { kind: "file", path: "" },
      { kind: "file", path: "notes/a.md" },
      { kind: "file", path: "/a\0.md" },
    ]) {
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

    // Absolute acceptance is host-path semantics: Windows drive/UNC on win32,
    // POSIX absolute elsewhere. Drive letters are not absolute on Linux hosts.
    if (process.platform === "win32") {
      expect(
        parseExternalOpenRequest({
          kind: "file",
          path: "C:\\Notes\\a.md",
          source: "shell",
        }).path,
      ).toBe("C:\\Notes\\a.md");
      expect(
        parseExternalOpenRequest({
          kind: "folder",
          path: "\\\\server\\share\\notes",
          source: "shell",
        }).path,
      ).toBe("\\\\server\\share\\notes");
    } else {
      expect(() =>
        parseExternalOpenRequest({
          kind: "file",
          path: "C:\\Notes\\a.md",
          source: "shell",
        }),
      ).toThrow();
    }

    expect(() => enqueueExternalOpenRequest({ kind: "execute", path: "/bin/sh" })).toThrow();
    await expect(takePendingExternalOpens()).resolves.toEqual([]);

    for (let index = 0; index < MAX_PENDING_EXTERNAL_OPENS + 20; index += 1) {
      enqueueExternalOpenRequest({ kind: "file", path: `/a${index}.md`, source: "shell" });
    }
    const drained = await takePendingExternalOpens();
    expect(drained).toHaveLength(MAX_PENDING_EXTERNAL_OPENS);
    await expect(takePendingExternalOpens()).resolves.toEqual([]);

    enqueueExternalOpenRequest({ kind: "file", path: "/once.md", source: "shell" });
    const [first, second] = await Promise.all([
      takePendingExternalOpens(),
      takePendingExternalOpens(),
    ]);
    expect(first.length + second.length).toBe(1);
  });
});
