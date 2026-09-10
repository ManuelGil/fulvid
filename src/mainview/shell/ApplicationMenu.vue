<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";

import ContextMenu, { type ContextMenuAction } from "./ContextMenu.vue";
import type { MenuAnchor } from "./contextMenuPosition";
import { toAriaKeyshortcuts, type CommandId } from "./commands";
import {
  presentedMenuAction,
  type PresentedMenuBar,
  type PresentedMenuItem,
} from "./applicationMenu/applicationMenuModel";

const props = defineProps<{
  menus: readonly PresentedMenuBar[];
}>();

const emit = defineEmits<{
  command: [id: CommandId];
}>();

const { t } = useI18n();
const openMenuId = ref<string | null>(null);
const menuX = ref(0);
const menuY = ref(0);
const menuAnchor = ref<MenuAnchor>({ left: 0, top: 0, right: 0, bottom: 0 });
const menuActions = ref<readonly ContextMenuAction[]>([]);
const menuLabel = ref("");
const menuButtons = new Map<string, HTMLButtonElement>();

function setMenuButton(id: string, element: unknown): void {
  if (element instanceof HTMLButtonElement) {
    menuButtons.set(id, element);
  } else {
    menuButtons.delete(id);
  }
}

function toContextActions(items: readonly PresentedMenuItem[]): ContextMenuAction[] {
  return items.map((item) => {
    if (item.type === "separator") {
      return { id: item.id, separator: true };
    }
    if (item.type === "submenu") {
      return {
        id: item.id,
        label: item.label,
        children: toContextActions(item.items),
      };
    }
    const commandId = presentedMenuAction(item);
    return {
      id: commandId ?? item.id,
      label: item.label,
      shortcut: item.type === "command" ? item.shortcut : undefined,
      ariaShortcut: item.type === "command" ? toAriaKeyshortcuts(item.shortcut) : undefined,
      disabled: !item.enabled,
    };
  });
}

function openMenu(
  menuId: string,
  label: string,
  actions: readonly ContextMenuAction[],
  target: HTMLElement,
): void {
  const bounds = target.getBoundingClientRect();
  if (openMenuId.value === menuId) {
    closeMenu();
    return;
  }
  openMenuId.value = menuId;
  menuLabel.value = label;
  menuActions.value = actions;
  menuAnchor.value = {
    left: bounds.left,
    top: bounds.top,
    right: bounds.right,
    bottom: bounds.bottom,
  };
  menuX.value = bounds.left;
  menuY.value = bounds.bottom + 2;
}

function closeMenu(): void {
  openMenuId.value = null;
  menuActions.value = [];
}

function selectCommand(id: string): void {
  closeMenu();
  emit("command", id as CommandId);
}

function focusAdjacentMenu(menuId: string, direction: -1 | 1): void {
  const index = props.menus.findIndex((menu) => menu.id === menuId);
  if (index < 0) {
    return;
  }
  const nextIndex = (index + direction + props.menus.length) % props.menus.length;
  const nextMenu = props.menus[nextIndex];
  if (nextMenu) {
    menuButtons.get(nextMenu.id)?.focus();
  }
}

function navigateOpenMenu(direction: -1 | 1): void {
  const currentId = openMenuId.value;
  if (!currentId) {
    return;
  }
  const index = props.menus.findIndex((menu) => menu.id === currentId);
  if (index < 0) {
    return;
  }

  const nextMenu = props.menus[(index + direction + props.menus.length) % props.menus.length];
  const button = nextMenu ? menuButtons.get(nextMenu.id) : undefined;
  if (!nextMenu || !button) {
    return;
  }

  closeMenu();
  button.focus();
  openMenu(nextMenu.id, nextMenu.label, toContextActions(nextMenu.items), button);
}

function onButtonKeydown(event: KeyboardEvent, menuId: string): void {
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    closeMenu();
    focusAdjacentMenu(menuId, event.key === "ArrowRight" ? 1 : -1);
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeMenu();
    (event.currentTarget as HTMLElement).focus();
    return;
  }
  if (!["Enter", " ", "ArrowDown"].includes(event.key)) {
    return;
  }
  event.preventDefault();
  const menu = props.menus.find((candidate) => candidate.id === menuId);
  const target = event.currentTarget;
  if (menu && target instanceof HTMLElement) {
    openMenu(menu.id, menu.label, toContextActions(menu.items), target);
  }
}
</script>

<template>
  <nav class="application-menu" role="menubar" :aria-label="t('menu.applicationFallback')">
    <button
      v-for="menu in menus"
      :key="menu.id"
      :ref="(element) => setMenuButton(menu.id, element)"
      class="application-menu__button"
      type="button"
      role="menuitem"
      aria-haspopup="menu"
      :aria-expanded="openMenuId === menu.id"
      @click="
        openMenu(
          menu.id,
          menu.label,
          toContextActions(menu.items),
          $event.currentTarget as HTMLElement,
        )
      "
      @keydown="onButtonKeydown($event, menu.id)"
    >
      {{ menu.label }}
    </button>

    <ContextMenu
      :open="openMenuId !== null"
      :x="menuX"
      :y="menuY"
      :anchor="menuAnchor"
      placement="below"
      :actions="menuActions"
      :label="menuLabel"
      horizontal-navigation
      @select="selectCommand"
      @close="closeMenu"
      @navigate="navigateOpenMenu"
    />
  </nav>
</template>

<style scoped lang="scss">
@use "../styles/colors" as *;
@use "../styles/variables" as *;

.application-menu {
  display: flex;
  align-items: center;
  gap: 1px;
  min-width: 0;
  padding-inline: $space-tight;
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.application-menu__button {
  flex: 0 0 auto;
  min-height: $control-height-small;
  padding: 0 $space-3;
  border: 0;
  border-radius: $radius;
  background: transparent;
  color: $text-secondary;
  font: inherit;
  font-size: $font-control;
  cursor: pointer;

  &:hover,
  &[aria-expanded="true"] {
    background: $surface-hover;
    color: $text-primary;
  }

  &:focus-visible {
    outline: 2px solid $focus-ring;
    outline-offset: -2px;
  }
}
</style>
