/**
 * Compatibility smoke for CI.
 *
 * Always:
 *   1. Confirm the Vite shell exists
 *   2. Run the real filesystem editing loop (create, read, write, scan)
 *
 * When FULVID_SMOKE_LAUNCH=1:
 *   3. Start the packaged Electrobun binary for this platform
 *   4. Confirm the runtime stays loaded (same process or a live child)
 *   5. Stop the process tree
 *
 * Linux and Windows ship a self-extractor as the build-tree launcher.
 * It may install under the Electrobun per-user data dir and exit 0.
 * Exit 0 is not success unless a Fulvid process remains, or the installed
 * launcher itself stays up when started from its own directory.
 * Fulvid-Setup.exe is the installer artifact, not the runtime.
 *
 * bun run smoke:compatibility
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const root = join(import.meta.dir, "..");
const launchRequested = process.env.FULVID_SMOKE_LAUNCH === "1";
const launchMs = Number.parseInt(process.env.FULVID_SMOKE_LAUNCH_MS ?? "8000", 10);

type RuntimeTarget = {
  binary: string;
  installedBinary: string | null;
};

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

function firstExisting(paths: string[]): string | null {
  return paths.find((path) => existsSync(path)) ?? null;
}

function linuxInstalledLauncher(): string | null {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), ".local/share");
  return firstExisting([join(dataHome, "fulvid.imgil.dev", "stable", "app", "bin", "launcher")]);
}

function windowsInstalledLauncher(): string | null {
  const localAppData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  const appRoot = join(localAppData, "fulvid.imgil.dev", "stable", "app");
  return firstExisting([join(appRoot, "bin", "launcher.exe"), join(appRoot, "launcher.exe")]);
}

function isWindowsSetupArtifact(normalized: string): boolean {
  return /Fulvid-Setup\.exe$/i.test(normalized);
}

function isPackagedRuntime(normalized: string): boolean {
  if (isWindowsSetupArtifact(normalized)) {
    return false;
  }

  return (
    normalized.endsWith("/bin/launcher") ||
    /\/bin\/launcher\.exe$/i.test(normalized) ||
    /\/Contents\/MacOS\/[^/]+$/.test(normalized)
  );
}

function knownBuildBinaries(): string[] {
  if (process.platform === "win32") {
    return [
      "build/stable-win-x64/Fulvid/bin/launcher.exe",
      "build/stable-win-x64/Fulvid/launcher.exe",
    ];
  }

  if (process.platform === "darwin") {
    return [
      "build/stable-macos-arm64/Fulvid.app/Contents/MacOS/Fulvid",
      "build/stable-macos-x64/Fulvid.app/Contents/MacOS/Fulvid",
    ];
  }

  return ["build/stable-linux-x64/Fulvid/bin/launcher"];
}

function installedRuntimeForPlatform(): string | null {
  if (process.platform === "win32") {
    return windowsInstalledLauncher();
  }

  if (process.platform === "linux") {
    return linuxInstalledLauncher();
  }

  return null;
}

function resolveRuntimeForPlatform(): RuntimeTarget {
  const override = process.env.FULVID_SMOKE_BIN;
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`FULVID_SMOKE_BIN does not exist: ${override}`);
    }
    return { binary: override, installedBinary: installedRuntimeForPlatform() };
  }

  for (const relative of knownBuildBinaries()) {
    const path = join(root, relative);
    if (existsSync(path)) {
      return { binary: path, installedBinary: installedRuntimeForPlatform() };
    }
  }

  const found: string[] = [];
  walkFiles(join(root, "build"), found);
  const match = found.find((path) => isPackagedRuntime(path.replaceAll("\\", "/")));

  if (!match) {
    throw new Error("No packaged Fulvid binary under build/. Compatibility CI must package first.");
  }

  return { binary: match, installedBinary: installedRuntimeForPlatform() };
}

function isRuntimeLine(line: string): boolean {
  if (line.includes("compatibilitySmoke") || line.includes("smoke:compatibility")) {
    return false;
  }

  if (isWindowsSetupArtifact(line.replaceAll("\\", "/"))) {
    return false;
  }

  return (
    /fulvid\.imgil\.dev/i.test(line) ||
    /Resources[/\\]main\.js/.test(line) ||
    /[/\\]launcher(\.exe)?(\s|$)/i.test(line)
  );
}

function leftoverProcesses(): string[] {
  try {
    if (process.platform === "win32") {
      const output = execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          [
            "Get-CimInstance Win32_Process |",
            "Where-Object {",
            "  $name = [string]$_.Name;",
            "  $command = [string]$_.CommandLine;",
            "  if ($command -match 'compatibilitySmoke|smoke:compatibility') { return $false };",
            "  if ($name -match '^Fulvid-Setup\\.exe$') { return $false };",
            "  if ($name -match '^(launcher|Fulvid)\\.exe$') { return $true };",
            "  if ($name -eq 'bun.exe' -and $command -match 'fulvid\\.imgil\\.dev|Resources\\\\main\\.js') { return $true };",
            "  $command -match 'fulvid\\.imgil\\.dev'",
            "} |",
            "ForEach-Object { $_.ProcessId.ToString() + ' ' + $_.Name + ' ' + $_.CommandLine }",
          ].join(" "),
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
      .filter((line) => isRuntimeLine(line));
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

async function observeBinary(binary: string): Promise<{
  stayedUp: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}> {
  const env = {
    ...process.env,
    WEBKIT_DISABLE_COMPOSITING_MODE: process.env.WEBKIT_DISABLE_COMPOSITING_MODE ?? "1",
  };

  const proc = Bun.spawn([binary], {
    cwd: dirname(binary),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdoutText = new Response(proc.stdout).text();
  const stderrText = new Response(proc.stderr).text();

  await Bun.sleep(Number.isFinite(launchMs) ? Math.max(launchMs, 2000) : 8000);

  const stayedUp = proc.exitCode === null;
  if (stayedUp) {
    proc.kill();
    await proc.exited;
  }

  const [stdout, stderr] = await Promise.all([stdoutText, stderrText]);
  return { stayedUp, exitCode: proc.exitCode, stdout, stderr };
}

function dumpOutput(stdout: string, stderr: string): string {
  const parts = [
    stderr.trim() ? `stderr:\n${stderr.slice(0, 4000)}` : "",
    stdout.trim() ? `stdout:\n${stdout.slice(0, 4000)}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? `\n${parts.join("\n")}` : "";
}

async function launchPackagedApp(): Promise<void> {
  const { binary, installedBinary } = resolveRuntimeForPlatform();
  console.log(`  launching ${binary}\n`);

  const first = await observeBinary(binary);
  if (first.stayedUp) {
    console.log("  process stayed up and was stopped.\n");
    return;
  }

  if (first.exitCode !== 0) {
    throw new Error(
      `Packaged Fulvid exited ${first.exitCode} before the smoke window elapsed.${dumpOutput(first.stdout, first.stderr)}`,
    );
  }

  const leftovers = leftoverProcesses();
  if (leftovers.length > 0) {
    console.log("  launcher handed off to a child process; stopping leftovers.\n");
    stopLeftovers(leftovers);
    await Bun.sleep(500);
    return;
  }

  if (installedBinary && installedBinary !== binary) {
    console.log(`  extractor exited 0; launching installed runtime ${installedBinary}\n`);
    const second = await observeBinary(installedBinary);
    if (second.stayedUp) {
      console.log("  installed runtime stayed up and was stopped.\n");
      return;
    }

    if (second.exitCode !== 0) {
      throw new Error(
        `Installed Fulvid launcher exited ${second.exitCode} before the smoke window elapsed.${dumpOutput(second.stdout, second.stderr)}`,
      );
    }

    const installedLeftovers = leftoverProcesses();
    if (installedLeftovers.length > 0) {
      console.log("  installed launcher handed off to a child process; stopping leftovers.\n");
      stopLeftovers(installedLeftovers);
      await Bun.sleep(500);
      return;
    }

    throw new Error(
      `Installed launcher exited ${second.exitCode} and no Fulvid child remained.${dumpOutput(second.stdout, second.stderr)}`,
    );
  }

  throw new Error(
    `Launcher exited 0 immediately and no Fulvid child remained. The runtime did not stay loaded.${dumpOutput(first.stdout, first.stderr)}`,
  );
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
