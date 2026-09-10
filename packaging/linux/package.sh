#!/usr/bin/env bash
# Package Linux: Electrobun artifacts, canonical names, and a .deb.
set -euo pipefail

# shellcheck source=lib.sh
. "$(CDPATH='' cd -- "$(dirname "$0")" && pwd)/lib.sh"
cd "$ROOT"
require_linux_x64
need bun
export PATH="$ROOT/node_modules/.bin:$PATH"

write_linux_package_checksums() {
  local version
  version="$(package_version)"
  write_sha256sums \
    "$(artifact_name "$version" .deb)" \
    "$(artifact_name "$version" -Setup.tar.gz)" \
    "$(artifact_name "$version" .tar.zst)" \
    "$(artifact_name "$version" -update.json)"
}

assert_linux_package_set() {
  local version
  version="$(package_version)"
  assert_exact_files \
    "$(artifact_name "$version" .deb)" \
    "$(artifact_name "$version" -Setup.tar.gz)" \
    "$(artifact_name "$version" .tar.zst)" \
    "$(artifact_name "$version" -update.json)" \
    SHA256SUMS
}

if [ "${1:-}" = "checksums" ]; then
  write_linux_package_checksums
  assert_linux_package_set
  printf 'checksums ready: %s\n' "$ARTIFACTS"
  exit 0
fi

printf '%s\n' "==> linux package: cleaning generated output"
"$ROOT/packaging/linux/clean.sh"
assert_app_versions

printf '%s\n' "==> linux package: electrobun stable build"
run_electrobun_stable

version="$(package_version)"
installer="$(artifact_name "$version" -Setup.tar.gz)"
bundle="$(artifact_name "$version" .tar.zst)"
update_json="$(artifact_name "$version" -update.json)"

promote_artifact "$installer" '*Setup*.tar.gz'
promote_artifact "$bundle" '*.tar.zst'
promote_artifact "$update_json" '*-update.json'
rewrite_update_artifact_file "$update_json" "$bundle" "$version"

printf '%s\n' "==> linux package: debian package"
"$ROOT/packaging/linux/deb.sh"

write_linux_package_checksums
assert_linux_package_set

printf 'linux artifacts ready: %s\n' "$ARTIFACTS"
list_artifact_files | sed 's/^/  /'
