<script setup lang="ts">
/**
 * Document Context panel - stage sibling of the current surface.
 *
 * Facts, incoming/outgoing links, and reading stats are projections of scan
 * evidence plus the active buffer. This drawer does not own document identity
 * or a second index.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

import {
  candidateNotesForLink,
  noteConnections,
  unresolvedDocumentLinks,
} from "../links/linkSemantics";
import type { LinkCandidate } from "../links/linkSemantics";
import { documentFactLabel, documentFactsForNote } from "../facts/documentFacts";
import {
  closeInspector,
  focusDocument,
  inspectionPath,
  inspectorOpen,
  noteTitle,
  peekDocument,
} from "../../workspace/focus/focusState";
import {
  buildReadingGuidance,
  explainReferenceEvidence,
  noteReach,
  noteReachFacts,
} from "../context/contextRetrieval";
import { openOrActivate } from "../../editor/document/documentBuffers";
import { notifyFilesystemError } from "../../workspace/filesystem/workspaceScanner";
import EmptyState from "../../../shell/EmptyState.vue";
import AppIcon from "../../../shell/AppIcon.vue";
import NotePreview from "../facts/NotePreview.vue";
import FactEvidence from "../facts/FactEvidence.vue";
import FactGroup from "../facts/FactGroup.vue";
import FactRow from "../facts/FactRow.vue";
import FactSection from "../facts/FactSection.vue";
import FactStatement from "../facts/FactStatement.vue";
import ContextMenu, { type ContextMenuAction } from "../../../shell/ContextMenu.vue";
import { notify } from "../../../app/notify";
import { INSPECTOR_WIDTH_LIMITS, layout, setInspectorWidth } from "../../../app/layoutStore";
import {
  workspaceNotes,
  copyWorkspacePath,
  revealWorkspaceInExplorer,
  validatedFocus,
  workspace,
} from "../../../app/workspaceState";
import { APP_ROUTE_NAMES } from "../../../app/router";
import { settings } from "../../settings/settingsStore";

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const props = withDefaults(
  defineProps<{
    embedded?: boolean;
  }>(),
  { embedded: false },
);

const readingPath = computed(() => inspectionPath.value ?? validatedFocus.value?.path ?? null);

const readingNote = computed(() => {
  if (!readingPath.value) {
    return null;
  }
  return workspaceNotes.value.find((note) => note.path === readingPath.value) ?? null;
});

const displayTitle = computed(() => {
  if (!readingPath.value) {
    return "";
  }
  return noteTitle(readingPath.value, workspaceNotes.value);
});

const isPeeking = computed(() => {
  const peek = inspectionPath.value;
  const focus = validatedFocus.value?.path;
  return Boolean(peek && focus && peek !== focus);
});

const explainingQuestion = computed(() =>
  isPeeking.value ? t("inspector.relatedDocument") : t("inspector.documentContext"),
);
const onGraph = computed(() => route.name === APP_ROUTE_NAMES.graph);

const regardingPeek = computed(() => {
  if (!isPeeking.value || !validatedFocus.value) {
    return undefined;
  }
  return noteTitle(validatedFocus.value.path, workspaceNotes.value);
});

interface ReferenceEntry {
  path: string;
  title: string;
  relativePath: string;
  evidence: string | null;
}

function toReferenceEntries(paths: string[], direction: "out" | "in"): ReferenceEntry[] {
  const focus = readingPath.value;
  return paths.map((path) => ({
    path,
    title: noteTitle(path, workspaceNotes.value),
    relativePath: path,
    evidence:
      focus == null
        ? null
        : explainReferenceEvidence(
            direction === "out" ? focus : path,
            direction === "out" ? path : focus,
            workspaceNotes.value,
          ),
  }));
}

const connections = computed(() =>
  readingNote.value ? noteConnections(readingNote.value.path, workspaceNotes.value) : null,
);

const referencesEntries = computed(() =>
  connections.value ? toReferenceEntries(connections.value.references, "out") : [],
);

const referencedByEntries = computed(() =>
  connections.value ? toReferenceEntries(connections.value.referencedBy, "in") : [],
);

const unresolvedLinks = computed(() =>
  readingNote.value ? unresolvedDocumentLinks(readingNote.value, workspaceNotes.value) : [],
);

interface IncompleteReference {
  link: string;
  candidates: Array<LinkCandidate & { title: string; relativePath: string }>;
}

const incompleteReferences = computed((): IncompleteReference[] => {
  return unresolvedLinks.value.map((link) => ({
    link,
    candidates: candidateNotesForLink(link, workspaceNotes.value).map((candidate) => ({
      ...candidate,
      title: noteTitle(candidate.path, workspaceNotes.value),
      relativePath: candidate.path,
    })),
  }));
});

function formatUnresolvedLink(link: string): string {
  return settings.value.links.linkMode === "wikilink" ? `[[${link}]]` : `[${link}](${link})`;
}

const readingGuidance = computed(() => {
  if (!readingPath.value || !readingNote.value) {
    return [];
  }

  return buildReadingGuidance(readingPath.value, workspaceNotes.value);
});

const documentFacts = computed(() =>
  readingNote.value ? documentFactsForNote(readingNote.value) : [],
);

const reachFactRows = computed(() => {
  if (!readingNote.value) {
    return [];
  }
  return noteReachFacts(noteReach(readingNote.value.path, workspaceNotes.value));
});

const panelRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const pathMenuOpen = ref(false);
const pathMenuX = ref(0);
const pathMenuY = ref(0);
const scrollByPath = new Map<string, number>();
let inspectorResizeCleanup: (() => void) | null = null;
let previousFocus: HTMLElement | null = null;

const pathMenuActions = computed<readonly ContextMenuAction[]>(() => [
  { id: "copy", label: t("menu.copyPath") },
  { id: "reveal", label: t("menu.revealInFolder") },
  ...(!onGraph.value ? [{ id: "graph", label: t("actions.seeWhere") }] : []),
]);

async function openReadingDocument(path: string): Promise<boolean> {
  const rootPath = workspace.value?.path;
  if (!rootPath) {
    return false;
  }

  try {
    await openOrActivate({ kind: "workspace", rootPath, path });
    return true;
  } catch (error) {
    notifyFilesystemError(error, "workspace.openDocumentError", notify);
    return false;
  }
}

async function openConnectedDocument(path: string): Promise<void> {
  if (isPeeking.value) {
    peekDocument(path);
    return;
  }
  await openReadingDocument(path);
}

async function makeFocus(): Promise<void> {
  if (readingPath.value && (await openReadingDocument(readingPath.value))) {
    focusDocument(readingPath.value);
  }
}

/** Commit Focus and ask where this document sits. */
async function localizeInGraph(): Promise<void> {
  if (!readingPath.value || onGraph.value) {
    return;
  }
  if (await openReadingDocument(readingPath.value)) {
    focusDocument(readingPath.value);
    await router.push({ name: APP_ROUTE_NAMES.graph });
  }
}

