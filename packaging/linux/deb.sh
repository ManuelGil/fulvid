#!/usr/bin/env bash
# Assemble a Debian package from the Electrobun Linux application tree.
set -euo pipefail

# shellcheck source=lib.sh
. "$(CDPATH='' cd -- "$(dirname "$0")" && pwd)/lib.sh"
cd "$ROOT"

require_linux_x64
need dpkg-deb

version="$(package_version)"
deb_name="$(artifact_name "$version" .deb)"
app_tree="$ROOT/build/stable-linux-x64/Fulvid"
[ -x "$app_tree/bin/launcher" ] || fail "missing Electrobun Linux app tree: $app_tree"

stage="$(mktemp -d)"
cleanup() { rm -rf -- "$stage"; }
trap cleanup EXIT

install -d "$stage/opt/fulvid"
cp -a "$app_tree/." "$stage/opt/fulvid/"
find "$stage/opt/fulvid" -type d -exec chmod 755 {} +
find "$stage/opt/fulvid" -type f -exec chmod 644 {} +
chmod 755 "$stage/opt/fulvid/bin/launcher"

install -d "$stage/usr/bin"
cat >"$stage/usr/bin/fulvid" <<'EOF'
#!/bin/sh
exec /opt/fulvid/bin/launcher "$@"
EOF
chmod 755 "$stage/usr/bin/fulvid"

install -d "$stage/usr/share/applications"
install -m 644 "$ROOT/packaging/linux/desktop/fulvid.desktop" \
  "$stage/usr/share/applications/fulvid.desktop"

[ -f "$ROOT/assets/fulvid.png" ] || fail "missing application icon: assets/fulvid.png"
install -d "$stage/usr/share/icons/hicolor/512x512/apps"
cp -- "$ROOT/assets/fulvid.png" "$stage/usr/share/icons/hicolor/512x512/apps/fulvid.png"

installed_size="$(du -sk "$stage" | awk '{print $1}')"
install -d "$stage/DEBIAN"
cat >"$stage/DEBIAN/control" <<EOF
Package: fulvid
Version: ${version}
Section: editors
Priority: optional
Architecture: amd64
Maintainer: Manuel Gil <support@imgil.dev>
Installed-Size: ${installed_size}
Depends: libwebkit2gtk-4.1-0, libgtk-3-0, libsoup-3.0-0, libdbusmenu-gtk3-4
Homepage: https://github.com/ManuelGil/fulvid
Description: standalone desktop editor for Markdown and MDX
 Fulvid is a standalone desktop editor for Markdown and MDX.
EOF

mkdir -p "$ARTIFACTS"
dpkg-deb --build --root-owner-group -Zxz "$stage" "$ARTIFACTS/$deb_name" >/dev/null
printf 'debian package: %s\n' "$deb_name"
