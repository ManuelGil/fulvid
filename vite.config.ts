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
  },
});
