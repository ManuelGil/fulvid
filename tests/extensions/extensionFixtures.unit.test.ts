import { describe, expect, test } from "bun:test";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const EXTENSIONS_ROOT = join(import.meta.dir, "../../extensions");

/** Permanent fixture set — keep small; do not recover deleted product-shaped packs. */
const PERMANENT_FIXTURE_IDS = ["local.capability-notify", "local.declarative-pack"] as const;

const ALLOWED_CAPABILITIES = new Set(["commands", "ui", "templates"]);
const ALLOWED_ACTIONS = new Set(["notify", "createUntitledFromTemplate"]);
const FORBIDDEN_MANIFEST_KEYS = new Set([
  "main",
  "entry",
  "script",
  "scripts",
  "lua",
  "wasm",
  "module",
  "loader",
  "sandbox",
  "permissions",
  "filesystem",
  "network",
  "process",
  "monaco",
]);

type FixtureManifest = {
  id: string;
  name: string;
  version: string;
  api: number;
  description: string;
  capabilities: string[];
  commands?: Array<{ id: string; title: string; action: string; [key: string]: unknown }>;
  templates?: Array<{ id: string; name: string; file: string }>;
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

// Intent: fixtures stay declarative architecture samples, never a plugin runtime.
// Growth boundary: add cases only when a new permanent fixture or capability contract lands.
describe("extension fixtures", () => {
  test("permanent set is exactly the two architectural fixtures", async () => {
    expect(await listFixtureDirs()).toEqual([...PERMANENT_FIXTURE_IDS]);
  });

  test("manifests declare only known capabilities and inert host actions", async () => {
    for (const id of PERMANENT_FIXTURE_IDS) {
      const raw = await readFile(join(EXTENSIONS_ROOT, id, "manifest.json"), "utf8");
      const manifest = JSON.parse(raw) as FixtureManifest;

      expect(manifest.id).toBe(id);
      expect(manifest.api).toBe(0);
      expect(Array.isArray(manifest.capabilities)).toBe(true);
      for (const capability of manifest.capabilities) {
        expect(ALLOWED_CAPABILITIES.has(capability)).toBe(true);
      }
      expect(manifest.capabilities).not.toContain("filesystem");
      expect(manifest.capabilities).not.toContain("network");
      expect(manifest.capabilities).not.toContain("process");

      for (const key of Object.keys(manifest)) {
        expect(FORBIDDEN_MANIFEST_KEYS.has(key)).toBe(false);
      }

      for (const command of manifest.commands ?? []) {
        expect(ALLOWED_ACTIONS.has(command.action)).toBe(true);
        expect(command).not.toHaveProperty("code");
        expect(command).not.toHaveProperty("script");
        expect(command).not.toHaveProperty("eval");
      }
    }
  });

  test("capability-notify reaches only notify and never filesystem or Monaco", async () => {
    const manifest = JSON.parse(
      await readFile(join(EXTENSIONS_ROOT, "local.capability-notify", "manifest.json"), "utf8"),
    ) as FixtureManifest;

    expect(manifest.capabilities.sort()).toEqual(["commands", "ui"]);
    expect(manifest.templates).toBeUndefined();
    expect(manifest.commands).toHaveLength(1);
    expect(manifest.commands?.[0]?.action).toBe("notify");
    expect(manifest.capabilities).not.toContain("monaco");
    expect(Object.keys(manifest)).not.toContain("monaco");

    const files = await collectFiles(join(EXTENSIONS_ROOT, "local.capability-notify"));
    expect(files).toEqual(["manifest.json"]);
  });

  test("declarative-pack seeds a Markdown template, not executable code", async () => {
    const root = join(EXTENSIONS_ROOT, "local.declarative-pack");
    const manifest = JSON.parse(
      await readFile(join(root, "manifest.json"), "utf8"),
    ) as FixtureManifest;

    expect(manifest.capabilities.sort()).toEqual(["commands", "templates"]);
    expect(manifest.commands?.[0]?.action).toBe("createUntitledFromTemplate");
    expect(manifest.templates?.[0]?.file).toBe("templates/sample.md");

    const files = await collectFiles(root);
    expect(files).toEqual(["manifest.json", "templates/sample.md"]);

    for (const relative of files) {
      expect(relative).not.toMatch(/\.(js|ts|mjs|cjs|lua|wasm|py)$/i);
    }

    const template = await readFile(join(root, "templates/sample.md"), "utf8");
    expect(template.startsWith("#")).toBe(true);
    expect(template).not.toMatch(/<\s*script/i);
    expect((await stat(join(root, "templates/sample.md"))).isFile()).toBe(true);
  });
});
