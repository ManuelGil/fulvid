<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";

import { workspace, workspaceName } from "../../app/workspaceState";
import { formatDocumentCount } from "../document/context/context";
import { openBuffers } from "../editor/document/documentBuffers";
import PageShell from "../../shell/PageShell.vue";
import {
  countActiveSearchFilters,
  parseSearchOptions,
  searchOptionsQuery,
  type SearchFileType,
  type SearchOptions,
  type SearchSort,
} from "./searchOptions";
import {
  DEFAULT_PROXIMITY,
  SEARCH_STRATEGY_IDS,
  searchStrategyUsesMatchCountSort,
  searchStrategyUsesScore,
  searchStrategyUsesWholeWord,
  type SearchPatternKind,
  type SearchStrategyId,
} from "./searchStrategies";
import { selectedSearchContext } from "./searchSession";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const options = computed(() => parseSearchOptions(route.query));
const activeFilters = computed(() => countActiveSearchFilters(options.value));
const standaloneDocumentCount = computed(
  () => openBuffers.value.filter((buffer) => buffer.rootPath === null).length,
);
const scopeDescription = computed(() => {
  if (!workspace.value) {
    return t("search.sidebarStandaloneScope", {
      count: formatDocumentCount(standaloneDocumentCount.value),
    });
  }
  return t("search.sidebarScope", { name: workspaceName(workspace.value.path) });
});

function patchOptions(patch: Partial<SearchOptions>): void {
  if (patch.strategy && searchStrategyUsesScore(patch.strategy)) {
    patch.sort = "score";
  } else if (patch.strategy && options.value.sort === "score") {
    patch.sort = "path";
  }
  void router.replace({
    query: searchOptionsQuery(route.query, patch),
  });
}
</script>

<template>
  <PageShell :title="t('search.sidebarTitle')" embedded rhythm="immediate">
    <p class="search-sidebar__text">
      {{ t("search.sidebarText") }}
    </p>
    <p class="search-sidebar__scope">{{ scopeDescription }}</p>
    <p v-if="activeFilters > 0" class="search-sidebar__summary">
      {{
        t("search.filtersLabel", { filters: t("search.filtersActive", { count: activeFilters }) })
      }}
    </p>

    <fieldset class="search-sidebar__field">
      <legend>{{ t("search.searchType") }}</legend>
      <select
        :value="options.strategy"
        :aria-label="t('search.searchType')"
        aria-describedby="search-strategy-sidebar-hint"
        @change="
          patchOptions({
            strategy: ($event.target as HTMLSelectElement).value as SearchStrategyId,
          })
        "
      >
        <option v-for="strategy in SEARCH_STRATEGY_IDS" :key="strategy" :value="strategy">
          {{ t(`search.strategies.${strategy}`) }}
        </option>
      </select>
      <p id="search-strategy-sidebar-hint" class="search-sidebar__hint">
        {{ t(`search.strategyHint.${options.strategy}`) }}
      </p>
    </fieldset>

    <fieldset class="search-sidebar__field">
      <legend>{{ t("search.fileType") }}</legend>
      <select
        :value="options.fileType"
        :aria-label="t('search.fileType')"
        @change="
          patchOptions({
            fileType: ($event.target as HTMLSelectElement).value as SearchFileType,
          })
        "
      >
        <option value="all">{{ t("search.fileTypeAll") }}</option>
        <option value="md">{{ t("search.fileTypeMd") }}</option>
        <option value="markdown">{{ t("search.fileTypeMarkdown") }}</option>
        <option value="mdx">{{ t("search.fileTypeMdx") }}</option>
      </select>
    </fieldset>

    <fieldset class="search-sidebar__field">
      <legend>{{ t("search.sort") }}</legend>
      <select
        :value="options.sort"
        :aria-label="t('search.sort')"
        @change="
          patchOptions({
            sort: ($event.target as HTMLSelectElement).value as SearchSort,
          })
        "
      >
        <option value="path">{{ t("search.sortPath") }}</option>
        <option v-if="searchStrategyUsesMatchCountSort(options.strategy)" value="matches">
          {{ t("search.sortMatches") }}
        </option>
        <option v-if="searchStrategyUsesScore(options.strategy)" value="score">
          {{ t("search.sortScore") }}
        </option>
      </select>
    </fieldset>

    <fieldset class="search-sidebar__field">
      <legend>{{ t("search.advanced") }}</legend>
      <label class="search-sidebar__option">
        <input
          type="checkbox"
          :checked="options.caseSensitive"
          @change="
            patchOptions({
              caseSensitive: ($event.target as HTMLInputElement).checked,
            })
          "
        />
        <span>{{ t("search.caseSensitive") }}</span>
      </label>
      <label v-if="searchStrategyUsesWholeWord(options.strategy)" class="search-sidebar__option">
        <input
          type="checkbox"
          :checked="options.wholeWord"
          @change="
            patchOptions({
              wholeWord: ($event.target as HTMLInputElement).checked,
            })
          "
        />
        <span>{{ t("search.wholeWord") }}</span>
      </label>
    </fieldset>

    <fieldset v-if="options.strategy === 'boolean'" class="search-sidebar__field">
      <legend>{{ t("search.booleanMode") }}</legend>
      <label class="search-sidebar__option">
        <input
          type="radio"
          name="search-boolean"
          :checked="options.booleanMode === 'and'"
          @change="patchOptions({ booleanMode: 'and' })"
        />
        <span>{{ t("search.booleanAnd") }}</span>
      </label>
      <label class="search-sidebar__option">
        <input
          type="radio"
          name="search-boolean"
          :checked="options.booleanMode === 'or'"
          @change="patchOptions({ booleanMode: 'or' })"
        />
        <span>{{ t("search.booleanOr") }}</span>
      </label>
    </fieldset>

    <fieldset v-if="options.strategy === 'proximity'" class="search-sidebar__field">
      <legend>{{ t("search.proximity") }}</legend>
      <label class="search-sidebar__option">
        <span>{{ t("search.proximityWindow") }}</span>
        <input
          type="number"
          min="2"
          max="32"
          :value="options.proximity"
          :aria-label="t('search.proximityWindow')"
          @change="
            patchOptions({
              proximity: Number(($event.target as HTMLInputElement).value) || DEFAULT_PROXIMITY,
            })
          "
        />
      </label>
    </fieldset>

    <fieldset v-if="options.strategy === 'pattern'" class="search-sidebar__field">
      <legend>{{ t("search.patternKind") }}</legend>
      <select
        :value="options.patternKind"
        :aria-label="t('search.patternKind')"
        @change="
          patchOptions({
            patternKind: ($event.target as HTMLSelectElement).value as SearchPatternKind,
          })
        "
      >
        <option value="heading">{{ t("search.patternHeading") }}</option>
        <option value="link">{{ t("search.patternLink") }}</option>
        <option value="wikilink">{{ t("search.patternWikilink") }}</option>
        <option value="frontmatter">{{ t("search.patternFrontmatter") }}</option>
        <option value="fence">{{ t("search.patternFence") }}</option>
        <option value="list">{{ t("search.patternList") }}</option>
      </select>
    </fieldset>

    <section v-if="selectedSearchContext" class="search-sidebar__matched">
      <h2>{{ t("search.whyMatched") }}</h2>
      <dl>
        <div>
          <dt>{{ t("search.whyMatchedFile") }}</dt>
          <dd>{{ selectedSearchContext.title }}</dd>
        </div>
        <div>
          <dt>{{ t("search.whyMatchedPath") }}</dt>
          <dd>{{ selectedSearchContext.path }}</dd>
        </div>
        <div>
          <dt>{{ t("search.whyMatchedLine", { line: selectedSearchContext.line }) }}</dt>
          <dd>{{ selectedSearchContext.snippet }}</dd>
        </div>
      </dl>
    </section>
  </PageShell>
