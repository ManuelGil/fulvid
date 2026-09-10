import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  authorizeChosenWorkspaceRoot,
  authorizedDesktopPath,
  authorizedWorkspaceRoot,
  contained,
  resetWorkspaceAuthority,
} from "../../../../src/bun/filesystem/security/workspaceAuthority";
import {
  configureWorkspaceApprovals,
  resetWorkspaceApprovals,
} from "../../../../src/bun/workspaceGrants";
import { filesystemErrorMessage } from "../../../../src/mainview/modules/workspace/filesystem/workspaceErrors.ts";

const NOT_OPEN = filesystemErrorMessage("folderNotOpen");
const OUTSIDE_OPENED = filesystemErrorMessage("outsideOpenedFolders");

let base: string;
let root: string;
let outside: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "fulvid-authority-"));
  root = join(base, "folder");
  outside = join(base, "outside");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(root, "note.md"), "note\n");
  await writeFile(join(outside, "secret.md"), "secret\n");
  resetWorkspaceAuthority();
  resetWorkspaceApprovals();
  configureWorkspaceApprovals(join(base, "userdata"));
});

afterEach(async () => {
  resetWorkspaceAuthority();
  resetWorkspaceApprovals();
  await rm(base, { recursive: true, force: true });
});

// Intent: keep folder approval, absolute-path authorization, and host-error redaction fail-closed.
// Growth boundary: add cases only for new authority sources or error contracts.
describe("folder authorization", () => {
  test("a folder is unusable until a dialog approved it", async () => {
    await expect(authorizedWorkspaceRoot(root)).rejects.toThrow(NOT_OPEN);

    await authorizeChosenWorkspaceRoot(root);
    await expect(authorizedWorkspaceRoot(root)).resolves.toBeTruthy();
  });
});

describe("desktop actions", () => {
  test("refuse a path outside every opened folder", async () => {
    await authorizeChosenWorkspaceRoot(root);

    await expect(authorizedDesktopPath(outside)).rejects.toThrow(OUTSIDE_OPENED);
    await expect(authorizedDesktopPath(join(outside, "secret.md"))).rejects.toThrow(OUTSIDE_OPENED);
    await expect(authorizedDesktopPath("/etc/passwd")).rejects.toThrow(OUTSIDE_OPENED);
  });
});

describe("error containment", () => {
  test("a host failure never reaches the renderer as itself", async () => {
    const handler = contained("readDocument", async () => {
      throw Object.assign(new Error("ENOENT: no such file or directory, open '/home/me/secret'"), {
        code: "ENOENT",
        errno: -2,
      });
    });

    const rejection = handler({});
    await expect(rejection).rejects.toThrow(filesystemErrorMessage("operationFailed"));
    await expect(rejection).rejects.not.toThrow("/home/me/secret");
  });
});
