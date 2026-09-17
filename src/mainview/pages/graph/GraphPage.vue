<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

import GraphCanvas from "../../modules/graph/view/GraphCanvas.vue";
import AppIcon from "../../shell/AppIcon.vue";
import EmptyState from "../../shell/EmptyState.vue";
import PageShell from "../../shell/PageShell.vue";
import { projectReferenceGraph } from "../../modules/graph/core/graphProjection";
import type {
  ComposedGraph,
  HoverDetails,
  ReferenceGraph,
} from "../../modules/graph/core/graphTypes";
import {
  clampGraphDepth,
  DEFAULT_GRAPH_VIEW_STATE,
  GRAPH_DEPTH_STEPS,
  type GraphViewState,
} from "../../modules/graph/core/graphViewState";
import {
  computeComposedGraph,
  terminateActiveGraphWorker,
} from "../../modules/graph/computeComposedGraph";
import { noteTitle, openInspector } from "../../modules/workspace/focus/focusState";
import {
  openBuffers,
  openOrActivate,
  selectDocument,
} from "../../modules/editor/document/documentBuffers";
import { unresolvedDocumentLinks } from "../../modules/document/links/linkSemantics";
import { graphActiveTarget } from "../../modules/graph/active-document/graphActiveDocument";
import { workspace } from "../../app/workspaceState";
import { isTypingTarget } from "../../app/isTypingTarget";
import { notify } from "../../app/notify";
import { APP_ROUTE_NAMES } from "../../app/router";
import { notifyFilesystemError } from "../../modules/workspace/filesystem/workspaceScanner";

type GraphDepth = (typeof GRAPH_DEPTH_STEPS)[number];

const router = useRouter();
const route = useRoute();
const { t } = useI18n();
const viewState = ref<GraphViewState>({ ...DEFAULT_GRAPH_VIEW_STATE });
const composedGraph = ref<ComposedGraph | null>(null);
const hoverDetails = ref<HoverDetails | null>(null);
const traversalNodeId = ref<string | null>(null);
const isDeriving = ref(false);
const canvasRef = ref<InstanceType<typeof GraphCanvas> | null>(null);
const workspaceRef = ref<HTMLDivElement | null>(null);
const depthButtonRefs = new Map<GraphDepth, HTMLButtonElement>();
let layoutGeneration = 0;
let focusCanvasOnFirstGraph = true;

const referenceGraph = computed(() => {
  const target = graphActiveTarget.value;
  if (!target) {
    return null;
  }

  return projectReferenceGraph(target.focusPath, [...target.notes], viewState.value);
});

const focusTitle = computed(() => graphActiveTarget.value?.title ?? null);

const focusRelativePath = computed(() => graphActiveTarget.value?.focusPath ?? null);

const graphSummary = computed(() => {
  const composed = composedGraph.value;
  if (!composed) {
    return null;
  }

  const documents = composed.nodes.length;
  const connections = composed.edges.length;
  const depth = viewState.value.depth;
  const contextLabel =
    depth === 1 ? t("graph.nearestReferences") : t("graph.stepsOfContext", { count: depth });

  let text = t("graph.nearbySummary", {
    documents: documents.toLocaleString(),
    connections: connections.toLocaleString(),
    context: contextLabel,
  });

  const target = graphActiveTarget.value;
  if (!target) {
    return text;
  }

  const focusNote = target.notes.find((note) => note.path === target.focusPath);
  if (!focusNote) {
    return text;
  }

  const incomplete = unresolvedDocumentLinks(focusNote, [...target.notes]).length;
  if (incomplete > 0) {
    text += `, ${
      incomplete === 1
        ? t("graph.incompleteOne", { count: incomplete })
        : t("graph.incompleteMany", { count: incomplete })
    }`;
  } else if (documents === 1) {
    text += `, ${t("graph.standsAlone")}`;
  }

  return text;
});

const pageTitle = computed(() => focusTitle.value ?? t("nav.graph"));

const regardingLine = computed(() => {
  // Title already names the document - regarding only orients the neighborhood.
  return graphSummary.value ?? focusRelativePath.value ?? undefined;
});

