import { createApp } from "vue";

import App from "./app/App.vue";
import { createAppRouter } from "./app/router";
import { bootstrapWorkspace } from "./app/workspaceState";
import { ensureUntitledDocument } from "./modules/editor/document/documentBuffers";

import "./styles/index.scss";
import { i18n } from "./i18n";

const router = createAppRouter();

createApp(App).use(router).use(i18n).mount("#app");
// Let the shell paint before Monaco/model setup and optional folder restore.
requestAnimationFrame(() => {
  ensureUntitledDocument();
  bootstrapWorkspace();
});
