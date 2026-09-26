<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";

import type { DocumentBuffer } from "./document/documentBuffers";
import { isDocumentDirty, reorderOpenDocuments } from "./document/documentBuffers";
import { documentLocationFromBuffer, tabLabelsForBuffers } from "./document/documentLocation";
import ContextMenu from "../../shell/ContextMenu.vue";
import AppIcon from "../../shell/AppIcon.vue";
import { canCloseOtherEditorTabs, editorTabContextActions } from "./editorTabContextMenu";
import { adjacentTabReorderIndex, tabDropReorderIndex } from "./editorTabReorder";
import { revealTabInOverflowStrip, shouldCloseTabOnAuxClick } from "./editorTabStrip";

const { t } = useI18n();
const tabIdPrefix = useId();

const props = defineProps<{
  buffers: readonly DocumentBuffer[];
  activeId: string | null;
}>();

const emit = defineEmits<{
  activate: [id: string];
  close: [id: string];
  new: [];
  closeOthers: [id: string];
}>();

const tabElements = new Map<string, HTMLButtonElement>();
const menuOpen = ref(false);
const menuX = ref(0);
const menuY = ref(0);
const menuTarget = ref<string | null>(null);
/** Index of the dragged tab while a pointer reorder is in progress. */
const dragFromIndex = ref<number | null>(null);
/** Insertion marker: line before this index, or `buffers.length` for end. */
const dropMarkerIndex = ref<number | null>(null);
/** Suppress the click that follows a completed drag. */
const suppressNextActivate = ref(false);

const tabLabels = computed(() => tabLabelsForBuffers(props.buffers));

function tabLabel(buffer: DocumentBuffer): string {
  return tabLabels.value.get(buffer.id) ?? buffer.title;
}

function tabTooltip(buffer: DocumentBuffer): string {
  return documentLocationFromBuffer(buffer)?.full ?? buffer.title;
}

const menuActions = computed(() =>
  editorTabContextActions(props.buffers.length, {
    close: t("actions.close"),
    closeOthers: t("tabs.closeOthers"),
  }),
);

function tabId(index: number): string {
  return `${tabIdPrefix}-tab-${index}`;
}

function setTabElement(id: string, element: unknown): void {
  if (element instanceof HTMLButtonElement) {
    tabElements.set(id, element);
  } else {
    tabElements.delete(id);
  }
}

function focusTab(id: string): void {
  void nextTick(() => tabElements.get(id)?.focus());
}

function focusActiveTab(): void {
  if (props.activeId) {
    focusTab(props.activeId);
  }
}

function revealActiveTabInStrip(): void {
  if (!props.activeId) {
    return;
  }
  revealTabInOverflowStrip(tabElements.get(props.activeId));
}

watch(
  () => props.activeId,
  (id) => {
    if (!id) {
      return;
    }
    void nextTick(() => revealActiveTabInStrip());
  },
  { immediate: true },
);

function moveFocusedTab(index: number, direction: -1 | 1): void {
  const toIndex = adjacentTabReorderIndex(index, direction, props.buffers.length);
  if (toIndex === null) {
    return;
  }
  const buffer = props.buffers[index];
  if (!buffer) {
    return;
  }
  if (!reorderOpenDocuments(index, toIndex)) {
    return;
  }
  focusTab(buffer.id);
}

function onTabKeydown(event: KeyboardEvent, index: number): void {
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
    const buffer = props.buffers[index];
    if (!buffer) {
      return;
    }
    event.preventDefault();
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    openTabMenu(buffer.id, bounds.left, bounds.bottom);
    return;
  }
  if (
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    (event.key === "ArrowLeft" || event.key === "ArrowRight")
  ) {
    event.preventDefault();
    moveFocusedTab(index, event.key === "ArrowLeft" ? -1 : 1);
    return;
  }
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    return;
  }

  event.preventDefault();
  const lastIndex = props.buffers.length - 1;
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? lastIndex
        : event.key === "ArrowRight"
          ? Math.min(index + 1, lastIndex)
          : Math.max(index - 1, 0);
  const nextBuffer = props.buffers[nextIndex];
  if (!nextBuffer) {
    return;
  }
  emit("activate", nextBuffer.id);
  focusTab(nextBuffer.id);
}

