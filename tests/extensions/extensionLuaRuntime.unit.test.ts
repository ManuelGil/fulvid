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
  listLuaCommandsForExtension,
  pendingLuaCommandCount,
  resetLuaCommandStoreForTests,
} from "../../src/bun/extensions/lua/luaCommandStore.ts";
import {
  createHardenedLuaEngine,
  resolveWasmoonGlueWasmPath,
  runLuaSourceWithBudget,
} from "../../src/bun/extensions/lua/luaEngine.ts";
import {
  invokeLuaExtensionCommand,
  loadLuaExtensionPack,
  resetLuaFactoryForTests,
} from "../../src/bun/extensions/lua/luaExtensionRuntime.ts";
import {
  reduceLuaGuestEnvironment,
  luaGlobalType,
} from "../../src/bun/extensions/lua/luaGuestEnvironment.ts";
import {
  LUA_EXTENSION_LIMITS,
  setLuaExecutionBudgetForTests,
  setLuaMemoryBudgetForTests,
} from "../../src/bun/extensions/lua/luaLimits.ts";
import { LuaFactory } from "wasmoon";
import { validateExtensionManifest } from "../../src/mainview/extensions/extensionManifest.ts";

const NOTIFY_FIXTURE = join(import.meta.dir, "fixtures/contract-lua-notify");

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

function luaManifest(id: string) {
  return {
    id,
    name: id,
    version: "0.0.0",
    api: 1,
    capabilities: ["lua", "commands", "ui"] as const,
    entry: "entry.lua",
  };
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

describe("lua extension manifest contract", () => {
  test("accepts a lua pack with entry and required capabilities", () => {
    const result = validateExtensionManifest({
      id: "local.contract-lua-notify",
      name: "Spike",
      version: "0.0.0",
      api: 1,
      capabilities: ["lua", "commands", "ui"],
      entry: "entry.lua",
    });
    expect("manifest" in result).toBe(true);
  });

  test("rejects lua without entry and entry without lua", () => {
    expect(
      validateExtensionManifest({
        id: "local.contract-lua-notify",
        name: "Spike",
        version: "0.0.0",
        api: 1,
        capabilities: ["lua", "commands", "ui"],
      }),
    ).toEqual({ reason: "lua capability requires entry" });

    expect(
      validateExtensionManifest({
        id: "local.contract-lua-notify",
        name: "Spike",
        version: "0.0.0",
        api: 1,
        capabilities: ["commands", "ui"],
        entry: "entry.lua",
      }),
    ).toEqual({ reason: "entry requires the lua capability" });
  });

  test("rejects declarative commands on lua packs", () => {
    expect(
      validateExtensionManifest({
        id: "local.contract-lua-notify",
        name: "Spike",
        version: "0.0.0",
        api: 1,
        capabilities: ["lua", "commands", "ui"],
        entry: "entry.lua",
        commands: [{ id: "ping", title: "Ping", action: "notify", message: "x" }],
      }),
    ).toEqual({ reason: "lua packs register commands from entry.lua, not the manifest" });
  });

  test("rejects traversal and drive-letter entry paths at validation", () => {
    const base = {
      id: "local.contract-lua-notify",
      name: "Spike",
      version: "0.0.0",
      api: 1,
      capabilities: ["lua", "commands", "ui"],
    } as const;
    for (const entry of ["../outside.lua", "foo/../../x.lua", "./entry.lua", "C:/Windows/x.lua"]) {
      expect(validateExtensionManifest({ ...base, entry })).toEqual({
        reason: "entry must be a relative .lua source file",
      });
    }
    expect(validateExtensionManifest({ ...base, entry: "subdir/entry.lua" })).toHaveProperty(
      "manifest",
    );
  });
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
    // Bytecode path blocked: load is nil; string.dump cleared.
    await expect(
      engine.doString("local f=function() return 1 end; return string.dump(f)"),
    ).rejects.toBeDefined();
    engine.global.close();
  });
});

