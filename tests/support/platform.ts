/**
 * Platform differences the test suite has to state rather than assume.
 *
 * Fulvid's properties are multiplatform; the ways a test provokes them are not.
 * Everything here is about the provocation, never about weakening a check so
 * Windows passes.
 */
import { symlink } from "node:fs/promises";

/**
 * Link a directory in a way both families accept.
 *
 * POSIX ignores the type argument. Windows needs one, and `"junction"` is the
 * reparse point a normal user may create — a directory symlink there needs
 * elevation or Developer Mode. `realpath` resolves junctions, so canonical
 * containment is exercised on Windows exactly as it is on POSIX, rather than
 * being skipped.
 */
export async function linkDirectory(target: string, linkPath: string): Promise<void> {
  await symlink(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}

/**
 * Whether `chmod(0o000)` actually denies access.
 *
 * Windows does not apply POSIX mode bits, so a test that makes a file
 * unreadable that way proves nothing there. Cases that need a real access
 * error either inject a skippable errno at the boundary that handles it, or
 * are skipped on Windows and say so.
 */
export const posixModeBitsDenyAccess = process.platform !== "win32";
