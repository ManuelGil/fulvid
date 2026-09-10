<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

import AppIcon from "../../shell/AppIcon.vue";
import ContextMenu, { type ContextMenuAction } from "../../shell/ContextMenu.vue";
import EmptyState from "../../shell/EmptyState.vue";
import PageShell from "../../shell/PageShell.vue";
import { pendingReveal } from "../../modules/editor/document/documentSession";
import { closeRightSidebar, openRightSidebar } from "../../app/layoutStore";
import { formatDocumentCount, pathRelativeToContext } from "../../modules/document/context/context";
import {
  contextNotes,
  contextRoot,
  copyPath,
  copyWorkspacePath,
  hasCustomContext,
  revealPath,
  revealWorkspaceInExplorer,
  workspace,
} from "../../app/workspaceState";
import {
  openBuffers,
  openOrActivate,
  selectDocument,
} from "../../modules/editor/document/documentBuffers";
import { isTypingTarget } from "../../app/isTypingTarget";
import { APP_ROUTE_NAMES } from "../../app/router";

import { notifyFilesystemError } from "../../modules/workspace/filesystem/workspaceScanner";
import { notesWithOpenBufferContent } from "../../modules/search/searchableNotes";
import { isContextSearchScope } from "../../modules/search/searchScope";
import {
  countActiveSearchFilters,
  parseSearchOptions,
  searchOptionsQuery,
  toSearchQueryOptions,
  type SearchOptions,
} from "../../modules/search/searchOptions";
import { selectedSearchContext } from "../../modules/search/searchSession";
import {
  SEARCH_STRATEGY_IDS,
  searchStrategyUsesScore,
  type SearchStrategyId,
} from "../../modules/search/searchStrategies";
import {
  filterNotesByFileType,
  groupSearchHits,
  highlightSearchSnippet,
  limitSearchGroups,
  runDocumentSearch,
  sortSearchGroups,
  type SearchMatch,
  type SearchMatchKind,
} from "../../modules/search/searchResults";

const MAX_RESULTS = 50;
const SEARCH_DEBOUNCE_MS = 140;

const router = useRouter();
const route = useRoute();
const { t, locale } = useI18n();
const query = ref("");
const searchTerm = ref("");
const isSearching = ref(false);
const highlightIndex = ref(0);
const queryInputRef = ref<HTMLInputElement | null>(null);
const errorMessage = ref<string | null>(null);
const contextMenu = ref({ open: false, x: 0, y: 0, index: -1 });
let searchTimer: ReturnType<typeof setTimeout> | null = null;

const searchOptions = computed(() => parseSearchOptions(route.query));
const workspaceNotes = computed(() => workspace.value?.scannedNotes ?? []);
const isContextScope = computed(() =>
  isContextSearchScope(route.query.scope, hasCustomContext.value),
);
const searchScopeNotes = computed(() =>
  isContextScope.value ? contextNotes.value : workspaceNotes.value,
);
const searchableNotes = computed(() =>
  filterNotesByFileType(
    notesWithOpenBufferContent(searchScopeNotes.value, openBuffers.value, workspace.value?.path),
    searchOptions.value.fileType,
  ),
);

const searchQuery = computed(() => toSearchQueryOptions(searchOptions.value));

const searchRun = computed(() =>
  searchTerm.value
    ? runDocumentSearch(searchableNotes.value, searchTerm.value, searchQuery.value)
    : { hits: [], issue: null },
);

const matchingHits = computed(() => searchRun.value.hits);
const queryIssue = computed(() => searchRun.value.issue);

const queryIssueText = computed(() => {
  if (queryIssue.value === "invalidPattern") {
    return t("search.invalidPattern");
  }
  if (queryIssue.value === "tooExpensive") {
    return t("search.tooExpensive");
  }
  if (queryIssue.value === "invalidRegex") {
    return t("search.invalidRegex");
  }
  return null;
});

const queryIssueTitle = computed(() => {
  if (queryIssue.value === "invalidPattern") {
    return t("search.invalidPatternTitle");
  }
  if (queryIssue.value === "tooExpensive") {
    return t("search.tooExpensiveTitle");
  }
  if (queryIssue.value === "invalidRegex") {
    return t("search.invalidRegexTitle");
  }
  return null;
});

