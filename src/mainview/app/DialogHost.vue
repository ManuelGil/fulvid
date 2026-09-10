<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { activeDialog, cancelDialog, submitConfirm, submitFilename } from "./dialogs";

const { t } = useI18n();
const dialogHostRef = ref<HTMLElement | null>(null);
const filenameInputRef = ref<HTMLInputElement | null>(null);
const filenameValue = ref("");
const confirmButtonRef = ref<HTMLButtonElement | null>(null);
let previousFocus: HTMLElement | null = null;

watch(
  activeDialog,
  async (dialog) => {
    if (!dialog) {
      await nextTick();
      if (previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
      previousFocus = null;
      return;
    }

    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    await nextTick();

    if (dialog.kind === "filename") {
      filenameValue.value = dialog.value;
      const input = filenameInputRef.value;
      input?.focus({ preventScroll: true });
      input?.select();
    } else {
      confirmButtonRef.value?.focus({ preventScroll: true });
    }
  },
  { flush: "post" },
);

function dialogFocusableElements(): HTMLElement[] {
  const host = dialogHostRef.value;
  if (!host) {
    return [];
  }

  return [
    ...host.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]",
    ),
  ].filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
}

function onDialogKeydown(event: KeyboardEvent): void {
  if (event.key !== "Tab") {
    return;
  }

  const focusable = dialogFocusableElements();
  if (focusable.length === 0) {
    return;
  }

  const currentIndex = focusable.indexOf(
    document.activeElement instanceof HTMLElement ? document.activeElement : focusable[0],
  );
  const isLeavingForward =
    !event.shiftKey && (currentIndex < 0 || currentIndex === focusable.length - 1);
  const isLeavingBackward = event.shiftKey && (currentIndex < 0 || currentIndex <= 0);
  if (!isLeavingForward && !isLeavingBackward) {
    return;
  }

  event.preventDefault();
  const nextIndex = event.shiftKey ? focusable.length - 1 : 0;
  focusable[nextIndex]?.focus({ preventScroll: true });
}

function onFilenameSubmit(): void {
  submitFilename(filenameValue.value);
}

function onFilenameKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    cancelDialog();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    onFilenameSubmit();
  }
}

function onConfirmKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    cancelDialog();
  }
}

function onBackdropPointerDown(event: PointerEvent): void {
  if (event.target === event.currentTarget) {
    cancelDialog();
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="activeDialog"
      ref="dialogHostRef"
      class="dialog-host"
      @pointerdown="onBackdropPointerDown"
      @keydown.stop="onDialogKeydown"
    >
      <form
        v-if="activeDialog.kind === 'filename'"
        class="dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="'dialog-title'"
        @submit.prevent="onFilenameSubmit"
        @keydown="onFilenameKeydown"
      >
        <h2 id="dialog-title" class="dialog__title">
          {{ activeDialog.title }}
        </h2>
        <label class="dialog__field">
          <span class="dialog__label">{{ activeDialog.label }}</span>
          <input
            ref="filenameInputRef"
            v-model="filenameValue"
            class="dialog__input"
            type="text"
            spellcheck="false"
            autocomplete="off"
          />
        </label>
        <div class="dialog__actions">
          <button class="dialog__button dialog__button--quiet" type="button" @click="cancelDialog">
            {{ t("dialog.cancel") }}
          </button>
          <button class="dialog__button" type="submit" :disabled="!filenameValue.trim()">
            {{ t("dialog.confirm") }}
          </button>
        </div>
      </form>

      <div
        v-else
        class="dialog"
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="activeDialog.title ? 'dialog-title' : 'dialog-message'"
        :aria-describedby="activeDialog.title ? 'dialog-message' : undefined"
        @keydown="onConfirmKeydown"
      >
        <h2 v-if="activeDialog.title" id="dialog-title" class="dialog__title">
          {{ activeDialog.title }}
        </h2>
        <p id="dialog-message" class="dialog__message">
          {{ activeDialog.message }}
        </p>
        <div class="dialog__actions">
          <button class="dialog__button dialog__button--quiet" type="button" @click="cancelDialog">
            {{ t("dialog.cancel") }}
          </button>
          <button
            ref="confirmButtonRef"
            class="dialog__button"
            type="button"
            @click="submitConfirm(true)"
          >
            {{ t("dialog.confirm") }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
@use "../styles/colors" as *;
@use "../styles/variables" as *;
@use "../styles/controls" as *;
@use "../styles/page-layout" as *;

.dialog-host {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: $space-block;
  background: $overlay;
}

.dialog {
  width: min(24rem, calc(100vw - 2rem));
  padding: $space-block;
  border: 1px solid $border-subtle;
  border-radius: $radius-lg;
  background: $surface-elevated;
  box-shadow: $shadow-elevated;
}

.dialog__title {
  margin: 0 0 $space-compact;
  color: $text-primary;
  font-size: $font-lead;
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 1.35;
}

.dialog__field {
  display: flex;
  flex-direction: column;
  gap: $space-related;
  margin-bottom: $space-block;
}

.dialog__label {
  color: $text-secondary;
  font-size: $font-label;
  font-weight: 500;
  line-height: 1.35;
}

.dialog__input {
  @include control-field;
  width: 100%;
  font-family: $font-mono;
  font-size: $font-control;
}

.dialog__message {
  margin: 0 0 $space-block;
  color: $text-secondary;
  font-size: $font-control;
  line-height: 1.5;
  white-space: pre-wrap;
}

.dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: $space-related;
}

.dialog__button {
  @include action-button;
  min-width: 5.5rem;
}

.dialog__button--quiet {
  @include quiet-button;
  min-width: 5.5rem;
}
</style>