function revealReadingPath(): void {
  if (readingPath.value) {
    void revealWorkspaceInExplorer(readingPath.value);
  }
}

function copyReadingPath(): void {
  if (readingPath.value) {
    void copyWorkspacePath(readingPath.value);
  }
}

function closePathMenu(): void {
  pathMenuOpen.value = false;
}

async function runPathMenu(id: string): Promise<void> {
  closePathMenu();
  if (id === "copy") {
    copyReadingPath();
  } else if (id === "reveal") {
    revealReadingPath();
  } else if (id === "graph") {
    await localizeInGraph();
  }
}

function openPathMenuAt(x: number, y: number): void {
  if (!readingPath.value) {
    return;
  }

  pathMenuOpen.value = true;
  pathMenuX.value = x;
  pathMenuY.value = y;
}

function onPathContextMenu(event: MouseEvent): void {
  event.preventDefault();
  (event.currentTarget as HTMLElement).focus();
  openPathMenuAt(event.clientX, event.clientY);
}

function onPathKeydown(event: KeyboardEvent): void {
  if (
    !["Enter", " ", "ContextMenu"].includes(event.key) &&
    !(event.shiftKey && event.key === "F10")
  ) {
    return;
  }

  event.preventDefault();
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  openPathMenuAt(bounds.left, bounds.bottom);
}

