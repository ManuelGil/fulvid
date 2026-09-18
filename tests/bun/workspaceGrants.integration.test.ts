import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  approveWorkspaceRoot,
  configureWorkspaceApprovals,
  isApprovedWorkspaceRoot,
  resetWorkspaceApprovals,
} from "../../src/bun/workspaceGrants";
import { resetWorkspaceAuthority } from "../../src/bun/filesystem/security/workspaceAuthority";

const directories: string[] = [];

async function useStore(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "fulvid-approvals-"));
  directories.push(directory);
  resetWorkspaceApprovals();
  configureWorkspaceApprovals(directory);
  return directory;
}

afterEach(async () => {
  resetWorkspaceApprovals();
  resetWorkspaceAuthority();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

// Intent: persisted folder approval is durable and fail-closed on corruption.
describe("folder approvals", () => {
  test("an approval survives into the next session; a corrupt store grants nothing", async () => {
    const directory = await useStore();
    approveWorkspaceRoot("/home/me/notes");
    resetWorkspaceApprovals();
    configureWorkspaceApprovals(directory);
    expect(isApprovedWorkspaceRoot("/home/me/notes")).toBe(true);
    expect(isApprovedWorkspaceRoot("/home/me/other")).toBe(false);

    for (const corrupt of [
      "not json at all",
      '{"roots":["/home/me/notes"]}',
      "null",
      '"/home/me/notes"',
      "[]",
    ]) {
      const bad = await mkdtemp(join(tmpdir(), "fulvid-approvals-bad-"));
      directories.push(bad);
      await writeFile(join(bad, "approved-folders.json"), corrupt);
      resetWorkspaceApprovals();
      configureWorkspaceApprovals(bad);
      expect(isApprovedWorkspaceRoot("/home/me/notes")).toBe(false);
    }
  });

  test("approving another folder keeps peers already on disk (no stale empty merge)", async () => {
    const directory = await useStore();
    approveWorkspaceRoot("/home/me/first");
    // Simulate a peer writer updating the file after this process first read it.
    await writeFile(
      join(directory, "approved-folders.json"),
      JSON.stringify(["/home/me/first", "/home/me/peer"]),
    );
    approveWorkspaceRoot("/home/me/second");
    expect(isApprovedWorkspaceRoot("/home/me/first")).toBe(true);
    expect(isApprovedWorkspaceRoot("/home/me/peer")).toBe(true);
    expect(isApprovedWorkspaceRoot("/home/me/second")).toBe(true);
    const stored = JSON.parse(await readFile(join(directory, "approved-folders.json"), "utf8"));
    expect(stored[0]).toBe("/home/me/second");
  });
});
