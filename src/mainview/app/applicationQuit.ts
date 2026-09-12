/**
 * Quit confirmation against dirty buffers.
 *
 * Dirty ownership stays in documentBuffers. Confirmation UI stays in dialogs.
 * This module only decides whether Quit may call the host quit RPC.
 */
export function shouldConfirmQuit(options: {
  dirtyCount: number;
  confirmCloseEnabled: boolean;
}): boolean {
  return options.confirmCloseEnabled && options.dirtyCount > 0;
}

/**
 * Run Quit after the same confirmClose gate used for closing dirty tabs.
 * Returns whether the host quit ran.
 */
export async function confirmAndQuit(options: {
  dirtyCount: number;
  confirmCloseEnabled: boolean;
  confirm: () => Promise<boolean>;
  quit: () => Promise<void>;
}): Promise<boolean> {
  if (
    shouldConfirmQuit({
      dirtyCount: options.dirtyCount,
      confirmCloseEnabled: options.confirmCloseEnabled,
    })
  ) {
    if (!(await options.confirm())) {
      return false;
    }
  }
  await options.quit();
  return true;
}
