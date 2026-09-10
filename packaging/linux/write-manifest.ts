/**
 * Write a Linux release-manifest.json. Used only by packaging/linux/release.sh.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [output, version, signedFlag, timestamp, commit, tag, describe, ...hashedNames] =
  process.argv.slice(2);

if (!output || !version || hashedNames.length === 0) {
  console.error(
    "usage: write-manifest.ts OUTPUT VERSION SIGNED TIMESTAMP COMMIT TAG DESCRIBE FILE...",
  );
  process.exit(1);
}

const signed = signedFlag === "1";
const artifactsDir = dirname(output);
const root = join(import.meta.dir, "..", "..");
const electrobun =
  (
    JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      devDependencies?: { electrobun?: string };
    }
  ).devDependencies?.electrobun ?? "";

function toolVersion(command: string, args: string[]): string {
  try {
    return (
      execFileSync(command, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).split("\n")[0] ?? ""
    );
  } catch {
    return "";
  }
}

function sha256File(path: string): string {
  return createHash("sha256")
    .update(new Uint8Array(readFileSync(path)))
    .digest("hex");
}

function roleOf(name: string): string {
  if (name.endsWith(".deb")) return "deb";
  if (name.includes("-Setup.")) return "installer";
  if (name.endsWith(".tar.zst")) return "bundle";
  if (name.endsWith("-update.json")) return "update";
  if (name === "build.log") return "log";
  return "artifact";
}

const payloads = hashedNames.map((name) => {
  const path = join(artifactsDir, name);
  const st = statSync(path);
  return {
    name,
    role: roleOf(name),
    size_bytes: st.size,
    sha256: sha256File(path),
  };
});

const primary = payloads.find((item) => item.role === "deb");
if (!primary) {
  console.error("release set is missing the canonical .deb");
  process.exit(1);
}

const signatures = signed
  ? [
      ...hashedNames
        .filter((name) => name.endsWith(".deb") || name.includes("-Setup."))
        .map((name) => `${name}.asc`),
      "SHA256SUMS.asc",
    ]
  : [];

const artifacts = [...hashedNames, "release-manifest.json", "SHA256SUMS", ...signatures].sort(
  (a, b) => a.localeCompare(b),
);

const fingerprint = "0AFF5507884548626087F84A5E1E335B601FB44B";

const manifest = {
  schema: 1,
  project: "fulvid",
  version,
  platform: "linux",
  architecture: "linux-x64",
  package: {
    filename: primary.name,
    format: "deb",
    architecture: "linux-x64",
    size_bytes: primary.size_bytes,
    sha256: primary.sha256,
  },
  payloads,
  build_timestamp: timestamp,
  git: { commit: commit ?? "", tag: tag ?? "", describe: describe ?? "" },
  tool_versions: {
    bun: toolVersion("bun", ["--version"]),
    electrobun,
    gpg: toolVersion("gpg", ["--version"]),
    "dpkg-deb": toolVersion("dpkg-deb", ["--version"]),
  },
  results: {
    package: "PASS",
    signing: signed ? "PASS" : "SKIPPED",
  },
  signing: {
    pgp: {
      enabled: signed,
      status: signed ? "PASS" : "SKIPPED",
      fingerprint: signed ? fingerprint : "",
      verification: signed ? "verified" : "skipped",
    },
    platform_native: {
      mechanism: "debian-debsign",
      status: "not-applied",
      note: "The .deb is not debsigned. Fulvid PGP authenticates the distribution set; it is not a Debian archive signature.",
    },
  },
  artifacts,
};

writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
