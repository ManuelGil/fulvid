/**
 * Launch Electrobun for local `bun run start` / `bun run dev`.
 *
 * On Linux, apply the `views://` paint profile: `WEBKIT_DISABLE_COMPOSITING_MODE=1`
 * when unset, and `GDK_BACKEND=x11`. An inherited Wayland GDK backend can leave
 * a blank window while the DOM still mounts (body background only).
 *
 * Packaged builds are unchanged. Set `FULVID_KEEP_GDK_BACKEND=1` to skip the
 * GDK override when deliberately testing Wayland.
 */
import { electrobunDevProcessEnv } from "./linuxWebViewEnv";

const electrobunArgs = process.argv.slice(2);
if (electrobunArgs.length === 0) {
  throw new Error("Usage: bun run scripts/electrobunDev.ts <electrobun-args...>");
}

const electrobun = Bun.spawn(["bun", "x", "electrobun", ...electrobunArgs], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
  env: electrobunDevProcessEnv(process.platform, process.env),
});

const forwardSignal = (signal: NodeJS.Signals): void => {
  electrobun.kill(signal);
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

process.exit(await electrobun.exited);
