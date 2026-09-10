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

  test("a kind that disagrees with disk is refused, not reinterpreted", async () => {
    const directoryAsFile = await resolveOne({ kind: "file", path: folder, source: "shell" });
    expect(directoryAsFile).toEqual({
      kind: "rejected",
      source: "shell",
      reason: "unsupportedDocument",
    });

    const fileAsFolder = await resolveOne({
      kind: "folder",
      path: join(folder, "doc.md"),
      source: "shell",
    });
    expect(fileAsFolder).toEqual({ kind: "rejected", source: "shell", reason: "notADirectory" });
  });

  test("unsupported and missing documents are refused with a reportable reason", async () => {
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

  test("one refusal does not discard the rest of the queue", async () => {
    enqueueExternalOpenRequest({ kind: "file", path: join(outside, "gone.md"), source: "shell" });
    enqueueExternalOpenRequest({ kind: "file", path: join(folder, "doc.md"), source: "shell" });

    const resolved = await takePendingExternalOpens();

    expect(resolved.map((entry) => entry.kind)).toEqual(["rejected", "file"]);
  });

  test("a repeated request resolves to the same document every time", async () => {
    const request = { kind: "file", path: join(folder, "doc.md"), source: "os-file-association" };
    enqueueExternalOpenRequest({ ...request });
    enqueueExternalOpenRequest({ ...request });
    enqueueExternalOpenRequest({ ...request });

    const resolved = await takePendingExternalOpens();

    // Replay is safe because the target is stable; the buffer table dedupes by
    // absolute path when these reach the renderer.
    expect(resolved).toHaveLength(3);
    const targets = new Set(
      resolved.map((entry) => (entry.kind === "file" ? entry.snapshot.absolutePath : "")),
    );
    expect(targets.size).toBe(1);
  });

  test("concurrent drains deliver each request once", async () => {
    enqueueExternalOpenRequest({ kind: "file", path: join(folder, "doc.md"), source: "shell" });

    const [first, second] = await Promise.all([
      takePendingExternalOpens(),
      takePendingExternalOpens(),
    ]);

    expect(first.length + second.length).toBe(1);
  });
});

// Intent: an adapter converts a channel's representation and decides nothing.
// Growth boundary: add cases only when a new channel needs a new adapter.
describe("launch arguments as a source", () => {
  test("classifies each argument and ignores what cannot be opened", async () => {
    const requests = await externalOpenRequestsFromArguments([
      "/runtime/bun",
      "/app/main.js",
      join(folder, "doc.md"),
      folder,
      join(outside, "missing.md"),
      "--flag",
      "-x",
      "",
    ]);

    expect(requests.map((request) => request.kind)).toEqual(["file", "folder"]);
    expect(requests.every((request) => request.source === "os-file-association")).toBe(true);
  });

  test("a relative argument resolves against the process directory", async () => {
    // argv's base is the working directory; that convention belongs to the
    // adapter, which is why the contract can insist on absolute paths.
    const previous = process.cwd();
    process.chdir(folder);
    try {
      const requests = await externalOpenRequestsFromArguments([
        "/runtime/bun",
        "/app/main.js",
        "doc.md",
      ]);

      expect(requests).toHaveLength(1);
      // Compare canonically: this is the one assertion that crosses
      // `process.cwd()`, and Windows may report the temp directory in a
      // different form (8.3 short name, different case) than `mkdtemp` returned.
      expect(await realpath(requests[0].path)).toBe(await realpath(join(folder, "doc.md")));
    } finally {
      process.chdir(previous);
    }
  });

  test("argv composes into resolved opens, the way startup wires it", async () => {
    // This is exactly what src/bun/index.ts does before the window opens:
    // adapter -> enqueue -> drain. Held here so the wiring cannot drift apart.
    for (const request of await externalOpenRequestsFromArguments([
      "/runtime/bun",
      "/app/main.js",
      join(folder, "doc.md"),
      folder,
    ])) {
      enqueueExternalOpenRequest(request);
    }

    const resolved = await takePendingExternalOpens();

    expect(resolved.map((entry) => entry.kind)).toEqual(["file", "folder"]);
    const file = resolved[0];
    const opened = resolved[1];
    if (file.kind !== "file" || opened.kind !== "folder") return;
    expect(file.snapshot.content).toBe("# Doc\n");
    await expect(authorizedWorkspaceRoot(opened.rootPath)).resolves.toBe(opened.rootPath);
  });
});
