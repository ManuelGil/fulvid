import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertCanonicallyContained,
  canonicalRoot,
  containedPath,
  normalizeWorkspaceRelativePath,
} from "../../../../src/bun/filesystem/security/workspacePaths";
import { filesystemErrorMessage } from "../../../../src/mainview/modules/workspace/filesystem/workspaceErrors.ts";
import { linkDirectory } from "../../../support/platform";

const OUTSIDE = filesystemErrorMessage("outsideFolder");
const INVALID = filesystemErrorMessage("invalidTarget");

async function makeWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "fulvid-paths-"));
}

// Intent: folder containment is the single privileged path authority for RPC.
// Both separators are accepted; traversal, absolute, and drive-letter forms are
// refused rather than "fixed". Symlinks that leave the folder fail canonically.
describe("folder path containment", () => {
  test("accepts either separator and refuses traversal, absolutes, and controls", async () => {
    const root = await makeWorkspace();
    try {
      // Documents and Explorer speak POSIX; Windows hosts may supply `\`.
      expect(normalizeWorkspaceRelativePath("notes\\file.md")).toBe("notes/file.md");
      expect(containedPath(root, "notes/file.md")).toBe(join(root, "notes/file.md"));
      expect(containedPath(root, "notes\\nested\\file.md")).toBe(
        join(root, "notes", "nested", "file.md"),
      );
      expect(containedPath(root, "")).toBe(root);

      // Lexical escapes must fail before any host I/O.
      expect(() => containedPath(root, "../../../etc/passwd.md")).toThrow(OUTSIDE);
      expect(() => containedPath(root, "..\\..\\outside.md")).toThrow(OUTSIDE);
      expect(() => containedPath(root, "notes/../secret.md")).toThrow(OUTSIDE);
      expect(() => containedPath(root, "/etc/passwd.md")).toThrow(OUTSIDE);
      expect(() => containedPath(root, "C:\\Windows\\note.md")).toThrow(OUTSIDE);
      expect(() => containedPath(root, "c:/Windows/note.md")).toThrow(OUTSIDE);
      expect(() => containedPath(root, "notes/\0x.md")).toThrow(INVALID);
      expect(() => containedPath(root, "notes/\n.md")).toThrow(INVALID);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("refuses a target reached through a symlinked directory", async () => {
    const base = await makeWorkspace();
    const root = join(base, "folder");
    const outside = join(base, "outside");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(join(outside, "secret.md"), "secret\n");
    // Junctions on Windows, directory symlinks elsewhere — same escape property.
    await linkDirectory(outside, join(root, "link"));

    try {
      // Lexically under the root; canonically outside — must refuse.
      expect(containedPath(root, "link/secret.md")).toBe(join(root, "link/secret.md"));
      await expect(assertCanonicallyContained(root, "link/secret.md")).rejects.toThrow(OUTSIDE);
      await expect(assertCanonicallyContained(root, "link")).rejects.toThrow(OUTSIDE);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  test("allows in-folder symlinks and missing create targets", async () => {
    const root = await makeWorkspace();
    await mkdir(join(root, "notes"));
    await writeFile(join(root, "notes/real.md"), "real\n");
    await linkDirectory(join(root, "notes"), join(root, "alias"));

    try {
      await expect(assertCanonicallyContained(root, "alias/real.md")).resolves.toBe(
        join(await canonicalRoot(root), "notes/real.md"),
      );
      // Create/rename destinations do not exist yet and must still stay inside.
      await expect(assertCanonicallyContained(root, "new/deep/note.md")).resolves.toBe(
        join(await canonicalRoot(root), "new/deep/note.md"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
