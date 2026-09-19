/**
 * Hardened wasmoon engine with real timeouts and memory ceilings.
 * Wasm isolates guest memory from the host heap; this is not an OS sandbox.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { LuaFactory, LuaTimeoutError, type LuaEngine } from "wasmoon";

import { luaExecutionBudgetMs, luaMemoryBudgetBytes } from "./luaLimits";

const requireWasmoonAsset = createRequire(import.meta.url);

let sharedFactory: LuaFactory | null = null;

/**
 * Strip io/os/package/load/require and string.dump after standard libs open.
 *
 * `pcall` and `xpcall` go with them. The execution budget is delivered as an
 * ordinary Lua error by wasmoon's instruction hook, so guest code that can
 * catch errors can catch the budget too: `while true do pcall(function() while
 * true do end end) end` never returns, and because `resume` runs synchronously
 * inside Wasm it pins the host process with no timer able to preempt it. With
 * no way to catch the interrupt, the budget is the ceiling it claims to be.
 * A command that fails still reports through the invoke failure contract.
 */
async function reduceLuaGuestEnvironment(engine: LuaEngine): Promise<void> {
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
    pcall = nil
    xpcall = nil
    if type(string) == "table" then
      string.dump = nil
    end
  `);
}

/** Probe helpers for Security Harness - return Lua `type(_G[name])`. */
export async function luaGlobalType(engine: LuaEngine, name: string): Promise<string> {
  const result = await engine.doString(`return type(_G[${JSON.stringify(name)}])`);
  return String(result);
}

/**
 * Resolve glue.wasm for Bun host + Electrobun packages.
 * Packaged builds copy the file beside the bundled entry (`Resources/app/bun/`).
 * Dev/tests fall back to the wasmoon package file.
 */
export function resolveWasmoonGlueWasmPath(): string {
  // Packaged Electrobun: glue.wasm is copied beside Resources/app/bun/index.js.
  // Dev/tests: this module lives under src/.../lua/, so fall through to the package.
  const besideEntry = join(import.meta.dir, "glue.wasm");
  if (existsSync(besideEntry)) {
    return besideEntry;
  }
  const fromPackage = requireWasmoonAsset.resolve("wasmoon/dist/glue.wasm");
  if (existsSync(fromPackage)) {
    return fromPackage;
  }
  throw new Error("wasmoon glue.wasm not found (dev package or packaged bun/ copy)");
}

function luaFactory(): LuaFactory {
  if (!sharedFactory) {
    sharedFactory = new LuaFactory(resolveWasmoonGlueWasmPath());
  }
  return sharedFactory;
}

/** Test hook: drop cached factory (engines already closed via command store). */
export function resetLuaFactoryForTests(): void {
  sharedFactory = null;
}

export function isLuaTimeoutError(error: unknown): boolean {
  return (
    error instanceof LuaTimeoutError ||
    (error instanceof Error && /thread timeout exceeded/i.test(error.message))
  );
}

export function isLuaMemoryError(error: unknown): boolean {
  return error instanceof Error && /not enough memory/i.test(error.message);
}

export function describeLuaRuntimeFailure(error: unknown): string {
  if (isLuaTimeoutError(error)) {
    return "execution limit exceeded";
  }
  if (isLuaMemoryError(error)) {
    return "memory limit exceeded";
  }
  // Bound guest failures: first line only - no traceback / source dump.
  const raw = error instanceof Error ? error.message : "lua runtime failed";
  const firstLine = raw.split(/\r?\n/, 1)[0]?.trim() || "lua runtime failed";
  // wasmoon embeds the chunk text as [string "..."]:line: message - drop the source.
  const withoutChunk = firstLine.replace(/^\[string "[\s\S]*"\]:(\d+):\s*/, "lua:$1: ");
  const bounded = withoutChunk.trim() || "lua runtime failed";
  return bounded.length > 300 ? `${bounded.slice(0, 300)}...` : bounded;
}

/** Create a reduced guest engine with real execution and memory budgets. */
export async function createHardenedLuaEngine(): Promise<LuaEngine> {
  const budgetMs = luaExecutionBudgetMs();
  const engine = await luaFactory().createEngine({
    openStandardLibs: true,
    injectObjects: false,
    enableProxy: false,
    traceAllocations: true,
    functionTimeout: budgetMs,
  });
  engine.global.setMemoryMax(luaMemoryBudgetBytes());
  await reduceLuaGuestEnvironment(engine);
  return engine;
}

/**
 * Run Lua source under a real wasmoon thread timeout (interrupts tight loops).
 * Prefer this over `engine.doString` for untrusted entry.lua.
 */
export async function runLuaSourceWithBudget(engine: LuaEngine, source: string): Promise<void> {
  const thread = engine.global.newThread();
  thread.loadString(source);
  await thread.run(0, { timeout: luaExecutionBudgetMs() });
}
