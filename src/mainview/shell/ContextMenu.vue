<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { restoreUsableFocus } from "../app/usableFocusTarget";
import { placeContextMenu, type MenuAnchor, type MenuPlacement } from "./contextMenuPosition";

export interface ContextMenuAction {
  id: string;
  label?: string;
  shortcut?: string;
  ariaShortcut?: string;
  danger?: boolean;
  separator?: boolean;
  disabled?: boolean;
  children?: readonly ContextMenuAction[];
}

const props = defineProps<{
  open: boolean;
  x: number;
  y: number;
  actions: readonly ContextMenuAction[];
  label: string;
  horizontalNavigation?: boolean;
  nested?: boolean;
  autoFocus?: boolean;
  anchor?: MenuAnchor;
  placement?: MenuPlacement;
}>();

const emit = defineEmits<{
  select: [id: string];
  close: [];
  navigate: [direction: -1 | 1];
}>();

const { t } = useI18n();
const root = ref<HTMLElement | null>(null);
const menuPosition = ref({ left: 0, top: 0 });
const openSubmenuId = ref<string | null>(null);
const submenuAnchor = ref<MenuAnchor | null>(null);
const submenuAutoFocus = ref(false);
const itemRefs = new Map<string, HTMLButtonElement>();
let previousFocus: HTMLElement | null = null;
let documentListenersActive = false;
let restoreFocusOnClose = true;

function setItemRef(id: string, element: unknown): void {
  if (element instanceof HTMLButtonElement) {
    itemRefs.set(id, element);
  } else {
    itemRefs.delete(id);
  }
}

function selectableActions(): ContextMenuAction[] {
  return props.actions.filter((action) => !action.separator && !action.disabled);
}

function shouldAutoFocus(): boolean {
  return props.autoFocus ?? !props.nested;
}

function isFocusInThisMenu(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLElement && Boolean(root.value?.contains(active));
}

function isEventInsideAnyMenu(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(".context-menu"));
}

function focusFirst(): void {
  if (!shouldAutoFocus()) {
    return;
  }
  void nextTick(() => {
    const first = selectableActions()[0];
    itemRefs.get(first?.id ?? "")?.focus();
  });
}

function submenuTriggerBounds(id: string): MenuAnchor | null {
  const button = itemRefs.get(id);
  if (!button) {
    return null;
  }
  const bounds = button.getBoundingClientRect();
  return {
    left: bounds.left,
    top: bounds.top,
    right: bounds.right,
    bottom: bounds.bottom,
  };
}

function openSubmenu(id: string, options?: { focus?: boolean }): void {
  submenuAnchor.value = submenuTriggerBounds(id);
  openSubmenuId.value = id;
  submenuAutoFocus.value = options?.focus ?? false;
}

function closeSubmenu(options?: { restoreFocus?: boolean }): void {
  const triggerId = openSubmenuId.value;
  openSubmenuId.value = null;
  submenuAnchor.value = null;
  submenuAutoFocus.value = false;
  if (options?.restoreFocus && triggerId) {
    itemRefs.get(triggerId)?.focus();
  }
}

function selectAction(action: ContextMenuAction): void {
  if (action.disabled) {
    return;
  }
  if (action.children?.length) {
    openSubmenu(action.id, { focus: true });
    return;
  }
  emit("select", action.id);
}

