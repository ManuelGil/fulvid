export type EditorTabContextAction = {
  id: string;
  label: string;
};

/** Close others only applies when another tab exists to close. */
export function editorTabContextActions(
  tabCount: number,
  labels: { close: string; closeOthers: string },
): EditorTabContextAction[] {
  const actions: EditorTabContextAction[] = [{ id: "close", label: labels.close }];
  if (tabCount > 1) {
    actions.push({ id: "close-others", label: labels.closeOthers });
  }
  return actions;
}

export function canCloseOtherEditorTabs(tabCount: number): boolean {
  return tabCount > 1;
}
