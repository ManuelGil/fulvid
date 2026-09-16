import { describe, expect, test } from "bun:test";

import {
  MAX_DOCUMENT_BYTES,
  requireDocumentContent,
  requireGrantToken,
  requireMtime,
  requireString,
} from "../../../../src/bun/filesystem/rpc/rpcInput";
import { filesystemErrorMessage } from "../../../../src/mainview/modules/workspace/filesystem/workspaceErrors.ts";

const INVALID = filesystemErrorMessage("invalidRequest");
const GRANT_INVALID = filesystemErrorMessage("grantInvalid");

// Intent: reject malformed or oversized renderer input before any host I/O.
// Size and null-byte checks are the RPC flood / path-injection boundary.
describe("RPC parameter validation", () => {
  test("rejects empty, oversized, or non-string parameters before host work", () => {
    expect(requireString({ rootPath: "/folder" }, "rootPath")).toBe("/folder");
    expect(() => requireString({ rootPath: "" }, "rootPath")).toThrow(INVALID);
    expect(() => requireString({ rootPath: "a".repeat(5000) }, "rootPath")).toThrow(INVALID);
    expect(() => requireString({ rootPath: "/a\0/b" }, "rootPath")).toThrow(INVALID);
    expect(() => requireString(null, "rootPath")).toThrow(INVALID);

    expect(requireDocumentContent({ content: "" })).toBe("");
    expect(() => requireDocumentContent({ content: null })).toThrow(INVALID);
    expect(() => requireDocumentContent({ content: "a".repeat(MAX_DOCUMENT_BYTES + 1) })).toThrow(
      filesystemErrorMessage("documentTooLarge"),
    );

    expect(requireMtime({ expectedMtimeMs: 1 })).toBe(1);
    expect(() => requireMtime({ expectedMtimeMs: -1 })).toThrow(INVALID);
    expect(() => requireMtime({ expectedMtimeMs: Number.NaN })).toThrow(INVALID);
    expect(() => requireMtime({})).toThrow(INVALID);

    const token = "01234567-89ab-cdef-0123-456789abcdef";
    expect(requireGrantToken({ grantToken: token })).toBe(token);
    expect(() => requireGrantToken({ grantToken: "not-a-uuid" })).toThrow(GRANT_INVALID);
    expect(() => requireGrantToken({ grantToken: "" })).toThrow(INVALID);
  });
});
