import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import {
  configureExtensionDiscovery,
  discoverExtensions,
  resetExtensionDiscoveryForTests,
} from "../../src/bun/extensions/discoverExtensions.ts";
import {
  validateExtensionManifest,
  namespacedExtensionCommandId,
} from "../../src/mainview/extensions/extensionManifest.ts";
import {
  configureExtensionHostActions,
  listExtensionCommands,
  listLoadedExtensions,
  resetExtensionRegistryForTests,
  runExtensionCommand,
  setDiscoveredExtensions,
} from "../../src/mainview/extensions/extensionRegistry.ts";

const REPO_FIXTURES = join(import.meta.dir, "../../extensions");

async function tempExtensionsRoot(label: string): Promise<string> {
  const root = join(tmpdir(), `fulvid-ext-${label}-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  return root;
}

async function writePack(
  root: string,
  id: string,
  manifest: unknown,
  files: Record<string, string> = {},
): Promise<void> {
  const pack = join(root, id);
  await mkdir(pack, { recursive: true });
  await writeFile(join(pack, "manifest.json"), JSON.stringify(manifest, null, 2));
  for (const [relative, content] of Object.entries(files)) {
    const target = join(pack, relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

afterEach(() => {
  resetExtensionDiscoveryForTests();
  resetExtensionRegistryForTests();
});

describe("extension manifest contract", () => {
  test("accepts a valid api 0 manifest", () => {
    const result = validateExtensionManifest({
      id: "local.capability-notify",
      name: "Notify",
      version: "1.0.0",
      api: 1,
      capabilities: ["commands"],
      commands: [{ id: "ping", title: "Ping", action: "notify", message: "hi" }],
    });
    expect("manifest" in result).toBe(true);
  });

  test("rejects an unsupported api version", () => {
    const result = validateExtensionManifest({
      id: "local.capability-notify",
      name: "Notify",
      version: "1.0.0",
      api: 2,
      capabilities: ["commands"],
    });
    expect(result).toEqual({ reason: "unsupported api version: 2" });
  });

  test("rejects an unknown capability", () => {
    const result = validateExtensionManifest({
      id: "local.capability-notify",
      name: "Notify",
      version: "1.0.0",
      api: 1,
      capabilities: ["monaco"],
    });
    expect(result).toEqual({ reason: "unknown capability: monaco" });
  });

  test("rejects an invalid extension id", () => {
    const result = validateExtensionManifest({
      id: "../escape",
      name: "Bad",
      version: "1.0.0",
      api: 1,
      capabilities: ["commands"],
    });
    expect(result).toEqual({ reason: "invalid extension id" });
  });
});

describe("extension discovery", () => {
  test("returns empty when the extensions directory has no packs", async () => {
    const root = await tempExtensionsRoot("empty");
    configureExtensionDiscovery(join(root, "userData"));
    const result = await discoverExtensions();
    expect(result.loaded).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  test("loads a valid pack and isolates a broken neighbor", async () => {
    const userData = join(await tempExtensionsRoot("iso"), "userData");
    const extensions = join(userData, "extensions");
    await mkdir(extensions, { recursive: true });
    await writePack(extensions, "local.good", {
      id: "local.good",
      name: "Good",
      version: "1.0.0",
      api: 1,
      capabilities: ["commands"],
      commands: [{ id: "ping", title: "Ping", action: "notify", message: "ok" }],
    });
    await writePack(extensions, "local.bad", {
      id: "local.bad",
      name: "Bad",
      version: "1.0.0",
      api: 1,
      capabilities: ["filesystem"],
    });
    await writePack(extensions, "local.also-good", {
      id: "local.also-good",
      name: "Also",
      version: "1.0.0",
      api: 1,
      capabilities: ["commands"],
      commands: [{ id: "ping", title: "Ping", action: "notify", message: "also" }],
    });

    configureExtensionDiscovery(userData);
    const result = await discoverExtensions();
    expect(result.loaded.map((pack) => pack.id).sort()).toEqual(["local.also-good", "local.good"]);
    expect(result.failed.some((failure) => failure.id === "local.bad")).toBe(true);
  });

  test("rejects a manifest id that does not match its directory", async () => {
    const userData = join(await tempExtensionsRoot("dup"), "userData");
    const extensions = join(userData, "extensions");
    await mkdir(extensions, { recursive: true });
    await writePack(extensions, "local.first", {
      id: "local.first",
      name: "First",
      version: "1.0.0",
      api: 1,
      capabilities: ["commands"],
      commands: [{ id: "ping", title: "A", action: "notify", message: "a" }],
    });
    await writePack(extensions, "local.second", {
      id: "local.first",
      name: "Second",
      version: "2.0.0",
      api: 1,
      capabilities: ["commands"],
      commands: [{ id: "ping", title: "B", action: "notify", message: "b" }],
    });

    configureExtensionDiscovery(userData);
    const result = await discoverExtensions();
    expect(result.loaded.map((pack) => pack.id)).toEqual(["local.first"]);
    expect(result.failed.some((failure) => failure.id === "local.second")).toBe(true);
  });

  test("fails closed on missing or malformed manifests without stopping discovery", async () => {
    const userData = join(await tempExtensionsRoot("miss"), "userData");
    const extensions = join(userData, "extensions");
    await mkdir(join(extensions, "local.missing"), { recursive: true });
    await mkdir(join(extensions, "local.malformed"), { recursive: true });
    await writeFile(join(extensions, "local.malformed", "manifest.json"), "{not-json");
    await writePack(extensions, "local.ok", {
      id: "local.ok",
      name: "Ok",
      version: "1.0.0",
      api: 1,
      capabilities: ["commands"],
      commands: [{ id: "ping", title: "Ping", action: "notify", message: "ok" }],
    });

    configureExtensionDiscovery(userData);
    const result = await discoverExtensions();
    expect(result.loaded.map((pack) => pack.id)).toEqual(["local.ok"]);
    expect(result.failed.map((failure) => failure.id).sort()).toEqual([
      "local.malformed",
      "local.missing",
    ]);
  });

  test("loads contained template Markdown and rejects traversal", async () => {
    const userData = join(await tempExtensionsRoot("tpl"), "userData");
    const extensions = join(userData, "extensions");
    await mkdir(extensions, { recursive: true });
    // A neighbor file that naive join(pack, "../secret.md") would read.
    await writeFile(join(extensions, "secret.md"), "# ESCAPED\n");
    await writePack(
      extensions,
      "local.safe",
      {
        id: "local.safe",
        name: "Safe",
        version: "1.0.0",
        api: 1,
        capabilities: ["templates", "commands"],
        templates: [{ id: "sample", name: "Sample", file: "templates/sample.md" }],
        commands: [
          {
            id: "createSample",
            title: "Create",
            action: "createUntitledFromTemplate",
            template: "sample",
          },
        ],
      },
      { "templates/sample.md": "# Hello {date}\n" },
    );
    await writePack(extensions, "local.escape", {
      id: "local.escape",
      name: "Escape",
      version: "1.0.0",
      api: 1,
      capabilities: ["templates", "commands"],
      templates: [{ id: "sample", name: "Sample", file: "../secret.md" }],
      commands: [
        {
          id: "createSample",
          title: "Create",
          action: "createUntitledFromTemplate",
          template: "sample",
        },
      ],
    });

    configureExtensionDiscovery(userData);
    const result = await discoverExtensions();
    expect(result.loaded.map((pack) => pack.id)).toEqual(["local.safe"]);
    expect(result.loaded[0]?.templates[0]?.content).toContain("# Hello");
    expect(result.loaded[0]?.templates[0]?.content).not.toContain("ESCAPED");
    const escapeFailure = result.failed.find((failure) => failure.id === "local.escape");
    expect(escapeFailure).toBeDefined();
    expect(escapeFailure?.reason).toMatch(/outside|invalid/i);
  });
});

describe("declarative host actions", () => {
  test("capability-notify and declarative-pack fixtures register through host actions", async () => {
    const userData = join(await tempExtensionsRoot("fix"), "userData");
    const extensions = join(userData, "extensions");
    await mkdir(extensions, { recursive: true });

    // Copy permanent fixtures into userData (production load path).
    for (const id of ["local.capability-notify", "local.declarative-pack"] as const) {
      const sourceManifest = await Bun.file(join(REPO_FIXTURES, id, "manifest.json")).text();
      await mkdir(join(extensions, id), { recursive: true });
      await writeFile(join(extensions, id, "manifest.json"), sourceManifest);
      if (id === "local.declarative-pack") {
        await mkdir(join(extensions, id, "templates"), { recursive: true });
        await writeFile(
          join(extensions, id, "templates", "blank-note.md"),
          await Bun.file(join(REPO_FIXTURES, id, "templates", "blank-note.md")).text(),
        );
      }
    }

    configureExtensionDiscovery(userData);
    const discovered = await discoverExtensions();
    expect(discovered.loaded.map((pack) => pack.id).sort()).toEqual([
      "local.capability-notify",
      "local.declarative-pack",
    ]);
    setDiscoveredExtensions(discovered);

    const notifications: string[] = [];
    const untitledBodies: string[] = [];
    configureExtensionHostActions({
      notify: (message) => notifications.push(message),
      createUntitled: (content) => {
        untitledBodies.push(content);
      },
    });

    expect(
      await runExtensionCommand(namespacedExtensionCommandId("local.capability-notify", "ping")),
    ).toBe(true);
    expect(notifications[0]).toContain("host notify");

    expect(
      await runExtensionCommand(
        namespacedExtensionCommandId("local.declarative-pack", "createBlankNote"),
      ),
    ).toBe(true);
    expect(untitledBodies).toHaveLength(1);
    expect(untitledBodies[0]).toContain("Date:");
    expect(untitledBodies[0]).not.toContain("{date}");
    expect(listExtensionCommands().every((command) => command.namespacedId.includes("."))).toBe(
      true,
    );
    expect(listLoadedExtensions()).toHaveLength(2);
  });

  test("does not execute Lua, JavaScript, or MDX from declarative packs", async () => {
    const userData = join(await tempExtensionsRoot("noexec"), "userData");
    const extensions = join(userData, "extensions");
    await mkdir(extensions, { recursive: true });
    await writePack(
      extensions,
      "local.pack",
      {
        id: "local.pack",
        name: "Pack",
        version: "1.0.0",
        api: 1,
        capabilities: ["templates", "commands"],
        templates: [{ id: "sample", name: "Sample", file: "templates/sample.md" }],
        commands: [
          {
            id: "createSample",
            title: "Create",
            action: "createUntitledFromTemplate",
            template: "sample",
          },
        ],
      },
      {
        "templates/sample.md":
          "# Body\n\n```lua\nprint(1)\n```\n\n<script>alert(1)</script>\n\nexport const x = 1;\n",
      },
    );

    configureExtensionDiscovery(userData);
    setDiscoveredExtensions(await discoverExtensions());
    const bodies: string[] = [];
    configureExtensionHostActions({
      notify: () => undefined,
      createUntitled: (content) => {
        bodies.push(content);
      },
    });
    await runExtensionCommand(namespacedExtensionCommandId("local.pack", "createSample"));
    // Source text is preserved as Markdown; nothing is evaluated as code.
    expect(bodies[0]).toContain("```lua");
    expect(bodies[0]).toContain("<script>");
    expect(bodies[0]).toContain("export const x");
  });
});
