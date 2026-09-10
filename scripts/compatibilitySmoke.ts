/**
 * Compatibility smoke for CI.
 *
 * Always:
 *   1. Confirm the Vite shell exists
 *   2. Run the real filesystem editing loop (create, read, write, scan)
 *
 * When FULVID_SMOKE_LAUNCH=1:
 *   3. Start the packaged Electrobun binary
 *   4. Confirm it stays up or hands off to a child
 *   5. Stop the process tree
 *
 * bun run smoke:compatibility
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const launchRequested = process.env.FULVID_SMOKE_LAUNCH === "1";
const launchMs = Number.parseInt(process.env.FULVID_SMOKE_LAUNCH_MS ?? "8000", 10);

function run(command: string, args: string[]): void {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

function verifyBuiltShell(): void {
  const indexPath = join(root, "dist/index.html");
  const assetsPath = join(root, "dist/assets");

  if (!existsSync(indexPath)) {
    throw new Error("dist/index.html is missing. Package or bun run build first.");
  }

  const html = readFileSync(indexPath, "utf8");
  if (!html.includes('type="module"')) {
    throw new Error("dist/index.html does not load the app shell as an ES module");
  }

  if (!existsSync(assetsPath) || !readdirSync(assetsPath).some((name) => name.endsWith(".js"))) {
    throw new Error("dist/assets has no bundled JavaScript");
  }
}

function walkFiles(directory: string, into: string[], depth = 0): void {
  if (depth > 6 || !existsSync(directory)) {
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

function resolveAppBinary(): string {
  const override = process.env.FULVID_SMOKE_BIN;
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`FULVID_SMOKE_BIN does not exist: ${override}`);
    }
    return override;
  }

  const known = [
    "build/stable-linux-x64/Fulvid/bin/launcher",
    "build/stable-win-x64/Fulvid/Fulvid.exe",
    "build/stable-win-x64/Fulvid/bin/Fulvid.exe",
    "build/stable-macos-arm64/Fulvid.app/Contents/MacOS/Fulvid",
    "build/stable-macos-x64/Fulvid.app/Contents/MacOS/Fulvid",
  ];

  for (const relative of known) {
    const path = join(root, relative);
    if (existsSync(path)) {
      return path;
    }
  }

  const found: string[] = [];
  walkFiles(join(root, "build"), found);
  const match = found.find((path) => {
    const normalized = path.replaceAll("\\", "/");
    return (
      normalized.endsWith("/bin/launcher") ||
      /\/Contents\/MacOS\/[^/]+$/.test(normalized) ||
      /\/Fulvid\.exe$/i.test(normalized)
    );
  });

  if (!match) {
    throw new Error("No packaged Fulvid binary under build/. Compatibility CI must package first.");
  }

  return match;
}

function leftoverProcesses(): string[] {
  try {
    if (process.platform === "win32") {
      const output = execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'Fulvid|launcher' } | ForEach-Object { $_.ProcessId.ToString() + ' ' + $_.Name }",
        ],
        { encoding: "utf8" },
      );
      return output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    }

    const output = execFileSync("ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8" });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(
        (line) => /Fulvid|\/launcher(\s|$)/i.test(line) && !line.includes("compatibilitySmoke"),
      );
  } catch {
    return [];
  }
}

function stopLeftovers(lines: string[]): void {
  for (const line of lines) {
    const pid = Number.parseInt(line, 10);
    if (!Number.isFinite(pid) || pid === process.pid) {
      continue;
    }
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
}

async function launchPackagedApp(): Promise<void> {
  const binary = resolveAppBinary();
  console.log(`  launching ${binary}\n`);

  const env = {
    ...process.env,
    WEBKIT_DISABLE_COMPOSITING_MODE: process.env.WEBKIT_DISABLE_COMPOSITING_MODE ?? "1",
  };

  const proc = Bun.spawn([binary], {
    cwd: root,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  await Bun.sleep(Number.isFinite(launchMs) ? Math.max(launchMs, 2000) : 8000);

  const stillRunning = proc.exitCode === null;
  if (stillRunning) {
    proc.kill();
    const code = await proc.exited;
    console.log(`  process stayed up and stopped (exit ${code ?? "signal"}).\n`);
    return;
  }

  if (proc.exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(
      `Packaged Fulvid exited ${proc.exitCode} before the smoke window elapsed.\n${stderr.slice(0, 4000)}`,
    );
  }

  const leftovers = leftoverProcesses();
  if (leftovers.length === 0) {
    throw new Error(
      "Launcher exited 0 immediately and no Fulvid child remained. The runtime did not stay loaded.",
    );
  }

  console.log("  launcher handed off to a child process; stopping leftovers.\n");
  stopLeftovers(leftovers);
  await Bun.sleep(500);
}

console.log("\nFulvid compatibility smoke\n");

console.log("-> Built shell\n");
verifyBuiltShell();
console.log("  dist/index.html and bundled assets look usable.\n");

console.log("-> Filesystem editing loop\n");
run("bun", ["test", "tests/bun/filesystem/io/documentLifecycle.smoke.test.ts"]);

if (launchRequested) {
  console.log("\n-> Packaged launch\n");
  await launchPackagedApp();
} else {
  console.log("\nFULVID_SMOKE_LAUNCH is not 1; skipping packaged launch.\n");
}

console.log("Compatibility smoke passed.\n");
