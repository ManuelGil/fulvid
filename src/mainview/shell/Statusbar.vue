<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

import {
  documentReadingStats,
  readingStatisticsLabelKind,
} from "../modules/document/facts/documentReadingStats";
import {
  activeBuffer,
  isDocumentDirty,
  cycleDocumentEol,
} from "../modules/editor/document/documentBuffers";
import { settings } from "../modules/settings/settingsStore";
import { workspace, workspaceName } from "../app/workspaceState";
import { APP_ROUTE_NAMES } from "../app/router";

const router = useRouter();
const { t, locale } = useI18n();

const activeLanguage = computed(() => activeBuffer.value?.model.getLanguageId() ?? null);

const activeLanguageLabel = computed(() => {
  if (activeLanguage.value === "mdx") {
    return t("status.mdx");
  }
  if (activeLanguage.value === "markdown") {
    return t("status.markdown");
  }
  return activeLanguage.value;
});

const linkModeLabel = computed(() =>
  t(settings.value.links.linkMode === "wikilink" ? "status.wikilinks" : "status.markdownLinks"),
);

const documentStatus = computed(() => {
  if (!activeBuffer.value) {
    return null;
  }
  return isDocumentDirty(activeBuffer.value) ? t("status.unsaved") : t("status.saved");
});

const workspaceStatus = computed(() =>
  workspace.value ? workspaceName(workspace.value.path) : t("status.standalone"),
);

const characterCount = computed(() => {
  const buffer = activeBuffer.value;
  if (!buffer) {
    return null;
  }
  void buffer.changeVersion.value;
  return t("status.characters", {
    count: buffer.model.getValue().length.toLocaleString(locale.value),
  });
});

const eolLabel = computed(() => {
  const buffer = activeBuffer.value;
  if (!buffer) {
    return null;
  }
  void buffer.changeVersion.value;
  return buffer.model.getEOL() === "\r\n" ? "CRLF" : "LF";
});

const readingCount = computed(() => {
  const buffer = activeBuffer.value;
  if (!buffer) {
    return null;
  }
  void buffer.changeVersion.value;
  const stats = documentReadingStats(buffer.model.getValue());
  const kind = readingStatisticsLabelKind(settings.value.editor.readingStatistics, stats);
  if (kind === "hidden") {
    return null;
  }
  const count = stats.words.toLocaleString(locale.value);
  if (kind === "wordsOnly") {
    return t("status.wordsOnly", { count });
  }
  if (kind === "readingUnderOne") {
    return t("status.readingUnderOne", { count });
  }
  return t("status.reading", { count, minutes: stats.minutes });
});

const indicators = computed(() => settings.value.appearance.statusbar.indicators);
</script>

<template>
  <footer
    v-if="settings.appearance.statusbar.enabled"
    class="statusbar"
    role="status"
    aria-live="off"
    :aria-label="t('status.label')"
  >
    <span class="statusbar__group">
      <span
        v-if="indicators.document && documentStatus"
        class="statusbar__item statusbar__item--primary"
        :aria-label="t('status.document', { status: documentStatus })"
      >
        {{ documentStatus }}
      </span>
      <span
        v-if="indicators.language && activeLanguage"
        class="statusbar__item"
        :aria-label="t('status.language', { language: activeLanguageLabel })"
      >
        {{ activeLanguageLabel }}
      </span>
      <button
        v-if="indicators.linkMode"
        class="statusbar__item statusbar__link-mode"
        type="button"
        :title="t('status.openLinkSettings')"
        :aria-label="t('status.linkMode', { mode: linkModeLabel })"
        @click="router.push({ name: APP_ROUTE_NAMES.settings, query: { section: 'markdown' } })"
      >
        {{ t("status.linkMode", { mode: linkModeLabel }) }}
      </button>
    </span>
    <span class="statusbar__group statusbar__group--secondary">
      <span
        v-if="indicators.workspace"
        class="statusbar__item"
        :aria-label="t('status.workspace', { workspace: workspaceStatus })"
      >
        {{ workspaceStatus }}
      </span>
      <span
        v-if="indicators.characters && characterCount"
        class="statusbar__item"
        :aria-label="characterCount"
      >
        {{ characterCount }}
      </span>
      <span v-if="readingCount" class="statusbar__item" :aria-label="readingCount">
        {{ readingCount }}
      </span>
      <button
        v-if="indicators.eol && eolLabel"
        class="statusbar__item statusbar__link-mode"
        type="button"
        :title="t('status.changeEol')"
        :aria-label="t('status.eol', { eol: eolLabel })"
        @click="activeBuffer && cycleDocumentEol(activeBuffer)"
      >
        {{ eolLabel }}
      </button>
    </span>
  </footer>
</template>

<style scoped lang="scss">
@use "../styles/colors" as *;
@use "../styles/variables" as *;

.statusbar {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  min-height: $statusbar-height;
  padding: $space-tight $space-compact;
  border-top: 1px solid $border-subtle;
  background: $background;
  overflow: hidden;
  color: $text-muted;
  font-family: inherit;
  font-size: $font-control;
  line-height: 1.3;
  font-variant-numeric: tabular-nums;
}

.statusbar__group {
  display: flex;
  align-items: center;
  gap: $space-3;
  min-width: 0;
  flex-shrink: 1;
  overflow: hidden;
}

.statusbar__group + .statusbar__group {
  padding-inline-start: $space-block;
  border-inline-start: 1px solid $border-subtle;
}

.statusbar__group--secondary {
  margin-inline-start: auto;
}

.statusbar__group--secondary .statusbar__item {
  max-width: 16rem;
}

.statusbar__item {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.statusbar__item--primary {
  color: $text-secondary;
  font-weight: 600;
}

.statusbar__link-mode {
  min-height: $hit-min;
  padding: 0 $space-tight;
  border: 0;
  background: transparent;
  color: $accent-text;
  font: inherit;
  cursor: pointer;

  &:hover {
    color: $text-primary;
    text-decoration: underline;
  }

  &:focus-visible {
    outline: 2px solid $focus-ring;
    outline-offset: 2px;
  }
}

@media (max-width: 600px) {
  .statusbar {
    min-height: $control-height-small;
    padding-inline: $space-related;
    font-size: $font-label;
  }

  .statusbar__group {
    gap: $space-related;
  }

  .statusbar__group--secondary {
    display: none;
  }
}
</style>
