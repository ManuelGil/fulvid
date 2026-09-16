/**
 * Fresh-author DX: acme.heading-nav loads from pack files and navigates headings.
 * Contract-facing — not product TODO/MDX/ADR/line-length semantics.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  configureExtensionDiscovery,
  discoverExtensions,
  resetExtensionDiscoveryForTests,
} from "../../src/bun/extensions/discoverExtensions.ts";
import { resetExtensionAllowancesForTests } from "../../src/bun/extensions/extensionAllowances.ts";
import {
  invokeLuaExtensionCommand,
  resetLuaCommandStoreForTests,
} from "../../src/bun/extensions/lua/luaExtensionRuntime.ts";
import { resetLuaFactoryForTests } from "../../src/bun/extensions/lua/luaEngine.ts";
import { validateExtensionManifest } from "../../src/mainview/extensions/extensionManifest.ts";
import { resetExtensionRegistryForTests } from "../../src/mainview/extensions/extensionRegistry.ts";

const PACK_ROOT = join(
  import.meta.dir,
  "../../../fulvid-extensions/tests/extensions/acme.heading-nav",
);

async function copyHeadingNav(userData: string): Promise<void> {
  const dest = join(userData, "extensions", "acme.heading-nav");
  await mkdir(dest, { recursive: true });
  for (const name of ["manifest.json", "init.lua", "README.md"]) {
    await writeFile(join(dest, name), await readFile(join(PACK_ROOT, name), "utf8"));
  }
}

afterEach(() => {
  resetExtensionDiscoveryForTests();
  resetExtensionAllowancesForTests();
  resetExtensionRegistryForTests();
  resetLuaCommandStoreForTests();
  resetLuaFactoryForTests();
});

describe("acme.heading-nav fresh-author contract", () => {
  test("pack manifest validates and discovers with Navigate placements", async () => {
    const raw = JSON.parse(await readFile(join(PACK_ROOT, "manifest.json"), "utf8"));
    const validated = validateExtensionManifest(raw);
    expect("manifest" in validated).toBe(true);

    const userData = join(tmpdir(), `fulvid-heading-nav-${crypto.randomUUID()}`);
    await copyHeadingNav(userData);
    configureExtensionDiscovery(userData);
    const discovery = await discoverExtensions();
    const pack = discovery.loaded.find((entry) => entry.id === "acme.heading-nav");
    expect(pack?.state).toBe("loaded");
    expect(pack?.commands.map((command) => command.id).sort()).toEqual([
      "headingNext",
      "headingPrevious",
    ]);
    expect(pack?.commands.every((command) => command.menu === "navigate")).toBe(true);
  });

  test("headingNext reveals the next Markdown heading from cursor", async () => {
    const userData = join(tmpdir(), `fulvid-heading-nav-run-${crypto.randomUUID()}`);
    await copyHeadingNav(userData);
    configureExtensionDiscovery(userData);
    await discoverExtensions();

    const result = await invokeLuaExtensionCommand({
      namespacedId: "acme.heading-nav.headingNext",
      document: {
        text: "# One\n\nbody\n\n## Two\n\nmore\n",
        documentId: "doc-1",
        alternativeVersionId: 1,
        cursorLine: 2,
        cursorColumn: 1,
      },
    });
    expect(result).toEqual({
      ok: true,
      notifications: [],
      reveal: { lineNumber: 5, column: 1 },
    });
  });

  test("manifest mistakes stay actionable", () => {
    expect(
      validateExtensionManifest({
        publisher: "Acme",
        name: "x",
        displayName: "X",
        version: "1.0.0",
        api: 1,
        description: "d",
        capabilities: ["lua", "commands", "ui"],
        entry: "init.lua",
      }),
    ).toMatchObject({ reason: expect.stringMatching(/^invalid publisher:/) });

    expect(
      validateExtensionManifest({
        publisher: "acme",
        name: "x",
        id: "acme.x",
        displayName: "X",
        version: "1.0",
        api: 1,
        description: "d",
        capabilities: ["lua", "commands", "ui"],
        entry: "init.lua",
      }),
    ).toMatchObject({ reason: expect.stringMatching(/^invalid extension version:/) });
  });
});
