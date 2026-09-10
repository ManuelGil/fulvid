<script setup lang="ts">
/**
 * GraphCanvas owns GraphRenderer / Sigma for this page.
 *
 * Init when the container has size, sync on data changes, resize with the
 * container, and dispose on unmount. Update data through syncGraph rather
 * than remounting Sigma.
 */
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { createGraphRenderer, getNodeConnectionDetails, type GraphRenderer } from "./graphRenderer";
import { bindGraphSpaceIsolation } from "./graphSpace";
import type { ComposedGraph, HoverDetails, RendererInteraction } from "../core/graphTypes";

const props = defineProps<{
  graph: ComposedGraph;
}>();
const { t } = useI18n();

const emit = defineEmits<{
  selectNode: [path: string];
  explainNode: [path: string];
  hoverChange: [details: HoverDetails | null];
}>();

const containerRef = ref<HTMLDivElement | null>(null);
const interaction = ref<RendererInteraction>({
  hoveredNodeId: null,
  selectedNodeId: null,
});

let renderer: GraphRenderer | null = null;
let resizeObserver: ResizeObserver | null = null;
let unbindSpaceIsolation: (() => void) | null = null;

function graphSignature(graph: ComposedGraph): string {
  const nodeIds = graph.nodes
    .map((node) => `${node.id}:${node.x},${node.y},${node.depth}`)
    .join("\0");
  const edgeIds = graph.edges.map((edge) => `${edge.source}->${edge.target}`).join("\0");

  return `${graph.focusPath}|${nodeIds}|${edgeIds}`;
}

function bindEvents(): void {
  if (!renderer || !containerRef.value) {
    return;
  }

  // Re-bind event closures against current props each sync.
  renderer.mount(
    containerRef.value,
    interaction.value,
    {
      onHover: (details) => emit("hoverChange", details),
      onNodeClick: (nodeId) => emit("selectNode", nodeId),
      onNodeDoubleClick: (nodeId) => emit("explainNode", nodeId),
    },
    (nodeId) => getNodeConnectionDetails(nodeId, props.graph.nodes, props.graph.edges),
  );
}

function ensureRenderer(): void {
  if (!containerRef.value) {
    return;
  }

  const { clientWidth, clientHeight } = containerRef.value;
  if (clientWidth === 0 || clientHeight === 0) {
    return;
  }

  if (!renderer) {
    renderer = createGraphRenderer();
  }

  bindEvents();
  renderer.syncGraph(props.graph);
}

function zoomIn(): void {
  renderer?.zoomIn();
}

function zoomOut(): void {
  renderer?.zoomOut();
}

function centerOnFocus(): void {
  renderer?.centerOnFocus();
}

function highlightNode(nodeId: string | null): void {
  renderer?.setHighlightedNode(nodeId);
  if (!nodeId) {
    emit("hoverChange", null);
    return;
  }

  const details = getNodeConnectionDetails(nodeId, props.graph.nodes, props.graph.edges);
  const width = containerRef.value?.clientWidth ?? 320;
  emit("hoverChange", {
    ...details,
    x: Math.max(16, width - 296),
    y: 52,
  });
}

function centerOnNode(nodeId: string): void {
  renderer?.centerOnNode(nodeId);
}

function focus(): void {
  containerRef.value?.focus();
}

defineExpose({
  focus,
  zoomIn,
  zoomOut,
  centerOnFocus,
  highlightNode,
  centerOnNode,
});

watch(
  () => graphSignature(props.graph),
  () => {
    ensureRenderer();
  },
);

onMounted(() => {
  if (!containerRef.value) {
    return;
  }

  unbindSpaceIsolation = bindGraphSpaceIsolation(containerRef.value);
  ensureRenderer();

  resizeObserver = new ResizeObserver(() => {
    if (!containerRef.value) {
      return;
    }

    const { clientWidth, clientHeight } = containerRef.value;
    if (clientWidth === 0 || clientHeight === 0) {
      return;
    }

    if (!renderer) {
      ensureRenderer();
      return;
    }

    renderer.resize();
  });
  resizeObserver.observe(containerRef.value);
});

onBeforeUnmount(() => {
  unbindSpaceIsolation?.();
  unbindSpaceIsolation = null;
  resizeObserver?.disconnect();
  resizeObserver = null;
  renderer?.dispose();
  renderer = null;
});
</script>

<template>
  <div
    ref="containerRef"
    class="graph-canvas"
    data-graph-space
    role="img"
    tabindex="0"
    :aria-label="t('graph.canvasInstructions')"
  />
</template>

<style scoped lang="scss">
.graph-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  outline: none;
  cursor: grab;
  background: transparent;

  &:active {
    cursor: grabbing;
  }

  &:focus-visible {
    outline: 2px solid var(--graph-chrome-active, var(--focus-ring));
    outline-offset: -2px;
    box-shadow: inset 0 0 0 1px
      color-mix(in srgb, var(--graph-chrome-active, var(--focus-ring)) 35%, transparent);
  }
}
</style>
