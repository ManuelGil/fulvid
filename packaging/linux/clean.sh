#!/usr/bin/env bash
# Remove generated Linux packaging output. Idempotent.
set -euo pipefail

# shellcheck source=lib.sh
. "$(CDPATH='' cd -- "$(dirname "$0")" && pwd)/lib.sh"
cd "$ROOT"

removed=0
remove_path() {
  local path="$1"
  if [ -e "$path" ] || [ -L "$path" ]; then
    rm -rf -- "$path"
    printf 'removed %s\n' "${path#"$ROOT"/}"
    removed=1
  fi
}

remove_path "$ROOT/build"
remove_path "$ROOT/dist"
if [ -d "$ARTIFACTS" ]; then
  shopt -s nullglob
  for path in "$ARTIFACTS"/*; do
    remove_path "$path"
  done
  shopt -u nullglob
fi

if [ "$removed" -eq 0 ]; then
  printf 'nothing to clean\n'
fi
