/**
 * Integration and runtime smoke checks for critical Fulvid flows.
 *
 * Runs real filesystem integration tests, verifies the built shell, and when a
 * display server is available launches the desktop app briefly on Linux.
 *
 * Run with: bun run smoke
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function run(command: string, args: string[]): void {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

function hasDisplay(): boolean {
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

function verifyBuiltShell(): void {
  const indexPath = join(root, "dist/index.html");
  const assetsPath = join(root, "dist/assets");

  if (!existsSync(indexPath)) {
    throw new Error("dist/index.html is missing - run bun run build first");
  }

  const html = readFileSync(indexPath, "utf8");
  if (!html.includes('type="module"')) {
    throw new Error("dist/index.html does not load the app shell as an ES module");
  }

  const assets = readdirSync(assetsPath);
  if (!assets.some((name) => name.endsWith(".js"))) {
    throw new Error("dist/assets has no bundled JavaScript");
  }
}

function waitForWindow(titlePattern: RegExp, timeoutMs: number): boolean {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    try {
      const output = execFileSync("wmctrl", ["-l"], { encoding: "utf8" });
      if (titlePattern.test(output)) {
        return true;
      }
    } catch {
      return false;
    }

    execFileSync("sleep", ["0.5"]);
  }

  return false;
}

async function launchDesktopSmoke(): Promise<void> {
  if (process.platform !== "linux") {
    console.log("Desktop launch smoke is Linux-only; skipping window check.\n");
    return;
  }

  if (!hasDisplay()) {
    console.log("No display server - skipping desktop launch smoke.\n");
    return;
  }

  try {
    execFileSync("wmctrl", ["-m"], { stdio: "ignore" });
  } catch {
    console.log("wmctrl unavailable - skipping desktop launch smoke.\n");
    return;
  }

  console.log("-> Desktop launch smoke\n");

  const proc = Bun.spawn(["bun", "x", "electrobun", "dev"], {
    cwd: root,
    stdout: "ignore",
    stderr: "ignore",
  });

  try {
    const opened = waitForWindow(/Fulvid/i, 30_000);
    if (!opened) {
      throw new Error("Fulvid window did not appear within 30 seconds");
    }
    console.log("  Fulvid window opened.\n");
  } finally {
    proc.kill();
    await proc.exited;
  }
}

console.log("\nFulvid smoke\n");

console.log("-> Integration tests\n");
run("bun", ["test", "tests/bun/filesystem/io/documentLifecycle.smoke.test.ts"]);

console.log("\n-> Built shell\n");
verifyBuiltShell();
console.log("  dist/index.html and bundled assets look usable.\n");

await launchDesktopSmoke();

console.log("Smoke passed.\n");