function startInspectorResize(event: PointerEvent): void {
  event.preventDefault();
  inspectorResizeCleanup?.();
  const startX = event.clientX;
  const startWidth = layout.value.inspectorWidth;
  let cleanup = (): void => {};

  const onMove = (moveEvent: PointerEvent): void => {
    setInspectorWidth(startWidth - (moveEvent.clientX - startX));
  };

  const onUp = (): void => {
    cleanup();
    if (inspectorResizeCleanup === cleanup) {
      inspectorResizeCleanup = null;
    }
  };
  cleanup = (): void => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  inspectorResizeCleanup = cleanup;
}

function rememberScroll(): void {
  if (!readingPath.value || !contentRef.value) {
    return;
  }

  scrollByPath.set(readingPath.value, contentRef.value.scrollTop);
}

function restoreScroll(): void {
  const path = readingPath.value;
  const el = contentRef.value;
  if (!path || !el) {
    return;
  }

  const top = scrollByPath.get(path) ?? 0;
  requestAnimationFrame(() => {
    el.scrollTop = top;
  });
}

function closeOnEscape(event: KeyboardEvent): void {
  if (props.embedded || event.key !== "Escape" || event.defaultPrevented || !inspectorOpen.value) {
    return;
  }
  if (
    event.target instanceof Element &&
    event.target.closest(".monaco-editor, .dialog-host, .context-menu")
  ) {
    return;
  }
  event.preventDefault();
  closeInspector();
}

watch(
  inspectorOpen,
  (open) => {
    if (open) {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      void nextTick(() => panelRef.value?.focus({ preventScroll: true }));
      return;
    }

    rememberScroll();

    if (!props.embedded && previousFocus && document.contains(previousFocus)) {
      previousFocus.focus({ preventScroll: true });
    }
    previousFocus = null;
  },
  { immediate: true },
);

watch(readingPath, (next, prev) => {
  if (prev && contentRef.value) {
    scrollByPath.set(prev, contentRef.value.scrollTop);
  }
  if (next) {
    restoreScroll();
  }
});

onMounted(() => {
  if (!props.embedded) {
    window.addEventListener("keydown", closeOnEscape);
  }
});
onBeforeUnmount(() => {
  inspectorResizeCleanup?.();
  inspectorResizeCleanup = null;
  rememberScroll();
  window.removeEventListener("keydown", closeOnEscape);
});
</script>

