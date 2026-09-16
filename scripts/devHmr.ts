/**
 * Wait until Vite answers the browser entry points before Electrobun opens
 * the WebView. Keep this list small (`/`, `/@vite/client`, `/main.ts`): a
 * controlled mitigation matrix showed expanding HTTP warmup *increased*
 * WebKitGTK `internallyFailedLoadTimerFired` and HMR reconnect rates.
 * Vite `server.warmup.clientFiles` is the measured win for transform churn.
 *
 * On Linux, Electrobun 2.0.1 forces GDK_BACKEND=x11 (XWayland on Wayland
 * sessions). Accelerated compositing then often logs GLXBadWindow. Linux
 * compatibility CI already launches with WEBKIT_DISABLE_COMPOSITING_MODE=1.
 * Inherit an explicit value; otherwise default to the same profile for HMR
 * only. That env targets GLX/compositing, not the HMR WebSocket path. This
 * does not silence stderr and does not change packaged builds.
 */
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

/** Linux HMR only: do not inject this env on Windows/macOS or into packaged builds. */
function linuxWebKitCompositingEnv(
  platform: NodeJS.Platform,
  existing: string | undefined,
): Record<string, string> {
  if (platform !== "linux" || existing !== undefined) {
    return {};
  }
  return { WEBKIT_DISABLE_COMPOSITING_MODE: "1" };
}

const electrobun = Bun.spawn(["bun", "x", "electrobun", "dev"], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
  env: {
    ...process.env,
    ...linuxWebKitCompositingEnv(process.platform, process.env.WEBKIT_DISABLE_COMPOSITING_MODE),
  },
});

const forwardSignal = (signal: NodeJS.Signals): void => {
  electrobun.kill(signal);
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

process.exit(await electrobun.exited);
