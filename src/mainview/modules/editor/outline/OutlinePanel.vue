<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type * as monaco from "monaco-editor/editor";

import { activeBuffer } from "../document/documentBuffers";
import { activeId } from "../document/documentSession";
import { documentSymbolsForModel } from "../monaco/documentLanguage";
import { initializeMonaco } from "../monaco/monacoSetup";
import PageShell from "../../../shell/PageShell.vue";

type OutlineRow = {
  name: string;
  lineNumber: number;
  column: number;
  level: number;
};

const emit = defineEmits<{
  reveal: [lineNumber: number, column: number];
}>();

const { t } = useI18n();
const rows = ref<OutlineRow[]>([]);
const activeVersion = computed(() => activeBuffer.value?.changeVersion.value ?? 0);
const rowElements = new Map<string, HTMLButtonElement>();
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let focusedInitialRow = false;
let refocusAfterRefresh = false;

function rowKey(row: OutlineRow): string {
  return `${row.lineNumber}:${row.column}:${row.name}`;
}

function setRowElement(key: string, element: unknown): void {
  if (element instanceof HTMLButtonElement) {
    rowElements.set(key, element);
  } else {
    rowElements.delete(key);
  }
}

function focusRelativeRow(index: number, delta: number): void {
  const nextIndex = Math.min(Math.max(index + delta, 0), rows.value.length - 1);
  const row = rows.value[nextIndex];
  if (row) {
    setRovingRow(nextIndex, true);
  }
}

function setRovingRow(index: number, focus: boolean): void {
  const row = rows.value[index];
  if (!row) {
    return;
  }

  rows.value.forEach((candidate, candidateIndex) => {
    const element = rowElements.get(rowKey(candidate));
    if (element) {
      element.tabIndex = candidateIndex === index ? 0 : -1;
    }
  });
  if (focus) {
    rowElements.get(rowKey(row))?.focus();
  }
}

function onRowKeydown(event: KeyboardEvent, index: number): void {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    focusRelativeRow(index, event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    const targetIndex = event.key === "Home" ? 0 : rows.value.length - 1;
    setRovingRow(targetIndex, true);
  }
}

function flattenSymbols(
  symbols: readonly monaco.languages.DocumentSymbol[],
  level = 0,
  result: OutlineRow[] = [],
): OutlineRow[] {
  for (const symbol of symbols) {
    result.push({
      name: symbol.name,
      lineNumber: symbol.selectionRange.startLineNumber,
      column: symbol.selectionRange.startColumn,
      level,
    });
    if (symbol.children && symbol.children.length > 0) {
      flattenSymbols(symbol.children, level + 1, result);
    }
  }
  return result;
}

function refreshOutline(): void {
  const buffer = activeBuffer.value;
  if (!buffer) {
    rows.value = [];
    return;
  }
  rows.value = flattenSymbols(documentSymbolsForModel(initializeMonaco(), buffer.model));
}

function scheduleOutlineRefresh(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshOutline();
  }, 80);
}

watch(
  [activeId, activeVersion],
  () => {
    refocusAfterRefresh =
      document.activeElement instanceof HTMLElement &&
      document.activeElement.closest(".outline-panel") !== null;
    scheduleOutlineRefresh();
  },
  { immediate: true },
);

watch(
  rows,
  async (nextRows) => {
    if ((!refocusAfterRefresh && focusedInitialRow) || nextRows.length === 0) {
      return;
    }
    focusedInitialRow = true;
    refocusAfterRefresh = false;
    await nextTick();
    setRovingRow(0, true);
  },
  { flush: "post" },
);

onMounted(() => {
  focusedInitialRow = false;
});

onBeforeUnmount(() => {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  rowElements.clear();
});
</script>

<template>
  <PageShell :title="t('outline.title')" embedded rhythm="immediate">
    <div class="outline-panel">
      <p v-if="rows.length === 0" class="outline-panel__empty">
        {{ t("outline.empty") }}
      </p>
      <ol v-else class="outline-panel__list" :aria-label="t('outline.title')">
        <li v-for="(row, index) in rows" :key="rowKey(row)">
          <button
            :ref="(element) => setRowElement(rowKey(row), element)"
            type="button"
            class="outline-panel__item"
            :tabindex="index === 0 ? 0 : -1"
            :style="{ paddingInlineStart: `${8 + row.level * 14}px` }"
            :title="t('outline.goTo', { line: row.lineNumber })"
            @keydown="onRowKeydown($event, index)"
            @click="emit('reveal', row.lineNumber, row.column)"
          >
            <span class="outline-panel__name">{{ row.name }}</span>
            <span class="outline-panel__line">{{ row.lineNumber }}</span>
          </button>
        </li>
      </ol>
    </div>
  </PageShell>
</template>

<style scoped lang="scss">
@use "../../../styles/colors" as *;
@use "../../../styles/variables" as *;
@use "../../../styles/page-layout" as *;

.outline-panel {
  min-height: 0;
  padding: $space-tight 0;
}

.outline-panel__empty {
  @include empty-state-text;
  padding-inline: $space-tight;
}

.outline-panel__list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 0;
  padding: 0 $space-tight;
  list-style: none;
}

.outline-panel__item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: $space-related;
  width: 100%;
  min-height: $control-height-small;
  padding-block: $space-tight;
  border: 0;
  border-radius: $radius;
  background: transparent;
  color: $text-secondary;
  font: inherit;
  font-size: $font-label;
  text-align: left;
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

.outline-panel__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.outline-panel__line {
  flex-shrink: 0;
  color: $text-muted;
  font-family: $font-mono;
  font-size: $font-micro;
}
</style>
