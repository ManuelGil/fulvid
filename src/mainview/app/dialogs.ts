/**
 * Small promise-based dialogs for filename input, confirmation, and Quick Open.
 * Rendered by DialogHost.vue — not a modal framework.
 */
import { shallowRef } from "vue";

import type { QuickOpenCandidate } from "../modules/quickOpen/quickOpenCandidates";

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

export type QuickOpenPromptRequest = {
  kind: "quickOpen";
  candidates: readonly QuickOpenCandidate[];
  resolve: (path: string | null) => void;
};

export type DialogRequest = FilenamePromptRequest | ConfirmPromptRequest | QuickOpenPromptRequest;

export const activeDialog = shallowRef<DialogRequest | null>(null);

function dismissCurrentDialog(): void {
  const current = activeDialog.value;
  if (!current) {
    return;
  }
  if (current.kind === "filename" || current.kind === "quickOpen") {
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

/**
 * Open Quick Open over a snapshot of folder candidates.
 * Resolves to a folder-relative path, or null when cancelled.
 */
export function promptQuickOpen(candidates: readonly QuickOpenCandidate[]): Promise<string | null> {
  return new Promise((resolve) => {
    replaceDialog({
      kind: "quickOpen",
      candidates,
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
  if (current.kind === "filename" || current.kind === "quickOpen") {
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

/** Accept a Quick Open selection. `path` must come from the candidate list. */
export function submitQuickOpen(path: string): void {
  const current = activeDialog.value;
  if (!current || current.kind !== "quickOpen") {
    return;
  }
  if (!current.candidates.some((candidate) => candidate.path === path)) {
    return;
  }
  closeDialog();
  current.resolve(path);
}
