/**
 * Warm Vite's browser entry points before Electrobun creates its WebView.
 *
 * WebKit can fail the first concurrent module requests while Vite is
 * transforming them. HMR must start only after these responses are ready.
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

const electrobun = Bun.spawn(["bun", "x", "electrobun", "dev"], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

const forwardSignal = (signal: NodeJS.Signals): void => {
  electrobun.kill(signal);
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

process.exit(await electrobun.exited);
