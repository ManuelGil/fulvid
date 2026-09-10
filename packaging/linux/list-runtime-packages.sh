#!/usr/bin/env bash
# Print Debian/Ubuntu packages that provide Fulvid's Linux runtime libraries.
set -euo pipefail
root="$(CDPATH='' cd -- "$(dirname "$0")/../.." && pwd)"
awk '$1 !~ /^#/ && NF == 2 { print $2 }' "$root/packaging/linux/runtime-libraries.tsv"
