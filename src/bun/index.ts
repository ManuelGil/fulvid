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
import {
  configureExtensionDiscovery,
  discoverExtensions,
  getDiscoveredExtensions,
} from "./extensions/discoverExtensions";
import { loadWindowFrame, saveWindowFrame } from "./windowBounds";
import { canPersistWindowFrame, toggleNativeFullScreen } from "./windowFullScreen";
import { setNativeWindowTitle } from "./windowTitle";

// Folder approvals are host state: which folders a person picked in a dialog.
// Configuring the store here keeps the approval rules free of the runtime.
configureWorkspaceApprovals(Utils.paths.userData);
// Declarative packs live under userData/extensions — filesystem is source of truth.
configureExtensionDiscovery(Utils.paths.userData);
await discoverExtensions();

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

const mainWindowHolder: {
  window?: InstanceType<typeof BrowserWindow>;
} = {};

const mainRPC = BrowserView.defineRPC<DesktopRPC>({
  maxRequestTime: 50_000,
  handlers: {
    requests: {
      ...filesystemRpcHandlers,
      takePendingExternalOpens: () => takePendingExternalOpens(),
      listDiscoveredExtensions: () => getDiscoveredExtensions(),
      setApplicationMenu: ({ items }) => setNativeApplicationMenu(items),
      getApplicationMenuSupport: () => applicationMenuSupport(),
      quitApplication: () => quitApplication(),
      toggleWindowFullScreen: () =>
        mainWindowHolder.window ? toggleNativeFullScreen(mainWindowHolder.window) : false,
      setWindowTitle: ({ title }) => setNativeWindowTitle(mainWindowHolder.window, title),
    },
    messages: {},
  },
});

// Launch arguments are the only external open source wired today. Electrobun
// 2.0.1's packaged launcher does not forward them to this process. Queuing
// before the window opens means a request is waiting when the renderer first
// asks for it.
for (const request of await externalOpenRequestsFromArguments(process.argv)) {
  enqueueExternalOpenRequest(request);
}

const url = await getMainViewUrl();
installNativeApplicationMenu((action) => {
  mainRPC.send.applicationMenuClicked({ action });
});
const frame = loadWindowFrame();

mainWindowHolder.window = new BrowserWindow({
  title: "Fulvid",
  url,
  frame,
  rpc: mainRPC,
});

setInterval(() => {
  try {
    const mainWindow = mainWindowHolder.window;
    if (mainWindow && canPersistWindowFrame(mainWindow.isFullScreen())) {
      saveWindowFrame(mainWindow.getFrame());
    }
  } catch {
    // Window may be closing.
  }
}, 2500);

console.log("Fulvid started");
