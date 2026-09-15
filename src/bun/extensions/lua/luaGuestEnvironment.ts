/**
 * Reduce a wasmoon Lua 5.4 engine to the Fulvid extension guest surface.
 *
 * Wasm isolates guest memory from the host heap layout; this is NOT an OS
 * sandbox. Installed extensions remain a local trust decision.
 */
import type { LuaEngine } from "wasmoon";

/** Globals removed after standard libs open — no filesystem/process/module loading. */
export const LUA_GUEST_REMOVED_GLOBALS = [
  "io",
  "os",
  "package",
  "debug",
  "dofile",
  "loadfile",
  "load",
  "loadstring",
  "require",
  "string.dump",
] as const;

/**
 * Strip dangerous stdlib entry points. Keep math/string/table/basic for scripts.
 * `string.dump` is cleared so guests cannot produce bytecode even if `load` returned.
 */
export async function reduceLuaGuestEnvironment(engine: LuaEngine): Promise<void> {
  await engine.doString(`
    io = nil
    os = nil
    package = nil
    debug = nil
    dofile = nil
    loadfile = nil
    load = nil
    loadstring = nil
    require = nil
    if type(string) == "table" then
      string.dump = nil
    end
  `);
}

/** Probe helpers for Security Harness — return Lua `type(_G[name])`. */
export async function luaGlobalType(engine: LuaEngine, name: string): Promise<string> {
  const result = await engine.doString(`return type(_G[${JSON.stringify(name)}])`);
  return String(result);
}
