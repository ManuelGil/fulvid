#!/usr/bin/env bash
# Manual Linux release: package, metadata, optional PGP, verify.
# Not invoked by GitHub Actions.
set -euo pipefail

# shellcheck source=lib.sh
. "$(CDPATH='' cd -- "$(dirname "$0")" && pwd)/lib.sh"
cd "$ROOT"

require_linux_x64
need bun
need gpg
need sha256sum
assert_canonical_public_key

sign_enabled=0
if signing_requested; then
  sign_enabled=1
  assert_canonical_secret_key
fi

temporary_log="$(mktemp)"
trap 'rm -f -- "$temporary_log"' EXIT

printf '%s\n' "==> linux release: packaging"
if ! "$ROOT/packaging/linux/package.sh" >"$temporary_log" 2>&1; then
  cat "$temporary_log" >&2
  fail "linux package build failed (see the output above)"
fi
cat "$temporary_log"

version="$(package_version)"
deb="$(artifact_name "$version" .deb)"
installer="$(artifact_name "$version" -Setup.tar.gz)"
bundle="$(artifact_name "$version" .tar.zst)"
update_json="$(artifact_name "$version" -update.json)"

[ -f "$ARTIFACTS/$deb" ] || fail "missing $deb"
[ -f "$ARTIFACTS/$installer" ] || fail "missing $installer"

if [ "$sign_enabled" -eq 1 ]; then
  gpg_sign "$ARTIFACTS/$deb.asc" "$ARTIFACTS/$deb"
  verify_detached_signature "$ARTIFACTS/$deb.asc" "$ARTIFACTS/$deb" || \
    fail "debian package signature verification failed"
  gpg_sign "$ARTIFACTS/$installer.asc" "$ARTIFACTS/$installer"
  verify_detached_signature "$ARTIFACTS/$installer.asc" "$ARTIFACTS/$installer" || \
    fail "linux installer signature verification failed"
fi

git_info="$(git_field)"
git_commit="$(printf '%s\n' "$git_info" | awk 'NR==1')"
git_tag="$(printf '%s\n' "$git_info" | awk 'NR==2')"
git_describe="$(printf '%s\n' "$git_info" | awk 'NR==3')"
build_timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [ "$sign_enabled" -eq 1 ]; then
  signing_line="SIGNED ($CANONICAL_FINGERPRINT; verification: verified)"
else
  signing_line="SKIPPED (explicit FULVID_RELEASE_SIGN=0)"
fi

{
  printf '%s\n' 'Fulvid Linux release'
  printf 'build_timestamp_utc: %s\n' "$build_timestamp"
  printf 'product: fulvid\n'
  printf 'version: %s\n' "$version"
  printf 'architecture: linux-x64\n'
  printf 'debian_package: %s\n' "$deb"
  printf 'debian_size_bytes: %s\n' "$(file_size "$ARTIFACTS/$deb")"
  printf 'debian_sha256: %s\n' "$(file_sha256 "$ARTIFACTS/$deb")"
  printf 'installer: %s\n' "$installer"
  printf 'signing: %s\n' "$signing_line"
  printf 'platform_native_signing: not-applied (debian-debsign)\n'
  printf 'git_commit: %s\n' "$git_commit"
  printf 'git_tag: %s\n' "$git_tag"
  printf 'git_describe: %s\n' "$git_describe"
  printf '\nCaptured package output:\n'
  cat "$temporary_log"
} >"$ARTIFACTS/build.log"

bun "$ROOT/packaging/linux/write-manifest.ts" \
  "$ARTIFACTS/release-manifest.json" \
  "$version" "$sign_enabled" \
  "$build_timestamp" "$git_commit" "$git_tag" "$git_describe" \
  "$deb" "$installer" "$bundle" "$update_json" build.log

write_sha256sums \
  "$deb" \
  "$installer" \
  "$bundle" \
  "$update_json" \
  build.log \
  release-manifest.json
check_sha256sums

if [ "$sign_enabled" -eq 1 ]; then
  gpg_sign "$ARTIFACTS/SHA256SUMS.asc" "$ARTIFACTS/SHA256SUMS"
  verify_detached_signature "$ARTIFACTS/SHA256SUMS.asc" "$ARTIFACTS/SHA256SUMS" || \
    fail "SHA256SUMS signature verification failed"
  "$ROOT/packaging/linux/verify.sh" "$ARTIFACTS"
else
  rm -f -- "$ARTIFACTS/$deb.asc" "$ARTIFACTS/$installer.asc" "$ARTIFACTS/SHA256SUMS.asc"
  "$ROOT/packaging/linux/verify.sh" --allow-unsigned "$ARTIFACTS"
fi

printf 'linux release ready: %s\n' "$ARTIFACTS"
