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
  resetLuaCommandStoreForTests,
} from "../../src/bun/extensions/lua/luaExtensionRuntime.ts";

import {
  luaGlobalType,
  reduceLuaGuestEnvironment,
  resetLuaFactoryForTests,
  resolveWasmoonGlueWasmPath,
} from "../../src/bun/extensions/lua/luaEngine.ts";
import {
  LUA_EXTENSION_LIMITS,
  setLuaExecutionBudgetForTests,
  setLuaMemoryBudgetForTests,
} from "../../src/bun/extensions/lua/luaLimits.ts";
import { LuaFactory } from "wasmoon";
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
  resetLuaCommandStoreForTests();
  resetLuaFactoryForTests();
});

describe("lua guest environment", () => {
  test("dangerous stdlib globals are absent after reduction", async () => {
    const factory = new LuaFactory(resolveWasmoonGlueWasmPath());
    const engine = await factory.createEngine({
      openStandardLibs: true,
      injectObjects: false,
      enableProxy: false,
    });
    await reduceLuaGuestEnvironment(engine);
    for (const name of ["io", "os", "package", "debug", "require", "dofile", "loadfile", "load"]) {
      expect(await luaGlobalType(engine, name)).toBe("nil");
    }
    await expect(
      engine.doString("local f=function() return 1 end; return string.dump(f)"),
    ).rejects.toBeDefined();
    engine.global.close();
  });
});

describe("lua registration and invocation", () => {
  test("notify fixture loads, registers namespaced command, and notifies", async () => {
    const root = await tempExtensionsRoot("ok");
    const pack = join(root, "test.contract-lua-notify");
    await cp(NOTIFY_FIXTURE, pack, { recursive: true });

    const registered = await loadPack(pack);
    expect(registered).toHaveLength(1);
    expect(registered[0]?.namespacedId).toBe("test.contract-lua-notify.ping");

    const result = await invokeLuaExtensionCommand("test.contract-lua-notify.ping");
    expect(result).toEqual({ ok: true, notifications: ["pong"] });
  });

  test("malformed Lua fails cleanly with no partial registrations", async () => {
    const root = await tempExtensionsRoot("bad");
    const pack = await writePack(
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

    await expect(loadPack(pack)).rejects.toBeDefined();
    expect(findLuaCommand("test.contract-lua-bad.one")).toBeNull();
  });

  test("duplicate command ids are rejected and leave no commit", async () => {
    const root = await tempExtensionsRoot("dup");
    const pack = await writePack(
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
    await expect(loadPack(pack)).rejects.toBeDefined();
    expect(findLuaCommand("test.contract-lua-dup.ping")).toBeNull();
  });

  test("ui.notify rejects oversized messages", async () => {
    const root = await tempExtensionsRoot("notify");
    const oversized = "x".repeat(LUA_EXTENSION_LIMITS.maxNotifyMessageChars.value + 1);
    const pack = await writePack(
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
    await loadPack(pack);
    const result = await invokeLuaExtensionCommand("test.contract-lua-big.ping");
    expect(result.ok).toBe(false);
  });

  test("arbitrary host.call bridge is not present", async () => {
    const root = await tempExtensionsRoot("hostcall");
    const pack = await writePack(
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
    await loadPack(pack);
    const result = await invokeLuaExtensionCommand("test.contract-lua-host.ping");
    expect(result).toEqual({ ok: true, notifications: [] });
  });
});

describe("lua execution and memory budgets", () => {
  test("resolves wasmoon glue.wasm from the package", () => {
    const path = resolveWasmoonGlueWasmPath();
    expect(existsSync(path)).toBe(true);
    expect(path.endsWith("glue.wasm")).toBe(true);
  });

  test("interrupts infinite loop during load and leaves no partial registrations", async () => {
    setLuaExecutionBudgetForTests(100);
    const root = await tempExtensionsRoot("loop-load");
    const pack = await writePack(
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
    const started = Date.now();
    await expect(loadPack(pack)).rejects.toMatchObject({
      reason: "execution limit exceeded",
    });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(findLuaCommand("test.contract-lua-loop.one")).toBeNull();
  });

  test("interrupts infinite loop during command invoke; host stays usable", async () => {
    setLuaExecutionBudgetForTests(100);
    const root = await tempExtensionsRoot("loop-run");
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

    const started = Date.now();
    const hung = await invokeLuaExtensionCommand("test.contract-lua-loopcmd.hang");
    expect(hung).toEqual({ ok: false, error: "execution limit exceeded" });
    expect(Date.now() - started).toBeLessThan(2_000);

    const recovered = await invokeLuaExtensionCommand("test.contract-lua-good.ping");
    expect(recovered).toEqual({ ok: true, notifications: ["ok"] });
  });

  test("valid -> infinite-loop load -> valid discovery isolation", async () => {
    setLuaExecutionBudgetForTests(100);
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
    const result = await discoverExtensions();
    expect(result.loaded.map((pack) => pack.id).sort()).toEqual([
      "test.contract-lua-a",
      "test.contract-lua-b",
    ]);
    expect(result.failed.some((failure) => failure.id === "test.contract-lua-loop")).toBe(true);
    expect(result.failed.find((failure) => failure.id === "test.contract-lua-loop")?.reason).toBe(
      "execution limit exceeded",
    );

    expect(await invokeLuaExtensionCommand("test.contract-lua-a.a")).toEqual({
      ok: true,
      notifications: ["a"],
    });
    expect(await invokeLuaExtensionCommand("test.contract-lua-b.b")).toEqual({
      ok: true,
      notifications: ["b"],
    });
  });

  test("memory limit fails controlled and neighbor recovery still works", async () => {
    setLuaMemoryBudgetForTests(256 * 1024);
    setLuaExecutionBudgetForTests(5_000);
    const userData = join(await tempExtensionsRoot("oom-iso"), "userData");
    const extensions = join(userData, "extensions");
    await mkdir(extensions, { recursive: true });
    await writePack(extensions, "test.contract-lua-oom", luaManifest("test.contract-lua-oom"), {
      "entry.lua": `
commands.register({ id = "one", title = "One", run = function() end })
local t = {}
for i = 1, 1000000 do
  t[i] = string.rep("x", 1024)
end
`,
    });
    await writePack(extensions, "test.contract-lua-ok", luaManifest("test.contract-lua-ok"), {
      "entry.lua": `
commands.register({ id = "ping", title = "Ping", run = function() ui.notify("alive") end })
`,
    });

    configureExtensionDiscovery(userData);
    const result = await discoverExtensions();
    expect(result.failed.some((failure) => failure.id === "test.contract-lua-oom")).toBe(true);
    expect(result.failed.find((failure) => failure.id === "test.contract-lua-oom")?.reason).toBe(
      "memory limit exceeded",
    );
    expect(findLuaCommand("test.contract-lua-oom.one")).toBeNull();
    expect(result.loaded.some((pack) => pack.id === "test.contract-lua-ok")).toBe(true);
    expect(await invokeLuaExtensionCommand("test.contract-lua-ok.ping")).toEqual({
      ok: true,
      notifications: ["alive"],
    });
  });
});
