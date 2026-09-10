#!/usr/bin/env bash
# Verify an existing macOS artifact set. Does not rebuild.
set -euo pipefail

# shellcheck source=lib.sh
. "$(CDPATH='' cd -- "$(dirname "$0")" && pwd)/lib.sh"
cd "$ROOT"

if [ "$#" -eq 1 ]; then
  ARTIFACTS="$(CDPATH='' cd -- "$1" && pwd)"
elif [ "$#" -ne 0 ]; then
  fail "usage: $(basename "$0") [DIR]"
fi

need bun
[ -d "$ARTIFACTS" ] || fail "release directory does not exist: $ARTIFACTS"
[ -f "$ARTIFACTS/release-manifest.json" ] || fail "release-manifest.json is missing"
[ -f "$ARTIFACTS/SHA256SUMS" ] || fail "SHA256SUMS is missing"

version="$(package_version)"
if [ -f "$ARTIFACTS/$(artifact_name "$version" macos-arm64 .dmg)" ]; then
  arch=macos-arm64
elif [ -f "$ARTIFACTS/$(artifact_name "$version" macos-x64 .dmg)" ]; then
  arch=macos-x64
else
  fail "expected fulvid_${version}_macos-arm64.dmg or fulvid_${version}_macos-x64.dmg"
fi

installer="$(artifact_name "$version" "$arch" .dmg)"
bundle="$(artifact_name "$version" "$arch" .app.tar.zst)"
update_json="$(artifact_name "$version" "$arch" -update.json)"

assert_exact_files "$installer" "$bundle" "$update_json" build.log release-manifest.json SHA256SUMS
check_sha256sums

manifest="$ARTIFACTS/release-manifest.json"
project="$(bun -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).project||"")' "$manifest")"
platform="$(bun -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).platform||"")' "$manifest")"
filename="$(bun -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).package.filename||"")' "$manifest")"
manifest_arch="$(bun -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).architecture||"")' "$manifest")"
manifest_version="$(bun -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).version||"")' "$manifest")"
size="$(bun -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).package.size_bytes))' "$manifest")"
digest="$(bun -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).package.sha256||"")' "$manifest")"
[ "$project" = "fulvid" ] || fail "release-manifest.json is not a Fulvid release manifest"
[ "$platform" = "macos" ] || fail "release-manifest.json is not a macOS release"
[ "$manifest_arch" = "$arch" ] || fail "manifest architecture does not match $arch"
[ "$manifest_version" = "$version" ] || fail "manifest version does not match package.json"
[ "$filename" = "$installer" ] || fail "manifest primary artifact is not the canonical dmg"
[ "$size" = "$(file_size "$ARTIFACTS/$installer")" ] || fail "manifest package size mismatch"
[ "$digest" = "$(file_sha256 "$ARTIFACTS/$installer")" ] || fail "manifest package sha256 mismatch"

published="$(bun -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).version||"")' "$ARTIFACTS/$update_json")"
[ "$published" = "$version" ] || fail "update.json version does not match package.json"
bundle_ref="$(bun -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).artifact.file||"")' "$ARTIFACTS/$update_json")"
[ "$bundle_ref" = "$bundle" ] || fail "update.json artifact.file is not the canonical bundle name"

printf 'macos package verification: PASS\n'