async function updateMenuPosition(): Promise<void> {
  await nextTick();
  const element = root.value;
  if (!element) {
    return;
  }
  const size = { width: element.offsetWidth, height: element.offsetHeight };
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const placement = props.placement ?? (props.nested ? "end" : "point");
  const anchor = props.anchor ?? {
    left: props.x,
    top: props.y,
    right: props.x,
    bottom: props.y,
  };
  menuPosition.value = placeContextMenu(anchor, size, viewport, placement);
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.open) {
    return;
  }
  if (event.key === "Tab" && !props.nested) {
    // Dismiss and return focus to the opener (More / menu trigger). Do not
    // leave focus on a detached menuitem or document body.
    event.preventDefault();
    emit("close");
    return;
  }
  if (event.key === "Escape") {
    if (openSubmenuId.value) {
      event.preventDefault();
      closeSubmenu({ restoreFocus: true });
      return;
    }
    if (!isFocusInThisMenu() && props.nested) {
      return;
    }
    event.preventDefault();
    emit("close");
    return;
  }
  if (!isFocusInThisMenu()) {
    return;
  }
  const current = props.actions.find(
    (action) => itemRefs.get(action.id) === document.activeElement,
  );
  if (event.key === "ArrowRight" && current?.children?.length && !current.disabled) {
    event.preventDefault();
    openSubmenu(current.id, { focus: true });
    return;
  }
  if (event.key === "ArrowLeft") {
    if (openSubmenuId.value) {
      event.preventDefault();
      closeSubmenu({ restoreFocus: true });
      return;
    }
    if (props.nested) {
      event.preventDefault();
      emit("close");
      return;
    }
  }
  if (props.horizontalNavigation && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
    event.preventDefault();
    restoreFocusOnClose = false;
    emit("navigate", event.key === "ArrowRight" ? 1 : -1);
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    return;
  }
  event.preventDefault();
  const selectable = selectableActions();
  const currentIndex = selectable.findIndex(
    (action) => itemRefs.get(action.id) === document.activeElement,
  );
  const lastIndex = Math.max(0, selectable.length - 1);
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? lastIndex
        : event.key === "ArrowDown"
          ? Math.min(currentIndex + 1, lastIndex)
          : Math.max(currentIndex <= 0 ? 0 : currentIndex - 1, 0);
  itemRefs.get(selectable[nextIndex]?.id ?? "")?.focus();
}

function onPointerDown(event: PointerEvent): void {
  if (!props.open || isEventInsideAnyMenu(event.target)) {
    return;
  }
  if (event.target instanceof Element && event.target.closest('[role="menubar"]')) {
    return;
  }
  restoreFocusOnClose = false;
  emit("close");
}

function onFocusIn(event: FocusEvent): void {
  if (!props.open || isEventInsideAnyMenu(event.target)) {
    return;
  }
  if (event.target instanceof Element && event.target.closest('[role="menubar"]')) {
    return;
  }
  restoreFocusOnClose = false;
  emit("close");
}

function addDocumentListeners(): void {
  if (documentListenersActive) {
    return;
  }
  document.addEventListener("keydown", onKeydown);
  if (!props.nested) {
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
  }
  documentListenersActive = true;
}

function removeDocumentListeners(): void {
  if (!documentListenersActive) {
    return;
  }
  document.removeEventListener("keydown", onKeydown);
  document.removeEventListener("pointerdown", onPointerDown);
  document.removeEventListener("focusin", onFocusIn);
  documentListenersActive = false;
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      openSubmenuId.value = null;
      submenuAnchor.value = null;
      submenuAutoFocus.value = false;
    }
    if (open) {
      restoreFocusOnClose = true;
      addDocumentListeners();
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      focusFirst();
      void updateMenuPosition();
    } else if (restoreFocusOnClose) {
      removeDocumentListeners();
      restoreUsableFocus(previousFocus);
      previousFocus = null;
    } else {
      removeDocumentListeners();
      previousFocus = null;
    }
  },
);

watch(
  () => [props.open, props.x, props.y, props.placement, props.anchor] as const,
  ([open]) => {
    if (open) {
      void updateMenuPosition();
    }
  },
);

watch(
  () => props.autoFocus,
  (autoFocus) => {
    if (props.open && autoFocus) {
      focusFirst();
    }
  },
);

watch(
  () => props.actions,
  (actions, previousActions) => {
    if (props.open && actions !== previousActions) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && !root.value?.contains(active)) {
        previousFocus = active;
      }
      focusFirst();
    }
  },
);