function matchKindLabel(kind: SearchMatchKind | undefined): string | null {
  if (kind === "heading") {
    return t("search.patternHeading");
  }
  if (kind === "link") {
    return t("search.patternLink");
  }
  if (kind === "wikilink") {
    return t("search.patternWikilink");
  }
  if (kind === "frontmatter") {
    return t("search.patternFrontmatter");
  }
  if (kind === "fence") {
    return t("search.patternFence");
  }
  if (kind === "list") {
    return t("search.patternList");
  }
  if (kind === "path") {
    return t("search.strategies.path");
  }
  return null;
}

const resultGroups = computed(() => {
  const totals = new Map<string, number>();
  for (const hit of matchingHits.value) {
    totals.set(hit.note.path, (totals.get(hit.note.path) ?? 0) + 1);
  }
  const grouped = sortSearchGroups(groupSearchHits(matchingHits.value), searchOptions.value.sort);
  let rowIndex = 0;
  return limitSearchGroups(grouped, MAX_RESULTS).map((group) => ({
    note: group.note,
    totalMatches: totals.get(group.note.path) ?? group.matches.length,
    relativePath: pathRelativeToContext(
      group.note.path,
      isContextScope.value ? (contextRoot.value ?? "") : "",
    ),
    rows: group.matches.map((match) => {
      const index = rowIndex;
      rowIndex += 1;
      return {
        index,
        match,
        kindLabel: matchKindLabel(match.kind),
        snippetParts: highlightSearchSnippet(match.snippet, searchTerm.value, searchQuery.value),
      };
    }),
  }));
});

const resultRows = computed(() =>
  resultGroups.value.flatMap((group) =>
    group.rows.map((row) => ({
      note: group.note,
      match: row.match,
      relativePath: group.relativePath,
      matchCount: group.totalMatches,
    })),
  ),
);

const activeFilters = computed(() => countActiveSearchFilters(searchOptions.value));

const scopeLabel = computed(() => {
  if (!workspace.value) {
    return t("search.scopeStandalone");
  }
  if (isContextScope.value) {
    return t("search.scopeContext");
  }
  return t("search.scopeFolder");
});

const filterSummary = computed(() => {
  if (activeFilters.value === 0) {
    return t("search.filtersNone");
  }
  return t("search.filtersActive", { count: activeFilters.value.toLocaleString(locale.value) });
});

function setStrategy(strategy: SearchStrategyId): void {
  const patch: Partial<SearchOptions> = { strategy };
  if (searchStrategyUsesScore(strategy)) {
    patch.sort = "score";
  } else if (searchOptions.value.sort === "score") {
    patch.sort = "path";
  }
  void router.replace({ query: searchOptionsQuery(route.query, patch) });
}

const resultSummary = computed(() => {
  const matches = matchingHits.value.length;
  const documents = new Set(matchingHits.value.map((hit) => hit.note.path)).size;
  return t("search.resultSummary", {
    matches: t(matches === 1 ? "search.matchOne" : "search.matchMany", {
      count: matches.toLocaleString(locale.value),
    }),
    documents: t(documents === 1 ? "search.documentOne" : "search.documentMany", {
      count: documents.toLocaleString(locale.value),
    }),
  });
});

const activeResultId = computed(() => {
  const row = resultRows.value[highlightIndex.value];
  return row ? `search-result-option-${highlightIndex.value}` : undefined;
});

const highlightedRow = computed(() => resultRows.value[highlightIndex.value] ?? null);

const contextActions = computed<readonly ContextMenuAction[]>(() => {
  const row = resultRows.value[contextMenu.value.index];
  if (!row) {
    return [];
  }
  if (workspace.value || row.note.path.includes("/") || row.note.path.includes("\\")) {
    return [
      { id: "open", label: t("actions.open") },
      { id: "reveal", label: t("actions.reveal") },
      { id: "copy", label: t("menu.copyPath") },
    ];
  }
  return [{ id: "open", label: t("actions.open") }];
});

function clearSearchTimer(): void {
  if (searchTimer !== null) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }
}

function runSearchImmediately(): void {
  clearSearchTimer();
  searchTerm.value = query.value.trim();
  isSearching.value = false;
}

function clearQuery(): void {
  query.value = "";
  queryInputRef.value?.focus({ preventScroll: true });
}

watch(
  () => query.value,
  () => {
    highlightIndex.value = 0;
    errorMessage.value = null;
    clearSearchTimer();

    const nextTerm = query.value.trim();
    if (!nextTerm) {
      searchTerm.value = "";
      isSearching.value = false;
      return;
    }

    isSearching.value = true;
    searchTimer = setTimeout(() => {
      searchTerm.value = nextTerm;
      isSearching.value = false;
      searchTimer = null;
    }, SEARCH_DEBOUNCE_MS);
  },
);

