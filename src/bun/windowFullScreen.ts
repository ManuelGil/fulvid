/**
 * One host capability: toggle native BrowserWindow fullscreen.
 * Fail closed. Do not invent a web or maximize fallback.
 */
export function toggleNativeFullScreen(window: {
  isFullScreen(): boolean;
  setFullScreen(fullScreen: boolean): void;
}): boolean {
  try {
    const next = !window.isFullScreen();
    window.setFullScreen(next);
    return window.isFullScreen();
  } catch {
    return false;
  }
}

/** Fullscreen frames must never be written to window-frame.json. */
export function canPersistWindowFrame(isFullScreen: boolean): boolean {
  return !isFullScreen;
}
