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

export function notify(message: string, options: { tone?: ToastTone; ms?: number } = {}): void {
  const id = nextId++;
  const toast: Toast = {
    id,
    message,
    tone: options.tone ?? "success",
  };

  toasts.value = [...toasts.value, toast].slice(-MAX_VISIBLE);

  const timer = setTimeout(() => {
    dismissToast(id);
  }, options.ms ?? DEFAULT_MS);
  dismissTimers.set(id, timer);
}

export function dismissToast(id: number): void {
  const timer = dismissTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    dismissTimers.delete(id);
  }
  toasts.value = toasts.value.filter((toast) => toast.id !== id);
}