watch(resultRows, (rows) => {
  if (highlightIndex.value >= rows.length) {
    highlightIndex.value = Math.max(0, rows.length - 1);
  }
});

watch(
  highlightedRow,
  (row) => {
    selectedSearchContext.value = row
      ? {
          title: row.note.title,
          path: row.relativePath,
          line: row.match.lineNumber,
          snippet: row.match.snippet,
          matchCount: row.matchCount,
        }
      : null;
  },
  { immediate: true },
);

async function scrollHighlightedIntoView(): Promise<void> {
  await nextTick();
  document.getElementById(activeResultId.value ?? "")?.scrollIntoView({ block: "nearest" });
}

function moveHighlight(delta: number): void {
  if (resultRows.value.length === 0) {
    return;
  }

  const length = resultRows.value.length;
  highlightIndex.value = (highlightIndex.value + delta + length) % length;
  void scrollHighlightedIntoView();
}

function canRevealOrCopy(path: string): boolean {
  return Boolean(workspace.value) || path.includes("/") || path.includes("\\");
}

async function openSearchHit(path: string, match: SearchMatch): Promise<void> {
  const openBuffer = openBuffers.value.find(
    (buffer) => buffer.id === path || buffer.path === path || buffer.absolutePath === path,
  );
  if (!workspace.value && openBuffer) {
    selectDocument(openBuffer.id);
    pendingReveal.value = {
      documentId: openBuffer.id,
      lineNumber: match.lineNumber,
      column: match.column,
    };
    await router.push({ name: APP_ROUTE_NAMES.editor, query: {} });
    return;
  }

  if (!workspace.value) {
    return;
  }
  errorMessage.value = null;
  try {
    await openOrActivate({
      kind: "workspace",
      rootPath: workspace.value.path,
      path,
      reveal: { lineNumber: match.lineNumber, column: match.column },
    });
    await router.push({ name: APP_ROUTE_NAMES.editor, query: {} });
  } catch (error) {
    notifyFilesystemError(error, "workspace.openDocumentError", (message) => {
      errorMessage.value = message;
    });
  }
}

function activateHighlighted(): void {
  const row = resultRows.value[highlightIndex.value];
  if (row) {
    void openSearchHit(row.note.path, row.match);
  }
}

function openResult(index: number): void {
  highlightIndex.value = index;
  const row = resultRows.value[index];
  if (row) {
    void openSearchHit(row.note.path, row.match);
  }
}

function onQueryKeydown(event: KeyboardEvent): void {
  if (event.key === "ArrowDown") {
    if (resultRows.value.length === 0) {
      return;
    }
    event.preventDefault();
    moveHighlight(1);
    return;
  }

  if (event.key === "ArrowUp") {
    if (resultRows.value.length === 0) {
      return;
    }
    event.preventDefault();
    moveHighlight(-1);
    return;
  }

  if (event.key === "Enter") {
    if (isSearching.value) {
      runSearchImmediately();
    }
    if (resultRows.value.length === 0) {
      return;
    }
    event.preventDefault();
    activateHighlighted();
    return;
  }

  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
    if (resultRows.value.length === 0) {
      return;
    }
    event.preventDefault();
    openHighlightedResultMenu();
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    if (query.value) {
      query.value = "";
      return;
    }
    closeRightSidebar();
  }
}

function onSearchKeydown(event: KeyboardEvent): void {
  if (isTypingTarget(event.target)) {
    return;
  }
  if (event.key === "j" || event.key === "J") {
    event.preventDefault();
    moveHighlight(1);
  } else if (event.key === "k" || event.key === "K") {
    event.preventDefault();
    moveHighlight(-1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    if (isSearching.value) {
      runSearchImmediately();
    }
    activateHighlighted();
  }
}

function openResultMenuAt(x: number, y: number, index: number): void {
  highlightIndex.value = index;
  contextMenu.value = { open: true, x, y, index };
}

function openResultMenu(event: MouseEvent, index: number): void {
  event.preventDefault();
  openResultMenuAt(event.clientX, event.clientY, index);
}

function openHighlightedResultMenu(): void {
  const index = highlightIndex.value;
  const option = document.getElementById(`search-result-option-${index}`);
  const bounds = option?.getBoundingClientRect();
  openResultMenuAt(bounds?.left ?? 0, bounds?.bottom ?? 0, index);
}

function onResultKeydown(event: KeyboardEvent, index: number): void {
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
    event.preventDefault();
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    openResultMenuAt(bounds.left, bounds.bottom, index);
  }
}

