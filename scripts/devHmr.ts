/**
 * Wait until Vite answers the browser entry points before Electrobun opens
 * the WebView. Keep this list small (`/`, `/@vite/client`, `/main.ts`): a
 * controlled mitigation matrix showed expanding HTTP warmup *increased*
 * WebKitGTK `internallyFailedLoadTimerFired` and HMR reconnect rates.
 * Vite `server.warmup.clientFiles` is the measured win for transform churn.
 *
 * On Linux, force `GDK_BACKEND=x11` (unless `FULVID_KEEP_GDK_BACKEND=1`) so
 * an inherited Wayland GDK backend does not blank the window. Do **not** set
 * `WEBKIT_DISABLE_COMPOSITING_MODE` here: with Vite HTTP that flag stops page
 * JS from evaluating (no `[vite] connected`). Compositing disable stays on
 * the `views://` path in `electrobunDev.ts` / Linux compatibility CI.
 */
import { electrobunDevProcessEnv } from "./linuxWebViewEnv";

const devServerUrl = "http://127.0.0.1:5173";
const warmupPaths = ["/", "/@vite/client", "/main.ts"];
const timeoutMs = 30_000;

async function waitForVite(): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const responses = await Promise.all(
        warmupPaths.map(async (path) => {
          const response = await fetch(`${devServerUrl}${path}`);
          await response.arrayBuffer();
          return response.ok;
        }),
      );

      if (responses.every(Boolean)) {
        return;
      }
    } catch {
      // Vite may not be listening yet; retry until the bounded deadline.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Vite did not become ready at ${devServerUrl}`);
}

await waitForVite();

const electrobun = Bun.spawn(["bun", "x", "electrobun", "dev"], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
  env: electrobunDevProcessEnv(process.platform, process.env, {
    disableCompositing: false,
  }),
});

const forwardSignal = (signal: NodeJS.Signals): void => {
  electrobun.kill(signal);
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

process.exit(await electrobun.exited);
