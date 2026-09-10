<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";

import AppIcon from "./AppIcon.vue";
import ContextMenu, { type ContextMenuAction } from "./ContextMenu.vue";
import { notify } from "../app/notify";
import { describeFilesystemError } from "../modules/workspace/filesystem/workspaceScanner";
import {
  SIDEBAR_WIDTH_LIMITS,
  closeLeftSidebar,
  openLeftSidebar,
  layout,
  setSidebarWidth,
} from "../app/layoutStore";
import {
  closeWorkspace,
  copyWorkspacePath,
  isLoading,
  openWorkspace,
  refreshWorkspace,
  revealWorkspaceInExplorer,
  workspace,
  workspaceName,
} from "../app/workspaceState";
import { APP_ROUTE_NAMES, type AppRouteName } from "../app/router";

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const props = withDefaults(defineProps<{ compact?: boolean; overlay?: boolean }>(), {
  compact: false,
  overlay: false,
});

const currentName = computed(() => (workspace.value ? workspaceName(workspace.value.path) : null));

const workspaceMenuActions = computed<readonly ContextMenuAction[]>(() => [
  { id: "reveal", label: t("actions.reveal") },
  { id: "copy", label: t("actions.copy") },
  { id: "open", label: t("actions.openEllipsis") },
  { id: "close", label: t("actions.close"), danger: true },
]);

const workspaceMenuOpen = ref(false);
const workspaceMenuX = ref(0);
const workspaceMenuY = ref(0);
let sidebarResizeCleanup: (() => void) | null = null;

type NavItem = {
  label: string;
  shortcut?: string;
  icon: "document" | "search" | "graph" | "settings";
  title: string;
  routeName: AppRouteName;
};

const navItems = computed<NavItem[]>(() => [
  {
    label: t("nav.editor"),
    shortcut: "1",
    icon: "document",
    title: t("nav.editDocuments"),
    routeName: APP_ROUTE_NAMES.editor,
  },
  {
    label: t("nav.search"),
    shortcut: "2",
    icon: "search",
    title: t("nav.findDocument"),
    routeName: APP_ROUTE_NAMES.search,
  },
  {
    label: t("nav.graph"),
    shortcut: "3",
    icon: "graph",
    title: t("nav.documentReferences"),
    routeName: APP_ROUTE_NAMES.graph,
  },
  {
    label: t("nav.settings"),
    icon: "settings",
    title: t("settings.question"),
    routeName: APP_ROUTE_NAMES.settings,
  },
]);

function isNavItemActive(item: NavItem): boolean {
  return route.name === item.routeName;
}

function openNavItem(item: NavItem): void {
  void router.push({ name: item.routeName });
}

