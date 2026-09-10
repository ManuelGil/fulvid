/**
 * Shared Electrobun view client. Filesystem and Application Menu use the same
 * RPC instance; they do not own separate command systems.
 */
import { Electroview } from "electrobun/view";

import type { DesktopRPC } from "./desktopRpc";

type MenuClickHandler = (action: string) => void;

let menuClickHandler: MenuClickHandler | null = null;

export function onApplicationMenuClicked(handler: MenuClickHandler): () => void {
  menuClickHandler = handler;
  return () => {
    if (menuClickHandler === handler) {
      menuClickHandler = null;
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
      },
    },
  }),
});

export function desktopRequest(): NonNullable<typeof desktopRpc.rpc>["request"] {
  return desktopRpc.rpc!.request;
}
