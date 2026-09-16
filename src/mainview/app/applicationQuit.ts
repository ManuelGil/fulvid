/**
 * Quit confirmation gate - not a lifecycle or dirty-state owner.
 *
 * documentBuffers -> dirty count; dialogs -> confirm UI; this module -> whether
 * to ask; host -> native quit. Menu Quit and OS window close (host `will-close`
 * veto -> `windowCloseRequested`) share this gate. Menu Quit stays a command
 * (not OS quit role). Do not duplicate dirty state here.
 */
export function shouldConfirmQuit(options: {
  dirtyCount: number;
  confirmCloseEnabled: boolean;
}): boolean {
  return options.confirmCloseEnabled && options.dirtyCount > 0;
}

/** @returns true when the host quit ran */
export async function confirmAndQuit(options: {
  dirtyCount: number;
  confirmCloseEnabled: boolean;
  confirm: () => Promise<boolean>;
  quit: () => Promise<void>;
}): Promise<boolean> {
  if (shouldConfirmQuit(options) && !(await options.confirm())) {
    return false;
  }
  await options.quit();
  return true;
}
