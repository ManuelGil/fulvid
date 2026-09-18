import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  authorizeChosenWorkspaceRoot,
  authorizedDesktopPath,
  authorizedWorkspaceRoot,
  containHostError,
  grantDocument,
  grantedPath,
  reauthorizeWorkspaceRoot,
  resetWorkspaceAuthority,
} from "../../../../src/bun/filesystem/security/workspaceAuthority";
import {
  configureWorkspaceApprovals,
  resetWorkspaceApprovals,
} from "../../../../src/bun/workspaceGrants";
import { filesystemErrorMessage } from "../../../../src/mainview/modules/workspace/filesystem/workspaceErrors.ts";

const NOT_OPEN = filesystemErrorMessage("folderNotOpen");
const OUTSIDE_OPENED = filesystemErrorMessage("outsideOpenedFolders");
const GRANT_INVALID = filesystemErrorMessage("grantInvalid");

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

// Intent: folder approval, desktop absolute-path gate, grants, and host-error redaction.
describe("workspace authority", () => {
  test("dialog approval authorizes a root; reauthorize restores after session reset", async () => {
    await expect(authorizedWorkspaceRoot(root)).rejects.toThrow(NOT_OPEN);
    await authorizeChosenWorkspaceRoot(root);
    await expect(authorizedWorkspaceRoot(root)).resolves.toBeTruthy();

    resetWorkspaceAuthority();
    await expect(authorizedWorkspaceRoot(root)).rejects.toThrow(NOT_OPEN);
    await expect(reauthorizeWorkspaceRoot(root)).resolves.toBeTruthy();
    await expect(authorizedWorkspaceRoot(root)).resolves.toBeTruthy();
    await expect(reauthorizeWorkspaceRoot(outside)).rejects.toThrow(NOT_OPEN);
  });

  test("desktop paths allow inside an authorized root and refuse everything else", async () => {
    await authorizeChosenWorkspaceRoot(root);
    await expect(authorizedDesktopPath(join(root, "note.md"))).resolves.toBeTruthy();
    await expect(authorizedDesktopPath(outside)).rejects.toThrow(OUTSIDE_OPENED);
    await expect(authorizedDesktopPath(join(outside, "secret.md"))).rejects.toThrow(OUTSIDE_OPENED);
    await expect(authorizedDesktopPath("/etc/passwd")).rejects.toThrow(OUTSIDE_OPENED);
  });

  test("document grants resolve, refuse forgeries, evict at the bound, and redact host errors", async () => {
    const first = grantDocument(join(root, "a.md"));
    expect(grantedPath(first)).toBe(join(root, "a.md"));
    expect(() => grantedPath("not-a-uuid")).toThrow(GRANT_INVALID);
    expect(() => grantedPath("00000000-0000-0000-0000-000000000000")).toThrow(GRANT_INVALID);

    const tokens: string[] = [first];
    for (let i = 1; i < 512; i += 1) {
      tokens.push(grantDocument(join(root, `n${i}.md`)));
    }
    expect(grantedPath(first)).toBe(join(root, "a.md"));
    const overflow = grantDocument(join(root, "overflow.md"));
    expect(() => grantedPath(first)).toThrow(GRANT_INVALID);
    expect(grantedPath(overflow)).toBe(join(root, "overflow.md"));
    expect(grantedPath(tokens[1]!)).toBe(join(root, "n1.md"));

    const handler = containHostError("readDocument", async () => {
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
