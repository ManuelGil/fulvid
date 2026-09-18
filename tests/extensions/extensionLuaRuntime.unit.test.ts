import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import {
  configureExtensionDiscovery,
  discoverExtensions,
  resetExtensionDiscoveryForTests,
} from "../../src/bun/extensions/discoverExtensions.ts";
import {
  findLuaCommand,
  invokeLuaExtensionCommand,
  loadLuaExtensionPack,
  resetLuaCommandStore,
} from "../../src/bun/extensions/lua/luaExtensionRuntime.ts";

import {
  resetLuaFactoryForTests,
  resolveWasmoonGlueWasmPath,
} from "../../src/bun/extensions/lua/luaEngine.ts";
import {
  LUA_EXTENSION_LIMITS,
  setLuaExecutionBudgetForTests,
  setLuaMemoryBudgetForTests,
} from "../../src/bun/extensions/lua/luaLimits.ts";
import { validateExtensionManifest } from "../../src/mainview/extensions/extensionManifest.ts";
import { luaManifest } from "./manifestTestHelpers.ts";

const NOTIFY_FIXTURE = join(import.meta.dir, "fixtures/test.contract-lua-notify");

async function tempExtensionsRoot(label: string): Promise<string> {
  const root = join(tmpdir(), `fulvid-lua-${label}-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  return root;
}

async function writePack(
  root: string,
  id: string,
  manifest: unknown,
  files: Record<string, string> = {},
): Promise<string> {
  const pack = join(root, id);
  await mkdir(pack, { recursive: true });
  await writeFile(join(pack, "manifest.json"), JSON.stringify(manifest, null, 2));
  for (const [relative, content] of Object.entries(files)) {
    const target = join(pack, relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return pack;
}

async function loadPack(pack: string) {
  const validated = validateExtensionManifest(
    JSON.parse(await readFile(join(pack, "manifest.json"), "utf8")),
  );
  if (!("manifest" in validated)) {
    throw new Error(validated.reason);
  }
  return loadLuaExtensionPack(pack, validated.manifest);
}

afterEach(() => {
  setLuaExecutionBudgetForTests(null);
  setLuaMemoryBudgetForTests(null);
  resetExtensionDiscoveryForTests();
  resetLuaCommandStore();
  resetLuaFactoryForTests();
});

describe("lua registration and invocation", () => {
  test("notify fixture works; malformed, dup, notify size, and host.call fail closed", async () => {
    const root = await tempExtensionsRoot("reg");
    const notifyPack = join(root, "test.contract-lua-notify");
    await cp(NOTIFY_FIXTURE, notifyPack, { recursive: true });

    const registered = await loadPack(notifyPack);
    expect(registered).toHaveLength(1);
    expect(registered[0]?.namespacedId).toBe("test.contract-lua-notify.ping");
    expect(await invokeLuaExtensionCommand("test.contract-lua-notify.ping")).toEqual({
      ok: true,
      notifications: ["pong"],
    });

    const bad = await writePack(
      root,
      "test.contract-lua-bad",
      luaManifest("test.contract-lua-bad"),
      {
        "entry.lua": `
commands.register({ id = "one", title = "One", run = function() end })
error("boom after register")
`,
      },
    );
    await expect(loadPack(bad)).rejects.toBeDefined();
    expect(findLuaCommand("test.contract-lua-bad.one")).toBeNull();

    const dup = await writePack(
      root,
      "test.contract-lua-dup",
      luaManifest("test.contract-lua-dup"),
      {
        "entry.lua": `
commands.register({ id = "ping", title = "A", run = function() end })
commands.register({ id = "ping", title = "B", run = function() end })
`,
      },
    );
    await expect(loadPack(dup)).rejects.toBeDefined();
    expect(findLuaCommand("test.contract-lua-dup.ping")).toBeNull();

    const oversized = "x".repeat(LUA_EXTENSION_LIMITS.maxNotifyMessageChars.value + 1);
    const big = await writePack(
      root,
      "test.contract-lua-big",
      luaManifest("test.contract-lua-big"),
      {
        "entry.lua": `
commands.register({
  id = "ping",
  title = "Ping",
  run = function()
    ui.notify("${oversized}")
  end
})
`,
      },
    );
    await loadPack(big);
    expect((await invokeLuaExtensionCommand("test.contract-lua-big.ping")).ok).toBe(false);

    const host = await writePack(
      root,
      "test.contract-lua-host",
      luaManifest("test.contract-lua-host"),
      {
        "entry.lua": `
commands.register({
  id = "ping",
  title = "Ping",
  run = function()
    if host ~= nil then error("host bridge leaked") end
    if type(host) == "table" and host.call then error("host.call leaked") end
  end
})
`,
      },
    );
    await loadPack(host);
    expect(await invokeLuaExtensionCommand("test.contract-lua-host.ping")).toEqual({
      ok: true,
      notifications: [],
    });
  });
});

describe("lua execution and memory budgets", () => {
  test("execution and memory budgets interrupt bad packs and leave neighbors usable", async () => {
    const path = resolveWasmoonGlueWasmPath();
    expect(existsSync(path)).toBe(true);
    expect(path.endsWith("glue.wasm")).toBe(true);

    setLuaExecutionBudgetForTests(100);
    const root = await tempExtensionsRoot("loop");
    const loopLoad = await writePack(
      root,
      "test.contract-lua-loop",
      luaManifest("test.contract-lua-loop"),
      {
        "entry.lua": `
commands.register({ id = "one", title = "One", run = function() end })
while true do end
`,
      },
    );
    const startedLoad = Date.now();
    await expect(loadPack(loopLoad)).rejects.toMatchObject({
      reason: "execution limit exceeded",
    });
    // Interrupt must finish promptly; wall clock is a soft bound, not the contract.
    expect(Date.now() - startedLoad).toBeLessThan(30_000);
    expect(findLuaCommand("test.contract-lua-loop.one")).toBeNull();

    const good = await writePack(
      root,
      "test.contract-lua-good",
      luaManifest("test.contract-lua-good"),
      {
        "entry.lua": `
commands.register({
  id = "ping",
  title = "Ping",
  run = function()
    ui.notify("ok")
  end
})
`,
      },
    );
    const looping = await writePack(
      root,
      "test.contract-lua-loopcmd",
      luaManifest("test.contract-lua-loopcmd"),
      {
        "entry.lua": `
commands.register({
  id = "hang",
  title = "Hang",
  run = function()
    while true do end
  end
})
`,
      },
    );
    await loadPack(good);
    await loadPack(looping);

    const startedInvoke = Date.now();
    expect(await invokeLuaExtensionCommand("test.contract-lua-loopcmd.hang")).toEqual({
      ok: false,
      error: "execution limit exceeded",
      failureKind: "executionTimeout",
    });
    expect(Date.now() - startedInvoke).toBeLessThan(30_000);
    expect(await invokeLuaExtensionCommand("test.contract-lua-good.ping")).toEqual({
      ok: true,
      notifications: ["ok"],
    });

    const userData = join(await tempExtensionsRoot("loop-iso"), "userData");
    const extensions = join(userData, "extensions");
    await mkdir(extensions, { recursive: true });
    await writePack(extensions, "test.contract-lua-a", luaManifest("test.contract-lua-a"), {
      "entry.lua": `
commands.register({ id = "a", title = "A", run = function() ui.notify("a") end })
`,
    });
    await writePack(extensions, "test.contract-lua-loop", luaManifest("test.contract-lua-loop"), {
      "entry.lua": "while true do end",
    });
    await writePack(extensions, "test.contract-lua-b", luaManifest("test.contract-lua-b"), {
      "entry.lua": `
commands.register({ id = "b", title = "B", run = function() ui.notify("b") end })
`,
    });

    configureExtensionDiscovery(userData);
    const loopResult = await discoverExtensions();
    expect(loopResult.loaded.map((pack) => pack.id).sort()).toEqual([
      "test.contract-lua-a",
      "test.contract-lua-b",
    ]);
    expect(
      loopResult.failed.find((failure) => failure.id === "test.contract-lua-loop")?.reason,
    ).toBe("execution limit exceeded");
    expect(await invokeLuaExtensionCommand("test.contract-lua-a.a")).toEqual({
      ok: true,
      notifications: ["a"],
    });
    expect(await invokeLuaExtensionCommand("test.contract-lua-b.b")).toEqual({
      ok: true,
      notifications: ["b"],
    });

    resetExtensionDiscoveryForTests();
    resetLuaCommandStore();
    resetLuaFactoryForTests();
    setLuaMemoryBudgetForTests(256 * 1024);
    setLuaExecutionBudgetForTests(5_000);

    const oomUserData = join(await tempExtensionsRoot("oom-iso"), "userData");
    const oomExtensions = join(oomUserData, "extensions");
    await mkdir(oomExtensions, { recursive: true });
    await writePack(oomExtensions, "test.contract-lua-oom", luaManifest("test.contract-lua-oom"), {
      "entry.lua": `
commands.register({ id = "one", title = "One", run = function() end })
local t = {}
for i = 1, 1000000 do
  t[i] = string.rep("x", 1024)
end
`,
    });
    await writePack(oomExtensions, "test.contract-lua-ok", luaManifest("test.contract-lua-ok"), {
      "entry.lua": `
commands.register({ id = "ping", title = "Ping", run = function() ui.notify("alive") end })
`,
    });

    configureExtensionDiscovery(oomUserData);
    const oomResult = await discoverExtensions();
    expect(oomResult.failed.find((failure) => failure.id === "test.contract-lua-oom")?.reason).toBe(
      "memory limit exceeded",
    );
    expect(findLuaCommand("test.contract-lua-oom.one")).toBeNull();
    expect(oomResult.loaded.some((pack) => pack.id === "test.contract-lua-ok")).toBe(true);
    expect(await invokeLuaExtensionCommand("test.contract-lua-ok.ping")).toEqual({
      ok: true,
      notifications: ["alive"],
    });
  });
});
