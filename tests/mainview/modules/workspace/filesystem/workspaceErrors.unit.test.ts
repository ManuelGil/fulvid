import { describe, expect, test } from "bun:test";

import {
  FILESYSTEM_ERROR_CODES,
  filesystemErrorMessage,
  parseFilesystemErrorCode,
} from "../../../../../src/mainview/modules/workspace/filesystem/workspaceErrors.ts";

// Intent: host error codes must round-trip so the renderer never sees raw errno.
// Growth boundary: add cases only for a new filesystem error code.
describe("filesystem error vocabulary", () => {
  test("every code round-trips through the wire form", () => {
    for (const code of FILESYSTEM_ERROR_CODES) {
      const error = new Error(filesystemErrorMessage(code));
      expect(parseFilesystemErrorCode(error)).toBe(code);
      expect(parseFilesystemErrorCode(error.message)).toBe(code);
    }
  });
});
