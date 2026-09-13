<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import AppIcon from "./AppIcon.vue";
import ContextMenu, { type ContextMenuAction } from "./ContextMenu.vue";
import { editorCommandState } from "../modules/editor/editorCommandState";
import { activeBuffer } from "../modules/editor/document/documentBuffers";
import { writingFocusActive } from "../modules/editor/writingFocus";
import {
  documentAnnotationQuickActionLabelKey,
  documentAnnotationQuickActionMode,
} from "../modules/editor/document/documentAnnotations";
import {
  orderQuickActionsInGroup,
  quickActionGroupOrder,
  quickActions,
  selectQuickActionsForVisibleCount,
  toAriaKeyshortcuts,
  type CommandId,
  type QuickActionDefinition,
} from "./commands";
import { settings } from "../modules/settings/settingsStore";

const props = defineProps<{
  explorerOpen: boolean;
  runCommand: (id: CommandId) => void | Promise<void>;
}>();

const { t } = useI18n();
const toolbarRef = ref<HTMLElement | null>(null);
const overflowOpen = ref(false);
const overflowX = ref(0);
const overflowY = ref(0);
const visibleCount = ref(quickActions.length);
let resizeObserver: ResizeObserver | null = null;

const visibleActions = computed(() =>
  selectQuickActionsForVisibleCount(quickActions, visibleCount.value),
);
const overflowActions = computed(() => {
  const visibleIds = new Set(visibleActions.value.map((action) => action.id));
  const hidden = quickActions.filter((action) => !visibleIds.has(action.id));
  return quickActionGroupOrder.flatMap((group) =>
    orderQuickActionsInGroup(hidden.filter((action) => action.group === group)),
  );
});

const visibleGroups = computed(() => {
  const visibleIds = new Set(visibleActions.value.map((action) => action.id));
  return quickActionGroupOrder
    .map((group) => ({
      id: group,
      label: t(`app.quickActionGroups.${group}`),
      actions: orderQuickActionsInGroup(
        quickActions.filter((action) => action.group === group && visibleIds.has(action.id)),
      ),
    }))
    .filter((group) => group.actions.length > 0);
});

const overflowMenuActions = computed((): ContextMenuAction[] => {
  const actions: ContextMenuAction[] = [];
  for (const group of quickActionGroupOrder) {
    const groupActions = orderQuickActionsInGroup(
      overflowActions.value.filter((action) => action.group === group),
    );
    if (groupActions.length === 0) {
      continue;
    }
    if (actions.length > 0) {
      actions.push({ id: `${group}-separator`, separator: true });
    }
    actions.push(
      ...groupActions.map((action) => ({
        id: action.id,
        label: localizedLabel(action),
        shortcut: action.shortcut,
        ariaShortcut: toAriaKeyshortcuts(action.shortcut),
        disabled: isDisabled(action),
      })),
    );
  }
  return actions;
});

function localizedLabel(action: QuickActionDefinition): string {
  if (action.id === "togglePreview") {
    return t(settings.value.preview.enabled ? "actions.hidePreview" : "actions.preview");
  }
  if (action.id === "annotateDocument") {
    return t(
      documentAnnotationQuickActionLabelKey(
        documentAnnotationQuickActionMode(editorCommandState.value.hasAnnotationAtCursor),
      ),
    );
  }
  if (action.id === "toggleWritingFocus") {
    return t(writingFocusActive.value ? "actions.exitFocusMode" : "actions.focusMode");
  }
  return t(action.label);
}

function isDisabled(action: QuickActionDefinition): boolean {
  if (action.id === "save" || action.id === "closeAll") {
    return !activeBuffer.value;
  }
  if (action.id === "undo") {
    return !editorCommandState.value.canUndo;
  }
  if (action.id === "redo") {
    return !editorCommandState.value.canRedo;
  }
  if (
    action.id === "cut" ||
    action.id === "copy" ||
    action.id === "paste" ||
    action.id === "find" ||
    action.id === "replace" ||
    action.id === "annotateDocument"
  ) {
    return !activeBuffer.value;
  }
  return false;
}

function ariaPressed(action: QuickActionDefinition): boolean | undefined {
  if (action.id === "togglePreview") {
    return settings.value.preview.enabled;
  }
  if (action.id === "toggleWritingFocus") {
    return writingFocusActive.value;
  }
  if (action.id === "openExplorer") {
    return props.explorerOpen;
  }
  return undefined;
}

function actionTitle(action: QuickActionDefinition): string {
  const label = localizedLabel(action);
  return action.shortcut ? `${label} (${action.shortcut})` : label;
}

function cssPixels(value: string): number {
  const pixels = Number.parseFloat(value);
  return Number.isFinite(pixels) ? pixels : 0;
}

function outerInlineSize(element: HTMLElement | null): number {
  if (!element) {
    return 0;
  }
  const style = getComputedStyle(element);
  const renderedWidth = element.getBoundingClientRect().width || cssPixels(style.width);
  return renderedWidth + cssPixels(style.marginInlineStart) + cssPixels(style.marginInlineEnd);
}

