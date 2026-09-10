#!/usr/bin/env bash
# Package macOS Fulvid artifacts. Independent of Make and Linux packaging.
set -euo pipefail

# shellcheck source=lib.sh
. "$(CDPATH='' cd -- "$(dirname "$0")" && pwd)/lib.sh"
cd "$ROOT"
require_macos
need bun
export PATH="$ROOT/node_modules/.bin:$PATH"

version="$(package_version)"
arch="$(host_arch_token)"
installer="$(artifact_name "$version" "$arch" .dmg)"
bundle="$(artifact_name "$version" "$arch" .app.tar.zst)"
update_json="$(artifact_name "$version" "$arch" -update.json)"

if [ "${1:-}" = "checksums" ]; then
  write_sha256sums "$installer" "$bundle" "$update_json" build.log release-manifest.json
  assert_exact_files "$installer" "$bundle" "$update_json" build.log release-manifest.json SHA256SUMS
  printf 'checksums ready: %s\n' "$ARTIFACTS"
  exit 0
fi

printf '%s\n' "==> macos package: cleaning generated output"
clean_generated
assert_app_versions

printf '%s\n' "==> macos package: electrobun stable build"
need electrobun
need vite
electrobun prepare --env=stable
vite build
electrobun build --env=stable

promote_artifact "$installer" '*.dmg'
promote_artifact "$bundle" '*.app.tar.zst'
promote_artifact "$update_json" '*-update.json'
rewrite_update_artifact_file "$update_json" "$bundle" "$version"

codesign_status="not-applied"
if [ -n "${ELECTROBUN_DEVELOPER_ID:-}" ]; then
  codesign_status="requested-via-electrobun"
fi

build_timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
git_commit=""
git_tag=""
git_describe=""
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git_commit="$(git rev-parse HEAD 2>/dev/null || true)"
  git_tag="$(git describe --exact-match --tags HEAD 2>/dev/null || true)"
  git_describe="$(git describe --always --dirty 2>/dev/null || true)"
fi

{
  printf '%s\n' 'Fulvid macOS package'
  printf 'build_timestamp_utc: %s\n' "$build_timestamp"
  printf 'product: fulvid\n'
  printf 'version: %s\n' "$version"
  printf 'architecture: %s\n' "$arch"
  printf 'installer: %s\n' "$installer"
  printf 'installer_size_bytes: %s\n' "$(file_size "$ARTIFACTS/$installer")"
  printf 'installer_sha256: %s\n' "$(file_sha256 "$ARTIFACTS/$installer")"
  printf 'signing_pgp: not-applied\n'
  printf 'platform_native_signing: %s (apple-codesign)\n' "$codesign_status"
  printf 'git_commit: %s\n' "$git_commit"
  printf 'git_tag: %s\n' "$git_tag"
  printf 'git_describe: %s\n' "$git_describe"
} >"$ARTIFACTS/build.log"

native_status="not-applied"
if [ "$codesign_status" = "requested-via-electrobun" ]; then
  native_status="requested"
fi

bun -e '
  const fs = require("fs");
  const { createHash } = require("crypto");
  const path = require("path");
  const artifacts = process.argv[1];
  const version = process.argv[2];
  const arch = process.argv[3];
  const stamp = process.argv[4];
  const commit = process.argv[5];
  const tag = process.argv[6];
  const describe = process.argv[7];
  const nativeStatus = process.argv[8];
  const names = process.argv.slice(9);
  const sha = (p) => createHash("sha256").update(new Uint8Array(fs.readFileSync(p))).digest("hex");
  const payloads = names.map((name) => {
    const p = path.join(artifacts, name);
    const st = fs.statSync(p);
    let role = "artifact";
    if (name.endsWith(".dmg")) role = "installer";
    else if (name.endsWith(".app.tar.zst")) role = "bundle";
    else if (name.endsWith("-update.json")) role = "update";
    else if (name === "build.log") role = "log";
    return { name, role, size_bytes: st.size, sha256: sha(p) };
  });
  const primary = payloads.find((item) => item.role === "installer");
  const manifest = {
    schema: 1,
    project: "fulvid",
    version,
    platform: "macos",
    architecture: arch,
    package: {
      filename: primary.name,
      format: "installer",
      architecture: arch,
      size_bytes: primary.size_bytes,
      sha256: primary.sha256,
    },
    payloads,
    build_timestamp: stamp,
    git: { commit, tag, describe },
    signing: {
      pgp: { enabled: false, status: "SKIPPED", fingerprint: "", verification: "skipped" },
      platform_native: {
        mechanism: "apple-codesign",
        status: nativeStatus,
        note: "Apple code signing/notarization is separate from Fulvid PGP.",
      },
    },
    artifacts: [...names, "release-manifest.json", "SHA256SUMS"].sort(),
  };
  fs.writeFileSync(path.join(artifacts, "release-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
' "$ARTIFACTS" "$version" "$arch" "$build_timestamp" "$git_commit" "$git_tag" "$git_describe" "$native_status" \
  "$installer" "$bundle" "$update_json" build.log

write_sha256sums "$installer" "$bundle" "$update_json" build.log release-manifest.json
assert_exact_files "$installer" "$bundle" "$update_json" build.log release-manifest.json SHA256SUMS

printf 'macos artifacts ready: %s\n' "$ARTIFACTS"
list_artifact_files | sed 's/^/  /'
