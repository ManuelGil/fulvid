/**
 * Shared Electrobun view client. Filesystem and Application Menu use the same
 * RPC instance; they do not own separate command systems.
 */
import { Electroview } from "electrobun/view";

import type { DesktopRPC } from "./desktopRpc";

type MenuClickHandler = (action: string) => void;
type WindowCloseHandler = () => void;

let menuClickHandler: MenuClickHandler | null = null;
let windowCloseHandler: WindowCloseHandler | null = null;

/**
 * Electrobun's preload normally installs `window.__electrobun` before page JS.
 * Under Vite HMR (`http://127.0.0.1:5173`) that object is sometimes still
 * missing when this module evaluates, and Electroview.init throws while
 * assigning handlers. This stub is a rare-race guard for host messaging, not
 * an HMR stability fix. Preload or Electroview still replace these handlers
 * when they arrive.
 */
function ensureElectrobunBridge(): void {
  if (typeof window === "undefined" || window.__electrobun) {
    return;
  }
  const pending: unknown[] = [];
  window.__electrobunPendingHostMessages = pending;
  const buffer = (msg: unknown): void => {
    pending.push(msg);
  };
  window.__electrobun = {
    receiveMessageFromHost: buffer,
    receiveMessageFromBun: buffer,
    receiveInternalMessageFromHost: buffer,
    receiveInternalMessageFromBun: buffer,
  };
}

ensureElectrobunBridge();

export function onApplicationMenuClicked(handler: MenuClickHandler): () => void {
  menuClickHandler = handler;
  return () => {
    if (menuClickHandler === handler) {
      menuClickHandler = null;
    }
  };
}

/** OS window close was vetoed; run the same quit gate as Menu Quit. */
export function onWindowCloseRequested(handler: WindowCloseHandler): () => void {
  windowCloseHandler = handler;
  return () => {
    if (windowCloseHandler === handler) {
      windowCloseHandler = null;
    }
  };
}

export const desktopRpc = new Electroview({
  rpc: Electroview.defineRPC<DesktopRPC>({
    maxRequestTime: Infinity,
    handlers: {
      requests: {},
      messages: {
        applicationMenuClicked: ({ action }) => {
          menuClickHandler?.(action);
        },
        windowCloseRequested: () => {
          windowCloseHandler?.();
        },
      },
    },
  }),
});

export function desktopRequest(): NonNullable<typeof desktopRpc.rpc>["request"] {
  return desktopRpc.rpc!.request;
}