async function deriveGraph(graph: ReferenceGraph): Promise<void> {
  const generation = ++layoutGeneration;
  isDeriving.value = true;
  try {
    const composed = await computeComposedGraph(graph);
    if (generation !== layoutGeneration) {
      return;
    }
    composedGraph.value = composed;
    if (focusCanvasOnFirstGraph) {
      focusCanvasOnFirstGraph = false;
      await nextTick();
      if (
        !(document.activeElement instanceof Element) ||
        !document.activeElement.closest(".app-shell__panel")
      ) {
        canvasRef.value?.focus();
      }
    }
  } finally {
    if (generation === layoutGeneration) {
      isDeriving.value = false;
    }
  }
}

function narrowContext(): void {
  setDepth(viewState.value.depth - 1);
}

function widenContext(): void {
  setDepth(viewState.value.depth + 1);
}

function truncateHoverVisible(items: string[], limit = 6): string[] {
  if (items.length <= limit) {
    return items;
  }

  return [...items.slice(0, limit), t("graph.more", { count: items.length - limit })];
}

const tooltipStyle = computed(() => {
  if (!hoverDetails.value || !workspaceRef.value) {
    return null;
  }

  const padding = 12;
  const topSafe = 48;
  const approxWidth = 260;
  const approxHeight = 140;
  const bounds = workspaceRef.value.getBoundingClientRect();
  let left = hoverDetails.value.x + padding;
  let top = hoverDetails.value.y + padding;

  if (left + approxWidth > bounds.width) {
    left = Math.max(padding, hoverDetails.value.x - approxWidth - padding);
  }
  if (top + approxHeight > bounds.height) {
    top = Math.max(topSafe, hoverDetails.value.y - approxHeight - padding);
  }

  top = Math.max(topSafe, top);
  left = Math.max(padding, Math.min(left, bounds.width - approxWidth - padding));

  return { left: `${left}px`, top: `${top}px` };
});

watch(
  [referenceGraph, viewState],
  ([graph]) => {
    if (!graph) {
      layoutGeneration += 1;
      terminateActiveGraphWorker();
      composedGraph.value = null;
      isDeriving.value = false;
      return;
    }
    void deriveGraph(graph);
  },
  { deep: true },
);

function bufferForGraphNode(nodePath: string) {
  // Graph nodes are folder-relative paths; buffer ids are file:/untitled: identities.
  return openBuffers.value.find((buffer) => buffer.path === nodePath) ?? null;
}

function openGraphDocument(path: string, explain = false): void {
  const existing = bufferForGraphNode(path);
  if (existing) {
    selectDocument(existing.id);
    void router.push({ name: APP_ROUTE_NAMES.editor }).then(() => {
      if (explain) {
        openInspector();
      }
    });
    return;
  }

  const rootPath = workspace.value?.path;
  if (!rootPath) {
    return;
  }

  void openOrActivate({ kind: "workspace", rootPath, path })
    .then(() => {
      void router.push({ name: APP_ROUTE_NAMES.editor }).then(() => {
        if (explain) {
          openInspector();
        }
      });
    })
    .catch((error) => {
      // Same visible failure path as Search / Quick Open / Inspector - not a silent no-op.
      notifyFilesystemError(error, "workspace.openDocumentError", notify);
    });
}

function handleNodeSelect(path: string): void {
  traversalNodeId.value = path;
  openGraphDocument(path);
}

/** Double-click: open the document context - same action as Context. */
function handleNodeExplain(path: string): void {
  traversalNodeId.value = path;
  openGraphDocument(path, true);
}

function clearTraversalToFocus(): void {
  const focusPath = graphActiveTarget.value?.focusPath ?? null;
  traversalNodeId.value = focusPath;
  canvasRef.value?.highlightNode(focusPath);
  hoverDetails.value = null;
}

function setDepth(depth: number): void {
  viewState.value = { depth: clampGraphDepth(depth) };
}

function setDepthButtonRef(step: GraphDepth, element: unknown): void {
  if (element instanceof HTMLButtonElement) {
    depthButtonRefs.set(step, element);
  } else {
    depthButtonRefs.delete(step);
  }
}

