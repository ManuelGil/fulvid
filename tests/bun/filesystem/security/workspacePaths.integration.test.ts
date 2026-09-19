import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertCanonicallyContained,
  canonicalRoot,
  containedPath,
  isUnsafePathSegment,
  normalizeWorkspaceRelativePath,
  workspaceRelativeSegments,
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
  test("accepts either separator and refuses traversal, absolutes, drive forms, and controls", async () => {
    const root = await makeWorkspace();
    try {
      expect(normalizeWorkspaceRelativePath("notes\\file.md")).toBe("notes/file.md");
      expect(containedPath(root, "notes/file.md")).toBe(join(root, "notes/file.md"));
      expect(containedPath(root, "notes\\nested\\file.md")).toBe(
        join(root, "notes", "nested", "file.md"),
      );
      expect(containedPath(root, "")).toBe(root);

      expect(() => containedPath(root, "../../../etc/passwd.md")).toThrow(OUTSIDE);
      expect(() => containedPath(root, "..\\..\\outside.md")).toThrow(OUTSIDE);
      expect(() => containedPath(root, "notes/../secret.md")).toThrow(OUTSIDE);
      expect(() => containedPath(root, "/etc/passwd.md")).toThrow(OUTSIDE);
      expect(() => containedPath(root, "C:\\Windows\\note.md")).toThrow(OUTSIDE);
      expect(() => containedPath(root, "c:/Windows/note.md")).toThrow(OUTSIDE);
      // Drive-relative forms (no slash) are not POSIX-absolute; still refused.
      expect(() => containedPath(root, "C:foo")).toThrow(OUTSIDE);
      expect(() => containedPath(root, "C:note.md")).toThrow(OUTSIDE);
      // UNC / host-share forms must not be treated as folder-relative targets.
      expect(() => containedPath(root, "\\\\server\\share\\file.md")).toThrow(OUTSIDE);
      expect(() => containedPath(root, "//server/share/file.md")).toThrow(OUTSIDE);
      expect(() => containedPath(root, "notes/\0x.md")).toThrow(INVALID);
      expect(() => containedPath(root, "notes/\n.md")).toThrow(INVALID);
      expect(() => containedPath(root, `${"a".repeat(256)}.md`)).toThrow(INVALID);
      expect(() =>
        containedPath(root, Array.from({ length: 33 }, (_, i) => `d${i}`).join("/") + ".md"),
      ).toThrow(INVALID);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("canonical containment refuses escape links and allows in-folder links and missing creates", async () => {
    const base = await makeWorkspace();
    const root = join(base, "folder");
    const outside = join(base, "outside");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(join(outside, "secret.md"), "secret\n");
    // Junctions on Windows, directory symlinks elsewhere - same escape property.
    await linkDirectory(outside, join(root, "link"));

    try {
      expect(containedPath(root, "link/secret.md")).toBe(join(root, "link/secret.md"));
      await expect(assertCanonicallyContained(root, "link/secret.md")).rejects.toThrow(OUTSIDE);
      await expect(assertCanonicallyContained(root, "link")).rejects.toThrow(OUTSIDE);

      await mkdir(join(root, "notes"));
      await writeFile(join(root, "notes/real.md"), "real\n");
      await linkDirectory(join(root, "notes"), join(root, "alias"));
      await expect(assertCanonicallyContained(root, "alias/real.md")).resolves.toBe(
        join(await canonicalRoot(root), "notes/real.md"),
      );
      await expect(assertCanonicallyContained(root, "new/deep/note.md")).resolves.toBe(
        join(await canonicalRoot(root), "new/deep/note.md"),
      );
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

// Intent: a Windows device name is the text before the first dot, so every
// multi-suffix form of it is refused too.
// Growth boundary: add a case only for a new reserved-name shape.
describe("reserved device names across suffixes", () => {
  test("refuses a reserved stem regardless of how many suffixes follow", () => {
    // Stem-before-first-dot: simple reserved + one multi-suffix form.
    for (const segment of ["CON.md", "CON.tar.md"]) {
      expect(isUnsafePathSegment(segment)).toBe(true);
      expect(() => workspaceRelativeSegments(`notes/${segment}`)).toThrow("fulvid.fs:unsafeName");
    }

    // Reserved word not as leading stem, and lookalike stems, are fine.
    for (const segment of ["notes.con.md", ".con.md", "console.md"]) {
      expect(isUnsafePathSegment(segment)).toBe(false);
    }
  });
});
