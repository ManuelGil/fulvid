/**
 * Lightweight session toasts - unobtrusive, self-dismissing, no modals.
 */
import { ref } from "vue";

export type ToastTone = "neutral" | "success";

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

const MAX_VISIBLE = 3;
const DEFAULT_MS = 2200;

let nextId = 1;
const dismissTimers = new Map<number, ReturnType<typeof setTimeout>>();

export const toasts = ref<Toast[]>([]);

/** Clear the auto-dismiss timer for a toast id without mutating the list. */
function clearDismissTimer(id: number): void {
  const timer = dismissTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    dismissTimers.delete(id);
  }
}

/**
 * Drop toasts that fell off the visible cap and cancel their timers so a
 * notify burst cannot leave orphan setTimeout entries in dismissTimers.
 */
function pruneOverflowTimers(visible: readonly Toast[]): void {
  const visibleIds = new Set(visible.map((toast) => toast.id));
  for (const id of [...dismissTimers.keys()]) {
    if (!visibleIds.has(id)) {
      clearDismissTimer(id);
    }
  }
}

export function notify(message: string, options: { tone?: ToastTone; ms?: number } = {}): void {
  const id = nextId++;
  const toast: Toast = {
    id,
    message,
    tone: options.tone ?? "success",
  };

  const nextVisible = [...toasts.value, toast].slice(-MAX_VISIBLE);
  pruneOverflowTimers(nextVisible);
  toasts.value = nextVisible;

  const timer = setTimeout(() => {
    dismissToast(id);
  }, options.ms ?? DEFAULT_MS);
  dismissTimers.set(id, timer);
}

export function dismissToast(id: number): void {
  clearDismissTimer(id);
  toasts.value = toasts.value.filter((toast) => toast.id !== id);
}

/** Test seam: number of live auto-dismiss timers (should stay ≤ MAX_VISIBLE). */
export function activeToastTimerCount(): number {
  return dismissTimers.size;
}
