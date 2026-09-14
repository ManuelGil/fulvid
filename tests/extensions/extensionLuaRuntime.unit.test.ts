import { afterEach, describe, expect, test } from "bun:test";
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
  invokeLuaExtensionCommand,
  loadLuaExtensionPack,
  resetLuaFactoryForTests,
} from "../../src/bun/extensions/lua/luaExtensionRuntime.ts";
import {
  reduceLuaGuestEnvironment,
  luaGlobalType,
} from "../../src/bun/extensions/lua/luaGuestEnvironment.ts";
import { LUA_SPIKE_LIMITS } from "../../src/bun/extensions/lua/luaLimits.ts";
import { LuaFactory } from "wasmoon";
import { validateExtensionManifest } from "../../src/mainview/extensions/extensionManifest.ts";

const SPIKE_FIXTURE = join(import.meta.dir, "fixtures/spike-lua-notify");

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

afterEach(() => {
  resetExtensionDiscoveryForTests();
  resetLuaCommandStoreForTests();
  resetLuaFactoryForTests();
});

describe("lua spike manifest contract", () => {
  test("accepts a lua pack with entry and required capabilities", () => {
    const result = validateExtensionManifest({
      id: "local.spike-lua-notify",
      name: "Spike",
      version: "0.0.0",
      api: 0,
      capabilities: ["lua", "commands", "ui"],
      entry: "entry.lua",
    });
    expect("manifest" in result).toBe(true);
  });

  test("rejects lua without entry and entry without lua", () => {
    expect(
      validateExtensionManifest({
        id: "local.spike-lua-notify",
        name: "Spike",
        version: "0.0.0",
        api: 0,
        capabilities: ["lua", "commands", "ui"],
      }),
    ).toEqual({ reason: "lua capability requires entry" });

    expect(
      validateExtensionManifest({
        id: "local.spike-lua-notify",
        name: "Spike",
        version: "0.0.0",
        api: 0,
        capabilities: ["commands", "ui"],
        entry: "entry.lua",
      }),
    ).toEqual({ reason: "entry requires the lua capability" });
  });

  test("rejects declarative commands on lua packs", () => {
    expect(
      validateExtensionManifest({
        id: "local.spike-lua-notify",
        name: "Spike",
        version: "0.0.0",
        api: 0,
        capabilities: ["lua", "commands", "ui"],
        entry: "entry.lua",
        commands: [{ id: "ping", title: "Ping", action: "notify", message: "x" }],
      }),
    ).toEqual({ reason: "lua packs register commands from entry.lua, not the manifest" });
  });
});

