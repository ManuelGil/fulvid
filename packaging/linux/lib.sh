# Linux manual packaging helpers. Not used by GitHub Actions or other platforms.
# shellcheck shell=bash

ROOT="$(CDPATH='' cd -- "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACTS="$ROOT/artifacts"
PUBLIC_KEY="$ROOT/security/signing-key.asc"
CANONICAL_FINGERPRINT="0AFF5507884548626087F84A5E1E335B601FB44B"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

require_linux_x64() {
  [ "$(uname -s)" = "Linux" ] || fail "Linux packaging must run on Linux"
  [ "$(uname -m)" = "x86_64" ] || fail "Linux packaging supports x86_64 only"
}

artifact_name() {
  printf 'fulvid_%s_linux-x64%s\n' "$1" "$2"
}

json_string() {
  bun -e 'const fs=require("fs"); const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const keys=process.argv[2].split("."); let v=o; for (const k of keys) v=v?.[k]; if (v==null || v==="") process.exit(1); process.stdout.write(String(v));' "$@"
}

package_version() {
  json_string "$ROOT/package.json" version
}

linux_runtime_depends() {
  awk '$1 !~ /^#/ && NF == 2 { packages[++n] = $2 }
       END {
         for (i = 1; i <= n; i++) {
           printf "%s%s", packages[i], (i < n ? ", " : "")
         }
       }' "$ROOT/packaging/linux/runtime-libraries.tsv"
}

electrobun_app_version() {
  awk -F'"' '/version:[[:space:]]*"/ {print $2; exit}' "$ROOT/electrobun.config.ts"
}

assert_app_versions() {
  local version configured
  version="$(package_version)"
  configured="$(electrobun_app_version)"
  [ -n "$configured" ] || fail "electrobun.config.ts version is missing"
  [ "$configured" = "$version" ] || \
    fail "electrobun.config.ts version ${configured} does not match package.json ${version}"
}

run_electrobun_stable() {
  export PATH="$ROOT/node_modules/.bin:$PATH"
  need bun
  need electrobun
  need vite
  electrobun prepare --env=stable
  vite build
  electrobun build --env=stable
}

public_key_fingerprint() {
  [ -f "$PUBLIC_KEY" ] || fail "public key is missing: $PUBLIC_KEY"
  gpg --show-keys --with-colons "$PUBLIC_KEY" \
    | awk -F: '$1 == "fpr" {print $10; exit}' \
    | tr '[:lower:]' '[:upper:]'
}

assert_canonical_public_key() {
  local fingerprint
  fingerprint="$(public_key_fingerprint)"
  [ "$fingerprint" = "$CANONICAL_FINGERPRINT" ] || \
    fail "security/signing-key.asc fingerprint ${fingerprint} is not the canonical release key"
}

assert_canonical_secret_key() {
  local fingerprint
  fingerprint="$(
    gpg --batch --with-colons --list-secret-keys "$CANONICAL_FINGERPRINT" 2>/dev/null \
      | awk -F: '$1 == "fpr" {print $10; exit}' \
      | tr '[:lower:]' '[:upper:]'
  )"
  [ "$fingerprint" = "$CANONICAL_FINGERPRINT" ] || \
    fail "canonical release signing secret key is not available locally"
}

signing_requested() {
  case "${FULVID_RELEASE_SIGN:-1}" in
    0 | no | false | off | skip) return 1 ;;
    1 | yes | true | on) return 0 ;;
    *) fail "FULVID_RELEASE_SIGN must be 0/1 or a recognized boolean value" ;;
  esac
}

gpg_sign() {
  local output="$1"
  local input="$2"
  if [ "${FULVID_SIGNING_PASSPHRASE+x}" = x ]; then
    gpg --batch --yes --pinentry-mode loopback --passphrase-fd 3 \
      --local-user "$CANONICAL_FINGERPRINT" --detach-sign --armor \
      --output "$output" -- "$input" 3<<<"$FULVID_SIGNING_PASSPHRASE"
  else
    gpg --batch --yes --local-user "$CANONICAL_FINGERPRINT" \
      --detach-sign --armor --output "$output" -- "$input"
  fi
}

