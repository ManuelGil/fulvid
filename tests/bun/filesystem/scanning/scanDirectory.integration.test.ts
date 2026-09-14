import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import {
  listWorkspaceEntries,
  MAX_SCANNED_DOCUMENTS,
  scanWorkspace,
} from "../../../../src/bun/filesystem/scanning/scanDirectory";
import { filesystemErrorMessage } from "../../../../src/mainview/modules/workspace/filesystem/workspaceErrors.ts";
import { linkDirectory } from "../../../support/platform";

async function makeWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "fulvid-explorer-"));
}

// Intent: protect Explorer filtering, deterministic order, symlink containment, and bounded scans.
// Growth boundary: add cases only for changed listing policy or limits.
describe("filesystem Explorer listing", () => {
  test("lists supported files and folders in deterministic order", async () => {
    const root = await makeWorkspace();

    try {
      await mkdir(join(root, "zeta"));
      await mkdir(join(root, "Alpha"));
      await writeFile(join(root, "readme.MD"), "# Read me\n");
      await writeFile(join(root, "component.mdx"), "# Component\n");
      await writeFile(join(root, "ignore.txt"), "not a document\n");
      await writeFile(join(root, ".hidden.md"), "# Hidden\n");
      await mkdir(join(root, ".git"));

      await expect(listWorkspaceEntries(root)).resolves.toEqual([
        expect.objectContaining({ kind: "directory", name: "Alpha", path: "Alpha" }),
        expect.objectContaining({ kind: "directory", name: "zeta", path: "zeta" }),
        expect.objectContaining({ kind: "file", name: "component.mdx", path: "component.mdx" }),
        expect.objectContaining({ kind: "file", name: "readme.MD", path: "readme.MD" }),
      ]);
      await expect(listWorkspaceEntries(root, "", { includeHidden: true })).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ name: ".hidden.md", hidden: true })]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("folder containment for listing", () => {
  test("does not list through a symlinked directory", async () => {
    const base = await mkdtemp(join(tmpdir(), "fulvid-explorer-link-"));
    const root = join(base, "folder");
    const outside = join(base, "outside");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(join(outside, "secret.md"), "secret\n");
    await linkDirectory(outside, join(root, "link"));

    try {
      // The link is not offered as an entry...
      await expect(listWorkspaceEntries(root)).resolves.toEqual([]);
      // ...and asking for it directly is refused rather than followed.
      await expect(listWorkspaceEntries(root, "link")).rejects.toThrow(
        filesystemErrorMessage("outsideFolder"),
      );
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

describe("scan limits", () => {
  test("a scan stops at its ceiling and says it was partial", async () => {
    const root = await makeWorkspace();
    try {
      await Promise.all(
        Array.from({ length: MAX_SCANNED_DOCUMENTS + 25 }, (_, index) =>
          writeFile(join(root, `note-${index}.md`), "# note\n"),
        ),
      );

      const scan = await scanWorkspace(root);
      expect(scan.truncated).toBe(true);
      expect(scan.scannedNotes.length).toBe(MAX_SCANNED_DOCUMENTS);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});

/**
 * A folder is a live filesystem. A subtree can be unreadable and a file can be
 * removed by a sync client or a checkout between listing and analysis. Either
 * used to throw out of the scan, so one bad entry cost the person the whole
 * folder. These hold the partial-but-usable behaviour, and its reporting.
 *
 * The property is multiplatform. The way an access error is provoked is not:
 * Windows does not treat chmod(000) as POSIX denial, so these cases inject the
 * same skippable errno at the existing walk/analysis catch.
 */
function permissionDenied(syscall: string, target: string): NodeJS.ErrnoException {
  const error = new Error(
    `EACCES: permission denied, ${syscall} '${target}'`,
  ) as NodeJS.ErrnoException;
  error.code = "EACCES";
  return error;
}

describe("scanning a hostile or live folder", () => {
  test("skips hostile entries without failing, and keeps empty vs skipped-only scans distinct", async () => {
    const deniedRoot = await makeWorkspace();
    const denied = resolve(join(deniedRoot, "denied"));
    try {
      await writeFile(join(deniedRoot, "readable.md"), "# Readable\n");
      await mkdir(denied);
      await writeFile(join(denied, "hidden.md"), "# Hidden\n");

      const deniedScan = await scanWorkspace(
        deniedRoot,
        { linkMode: "markdown" },
        {
          beforeReadDirectory: (directory) => {
            if (resolve(directory) === denied) {
              throw permissionDenied("scandir", directory);
            }
          },
        },
      );
      expect(deniedScan.scannedNotes.map((note) => note.path)).toEqual(["readable.md"]);
      expect(deniedScan.skipped).toBeGreaterThan(0);
      expect(deniedScan.truncated).toBe(false);
    } finally {
      await rm(deniedRoot, { recursive: true, force: true });
    }

    const midRoot = await makeWorkspace();
    const locked = resolve(join(midRoot, "locked.md"));
    try {
      await writeFile(join(midRoot, "readable.md"), "# Readable\n");
      await writeFile(locked, "# Locked\n");
      const midScan = await scanWorkspace(
        midRoot,
        { linkMode: "markdown" },
        {
          beforeAnalyzeFile: async (filePath) => {
            if (resolve(filePath) === locked) {
              await unlink(locked);
            }
          },
        },
      );
      expect(midScan.scannedNotes.map((note) => note.path)).toEqual(["readable.md"]);
      expect(midScan.skipped).toBeGreaterThan(0);
    } finally {
      await rm(midRoot, { recursive: true, force: true });
    }

    // Empty-of-documents (skipped=0) must not look like a skipped-only folder.
    const emptyRoot = await makeWorkspace();
    try {
      await writeFile(join(emptyRoot, "readme.txt"), "not a document\n");
      const empty = await scanWorkspace(emptyRoot, { linkMode: "markdown" });
      expect(empty.scannedNotes).toEqual([]);
      expect(empty.skipped).toBe(0);
      expect(empty.truncated).toBe(false);
    } finally {
      await rm(emptyRoot, { recursive: true, force: true });
    }

    const skippedOnlyRoot = await makeWorkspace();
    const skippedDenied = resolve(join(skippedOnlyRoot, "denied"));
    try {
      await mkdir(skippedDenied);
      await writeFile(join(skippedDenied, "hidden.md"), "# Hidden\n");
      const skippedOnly = await scanWorkspace(
        skippedOnlyRoot,
        { linkMode: "markdown" },
        {
          beforeReadDirectory: (directory) => {
            if (resolve(directory) === skippedDenied) {
              throw permissionDenied("scandir", directory);
            }
          },
        },
      );
      expect(skippedOnly.scannedNotes).toEqual([]);
      expect(skippedOnly.skipped).toBeGreaterThan(0);
      expect(skippedOnly.truncated).toBe(false);
    } finally {
      await rm(skippedOnlyRoot, { recursive: true, force: true });
    }
  });
});
