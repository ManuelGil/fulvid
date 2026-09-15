/**
 * Combined renderer↔host RPC. Filesystem requests stay owned by FilesystemRPC;
 * this file adds Application Menu transport and narrow window capabilities on
 * the same Electrobun channel (fullscreen toggle, title presentation).
 */
import type { RPCSchema } from "electrobun";

import type { FilesystemRPC } from "../modules/workspace/filesystem/filesystemRpc";
import type { ExtensionDiscoveryResult } from "../extensions/extensionManifest";
import type { ResolvedExternalOpen } from "./externalOpen";

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

/**
 * External open is a pull, not a push.
 *
 * A request can arrive before the webview exists, so the host queues it and the
 * renderer drains it once it is ready. That needs no new transport and no
 * listener: it rides the request channel the renderer already has.
 */
type ExternalOpenRequests = {
  takePendingExternalOpens: {
    params: Record<string, never>;
    response: ResolvedExternalOpen[];
  };
};

type ExtensionDiscoveryRequests = {
  listDiscoveredExtensions: {
    params: Record<string, never>;
    response: ExtensionDiscoveryResult;
  };
  allowBlockedExtension: {
    params: { id: string };
    response: ExtensionDiscoveryResult;
  };
  revealExtensionPack: {
    params: { id: string };
    response: boolean;
  };
  invokeExtensionLuaCommand: {
    params: {
      namespacedId: string;
      editor?: {
        selection: string;
        documentId: string;
        alternativeVersionId: number;
        startOffset: number;
        endOffset: number;
      };
      document?: {
        text: string;
        documentId: string;
        alternativeVersionId: number;
        cursorLine: number;
        cursorColumn: number;
      };
    };
    response:
      | {
          ok: true;
          notifications: string[];
          editor?: {
            replaceSelection?: string;
          };
          decorations?: {
            clear?: boolean;
            set?: Array<{
              startLine: number;
              startColumn: number;
              endLine: number;
              endColumn: number;
              style?: string;
              appearance?: {
                backgroundColor: string;
                color?: string;
                bold?: boolean;
                overviewColor?: string;
                glyph?: boolean;
              };
            }>;
          };
          createUntitled?: string;
          reveal?: { lineNumber: number; column: number };
        }
      | { ok: false; error: string };
  };
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

type WindowRequests = {
  toggleWindowFullScreen: {
    params: Record<string, never>;
    response: boolean;
  };
  setWindowTitle: {
    params: { title: string };
    response: boolean;
  };
};

export type DesktopRPC = {
  bun: RPCSchema<{
    requests: FilesystemRPC["bun"]["requests"] &
      ApplicationMenuRequests &
      ExternalOpenRequests &
      ExtensionDiscoveryRequests &
      WindowRequests;
    messages: FilesystemRPC["bun"]["messages"];
  }>;
  webview: RPCSchema<{
    requests: FilesystemRPC["webview"]["requests"];
    messages: FilesystemRPC["webview"]["messages"] & {
      applicationMenuClicked: { action: string };
    };
  }>;
};
