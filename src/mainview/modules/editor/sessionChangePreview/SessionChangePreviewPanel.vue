<script setup lang="ts">
/**
 * Transient read-only DiffEditor for one session-change hunk.
 * Uses snippet models only - never the live document model or the marker computation host.
 */
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type * as Monaco from "monaco-editor/editor";

import AppIcon from "../../../shell/AppIcon.vue";
import { initializeMonaco } from "../monaco/monacoSetup";
import type { SessionChangePreviewPayload } from "../document/sessionChangeMarkers";

const props = defineProps<{
  payload: SessionChangePreviewPayload;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useI18n();
const hostRef = ref<HTMLDivElement | null>(null);
const closeButtonRef = ref<HTMLButtonElement | null>(null);

let diffEditor: Monaco.editor.IStandaloneDiffEditor | null = null;
let originalModel: Monaco.editor.ITextModel | null = null;
let modifiedModel: Monaco.editor.ITextModel | null = null;
let disposed = false;

function disposeDiff(): void {
  if (diffEditor) {
    diffEditor.setModel(null);
    diffEditor.dispose();
    diffEditor = null;
  }
  if (originalModel) {
    originalModel.dispose();
    originalModel = null;
  }
  if (modifiedModel) {
    modifiedModel.dispose();
    modifiedModel = null;
  }
}

function mountDiff(payload: SessionChangePreviewPayload): void {
  if (disposed || !hostRef.value) {
    return;
  }
  disposeDiff();
  const api = initializeMonaco();
  originalModel = api.editor.createModel(payload.before, "plaintext");
  modifiedModel = api.editor.createModel(payload.after, "plaintext");
  diffEditor = api.editor.createDiffEditor(hostRef.value, {
    renderSideBySide: true,
    automaticLayout: true,
    readOnly: true,
    originalEditable: false,
    enableSplitViewResizing: true,
    renderOverviewRuler: false,
    renderIndicators: true,
    ignoreTrimWhitespace: false,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    ariaLabel: t("sessionChangePreview.diff"),
  });
  diffEditor.setModel({ original: originalModel, modified: modifiedModel });
  diffEditor.getOriginalEditor().updateOptions({
    readOnly: true,
    ariaLabel: t("sessionChangePreview.before"),
  });
  diffEditor.getModifiedEditor().updateOptions({
    readOnly: true,
    ariaLabel: t("sessionChangePreview.after"),
  });
  requestAnimationFrame(() => {
    diffEditor?.layout();
  });
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    emit("close");
  }
}

watch(
  () => props.payload,
  async (payload) => {
    await nextTick();
    mountDiff(payload);
    await nextTick();
    closeButtonRef.value?.focus({ preventScroll: true });
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  disposed = true;
  disposeDiff();
});
</script>

<template>
  <aside
    class="session-change-preview"
    role="dialog"
    aria-modal="false"
    :aria-label="t('sessionChangePreview.title')"
    @keydown="onKeydown"
  >
    <header class="session-change-preview__header">
      <h2 id="session-change-preview-title" class="session-change-preview__title">
        {{ t("sessionChangePreview.title") }}
      </h2>
      <p class="session-change-preview__subtitle">
        {{ t("sessionChangePreview.subtitle") }}
      </p>
      <button
        ref="closeButtonRef"
        type="button"
        class="session-change-preview__close"
        :aria-label="t('sessionChangePreview.close')"
        @click="emit('close')"
      >
        <AppIcon name="close" :size="14" />
      </button>
    </header>
    <div
      ref="hostRef"
      class="session-change-preview__diff"
      role="region"
      :aria-label="t('sessionChangePreview.diff')"
    />
  </aside>
</template>

<style scoped lang="scss">
@use "../../../styles/colors" as *;
@use "../../../styles/variables" as *;
@use "../../../styles/page-layout" as *;

.session-change-preview {
  display: flex;
  flex-direction: column;
  gap: $space-tight;
  min-height: 12rem;
  max-height: min(40vh, 22rem);
  padding: $space-related;
  border: 1px solid $border;
  border-radius: $radius;
  background: $surface;
  color: $text-primary;
}

.session-change-preview__header {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-areas:
    "title close"
    "subtitle close";
  gap: 0.15rem $space-related;
  align-items: start;
}

.session-change-preview__title {
  grid-area: title;
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
}

.session-change-preview__subtitle {
  grid-area: subtitle;
  margin: 0;
  font-size: 0.8rem;
  color: $text-muted;
}

.session-change-preview__close {
  @include quiet-button;
  grid-area: close;
  flex-shrink: 0;
  min-width: $hit-min;
  min-height: $hit-min;
  margin: 0;
  padding: 0;
}

.session-change-preview__diff {
  flex: 1 1 auto;
  min-height: 10rem;
  height: 12rem;
  border: 1px solid $border;
  border-radius: $radius;
  overflow: hidden;
}
</style>
