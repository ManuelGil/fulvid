<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import type { LinkSyntax } from "../../document/links/documentLink";
import type { ScannedNote } from "../../workspace/filesystem/workspaceTypes";
import { settings } from "../../settings/settingsStore";
import { findMarkdownHeading } from "../markdown/markdownStructure";
import {
  escapeHtml,
  PREVIEW_INLINE_MARKUP_LIMIT,
  PREVIEW_RENDER_CHAR_LIMIT,
  renderMarkdownPreview,
} from "../markdown/markdownPreview";

const RENDER_DEBOUNCE_MS = 140;

const props = defineProps<{
  content: string;
  path: string;
  notes: ScannedNote[];
  linkMode: LinkSyntax;
}>();
const { t, locale } = useI18n();

const emit = defineEmits<{
  openDocument: [path: string, anchor?: string];
  revealSource: [lineNumber: number];
}>();

const previewRoot = ref<HTMLElement | null>(null);
const previewPane = ref<HTMLElement | null>(null);
const renderedHtml = ref("");
const isEmpty = ref(false);
const isCapped = ref(false);
const isFailed = ref(false);
const isDense = ref(false);
const hasUnsupportedMdx = ref(false);
const frontmatterIncomplete = ref(false);
let renderTimer: ReturnType<typeof setTimeout> | null = null;

function renderNow(): void {
  if (renderTimer) {
    clearTimeout(renderTimer);
    renderTimer = null;
  }

  const source = props.content.slice(0, PREVIEW_RENDER_CHAR_LIMIT);
  const result = renderMarkdownPreview(
    source,
    props.notes,
    props.linkMode,
    (alt) => escapeHtml(t("preview.imagePlaceholder", { alt })),
    props.path || undefined,
  );
  renderedHtml.value = result.html;
  isEmpty.value = result.empty;
  isFailed.value = result.failed;
  isDense.value = result.dense;
  hasUnsupportedMdx.value = result.hasUnsupportedMdx;
  frontmatterIncomplete.value = result.frontmatter === "unclosed";
  isCapped.value = props.content.length > PREVIEW_RENDER_CHAR_LIMIT;
}

function scheduleRender(): void {
  if (renderTimer) {
    clearTimeout(renderTimer);
  }
  renderTimer = setTimeout(() => {
    renderTimer = null;
    renderNow();
  }, RENDER_DEBOUNCE_MS);
}

function revealHeading(anchor: string): boolean {
  const heading = findMarkdownHeading(props.content, anchor);
  if (!heading) {
    return false;
  }
  emit("revealSource", heading.lineNumber);
  return true;
}

function activatePreviewTarget(target: Element): boolean {
  const link = target.closest<HTMLElement>("[data-document-path]");
  const path = link?.dataset.documentPath;
  if (path) {
    const anchor = link?.dataset.documentAnchor;
    if (path === props.path && anchor) {
      revealHeading(anchor);
      return true;
    }
    emit("openDocument", path, anchor);
    return true;
  }

  if (target.closest("a")) {
    return true;
  }

  const heading = target.closest<HTMLElement>("[data-source-line]");
  const sourceLine = Number(heading?.dataset.sourceLine);
  if (!Number.isInteger(sourceLine) || sourceLine < 1) {
    return false;
  }
  emit("revealSource", sourceLine);
  return true;
}

function onPreviewClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element) || !previewRoot.value?.contains(target)) {
    return;
  }
  if (target.closest("a") || target.closest("[data-source-line]")) {
    event.preventDefault();
  }
  activatePreviewTarget(target);
}

function onPreviewKeydown(event: KeyboardEvent): void {
  if (!["Enter", " "].includes(event.key)) {
    return;
  }
  const target = event.target;
  if (!(target instanceof Element) || !previewRoot.value?.contains(target)) {
    return;
  }
  if (!target.closest("a") && !target.closest("[data-source-line]")) {
    return;
  }
  event.preventDefault();
  activatePreviewTarget(target);
}

function setScrollRatio(ratio: number): void {
  const element = previewPane.value;
  if (!element) {
    return;
  }
  const scrollable = Math.max(element.scrollHeight - element.clientHeight, 0);
  element.scrollTop = scrollable * Math.min(Math.max(ratio, 0), 1);
}

defineExpose({ setScrollRatio });

watch(
  () =>
    [
      props.path,
      props.content,
      props.notes,
      props.linkMode,
      settings.value.links.resolution,
      locale.value,
    ] as const,
  (next, previous) => {
    if (!previous || next[0] !== previous[0]) {
      renderNow();
      return;
    }
    scheduleRender();
  },
  { deep: true, immediate: true },
);

onBeforeUnmount(() => {
  if (renderTimer) {
    clearTimeout(renderTimer);
    renderTimer = null;
  }
});
</script>

