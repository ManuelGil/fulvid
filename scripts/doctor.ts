/**
 * Environment check - one canonical implementation for every platform.
 *
 * Reports what a first run needs and what is missing. Reads only; it never
 * installs, downloads, or modifies the repository.
 *
 * Run with: bun run doctor
 */
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

type Status = "ok" | "warn" | "fail";

type Check = {
  name: string;
  status: Status;
  detail: string;
  fix?: string;
};

/** Bun version used by the release and validate workflows. */
const EXPECTED_BUN = "1.4.0";

/** Shared libraries the Linux webview binds at launch. */
const LINUX_LIBRARIES = [
  { file: "libwebkit2gtk-4.1.so.0", package: "libwebkit2gtk-4.1-0" },
  { file: "libgtk-3.so.0", package: "libgtk-3-0" },
  { file: "libsoup-3.0.so.0", package: "libsoup-3.0-0" },
  { file: "libdbusmenu-gtk3.so.4", package: "libdbusmenu-gtk3-4" },
];

const checks: Check[] = [];

function record(check: Check): void {
  checks.push(check);
}

/** Compare dotted numeric versions. Returns -1, 0, or 1. */
function compareVersions(left: string, right: string): number {
  const a = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = right.split(".").map((part) => Number.parseInt(part, 10) || 0);

  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }

  return 0;
}

function checkBun(): void {
  const version = Bun.version;
  const comparison = compareVersions(version, EXPECTED_BUN);

  if (comparison < 0) {
    record({
      name: "Bun",
      status: "warn",
      detail: `${version} (releases are built with ${EXPECTED_BUN})`,
      fix: "bun upgrade",
    });
    return;
  }

  record({ name: "Bun", status: "ok", detail: version });
}

function checkPlatform(): void {
  const supported = new Set(["linux", "darwin", "win32"]);
  const platform = process.platform;

  if (!supported.has(platform)) {
    record({
      name: "Platform",
      status: "fail",
      detail: `${platform} is not supported`,
      fix: "Use Linux, macOS, or Windows.",
    });
    return;
  }

  record({ name: "Platform", status: "ok", detail: `${platform} ${process.arch}` });
}

function checkDependencies(): void {
  if (!existsSync("node_modules/electrobun")) {
    record({
      name: "Dependencies",
      status: "fail",
      detail: "not installed",
      fix: "bun install",
    });
    return;
  }

  record({ name: "Dependencies", status: "ok", detail: "installed" });
}

/** The Vite build requires the project-local Electrobun 2 devkit projection. */
function checkRuntime(): void {
  const devkitConfig = ".hutch/devkit/api/config/electrobun-vite.ts";
  if (!existsSync(devkitConfig)) {
    record({
      name: "Electrobun devkit",
      status: "warn",
      detail: "not prepared - Vite aliases and desktop builds are unavailable",
      fix: "bun run prepare:electrobun",
    });
    return;
  }

  record({ name: "Electrobun devkit", status: "ok", detail: "prepared" });
}

function checkBuild(): void {
  if (!existsSync("dist/index.html")) {
    record({
      name: "Web build",
      status: "warn",
      detail: "dist/ is empty - the window would load nothing",
      fix: "bun run build (bun run dev does this for you)",
    });
    return;
  }

  record({ name: "Web build", status: "ok", detail: "dist/index.html present" });
}

/** Library names known to the dynamic linker, when ldconfig is available. */
function readLinkerCache(): string {
  try {
    return execFileSync("ldconfig", ["-p"], { encoding: "utf8" });
  } catch {
    return "";
  }
}

function checkLinuxLibraries(): void {
  if (process.platform !== "linux") {
    return;
  }

  const linkerCache = readLinkerCache();
  const searchPaths = [
    "/lib/x86_64-linux-gnu",
    "/usr/lib/x86_64-linux-gnu",
    "/usr/lib64",
    "/usr/lib",
    "/lib",
  ];

  const missing = LINUX_LIBRARIES.filter(({ file }) => {
    if (linkerCache.includes(file)) {
      return false;
    }
    return !searchPaths.some((directory) => existsSync(`${directory}/${file}`));
  });

  if (missing.length > 0) {
    record({
      name: "System libraries",
      status: "fail",
      detail: `missing ${missing.map(({ file }) => file).join(", ")}`,
      fix: `sudo apt install ${missing.map(({ package: name }) => name).join(" ")}`,
    });
    return;
  }

  record({
    name: "System libraries",
    status: "ok",
    detail: "GTK and WebKitGTK present",
  });
}

function checkDisplay(): void {
  if (process.platform !== "linux") {
    return;
  }

  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    record({
      name: "Display",
      status: "warn",
      detail: "no DISPLAY or WAYLAND_DISPLAY - a window cannot open",
      fix: "Run on a desktop session, or use xvfb-run for headless checks.",
    });
    return;
  }

  record({ name: "Display", status: "ok", detail: "display server available" });
}

checkBun();
checkPlatform();
checkDependencies();
checkRuntime();
checkBuild();
checkLinuxLibraries();
checkDisplay();

const symbols: Record<Status, string> = { ok: "ok  ", warn: "warn", fail: "FAIL" };
const width = Math.max(...checks.map((check) => check.name.length));

console.log("\nFulvid - environment check\n");

for (const check of checks) {
  console.log(`  [${symbols[check.status]}] ${check.name.padEnd(width)}  ${check.detail}`);
  if (check.fix) {
    console.log(`${" ".repeat(width + 11)}→ ${check.fix}`);
  }
}

const failed = checks.filter((check) => check.status === "fail");
const warned = checks.filter((check) => check.status === "warn");

console.log("");

if (failed.length > 0) {
  console.log(`${failed.length} blocking issue(s). Resolve them, then run: bun run dev\n`);
  process.exit(1);
}

if (warned.length > 0) {
  console.log(`Ready, with ${warned.length} warning(s). Start with: bun run dev\n`);
} else {
  console.log("Ready. Start with: bun run dev\n");
}
