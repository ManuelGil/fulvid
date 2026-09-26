/**
 * Persisted layout widths and Shell regions.
 *
 * Sidebar visibility lives in `layout`. Preview **pane width** (`previewRatio`)
 * is layout chrome; preview **on/off** lives in settings. Search query options
 * are URL state, not this store.
 */
import { computed, ref, watch } from "vue";

const STORAGE_KEY = "fulvid.layout.v1";

/**
 * One resizable dimension: the bounds it is clamped to and the width it starts
 * at. Declared once so a sanitize fallback, a setter, and the slider a surface
 * exposes cannot drift apart.
 */
type LayoutRange = {
  readonly min: number;
  readonly max: number;
  readonly default: number;
};

export const SIDEBAR_WIDTH_LIMITS: LayoutRange = { min: 200, max: 360, default: 252 };
export const INSPECTOR_WIDTH_LIMITS: LayoutRange = { min: 260, max: 440, default: 320 };
export const CONTEXTUAL_WIDTH_LIMITS: LayoutRange = { min: 260, max: 440, default: 320 };
/** Fraction of the editor pane given to Preview, not a pixel width. */
export const PREVIEW_RATIO_LIMITS: LayoutRange = { min: 0.25, max: 0.65, default: 0.42 };

/** Arrow-key step for every width resize handle. */
export const LAYOUT_RESIZE_STEP_PX = 8;

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

/** A persisted width or ratio held inside its range, otherwise the default. */
function clampedNumber(value: unknown, range: LayoutRange): number {
  return clamp(typeof value === "number" ? value : range.default, range.min, range.max);
}

function sanitize(value: unknown): LayoutIntent {
  const source = value && typeof value === "object" ? (value as Partial<LayoutIntent>) : {};

  return {
    sidebarWidth: clampedNumber(source.sidebarWidth, SIDEBAR_WIDTH_LIMITS),
    inspectorWidth: clampedNumber(source.inspectorWidth, INSPECTOR_WIDTH_LIMITS),
    contextualWidth: clampedNumber(source.contextualWidth, CONTEXTUAL_WIDTH_LIMITS),
    previewRatio: clampedNumber(source.previewRatio, PREVIEW_RATIO_LIMITS),
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
    sidebarWidth: clamp(width, SIDEBAR_WIDTH_LIMITS.min, SIDEBAR_WIDTH_LIMITS.max),
  };
}

export function setInspectorWidth(width: number): void {
  layout.value = {
    ...layout.value,
    inspectorWidth: clamp(width, INSPECTOR_WIDTH_LIMITS.min, INSPECTOR_WIDTH_LIMITS.max),
  };
}

export function setContextualWidth(width: number): void {
  layout.value = {
    ...layout.value,
    contextualWidth: clamp(width, CONTEXTUAL_WIDTH_LIMITS.min, CONTEXTUAL_WIDTH_LIMITS.max),
  };
}

export function setPreviewRatio(ratio: number): void {
  layout.value = {
    ...layout.value,
    previewRatio: clamp(ratio, PREVIEW_RATIO_LIMITS.min, PREVIEW_RATIO_LIMITS.max),
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