async function runResultAction(id: string): Promise<void> {
  const row = resultRows.value[contextMenu.value.index];
  contextMenu.value = { ...contextMenu.value, open: false };
  if (!row) {
    return;
  }
  if (id === "open") {
    await openSearchHit(row.note.path, row.match);
    return;
  }
  if (id === "reveal") {
    if (workspace.value) {
      await revealWorkspaceInExplorer(row.note.path);
      return;
    }
    if (canRevealOrCopy(row.note.path)) {
      await revealPath(row.note.path);
    }
    return;
  }
  if (id === "copy") {
    if (workspace.value) {
      await copyWorkspacePath(row.note.path);
      return;
    }
    if (canRevealOrCopy(row.note.path)) {
      await copyPath(row.note.path);
    }
  }
}

function openSearchOptions(): void {
  openRightSidebar("search");
}

onMounted(() => {
  window.addEventListener("keydown", onSearchKeydown);
  requestAnimationFrame(() => queryInputRef.value?.focus({ preventScroll: true }));
});

onBeforeUnmount(() => {
  clearSearchTimer();
  window.removeEventListener("keydown", onSearchKeydown);
  selectedSearchContext.value = null;
});
</script>

<template>
  <PageShell :title="t('nav.search')" :question="t('search.question')" wide rhythm="immediate">
    <template #lead>
      <form class="search-desk__form" @submit.prevent="runSearchImmediately">
        <label id="search-query-label" class="search-desk__label" for="search-query">
          {{ t("search.inputLabel") }}
        </label>
        <div class="search-desk__toolbar">
          <div class="search-desk__input-wrap">
            <AppIcon class="search-desk__input-icon" name="search" :size="18" />
            <input
              id="search-query"
              ref="queryInputRef"
              v-model="query"
              class="search-desk__input"
              type="search"
              :placeholder="t(`search.placeholder.${searchOptions.strategy}`)"
              autocomplete="off"
              aria-labelledby="search-query-label"
              aria-describedby="search-strategy-hint search-status-line search-keyboard-hint"
              spellcheck="false"
              role="combobox"
              aria-autocomplete="list"
              :aria-controls="resultRows.length > 0 ? 'search-results' : undefined"
              aria-haspopup="listbox"
              :aria-expanded="resultRows.length > 0"
              :aria-busy="isSearching"
              :aria-activedescendant="activeResultId"
              @keydown="onQueryKeydown"
            />
          </div>
          <button class="search-desk__submit" type="submit">
            {{ t("search.searchAction") }}
          </button>
          <button v-if="query" class="search-desk__clear" type="button" @click="clearQuery">
            {{ t("actions.clear") }}
          </button>
        </div>
        <div class="search-desk__type">
          <label class="search-desk__type-label" for="search-strategy">
            {{ t("search.searchType") }}
          </label>
          <select
            id="search-strategy"
            class="search-desk__type-select"
            :value="searchOptions.strategy"
            aria-describedby="search-strategy-hint"
            @change="setStrategy(($event.target as HTMLSelectElement).value as SearchStrategyId)"
          >
            <option v-for="strategy in SEARCH_STRATEGY_IDS" :key="strategy" :value="strategy">
              {{ t(`search.strategies.${strategy}`) }}
            </option>
          </select>
          <p id="search-strategy-hint" class="search-desk__type-hint" aria-live="polite">
            {{ t(`search.strategyHint.${searchOptions.strategy}`) }}
          </p>
        </div>
        <p id="search-status-line" class="search-desk__meta">
          <span>{{ t("search.scopeLabel", { scope: scopeLabel }) }}</span>
          <span aria-hidden="true">·</span>
          <span>{{ t("search.filtersLabel", { filters: filterSummary }) }}</span>
          <button class="search-desk__options" type="button" @click="openSearchOptions">
            {{ t("search.filtersOptions") }}
          </button>
        </p>
        <p v-if="isSearching" class="search-desk__progress" role="status" aria-live="polite">
          {{ t("search.inProgress") }}
        </p>
        <p v-else-if="!searchTerm && searchableNotes.length > 0" class="search-desk__progress">
          {{ t("search.searchingAcross", { count: formatDocumentCount(searchableNotes.length) }) }}
        </p>
        <p id="search-keyboard-hint" class="search-desk__progress">
          {{ t("search.keyboardHint") }}
        </p>
      </form>
    </template>

    <div class="search-desk">
      <p v-if="errorMessage" class="search-desk__error" role="alert">
        {{ errorMessage }}
      </p>
      <p
        v-else-if="queryIssueText && resultRows.length > 0"
        class="search-desk__error"
        role="alert"
      >
        {{ queryIssueText }}
      </p>

      <div v-if="searchTerm && resultRows.length > 0" class="search-desk__results-region">
        <div class="search-desk__results-heading">
          <h2>{{ resultSummary }}</h2>
          <span>{{ t("search.resultsHint") }}</span>
        </div>
        <ul
          id="search-results"
          class="search-desk__results"
          role="listbox"
          :aria-label="t('search.matches')"
        >
          <li
            v-for="group in resultGroups"
            :key="group.note.path"
            class="search-result"
            role="none"
          >
            <div class="search-result__header">
              <h3 class="search-result__title">
                <span v-if="group.note.hidden" class="search-result__hidden" aria-hidden="true"
                  >·</span
                >{{ group.note.title }}
              </h3>
              <span class="search-result__count">
                {{
                  t(group.totalMatches === 1 ? "search.matchOne" : "search.matchMany", {
                    count: group.totalMatches.toLocaleString(locale),
                  })
                }}
              </span>
            </div>
            <p class="search-result__path">{{ group.relativePath }}</p>
            <button
              v-for="row in group.rows"
              :id="`search-result-option-${row.index}`"
              :key="`${group.note.path}-${row.match.offset}`"
              type="button"
              class="search-result__match"
              role="option"
              tabindex="-1"
              :aria-selected="highlightIndex === row.index"
              :class="{ 'is-selected': highlightIndex === row.index }"
              @click="openResult(row.index)"
              @contextmenu="openResultMenu($event, row.index)"
              @keydown="onResultKeydown($event, row.index)"
            >
              <span class="search-result__snippet">
                <template
                  v-for="(part, partIndex) in row.snippetParts"
                  :key="`${row.index}-${partIndex}-${part.match}`"
                >
                  <mark v-if="part.match" class="search-result__mark">{{ part.text }}</mark>
                  <template v-else>{{ part.text }}</template>
                </template>
              </span>
              <span class="search-result__line">
                <template v-if="row.kindLabel">
                  {{ row.kindLabel }}
                  <span aria-hidden="true"> · </span>
                </template>
                {{ t("search.matchLine", { line: row.match.lineNumber }) }}
              </span>
            </button>
          </li>
        </ul>
        <p v-if="matchingHits.length > resultRows.length" class="search-desk__limit">
          {{
            t("search.showingLimit", {
              shown: resultRows.length.toLocaleString(locale),
            })
          }}
        </p>
      </div>

      <EmptyState
        v-else-if="searchTerm && queryIssueTitle && queryIssueText"
        pace="direct"
        live
        :title="queryIssueTitle"
        :text="queryIssueText"
      />

      <EmptyState
        v-else-if="searchTerm"
        pace="direct"
        live
        :title="t('search.nothingMatched')"
        :text="activeFilters > 0 ? t('search.noResultsFiltered') : t('search.noResultsText')"
      />

      <EmptyState
        v-else-if="searchableNotes.length === 0 && activeFilters > 0"
        pace="direct"
        live
        :title="t('search.nothingMatched')"
        :text="t('search.noResultsFiltered')"
      />

      <EmptyState
        v-else-if="searchableNotes.length === 0"
        pace="direct"
        live
        :title="t('search.noDocuments')"
        :text="workspace ? t('search.noDocumentsFolder') : t('search.noDocumentsStandalone')"
      />

      <EmptyState
        v-else
        pace="direct"
        :title="t('search.question')"
        :text="workspace ? t('search.startHint') : t('search.startStandalone')"
      />
    </div>

    <ContextMenu
      :open="contextMenu.open"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :actions="contextActions"
      :label="t('actions.noActions')"
      @select="void runResultAction($event)"
      @close="contextMenu = { ...contextMenu, open: false }"
    />
  </PageShell>
