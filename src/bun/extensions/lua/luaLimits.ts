/**
 * Resource limits for the Phase 2 Lua/Wasm spike.
 *
 * Labels are honest: `implemented` means Fulvid enforces the cap;
 * `not enforceable in this spike` means wasmoon/Bun cannot stop the guest.
 */

export const LUA_SPIKE_LIMITS = {
  /** Maximum UTF-8 byte length of entry.lua source. */
  maxSourceBytes: { value: 64 * 1024, status: "implemented" as const },
  /** Maximum commands one extension may register. */
  maxCommandsPerExtension: { value: 16, status: "implemented" as const },
  /** Maximum UTF-16 code units accepted by ui.notify. */
  maxNotifyMessageChars: { value: 500, status: "implemented" as const },
  /**
   * Wasm heap cap. wasmoon exposes optional allocation tracing but not a hard
   * guest memory ceiling Fulvid can enforce without aborting the host.
   */
  maxWasmMemory: { status: "not enforceable in this spike" as const },
  /**
   * Execution budget / interrupt. wasmoon `functionTimeout` does not stop a
   * tight Lua loop (verified: infinite `while true do end` keeps running).
   * A Promise wrapper would only abandon the await — CPU would continue.
   */
  executionTimeout: { status: "not enforceable in this spike" as const },
} as const;

export type LuaLimitStatus = "implemented" | "not enforceable in this spike";