verify_detached_signature() {
  local signature="$1"
  local input="$2"
  local home status fingerprints
  home="$(mktemp -d)"
  gpg --batch --homedir "$home" --import "$PUBLIC_KEY" >/dev/null 2>&1
  status="$(gpg --batch --homedir "$home" --status-fd 1 --verify "$signature" "$input" 2>/dev/null || true)"
  rm -rf -- "$home"
  fingerprints="$(printf '%s\n' "$status" | awk '$1 == "[GNUPG:]" && $2 == "VALIDSIG" {print $3}')"
  [ "$fingerprints" = "$CANONICAL_FINGERPRINT" ]
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
  local json_name="$1"
  local bundle_name="$2"
  local expected_version="$3"
  bun -e '
    const fs = require("fs");
    const path = process.argv[1];
    const file = process.argv[2];
    const version = process.argv[3];
    const data = JSON.parse(fs.readFileSync(path, "utf8"));
    if (String(data.version ?? "") !== version) {
      console.error("update.json version " + String(data.version) + " does not match " + version);
      process.exit(1);
    }
    if (!data.artifact || typeof data.artifact !== "object") {
      console.error("update.json is missing artifact.file");
      process.exit(1);
    }
    data.artifact.file = file;
    fs.writeFileSync(path, JSON.stringify(data) + "\n");
  ' "$ARTIFACTS/$json_name" "$bundle_name" "$expected_version"
}

assert_exact_files() {
  local expected
  expected="$(printf '%s\n' "$@" | LC_ALL=C sort)"
  [ "$(list_artifact_files)" = "$expected" ] || \
    fail "artifact set is incomplete or contains stale files"
}

assert_no_private_key_material() {
  local path
  shopt -s nullglob
  for path in "$ARTIFACTS"/*; do
    [ -f "$path" ] || continue
    if grep -a -q -e 'BEGIN PGP PRIVATE KEY BLOCK' -e 'BEGIN OPENSSH PRIVATE KEY' -- "$path"; then
      fail "private key material must not appear in artifacts: $(basename "$path")"
    fi
  done
  shopt -u nullglob
}

file_sha256() {
  sha256sum -- "$1" | awk '{print $1}'
}

file_size() {
  stat -c '%s' -- "$1"
}

write_sha256sums() {
  mkdir -p "$ARTIFACTS"
  (
    cd "$ARTIFACTS"
    rm -f -- SHA256SUMS
    for name in "$@"; do
      [ -f "$name" ] || fail "missing $name"
      sha256sum -- "$name"
    done >SHA256SUMS
  )
}

check_sha256sums() {
  (cd "$ARTIFACTS" && sha256sum -c SHA256SUMS)
}

git_field() {
  local commit="" tag="" describe=""
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    commit="$(git rev-parse HEAD 2>/dev/null || true)"
    tag="$(git describe --exact-match --tags HEAD 2>/dev/null || true)"
    describe="$(git describe --always --dirty 2>/dev/null || true)"
  fi
  printf '%s\n%s\n%s\n' "$commit" "$tag" "$describe"
}

parse_verify_dir() {
  ALLOW_UNSIGNED=0
  if [ "$#" -eq 0 ]; then
    return 0
  fi
  if [ "$#" -eq 1 ]; then
    if [ "$1" = "--allow-unsigned" ]; then
      fail "usage: $(basename "$0") [--allow-unsigned] [DIR]"
    fi
    ARTIFACTS="$(CDPATH='' cd -- "$1" && pwd)"
    return 0
  fi
  if [ "$#" -eq 2 ] && [ "$1" = "--allow-unsigned" ]; then
    ALLOW_UNSIGNED=1
    ARTIFACTS="$(CDPATH='' cd -- "$2" && pwd)"
    return 0
  fi
  fail "usage: $(basename "$0") [--allow-unsigned] [DIR]"
}