</template>

<style scoped lang="scss">
@use "../../styles/colors" as *;
@use "../../styles/variables" as *;
@use "../../styles/object-layout" as *;
@use "../../styles/page-layout" as *;
@use "../../styles/controls" as *;

.search-desk {
  display: flex;
  flex-direction: column;
  gap: $space-related;
  width: 100%;
  max-width: 68rem;
  min-height: 0;
}

.search-desk__form {
  display: flex;
  flex-direction: column;
  gap: $space-related;
}

.search-desk__label {
  color: $text-primary;
  font-size: $font-control;
  font-weight: 600;
}

.search-desk__toolbar {
  display: flex;
  align-items: stretch;
  gap: $space-related;
  min-width: 0;
}

.search-desk__input-wrap {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
}

.search-desk__input-icon {
  position: absolute;
  top: 50%;
  left: $space-related;
  z-index: 1;
  color: $text-muted;
  pointer-events: none;
  transform: translateY(-50%);
}

.search-desk__input {
  @include control-search;
  width: 100%;
  padding-left: calc(#{$space-related} + 18px + #{$space-tight});
  font-size: $font-lead;
}

.search-desk__submit {
  @include action-button;
  flex: 0 0 auto;
  align-self: center;
}

.search-desk__clear {
  @include quiet-button;
  flex: 0 0 auto;
  align-self: center;
}

.search-desk__type {
  display: grid;
  grid-template-columns: auto minmax(12rem, 22rem);
  align-items: center;
  column-gap: $space-related;
  row-gap: $space-tight;
}

.search-desk__type-label {
  color: $text-primary;
  font-size: $font-control;
  font-weight: 600;
}

.search-desk__type-select {
  @include control-select;
  width: 100%;
  min-width: 0;
}

.search-desk__type-hint {
  grid-column: 1 / -1;
  min-height: 2.8em;
  margin: 0;
  color: $text-secondary;
  font-size: $font-label;
  line-height: 1.4;
}

.search-desk__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: $space-tight $space-related;
  margin: 0;
  color: $text-muted;
  font-size: $font-caption;
}