function startSidebarResize(event: PointerEvent): void {
  event.preventDefault();
  sidebarResizeCleanup?.();
  const startX = event.clientX;
  const startWidth = layout.value.sidebarWidth;
  let cleanup = (): void => {};

  const onMove = (moveEvent: PointerEvent): void => {
    setSidebarWidth(startWidth + (moveEvent.clientX - startX));
  };

  const onUp = (): void => {
    cleanup();
    if (sidebarResizeCleanup === cleanup) {
      sidebarResizeCleanup = null;
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
  sidebarResizeCleanup = cleanup;
}

onBeforeUnmount(() => {
  sidebarResizeCleanup?.();
  sidebarResizeCleanup = null;
});

function onWorkspaceNameContextMenu(event: MouseEvent): void {
  if (!workspace.value) {
    return;
  }
  event.preventDefault();
  (event.currentTarget as HTMLElement).focus();
  workspaceMenuX.value = event.clientX;
  workspaceMenuY.value = event.clientY;
  workspaceMenuOpen.value = true;
}

function onWorkspaceNameKeydown(event: KeyboardEvent): void {
  const opensContextMenu =
    ["Enter", " ", "ContextMenu"].includes(event.key) || (event.shiftKey && event.key === "F10");
  if (!workspace.value || !opensContextMenu) {
    return;
  }
  event.preventDefault();
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  workspaceMenuX.value = bounds.left;
  workspaceMenuY.value = bounds.bottom;
  workspaceMenuOpen.value = true;
}

function closeWorkspaceMenu(): void {
  workspaceMenuOpen.value = false;
}

async function runWorkspaceMenu(id: string): Promise<void> {
  closeWorkspaceMenu();
  try {
    if (id === "reveal") {
      await revealWorkspaceInExplorer();
    } else if (id === "copy") {
      await copyWorkspacePath();
    } else if (id === "open") {
      await openWorkspace();
    } else if (id === "close") {
      await closeWorkspace();
    }
  } catch (error) {
    notify(describeFilesystemError(error, "workspace.openWorkspaceError"));
  }
}
</script>

<template>
  <aside
    class="app-sidebar"
    :class="{
      'app-sidebar--compact': props.compact,
      'app-sidebar--overlay': props.overlay,
    }"
    :role="props.overlay ? 'dialog' : undefined"
    :aria-modal="props.overlay ? 'true' : undefined"
    :aria-label="t('app.sidebar')"
  >
    <template v-if="props.compact">
      <header class="app-sidebar__compact-header">
        <button
          class="app-sidebar__compact-button"
          type="button"
          :title="t('actions.showLeftSidebar')"
          :aria-label="t('actions.showLeftSidebar')"
          @click="openLeftSidebar"
        >
          <AppIcon name="chevron-right" :size="15" />
        </button>
      </header>
      <button
        class="app-sidebar__compact-button app-sidebar__compact-folder"
        type="button"
        :title="t('actions.openWorkspace')"
        :aria-label="t('actions.openWorkspace')"
        @click="openWorkspace"
      >
        <AppIcon name="folder" :size="16" />
      </button>
      <nav class="app-sidebar__compact-nav" :aria-label="t('app.navigation')">
        <button
          v-for="item in navItems"
          :key="item.routeName"
          class="app-sidebar__compact-button"
          type="button"
          :title="item.title"
          :aria-label="item.label"
          :aria-current="isNavItemActive(item) ? 'page' : undefined"
          @click="openNavItem(item)"
        >
          <AppIcon :name="item.icon" :size="16" />
        </button>
      </nav>
    </template>
    <template v-else>
      <header class="app-sidebar__brand">
        <div class="app-sidebar__brand-row">
          <p class="app-sidebar__product">{{ t("app.product") }}</p>
          <button
            class="app-sidebar__collapse"
            type="button"
            :title="t('actions.hideLeftSidebar')"
            :aria-label="t('actions.hideLeftSidebar')"
            @click="closeLeftSidebar"
          >
            <AppIcon name="close" :size="14" />
          </button>
        </div>
      </header>

      <div class="app-sidebar__workspace" :aria-label="t('app.currentWorkspace')">
        <div class="app-sidebar__workspace-name-wrap">
          <span class="app-sidebar__workspace-label">
            {{ t("app.currentWorkspace") }}
          </span>
          <span
            class="app-sidebar__workspace-name"
            :title="
              currentName ? `${currentName} - ${t('workspace.rightClickActions')}` : undefined
            "
            :class="{ 'app-sidebar__workspace-name--active': workspace }"
            :role="workspace ? 'button' : undefined"
            :tabindex="workspace ? 0 : -1"
            :aria-haspopup="workspace ? 'menu' : undefined"
            :aria-expanded="workspace ? workspaceMenuOpen : undefined"
            @contextmenu="onWorkspaceNameContextMenu"
            @keydown="onWorkspaceNameKeydown"
          >
            {{ currentName ?? t("workspace.noWorkspace") }}
          </span>
        </div>
        <ContextMenu
          :open="workspaceMenuOpen"
          :x="workspaceMenuX"
          :y="workspaceMenuY"
          :actions="workspaceMenuActions"
          :label="t('workspace.actions')"
          @select="runWorkspaceMenu"
          @close="closeWorkspaceMenu"
        />
        <button
          v-if="!workspace"
          class="app-sidebar__workspace-open"
          type="button"
          :title="t('actions.openWorkspace')"
          @click="openWorkspace"
        >
          <AppIcon name="folder" :size="14" />
          <span>{{ t("actions.openWorkspace") }}</span>
        </button>
        <div v-else class="app-sidebar__workspace-actions">
          <button
            class="app-sidebar__workspace-action"
            type="button"
            :title="t('actions.refresh')"
            :aria-label="t('actions.refresh')"
            :disabled="isLoading"
            @click="refreshWorkspace()"
          >
            <AppIcon name="reset" :size="13" />
            {{ t("actions.refresh") }}
          </button>
          <button
            class="app-sidebar__workspace-action"
            type="button"
            :title="t('actions.close')"
            :aria-label="t('actions.close')"
            :disabled="isLoading"
            @click="closeWorkspace"
          >
            <AppIcon name="close" :size="13" />
            {{ t("actions.close") }}
          </button>
        </div>
      </div>

      <nav class="app-sidebar__nav" :aria-label="t('app.navigation')">
        <button
          v-for="item in navItems"
          :key="item.routeName"
          class="app-sidebar__nav-item"
          type="button"
          :title="item.title"
          :class="{ 'app-sidebar__nav-item--active': isNavItemActive(item) }"
          :aria-current="isNavItemActive(item) ? 'page' : undefined"
          :aria-keyshortcuts="item.shortcut"
          @click="openNavItem(item)"
        >
          <span class="app-sidebar__nav-label">
            <AppIcon :name="item.icon" :size="15" />
            {{ item.label }}
          </span>
        </button>
      </nav>

      <div
        class="app-sidebar__resize"
        role="slider"
        aria-orientation="horizontal"
        :aria-label="t('app.sidebarWidth')"
        :aria-valuenow="layout.sidebarWidth"
        :aria-valuemin="SIDEBAR_WIDTH_LIMITS.min"
        :aria-valuemax="SIDEBAR_WIDTH_LIMITS.max"
        tabindex="0"
        @pointerdown="startSidebarResize"
        @keydown.left.prevent="setSidebarWidth(layout.sidebarWidth - 8)"
        @keydown.right.prevent="setSidebarWidth(layout.sidebarWidth + 8)"
      />
    </template>
  </aside>
</template>

<style scoped lang="scss">
@use "../styles/colors" as *;
@use "../styles/controls" as *;
@use "../styles/variables" as *;

.app-sidebar {
  position: relative;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: $sidebar-width;
  height: 100%;
  background: $surface;
  border-right: 1px solid $border-subtle;
}

.app-sidebar--compact {
  align-items: center;
  width: 44px;
  padding-block: $space-related;
}

.app-sidebar__compact-header,
.app-sidebar__compact-nav {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: $space-tight;
}

.app-sidebar__compact-nav {
  flex: 1;
  padding-top: $space-related;
  padding-bottom: $space-related;

  .app-sidebar__compact-button:last-child {
    margin-top: auto;
  }
}

.app-sidebar__compact-folder {
  margin-top: $space-related;
}

.app-sidebar__compact-button {
  @include icon-action-button;
  color: $text-muted;

  &[aria-current="page"] {
    background: $selection;
    box-shadow: inset 2px 0 $accent;
    color: $selection-foreground;
  }
}

.app-sidebar__resize {
  position: absolute;
  top: 0;
  right: -6px;
  z-index: 2;
  width: $resize-hit-width;
  height: 100%;
  @include resize-handle-interaction;
}

.app-sidebar__brand {
  padding: $space-group $panel-padding $space-compact;
}

.app-sidebar__brand-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $space-related;
}