function onDepthKeydown(event: KeyboardEvent, step: GraphDepth): void {
  const index = GRAPH_DEPTH_STEPS.indexOf(step);
  if (index < 0) {
    return;
  }

  const delta =
    event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0;
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? GRAPH_DEPTH_STEPS.length - 1
        : Math.min(Math.max(index + delta, 0), GRAPH_DEPTH_STEPS.length - 1);
  if (delta === 0 && event.key !== "Home" && event.key !== "End") {
    return;
  }

  const nextStep = GRAPH_DEPTH_STEPS[nextIndex];
  if (nextStep === undefined) {
    return;
  }
  event.preventDefault();
  setDepth(nextStep);
  depthButtonRefs.get(nextStep)?.focus();
}

function zoomIn(): void {
  canvasRef.value?.zoomIn();
}

function zoomOut(): void {
  canvasRef.value?.zoomOut();
}

function centerFocus(): void {
  canvasRef.value?.centerOnFocus();
}

function traversalOrder(): string[] {
  if (!composedGraph.value) {
    return [];
  }

  return [...composedGraph.value.nodes]
    .sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id))
    .map((node) => node.id);
}

function moveTraversal(delta: number): void {
  const nodes = traversalOrder();
  if (nodes.length === 0) {
    return;
  }

  const current = traversalNodeId.value ?? graphActiveTarget.value?.focusPath ?? nodes[0];
  let index = nodes.indexOf(current);
  if (index < 0) {
    index = 0;
  }

  const next = nodes[(index + delta + nodes.length) % nodes.length];
  traversalNodeId.value = next;
  canvasRef.value?.highlightNode(next);
  canvasRef.value?.centerOnNode(next);
}

function commitTraversal(): void {
  const path = traversalNodeId.value;
  if (!path) {
    return;
  }

  openGraphDocument(path, true);
}

function onGraphKeydown(event: KeyboardEvent): void {
  if (route.name !== APP_ROUTE_NAMES.graph || !composedGraph.value) {
    return;
  }

  if (isTypingTarget(event.target)) {
    return;
  }

  if (event.key === "c" || event.key === "C") {
    event.preventDefault();
    centerFocus();
    return;
  }

  if (event.key === "i" || event.key === "I") {
    event.preventDefault();
    openInspector();
    return;
  }

  if (event.key === "Escape") {
    if (traversalNodeId.value && traversalNodeId.value !== graphActiveTarget.value?.focusPath) {
      event.preventDefault();
      clearTraversalToFocus();
    }
    return;
  }

  if (event.key === "[") {
    event.preventDefault();
    narrowContext();
    return;
  }

  if (event.key === "]") {
    event.preventDefault();
    widenContext();
    return;
  }

  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    zoomIn();
    return;
  }

  if (event.key === "-" || event.key === "_") {
    event.preventDefault();
    zoomOut();
    return;
  }

  if (
    event.key === "ArrowDown" ||
    event.key === "ArrowRight" ||
    event.key === "j" ||
    event.key === "J"
  ) {
    event.preventDefault();
    moveTraversal(1);
    return;
  }

  if (
    event.key === "ArrowUp" ||
    event.key === "ArrowLeft" ||
    event.key === "k" ||
    event.key === "K"
  ) {
    event.preventDefault();
    moveTraversal(-1);
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    commitTraversal();
  }
}

watch(
  () => composedGraph.value?.focusPath,
  (focusPath) => {
    traversalNodeId.value = focusPath ?? null;
  },
);

onMounted(() => {
  window.addEventListener("keydown", onGraphKeydown);
  const graph = referenceGraph.value;
  if (graph) {
    void deriveGraph(graph);
  }
});
onBeforeUnmount(() => {
  layoutGeneration += 1;
  terminateActiveGraphWorker();
  window.removeEventListener("keydown", onGraphKeydown);
});
</script>

