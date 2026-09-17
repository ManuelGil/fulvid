/**
 * Renderer TypeScript contract for filesystem RPC.
 *
 * Types only. Handlers live in `src/bun/filesystem/rpc/rpcHandlers.ts`.
 * The renderer must not gain a generic absolute-path read/write method.
 */
import type { RPCSchema } from "electrobun";

import type {
  DocumentSnapshot,
  DocumentWriteResult,
  FileSystemEntry,
  GrantedDocumentSnapshot,
  GrantedDocumentWriteResult,
  HtmlExportResult,
  SaveAsResult,
  WorkspaceScan,
} from "./workspaceTypes";
import type { LinkSyntax } from "../../document/links/documentLink";

export type FilesystemRPC = {
  bun: RPCSchema<{
    requests: {
      openWorkspace: {
        params: { path?: string };
        response: string | null;
      };
      pickAndOpenDocument: {
        params: Record<string, never>;
        response: GrantedDocumentSnapshot | null;
      };
      pickAndSaveDocument: {
        params: {
          basename: string;
          content: string;
          defaultExtension: "md" | "markdown" | "mdx";
          overwrite?: boolean;
        };
        response: SaveAsResult;
      };
      pickAndSaveHtmlExport: {
        params: {
          basename: string;
          content: string;
          overwrite?: boolean;
        };
        response: HtmlExportResult;
      };
      writeGrantedDocument: {
        params: {
          grantToken: string;
          content: string;
          expectedMtimeMs: number;
        };
        response: GrantedDocumentWriteResult;
      };
      grantDetachedWorkspaceDocument: {
        params: { rootPath: string; relativePath: string };
        response: { absolutePath: string; mtimeMs: number; grantToken: string };
      };
      scanWorkspace: {
        params: {
          path: string;
          includeHidden?: boolean;
          linkMode: LinkSyntax;
        };
        response: WorkspaceScan;
      };
      listDirectory: {
        params: {
          rootPath: string;
          relativePath?: string;
          includeHidden?: boolean;
        };
        response: FileSystemEntry[];
      };
      revealInExplorer: {
        params: { path: string };
        response: boolean;
      };
      copyPath: {
        params: { path: string };
        response: boolean;
      };
      readDocument: {
        params: { rootPath: string; relativePath: string };
        response: DocumentSnapshot;
      };
      writeDocument: {
        params: {
          rootPath: string;
          relativePath: string;
          content: string;
          expectedMtimeMs?: number;
          linkMode: LinkSyntax;
        };
        response: DocumentWriteResult;
      };
      createDocument: {
        params: {
          rootPath: string;
          relativePath: string;
          content: string;
          linkMode: LinkSyntax;
        };
        response: DocumentWriteResult;
      };
      createDirectory: {
        params: {
          rootPath: string;
          relativePath: string;
        };
        response: { path: string };
      };
      renameDocument: {
        params: {
          rootPath: string;
          relativePath: string;
          nextRelativePath: string;
          expectedMtimeMs?: number;
          linkMode: LinkSyntax;
        };
        response: DocumentWriteResult;
      };
      deleteDocument: {
        params: {
          rootPath: string;
          relativePath: string;
          expectedMtimeMs?: number;
        };
        response: boolean;
      };
    };
    messages: Record<string, never>;
  }>;
  webview: RPCSchema<{
    requests: Record<string, never>;
    messages: Record<string, never>;
  }>;
};
