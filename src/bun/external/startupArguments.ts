/**
 * Launch arguments as an external open source.
 *
 * This is the shape every future adapter should have: read whatever the channel
 * provides, classify it, hand it to `enqueueExternalOpenRequest`, and stop. It
 * decides nothing about access - a path it produces is refused exactly as any
 * other would be.
 *
 * Status today: `Fulvid.app`/`fulvid.exe`/`/usr/bin/fulvid` are launched through
 * Electrobun 2.0.1's Zig launcher. That launcher reads OS arguments, uses them
 * for uninstall and `--automation`, then spawns Bun as
 * `[runtime, Resources/main.js]` and does not append the remaining arguments
 * (`package/src/launcher/main.zig` in Electrobun v2.0.1). The child inherits
 * environment, which this adapter does not read. So this classifies arguments
 * that are present when the host is run directly, and is the seam a Linux
 * `%F` / Windows shell verb will use once the launcher forwards them.
 * See docs/EXTERNAL-OPEN.md.
 */
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import type { ExternalOpenRequest, ExternalOpenSource } from "../../mainview/desktop/externalOpen";

/**
 * Arguments that are the runtime's own, not a resource to open.
 *
 * Anything starting with `-` is a flag. The first two entries are the runtime
 * binary and the script.
 */
function resourceArguments(argv: readonly string[]): string[] {
  return argv.slice(2).filter((argument) => argument.length > 0 && !argument.startsWith("-"));
}

/**
 * Classify each launch argument into an explicit request.
 *
 * argv carries no kind, so the adapter has to look: that is the conversion this
 * layer exists to do. A path that is neither a file nor a directory - missing,
 * or a socket or device - produces no request at all, because there is nothing
 * for either lifecycle to open. Whether the file may then be *read* stays the
 * resolver's decision, not this function's.
 */
export async function externalOpenRequestsFromArguments(
  argv: readonly string[],
  source: ExternalOpenSource = "os-file-association",
): Promise<ExternalOpenRequest[]> {
  const requests: ExternalOpenRequest[] = [];
  for (const argument of resourceArguments(argv)) {
    // argv's base is this process's working directory, which is a convention of
    // this channel, not of the contract. Resolving it here is what lets the
    // contract insist on absolute paths without losing `fulvid ./notes.md`.
    const path = resolve(argument);
    try {
      const information = await stat(path);
      if (information.isDirectory()) {
        requests.push({ kind: "folder", path, source });
      } else if (information.isFile()) {
        requests.push({ kind: "file", path, source });
      }
    } catch {
      // Unreadable or missing at launch: nothing to open, and no reason to
      // fail the launch over it.
    }
  }
  return requests;
}
