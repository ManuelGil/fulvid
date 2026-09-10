#!/usr/bin/env bash
# Verify an existing Linux artifact set. Does not rebuild.
set -euo pipefail

# shellcheck source=lib.sh
. "$(CDPATH='' cd -- "$(dirname "$0")" && pwd)/lib.sh"
cd "$ROOT"

ALLOW_UNSIGNED=0
parse_verify_dir "$@"

need gpg
need bun
assert_canonical_public_key

[ -d "$ARTIFACTS" ] || fail "release directory does not exist: $ARTIFACTS"
[ -f "$ARTIFACTS/release-manifest.json" ] || fail "release-manifest.json is missing"
[ -f "$ARTIFACTS/build.log" ] || fail "build.log is missing"
[ -f "$ARTIFACTS/SHA256SUMS" ] || fail "SHA256SUMS is missing"

version="$(package_version)"
deb="$(artifact_name "$version" .deb)"
installer="$(artifact_name "$version" -Setup.tar.gz)"
bundle="$(artifact_name "$version" .tar.zst)"
update_json="$(artifact_name "$version" -update.json)"

[ -f "$ARTIFACTS/$deb" ] || fail "expected $deb"
[ -f "$ARTIFACTS/$installer" ] || fail "expected $installer"
[ -f "$ARTIFACTS/$bundle" ] || fail "expected $bundle"
[ -f "$ARTIFACTS/$update_json" ] || fail "expected $update_json"

manifest="$ARTIFACTS/release-manifest.json"
signing_enabled="$(
  bun -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(m.signing?.pgp?.enabled ? "1" : "0")' "$manifest"
)"

if [ "$signing_enabled" = "1" ]; then
  assert_exact_files \
    "$deb" \
    "$deb.asc" \
    "$installer" \
    "$installer.asc" \
    "$bundle" \
    "$update_json" \
    build.log \
    release-manifest.json \
    SHA256SUMS \
    SHA256SUMS.asc
else
  [ "$ALLOW_UNSIGNED" -eq 1 ] || \
    fail "unsigned release cannot satisfy verify; produce a signed release or pass --allow-unsigned"
  assert_exact_files \
    "$deb" \
    "$installer" \
    "$bundle" \
    "$update_json" \
    build.log \
    release-manifest.json \
    SHA256SUMS
fi

check_sha256sums

project="$(bun -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).project||"")' "$manifest")"
platform="$(bun -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).platform||"")' "$manifest")"
filename="$(bun -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).package.filename||"")' "$manifest")"
arch="$(bun -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).architecture||"")' "$manifest")"
manifest_version="$(bun -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).version||"")' "$manifest")"
size="$(bun -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).package.size_bytes))' "$manifest")"
digest="$(bun -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).package.sha256||"")' "$manifest")"
[ "$project" = "fulvid" ] || fail "release-manifest.json is not a Fulvid release manifest"
[ "$platform" = "linux" ] || fail "release-manifest.json is not a Linux release"
[ "$arch" = "linux-x64" ] || fail "manifest architecture does not match linux-x64"
[ "$manifest_version" = "$version" ] || fail "manifest version does not match package.json"
[ "$filename" = "$deb" ] || fail "manifest primary artifact is not the canonical .deb"
[ "$size" = "$(file_size "$ARTIFACTS/$deb")" ] || fail "manifest package size mismatch"
[ "$digest" = "$(file_sha256 "$ARTIFACTS/$deb")" ] || fail "manifest package sha256 mismatch"

published="$(json_string "$ARTIFACTS/$update_json" version)"
[ "$published" = "$version" ] || fail "update.json version does not match package.json"
bundle_ref="$(json_string "$ARTIFACTS/$update_json" artifact.file)"
[ "$bundle_ref" = "$bundle" ] || fail "update.json artifact.file is not the canonical bundle name"

assert_no_private_key_material

if [ "$signing_enabled" = "1" ]; then
  verify_detached_signature "$ARTIFACTS/$deb.asc" "$ARTIFACTS/$deb" || \
    fail "debian package signature is invalid or has the wrong signer"
  verify_detached_signature "$ARTIFACTS/$installer.asc" "$ARTIFACTS/$installer" || \
    fail "linux installer signature is invalid or has the wrong signer"
  verify_detached_signature "$ARTIFACTS/SHA256SUMS.asc" "$ARTIFACTS/SHA256SUMS" || \
    fail "SHA256SUMS signature is invalid or has the wrong signer"
  fingerprint="$(bun -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).signing?.pgp?.fingerprint||"")' "$manifest")"
  [ "$fingerprint" = "$CANONICAL_FINGERPRINT" ] || \
    fail "manifest PGP fingerprint is not the canonical release key"
else
  printf 'signatures: SKIPPED (explicit unsigned release)\n'
fi

printf 'linux release verification: PASS\n'
