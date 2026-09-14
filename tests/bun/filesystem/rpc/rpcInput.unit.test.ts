import { describe, expect, test } from "bun:test";

import {
  MAX_DOCUMENT_BYTES,
  requireDocumentContent,
  requireString,
} from "../../../../src/bun/filesystem/rpc/rpcInput";
import { filesystemErrorMessage } from "../../../../src/mainview/modules/workspace/filesystem/workspaceErrors.ts";

const INVALID = filesystemErrorMessage("invalidRequest");

// Intent: reject malformed or oversized renderer input before any host I/O.
// Size and null-byte checks are the RPC flood / path-injection boundary.
describe("RPC parameter validation", () => {
  test("rejects empty, oversized, or non-string parameters before host work", () => {
    expect(requireString({ rootPath: "/folder" }, "rootPath")).toBe("/folder");
    expect(() => requireString({ rootPath: "" }, "rootPath")).toThrow(INVALID);
    expect(() => requireString({ rootPath: "a".repeat(5000) }, "rootPath")).toThrow(INVALID);
    expect(() => requireString({ rootPath: "/a\0/b" }, "rootPath")).toThrow(INVALID);

    expect(requireDocumentContent({ content: "" })).toBe("");
    expect(() => requireDocumentContent({ content: null })).toThrow(INVALID);
    expect(() => requireDocumentContent({ content: "a".repeat(MAX_DOCUMENT_BYTES + 1) })).toThrow(
      filesystemErrorMessage("documentTooLarge"),
    );
  });
});