<template>
  <PageShell
    v-if="!composedGraph"
    :title="pageTitle"
    :question="t('graph.question')"
    :regarding="regardingLine"
    rhythm="spatial"
  >
    <EmptyState
      pace="invite"
      :title="graphActiveTarget ? t('graph.deriving') : t('graph.chooseDocument')"
      :text="graphActiveTarget ? t('graph.updating') : t('graph.chooseDocumentText')"
    />
  </PageShell>

  <PageShell
    v-else
    :title="pageTitle"
    :question="t('graph.question')"
    :regarding="regardingLine"
    fill
    rhythm="spatial"
  >
    <template #toolbar>
      <button
        type="button"
        class="graph-page__explain"
        :title="t('graph.openContextTitle')"
        aria-keyshortcuts="I"
        @click="openInspector"
      >
        {{ t("actions.context") }}
      </button>
    </template>

    <div
      class="graph-workbench"
      role="region"
      :aria-label="t('graph.canvasAria', { title: pageTitle })"
    >
      <div class="graph-workbench__stage">
        <div ref="workspaceRef" class="graph-workbench__viewport" data-graph-workspace>
          <p
            v-if="isDeriving && !composedGraph"
            class="graph-workbench__deriving"
            role="status"
            aria-live="polite"
          >
            {{ t("graph.deriving") }}
          </p>

          <p v-else-if="isDeriving" class="sr-only" role="status" aria-live="polite">
            {{ t("graph.updating") }}
          </p>

          <p v-if="traversalNodeId" class="sr-only" aria-live="polite">
            {{ noteTitle(traversalNodeId, graphActiveTarget?.notes ?? []) }}
          </p>

          <GraphCanvas
            v-if="composedGraph"
            ref="canvasRef"
            class="graph-workbench__canvas"
            :graph="composedGraph"
            @select-node="handleNodeSelect"
            @explain-node="handleNodeExplain"
            @hover-change="hoverDetails = $event"
          />

          <div
            class="graph-workbench__chrome graph-workbench__chrome--context"
            role="group"
            :aria-label="t('graph.contextAria')"
          >
            <span class="graph-workbench__chrome-label">{{ t("graph.context") }}</span>
            <button
              type="button"
              class="graph-workbench__control graph-workbench__context-nudge"
              :title="t('graph.nearerTitle')"
              :aria-label="t('graph.nearerAria')"
              aria-keyshortcuts="["
              :disabled="viewState.depth <= GRAPH_DEPTH_STEPS[0]"
              @click="narrowContext"
            >
              {{ t("actions.nearer") }}
            </button>
            <div
              class="graph-workbench__depth-group"
              role="radiogroup"
              :aria-label="t('graph.followAria')"
            >
              <button
                v-for="step in GRAPH_DEPTH_STEPS"
                :key="step"
                :ref="(element) => setDepthButtonRef(step, element)"
                type="button"
                class="graph-workbench__control graph-workbench__depth-step"
                :class="{ 'is-active': viewState.depth === step }"
                :aria-checked="viewState.depth === step"
                :tabindex="viewState.depth === step ? 0 : -1"
                role="radio"
                :title="
                  step === 1
                    ? t('graph.nearestReferences')
                    : t('graph.stepsOfContext', { count: step })
                "
                @keydown="onDepthKeydown($event, step)"
                @click="setDepth(step)"
              >
                {{ step }}
              </button>
            </div>
            <button
              type="button"
              class="graph-workbench__control graph-workbench__context-nudge"
              :title="t('graph.widerTitle')"
              :aria-label="t('graph.widerAria')"
              aria-keyshortcuts="]"
              :disabled="viewState.depth >= GRAPH_DEPTH_STEPS[GRAPH_DEPTH_STEPS.length - 1]!"
              @click="widenContext"
            >
              {{ t("actions.wider") }}
            </button>
          </div>

          <div
            class="graph-workbench__chrome graph-workbench__chrome--looking graph-workbench__chrome--quiet"
            role="toolbar"
            :aria-label="t('graph.looking')"
          >
            <button
              type="button"
              class="graph-workbench__control"
              :title="t('graph.locateTitle')"
              aria-keyshortcuts="C"
              :aria-label="t('actions.locate')"
              @click="centerFocus"
            >
              <AppIcon name="center" :size="14" />
              <span>{{ t("actions.here") }}</span>
            </button>
            <button
              type="button"
              class="graph-workbench__control graph-workbench__chrome-icon"
              :title="t('graph.closerTitle')"
              aria-keyshortcuts="+"
              :aria-label="t('actions.closer')"
              @click="zoomIn"
            >
              <AppIcon name="zoom-in" :size="14" />
            </button>
            <button
              type="button"
              class="graph-workbench__control graph-workbench__chrome-icon"
              :title="t('graph.fartherTitle')"
              aria-keyshortcuts="-"
              :aria-label="t('actions.farther')"
              @click="zoomOut"
            >
              <AppIcon name="zoom-out" :size="14" />
            </button>
          </div>

          <div
            v-if="hoverDetails && tooltipStyle"
            class="graph-workbench__tooltip"
            role="tooltip"
            :style="tooltipStyle"
          >
            <div class="graph-workbench__tooltip-title">
              {{ hoverDetails.title }}
            </div>
            <div v-if="hoverDetails.incoming.length > 0" class="graph-workbench__tooltip-section">
              <div class="graph-workbench__tooltip-heading">
                {{
                  t("graph.referencedBy", {
                    count: hoverDetails.incoming.length,
                  })
                }}
              </div>
              <div v-for="item in truncateHoverVisible(hoverDetails.incoming)" :key="`in-${item}`">
                {{ item }}
              </div>
            </div>
            <div v-if="hoverDetails.outgoing.length > 0" class="graph-workbench__tooltip-section">
              <div class="graph-workbench__tooltip-heading">
                {{
                  t("graph.references", {
                    count: hoverDetails.outgoing.length,
                  })
                }}
              </div>
              <div v-for="item in truncateHoverVisible(hoverDetails.outgoing)" :key="`out-${item}`">
                {{ item }}
              </div>
            </div>
            <p class="graph-workbench__tooltip-hint">
              {{ t("graph.tooltipHint") }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </PageShell>
</template>

<style scoped lang="scss">
@use "../../styles/variables" as *;

.graph-page__explain {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: $control-height-small;
  padding: 0 $space-related;
  border: none;
  border-radius: $radius;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: $font-label;
  font-weight: 500;
  cursor: pointer;
  transition:
    color $transition-medium $ease-out,
    background-color $transition-medium $ease-out;

  &:hover {
    color: var(--text-primary);
    background: color-mix(in srgb, var(--text-muted) 10%, transparent);
  }

  &:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
}

.graph-workbench {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent;
  color: var(--graph-workbench-ink);
}

.graph-workbench__stage {
  flex: 1;
  min-height: 0;
  padding: 0;
  background: transparent;
}

/* Canvas joins the page - no inset frame or application chrome. */
.graph-workbench__viewport {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border: none;
  border-radius: 0;
  background-color: var(--graph-canvas-background);
  background-image:
    radial-gradient(ellipse 78% 62% at 50% 40%, transparent 48%, var(--graph-canvas-vignette) 100%),
    linear-gradient(var(--graph-canvas-grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--graph-canvas-grid) 1px, transparent 1px);
  background-size:
    auto,
    40px 40px,
    40px 40px;
  touch-action: none;
  overscroll-behavior: none;
}

.graph-workbench__canvas {
  position: absolute;
  inset: 0;
  z-index: 1;
}

.graph-workbench__deriving {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-items: center;
  margin: 0;
  background: color-mix(in srgb, var(--graph-canvas-background) 92%, transparent);
  color: var(--graph-workbench-muted);
  font-size: $font-control;
  letter-spacing: -0.01em;
}

.graph-workbench__chrome {
  position: absolute;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: $space-tight;
  min-height: $control-height-small;
  padding: $space-tight;
  border-radius: $radius;
  background: var(--graph-chrome-surface);
  color: var(--graph-chrome-ink);
  border: 1px solid var(--graph-chrome-border);
  transition: opacity 200ms $ease-out;
}

.graph-workbench__control {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: $space-tight;
  min-width: $hit-min;
  min-height: $hit-min;
  padding: 0 $space-related;
  border: none;
  border-radius: calc(#{$radius} - 1px);
  background: transparent;
  color: var(--graph-chrome-ink);
  font: inherit;
  font-size: $font-label;
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color $transition-medium $ease-out,
    color $transition-medium $ease-out,
    opacity $transition-medium $ease-out;

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--graph-chrome-active) 12%, transparent);
    color: var(--graph-workbench-ink);
  }

  &:focus-visible {
    outline: 2px solid var(--graph-chrome-active);
    outline-offset: 1px;
  }

  &:disabled {
    opacity: 0.32;
    cursor: default;
  }
}