<template>
  <aside
    v-if="inspectorOpen"
    ref="panelRef"
    class="inspector-panel"
    tabindex="-1"
    :class="{
      'inspector-panel--notebook': onGraph,
      'inspector-panel--embedded': props.embedded,
    }"
    role="complementary"
    aria-labelledby="inspector-title"
  >
    <div
      class="inspector-panel__resize"
      role="slider"
      aria-orientation="horizontal"
      :aria-label="t('inspector.width')"
      :aria-valuenow="layout.inspectorWidth"
      :aria-valuemin="INSPECTOR_WIDTH_LIMITS.min"
      :aria-valuemax="INSPECTOR_WIDTH_LIMITS.max"
      tabindex="0"
      @pointerdown="startInspectorResize"
      @keydown.left.prevent="setInspectorWidth(layout.inspectorWidth + 8)"
      @keydown.right.prevent="setInspectorWidth(layout.inspectorWidth - 8)"
    />

    <header class="inspector-panel__header">
      <div class="inspector-panel__heading">
        <p class="inspector-panel__question">
          {{ explainingQuestion }}
        </p>
        <p v-if="displayTitle" id="inspector-title" class="inspector-panel__title">
          {{ displayTitle }}
        </p>
        <p v-else id="inspector-title" class="inspector-panel__title">
          {{ t("inspector.document") }}
        </p>
        <p v-if="regardingPeek" class="inspector-panel__peek-note">
          {{ t("inspector.beside", { name: regardingPeek }) }}
        </p>
        <button
          v-if="readingPath"
          class="inspector-panel__path"
          :title="t('inspector.rightClickPath')"
          :aria-label="`${readingPath} - ${t('inspector.pathActions')}`"
          aria-haspopup="menu"
          :aria-expanded="pathMenuOpen"
          type="button"
          @contextmenu="onPathContextMenu"
          @keydown="onPathKeydown"
        >
          {{ readingPath }}
        </button>
        <div v-if="readingPath && (!onGraph || isPeeking)" class="inspector-panel__actions">
          <button
            v-if="isPeeking"
            class="inspector-panel__action"
            type="button"
            :title="t('inspector.continueExploring')"
            @click="makeFocus"
          >
            {{ t("actions.focus") }}
          </button>
          <button
            v-if="!onGraph"
            class="inspector-panel__action"
            type="button"
            :title="t('inspector.whereIsDocument')"
            @click="localizeInGraph"
          >
            {{ t("actions.seeWhere") }}
          </button>
        </div>
      </div>
      <button
        v-if="!props.embedded"
        class="inspector-panel__close"
        type="button"
        :aria-label="t('inspector.close')"
        @click="closeInspector"
      >
        <AppIcon name="close" :size="14" />
      </button>
    </header>

    <ContextMenu
      :open="pathMenuOpen"
      :x="pathMenuX"
      :y="pathMenuY"
      :actions="pathMenuActions"
      :label="t('inspector.pathActions')"
      @select="runPathMenu"
      @close="closePathMenu"
    />

    <div v-if="!readingPath" class="inspector-panel__empty">
      <EmptyState
        pace="direct"
        :title="t('inspector.noContext')"
        :text="t('inspector.noContextText')"
      />
    </div>

    <div v-else-if="!readingNote" class="inspector-panel__empty">
      <EmptyState
        pace="direct"
        :title="t('inspector.notHere')"
        :text="t('inspector.notHereText')"
      />
    </div>

    <div v-else ref="contentRef" class="inspector-panel__content" @scroll.passive="rememberScroll">
      <div class="inspector-panel__answer">
        <FactSection
          v-if="documentFacts.length > 0"
          :title="t('inspector.inDocument')"
          :heading-level="3"
        >
          <FactGroup>
            <FactRow v-for="fact in documentFacts" :key="fact.id" :fact="fact" />
          </FactGroup>
        </FactSection>

        <FactSection v-if="readingNote.summary" :title="t('facts.summary')" :heading-level="3">
          <FactStatement>{{ readingNote.summary }}</FactStatement>
        </FactSection>

        <FactSection
          v-if="readingGuidance.length > 0"
          :title="t('inspector.amongReferences')"
          :heading-level="3"
        >
          <FactGroup>
            <FactStatement v-for="(paragraph, index) in readingGuidance" :key="index">
              {{ paragraph }}
            </FactStatement>
          </FactGroup>
        </FactSection>
      </div>

      <div class="inspector-panel__continue">
        <FactSection
          v-if="settings.links.showOutgoingLinks"
          :title="documentFactLabel('outbound_references')"
          :heading-level="3"
        >
          <ul v-if="referencesEntries.length > 0" class="inspector-panel__reference-list">
            <li v-for="entry in referencesEntries" :key="entry.path">
              <NotePreview
                :title="entry.title"
                :path="entry.relativePath"
                @click="openConnectedDocument(entry.path)"
              />
              <FactEvidence v-if="entry.evidence" :text="entry.evidence" />
            </li>
          </ul>
          <FactStatement v-else>{{ t("inspector.noOutgoing") }}</FactStatement>
        </FactSection>

        <FactSection
          v-if="settings.links.showIncomingLinks"
          :title="documentFactLabel('inbound_references')"
          :heading-level="3"
        >
          <ul v-if="referencedByEntries.length > 0" class="inspector-panel__reference-list">
            <li v-for="entry in referencedByEntries" :key="entry.path">
              <NotePreview
                :title="entry.title"
                :path="entry.relativePath"
                @click="openConnectedDocument(entry.path)"
              />
              <FactEvidence v-if="entry.evidence" :text="entry.evidence" />
            </li>
          </ul>
          <FactStatement v-else>{{ t("inspector.noIncoming") }}</FactStatement>
        </FactSection>

        <FactSection
          v-if="incompleteReferences.length > 0"
          :title="documentFactLabel('incomplete_references')"
          :heading-level="3"
        >
          <ul class="inspector-panel__unresolved-list">
            <li
              v-for="entry in incompleteReferences"
              :key="entry.link"
              class="inspector-panel__incomplete"
            >
              <button
                v-if="entry.candidates.length === 1"
                type="button"
                class="inspector-panel__unresolved inspector-panel__unresolved--action"
                :title="t('links.open', { path: entry.candidates[0].relativePath })"
                @click="openConnectedDocument(entry.candidates[0].path)"
              >
                {{ formatUnresolvedLink(entry.link) }}
              </button>
              <code v-else class="inspector-panel__unresolved">{{
                formatUnresolvedLink(entry.link)
              }}</code>
              <ul
                v-if="entry.candidates.length > 1"
                class="inspector-panel__candidate-list"
                :aria-label="t('inspector.possibleMatches')"
              >
                <li v-for="candidate in entry.candidates" :key="`${entry.link}:${candidate.path}`">
                  <NotePreview
                    :title="candidate.title"
                    :path="candidate.relativePath"
                    @click="peekDocument(candidate.path)"
                  />
                </li>
              </ul>
              <ul
                v-else-if="entry.candidates.length === 1"
                class="inspector-panel__candidate-list"
                :aria-label="t('inspector.possibleMatches')"
              >
                <li>
                  <NotePreview
                    :title="entry.candidates[0].title"
                    :path="entry.candidates[0].relativePath"
                    @click="openConnectedDocument(entry.candidates[0].path)"
                  />
                </li>
              </ul>
            </li>
          </ul>
        </FactSection>

        <FactSection
          v-if="reachFactRows.length > 0"
          :title="documentFactLabel('reachability')"
          :heading-level="3"
        >
          <FactGroup>
            <FactRow v-for="entry in reachFactRows" :key="entry.id" :fact="entry" />
          </FactGroup>
        </FactSection>
      </div>
    </div>
  </aside>
