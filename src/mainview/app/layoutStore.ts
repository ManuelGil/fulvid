/**
 * Persisted layout widths and Shell regions.
 *
 * Sidebar visibility lives in `layout`. Preview **pane width** (`previewRatio`)
 * is layout chrome; preview **on/off** lives in settings. Search query options
 * are URL state, not this store.
 */
import { computed, ref, watch } from "vue";

const STORAGE_KEY = "fulvid.layout.v1";

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 360;
const SIDEBAR_DEFAULT = 252;
const INSPECTOR_MIN = 260;
const INSPECTOR_MAX = 440;
const INSPECTOR_DEFAULT = 320;
const CONTEXTUAL_MIN = 260;
const CONTEXTUAL_MAX = 440;
const CONTEXTUAL_DEFAULT = 320;
const PREVIEW_MIN = 0.25;
const PREVIEW_MAX = 0.65;
const PREVIEW_DEFAULT = 0.42;

/** Shell collapses sidebars/overlays at this width. Keep CSS `@media` in sync. */
export const NARROW_VIEWPORT_MAX_PX = 900;
export const NARROW_VIEWPORT_MEDIA_QUERY = `(max-width: ${NARROW_VIEWPORT_MAX_PX}px)`;

export interface LayoutIntent {
  sidebarWidth: number;
  inspectorWidth: number;
  contextualWidth: number;
  previewRatio: number;
  leftSidebarOpen: boolean;
  rightSidebar: RightSidebar;
}

export type RightSidebar = "explorer" | "search" | "context" | "outline" | null;

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

function readNumberField(
  source: Partial<LayoutIntent>,
  key: keyof Pick<LayoutIntent, "sidebarWidth" | "inspectorWidth" | "contextualWidth">,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = source[key];
  return clamp(typeof raw === "number" ? raw : fallback, min, max);
}

function sanitize(value: unknown): LayoutIntent {
  const source = value && typeof value === "object" ? (value as Partial<LayoutIntent>) : {};

  return {
    sidebarWidth: readNumberField(
      source,
      "sidebarWidth",
      SIDEBAR_DEFAULT,
      SIDEBAR_MIN,
      SIDEBAR_MAX,
    ),
    inspectorWidth: readNumberField(
      source,
      "inspectorWidth",
      INSPECTOR_DEFAULT,
      INSPECTOR_MIN,
      INSPECTOR_MAX,
    ),
    contextualWidth: readNumberField(
      source,
      "contextualWidth",
      CONTEXTUAL_DEFAULT,
      CONTEXTUAL_MIN,
      CONTEXTUAL_MAX,
    ),
    previewRatio:
      typeof source.previewRatio === "number"
        ? clamp(source.previewRatio, PREVIEW_MIN, PREVIEW_MAX)
        : PREVIEW_DEFAULT,
    leftSidebarOpen: typeof source.leftSidebarOpen === "boolean" ? source.leftSidebarOpen : true,
    rightSidebar:
      source.rightSidebar === "explorer" ||
      source.rightSidebar === "search" ||
      source.rightSidebar === "context" ||
      source.rightSidebar === "outline"
        ? source.rightSidebar
        : null,
  };
}

function load(): LayoutIntent {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return sanitize(null);
    }
    return sanitize(JSON.parse(raw));
  } catch {
    return sanitize(null);
  }
}

export const layout = ref<LayoutIntent>(load());
export const leftSidebarOpen = computed({
  get: () => layout.value.leftSidebarOpen,
  set: (open: boolean) => {
    layout.value = { ...layout.value, leftSidebarOpen: open };
  },
});
export const rightSidebar = computed<RightSidebar>({
  get: () => layout.value.rightSidebar,
  set: (panel) => {
    layout.value = { ...layout.value, rightSidebar: panel };
  },
});

export const SIDEBAR_WIDTH_LIMITS = {
  min: SIDEBAR_MIN,
  max: SIDEBAR_MAX,
} as const;

export const INSPECTOR_WIDTH_LIMITS = {
  min: INSPECTOR_MIN,
  max: INSPECTOR_MAX,
} as const;

export const CONTEXTUAL_WIDTH_LIMITS = {
  min: CONTEXTUAL_MIN,
  max: CONTEXTUAL_MAX,
} as const;

export const PREVIEW_RATIO_LIMITS = {
  min: PREVIEW_MIN,
  max: PREVIEW_MAX,
} as const;

function applyLayout(intent: LayoutIntent): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  root.style.setProperty("--sidebar-width", `${intent.sidebarWidth}px`);
  root.style.setProperty("--inspector-width", `${intent.inspectorWidth}px`);
  root.style.setProperty("--contextual-width", `${intent.contextualWidth}px`);
}

export function setSidebarWidth(width: number): void {
  layout.value = {
    ...layout.value,
    sidebarWidth: clamp(width, SIDEBAR_MIN, SIDEBAR_MAX),
  };
}

export function setInspectorWidth(width: number): void {
  layout.value = {
    ...layout.value,
    inspectorWidth: clamp(width, INSPECTOR_MIN, INSPECTOR_MAX),
  };
}

export function setContextualWidth(width: number): void {
  layout.value = {
    ...layout.value,
    contextualWidth: clamp(width, CONTEXTUAL_MIN, CONTEXTUAL_MAX),
  };
}

export function setPreviewRatio(ratio: number): void {
  layout.value = {
    ...layout.value,
    previewRatio: clamp(ratio, PREVIEW_MIN, PREVIEW_MAX),
  };
}

export function openLeftSidebar(): void {
  leftSidebarOpen.value = true;
}

export function closeLeftSidebar(): void {
  leftSidebarOpen.value = false;
}

export function toggleLeftSidebar(): void {
  leftSidebarOpen.value = !leftSidebarOpen.value;
}

export function openRightSidebar(panel: Exclude<RightSidebar, null>): void {
  rightSidebar.value = panel;
}

export function closeRightSidebar(): void {
  rightSidebar.value = null;
}

export function toggleRightSidebar(panel: Exclude<RightSidebar, null>): void {
  if (rightSidebar.value === panel) {
    closeRightSidebar();
    return;
  }
  openRightSidebar(panel);
}

watch(
  layout,
  (value) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    applyLayout(value);
  },
  { deep: true },
);

applyLayout(layout.value);
