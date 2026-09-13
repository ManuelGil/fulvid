/**
 * External open requests: the contract, shared by host and renderer.
 *
 * An external open request says one thing: "something outside Fulvid asked to
 * open this resource." It is an expression of intent, never a grant of access.
 * Nothing here carries authority - the host resolves every request through the
 * same checks a native dialog goes through, and a request for a path the host
 * refuses is simply refused.
 *
 * Deliberately not in this contract, and not to be added without a reason that
 * cannot be met otherwise: tokens, capabilities, commands, executable paths,
 * environment, URLs-as-commands, RPC method names, callbacks, or free-form
 * metadata. The contract opens files and folders; it is not a channel.
 *
 * Types only, so the Bun host can import it without pulling in the renderer.
 */
import type { FilesystemErrorCode } from "../modules/workspace/filesystem/workspaceErrors";
import type { GrantedDocumentSnapshot } from "../modules/workspace/filesystem/workspaceTypes";

/**
 * Where a request claims to come from.
 *
 * Descriptive only: for logging and for telling a person what happened. The
 * host must never branch on this to decide what is allowed, or the source
 * becomes a privilege and every future adapter becomes a security boundary.
 */
export const EXTERNAL_OPEN_SOURCES = [
  "os-file-association",
  "os-context-menu",
  "shell",
  "browser-extension",
  "unknown",
] as const;

export type ExternalOpenSource = (typeof EXTERNAL_OPEN_SOURCES)[number];

/**
 * File and folder are separate kinds rather than a flag, because they end in
 * different lifecycles: a file becomes a document buffer, a folder becomes the
 * open workspace. A request whose kind disagrees with what is on disk is
 * refused, not reinterpreted.
 */
export type ExternalOpenKind = "file" | "folder";

export type ExternalOpenRequest = {
  kind: ExternalOpenKind;
  /** Absolute, in the host platform's own semantics. Never normalized here. */
  path: string;
  source: ExternalOpenSource;
};

/**
 * What the host hands back once it has applied its own authority.
 *
 * The renderer receives a grant snapshot or an authorized root - the same
 * shapes the file and folder dialogs produce - never a bare path to act on.
 * That keeps "the renderer must not gain a generic absolute-path read" true.
 */
export type ResolvedExternalOpen =
  | { kind: "file"; source: ExternalOpenSource; snapshot: GrantedDocumentSnapshot }
  | { kind: "folder"; source: ExternalOpenSource; rootPath: string }
  | { kind: "rejected"; source: ExternalOpenSource; reason: FilesystemErrorCode };

/** Longest path accepted from an external source. */
export const MAX_EXTERNAL_OPEN_PATH_LENGTH = 4096;

/**
 * How many requests may wait to be delivered.
 *
 * A launch carries one or two paths. The bound exists so a future adapter
 * cannot make the queue grow without limit; over it, requests are dropped
 * rather than buffered.
 */
export const MAX_PENDING_EXTERNAL_OPENS = 8;

const SOURCES = new Set<string>(EXTERNAL_OPEN_SOURCES);

export function isExternalOpenSource(value: unknown): value is ExternalOpenSource {
  return typeof value === "string" && SOURCES.has(value);
}
