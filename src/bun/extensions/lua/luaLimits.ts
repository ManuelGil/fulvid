/**
 * Resource limits for the Lua/Wasm extension runtime (Phase 2.5 hardening).
 *
 * Labels are honest: `implemented` means Fulvid enforces the cap with an
 * observable failure. Wasm memory isolation and wasmoon thread hooks are
 * capability/resource controls — not an OS sandbox.
 */

export const LUA_SPIKE_LIMITS = {
  /** Maximum UTF-8 byte length of entry.lua source. */
  maxSourceBytes: { value: 64 * 1024, status: "implemented" as const },
  /** Maximum commands one extension may register. */
  maxCommandsPerExtension: { value: 16, status: "implemented" as const },
  /** Maximum UTF-16 code units accepted by ui.notify. */
  maxNotifyMessageChars: { value: 500, status: "implemented" as const },
  /**
   * Wasm guest heap ceiling (bytes). Requires `traceAllocations: true` and
   * `setMemoryMax` on each engine. Exceeding fails with a controlled Lua
   * memory error ("not enough memory").
   */
  maxWasmMemoryBytes: { value: 8 * 1024 * 1024, status: "implemented" as const },
  /**
   * Wall-clock budget for entry.lua load and for each command `run`.
   * Load uses wasmoon `Thread.run({ timeout })` (hooks interrupt a tight
   * `while true do end`). Command invoke relies on engine `functionTimeout`
   * (same hook path for Lua→JS callbacks). Not a Promise.race abandon.
   */
  maxExecutionMs: { value: 2_000, status: "implemented" as const },
} as const;

export type LuaLimitStatus = "implemented";

/** Test-only override for execution budget (null restores the default). */
let executionMsOverride: number | null = null;

export function setLuaExecutionBudgetForTests(ms: number | null): void {
  executionMsOverride = ms;
}

export function luaExecutionBudgetMs(): number {
  return executionMsOverride ?? LUA_SPIKE_LIMITS.maxExecutionMs.value;
}

/** Test-only override for Wasm memory ceiling (null restores the default). */
let memoryBytesOverride: number | null = null;

export function setLuaMemoryBudgetForTests(bytes: number | null): void {
  memoryBytesOverride = bytes;
}

export function luaMemoryBudgetBytes(): number {
  return memoryBytesOverride ?? LUA_SPIKE_LIMITS.maxWasmMemoryBytes.value;
}
