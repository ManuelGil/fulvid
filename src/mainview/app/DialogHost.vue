<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import {
  activeDialog,
  cancelDialog,
  submitConfirm,
  submitFilename,
  submitQuickOpen,
  submitText,
} from "./dialogs";
import { quickOpenCandidatesFromNotes } from "../modules/quickOpen/quickOpenCandidates";
import { matchQuickOpenCandidates } from "../modules/quickOpen/quickOpenMatch";
import { restoreUsableFocus } from "./usableFocusTarget";
import { workspace } from "./workspaceState";

const { t } = useI18n();
const dialogHostRef = ref<HTMLElement | null>(null);
const filenameInputRef = ref<HTMLInputElement | null>(null);
const filenameValue = ref("");
const confirmButtonRef = ref<HTMLButtonElement | null>(null);
const cancelButtonRef = ref<HTMLButtonElement | null>(null);
const quickOpenInputRef = ref<HTMLInputElement | null>(null);
const quickOpenQuery = ref("");
const quickOpenSelectedIndex = ref(0);
let previousFocus: HTMLElement | null = null;

/** Live Folder projection - refresh / close Folder updates the list. */
const quickOpenCandidates = computed(() => {
  if (activeDialog.value?.kind !== "quickOpen") {
    return [];
  }
  return quickOpenCandidatesFromNotes(workspace.value?.scannedNotes ?? []);
});

const quickOpenMatch = computed(() =>
  matchQuickOpenCandidates(quickOpenCandidates.value, quickOpenQuery.value),
);

const quickOpenResults = computed(() => quickOpenMatch.value.matches);
const quickOpenTotal = computed(() => quickOpenMatch.value.total);

const quickOpenActiveOptionId = computed(() => {
  if (quickOpenResults.value.length === 0) {
    return undefined;
  }
  return `quick-open-option-${quickOpenSelectedIndex.value}`;
});

const quickOpenHasFolderCandidates = computed(() => quickOpenCandidates.value.length > 0);

watch(
  activeDialog,
  async (dialog) => {
    if (!dialog) {
      await nextTick();
      restoreUsableFocus(previousFocus);
      previousFocus = null;
      return;
    }

    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    await nextTick();

    if (dialog.kind === "filename" || dialog.kind === "text") {
      filenameValue.value = dialog.value;
      const input = filenameInputRef.value;
      input?.focus({ preventScroll: true });
      input?.select();
      return;
    }

    if (dialog.kind === "quickOpen") {
      quickOpenQuery.value = "";
      quickOpenSelectedIndex.value = 0;
      quickOpenInputRef.value?.focus({ preventScroll: true });
      return;
    }

    if (dialog.kind === "confirm" && dialog.initialFocus === "cancel") {
      cancelButtonRef.value?.focus({ preventScroll: true });
      return;
    }
    confirmButtonRef.value?.focus({ preventScroll: true });
  },
  { flush: "post" },
);

// Prefer the new top match when the filter changes; clamp only when the list shrinks.
watch(quickOpenQuery, () => {
  quickOpenSelectedIndex.value = 0;
});

watch(quickOpenResults, (results) => {
  if (quickOpenSelectedIndex.value >= results.length) {
    quickOpenSelectedIndex.value = Math.max(0, results.length - 1);
  }
});

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
  if (activeDialog.value?.kind === "text") {
    submitText(filenameValue.value);
    return;
  }
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

function moveQuickOpenSelection(delta: 1 | -1): void {
  const length = quickOpenResults.value.length;
  if (length === 0) {
    return;
  }
  quickOpenSelectedIndex.value = (quickOpenSelectedIndex.value + delta + length) % length;
  document
    .getElementById(`quick-open-option-${quickOpenSelectedIndex.value}`)
    ?.scrollIntoView({ block: "nearest" });
}

function activateQuickOpenSelection(): void {
  const selected = quickOpenResults.value[quickOpenSelectedIndex.value];
  if (!selected) {
    return;
  }
  // Only paths present in the live Folder projection may be submitted.
  if (!quickOpenCandidates.value.some((candidate) => candidate.path === selected.path)) {
    return;
  }
  submitQuickOpen(selected.path);
}

function onQuickOpenKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    cancelDialog();
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveQuickOpenSelection(1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    moveQuickOpenSelection(-1);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    activateQuickOpenSelection();
  }
}

