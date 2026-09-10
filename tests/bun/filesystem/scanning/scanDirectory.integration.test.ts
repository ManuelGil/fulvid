import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import {
  listWorkspaceEntries,
  MAX_SCANNED_DOCUMENTS,
  scanWorkspace,
} from "../../../../src/bun/filesystem/scanning/scanDirectory";
import { filesystemErrorMessage } from "../../../../src/mainview/modules/workspace/filesystem/workspaceErrors.ts";

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
    await symlink(outside, join(root, "link"));

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
 * Windows does not treat chmod(000) as POSIX denial, so the always-on cases
 * inject the same skippable errno at the existing walk/analysis catch. chmod
 * stays as extra coverage only where the kernel enforces Unix mode bits.
 */
function permissionDenied(syscall: string, target: string): NodeJS.ErrnoException {
  const error = new Error(
    `EACCES: permission denied, ${syscall} '${target}'`,
  ) as NodeJS.ErrnoException;
  error.code = "EACCES";
  return error;
}

const posixModeBitsDenyAccess = process.platform !== "win32";

describe("scanning a hostile or live folder", () => {
  test("an unreadable subdirectory is skipped, not fatal", async () => {
    const root = await makeWorkspace();
    const denied = resolve(join(root, "denied"));

    try {
      await writeFile(join(root, "readable.md"), "# Readable\n");
      await mkdir(denied);
      await writeFile(join(denied, "hidden.md"), "# Hidden\n");

      const scan = await scanWorkspace(
        root,
        { linkMode: "markdown" },
        {
          beforeReadDirectory: (directory) => {
            if (resolve(directory) === denied) {
              throw permissionDenied("scandir", directory);
            }
          },
        },
      );

      expect(scan.scannedNotes.map((note) => note.path)).toEqual(["readable.md"]);
      // Skipping is reported, so a partial folder is never silent.
      expect(scan.skipped).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test.skipIf(!posixModeBitsDenyAccess)(
    "an unreadable subdirectory is skipped, not fatal (POSIX mode bits)",
    async () => {
      const root = await makeWorkspace();
      const denied = join(root, "denied");

      try {
        await writeFile(join(root, "readable.md"), "# Readable\n");
        await mkdir(denied);
        await writeFile(join(denied, "hidden.md"), "# Hidden\n");
        // Extra real-FS check: Unix mode bits deny readdir. Windows ignores this.
        await chmod(denied, 0o000);

        const scan = await scanWorkspace(root, { linkMode: "markdown" });

        expect(scan.scannedNotes.map((note) => note.path)).toEqual(["readable.md"]);
        expect(scan.skipped).toBeGreaterThan(0);
      } finally {
        await chmod(denied, 0o755).catch(() => {});
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  test("a document that becomes unreadable mid-scan is skipped, not fatal", async () => {
    const root = await makeWorkspace();
    const locked = resolve(join(root, "locked.md"));

    try {
      await writeFile(join(root, "readable.md"), "# Readable\n");
      await writeFile(locked, "# Locked\n");

      const scan = await scanWorkspace(
        root,
        { linkMode: "markdown" },
        {
          beforeAnalyzeFile: async (filePath) => {
            if (resolve(filePath) === locked) {
              // Listed by the walk, then gone before analysis — the F-03 condition.
              await unlink(locked);
            }
          },
        },
      );

      expect(scan.scannedNotes.map((note) => note.path)).toEqual(["readable.md"]);
      expect(scan.skipped).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test.skipIf(!posixModeBitsDenyAccess)(
    "a document that becomes unreadable mid-scan is skipped, not fatal (POSIX mode bits)",
    async () => {
      const root = await makeWorkspace();

      try {
        await writeFile(join(root, "readable.md"), "# Readable\n");
        await writeFile(join(root, "locked.md"), "# Locked\n");
        // Extra real-FS check: Unix mode bits deny analysis. Windows ignores this.
        await chmod(join(root, "locked.md"), 0o000);

        const scan = await scanWorkspace(root, { linkMode: "markdown" });

        expect(scan.scannedNotes.map((note) => note.path)).toEqual(["readable.md"]);
        expect(scan.skipped).toBe(1);
      } finally {
        await chmod(join(root, "locked.md"), 0o644).catch(() => {});
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  test("documents removed while the folder is scanned never fail the scan", async () => {
    const root = await makeWorkspace();

    try {
      for (let index = 0; index < 60; index += 1) {
        await writeFile(join(root, `note-${index}.md`), "# Note\n");
      }

      const scanning = scanWorkspace(root, { linkMode: "markdown" });
      for (let index = 0; index < 60; index += 2) {
        void unlink(join(root, `note-${index}.md`)).catch(() => {});
      }
      const scan = await scanning;

      // Deletions racing the walk mean the totals are not fixed; what is
      // guaranteed is that the scan returns a usable folder instead of throwing.
      expect(scan.scannedNotes.length).toBeGreaterThan(0);
      expect(scan.scannedNotes.length + scan.skipped).toBeLessThanOrEqual(60);
      for (const note of scan.scannedNotes) {
        expect(note.path).toMatch(/^note-\d+\.md$/);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a healthy folder reports nothing skipped", async () => {
    const root = await makeWorkspace();

    try {
      await writeFile(join(root, "a.md"), "# A\n");
      await mkdir(join(root, "sub"));
      await writeFile(join(root, "sub", "b.md"), "# B\n");

      const scan = await scanWorkspace(root, { linkMode: "markdown" });

      expect(scan.scannedNotes).toHaveLength(2);
      expect(scan.skipped).toBe(0);
      expect(scan.truncated).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