onMounted(() => {
  if (props.open) {
    restoreFocusOnClose = true;
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    addDocumentListeners();
    focusFirst();
    void updateMenuPosition();
  }
});

onBeforeUnmount(() => {
  removeDocumentListeners();
});
</script>

<template>
  <Teleport to="body">
    <ul
      v-if="open"
      ref="root"
      class="context-menu"
      role="menu"
      :aria-label="label"
      :style="{
        left: `${menuPosition.left}px`,
        top: `${menuPosition.top}px`,
      }"
    >
      <li
        v-for="action in actions"
        :key="action.id"
        class="context-menu__item"
        role="none"
        @mouseenter="
          action.children?.length && !action.disabled ? openSubmenu(action.id) : closeSubmenu()
        "
      >
        <span v-if="action.separator" class="context-menu__separator" role="separator" />
        <button
          v-else
          :ref="(element) => setItemRef(action.id, element)"
          type="button"
          role="menuitem"
          :class="{ 'is-danger': action.danger }"
          :disabled="action.disabled"
          :aria-disabled="action.disabled ? 'true' : undefined"
          :aria-haspopup="action.children?.length ? 'menu' : undefined"
          :aria-expanded="action.children?.length ? openSubmenuId === action.id : undefined"
          :aria-keyshortcuts="action.ariaShortcut"
          @click="selectAction(action)"
        >
          <span>{{ action.label }}</span>
          <span v-if="action.children?.length" class="context-menu__chevron" aria-hidden="true"
            >▸</span
          >
          <kbd v-else-if="action.shortcut">{{ action.shortcut }}</kbd>
        </button>
        <ContextMenu
          v-if="action.children?.length && openSubmenuId === action.id && submenuAnchor"
          nested
          open
          :x="0"
          :y="0"
          :anchor="submenuAnchor"
          placement="end"
          :auto-focus="submenuAutoFocus"
          :actions="action.children"
          :label="action.label ?? t('menu.application')"
          @select="emit('select', $event)"
          @close="closeSubmenu({ restoreFocus: true })"
        />
      </li>
      <li v-if="actions.length === 0" role="none">
        <span class="context-menu__empty">{{ t("actions.noActions") }}</span>
      </li>
    </ul>
  </Teleport>
</template>

<style scoped lang="scss">
@use "../styles/colors" as *;
@use "../styles/variables" as *;

.context-menu {
  position: fixed;
  z-index: 40;
  min-width: 11rem;
  max-width: min(24rem, calc(100vw - 16px));
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  margin: 0;
  padding: $space-tight;
  list-style: none;
  border: 1px solid $border;
  border-radius: $radius;
  background: $surface-elevated;
  box-shadow: $shadow-soft;

  &__item {
    position: relative;
  }

  &__chevron {
    flex-shrink: 0;
    margin-inline-start: auto;
    color: $text-muted;
    font-size: $font-caption;
  }

  &__separator {
    display: block;
    height: 1px;
    margin: $space-tight 0;
    background: $border-subtle;
  }

  button {
    display: flex;
    align-items: center;
    gap: $space-group;
    width: 100%;
    min-height: $menu-row-height;
    padding: $space-2 $space-3;
    border: 0;
    border-radius: $radius;
    background: transparent;
    color: $text-primary;
    font: inherit;
    font-size: $font-control;
    text-align: left;
    cursor: pointer;

    &:disabled {
      color: $text-muted;
      cursor: default;
    }

    kbd {
      flex-shrink: 0;
      margin-inline-start: auto;
      color: $text-muted;
      font: inherit;
      font-size: $font-caption;
      white-space: nowrap;
    }

    &:hover {
      background: $surface-hover;
    }

    &:focus-visible {
      outline: 2px solid $focus-ring;
      outline-offset: -2px;
    }

    &.is-danger {
      color: $error-text;
    }
  }
}

.context-menu__empty {
  display: block;
  padding: $space-2 $space-3;
  color: $text-muted;
  font-size: $font-label;
}
</style>
