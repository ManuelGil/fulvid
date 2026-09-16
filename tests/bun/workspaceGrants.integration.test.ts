import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  approveWorkspaceRoot,
  configureWorkspaceApprovals,
  isApprovedWorkspaceRoot,
  resetWorkspaceApprovals,
} from "../../src/bun/workspaceGrants";

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
});
