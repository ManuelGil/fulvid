/**
 * Bun host entry - owns the main window and RPC.
 */
import { BrowserView, BrowserWindow, Updater, Utils } from "electrobun/main";

import type { DesktopRPC } from "../mainview/desktop/desktopRpc";
import { filesystemRpcHandlers } from "./filesystem/rpc/rpcHandlers";
import {
  applicationMenuSupport,
  installNativeApplicationMenu,
  quitApplication,
  setNativeApplicationMenu,
} from "./applicationMenu";
import { enqueueExternalOpenRequest, takePendingExternalOpens } from "./external/externalOpen";
import { externalOpenRequestsFromArguments } from "./external/startupArguments";
import { configureWorkspaceApprovals } from "./workspaceGrants";
import { loadWindowFrame, saveWindowFrame } from "./windowBounds";

// Folder approvals are host state: which folders a person picked in a dialog.
// Configuring the store here keeps the approval rules free of the runtime.
configureWorkspaceApprovals(Utils.paths.userData);

const DEV_SERVER_HOST = "127.0.0.1";
const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://${DEV_SERVER_HOST}:${DEV_SERVER_PORT}`;

async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
      return DEV_SERVER_URL;
    } catch {
      console.log("Vite dev server not running. Run 'bun run dev:hmr' for HMR support.");
    }
  }
  return "views://mainview/index.html";
}

const mainRPC = BrowserView.defineRPC<DesktopRPC>({
  maxRequestTime: 50_000,
  handlers: {
    requests: {
      ...filesystemRpcHandlers,
      takePendingExternalOpens: () => takePendingExternalOpens(),
      setApplicationMenu: ({ items }) => setNativeApplicationMenu(items),
      getApplicationMenuSupport: () => applicationMenuSupport(),
      quitApplication: () => quitApplication(),
    },
    messages: {},
  },
});

// Launch arguments are the only external open source wired today, and the
// packaged launcher does not forward them yet. Queuing before the window opens
// means a request is waiting when the renderer first asks for it.
for (const request of await externalOpenRequestsFromArguments(process.argv)) {
  enqueueExternalOpenRequest(request);
}

const url = await getMainViewUrl();
installNativeApplicationMenu((action) => {
  mainRPC.send.applicationMenuClicked({ action });
});
const frame = loadWindowFrame();

const mainWindow = new BrowserWindow({
  title: "Fulvid",
  url,
  frame,
  rpc: mainRPC,
});

setInterval(() => {
  try {
    saveWindowFrame(mainWindow.getFrame());
  } catch {
    // Window may be closing.
  }
}, 2500);

console.log("Fulvid started");
