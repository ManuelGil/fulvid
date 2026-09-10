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

const showDocumentGroup = computed(
  () =>
    Boolean(indicators.value.document && documentStatus.value) ||
    Boolean(indicators.value.language && activeLanguage.value),
);
const showModeGroup = computed(() => Boolean(indicators.value.linkMode && activeBuffer.value));
const showFormatGroup = computed(() => Boolean(indicators.value.eol && eolLabel.value));
const showStatsGroup = computed(
  () => Boolean(readingCount.value) || Boolean(indicators.value.characters && characterCount.value),
);
const showContextGroup = computed(() =>
  Boolean(indicators.value.workspace && (workspace.value || activeBuffer.value)),
);
</script>

<template>
  <footer
    v-if="settings.appearance.statusbar.enabled"
    class="statusbar"
    :aria-label="t('status.label')"
  >
    <span v-if="showDocumentGroup || showModeGroup" class="statusbar__cluster">
      <span v-if="showDocumentGroup" class="statusbar__group">
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
          :title="t('status.language', { language: activeLanguageLabel })"
          :aria-label="t('status.language', { language: activeLanguageLabel })"
        >
          {{ activeLanguageLabel }}
        </span>
      </span>
      <span
        v-if="showDocumentGroup && showModeGroup"
        class="statusbar__divider"
        aria-hidden="true"
      />
      <span v-if="showModeGroup" class="statusbar__group">
        <button
          class="statusbar__item statusbar__action"
          type="button"
          :title="t('status.openLinkSettings')"
          :aria-label="t('status.linkMode', { mode: linkModeLabel })"
          @click="router.push({ name: APP_ROUTE_NAMES.settings, query: { section: 'markdown' } })"
        >
          {{ t("status.linkMode", { mode: linkModeLabel }) }}
        </button>
      </span>
    </span>
    <span
      v-if="showFormatGroup || showStatsGroup || showContextGroup"
      class="statusbar__cluster statusbar__cluster--secondary"
    >
      <span v-if="showFormatGroup" class="statusbar__group">
        <button
          class="statusbar__item statusbar__action statusbar__token"
          type="button"
          :title="t('status.changeEol')"
          :aria-label="t('status.eol', { eol: eolLabel })"
          @click="activeBuffer && cycleDocumentEol(activeBuffer)"
        >
          {{ eolLabel }}
        </button>
      </span>
      <span
        v-if="showFormatGroup && (showStatsGroup || showContextGroup)"
        class="statusbar__divider"
        aria-hidden="true"
      />
      <span v-if="showStatsGroup" class="statusbar__group">
        <span v-if="readingCount" class="statusbar__item" :aria-label="readingCount">
          {{ readingCount }}
        </span>
        <span
          v-if="indicators.characters && characterCount"
          class="statusbar__item"
          :aria-label="characterCount"
        >
          {{ characterCount }}
        </span>
      </span>
      <span
        v-if="showStatsGroup && showContextGroup"
        class="statusbar__divider"
        aria-hidden="true"
      />
      <span v-if="showContextGroup" class="statusbar__group">
        <span
          class="statusbar__item"
          :title="t('status.workspace', { workspace: workspaceStatus })"
          :aria-label="t('status.workspace', { workspace: workspaceStatus })"
        >
          {{ workspaceStatus }}
        </span>
      </span>
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

.statusbar__cluster {
  display: flex;
  align-items: center;
  gap: $space-compact;
  min-width: 0;
  flex-shrink: 1;
  overflow: hidden;
}

.statusbar__cluster--secondary {
  margin-inline-start: auto;
}

.statusbar__cluster + .statusbar__cluster {
  padding-inline-start: $space-block;
  border-inline-start: 1px solid $border-subtle;
}

.statusbar__group {
  display: flex;
  align-items: center;
  gap: $space-3;
  min-width: 0;
  flex-shrink: 1;
  overflow: hidden;
}

.statusbar__divider {
  width: 1px;
  height: $space-5;
  flex: 0 0 auto;
  background: $border-subtle;
}

.statusbar__cluster--secondary .statusbar__item {
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

.statusbar__action {
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

.statusbar__token {
  font-family: $font-mono;
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

  .statusbar__cluster--secondary {
    display: none;
  }
}
</style>
