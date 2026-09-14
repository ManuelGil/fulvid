/**
 * Basename helpers for New Document / Save As prompts.
 * Pure string rules only — no Monaco, buffers, or filesystem I/O.
 */
import { isMarkdownFile, isSafeDocumentBasename } from "../../workspace/filesystem/workspaceTypes";

/**
 * Attach the default extension when missing; refuse unsupported or unsafe names.
 * Returns null when the name must not be written.
 */
export function resolveNewDocumentFileName(
  requestedName: string,
  defaultExtension: string,
): string | null {
  const trimmed = requestedName.trim();
  if (!trimmed) {
    return null;
  }
  const name = trimmed.includes(".") ? trimmed : `${trimmed}.${defaultExtension}`;
  if (!isMarkdownFile(name) || !isSafeDocumentBasename(name)) {
    return null;
  }
  return name;
}

/**
 * Suggest a Save As basename from the first meaningful line of untitled content.
 * Falls back to `untitled.{ext}`. Never invents path segments.
 */
export function suggestUntitledSaveBasename(content: string, defaultExtension: string): string {
  const extension = defaultExtension.replace(/^\./, "") || "mdx";
  const line = content.split(/\r?\n/).find((entry) => entry.trim().length > 0) ?? "";
  const withoutHeading = line.replace(/^#+\s*/, "").trim();
  const slug = withoutHeading
    .normalize("NFKD")
    .replace(/[^\w\s-]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 48)
    .replace(/^-+|-+$/g, "");
  if (!slug || !isSafeDocumentBasename(`${slug}.${extension}`)) {
    return `untitled.${extension}`;
  }
  return `${slug}.${extension}`;
}
