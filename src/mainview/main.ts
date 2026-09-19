import { createApp } from "vue";

import App from "./app/App.vue";
import { createAppRouter } from "./app/router";
import { applyPendingExternalOpens } from "./app/externalOpen";
import { bootstrapWorkspace } from "./app/workspaceState";
import { installNativeContextMenuSuppression } from "./app/suppressNativeContextMenu";
import {
  ensureUntitledDocument,
  restoreUntitledDrafts,
} from "./modules/editor/document/documentBuffers";

import "./styles/index.scss";
import { i18n } from "./i18n";

installNativeContextMenuSuppression();

const router = createAppRouter();

createApp(App).use(router).use(i18n).mount("#app");
// Let the shell paint before Monaco/model setup and optional folder restore.
requestAnimationFrame(() => {
  void (async () => {
    await restoreUntitledDrafts();
    ensureUntitledDocument();
    // An external request outranks the remembered folder: someone asked for this
    // one now. Only restore the last folder when nothing external opened one.
    const { openedFolder } = await applyPendingExternalOpens();
    if (!openedFolder) {
      bootstrapWorkspace();
    }
  })();
});
