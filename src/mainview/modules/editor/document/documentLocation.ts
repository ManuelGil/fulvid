/**
 * Pure presentation of document identity for editor chrome.
 *
 * Projects existing DocumentBuffer fields. Does not own selection, Focus,
 * filesystem access, or navigation. Truncation keeps the basename visible.
 */

export type DocumentLocationKind = "workspace" | "untitled" | "standalone";

export type DocumentLocationDestination = "window-title" | "main-panel" | "hidden";

export type DocumentLocation = {
  kind: DocumentLocationKind;
  /** Visible chrome label (may be compact). */
  label: string;
  /** Full identity for tooltip and accessible name. */
  full: string;
};

/** Buffer fields needed for location - avoids importing Monaco/Vue into tests. */
export type DocumentLocationSource = {
  id: string;
  kind: "virtual" | "persisted";
  title: string;
  path: string | null;
  absolutePath: string | null;
  rootPath: string | null;
};

/** Default visual budget for compact relative paths in the editor header. */
export const DOCUMENT_LOCATION_MAX_LENGTH = 52;

export const DOCUMENT_LOCATION_DESTINATIONS: readonly DocumentLocationDestination[] = [
  "main-panel",
  "window-title",
  "hidden",
] as const;

export function normalizePathSeparators(path: string): string {
  return path.replace(/\\/g, "/");
}

export function pathBasename(path: string): string {
  const normalized = normalizePathSeparators(path).replace(/\/+$/, "");
  const segments = normalized.split("/");
  return segments[segments.length - 1] || normalized;
}

/**
 * Truncate from the left so the basename stays visible.
 * Uses an ellipsis prefix; never replaces the basename with folders alone.
 */
export function compactDocumentPath(
  path: string,
  maxLength: number = DOCUMENT_LOCATION_MAX_LENGTH,
): string {
  const normalized = normalizePathSeparators(path);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const basename = pathBasename(normalized);
  const prefix = ".../";
  if (prefix.length + basename.length >= maxLength) {
    return `${prefix}${basename}`;
  }

  const tailBudget = maxLength - prefix.length;
  const tail = normalized.slice(-tailBudget);
  const slash = tail.indexOf("/");
  const trimmed = slash >= 0 ? tail.slice(slash + 1) : tail;
  return `${prefix}${trimmed || basename}`;
}

export function documentLocationFromBuffer(
  buffer: DocumentLocationSource | null | undefined,
  maxLength: number = DOCUMENT_LOCATION_MAX_LENGTH,
): DocumentLocation | null {
  if (!buffer) {
    return null;
  }

  if (buffer.kind === "virtual") {
    return {
      kind: "untitled",
      label: buffer.title,
      full: buffer.title,
    };
  }

  if (buffer.rootPath && buffer.path) {
    const full = normalizePathSeparators(buffer.path);
    return {
      kind: "workspace",
      label: compactDocumentPath(full, maxLength),
      full,
    };
  }

  const full = buffer.absolutePath ? normalizePathSeparators(buffer.absolutePath) : buffer.title;
  return {
    kind: "standalone",
    label: buffer.title,
    full,
  };
}

export function showsMainPanelDocumentLocation(destination: DocumentLocationDestination): boolean {
  return destination === "main-panel";
}

/** Host window title from the same location projection. */
export function windowTitleForDocumentLocation(
  appName: string,
  location: DocumentLocation | null,
  destination: DocumentLocationDestination,
): string {
  if (destination !== "window-title" || !location) {
    return appName;
  }
  return `${appName} - ${location.label}`;
}

function pathSegments(path: string): string[] {
  return normalizePathSeparators(path).split("/").filter(Boolean);
}

/** Shortest trailing segment path that distinguishes `path` among `others`. */
export function disambiguatedRelativePath(path: string, others: readonly string[]): string {
  const segments = pathSegments(path);
  if (segments.length === 0) {
    return pathBasename(path);
  }

  for (let count = 1; count <= segments.length; count += 1) {
    const candidate = segments.slice(-count).join("/");
    const collision = others.some((other) => {
      const otherSegments = pathSegments(other);
      return otherSegments.slice(-count).join("/") === candidate;
    });
    if (!collision) {
      return candidate;
    }
  }

  return segments.join("/");
}

/**
 * Tab label: basename unless another open buffer shares that basename.
 * Collision -> add parent segments until unique, then compact if still long.
 */
export function tabLabelForBuffer(
  buffer: DocumentLocationSource,
  openBuffers: readonly DocumentLocationSource[],
  maxLength: number = 40,
): string {
  const collisions = openBuffers.filter((candidate) => candidate.title === buffer.title);
  if (collisions.length <= 1) {
    return buffer.title;
  }

  // Folder documents are told apart by folder path, others by absolute path.
  const byFolderPath = Boolean(buffer.rootPath && buffer.path);
  const pathOf = (source: DocumentLocationSource): string | null =>
    byFolderPath ? source.path : source.absolutePath;
  const full = pathOf(buffer);
  if (!full) {
    return buffer.title;
  }
  const others = collisions
    .filter((candidate) => candidate.id !== buffer.id)
    .map(pathOf)
    .filter((path): path is string => Boolean(path))
    .map(normalizePathSeparators);
  const distinguished = disambiguatedRelativePath(normalizePathSeparators(full), others);
  return compactDocumentPath(distinguished, maxLength);
}

export function tabLabelsForBuffers(
  openBuffers: readonly DocumentLocationSource[],
  maxLength: number = 40,
): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  for (const buffer of openBuffers) {
    labels.set(buffer.id, tabLabelForBuffer(buffer, openBuffers, maxLength));
  }
  return labels;
}