</template>

<style scoped lang="scss">
@use "../../../styles/colors" as *;
@use "../../../styles/controls" as *;
@use "../../../styles/variables" as *;
@use "../../../styles/object-layout" as *;
@use "../../../styles/page-layout" as *;

.inspector-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 0 0 $inspector-width;
  width: $inspector-width;
  min-width: 260px;
  max-width: 440px;
  height: 100%;
  border-left: 1px solid $border-subtle;
  background: $surface;
  overflow: hidden;
}

.inspector-panel--notebook {
  border-left: 1px solid $border;
  background: color-mix(in srgb, $surface 92%, $surface-elevated);
}

.inspector-panel--embedded {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  max-width: none;
  border-left: 0;
}

.inspector-panel--embedded .inspector-panel__resize {
  display: none;
}

.inspector-panel__resize {
  position: absolute;
  top: 0;
  left: -3px;
  z-index: 2;
  width: 6px;
  height: 100%;
  @include resize-handle-interaction;
}

.inspector-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: $space-related;
  padding: $space-compact $space-block;
  border-bottom: 1px solid $border-subtle;
}

.inspector-panel__heading {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.inspector-panel__question {
  margin: 0;
  color: $text-muted;
  font-size: $font-caption;
  font-weight: 400;
  letter-spacing: -0.01em;
  line-height: 1.35;
}

.inspector-panel__title {
  margin: 0;
  font-size: $font-section;
  font-weight: 600;
  letter-spacing: -0.022em;
  line-height: 1.3;
  color: $text-primary;
  word-break: break-word;
}

.inspector-panel__peek-note {
  margin: 0;
  color: $text-secondary;
  font-size: $font-label;
  line-height: 1.4;
}

.inspector-panel__path {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  margin: 0;
  color: $text-muted;
  font-family: $font-mono;
  font-size: $font-caption;
  line-height: 1.4;
  word-break: break-all;
  text-align: start;
  cursor: context-menu;

  &:focus-visible {
    outline: 2px solid $focus-ring;
    outline-offset: 2px;
  }
}

.inspector-panel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: $space-related;
  margin-top: $space-tight;
}

