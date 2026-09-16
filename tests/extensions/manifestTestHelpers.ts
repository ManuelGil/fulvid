/**
 * Shared helpers for extension unit tests - valid publisher.name manifests.
 */
export function splitExtensionId(id: string): { publisher: string; name: string } {
  const dot = id.indexOf(".");
  if (dot <= 0 || dot === id.length - 1) {
    throw new Error(`invalid test extension id: ${id}`);
  }
  return { publisher: id.slice(0, dot), name: id.slice(dot + 1) };
}

/** Minimal valid Lua pack manifest for the given canonical id. */
export function luaManifest(
  id: string,
  capabilities: string[] = ["lua", "commands", "ui"],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const { publisher, name } = splitExtensionId(id);
  return {
    publisher,
    name,
    id,
    displayName: name,
    version: "1.0.0",
    api: 1,
    description: "Test extension pack",
    capabilities,
    entry: "entry.lua",
    ...extra,
  };
}
