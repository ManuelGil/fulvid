import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const EXTENSIONS_ROOT = join(import.meta.dir, "../../extensions");

/**
 * Production example packs under extensions/ (copy into userData/extensions).
 * Keep the set small; each pack demonstrates a durable first-release workflow.
 */
const PRODUCTION_EXAMPLE_IDS = [
  "local.blank-note",
  "local.host-notify",
  "local.sort-lines",
] as const;

const ALLOWED_CAPABILITIES = new Set([
  "commands",
  "ui",
  "lua",
  "editor",
  "document",
  "decorations",
]);
const FORBIDDEN_MANIFEST_KEYS = new Set([
  "main",
  "script",
  "scripts",
  "wasm",
  "module",
  "loader",
  "sandbox",
  "permissions",
  "filesystem",
  "network",
  "process",
  "monaco",
  "commands",
  "templates",
]);

type FixtureManifest = {
  id: string;
  name: string;
  version: string;
  api: number;
  description: string;
  capabilities: string[];
  entry?: string;
};

async function listFixtureDirs(): Promise<string[]> {
  const entries = await readdir(EXTENSIONS_ROOT, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("local."))
    .map((entry) => entry.name)
    .sort();
}

async function collectFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else {
        out.push(path.slice(root.length + 1).replaceAll("\\", "/"));
      }
    }
  }
  await walk(root);
  return out.sort();
}

describe("extension fixtures", () => {
  test("production example set is exactly the three first-release packs", async () => {
    expect(await listFixtureDirs()).toEqual([...PRODUCTION_EXAMPLE_IDS]);
  });

  test("manifests declare only known capabilities and Extension API v1", async () => {
    for (const id of PRODUCTION_EXAMPLE_IDS) {
      const raw = await readFile(join(EXTENSIONS_ROOT, id, "manifest.json"), "utf8");
      const manifest = JSON.parse(raw) as FixtureManifest;

      expect(manifest.id).toBe(id);
      expect(manifest.api).toBe(1);
      expect(Array.isArray(manifest.capabilities)).toBe(true);
      for (const capability of manifest.capabilities) {
        expect(ALLOWED_CAPABILITIES.has(capability)).toBe(true);
      }
      expect(manifest.capabilities).toContain("lua");
      expect(manifest.entry).toBe("entry.lua");
      expect(manifest.capabilities).not.toContain("filesystem");
      expect(manifest.capabilities).not.toContain("network");
      expect(manifest.capabilities).not.toContain("process");
      expect(manifest.capabilities).not.toContain("templates");

      for (const key of Object.keys(manifest)) {
        expect(FORBIDDEN_MANIFEST_KEYS.has(key)).toBe(false);
      }
    }
  });

  test("host-notify reaches only notify and never filesystem or Monaco", async () => {
    const manifest = JSON.parse(
      await readFile(join(EXTENSIONS_ROOT, "local.host-notify", "manifest.json"), "utf8"),
    ) as FixtureManifest;

    expect(manifest.capabilities.sort()).toEqual(["commands", "lua", "ui"]);
    expect(manifest.entry).toBe("entry.lua");
    expect(manifest.capabilities).not.toContain("monaco");
    expect(Object.keys(manifest)).not.toContain("monaco");

    const files = await collectFiles(join(EXTENSIONS_ROOT, "local.host-notify"));
    expect(files.sort()).toEqual(["README.md", "entry.lua", "manifest.json"]);

    const source = await readFile(join(EXTENSIONS_ROOT, "local.host-notify", "entry.lua"), "utf8");
    expect(source).toContain("ui.notify");
    expect(source).not.toContain("editor.");
    expect(source).not.toContain("document.");
  });

  test("blank-note seeds Markdown through document.createUntitled", async () => {
    const root = join(EXTENSIONS_ROOT, "local.blank-note");
    const manifest = JSON.parse(
      await readFile(join(root, "manifest.json"), "utf8"),
    ) as FixtureManifest;

    expect(manifest.capabilities.sort()).toEqual(["commands", "document", "lua", "ui"]);
    expect(manifest.entry).toBe("entry.lua");

    const files = await collectFiles(root);
    expect(files.sort()).toEqual(["README.md", "entry.lua", "manifest.json"]);

    const source = await readFile(join(root, "entry.lua"), "utf8");
    expect(source).toContain("document.createUntitled");
    expect(source).toContain("# Note");
    expect(source).not.toMatch(/<\s*script/i);
  });

  test("sort-lines is a source-only Lua editor example", async () => {
    const root = join(EXTENSIONS_ROOT, "local.sort-lines");
    const manifest = JSON.parse(
      await readFile(join(root, "manifest.json"), "utf8"),
    ) as FixtureManifest;

    expect(manifest.capabilities.sort()).toEqual(["commands", "editor", "lua", "ui"]);
    expect(manifest.entry).toBe("entry.lua");

    const files = await collectFiles(root);
    expect(files.sort()).toEqual(["README.md", "entry.lua", "manifest.json"]);

    const source = await readFile(join(root, "entry.lua"), "utf8");
    expect(source.startsWith("\u001bLua")).toBe(false);
    expect(source).toContain("editor.getSelection");
    expect(source).toContain("editor.replaceSelection");
    expect(source).toContain("table.sort");
  });

  test("all production examples are Lua entry packs", async () => {
    for (const id of PRODUCTION_EXAMPLE_IDS) {
      const files = await collectFiles(join(EXTENSIONS_ROOT, id));
      expect(files).toContain("entry.lua");
      expect(files.some((relative) => relative.endsWith(".js") || relative.endsWith(".ts"))).toBe(
        false,
      );
    }
  });
});