<template>
  <aside
    ref="previewPane"
    class="preview-pane"
    tabindex="0"
    :aria-label="path ? `${t('preview.aria')}: ${path}` : t('preview.aria')"
  >
    <div class="preview-pane__header">
      <span class="preview-pane__title">{{ t("preview.label") }}</span>
    </div>
    <p v-if="isCapped" class="preview-pane__notice" role="status">
      {{
        t("preview.limited", {
          count: PREVIEW_RENDER_CHAR_LIMIT.toLocaleString(),
        })
      }}
    </p>
    <p v-if="isDense" class="preview-pane__notice" role="status">
      {{ t("preview.dense", { count: PREVIEW_INLINE_MARKUP_LIMIT.toLocaleString() }) }}
    </p>
    <p v-if="isFailed" class="preview-pane__notice" role="status">{{ t("preview.failed") }}</p>
    <p v-else-if="frontmatterIncomplete" class="preview-pane__notice" role="status">
      {{ t("preview.frontmatterIncomplete") }}
    </p>
    <p v-if="hasUnsupportedMdx" class="preview-pane__notice" role="status">
      {{ t("preview.mdxInert") }}
    </p>
    <p v-if="isEmpty && !isFailed" class="preview-pane__state">{{ t("preview.empty") }}</p>
    <div
      v-else
      ref="previewRoot"
      class="preview-pane__content"
      @click="onPreviewClick"
      @keydown="onPreviewKeydown"
      v-html="renderedHtml"
    ></div>
  </aside>
</template>

<style scoped lang="scss">
@use "../../../styles/colors" as *;
@use "../../../styles/variables" as *;
@use "../../../styles/controls" as *;

.preview-pane {
  flex: 0 0 42%;
  min-width: 0;
  min-height: 18rem;
  overflow: auto;
  border-inline-start: 1px solid $border-subtle;
  background: $surface;

  &:focus-visible {
    outline: 2px solid $focus-ring;
    outline-offset: -2px;
  }
}

.preview-pane__header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: baseline;
  gap: $space-related;
  padding: $space-related $space-block;
  border-bottom: 1px solid $border-subtle;
  background: $surface;
}

.preview-pane__title {
  color: $text-primary;
  font-size: $font-label;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.preview-pane__notice,
.preview-pane__state {
  margin: 0;
  padding: $space-related $space-block;
  color: $text-muted;
  font-size: $font-label;
}

.preview-pane__notice {
  border-bottom: 1px solid $border-subtle;
}

.preview-pane__state {
  padding-block: $space-group;
}

.preview-pane__content {
  padding: $space-group $space-block;
  color: $text-primary;
  line-height: 1.6;

  :deep(h1),
  :deep(h2),
  :deep(h3),
  :deep(h4),
  :deep(h5),
  :deep(h6) {
    margin: $space-group 0 $space-related;
    color: $text-heading;
    line-height: 1.25;
    cursor: pointer;
  }

  :deep(h1):focus-visible,
  :deep(h2):focus-visible,
  :deep(h3):focus-visible,
  :deep(h4):focus-visible,
  :deep(h5):focus-visible,
  :deep(h6):focus-visible,
  :deep(a):focus-visible {
    outline: 2px solid $focus-ring;
    outline-offset: 2px;
  }

  :deep(p),
  :deep(ul),
  :deep(ol),
  :deep(pre),
  :deep(blockquote),
  :deep(table) {
    margin: $space-related 0;
  }

  :deep(ul),
  :deep(ol) {
    padding-inline-start: 1.4em;
  }

  :deep(li + li) {
    margin-top: 0.2em;
  }

  :deep(ul ul),
  :deep(ol ol),
  :deep(ul ol),
  :deep(ol ul) {
    margin: 0.2em 0;
  }

  :deep(input[type="checkbox"]) {
    @include control-checkbox;
    margin-inline-end: 0.4em;
    pointer-events: none;
  }

  :deep(a) {
    color: $text-link;
  }

  :deep(hr) {
    margin: $space-group 0;
    border: 0;
    border-top: 1px solid $border-subtle;
  }

  :deep(del) {
    color: $text-secondary;
  }

  :deep(pre) {
    overflow: auto;
    padding: $space-related;
    border: 1px solid $border-subtle;
    border-radius: $radius;
    background: $surface-hover;
    font-family: $font-mono;
    font-size: $font-label;
  }

  :deep(code) {
    color: $text-code;
    font-family: $font-mono;
    font-size: 0.9em;
  }

  :deep(pre code) {
    color: inherit;
  }

  :deep(blockquote) {
    margin-left: 0;
    padding-left: $space-block;
    border-left: 2px solid $border;
    color: $text-secondary;
  }

  :deep(blockquote blockquote) {
    margin-top: $space-related;
  }

  :deep(table) {
    width: 100%;
    border-collapse: collapse;
    font-size: $font-label;
  }

  :deep(th),
  :deep(td) {
    padding: 0.35em 0.55em;
    border: 1px solid $border-subtle;
    text-align: start;
  }

  :deep(th) {
    color: $text-heading;
    font-weight: 600;
    background: $surface-hover;
  }

  :deep(.markdown-preview__image),
  :deep(.markdown-preview__inert) {
    color: $text-muted;
    font-size: $font-label;
  }

  :deep(.markdown-preview__inert) {
    display: inline;
    font-family: $font-mono;
  }
}
</style>
