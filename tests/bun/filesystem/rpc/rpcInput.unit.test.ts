import { describe, expect, test } from "bun:test";

import {
  MAX_DOCUMENT_BYTES,
  requireDocumentContent,
  requireString,
} from "../../../../src/bun/filesystem/rpc/rpcInput";
import { filesystemErrorMessage } from "../../../../src/mainview/modules/workspace/filesystem/workspaceErrors.ts";

const INVALID = filesystemErrorMessage("invalidRequest");

// Intent: reject malformed or oversized renderer input before host work.
// Growth boundary: add cases only for new fields, limits, or error codes.
describe("RPC parameter validation", () => {
  test("requires a non-empty string of bounded length", () => {
    expect(requireString({ rootPath: "/folder" }, "rootPath")).toBe("/folder");
    expect(() => requireString({}, "rootPath")).toThrow(INVALID);
    expect(() => requireString({ rootPath: "" }, "rootPath")).toThrow(INVALID);
    expect(() => requireString({ rootPath: 7 }, "rootPath")).toThrow(INVALID);
    expect(() => requireString({ rootPath: ["/a"] }, "rootPath")).toThrow(INVALID);
    expect(() => requireString({ rootPath: "a".repeat(5000) }, "rootPath")).toThrow(INVALID);
    expect(() => requireString({ rootPath: "/a\0/b" }, "rootPath")).toThrow(INVALID);
  });

  test("document content must be a string within the size cap", () => {
    expect(requireDocumentContent({ content: "" })).toBe("");
    expect(() => requireDocumentContent({ content: { toString: 1 } })).toThrow(INVALID);
    expect(() => requireDocumentContent({ content: null })).toThrow(INVALID);
    expect(() => requireDocumentContent({ content: "a".repeat(MAX_DOCUMENT_BYTES + 1) })).toThrow(
      filesystemErrorMessage("documentTooLarge"),
    );
  });
});
