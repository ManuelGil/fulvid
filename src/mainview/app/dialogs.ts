/**
 * Small promise-based dialogs for filename input, plain text, confirmation, and Quick Open.
 * Rendered by DialogHost.vue - not a modal framework.
 */
import { shallowRef } from "vue";

export type FilenamePromptRequest = {
  kind: "filename";
  title: string;
  label: string;
  value: string;
  resolve: (value: string | null) => void;
};

export type TextPromptRequest = {
  kind: "text";
  title: string;
  label: string;
  value: string;
  maxLength: number;
  resolve: (value: string | null) => void;
};

export type ConfirmPromptRequest = {
  kind: "confirm";
  title?: string;
  message: string;
  /** Defaults to the shared Confirm label. */
  confirmLabel?: string;
  /** Which action receives initial focus. Defaults to confirm. */
  initialFocus?: "confirm" | "cancel";
  resolve: (value: boolean) => void;
};

export type ConfirmDialogOptions = {
  title?: string;
  confirmLabel?: string;
  initialFocus?: "confirm" | "cancel";
};

export type QuickOpenPromptRequest = {
  kind: "quickOpen";
  resolve: (path: string | null) => void;
};

export type DialogRequest =
  FilenamePromptRequest | TextPromptRequest | ConfirmPromptRequest | QuickOpenPromptRequest;

export const activeDialog = shallowRef<DialogRequest | null>(null);

function dismissCurrentDialog(): void {
  const current = activeDialog.value;
  if (!current) {
    return;
  }
  if (current.kind === "filename" || current.kind === "text" || current.kind === "quickOpen") {
    current.resolve(null);
  } else {
    current.resolve(false);
  }
}

function replaceDialog(next: DialogRequest): void {
  dismissCurrentDialog();
  activeDialog.value = next;
}

export function promptFilename(options: {
  title: string;
  label: string;
  initialValue?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    replaceDialog({
      kind: "filename",
      title: options.title,
      label: options.label,
      value: options.initialValue ?? "",
      resolve,
    });
  });
}

/** Plain-text prompt for short session notes (annotations). Not a form framework. */
export function promptText(options: {
  title: string;
  label: string;
  initialValue?: string;
  maxLength: number;
}): Promise<string | null> {
  return new Promise((resolve) => {
    replaceDialog({
      kind: "text",
      title: options.title,
      label: options.label,
      value: options.initialValue ?? "",
      maxLength: options.maxLength,
      resolve,
    });
  });
}

export function confirmDialog(
  message: string,
  titleOrOptions?: string | ConfirmDialogOptions,
): Promise<boolean> {
  const options =
    typeof titleOrOptions === "string" ? { title: titleOrOptions } : (titleOrOptions ?? {});
  return new Promise((resolve) => {
    replaceDialog({
      kind: "confirm",
      title: options.title,
      message,
      confirmLabel: options.confirmLabel,
      initialFocus: options.initialFocus,
      resolve,
    });
  });
}

/**
 * Open Quick Open. Resolves to a folder-relative path from the live Folder scan,
 * or null when cancelled. DialogHost projects `workspace.scannedNotes`.
 */
export function promptQuickOpen(): Promise<string | null> {
  return new Promise((resolve) => {
    replaceDialog({
      kind: "quickOpen",
      resolve,
    });
  });
}

function closeDialog(): void {
  activeDialog.value = null;
}

export function cancelDialog(): void {
  const current = activeDialog.value;
  if (!current) {
    return;
  }
  closeDialog();
  if (current.kind === "filename" || current.kind === "text" || current.kind === "quickOpen") {
    current.resolve(null);
  } else {
    current.resolve(false);
  }
}

export function submitFilename(value: string): void {
  const current = activeDialog.value;
  if (!current || current.kind !== "filename") {
    return;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }
  closeDialog();
  current.resolve(trimmed);
}

export function submitText(value: string): void {
  const current = activeDialog.value;
  if (!current || current.kind !== "text") {
    return;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }
  const limited = current.maxLength > 0 ? trimmed.slice(0, current.maxLength) : trimmed;
  closeDialog();
  current.resolve(limited);
}

export function submitConfirm(confirmed: boolean): void {
  const current = activeDialog.value;
  if (!current || current.kind !== "confirm") {
    return;
  }
  closeDialog();
  current.resolve(confirmed);
}

/**
 * Accept a Quick Open selection. Callers must pass a path from the live
 * candidate list (DialogHost); this is a selection hand-off, not a grant.
 */
export function submitQuickOpen(path: string): void {
  const current = activeDialog.value;
  if (!current || current.kind !== "quickOpen" || !path) {
    return;
  }
  closeDialog();
  current.resolve(path);
}
