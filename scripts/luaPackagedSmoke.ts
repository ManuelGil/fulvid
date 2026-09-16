/**
 * Packaged Electrobun smoke for the Lua/Wasm extension runtime.
 *
 * After a canary/stable Electrobun package under build/, this smoke:
 *   1. Locates bun/glue.wasm (expanded tree or Resources/*.tar.zst)
 *   2. Instantiates wasmoon from those packaged bytes (not CDN / not bare node_modules)
 *   3. Discovers a valid Lua fixture + an invalid neighbor under temp userData/extensions
 *   4. Invokes ui.notify and confirms isolation
 *   5. Probes execution interrupt + memory ceiling against the packaged Wasm module
 *
 * Usage (after packaging on this platform):
 *   bun run build:canary   # or packaging/{linux,windows,macos}/package.*
 *   bun run smoke:lua-packaged
 */
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
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

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function findZstdBinary(): string {
  const candidates = [
    process.platform === "win32" ? "C:\\Program Files\\zstd\\zstd.exe" : "",
    "/usr/bin/zstd",
    "/usr/local/bin/zstd",
    ...findFiles(join(root, "build"), (path) => {
      const normalized = normalizePath(path);
      return (
        normalized.endsWith("/bin/zig-zstd") ||
        normalized.endsWith("/bin/zig-zstd.exe") ||
        normalized.endsWith("/bin/zstd") ||
        normalized.endsWith("/bin/zstd.exe")
      );
    }),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["zstd"], {
    encoding: "utf8",
  });
  if (which.status === 0) {
    const first = which.stdout.trim().split(/\r?\n/)[0];
    if (first) {
      return first;
    }
  }

  throw new Error("zstd not available to extract Electrobun Resources/*.tar.zst");
}

function extractTarZst(archive: string, destination: string): void {
  mkdirSync(destination, { recursive: true });
  const zstd = findZstdBinary();
  // Two-step extract (no shell pipe): avoids Windows cmd.exe quoting failures on CI.
  // GitHub runners ship `tar` on win/mac/linux; zstd comes from PATH or the Electrobun tree.
  const tarPath = join(destination, "_fulvid-payload.tar");
  const decompress = spawnSync(zstd, ["-d", "-f", "-o", tarPath, archive], {
    stdio: "inherit",
  });
  if (decompress.status !== 0) {
    throw new Error(`failed to decompress ${archive} (exit ${String(decompress.status)})`);
  }
  const extract = spawnSync("tar", ["-xf", tarPath, "-C", destination], {
    stdio: "inherit",
  });
  try {
    unlinkSync(tarPath);
  } catch {
    // best-effort cleanup of the intermediate tar
  }
  if (extract.status !== 0) {
    throw new Error(`failed to extract ${archive} (exit ${String(extract.status)})`);
  }
}

async function resolvePackagedGlueWasm(): Promise<{ gluePath: string; cleanup: string | null }> {
  const buildRoot = join(root, "build");
  const expanded = preferNewest(
    findFiles(buildRoot, (path) => normalizePath(path).endsWith("/bun/glue.wasm")),
  );
  if (expanded) {
    return { gluePath: expanded, cleanup: null };
  }

  // Prefer in-app Resources payloads over top-level update bundles when both exist.
  const archives = findFiles(buildRoot, (path) => path.endsWith(".tar.zst"));
  const resourceArchives = archives.filter((path) => normalizePath(path).includes("/Resources/"));
  const archive = preferNewest(resourceArchives.length > 0 ? resourceArchives : archives);
  if (!archive) {
    throw new Error(
      "No packaged Fulvid tree found under build/. Package this platform first (build:canary or packaging/*/package.*).",
    );
  }

  const extractRoot = await mkdtemp(join(tmpdir(), "fulvid-lua-extract-"));
  console.log(`lua packaged smoke: extracting ${archive}`);
  extractTarZst(archive, extractRoot);
  const gluePath = preferNewest(
    findFiles(extractRoot, (path) => normalizePath(path).endsWith("/bun/glue.wasm")),
  );
  if (!gluePath) {
    await rm(extractRoot, { recursive: true, force: true });
    throw new Error(
      `Extracted ${archive} but bun/glue.wasm is missing. Check electrobun.config copy for wasmoon.`,
    );
  }
  return { gluePath, cleanup: extractRoot };
}

