# macOS packaging helpers. Not used by Linux or Windows.
# shellcheck shell=bash

ROOT="$(CDPATH='' cd -- "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACTS="$ROOT/artifacts"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

require_macos() {
  [ "$(uname -s)" = "Darwin" ] || fail "macOS packaging must run on macOS"
}

host_arch_token() {
  if [ "$(uname -m)" = "arm64" ]; then
    printf '%s\n' macos-arm64
  else
    printf '%s\n' macos-x64
  fi
}

artifact_name() {
  printf 'fulvid_%s_%s%s\n' "$1" "$2" "$3"
}

package_version() {
  bun -e 'const fs=require("fs"); process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).version)' "$ROOT/package.json"
}

assert_app_versions() {
  local version configured
  version="$(package_version)"
  configured="$(awk -F'"' '/version:[[:space:]]*"/ {print $2; exit}' "$ROOT/electrobun.config.ts")"
  [ -n "$configured" ] || fail "electrobun.config.ts version is missing"
  [ "$configured" = "$version" ] || \
    fail "electrobun.config.ts version ${configured} does not match package.json ${version}"
}

file_sha256() {
  shasum -a 256 -- "$1" | awk '{print $1}'
}

file_size() {
  stat -f '%z' -- "$1"
}

list_artifact_files() {
  local path
  shopt -s nullglob
  for path in "$ARTIFACTS"/*; do
    [ -f "$path" ] || fail "unexpected non-file in artifacts/: $(basename "$path")"
    basename "$path"
  done | LC_ALL=C sort
  shopt -u nullglob
}

single_match() {
  local pattern="$1"
  local matches
  shopt -s nullglob
  matches=("$ARTIFACTS"/$pattern)
  shopt -u nullglob
  [ "${#matches[@]}" -eq 1 ] || fail "expected exactly one artifacts/${pattern} (found ${#matches[@]})"
  basename "${matches[0]}"
}

promote_artifact() {
  local dest="$1"
  local pattern="$2"
  local src
  if [ -f "$ARTIFACTS/$dest" ]; then
    return 0
  fi
  src="$(single_match "$pattern")"
  [ -n "$src" ] || fail "missing source for $dest"
  [ -f "$ARTIFACTS/$src" ] || fail "source is not a file: $src"
  mv -f -- "$ARTIFACTS/$src" "$ARTIFACTS/$dest"
}

rewrite_update_artifact_file() {
  bun -e '
    const fs = require("fs");
    const path = process.argv[1];
    const file = process.argv[2];
    const version = process.argv[3];
    const data = JSON.parse(fs.readFileSync(path, "utf8"));
    if (String(data.version ?? "") !== version) process.exit(1);
    if (!data.artifact || typeof data.artifact !== "object") process.exit(1);
    data.artifact.file = file;
    fs.writeFileSync(path, JSON.stringify(data) + "\n");
  ' "$ARTIFACTS/$1" "$2" "$3"
}

assert_exact_files() {
  local expected
  expected="$(printf '%s\n' "$@" | LC_ALL=C sort)"
  [ "$(list_artifact_files)" = "$expected" ] || \
    fail "artifact set is incomplete or contains stale files"
}

write_sha256sums() {
  mkdir -p "$ARTIFACTS"
  (
    cd "$ARTIFACTS"
    rm -f -- SHA256SUMS
    for name in "$@"; do
      [ -f "$name" ] || fail "missing $name"
      shasum -a 256 -- "$name"
    done >SHA256SUMS
  )
}

check_sha256sums() {
  (cd "$ARTIFACTS" && shasum -a 256 -c SHA256SUMS)
}

clean_generated() {
  rm -rf -- "$ROOT/build" "$ROOT/dist"
  mkdir -p "$ARTIFACTS"
  find "$ARTIFACTS" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
}
