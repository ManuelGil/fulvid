/**
 * Resource limits for the Lua/Wasm extension runtime. Fulvid enforces every
 * cap listed here. Not an OS sandbox.
 */
import { EXTENSION_PACK_LIMITS } from "../../../mainview/extensions/extensionManifest";

export const LUA_EXTENSION_LIMITS = {
  /** Maximum UTF-8 byte length of entry.lua source. */
  maxSourceBytes: { value: 64 * 1024 },
  /** Maximum commands one extension may register. */
  maxCommandsPerExtension: { value: 16 },
  /** Maximum UTF-16 code units for a registered command title (menu DTO). */
  maxCommandTitleChars: { value: 200 },
  /** Maximum UTF-16 code units accepted by ui.notify. */
  maxNotifyMessageChars: { value: EXTENSION_PACK_LIMITS.maxNotifyMessageChars },
  /** Maximum ui.notify calls accepted during one command invoke. */
  maxNotificationsPerInvoke: { value: 16 },
  /**
   * Wasm guest heap ceiling (bytes). Requires `traceAllocations: true` and
   * `setMemoryMax` on each engine. Exceeding fails with a controlled Lua
   * memory error ("not enough memory").
   */
  maxWasmMemoryBytes: { value: 8 * 1024 * 1024 },
  /**
   * Wall-clock budget for entry.lua load and for each command `run`.
   * Load uses wasmoon `Thread.run({ timeout })` (hooks interrupt a tight
   * `while true do end`). Command invoke relies on engine `functionTimeout`
   * (same hook path for Lua->JS callbacks). Not a Promise.race abandon.
   */
  maxExecutionMs: { value: 2_000 },
  /**
   * Max UTF-16 code units for editor.getSelection snapshot / replaceSelection.
   * Enforced on the renderer snapshot and again in the Lua bridge.
   */
  maxEditorSelectionChars: { value: 256 * 1024 },
  /**
   * Max UTF-16 code units for document.getText snapshot.
   * Enforced on the renderer snapshot and again in the Lua bridge.
   */
  maxDocumentTextChars: { value: 512 * 1024 },
  /** Max decoration ranges accepted by decorations.set in one invoke. */
  maxDecorationRanges: { value: 500 },
  /**
   * Max UTF-16 code units for document.createUntitled Markdown body.
   * Reuses the pack template body budget.
   */
  maxCreateUntitledChars: { value: EXTENSION_PACK_LIMITS.maxTemplateBytes },
  /** Max 1-based line/column accepted by document.reveal. */
  maxRevealPosition: { value: 1_000_000 },
} as const;

/** Test-only override for execution budget (null restores the default). */
let executionMsOverride: number | null = null;

export function setLuaExecutionBudgetForTests(ms: number | null): void {
  executionMsOverride = ms;
}

export function luaExecutionBudgetMs(): number {
  return executionMsOverride ?? LUA_EXTENSION_LIMITS.maxExecutionMs.value;
}

/** Test-only override for Wasm memory ceiling (null restores the default). */
let memoryBytesOverride: number | null = null;

export function setLuaMemoryBudgetForTests(bytes: number | null): void {
  memoryBytesOverride = bytes;
}

export function luaMemoryBudgetBytes(): number {
  return memoryBytesOverride ?? LUA_EXTENSION_LIMITS.maxWasmMemoryBytes.value;
}