async function probePackagedBudgets(gluePath: string): Promise<void> {
  const { LuaFactory } = await import("wasmoon");
  const factory = new LuaFactory(gluePath);

  const timeoutEngine = await factory.createEngine({
    openStandardLibs: true,
    injectObjects: false,
    enableProxy: false,
    functionTimeout: 100,
    traceAllocations: true,
  });
  timeoutEngine.global.setMemoryMax(512 * 1024);
  const started = Date.now();
  try {
    const thread = timeoutEngine.global.newThread();
    thread.loadString("while true do end");
    await thread.run(0, { timeout: 100 });
    throw new Error("packaged interrupt probe completed without timeout");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/thread timeout exceeded/i.test(message)) {
      throw new Error(`packaged interrupt probe failed unexpectedly: ${message}`, { cause: error });
    }
  }
  if (Date.now() - started > 2_000) {
    throw new Error("packaged interrupt probe exceeded 2s recovery budget");
  }
  timeoutEngine.global.close();

  const memoryEngine = await factory.createEngine({
    openStandardLibs: true,
    injectObjects: false,
    enableProxy: false,
    functionTimeout: 5_000,
    traceAllocations: true,
  });
  memoryEngine.global.setMemoryMax(256 * 1024);
  try {
    await memoryEngine.doString(`
      local t = {}
      for i = 1, 1000000 do
        t[i] = string.rep("x", 1024)
      end
    `);
    throw new Error("packaged memory probe completed without OOM");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/not enough memory/i.test(message)) {
      throw new Error(`packaged memory probe failed unexpectedly: ${message}`, { cause: error });
    }
  }
  memoryEngine.global.close();
  console.log("  interrupt + memory budgets (packaged Wasm): passed");
}

async function main(): Promise<void> {
  const { gluePath, cleanup } = await resolvePackagedGlueWasm();
  console.log(`lua packaged smoke: glue.wasm -> ${gluePath}`);
  console.log(`lua packaged smoke: platform ${process.platform}/${process.arch}`);

  const { LuaFactory } = await import("wasmoon");
  const { configureExtensionDiscovery, discoverExtensions, resetExtensionDiscoveryForTests } =
    await import("../src/bun/extensions/discoverExtensions.ts");
  const { invokeLuaExtensionCommand, resetLuaCommandStoreForTests } =
    await import("../src/bun/extensions/lua/luaExtensionRuntime.ts");
  const { resetLuaFactoryForTests } = await import("../src/bun/extensions/lua/luaEngine.ts");
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

  const bundledHost = join(dirname(gluePath), "index.js");
  if (!existsSync(bundledHost)) {
    throw new Error(`packaged Bun host entry missing beside glue.wasm: ${bundledHost}`);
  }

  await probePackagedBudgets(gluePath);

  const userData = await mkdtemp(join(tmpdir(), "fulvid-lua-packaged-"));
  const extensions = join(userData, "extensions");
  await mkdir(extensions, { recursive: true });
  const fixture = join(root, "tests/extensions/fixtures/test.contract-lua-notify");
  await cp(fixture, join(extensions, "test.contract-lua-notify"), { recursive: true });
  await mkdir(join(extensions, "test.contract-lua-bad"), { recursive: true });
  await writeFile(
    join(extensions, "test.contract-lua-bad", "manifest.json"),
    JSON.stringify({
      publisher: "test",
      name: "contract-lua-bad",
      id: "test.contract-lua-bad",
      displayName: "Bad",
      description: "Packaged smoke isolation fixture",
      version: "0.0.0",
      api: 1,
      capabilities: ["lua", "commands", "ui"],
      entry: "entry.lua",
    }),
  );
  await writeFile(join(extensions, "test.contract-lua-bad", "entry.lua"), "error('packaged-bad')");

  setLuaExecutionBudgetForTests(null);
  resetLuaFactoryForTests();
  resetLuaCommandStoreForTests();
  resetExtensionDiscoveryForTests();
  configureExtensionDiscovery(userData);
  const discovery = await discoverExtensions();
  if (!discovery.loaded.some((pack) => pack.id === "test.contract-lua-notify")) {
    throw new Error("valid Lua fixture failed to load in packaged smoke");
  }
  if (!discovery.failed.some((failure) => failure.id === "test.contract-lua-bad")) {
    throw new Error("invalid Lua pack was not isolated in packaged smoke");
  }

  const invoke = await invokeLuaExtensionCommand("test.contract-lua-notify.ping");
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