</template>

<style scoped lang="scss">
@use "../../styles/colors" as *;
@use "../../styles/variables" as *;
@use "../../styles/controls" as *;

.search-sidebar__text,
.search-sidebar__scope,
.search-sidebar__summary {
  margin: 0;
  color: $text-secondary;
  font-size: $font-label;
  line-height: 1.5;
}

.search-sidebar__scope,
.search-sidebar__summary {
  margin-top: $space-related;
  color: $text-muted;
}

.search-sidebar__scope {
  font-family: $font-mono;
}

.search-sidebar__field {
  display: flex;
  flex-direction: column;
  gap: $space-tight;
  margin: $space-group 0 0;
  padding: 0;
  border: 0;

  select {
    @include control-select;
    width: 100%;
  }

  input[type="number"] {
    @include control-field;
    width: 5rem;
  }
}

.search-sidebar__field legend {
  margin-bottom: $space-tight;
  color: $text-primary;
  font-size: $font-label;
  font-weight: 600;
}

.search-sidebar__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $space-tight;
  min-height: $hit-min;
  color: $text-secondary;
  font-size: $font-label;

  input[type="radio"],
  input[type="checkbox"] {
    @include control-checkbox;
    flex: 0 0 auto;
  }

  input[type="radio"],
  input[type="checkbox"] {
    margin-inline-end: 0;
  }

  &:has(input[type="radio"]),
  &:has(input[type="checkbox"]) {
    justify-content: flex-start;
  }

  select {
    @include control-select;
    min-width: 0;
    max-width: 100%;
  }
}

.search-sidebar__hint {
  min-height: 2.8em;
  margin: $space-tight 0 0;
  color: $text-muted;
  font-size: $font-caption;
  line-height: 1.4;
}

.search-sidebar__advanced {
  margin-top: $space-group;

  summary {
    min-height: $hit-min;
    color: $text-primary;
    font-size: $font-label;
    font-weight: 600;
    cursor: pointer;

    &:focus-visible {
      outline: 2px solid $focus-ring;
      outline-offset: 2px;
    }
  }

  .search-sidebar__field {
    margin-top: $space-related;
  }
}

.search-sidebar__matched {
  margin-top: $space-group;

  h2 {
    margin: 0 0 $space-related;
    color: $text-primary;
    font-size: $font-label;
    font-weight: 600;
  }

  dl {
    display: flex;
    flex-direction: column;
    gap: $space-related;
    margin: 0;
  }

  dt {
    color: $text-muted;
    font-size: $font-caption;
  }

  dd {
    margin: 0;
    color: $text-secondary;
    font-size: $font-label;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
}
</style>
