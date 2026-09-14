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

// Intent: an external open earns exactly the access a dialog would, no more -
// one file grants one file, a folder grants that folder, and a kind that
// disagrees with disk is refused.
// Growth boundary: add cases only for a new request kind or a new source.
describe("resolving an external open", () => {
  test("a file grants that document and nothing around it", async () => {
    const resolved = await resolveOne({
      kind: "file",
      path: join(outside, "secret.md"),
      source: "os-context-menu",
    });

    expect(resolved.kind).toBe("file");
    if (resolved.kind !== "file") return;
    expect(resolved.snapshot.content).toBe("SECRET\n");
    expect(resolved.snapshot.grantToken).toMatch(/^[0-9a-f-]{36}$/i);

    // Opening a document must not turn its folder into an authorized root,
    // now or on a later reopen.
    await expect(authorizedWorkspaceRoot(outside)).rejects.toThrow(
      filesystemErrorMessage("folderNotOpen"),
    );
    await expect(reauthorizeWorkspaceRoot(outside)).rejects.toThrow(
      filesystemErrorMessage("folderNotOpen"),
    );
  });

  test("a folder becomes an authorized root, exactly as the dialog makes one", async () => {
    const resolved = await resolveOne({ kind: "folder", path: folder, source: "shell" });

    expect(resolved.kind).toBe("folder");
    if (resolved.kind !== "folder") return;
    await expect(authorizedWorkspaceRoot(resolved.rootPath)).resolves.toBe(resolved.rootPath);

    // A sibling folder gains nothing from it.
    await expect(authorizedWorkspaceRoot(outside)).rejects.toThrow(
      filesystemErrorMessage("folderNotOpen"),
    );
  });

  test("mismatched kinds, unsupported files, and missing documents are refused", async () => {
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

  // The property is multiplatform; provoking a raw access error is not. Windows
  // ignores POSIX mode bits, so this case runs where they actually deny access.
  // That an unexpected host error never crosses as itself is covered portably by
  // workspaceAuthority's `contained` case.
  test.skipIf(!posixModeBitsDenyAccess)(
    "an unreadable document is refused without leaking the host path",
    async () => {
      const locked = join(folder, "locked.md");
      await writeFile(locked, "# Locked\n");
      await chmod(locked, 0o000);

      try {
        const resolved = await resolveOne({ kind: "file", path: locked, source: "shell" });

        expect(resolved.kind).toBe("rejected");
        if (resolved.kind !== "rejected") return;
        expect(JSON.stringify(resolved)).not.toContain(locked);
      } finally {
        await chmod(locked, 0o644).catch(() => {});
      }
    },
  );

  test("a folder reached through a symlink authorizes where it really lands", async () => {
    await linkDirectory(outside, join(folder, "link"));

    const resolved = await resolveOne({
      kind: "folder",
      path: join(folder, "link"),
      source: "shell",
    });

    expect(resolved.kind).toBe("folder");
    if (resolved.kind !== "folder") return;
    // Canonical, so containment for everything inside is measured against the
    // real directory rather than the link's parent.
    expect(resolved.rootPath).not.toContain("link");
    await expect(authorizedWorkspaceRoot(base)).rejects.toThrow(
      filesystemErrorMessage("folderNotOpen"),
    );
  });

  test("queue drains keep later requests after a refusal and never double-deliver", async () => {
    enqueueExternalOpenRequest({ kind: "file", path: join(outside, "gone.md"), source: "shell" });
    enqueueExternalOpenRequest({ kind: "file", path: join(folder, "doc.md"), source: "shell" });
    expect((await takePendingExternalOpens()).map((entry) => entry.kind)).toEqual([
      "rejected",
      "file",
    ]);

    enqueueExternalOpenRequest({ kind: "file", path: join(folder, "doc.md"), source: "shell" });
    const [first, second] = await Promise.all([
      takePendingExternalOpens(),
      takePendingExternalOpens(),
    ]);
    expect(first.length + second.length).toBe(1);
  });
});

// Intent: an adapter converts a channel's representation and decides nothing.
describe("launch arguments as a source", () => {
  test("classifies argv into file/folder opens and resolves relative paths against cwd", async () => {
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
