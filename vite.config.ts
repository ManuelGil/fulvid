import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { electrobunViteAliases } from "./.hutch/devkit/api/config/electrobun-vite.ts";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const hutchDevkit = resolve(projectRoot, ".hutch/devkit");

/**
 * Prebundle Monaco for dev HMR. An unbundled Monaco graph floods WebKitGTK with ESM requests.
 * The editor worker stays out of dependency optimization so Vite does not
 * rewrite its worker entry. `noDiscovery` avoids a mid-load re-optimize.
 * Production uses a separate Rolldown code-splitting rule.
 * Changing this, enabling CEF, or changing `?worker` output is a CSP review
 * (`src/mainview/index.html`).
 */
const monacoHmrEntries = [
  "monaco-editor/editor",
  "monaco-editor/features/register.all",
  "monaco-editor/languages/definitions/markdown/register",
  "monaco-editor/languages/definitions/markdown/markdown",
];

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: electrobunViteAliases(hutchDevkit),
  },
  root: "src/mainview",
  optimizeDeps: {
    noDiscovery: true,
    // Lazy Graph routes must be explicit: Sigma and Graphology import the browser
    // `events` implementation and otherwise reach WebKit as unresolved ESM.
    include: [
      "vue",
      "vue-router",
      "vue-i18n",
      "events",
      "graphology",
      "sigma",
      ...monacoHmrEntries,
    ],
  },
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: "monaco", test: /\/node_modules\/monaco-editor\// }],
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // Vite 8 auto-enables forwardConsole when an AI agent is detected
    // (`CURSOR_AGENT`, etc.). That pipes console/errors over the HMR socket.
    // A controlled matrix did not show fewer reconnects with this off, but it
    // avoids agent-session console flooding of the same socket. Errors still
    // appear in the WebView. Outside agent detection Vite already defaults off.
    forwardConsole: false,
    // Pre-transform the first-paint graph. Measured to cut HMR reconnect rate
    // vs baseline; does not eliminate WebKitGTK NetworkProcess failures.
    warmup: {
      clientFiles: [
        "./main.ts",
        "./app/App.vue",
        "./app/router.ts",
        "./desktop/electrobunClient.ts",
        "./modules/editor/monaco/monacoSetup.ts",
        "./modules/editor/monaco/MonacoHost.vue",
        "./pages/editor/EditorPage.vue",
      ],
    },
  },
});
