/**
 * Document capability: snapshot text + host-only stamps -> Lua -> apply through
 * existing untitled/reveal owners. No filesystem write or live model access.
 */
import { LUA_EXTENSION_LIMITS } from "../../bun/extensions/lua/luaLimits";

export const DOCUMENT_EXTENSION_LIMITS = {
  maxTextChars: LUA_EXTENSION_LIMITS.maxDocumentTextChars,
  maxCreateUntitledChars: LUA_EXTENSION_LIMITS.maxCreateUntitledChars,
} as const;

/** Host-side snapshot. Guest sees text plus cursor; identity stamps stay host-only. */
export type DocumentSnapshot = {
  text: string;
  documentId: string;
  alternativeVersionId: number;
  cursorLine: number;
  cursorColumn: number;
};

export function documentTextLimitError(text: string): string | null {
  if (text.length > DOCUMENT_EXTENSION_LIMITS.maxTextChars.value) {
    return "document text exceeds size limit";
  }
  return null;
}

export function createUntitledLimitError(text: unknown): string | null {
  if (typeof text !== "string") {
    return "document.createUntitled requires a string";
  }
  if (text.length > DOCUMENT_EXTENSION_LIMITS.maxCreateUntitledChars.value) {
    return "document.createUntitled exceeds size limit";
  }
  return null;
}

/** True when the live document still matches host-only identity stamps. */
export function documentSnapshotIsCurrent(
  snapshot: Pick<DocumentSnapshot, "documentId" | "alternativeVersionId">,
  live: Pick<DocumentSnapshot, "documentId" | "alternativeVersionId"> | null,
): boolean {
  if (!live) {
    return false;
  }
  return (
    live.documentId === snapshot.documentId &&
    live.alternativeVersionId === snapshot.alternativeVersionId
  );
}
