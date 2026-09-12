/**
 * One host capability: set the BrowserWindow title.
 * Fail closed. Presentation only - never grants filesystem access.
 */

const MAX_WINDOW_TITLE_LENGTH = 512;

/** Reject empty, oversized, or control-bearing titles from the renderer. */
export function isPresentableWindowTitle(title: unknown): title is string {
  if (typeof title !== "string") {
    return false;
  }
  if (title.length === 0 || title.length > MAX_WINDOW_TITLE_LENGTH || title.trim().length === 0) {
    return false;
  }
  for (let i = 0; i < title.length; i += 1) {
    const code = title.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return false;
    }
  }
  return true;
}

export function setNativeWindowTitle(
  window: { setTitle(title: string): void } | null | undefined,
  title: string,
): boolean {
  if (!window || !isPresentableWindowTitle(title)) {
    return false;
  }
  try {
    window.setTitle(title);
    return true;
  } catch {
    return false;
  }
}
