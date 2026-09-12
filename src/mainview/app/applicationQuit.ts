/**
 * Quit may call the host quit RPC only after the same confirmClose gate
 * used when closing dirty tabs. Dirty state stays in documentBuffers;
 * confirmation UI stays in dialogs; this file is not a lifecycle owner.
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