function measureVisibleActions(): void {
  const toolbar = toolbarRef.value;
  if (!toolbar) {
    return;
  }
  const width = toolbar.clientWidth;
  const sampleButton = toolbar.querySelector<HTMLElement>(".quick-actions__button");
  const sampleGroup = toolbar.querySelector<HTMLElement>(".quick-actions__group");
  const sampleDivider = toolbar.querySelector<HTMLElement>(".quick-actions__divider");
  const buttonWidth = outerInlineSize(sampleButton);
  const dividerWidth = outerInlineSize(sampleDivider);
  const overflowButtonWidth =
    outerInlineSize(toolbar.querySelector<HTMLElement>(".quick-actions__overflow")) || buttonWidth;
  const toolbarStyle = getComputedStyle(toolbar);
  const toolbarGap = cssPixels(toolbarStyle.columnGap || toolbarStyle.gap);
  const toolbarPadding =
    cssPixels(toolbarStyle.paddingInlineStart) + cssPixels(toolbarStyle.paddingInlineEnd);
  const groupGap = cssPixels(sampleGroup ? getComputedStyle(sampleGroup).columnGap : "");

  if (buttonWidth === 0 || width === 0) {
    return;
  }

  let nextCount = quickActions.length;
  for (let count = quickActions.length; count >= 1; count -= 1) {
    const visibleActionsForCount = selectQuickActionsForVisibleCount(quickActions, count);
    const groupActionCounts = quickActionGroupOrder.map(
      (group) => visibleActionsForCount.filter((action) => action.group === group).length,
    );
    const visibleGroupCount = groupActionCounts.filter(
      (groupActionCount) => groupActionCount > 0,
    ).length;
    const hasOverflow = count < quickActions.length;
    const dividerCount = Math.max(0, visibleGroupCount - 1) + (hasOverflow ? 1 : 0);
    const topLevelChildCount = visibleGroupCount + dividerCount + (hasOverflow ? 1 : 0);
    const used =
      toolbarPadding +
      count * buttonWidth +
      groupActionCounts.reduce(
        (total, groupActionCount) => total + Math.max(0, groupActionCount - 1) * groupGap,
        0,
      ) +
      dividerCount * dividerWidth +
      Math.max(0, topLevelChildCount - 1) * toolbarGap +
      (hasOverflow ? overflowButtonWidth : 0);
    if (used <= width) {
      nextCount = count;
      break;
    }
    if (count === 1) {
      nextCount = 1;
    }
  }
  visibleCount.value = Math.min(nextCount, quickActions.length);
}

function openOverflowMenu(event: MouseEvent): void {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const bounds = target.getBoundingClientRect();
  overflowX.value = bounds.left;
  overflowY.value = bounds.bottom + 2;
  overflowOpen.value = true;
}

function closeOverflowMenu(): void {
  overflowOpen.value = false;
}

function selectOverflowAction(id: string): void {
  const action = quickActions.find((entry) => entry.id === id);
  if (!action || isDisabled(action)) {
    return;
  }
  closeOverflowMenu();
  void props.runCommand(action.id);
}

onMounted(() => {
  if (typeof ResizeObserver !== "undefined" && toolbarRef.value) {
    resizeObserver = new ResizeObserver(() => {
      measureVisibleActions();
    });
    resizeObserver.observe(toolbarRef.value);
  }
  measureVisibleActions();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <div ref="toolbarRef" class="quick-actions" role="toolbar" :aria-label="t('app.quickActions')">
    <template v-for="(group, groupIndex) in visibleGroups" :key="group.id">
      <span v-if="groupIndex > 0" class="quick-actions__divider" aria-hidden="true" />
      <div class="quick-actions__group" role="group" :aria-label="group.label">
        <button
          v-for="action in group.actions"
          :key="action.id"
          class="quick-actions__button"
          type="button"
          :title="actionTitle(action)"
          :aria-label="localizedLabel(action)"
          :aria-keyshortcuts="toAriaKeyshortcuts(action.shortcut)"
          :aria-pressed="ariaPressed(action)"
          :disabled="isDisabled(action)"
          @click="runCommand(action.id)"
        >
          <AppIcon :name="action.icon ?? 'document'" :size="15" />
        </button>
      </div>
    </template>

    <span
      v-if="visibleGroups.length > 0 && overflowActions.length > 0"
      class="quick-actions__divider"
      aria-hidden="true"
    />

    <button
      v-if="overflowActions.length > 0"
      class="quick-actions__button quick-actions__overflow"
      type="button"
      :title="t('app.quickActionsOverflow')"
      :aria-label="t('app.quickActionsOverflow')"
      aria-haspopup="menu"
      :aria-expanded="overflowOpen"
      @click="openOverflowMenu"
    >
      <AppIcon name="more" :size="15" />
    </button>

    <ContextMenu
      :open="overflowOpen"
      :x="overflowX"
      :y="overflowY"
      :actions="overflowMenuActions"
      :label="t('app.quickActionsOverflow')"
      @select="selectOverflowAction"
      @close="closeOverflowMenu"
    />
  </div>
</template>

<style scoped lang="scss">
@use "../styles/colors" as *;
@use "../styles/controls" as *;
@use "../styles/variables" as *;

.quick-actions {
  display: flex;
  align-items: center;
  gap: $space-compact;
  flex: 1 1 auto;
  min-width: 0;
  padding-inline: $space-tight;
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.quick-actions__group {
  display: flex;
  align-items: center;
  gap: 1px;
  flex-shrink: 0;
}

.quick-actions__divider {
  flex-shrink: 0;
  width: 1px;
  height: $space-5;
  margin-inline: $space-tight;
  background: $border-subtle;
}

.quick-actions__button {
  @include icon-action-button;
}
</style>