.inspector-panel__action {
  @include quiet-button;
  gap: $space-related;
  min-height: $hit-min;
  padding-inline: $space-compact;
}

.inspector-panel__close {
  @include quiet-button;
  flex-shrink: 0;
  min-width: $hit-min;
  min-height: $hit-min;
  padding: 0;
}

.inspector-panel__empty {
  padding: $space-block;
}

.inspector-panel__content {
  @include scroll-region;
  display: flex;
  flex-direction: column;
  gap: $space-group;
  padding: $space-compact $space-block $space-block;
  overscroll-behavior: contain;
}

.inspector-panel__answer {
  display: flex;
  flex-direction: column;
  gap: $space-block;

  :deep(.fact-statement__text) {
    font-size: $font-control;
    line-height: 1.65;
  }

  :deep(.fact-row) {
    padding-block: 3px;
  }
}

.inspector-panel__continue {
  @include exploration-continue;
  gap: $space-block;
  padding-top: $space-block;
  border-top: 1px solid $border-subtle;
}

.inspector-panel__answer :deep(.fact-section__title),
.inspector-panel__continue :deep(.fact-section__title) {
  color: $text-muted;
  font-size: $font-caption;
  font-weight: 600;
  letter-spacing: 0.01em;
  text-transform: uppercase;
}

.inspector-panel__reference-list {
  @include object-row-list;
  gap: 0;
  margin-top: $space-tight;

  :deep(.note-preview) {
    gap: 2px;
    padding-block: $space-related;
  }

  :deep(.note-preview__title) {
    font-size: $font-control;
  }

  /* The evidence line is a sibling of the row, not a child, so it does not
   * inherit the row's inset and would hang to the left of the title it
   * explains. Match the inset so each wikilink lines up under its reference. */
  :deep(.fact-evidence) {
    padding-inline: $space-block;
  }
}

.inspector-panel__unresolved-list {
  margin: $space-related 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: $space-group;
}

.inspector-panel__incomplete {
  display: flex;
  flex-direction: column;
  gap: $space-related;
}

.inspector-panel__candidate-list {
  @include object-row-list;
  gap: $space-tight;
  margin: 0;
  padding: 0;
  list-style: none;
}

.inspector-panel__unresolved {
  color: $text-muted;
  font-family: $font-mono;
  font-size: $font-label;
}

.inspector-panel__unresolved--action {
  display: inline;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: $text-link;
  cursor: pointer;
  text-align: left;

  &:hover,
  &:focus-visible {
    text-decoration: underline;
  }
}
</style>
