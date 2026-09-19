/**
 * Shared helpers for extension unit tests - valid publisher.name manifests
 * and on-disk pack fixtures.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { loadLuaExtensionPack } from "../../src/bun/extensions/lua/luaExtensionRuntime.ts";
import { validateExtensionManifest } from "../../src/mainview/extensions/extensionManifest.ts";

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

export async function tempExtensionRoot(label: string): Promise<string> {
  const root = join(tmpdir(), `fulvid-ext-${label}-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  return root;
}

/** Write a pack under `root/<id>` and return the pack directory. */
export async function writeExtensionPack(
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

export async function loadValidatedLuaPack(pack: string) {
  const validated = validateExtensionManifest(
    JSON.parse(await readFile(join(pack, "manifest.json"), "utf8")),
  );
  if (!("manifest" in validated)) {
    throw new Error(validated.reason);
  }
  return loadLuaExtensionPack(pack, validated.manifest);
}