describe("lua spike guest environment", () => {
  test("dangerous stdlib globals are absent after reduction", async () => {
    const factory = new LuaFactory();
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

describe("lua spike registration and invocation", () => {
  test("spike fixture loads, registers namespaced command, and notifies", async () => {
    const root = await tempExtensionsRoot("ok");
    const pack = join(root, "local.spike-lua-notify");
    await cp(SPIKE_FIXTURE, pack, { recursive: true });

    const manifestRaw = JSON.parse(await readFile(join(pack, "manifest.json"), "utf8"));
    const validated = validateExtensionManifest(manifestRaw);
    expect("manifest" in validated).toBe(true);
    if (!("manifest" in validated)) {
      return;
    }

    const registered = await loadLuaExtensionPack(pack, validated.manifest);
    expect(registered).toHaveLength(1);
    expect(registered[0]?.namespacedId).toBe("local.spike-lua-notify.ping");

    const result = await invokeLuaExtensionCommand("local.spike-lua-notify.ping");
    expect(result).toEqual({ ok: true, notifications: ["pong"] });
  });

  test("malformed Lua fails cleanly with no partial registrations", async () => {
    const root = await tempExtensionsRoot("bad");
    const pack = await writePack(
      root,
      "local.spike-lua-bad",
      {
        id: "local.spike-lua-bad",
        name: "Bad",
        version: "0.0.0",
        api: 0,
        capabilities: ["lua", "commands", "ui"],
        entry: "entry.lua",
      },
      {
        "entry.lua": `
commands.register({ id = "one", title = "One", run = function() end })
error("boom after register")
`,
      },
    );

    const validated = validateExtensionManifest(
      JSON.parse(await readFile(join(pack, "manifest.json"), "utf8")),
    );
    expect("manifest" in validated).toBe(true);
    if (!("manifest" in validated)) {
      return;
    }

    await expect(loadLuaExtensionPack(pack, validated.manifest)).rejects.toBeDefined();
    expect(findLuaCommand("local.spike-lua-bad.one")).toBeNull();
    expect(listLuaCommandsForExtension("local.spike-lua-bad")).toEqual([]);
    expect(pendingLuaCommandCount()).toBe(0);
  });

  test("one failed Lua pack does not stop a valid neighbor", async () => {
    const userData = join(await tempExtensionsRoot("iso"), "userData");
    const extensions = join(userData, "extensions");
    await mkdir(extensions, { recursive: true });
    await writePack(
      extensions,
      "local.spike-lua-bad",
      {
        id: "local.spike-lua-bad",
        name: "Bad",
        version: "0.0.0",
        api: 0,
        capabilities: ["lua", "commands", "ui"],
        entry: "entry.lua",
      },
      { "entry.lua": "error('fail')" },
    );
    await cp(SPIKE_FIXTURE, join(extensions, "local.spike-lua-notify"), { recursive: true });

    configureExtensionDiscovery(userData);
    const result = await discoverExtensions();
    expect(result.failed.some((entry) => entry.id === "local.spike-lua-bad")).toBe(true);
    expect(result.loaded.some((entry) => entry.id === "local.spike-lua-notify")).toBe(true);
    expect(result.loaded.find((entry) => entry.id === "local.spike-lua-notify")?.commands).toEqual([
      {
        id: "ping",
        namespacedId: "local.spike-lua-notify.ping",
        title: "Lua Ping",
        action: "lua",
      },
    ]);
  });

  test("duplicate command ids are rejected and leave no commit", async () => {
    const root = await tempExtensionsRoot("dup");
    const pack = await writePack(
      root,
      "local.spike-lua-dup",
      {
        id: "local.spike-lua-dup",
        name: "Dup",
        version: "0.0.0",
        api: 0,
        capabilities: ["lua", "commands", "ui"],
        entry: "entry.lua",
      },
      {
        "entry.lua": `
commands.register({ id = "ping", title = "A", run = function() end })
commands.register({ id = "ping", title = "B", run = function() end })
`,
      },
    );
    const validated = validateExtensionManifest(
      JSON.parse(await readFile(join(pack, "manifest.json"), "utf8")),
    );
    if (!("manifest" in validated)) {
      throw new Error("expected manifest");
    }
    await expect(loadLuaExtensionPack(pack, validated.manifest)).rejects.toBeDefined();
    expect(findLuaCommand("local.spike-lua-dup.ping")).toBeNull();
  });

  test("ui.notify rejects oversized messages", async () => {
    const root = await tempExtensionsRoot("notify");
    const oversized = "x".repeat(LUA_SPIKE_LIMITS.maxNotifyMessageChars.value + 1);
    const pack = await writePack(
      root,
      "local.spike-lua-big",
      {
        id: "local.spike-lua-big",
        name: "Big",
        version: "0.0.0",
        api: 0,
        capabilities: ["lua", "commands", "ui"],
        entry: "entry.lua",
      },
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
    const validated = validateExtensionManifest(
      JSON.parse(await readFile(join(pack, "manifest.json"), "utf8")),
    );
    if (!("manifest" in validated)) {
      throw new Error("expected manifest");
    }
    await loadLuaExtensionPack(pack, validated.manifest);
    const result = await invokeLuaExtensionCommand("local.spike-lua-big.ping");
    expect(result.ok).toBe(false);
  });

  test("arbitrary host.call bridge is not present", async () => {
    const root = await tempExtensionsRoot("hostcall");
    const pack = await writePack(
      root,
      "local.spike-lua-host",
      {
        id: "local.spike-lua-host",
        name: "Host",
        version: "0.0.0",
        api: 0,
        capabilities: ["lua", "commands", "ui"],
        entry: "entry.lua",
      },
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
    const validated = validateExtensionManifest(
      JSON.parse(await readFile(join(pack, "manifest.json"), "utf8")),
    );
    if (!("manifest" in validated)) {
      throw new Error("expected manifest");
    }
    await loadLuaExtensionPack(pack, validated.manifest);
    const result = await invokeLuaExtensionCommand("local.spike-lua-host.ping");
    expect(result).toEqual({ ok: true, notifications: [] });
  });
});

describe("lua spike limit honesty", () => {
  test("documents which limits are implemented", () => {
    expect(LUA_SPIKE_LIMITS.maxSourceBytes.status).toBe("implemented");
    expect(LUA_SPIKE_LIMITS.maxCommandsPerExtension.status).toBe("implemented");
    expect(LUA_SPIKE_LIMITS.maxNotifyMessageChars.status).toBe("implemented");
    expect(LUA_SPIKE_LIMITS.maxWasmMemory.status).toBe("not enforceable in this spike");
    expect(LUA_SPIKE_LIMITS.executionTimeout.status).toBe("not enforceable in this spike");
  });
});