describe("lua registration and invocation", () => {
  test("notify fixture loads, registers namespaced command, and notifies", async () => {
    const root = await tempExtensionsRoot("ok");
    const pack = join(root, "local.contract-lua-notify");
    await cp(NOTIFY_FIXTURE, pack, { recursive: true });

    const registered = await loadPack(pack);
    expect(registered).toHaveLength(1);
    expect(registered[0]?.namespacedId).toBe("local.contract-lua-notify.ping");

    const result = await invokeLuaExtensionCommand("local.contract-lua-notify.ping");
    expect(result).toEqual({ ok: true, notifications: ["pong"] });
  });

  test("malformed Lua fails cleanly with no partial registrations", async () => {
    const root = await tempExtensionsRoot("bad");
    const pack = await writePack(
      root,
      "local.contract-lua-bad",
      luaManifest("local.contract-lua-bad"),
      {
        "entry.lua": `
commands.register({ id = "one", title = "One", run = function() end })
error("boom after register")
`,
      },
    );

    await expect(loadPack(pack)).rejects.toBeDefined();
    expect(findLuaCommand("local.contract-lua-bad.one")).toBeNull();
    expect(listLuaCommandsForExtension("local.contract-lua-bad")).toEqual([]);
    expect(pendingLuaCommandCount()).toBe(0);
  });

  test("one failed Lua pack does not stop a valid neighbor", async () => {
    const userData = join(await tempExtensionsRoot("iso"), "userData");
    const extensions = join(userData, "extensions");
    await mkdir(extensions, { recursive: true });
    await writePack(extensions, "local.contract-lua-bad", luaManifest("local.contract-lua-bad"), {
      "entry.lua": "error('fail')",
    });
    await cp(NOTIFY_FIXTURE, join(extensions, "local.contract-lua-notify"), { recursive: true });

    configureExtensionDiscovery(userData);
    const result = await discoverExtensions();
    expect(result.failed.some((entry) => entry.id === "local.contract-lua-bad")).toBe(true);
    expect(result.loaded.some((entry) => entry.id === "local.contract-lua-notify")).toBe(true);
    expect(
      result.loaded.find((entry) => entry.id === "local.contract-lua-notify")?.commands,
    ).toEqual([
      {
        id: "ping",
        namespacedId: "local.contract-lua-notify.ping",
        title: "Lua Ping",
        action: "lua",
      },
    ]);
  });

  test("duplicate command ids are rejected and leave no commit", async () => {
    const root = await tempExtensionsRoot("dup");
    const pack = await writePack(
      root,
      "local.contract-lua-dup",
      luaManifest("local.contract-lua-dup"),
      {
        "entry.lua": `
commands.register({ id = "ping", title = "A", run = function() end })
commands.register({ id = "ping", title = "B", run = function() end })
`,
      },
    );
    await expect(loadPack(pack)).rejects.toBeDefined();
    expect(findLuaCommand("local.contract-lua-dup.ping")).toBeNull();
  });

  test("ui.notify rejects oversized messages", async () => {
    const root = await tempExtensionsRoot("notify");
    const oversized = "x".repeat(LUA_EXTENSION_LIMITS.maxNotifyMessageChars.value + 1);
    const pack = await writePack(
      root,
      "local.contract-lua-big",
      luaManifest("local.contract-lua-big"),
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
    const result = await invokeLuaExtensionCommand("local.contract-lua-big.ping");
    expect(result.ok).toBe(false);
  });

  test("arbitrary host.call bridge is not present", async () => {
    const root = await tempExtensionsRoot("hostcall");
    const pack = await writePack(
      root,
      "local.contract-lua-host",
      luaManifest("local.contract-lua-host"),
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
    const result = await invokeLuaExtensionCommand("local.contract-lua-host.ping");
    expect(result).toEqual({ ok: true, notifications: [] });
  });
});

describe("lua execution and memory budgets", () => {
  test("resolves wasmoon glue.wasm from the package", () => {
    const path = resolveWasmoonGlueWasmPath();
    expect(existsSync(path)).toBe(true);
    expect(path.endsWith("glue.wasm")).toBe(true);
  });

  test("documents enforced resource limits", () => {
    expect(LUA_EXTENSION_LIMITS.maxSourceBytes.status).toBe("implemented");
    expect(LUA_EXTENSION_LIMITS.maxCommandsPerExtension.status).toBe("implemented");
    expect(LUA_EXTENSION_LIMITS.maxNotifyMessageChars.status).toBe("implemented");
    expect(LUA_EXTENSION_LIMITS.maxWasmMemoryBytes.status).toBe("implemented");
    expect(LUA_EXTENSION_LIMITS.maxExecutionMs.status).toBe("implemented");
    expect(LUA_EXTENSION_LIMITS.maxWasmMemoryBytes.value).toBeGreaterThan(0);
    expect(LUA_EXTENSION_LIMITS.maxExecutionMs.value).toBeGreaterThan(0);
  });

  test("interrupts infinite loop during load and leaves no partial registrations", async () => {
    setLuaExecutionBudgetForTests(100);
    const root = await tempExtensionsRoot("loop-load");
    const pack = await writePack(
      root,
      "local.contract-lua-loop",
      luaManifest("local.contract-lua-loop"),
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
    expect(findLuaCommand("local.contract-lua-loop.one")).toBeNull();
    expect(pendingLuaCommandCount()).toBe(0);
  });

  test("interrupts infinite loop during command invoke; host stays usable", async () => {
    setLuaExecutionBudgetForTests(100);
    const root = await tempExtensionsRoot("loop-run");
    const good = await writePack(
      root,
      "local.contract-lua-good",
      luaManifest("local.contract-lua-good"),
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
      "local.contract-lua-loopcmd",
      luaManifest("local.contract-lua-loopcmd"),
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
    const hung = await invokeLuaExtensionCommand("local.contract-lua-loopcmd.hang");
    expect(hung).toEqual({ ok: false, error: "execution limit exceeded" });
    expect(Date.now() - started).toBeLessThan(2_000);

    const recovered = await invokeLuaExtensionCommand("local.contract-lua-good.ping");
    expect(recovered).toEqual({ ok: true, notifications: ["ok"] });
  });

  test("valid -> infinite-loop load -> valid discovery isolation", async () => {
    setLuaExecutionBudgetForTests(100);
    const userData = join(await tempExtensionsRoot("loop-iso"), "userData");
    const extensions = join(userData, "extensions");
    await mkdir(extensions, { recursive: true });
    await writePack(extensions, "local.contract-lua-a", luaManifest("local.contract-lua-a"), {
      "entry.lua": `
commands.register({ id = "a", title = "A", run = function() ui.notify("a") end })
`,
    });
    await writePack(extensions, "local.contract-lua-loop", luaManifest("local.contract-lua-loop"), {
      "entry.lua": "while true do end",
    });
    await writePack(extensions, "local.contract-lua-b", luaManifest("local.contract-lua-b"), {
      "entry.lua": `
commands.register({ id = "b", title = "B", run = function() ui.notify("b") end })
`,
    });

    configureExtensionDiscovery(userData);
    const result = await discoverExtensions();
    expect(result.loaded.map((pack) => pack.id).sort()).toEqual([
      "local.contract-lua-a",
      "local.contract-lua-b",
    ]);
    expect(result.failed.some((failure) => failure.id === "local.contract-lua-loop")).toBe(true);
    expect(result.failed.find((failure) => failure.id === "local.contract-lua-loop")?.reason).toBe(
      "execution limit exceeded",
    );

    expect(await invokeLuaExtensionCommand("local.contract-lua-a.a")).toEqual({
      ok: true,
      notifications: ["a"],
    });
    expect(await invokeLuaExtensionCommand("local.contract-lua-b.b")).toEqual({
      ok: true,
      notifications: ["b"],
    });
  });

  test("memory limit fails controlled and leaves no partial registrations", async () => {
    setLuaMemoryBudgetForTests(256 * 1024);
    setLuaExecutionBudgetForTests(5_000);
    const root = await tempExtensionsRoot("oom");
    const pack = await writePack(
      root,
      "local.contract-lua-oom",
      luaManifest("local.contract-lua-oom"),
      {
        "entry.lua": `
commands.register({ id = "one", title = "One", run = function() end })
local t = {}
for i = 1, 1000000 do
  t[i] = string.rep("x", 1024)
end
`,
      },
    );
    await expect(loadPack(pack)).rejects.toMatchObject({
      reason: "memory limit exceeded",
    });
    expect(findLuaCommand("local.contract-lua-oom.one")).toBeNull();
    expect(pendingLuaCommandCount()).toBe(0);
  });

  test("memory failure during load does not block a later valid extension", async () => {
    setLuaMemoryBudgetForTests(256 * 1024);
    setLuaExecutionBudgetForTests(5_000);
    const userData = join(await tempExtensionsRoot("oom-iso"), "userData");
    const extensions = join(userData, "extensions");
    await mkdir(extensions, { recursive: true });
    await writePack(extensions, "local.contract-lua-oom", luaManifest("local.contract-lua-oom"), {
      "entry.lua": `
local t = {}
for i = 1, 1000000 do
  t[i] = string.rep("x", 1024)
end
`,
    });
    await writePack(extensions, "local.contract-lua-ok", luaManifest("local.contract-lua-ok"), {
      "entry.lua": `
commands.register({ id = "ping", title = "Ping", run = function() ui.notify("alive") end })
`,
    });

    configureExtensionDiscovery(userData);
    const result = await discoverExtensions();
    expect(result.failed.some((failure) => failure.id === "local.contract-lua-oom")).toBe(true);
    expect(result.loaded.some((pack) => pack.id === "local.contract-lua-ok")).toBe(true);
    expect(await invokeLuaExtensionCommand("local.contract-lua-ok.ping")).toEqual({
      ok: true,
      notifications: ["alive"],
    });
  });

  test("normal script completes under the hardened engine", async () => {
    setLuaExecutionBudgetForTests(500);
    const engine = await createHardenedLuaEngine();
    try {
      await runLuaSourceWithBudget(engine, "return 2 + 2");
    } finally {
      engine.global.close();
    }
  });
});