.app-sidebar__product {
  margin: 0;
  max-width: 100%;
  color: $text-primary;
  font-size: $font-body;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.35;
}

.app-sidebar__collapse {
  @include icon-action-button;
  color: $text-muted;
}

.app-sidebar__workspace {
  display: flex;
  flex-direction: column;
  gap: $space-tight;
  padding: $space-related $panel-padding $space-group;
  border-bottom: 1px solid $border-subtle;
}

.app-sidebar__workspace-name-wrap {
  position: relative;
}

.app-sidebar__workspace-name {
  display: block;
  overflow: hidden;
  color: $text-primary;
  font-size: $font-body;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;

  &--active {
    cursor: context-menu;
  }

  &:focus-visible {
    outline: 2px solid $focus-ring;
    outline-offset: 2px;
  }
}

.app-sidebar__workspace-name:not(.app-sidebar__workspace-name--active) {
  color: $text-muted;
  font-weight: 500;
}

.app-sidebar__workspace-label {
  display: block;
  margin-bottom: 2px;
  color: $text-muted;
  font-size: $font-caption;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.app-sidebar__workspace-open {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: $space-related;
  min-height: $control-height-small;
  padding: 0 $space-compact;
  border: 1px solid $border-subtle;
  border-radius: $radius;
  background: transparent;
  color: $text-secondary;
  font: inherit;
  font-size: $font-label;
  margin-top: $space-tight;
  cursor: pointer;

  &:hover {
    border-color: $border;
    background: $surface-hover;
    color: $text-primary;
  }

  &:focus-visible {
    outline: 2px solid $focus-ring;
    outline-offset: 2px;
  }
}

.app-sidebar__workspace-actions {
  display: flex;
  flex-wrap: wrap;
  gap: $space-related;
}

.app-sidebar__workspace-action {
  flex: 1;
  min-width: 0;
  min-height: $control-height-small;
  padding: $space-tight $space-compact;
  border: 1px solid $border-subtle;
  border-radius: $radius;
  background: transparent;
  color: $text-secondary;
  font: inherit;
  font-size: $font-label;
  font-weight: 500;
  text-align: center;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: $space-tight;

  &:hover:not(:disabled) {
    background: $surface-hover;
    border-color: $border;
    color: $text-primary;
  }

  &:focus-visible {
    outline: 2px solid $focus-ring;
    outline-offset: -2px;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
}

.app-sidebar__nav {
  display: flex;
  flex: 1;
  flex-shrink: 0;
  flex-direction: column;
  gap: $space-tight;
  min-height: 0;
  margin: 0 $space-compact;
  padding-top: $space-group;
  padding-bottom: $space-group;

  .app-sidebar__nav-item:last-child {
    margin-top: auto;
  }
}

.app-sidebar__nav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $space-related;
  width: 100%;
  min-height: $control-height;
  padding: $space-tight $space-3;
  border: none;
  border-radius: $radius;
  background: transparent;
  color: $text-secondary;
  font: inherit;
  font-size: $font-control;
  font-weight: 500;
  letter-spacing: -0.01em;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: $surface-hover;
    color: $text-primary;
  }

  &--active {
    background: $selection;
    box-shadow: inset 2px 0 $accent;
    color: $selection-foreground;
  }
}

.app-sidebar__nav-label {
  display: inline-flex;
  align-items: center;
  gap: $space-related;
  min-width: 0;
}

@media (max-width: 900px) {
  .app-sidebar {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 6;
    box-shadow: $shadow-soft;
  }

  .app-sidebar--compact {
    position: relative;
    top: auto;
    bottom: auto;
    left: auto;
    z-index: auto;
    box-shadow: none;
  }
}
</style>
