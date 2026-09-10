<script setup lang="ts">
import { computed, nextTick, ref, useId } from "vue";
import { useI18n } from "vue-i18n";

import type { DocumentBuffer } from "./document/documentBuffers";
import { isDocumentDirty } from "./document/documentBuffers";
import ContextMenu, { type ContextMenuAction } from "../../shell/ContextMenu.vue";
import AppIcon from "../../shell/AppIcon.vue";

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

const menuActions = computed<readonly ContextMenuAction[]>(() => [
  { id: "close", label: t("actions.close") },
  { id: "close-others", label: t("tabs.closeOthers") },
]);

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

function onTabKeydown(event: KeyboardEvent, index: number): void {
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
    const buffer = props.buffers[index];
    if (!buffer) {
      return;
    }
    event.preventDefault();
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    menuTarget.value = buffer.id;
    menuX.value = bounds.left;
    menuY.value = bounds.bottom;
    menuOpen.value = true;
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

function onTabContextMenu(event: MouseEvent, id: string): void {
  event.preventDefault();
  (event.currentTarget as HTMLElement).querySelector<HTMLButtonElement>('[role="tab"]')?.focus();
  menuTarget.value = id;
  menuX.value = event.clientX;
  menuY.value = event.clientY;
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
        v-for="buffer in buffers"
        :key="buffer.id"
        class="editor-tabs__item"
        role="presentation"
        @contextmenu="onTabContextMenu($event, buffer.id)"
      >
        <button
          :id="activeId === buffer.id ? 'active-document-tab' : tabId(buffers.indexOf(buffer))"
          :ref="(element) => setTabElement(buffer.id, element)"
          class="editor-tabs__tab"
          type="button"
          role="tab"
          :aria-selected="activeId === buffer.id"
          :tabindex="activeId === buffer.id ? 0 : -1"
          :aria-label="
            isDocumentDirty(buffer) ? `${buffer.title}, ${t('tabs.unsavedChanges')}` : buffer.title
          "
          aria-haspopup="menu"
          :aria-expanded="menuOpen && menuTarget === buffer.id"
          aria-controls="document-editor-panel"
          :title="buffer.absolutePath ?? buffer.title"
          @keydown="onTabKeydown($event, buffers.indexOf(buffer))"
          @click="emit('activate', buffer.id)"
        >
          <span class="editor-tabs__title">{{ buffer.title }}</span>
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
          :aria-label="t('tabs.close', { name: buffer.title })"
          @click="closeTab(buffer.id)"
        >
          <AppIcon name="close" :size="13" />
        </button>
      </div>
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
}

.editor-tabs__item:has([aria-selected="true"]) {
  border-bottom-color: $accent;
  background: transparent;
  box-shadow: none;
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
