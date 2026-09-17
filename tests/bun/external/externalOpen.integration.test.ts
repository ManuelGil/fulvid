import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  enqueueExternalOpenRequest,
  resetPendingExternalOpens,
  takePendingExternalOpens,
} from "../../../src/bun/external/externalOpen";
import { externalOpenRequestsFromArguments } from "../../../src/bun/external/startupArguments";
import {
  authorizedWorkspaceRoot,
  reauthorizeWorkspaceRoot,
  resetWorkspaceAuthority,
} from "../../../src/bun/filesystem/security/workspaceAuthority";
import {
  configureWorkspaceApprovals,
  resetWorkspaceApprovals,
} from "../../../src/bun/workspaceGrants";
import { filesystemErrorMessage } from "../../../src/mainview/modules/workspace/filesystem/workspaceErrors.ts";
import { linkDirectory, posixModeBitsDenyAccess } from "../../support/platform";

let base: string;
let folder: string;
let outside: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "fulvid-external-open-"));
  folder = join(base, "folder");
  outside = join(base, "outside");
  await mkdir(folder);
  await mkdir(outside);
  await writeFile(join(folder, "doc.md"), "# Doc\n");
  await writeFile(join(outside, "secret.md"), "SECRET\n");
  await writeFile(join(outside, "secret.txt"), "SECRET\n");
  resetWorkspaceAuthority();
  resetWorkspaceApprovals();
  resetPendingExternalOpens();
  configureWorkspaceApprovals(join(base, "userdata"));
});

afterEach(async () => {
  resetWorkspaceAuthority();
  resetWorkspaceApprovals();
  resetPendingExternalOpens();
  await rm(base, { recursive: true, force: true });
});

async function resolveOne(request: unknown) {
  enqueueExternalOpenRequest(request);
  const [resolved] = await takePendingExternalOpens();
  return resolved;
}

// Intent: an external open earns exactly the access a dialog would - one file
// grants one file, a folder grants that folder, mismatches refuse, links land
// on the realpath, and argv only classifies.
describe("resolving an external open", () => {
  test("file grants that document only; folder authorizes the root; mismatches refuse", async () => {
    const file = await resolveOne({
      kind: "file",
      path: join(outside, "secret.md"),
      source: "os-context-menu",
    });
    expect(file.kind).toBe("file");
    if (file.kind !== "file") return;
    expect(file.snapshot.content).toBe("SECRET\n");
    expect(file.snapshot.grantToken).toMatch(/^[0-9a-f-]{36}$/i);
    await expect(authorizedWorkspaceRoot(outside)).rejects.toThrow(
      filesystemErrorMessage("folderNotOpen"),
    );
    await expect(reauthorizeWorkspaceRoot(outside)).rejects.toThrow(
      filesystemErrorMessage("folderNotOpen"),
    );

    const opened = await resolveOne({ kind: "folder", path: folder, source: "shell" });
    expect(opened.kind).toBe("folder");
    if (opened.kind !== "folder") return;
    await expect(authorizedWorkspaceRoot(opened.rootPath)).resolves.toBe(opened.rootPath);
    await expect(authorizedWorkspaceRoot(outside)).rejects.toThrow(
      filesystemErrorMessage("folderNotOpen"),
    );

    expect(await resolveOne({ kind: "file", path: folder, source: "shell" })).toEqual({
      kind: "rejected",
      source: "shell",
      reason: "unsupportedDocument",
    });
    expect(
      await resolveOne({ kind: "folder", path: join(folder, "doc.md"), source: "shell" }),
    ).toEqual({ kind: "rejected", source: "shell", reason: "notADirectory" });
    expect(
      await resolveOne({ kind: "file", path: join(outside, "secret.txt"), source: "shell" }),
    ).toEqual({ kind: "rejected", source: "shell", reason: "unsupportedDocument" });
    expect(
      await resolveOne({ kind: "file", path: join(outside, "gone.md"), source: "shell" }),
    ).toEqual({ kind: "rejected", source: "shell", reason: "documentMissing" });
  });

  test("symlink folders authorize the real land; unreadable files refuse without path leak", async () => {
    await linkDirectory(outside, join(folder, "link"));
    const resolved = await resolveOne({
      kind: "folder",
      path: join(folder, "link"),
      source: "shell",
    });
    expect(resolved.kind).toBe("folder");
    if (resolved.kind !== "folder") return;
    expect(resolved.rootPath).not.toContain("link");
    await expect(authorizedWorkspaceRoot(base)).rejects.toThrow(
      filesystemErrorMessage("folderNotOpen"),
    );

    if (posixModeBitsDenyAccess) {
      const locked = join(folder, "locked.md");
      await writeFile(locked, "# Locked\n");
      await chmod(locked, 0o000);
      try {
        const denied = await resolveOne({ kind: "file", path: locked, source: "shell" });
        expect(denied.kind).toBe("rejected");
        if (denied.kind !== "rejected") return;
        expect(JSON.stringify(denied)).not.toContain(locked);
      } finally {
        await chmod(locked, 0o644).catch(() => {});
      }
    }
  });

  test("queue drains keep later requests after a refusal; argv classifies file/folder against cwd", async () => {
    enqueueExternalOpenRequest({ kind: "file", path: join(outside, "gone.md"), source: "shell" });
    enqueueExternalOpenRequest({ kind: "file", path: join(folder, "doc.md"), source: "shell" });
    expect((await takePendingExternalOpens()).map((entry) => entry.kind)).toEqual([
      "rejected",
      "file",
    ]);

    const requests = await externalOpenRequestsFromArguments([
      "/runtime/bun",
      "/app/main.js",
      join(folder, "doc.md"),
      folder,
      join(outside, "missing.md"),
      "--flag",
      "",
    ]);
    expect(requests.map((request) => request.kind)).toEqual(["file", "folder"]);
    expect(requests.every((request) => request.source === "os-file-association")).toBe(true);

    const previous = process.cwd();
    process.chdir(folder);
    try {
      const relative = await externalOpenRequestsFromArguments([
        "/runtime/bun",
        "/app/main.js",
        "doc.md",
      ]);
      expect(relative).toHaveLength(1);
      expect(await realpath(relative[0].path)).toBe(await realpath(join(folder, "doc.md")));
    } finally {
      process.chdir(previous);
    }
  });
});
