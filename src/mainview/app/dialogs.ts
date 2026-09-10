/**
 * Small promise-based dialogs for filename input and confirmation.
 * Rendered by DialogHost.vue — not a modal framework.
 */
import { shallowRef } from "vue";

export type FilenamePromptRequest = {
  kind: "filename";
  title: string;
  label: string;
  value: string;
  resolve: (value: string | null) => void;
};

export type ConfirmPromptRequest = {
  kind: "confirm";
  title?: string;
  message: string;
  resolve: (value: boolean) => void;
};

export type DialogRequest = FilenamePromptRequest | ConfirmPromptRequest;

export const activeDialog = shallowRef<DialogRequest | null>(null);

function replaceDialog(next: DialogRequest): void {
  const current = activeDialog.value;
  if (current) {
    if (current.kind === "filename") {
      current.resolve(null);
    } else {
      current.resolve(false);
    }
  }
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

export function confirmDialog(message: string, title?: string): Promise<boolean> {
  return new Promise((resolve) => {
    replaceDialog({
      kind: "confirm",
      title,
      message,
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
  if (current.kind === "filename") {
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

export function submitConfirm(confirmed: boolean): void {
  const current = activeDialog.value;
  if (!current || current.kind !== "confirm") {
    return;
  }
  closeDialog();
  current.resolve(confirmed);
}
