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
  installExtensionFromDirectory,
  loadAllowedBlockedExtension,
  resolveInstalledExtensionPath,
  uninstallExtensionPack,
  withExtensionLifecycleLock,
} from "./extensions/discoverExtensions";
import { invokeLuaExtensionCommand } from "./extensions/lua/luaExtensionRuntime";
import { loadWindowFrame, saveWindowFrame } from "./windowBounds";
import { canPersistWindowFrame, toggleNativeFullScreen } from "./windowFullScreen";
import { setNativeWindowTitle } from "./windowTitle";

async function pickExtensionSourceDirectory(): Promise<string | null> {
  const chosenPaths = await Utils.openFileDialog({
    startingFolder: Utils.paths.home,
    allowedFileTypes: "*",
    canChooseFiles: false,
    canChooseDirectory: true,
    allowsMultipleSelection: false,
  });
  return chosenPaths[0] ?? null;
}

// Folder approvals are host state: which folders a person picked in a dialog.
// Configuring the store here keeps the approval rules free of the runtime.
configureWorkspaceApprovals(Utils.paths.userData);
// Declarative packs live under userData/extensions - filesystem is source of truth.
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
      rediscoverExtensions: async () => discoverExtensions(),
      installExtensionPack: async () => {
        const selectedPath = await pickExtensionSourceDirectory();
        if (!selectedPath) {
          return { status: "cancelled" as const };
        }
        return installExtensionFromDirectory(selectedPath);
      },
      uninstallExtensionPack: async ({ id }) => {
        if (typeof id !== "string" || id.length === 0 || id.length > 256) {
          return {
            status: "error" as const,
            reason: "invalid extension id",
            discovery: getDiscoveredExtensions(),
          };
        }
        return uninstallExtensionPack(id);
      },
      allowBlockedExtension: async ({ id }) => {
        if (typeof id !== "string" || id.length === 0 || id.length > 256) {
          return getDiscoveredExtensions();
        }
        return loadAllowedBlockedExtension(id);
      },
      revealExtensionPack: ({ id }) => {
        if (typeof id !== "string" || id.length === 0 || id.length > 256) {
          return false;
        }
        const path = resolveInstalledExtensionPath(id);
        if (!path) {
          return false;
        }
        Utils.showItemInFolder(path);
        return true;
      },
      invokeExtensionLuaCommand: (params) =>
        withExtensionLifecycleLock(() => invokeLuaExtensionCommand(params)),
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
// 2.0.1's packaged launcher does not forward them to this process (upstream
// #483; Fulvid confirmation #554). Queuing before the window opens means a
// request is waiting when the renderer first asks for it.
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

// Electrobun 2.0.1: OS chrome close is sync `will-close` with
// `event.response = { allow: false }`. There is no awaitable close and no
// web beforeunload. Veto here, then reuse the renderer confirmAndQuit owner
// (same path as Menu Quit -> quitApplication -> Utils.quit). Utils.quit does
// not re-enter will-close.
mainWindowHolder.window.on("will-close", (event: unknown) => {
  const closeEvent = event as { response?: { allow: boolean } };
  closeEvent.response = { allow: false };
  mainRPC.send.windowCloseRequested({});
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
