/**
 * Combined renderer↔host RPC. Filesystem requests stay owned by FilesystemRPC;
 * this file only adds Application Menu transport on the same Electrobun channel.
 */
import type { RPCSchema } from "electrobun";

import type { FilesystemRPC } from "../modules/workspace/filesystem/filesystemRpc";

export type DesktopPlatform = "darwin" | "win32" | "linux" | "other";

// `electrobun-2.0.1-linux-unwired` is the pin Fulvid uses today.
// See electrobunApplicationMenu.ts for when to change it.
export type ApplicationMenuFallbackReason = "electrobun-2.0.1-linux-unwired" | "rpc-unavailable";

export type SerializableMenuItem =
  | { type: "separator" }
  | {
      type?: "normal";
      label: string;
      action?: string;
      role?: string;
      enabled?: boolean;
      checked?: boolean;
      accelerator?: string;
      submenu?: SerializableMenuItem[];
    };

export type ApplicationMenuSupport = {
  native: boolean;
  platform: DesktopPlatform;
  fallbackReason?: ApplicationMenuFallbackReason;
};

type ApplicationMenuRequests = {
  setApplicationMenu: {
    params: { items: SerializableMenuItem[] };
    response: boolean;
  };
  getApplicationMenuSupport: {
    params: Record<string, never>;
    response: ApplicationMenuSupport;
  };
  quitApplication: {
    params: Record<string, never>;
    response: boolean;
  };
};

export type DesktopRPC = {
  bun: RPCSchema<{
    requests: FilesystemRPC["bun"]["requests"] & ApplicationMenuRequests;
    messages: FilesystemRPC["bun"]["messages"];
  }>;
  webview: RPCSchema<{
    requests: FilesystemRPC["webview"]["requests"];
    messages: FilesystemRPC["webview"]["messages"] & {
      applicationMenuClicked: { action: string };
    };
  }>;
};
