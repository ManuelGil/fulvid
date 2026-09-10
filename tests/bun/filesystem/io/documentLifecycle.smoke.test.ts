/**
 * The loop Fulvid has to keep working, exercised against the real boundary:
 *
 *   Open -> Read/Edit -> Save -> Navigate -> Continue editing
 *
 * Nothing here is mocked. A real temporary folder, the real approval store, the
 * real containment rules and the real document I/O, so a regression in any of
 * them shows up as this loop breaking rather than as a passing unit test.
 *
 * Growth boundary: keep one representative real lifecycle; add a case only
 * for a new lifecycle state or invariant, not another round or document pair.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createDocument,
  readDocument,
  writeDocument,
} from "../../../../src/bun/filesystem/io/documentIo";
import { scanWorkspace } from "../../../../src/bun/filesystem/scanning/scanDirectory";
import {
  authorizeChosenWorkspaceRoot,
  resetWorkspaceAuthority,
} from "../../../../src/bun/filesystem/security/workspaceAuthority";
import {
  configureWorkspaceApprovals,
  resetWorkspaceApprovals,
} from "../../../../src/bun/workspaceGrants";

let base: string;
let folder: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "fulvid-lifecycle-"));
  folder = join(base, "notes");
  await mkdir(folder);
  resetWorkspaceAuthority();
  resetWorkspaceApprovals();
  configureWorkspaceApprovals(join(base, "userdata"));
});

afterEach(async () => {
  resetWorkspaceAuthority();
  resetWorkspaceApprovals();
  await rm(base, { recursive: true, force: true });
});

describe("the editing loop", () => {
  test("open, edit, save, navigate and keep editing across many rounds", async () => {
    const root = await authorizeChosenWorkspaceRoot(folder);
    await createDocument(root, "a.md", "# A\n\n[B](b.md)\n", "markdown");
    await createDocument(root, "b.md", "# B\n\n[A](a.md)\n", "markdown");

    let a = await readDocument(root, "a.md");
    let b = await readDocument(root, "b.md");

    // Twenty rounds of the loop, alternating documents the way a person does.
    for (let round = 0; round < 20; round += 1) {
      const writtenA = await writeDocument(
        root,
        "a.md",
        `# A\n\nround ${round}\n\n[B](b.md)\n`,
        a.mtimeMs,
        "markdown",
      );
      a = await readDocument(root, "a.md");
      expect(a.content).toContain(`round ${round}`);
      expect(a.mtimeMs).toBe(writtenA.mtimeMs);

      const writtenB = await writeDocument(
        root,
        "b.md",
        `# B\n\nround ${round}\n\n[A](a.md)\n`,
        b.mtimeMs,
        "markdown",
      );
      b = await readDocument(root, "b.md");
      expect(b.content).toContain(`round ${round}`);
      expect(b.mtimeMs).toBe(writtenB.mtimeMs);
    }

    // The folder still describes exactly the two documents, with their links.
    const scan = await scanWorkspace(root, { linkMode: "markdown" });
    expect(scan.truncated).toBe(false);
    expect(scan.scannedNotes.map((note) => note.path).sort()).toEqual(["a.md", "b.md"]);
    expect(
      scan.scannedNotes.flatMap((note) => note.documentLinks.map((link) => link.target)).sort(),
    ).toEqual(["a.md", "b.md"]);
    await expect(readdirNames(folder)).resolves.toEqual(["a.md", "b.md"]);
  });
});

async function readdirNames(directory: string): Promise<string[]> {
  return (await readdir(directory)).sort();
}