function onTabActivate(id: string): void {
  if (suppressNextActivate.value) {
    suppressNextActivate.value = false;
    return;
  }
  emit("activate", id);
}

function onTabContextMenu(event: MouseEvent, id: string): void {
  event.preventDefault();
  (event.currentTarget as HTMLElement).querySelector<HTMLButtonElement>('[role="tab"]')?.focus();
  openTabMenu(id, event.clientX, event.clientY);
}

function openTabMenu(id: string, x: number, y: number): void {
  menuTarget.value = id;
  menuX.value = x;
  menuY.value = y;
  menuOpen.value = true;
}

function onMenuSelect(id: string): void {
  const target = menuTarget.value;
  menuOpen.value = false;
  if (!target) {
    return;
  }
  if (id === "close") {
    emit("close", target);
  } else if (id === "close-others") {
    if (!canCloseOtherEditorTabs(props.buffers.length)) {
      return;
    }
    emit("closeOthers", target);
  }
  focusActiveTab();
}

function closeMenu(): void {
  menuOpen.value = false;
  menuTarget.value = null;
}

function closeTab(id: string): void {
  emit("close", id);
  focusActiveTab();
}

function onTabAuxClick(event: MouseEvent, id: string): void {
  if (!shouldCloseTabOnAuxClick(event)) {
    return;
  }
  event.preventDefault();
  closeTab(id);
}

function clearDragState(): void {
  dragFromIndex.value = null;
  dropMarkerIndex.value = null;
}

function onTabDragStart(event: DragEvent, index: number): void {
  const target = event.target;
  if (target instanceof Element && target.closest(".editor-tabs__close")) {
    event.preventDefault();
    return;
  }
  if (!event.dataTransfer || props.buffers.length < 2) {
    event.preventDefault();
    return;
  }
  dragFromIndex.value = index;
  dropMarkerIndex.value = index;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", props.buffers[index]?.id ?? "");
}

function onTabDragOver(event: DragEvent, overIndex: number): void {
  if (dragFromIndex.value === null) {
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }
  const item = event.currentTarget as HTMLElement;
  const rect = item.getBoundingClientRect();
  const placeAfter = event.clientX > rect.left + rect.width / 2;
  dropMarkerIndex.value = placeAfter ? overIndex + 1 : overIndex;
}

function onTabDrop(event: DragEvent, overIndex: number): void {
  event.preventDefault();
  const fromIndex = dragFromIndex.value;
  if (fromIndex === null) {
    clearDragState();
    return;
  }
  const item = event.currentTarget as HTMLElement;
  const rect = item.getBoundingClientRect();
  const placeAfter = event.clientX > rect.left + rect.width / 2;
  const toIndex = tabDropReorderIndex(fromIndex, overIndex, placeAfter);
  clearDragState();
  if (toIndex === fromIndex) {
    return;
  }
  if (reorderOpenDocuments(fromIndex, toIndex)) {
    suppressNextActivate.value = true;
  }
}

function onTabDragEnd(): void {
  clearDragState();
}

defineExpose({ focusActiveTab });
</script>

