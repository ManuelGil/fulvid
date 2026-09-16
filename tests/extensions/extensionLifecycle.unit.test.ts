import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  configureExtensionDiscovery,
  discoverExtensions,
  getDiscoveredExtensions,
  installExtensionFromDirectory,
  resetExtensionDiscoveryForTests,
  uninstallExtensionPack,
} from "../../src/bun/extensions/discoverExtensions.ts";
import {
  allowBlockedExtension,
  isBlockedExtensionAllowed,
  listAllowedBlockedExtensionIds,
  resetExtensionAllowancesForTests,
} from "../../src/bun/extensions/extensionAllowances.ts";
import { findLuaCommand } from "../../src/bun/extensions/lua/luaExtensionRuntime.ts";
import { luaManifest } from "./manifestTestHelpers.ts";

async function tempUserData(label: string): Promise<string> {
  const root = join(tmpdir(), `fulvid-lifecycle-${label}-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  return root;
}

async function writeCandidate(
  root: string,
  id: string,
  manifest: Record<string, unknown>,
  entry = `
commands.register({
  id = "ping",
  title = "Ping",
  run = function()
    ui.notify("ok")
  end
})
`,
): Promise<string> {
  const pack = join(root, id);
  await mkdir(pack, { recursive: true });
  await writeFile(join(pack, "manifest.json"), JSON.stringify(manifest, null, 2));
  await writeFile(join(pack, "entry.lua"), entry);
  return pack;
}

afterEach(() => {
  resetExtensionDiscoveryForTests();
  resetExtensionAllowancesForTests();
});

describe("extension install/uninstall lifecycle", () => {
  test("installs a valid pack atomically and exposes its commands", async () => {
    const userData = await tempUserData("ok");
    configureExtensionDiscovery(userData);
    await discoverExtensions();

    const sourceRoot = join(userData, "candidates");
    const source = await writeCandidate(
      sourceRoot,
      "acme.example-extension",
      luaManifest("acme.example-extension"),
    );

    const result = await installExtensionFromDirectory(source);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.id).toBe("acme.example-extension");
    expect(result.discovery.loaded.map((pack) => pack.id)).toContain("acme.example-extension");
    expect(findLuaCommand("acme.example-extension.ping")).not.toBeNull();

    const installedManifest = JSON.parse(
      await readFile(
        join(userData, "extensions", "acme.example-extension", "manifest.json"),
        "utf8",
      ),
    );
    expect(installedManifest.id).toBe("acme.example-extension");
  });

  test("rejects invalid manifests without creating an installed pack", async () => {
    const userData = await tempUserData("bad");
    configureExtensionDiscovery(userData);
    await discoverExtensions();

    const sourceRoot = join(userData, "candidates");
    const pack = join(sourceRoot, "broken");
    await mkdir(pack, { recursive: true });
    await writeFile(join(pack, "manifest.json"), "{not-json");

    const result = await installExtensionFromDirectory(pack);
    expect(result.status).toBe("error");
    if (result.status !== "error") {
      return;
    }
    expect(result.reason).toMatch(/malformed|invalid/i);
    expect(result.discovery.installed).toEqual([]);
    const listing = await readdir(join(userData, "extensions"));
    expect(listing.filter((name) => !name.startsWith("_fulvid-staging-"))).toEqual([]);
  });

  test("rejects duplicate identities without replacing the installed pack", async () => {
    const userData = await tempUserData("dup");
    configureExtensionDiscovery(userData);
    const sourceRoot = join(userData, "candidates");
    const first = await writeCandidate(
      sourceRoot,
      "acme.dup",
      luaManifest("acme.dup", ["lua", "commands", "ui"], { version: "1.0.0" }),
    );
    expect((await installExtensionFromDirectory(first)).status).toBe("ok");

    const second = await writeCandidate(
      join(userData, "candidates-2"),
      "acme.dup",
      luaManifest("acme.dup", ["lua", "commands", "ui"], { version: "2.0.0" }),
    );
    const result = await installExtensionFromDirectory(second);
    expect(result.status).toBe("error");
    if (result.status !== "error") {
      return;
    }
    expect(result.reason).toMatch(/already installed/);
    const installed = JSON.parse(
      await readFile(join(userData, "extensions", "acme.dup", "manifest.json"), "utf8"),
    );
    expect(installed.version).toBe("1.0.0");
  });

  test("rejects symlink packs and leaves no partial install", async () => {
    const userData = await tempUserData("link");
    configureExtensionDiscovery(userData);
    await discoverExtensions();

    const realPack = await writeCandidate(
      join(userData, "real"),
      "acme.linked",
      luaManifest("acme.linked"),
    );
    const linked = join(userData, "linked-source");
    await symlink(realPack, linked);

    const result = await installExtensionFromDirectory(linked);
    expect(result.status).toBe("error");
    if (result.status !== "error") {
      return;
    }
    expect(result.reason).toMatch(/symlink/i);
    expect(getDiscoveredExtensions().installed).toEqual([]);
  });

  test("uninstall removes files, commands, and allowance; neighbors stay loaded", async () => {
    const userData = await tempUserData("rm");
    configureExtensionDiscovery(userData);

    const keep = await writeCandidate(
      join(userData, "candidates"),
      "acme.keep",
      luaManifest("acme.keep"),
    );
    const drop = await writeCandidate(
      join(userData, "candidates"),
      "acme.drop",
      luaManifest("acme.drop"),
    );
    expect((await installExtensionFromDirectory(keep)).status).toBe("ok");
    expect((await installExtensionFromDirectory(drop)).status).toBe("ok");
    expect(allowBlockedExtension("acme.drop")).toBe(true);
    expect(isBlockedExtensionAllowed("acme.drop")).toBe(true);

    const result = await uninstallExtensionPack("acme.drop");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.discovery.loaded.map((pack) => pack.id)).toEqual(["acme.keep"]);
    expect(findLuaCommand("acme.keep.ping")).not.toBeNull();
    expect(findLuaCommand("acme.drop.ping")).toBeNull();
    expect(isBlockedExtensionAllowed("acme.drop")).toBe(false);
    expect(listAllowedBlockedExtensionIds()).not.toContain("acme.drop");
    expect(
      await Bun.file(join(userData, "extensions", "acme.drop", "manifest.json")).exists(),
    ).toBe(false);
  });

  test("failed uninstall reports accurately when the pack is missing", async () => {
    const userData = await tempUserData("miss");
    configureExtensionDiscovery(userData);
    await discoverExtensions();
    const result = await uninstallExtensionPack("acme.missing");
    expect(result.status).toBe("error");
    if (result.status !== "error") {
      return;
    }
    expect(result.reason).toMatch(/missing|invalid/i);
  });

  test("broken neighbor remains isolated across rediscovery after install", async () => {
    const userData = await tempUserData("iso");
    configureExtensionDiscovery(userData);
    const extensions = join(userData, "extensions");
    await mkdir(extensions, { recursive: true });
    await writeCandidate(extensions, "acme.good", luaManifest("acme.good"));
    await mkdir(join(extensions, "acme.bad"), { recursive: true });
    await writeFile(join(extensions, "acme.bad", "manifest.json"), "{bad");

    const before = await discoverExtensions();
    expect(before.loaded.map((pack) => pack.id)).toEqual(["acme.good"]);
    expect(before.failed.some((failure) => failure.id === "acme.bad")).toBe(true);

    const extra = await writeCandidate(
      join(userData, "candidates"),
      "acme.extra",
      luaManifest("acme.extra"),
    );
    const installed = await installExtensionFromDirectory(extra);
    expect(installed.status).toBe("ok");
    if (installed.status !== "ok") {
      return;
    }
    expect(installed.discovery.loaded.map((pack) => pack.id).sort()).toEqual([
      "acme.extra",
      "acme.good",
    ]);
    expect(installed.discovery.failed.some((failure) => failure.id === "acme.bad")).toBe(true);
  });
});