function onQuickOpenResultClick(index: number): void {
  quickOpenSelectedIndex.value = index;
  activateQuickOpenSelection();
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
        v-if="activeDialog.kind === 'filename' || activeDialog.kind === 'text'"
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
            :spellcheck="activeDialog.kind === 'text'"
            autocomplete="off"
            :maxlength="activeDialog.kind === 'text' ? activeDialog.maxLength : undefined"
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
        v-else-if="activeDialog.kind === 'quickOpen'"
        class="dialog dialog--quick-open"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-open-title"
        @keydown="onQuickOpenKeydown"
      >
        <h2 id="quick-open-title" class="dialog__title">
          {{ t("actions.quickOpen") }}
        </h2>
        <label class="dialog__field dialog__field--tight">
          <span class="visually-hidden">{{ t("quickOpen.filterLabel") }}</span>
          <input
            id="quick-open-query"
            ref="quickOpenInputRef"
            v-model="quickOpenQuery"
            class="dialog__input"
            type="text"
            spellcheck="false"
            autocomplete="off"
            :placeholder="t('quickOpen.placeholder')"
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            :aria-controls="quickOpenResults.length > 0 ? 'quick-open-results' : undefined"
            :aria-expanded="quickOpenResults.length > 0"
            :aria-activedescendant="quickOpenActiveOptionId"
          />
        </label>

        <p
          v-if="!quickOpenHasFolderCandidates"
          class="dialog__message dialog__message--compact"
          role="status"
        >
          {{ t("quickOpen.emptyFolder") }}
        </p>
        <p
          v-else-if="quickOpenResults.length === 0"
          class="dialog__message dialog__message--compact"
          role="status"
        >
          {{ t("quickOpen.noMatches") }}
        </p>
        <template v-else>
          <ul
            id="quick-open-results"
            class="quick-open-results"
            role="listbox"
            :aria-label="t('actions.quickOpen')"
          >
            <li
              v-for="(result, index) in quickOpenResults"
              :id="`quick-open-option-${index}`"
              :key="result.path"
              role="option"
              class="quick-open-results__item"
              :class="{ 'is-selected': quickOpenSelectedIndex === index }"
              :aria-selected="quickOpenSelectedIndex === index"
              @pointerdown.prevent="onQuickOpenResultClick(index)"
            >
              <span class="quick-open-results__title">{{ result.title }}</span>
              <span class="quick-open-results__path">{{ result.path }}</span>
            </li>
          </ul>
          <p
            v-if="quickOpenTotal > quickOpenResults.length"
            class="quick-open-results__limit"
            role="status"
          >
            {{
              t("quickOpen.showingLimited", {
                shown: quickOpenResults.length,
                total: quickOpenTotal,
              })
            }}
          </p>
        </template>
      </div>

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
          <button
            ref="cancelButtonRef"
            class="dialog__button dialog__button--quiet"
            type="button"
            @click="cancelDialog"
          >
            {{ t("dialog.cancel") }}
          </button>
          <button
            ref="confirmButtonRef"
            class="dialog__button"
            type="button"
            @click="submitConfirm(true)"
          >
            {{ activeDialog.confirmLabel ?? t("dialog.confirm") }}
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

  &:has(.dialog--quick-open) {
    align-items: flex-start;
    padding-top: max($space-block, 12vh);
  }
}

.dialog {
  width: min(24rem, calc(100vw - 2rem));
  padding: $space-block;
  border: 1px solid $border-subtle;
  border-radius: $radius-lg;
  background: $surface-elevated;
  box-shadow: $shadow-elevated;
}

.dialog--quick-open {
  width: min(32rem, calc(100vw - 2rem));
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

.dialog__field--tight {
  margin-bottom: $space-compact;
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

.dialog__message--compact {
  margin-bottom: 0;
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

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.quick-open-results {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: min(22rem, 50vh);
  overflow: auto;
  border: 1px solid $border-subtle;
  border-radius: $radius;
}

.quick-open-results__item {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: $space-related $space-compact;
  cursor: pointer;
  border-bottom: 1px solid $border-subtle;

  &:last-child {
    border-bottom: 0;
  }

  &.is-selected {
    background: color-mix(in srgb, $accent 22%, $surface-elevated);
  }

  @media (forced-colors: active) {
    &.is-selected {
      outline: 2px solid Highlight;
      outline-offset: -2px;
    }
  }
}

.quick-open-results__title {
  color: $text-primary;
  font-size: $font-control;
  font-weight: 500;
  line-height: 1.35;
}

.quick-open-results__path {
  color: $text-secondary;
  font-family: $font-mono;
  font-size: $font-label;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.quick-open-results__limit {
  margin: $space-related 0 0;
  color: $text-secondary;
  font-size: $font-label;
  line-height: 1.35;
}
</style>
