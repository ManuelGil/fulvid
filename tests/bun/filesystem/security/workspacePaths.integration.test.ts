import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertCanonicallyContained,
  canonicalRoot,
  containedPath,
} from "../../../../src/bun/filesystem/security/workspacePaths";
import { filesystemErrorMessage } from "../../../../src/mainview/modules/workspace/filesystem/workspaceErrors.ts";

const OUTSIDE = filesystemErrorMessage("outsideFolder");

async function makeWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "fulvid-paths-"));
}

// Intent: own lexical and canonical containment, including safe symlinks and missing targets.
// Growth boundary: add cases only for new path forms or boundary policy.
describe("lexical containment", () => {
  test("resolves inside the root and refuses anything above it", async () => {
    const root = await makeWorkspace();
    try {
      expect(containedPath(root, "notes/file.md")).toBe(join(root, "notes/file.md"));
      expect(containedPath(root, "")).toBe(root);
      expect(() => containedPath(root, "../../../src/bun/file.md")).toThrow(OUTSIDE);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("canonical containment", () => {
  test("refuses a target reached through a symlinked directory", async () => {
    const base = await makeWorkspace();
    const root = join(base, "folder");
    const outside = join(base, "outside");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(join(outside, "secret.md"), "secret\n");
    await symlink(outside, join(root, "link"));

    try {
      // Lexically this stays under the root; canonically it does not.
      expect(containedPath(root, "link/secret.md")).toBe(join(root, "link/secret.md"));
      await expect(assertCanonicallyContained(root, "link/secret.md")).rejects.toThrow(OUTSIDE);
      await expect(assertCanonicallyContained(root, "link")).rejects.toThrow(OUTSIDE);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  test("allows a symlink that stays inside the folder", async () => {
    const root = await makeWorkspace();
    await mkdir(join(root, "notes"));
    await writeFile(join(root, "notes/real.md"), "real\n");
    await symlink(join(root, "notes"), join(root, "alias"));

    try {
      await expect(assertCanonicallyContained(root, "alias/real.md")).resolves.toBe(
        join(await canonicalRoot(root), "notes/real.md"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("allows a target that does not exist yet", async () => {
    const root = await makeWorkspace();
    try {
      await expect(assertCanonicallyContained(root, "new/deep/note.md")).resolves.toBe(
        join(await canonicalRoot(root), "new/deep/note.md"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