<template>
  <div class="editor-tabs">
    <div
      class="editor-tabs__list"
      role="tablist"
      aria-orientation="horizontal"
      :aria-label="t('tabs.openDocuments')"
    >
      <div
        v-for="(buffer, index) in buffers"
        :key="buffer.id"
        class="editor-tabs__item"
        :class="{
          'editor-tabs__item--drop-before':
            dropMarkerIndex === index && dragFromIndex !== null && dragFromIndex !== index,
          'editor-tabs__item--dragging': dragFromIndex === index,
        }"
        role="presentation"
        draggable="true"
        @contextmenu="onTabContextMenu($event, buffer.id)"
        @auxclick="onTabAuxClick($event, buffer.id)"
        @dragstart="onTabDragStart($event, index)"
        @dragover="onTabDragOver($event, index)"
        @drop="onTabDrop($event, index)"
        @dragend="onTabDragEnd"
      >
        <button
          :id="activeId === buffer.id ? 'active-document-tab' : tabId(index)"
          :ref="(element) => setTabElement(buffer.id, element)"
          class="editor-tabs__tab"
          type="button"
          role="tab"
          :aria-selected="activeId === buffer.id"
          :tabindex="activeId === buffer.id ? 0 : -1"
          :aria-label="
            isDocumentDirty(buffer)
              ? `${tabLabel(buffer)}, ${t('tabs.unsavedChanges')}`
              : tabLabel(buffer)
          "
          aria-haspopup="menu"
          :aria-expanded="menuOpen && menuTarget === buffer.id"
          aria-controls="document-editor-panel"
          :title="tabTooltip(buffer)"
          @keydown="onTabKeydown($event, index)"
          @click="onTabActivate(buffer.id)"
        >
          <span class="editor-tabs__title">{{ tabLabel(buffer) }}</span>
          <span
            v-if="isDocumentDirty(buffer)"
            class="editor-tabs__dirty"
            :aria-label="t('tabs.unsavedChanges')"
          >
            <AppIcon name="dirty" :size="12" />
          </span>
        </button>
        <button
          class="editor-tabs__close"
          type="button"
          :aria-label="t('tabs.close', { name: tabLabel(buffer) })"
          @click="closeTab(buffer.id)"
        >
          <AppIcon name="close" :size="13" />
        </button>
      </div>
      <div
        v-if="dropMarkerIndex === buffers.length && dragFromIndex !== null"
        class="editor-tabs__drop-end"
        aria-hidden="true"
      />
    </div>
    <button
      class="editor-tabs__new"
      type="button"
      :title="t('actions.newDocument')"
      :aria-label="t('actions.newDocument')"
      @click="emit('new')"
    >
      <AppIcon name="add" :size="14" />
    </button>
  </div>
  <ContextMenu
    :open="menuOpen"
    :x="menuX"
    :y="menuY"
    :actions="menuActions"
    :label="t('tabs.contextMenu')"
    @select="onMenuSelect"
    @close="closeMenu"
  />
</template>

<style scoped lang="scss">
@use "../../styles/colors" as *;
@use "../../styles/variables" as *;

.editor-tabs {
  display: flex;
  align-items: center;
  gap: $space-related;
  min-width: 0;
  padding-inline: $space-compact $space-related;
  border-bottom: 1px solid $border-subtle;
  background: $surface;
}

.editor-tabs__list {
  display: flex;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
}

.editor-tabs__item {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: stretch;
  border-bottom: 2px solid transparent;
}

.editor-tabs__item--drop-before {
  box-shadow: inset 2px 0 0 $accent;
}

.editor-tabs__item--dragging {
  opacity: 0.55;
}

.editor-tabs__drop-end {
  flex: 0 0 auto;
  width: 2px;
  align-self: stretch;
  background: $accent;
}

.editor-tabs__tab,
.editor-tabs__close {
  border: 0;
  background: transparent;
  color: $text-secondary;
  font: inherit;
  cursor: pointer;
}

.editor-tabs__new {
  flex: 0 0 auto;
  width: $hit-min;
  min-height: $hit-min;
  border: 0;
  border-radius: $radius;
  background: transparent;
  color: $text-secondary;
  font-size: $font-section;
  cursor: pointer;

  &:hover {
    background: $surface-hover;
    color: $text-primary;
  }

  &:focus-visible {
    outline: 2px solid $focus-ring;
    outline-offset: -2px;
  }
}

.editor-tabs__tab {
  display: inline-flex;
  align-items: center;
  gap: $space-related;
  min-width: 0;
  min-height: $control-height;
  padding: 0 $space-3;
  font-size: $font-label;

  &:hover {
    color: $text-primary;
  }

  &:focus-visible {
    outline: 2px solid $focus-ring;
    outline-offset: -2px;
  }
}

.editor-tabs__item:has([aria-selected="true"]) {
  border-bottom-color: $accent;
  background: transparent;
  box-shadow: none;
}

.editor-tabs__item:has([aria-selected="true"]).editor-tabs__item--drop-before {
  box-shadow: inset 2px 0 0 $accent;
}

.editor-tabs__item:has([aria-selected="true"]) .editor-tabs__tab {
  color: $text-primary;
}

.editor-tabs__title {
  max-width: 16rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-tabs__dirty {
  display: inline-flex;
  color: $warning-text;
}

.editor-tabs__close {
  width: $hit-min;
  min-height: $hit-min;
  color: $text-muted;
  font-size: $font-section;

  &:hover {
    color: $text-primary;
    background: $surface-hover;
  }

  &:focus-visible {
    outline: 2px solid $focus-ring;
    outline-offset: -2px;
  }
}
</style>
