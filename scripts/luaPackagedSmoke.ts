/**
 * Packaged Electrobun gate for the Lua/Wasm extension runtime.
 *
 * Canary/stable Linux trees keep the app payload in Resources/*.tar.zst.
 * This smoke extracts that archive (when needed), confirms `bun/glue.wasm`
 * ships beside the host entry, instantiates wasmoon from those bytes, and
 * runs discovery + notify + isolation against a temp userData/extensions.
 *
 * Usage:
 *   bun run build:canary   # or release
 *   bun run smoke:lua-packaged
 */
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const root = join(import.meta.dir, "..");

function walkFiles(directory: string, into: string[], depth = 0): void {
  if (depth > 10 || !existsSync(directory)) {
    return;
  }
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walkFiles(path, into, depth + 1);
      continue;
    }
    if (stat.isFile()) {
      into.push(path);
    }
  }
}

function findFiles(rootDir: string, predicate: (path: string) => boolean): string[] {
  const files: string[] = [];
  walkFiles(rootDir, files);
  return files.filter(predicate);
}

function preferNewest(paths: string[]): string | null {
  if (paths.length === 0) {
    return null;
  }
  return paths
    .map((path) => ({ path, mtime: statSync(path).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0]!.path;
}

function extractTarZst(archive: string, destination: string): void {
  mkdirSyncRecursive(destination);
  // Prefer system zstd; Electrobun packages also ship zig-zstd beside launcher.
  const zstd = existsSync("/usr/bin/zstd")
    ? "/usr/bin/zstd"
    : findFiles(join(root, "build"), (path) => path.endsWith("/bin/zig-zstd"))[0];
  if (!zstd) {
    throw new Error("zstd not available to extract Electrobun Resources/*.tar.zst");
  }
  execFileSync("bash", ["-lc", `"${zstd}" -d -c "${archive}" | tar -x -C "${destination}"`], {
    stdio: "inherit",
  });
}

function mkdirSyncRecursive(path: string): void {
  if (!existsSync(path)) {
    execFileSync("mkdir", ["-p", path]);
  }
}

async function resolvePackagedGlueWasm(): Promise<{ gluePath: string; cleanup: string | null }> {
  const buildRoot = join(root, "build");
  const expanded = preferNewest(
    findFiles(buildRoot, (path) => path.replaceAll("\\", "/").endsWith("/bun/glue.wasm")),
  );
  if (expanded) {
    return { gluePath: expanded, cleanup: null };
  }

  const archives = findFiles(buildRoot, (path) => path.endsWith(".tar.zst"));
  const archive = preferNewest(archives);
  if (!archive) {
    throw new Error(
      "No packaged Fulvid tree found under build/. Run bun run build:canary (or release) first.",
    );
  }

  const extractRoot = await mkdtemp(join(tmpdir(), "fulvid-lua-extract-"));
  console.log(`lua packaged smoke: extracting ${archive}`);
  extractTarZst(archive, extractRoot);
  const gluePath = preferNewest(
    findFiles(extractRoot, (path) => path.replaceAll("\\", "/").endsWith("/bun/glue.wasm")),
  );
  if (!gluePath) {
    await rm(extractRoot, { recursive: true, force: true });
    throw new Error(
      `Extracted ${archive} but bun/glue.wasm is missing. Check electrobun.config copy for wasmoon.`,
    );
  }
  return { gluePath, cleanup: extractRoot };
}

async function main(): Promise<void> {
  const { gluePath, cleanup } = await resolvePackagedGlueWasm();
  console.log(`lua packaged smoke: glue.wasm → ${gluePath}`);

  const { LuaFactory } = await import("wasmoon");
  const { configureExtensionDiscovery, discoverExtensions, resetExtensionDiscoveryForTests } =
    await import("../src/bun/extensions/discoverExtensions.ts");
  const { invokeLuaExtensionCommand, resetLuaFactoryForTests } =
    await import("../src/bun/extensions/lua/luaExtensionRuntime.ts");
  const { resetLuaCommandStoreForTests } =
    await import("../src/bun/extensions/lua/luaCommandStore.ts");
  const { setLuaExecutionBudgetForTests } = await import("../src/bun/extensions/lua/luaLimits.ts");

  const factory = new LuaFactory(gluePath);
  const engine = await factory.createEngine({
    openStandardLibs: true,
    injectObjects: false,
    enableProxy: false,
    traceAllocations: true,
    functionTimeout: 500,
  });
  engine.global.setMemoryMax(1024 * 1024);
  const thread = engine.global.newThread();
  thread.loadString("return 40 + 2");
  const values = await thread.run(0, { timeout: 500 });
  if (Number(values[0]) !== 42) {
    throw new Error(`packaged Wasm engine returned unexpected value: ${String(values[0])}`);
  }
  engine.global.close();

  // Confirm the bundled host entry exists beside glue.wasm (no CDN path).
  const bundledHost = join(dirname(gluePath), "index.js");
  if (!existsSync(bundledHost)) {
    throw new Error(`packaged Bun host entry missing beside glue.wasm: ${bundledHost}`);
  }

  const userData = await mkdtemp(join(tmpdir(), "fulvid-lua-packaged-"));
  const extensions = join(userData, "extensions");
  await mkdir(extensions, { recursive: true });
  const fixture = join(root, "tests/extensions/fixtures/spike-lua-notify");
  await cp(fixture, join(extensions, "local.spike-lua-notify"), { recursive: true });
  await mkdir(join(extensions, "local.spike-lua-bad"), { recursive: true });
  await writeFile(
    join(extensions, "local.spike-lua-bad", "manifest.json"),
    JSON.stringify({
      id: "local.spike-lua-bad",
      name: "Bad",
      version: "0.0.0",
      api: 0,
      capabilities: ["lua", "commands", "ui"],
      entry: "entry.lua",
    }),
  );
  await writeFile(join(extensions, "local.spike-lua-bad", "entry.lua"), "error('packaged-bad')");

  setLuaExecutionBudgetForTests(null);
  resetLuaFactoryForTests();
  resetLuaCommandStoreForTests();
  resetExtensionDiscoveryForTests();
  configureExtensionDiscovery(userData);
  const discovery = await discoverExtensions();
  if (!discovery.loaded.some((pack) => pack.id === "local.spike-lua-notify")) {
    throw new Error("valid Lua fixture failed to load in packaged smoke");
  }
  if (!discovery.failed.some((failure) => failure.id === "local.spike-lua-bad")) {
    throw new Error("invalid Lua pack was not isolated in packaged smoke");
  }

  const invoke = await invokeLuaExtensionCommand("local.spike-lua-notify.ping");
  if (!invoke.ok || invoke.notifications[0] !== "pong") {
    throw new Error(`Lua ui.notify failed in packaged smoke: ${JSON.stringify(invoke)}`);
  }

  resetLuaCommandStoreForTests();
  resetLuaFactoryForTests();
  resetExtensionDiscoveryForTests();
  await rm(userData, { recursive: true, force: true });
  if (cleanup) {
    await rm(cleanup, { recursive: true, force: true });
  }

  console.log("lua packaged smoke: ok");
  console.log(`  wasm: ${dirname(gluePath)}`);
  console.log("  discovery + notify + isolation: passed");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