.graph-workbench__chrome--quiet {
  opacity: 0.72;

  &:hover,
  &:focus-within {
    opacity: 1;
  }
}

.graph-workbench__chrome-label {
  padding-inline: $space-2 2px;
  color: var(--graph-workbench-muted);
  font-size: $font-micro;
  font-weight: 500;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.graph-workbench__chrome--context {
  top: $space-tight;
  left: $space-tight;
  opacity: 0.9;

  &:hover,
  &:focus-within {
    opacity: 1;
  }
}

.graph-workbench__chrome--looking {
  top: $space-tight;
  right: $space-tight;
}

.graph-workbench__context-nudge {
  padding-inline: 5px;
  color: var(--graph-workbench-muted);
  font-size: $font-caption;
}

.graph-workbench__depth-group {
  display: inline-flex;
  gap: 1px;
}

.graph-workbench__depth-step {
  min-width: $hit-min;
  padding-inline: 0;
  font-variant-numeric: tabular-nums;
  transition:
    background-color $transition-medium $ease-out,
    color $transition-medium $ease-out;

  &.is-active {
    background: color-mix(in srgb, var(--graph-chrome-active) 16%, transparent);
    color: var(--graph-chrome-active);
  }
}

.graph-workbench__chrome-icon {
  opacity: 0.65;

  &:hover {
    opacity: 1;
  }
}

.graph-workbench__tooltip {
  position: absolute;
  z-index: 4;
  max-width: 260px;
  padding: $space-compact $space-related;
  border-radius: $radius;
  background: var(--graph-tooltip-background);
  box-shadow: var(--graph-tooltip-shadow);
  border: 1px solid var(--graph-tooltip-border);
  pointer-events: none;
  font-size: $font-label;
  line-height: 1.45;
  color: var(--graph-workbench-ink);
  animation: graph-tooltip-in 160ms $ease-out both;
}

.graph-workbench__tooltip-title {
  font-weight: 600;
  letter-spacing: -0.015em;
}

.graph-workbench__tooltip-section {
  margin-top: $space-tight;
}

.graph-workbench__tooltip-heading {
  margin-bottom: 2px;
  color: var(--graph-workbench-muted);
  font-size: $font-micro;
  font-weight: 500;
  letter-spacing: 0.01em;
}

.graph-workbench__tooltip-hint {
  margin: $space-tight 0 0;
  color: var(--graph-workbench-muted);
  font-size: $font-caption;
}

@keyframes graph-tooltip-in {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .graph-workbench__tooltip {
    animation: none;
  }

  .graph-workbench__chrome,
  .graph-workbench__control,
  .graph-page__explain {
    transition: none;
  }
}

@media (forced-colors: active) {
  .graph-workbench__chrome--quiet,
  .graph-workbench__chrome--context,
  .graph-workbench__chrome-icon {
    opacity: 1;
  }
}

@media (max-width: 640px) {
  .graph-workbench__chrome--context {
    top: $space-related;
    right: $space-related;
    left: $space-related;
    max-width: calc(100% - #{$space-block});
    overflow-x: auto;
  }

  .graph-workbench__chrome--looking {
    top: auto;
    right: $space-related;
    bottom: $space-related;
  }

  .graph-workbench__chrome-label {
    display: none;
  }
}
</style>

<style lang="scss">
@use "../../styles/variables" as *;

.page-shell--spatial {
  .page-shell__header {
    padding-bottom: $space-related;
    row-gap: 2px;
  }

  .page-shell__within {
    opacity: 0.72;
  }

  .page-shell__question {
    font-size: $font-caption;
    opacity: 0.85;
  }

  .page-shell__title {
    font-size: $font-title;
    letter-spacing: -0.028em;
    line-height: 1.2;
  }

  .page-shell__regarding {
    font-size: $font-caption;
    opacity: 0.78;
    max-width: 42rem;
  }

  &.page-shell--fill .page-shell__fill {
    margin-top: $space-compact;
  }
}

@media (forced-colors: active) {
  .page-shell--spatial .page-shell__within,
  .page-shell--spatial .page-shell__question,
  .page-shell--spatial .page-shell__regarding {
    opacity: 1;
  }
}
</style>

<style src="../../modules/graph/graph.css"></style>