.search-desk__options {
  @include quiet-button;
  min-height: $control-height-small;
  padding: 0 $space-3;
  font-size: $font-caption;
}

.search-desk__progress {
  margin: 0;
  color: $text-muted;
  font-size: $font-caption;
}

.search-desk__results-region {
  display: flex;
  flex-direction: column;
  gap: $space-related;
  min-height: 0;
}

.search-desk__results-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: $space-related;

  h2 {
    margin: 0;
    color: $text-primary;
    font-size: $font-control;
    font-weight: 600;
  }

  span {
    color: $text-muted;
    font-size: $font-caption;
  }
}

.search-desk__results {
  @include object-row-list;
  gap: $space-group;
}

.search-result {
  display: flex;
  flex-direction: column;
  gap: $space-related;
  min-width: 0;
}

.search-result__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: $space-related;
}

.search-result__title {
  margin: 0;
  color: $text-primary;
  font-size: $font-lead;
  font-weight: 600;
}

.search-result__hidden {
  margin-inline-end: $space-tight;
  color: $text-muted;
}

.search-result__count,
.search-result__path,
.search-result__line {
  color: $text-muted;
  font-size: $font-caption;
}

.search-result__path {
  margin: 0;
  font-family: $font-mono;
  overflow-wrap: anywhere;
}

.search-result__match {
  @include object-hover-row;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: $space-tight;
  margin-inline-start: $space-related;
  width: calc(100% - #{$space-related});
  color: inherit;
  font: inherit;
  text-align: left;

  &.is-selected {
    @include object-selected-row;
  }

  &.is-selected .search-result__line,
  &.is-selected .search-result__mark {
    color: $selection-foreground;
  }

  &:focus-visible {
    outline: 2px solid $focus-ring;
    outline-offset: 2px;
  }
}

.search-result__snippet {
  display: block;
  color: $text-secondary;
  font-size: $font-label;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.search-result__mark {
  border-radius: 2px;
  background: color-mix(in srgb, $accent 28%, $surface-elevated);
  color: $text-primary;
  font-weight: 700;
  box-decoration-break: clone;
}

.search-result__match.is-selected .search-result__mark {
  background: color-mix(in srgb, $selection-foreground 22%, $selection);
  color: $selection-foreground;
}

.search-desk__limit,
.search-desk__error {
  margin: 0;
  color: $text-muted;
  font-size: $font-label;
  line-height: 1.4;
}

.search-desk__error {
  color: $error-text;
}

@media (forced-colors: active) {
  .search-result__mark {
    background: Highlight;
    color: HighlightText;
  }
}

@media (max-width: 640px) {
  .search-desk__toolbar {
    flex-wrap: wrap;
  }

  .search-desk__input-wrap {
    flex-basis: 100%;
  }

  .search-desk__type {
    grid-template-columns: minmax(0, 1fr);
  }

  .search-result__match {
    margin-inline-start: 0;
    width: 100%;
  }

  .search-desk__results-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: $space-tight;
  }
}
</style>
