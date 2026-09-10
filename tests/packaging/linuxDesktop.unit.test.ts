import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

const root = join(import.meta.dir, "../..");

function desktopFile(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

function desktopField(contents: string, key: string): string {
  const line = contents.split("\n").find((entry) => entry.startsWith(`${key}=`));
  expect(line).toBeDefined();
  return line!.slice(key.length + 1);
}

const canonical = desktopFile("packaging/linux/desktop/fulvid.desktop");
const appimage = desktopFile("packaging/linux/appimage/fulvid.desktop");
const snap = desktopFile("packaging/linux/snap/fulvid.desktop");
const debian = readFileSync(join(root, "packaging/linux/deb.sh"), "utf8");
const actions = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");

const sharedKeys = [
  "Type",
  "Name",
  "Comment",
  "Icon",
  "Terminal",
  "StartupWMClass",
  "Categories",
  "MimeType",
] as const;

// Intent: Linux OS delivery is Exec %F plus the Debian wrapper. MIME stays the
// types shared-mime-info already knows. Do not grow this file into a packaging
// suite; add a case only when the launch chain or identity keys change.
describe("Linux desktop launch chain", () => {
  test("variants share identity and only Exec may differ", () => {
    for (const key of sharedKeys) {
      const value = desktopField(canonical, key);
      expect(desktopField(appimage, key)).toBe(value);
      expect(desktopField(snap, key)).toBe(value);
    }

    expect(desktopField(canonical, "MimeType")).toBe("text/markdown;text/x-markdown;");
    expect(desktopField(canonical, "MimeType")).not.toContain("mdx");
    expect(canonical).not.toContain("inode/directory");
  });

  test("Exec receives unquoted %F so the desktop environment can pass local paths", () => {
    expect(desktopField(canonical, "Exec")).toBe("/usr/bin/fulvid %F");
    expect(desktopField(appimage, "Exec")).toBe("fulvid %F");
    expect(desktopField(snap, "Exec")).toBe("fulvid %F");

    for (const contents of [canonical, appimage, snap]) {
      expect(contents).not.toMatch(/Exec=.*%[fFuU].*%[fFuU]/);
      expect(contents).not.toMatch(/Exec="[^"]*%F/);
    }
  });

  test("the Debian wrapper forwards those paths to the Electrobun launcher", () => {
    expect(debian).toContain('exec /opt/fulvid/bin/launcher "$@"');
    expect(actions).toContain('exec /opt/fulvid/bin/launcher "$@"');
  });
});
