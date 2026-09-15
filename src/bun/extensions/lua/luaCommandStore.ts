/**
 * Host-owned store for Lua-registered extension commands.
 *
 * Commands commit only after entry.lua finishes successfully. This is not a
 * second command bus - the renderer still dispatches through the extension
 * command seam and host RPC.
 */
import type { LuaEngine } from "wasmoon";

export type LuaRegisteredCommand = {
  extensionId: string;
  commandId: string;
  namespacedId: string;
  title: string;
  run: () => unknown;
};

type LuaExtensionSession = {
  engine: LuaEngine;
  commands: Map<string, LuaRegisteredCommand>;
  capabilities: readonly string[];
};

const sessions = new Map<string, LuaExtensionSession>();

/** Pending registrations for the extension currently loading (transaction). */
let pendingExtensionId: string | null = null;
let pendingCommands: LuaRegisteredCommand[] = [];
let pendingCapabilities: readonly string[] = [];
let registering = false;

export function beginLuaRegistration(
  extensionId: string,
  capabilities: readonly string[] = [],
): void {
  if (registering) {
    throw new Error("Lua registration reentrancy is not allowed");
  }
  registering = true;
  pendingExtensionId = extensionId;
  pendingCommands = [];
  pendingCapabilities = [...capabilities];
}

export function isLuaRegistering(): boolean {
  return registering;
}

export function queuePendingLuaCommand(command: LuaRegisteredCommand): void {
  if (!registering || pendingExtensionId !== command.extensionId) {
    throw new Error("Lua command registration outside an active load transaction");
  }
  pendingCommands.push(command);
}

export function pendingLuaCommandCount(): number {
  return pendingCommands.length;
}

export function commitLuaRegistration(engine: LuaEngine): readonly LuaRegisteredCommand[] {
  if (!registering || pendingExtensionId === null) {
    throw new Error("no Lua registration transaction to commit");
  }
  const extensionId = pendingExtensionId;
  const committed = [...pendingCommands];
  const commandMap = new Map<string, LuaRegisteredCommand>();
  for (const command of committed) {
    commandMap.set(command.namespacedId, command);
  }
  // Replace any prior session for this id (should not exist on fresh discovery).
  const prior = sessions.get(extensionId);
  if (prior) {
    try {
      prior.engine.global.close();
    } catch {
      // best-effort close
    }
  }
  sessions.set(extensionId, {
    engine,
    commands: commandMap,
    capabilities: pendingCapabilities,
  });
  pendingExtensionId = null;
  pendingCommands = [];
  pendingCapabilities = [];
  registering = false;
  return committed;
}

export function discardLuaRegistration(engine: LuaEngine | null): void {
  pendingExtensionId = null;
  pendingCommands = [];
  pendingCapabilities = [];
  registering = false;
  if (engine) {
    try {
      engine.global.close();
    } catch {
      // best-effort close
    }
  }
}

export function findLuaCommand(namespacedId: string): LuaRegisteredCommand | null {
  for (const session of sessions.values()) {
    const command = session.commands.get(namespacedId);
    if (command) {
      return command;
    }
  }
  return null;
}

export function listLuaCommandsForExtension(extensionId: string): readonly LuaRegisteredCommand[] {
  const session = sessions.get(extensionId);
  if (!session) {
    return [];
  }
  return [...session.commands.values()];
}

export function getLuaEngineForExtension(extensionId: string): LuaEngine | null {
  return sessions.get(extensionId)?.engine ?? null;
}

export function luaExtensionHasCapability(extensionId: string, capability: string): boolean {
  return sessions.get(extensionId)?.capabilities.includes(capability) ?? false;
}

/** Close all Lua sessions - used by tests and discovery reset. */
export function resetLuaCommandStoreForTests(): void {
  for (const session of sessions.values()) {
    try {
      session.engine.global.close();
    } catch {
      // ignore
    }
  }
  sessions.clear();
  pendingExtensionId = null;
  pendingCommands = [];
  pendingCapabilities = [];
  registering = false;
}
