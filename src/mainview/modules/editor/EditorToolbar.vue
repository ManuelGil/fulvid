<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import AppIcon from "../../shell/AppIcon.vue";
import type { IconName } from "../../shell/appIcons";
import { toAriaKeyshortcuts } from "../../shell/commands";
import { MARKDOWN_COMMANDS, type MarkdownFormatAction } from "./markdown/markdownFormat";

type ToolbarItem = {
  id: MarkdownFormatAction;
  icon: IconName;
  label: string;
  shortcut?: string;
};

type ToolbarGroup = {
  id: string;
  actions: readonly ToolbarItem[];
};

const MARKDOWN_ICONS: Record<MarkdownFormatAction, IconName> = {
  bold: "bold",
  italic: "italic",
  strikethrough: "strikethrough",
  inlineCode: "inline-code",
  heading: "heading",
  blockquote: "blockquote",
  codeFence: "code-fence",
  horizontalRule: "horizontal-rule",
  bulletList: "bullet-list",
  numberedList: "numbered-list",
  checklist: "checklist",
  toggleTask: "checklist",
  indent: "indent",
  outdent: "outdent",
  link: "link",
  image: "image",
};

const MARKDOWN_GROUPS: readonly {
  id: "inline" | "block" | "list" | "reference";
  actions: readonly MarkdownFormatAction[];
}[] = [
  { id: "inline", actions: ["bold", "italic", "strikethrough", "inlineCode"] },
  {
    id: "block",
    actions: ["heading", "blockquote", "codeFence", "horizontalRule"],
  },
  {
    id: "list",
    actions: ["bulletList", "numberedList", "checklist", "toggleTask", "indent", "outdent"],
  },
  { id: "reference", actions: ["link", "image"] },
];

const props = withDefaults(
  defineProps<{
    canUseDocument?: boolean;
  }>(),
  {
    canUseDocument: false,
  },
);

const emit = defineEmits<{
  action: [action: MarkdownFormatAction];
  leave: [];
}>();

const { t } = useI18n();
const markdownToolbarRef = ref<HTMLElement | null>(null);
const markdownRoving = ref(0);

const markdownGroups = computed<readonly ToolbarGroup[]>(() =>
  MARKDOWN_GROUPS.map((group) => ({
    id: group.id,
    actions: group.actions.map((action) => {
      const command = MARKDOWN_COMMANDS.find((item) => item.action === action);
      return {
        id: action,
        icon: MARKDOWN_ICONS[action],
        label: t(`markdown.${action}`),
        shortcut: command && "shortcut" in command ? command.shortcut : undefined,
      };
    }),
  })),
);

function actionTitle(item: ToolbarItem): string {
  return item.shortcut ? `${item.label} (${item.shortcut})` : item.label;
}

function toolbarButtons(root: HTMLElement | null): HTMLButtonElement[] {
  return root ? [...root.querySelectorAll("button")] : [];
}

function setRoving(index: number, focus: boolean): void {
  const buttons = toolbarButtons(markdownToolbarRef.value);
  if (buttons.length === 0) {
    return;
  }
  const next = (index + buttons.length) % buttons.length;
  markdownRoving.value = next;
  buttons.forEach((button, buttonIndex) => {
    button.tabIndex = buttonIndex === next ? 0 : -1;
  });
  if (focus) {
    buttons[next]?.focus();
  }
}

function onToolbarKeydown(event: KeyboardEvent): void {
  const buttons = toolbarButtons(markdownToolbarRef.value);
  if (buttons.length === 0) {
    return;
  }
  const current = buttons.findIndex((button) => button === event.currentTarget);
  if (event.key === "Escape") {
    event.preventDefault();
    emit("leave");
    return;
  }
  if (event.key === "Home") {
    event.preventDefault();
    setRoving(0, true);
    return;
  }
  if (event.key === "End") {
    event.preventDefault();
    setRoving(buttons.length - 1, true);
    return;
  }
  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    setRoving(current + delta, true);
  }
}

function activate(action: MarkdownFormatAction): void {
  emit("action", action);
}

watch(
  [markdownGroups, () => props.canUseDocument],
  () => {
    void nextTick(() => setRoving(markdownRoving.value, false));
  },
  { immediate: true },
);
</script>

<template>
  <div class="editor-toolbars">
    <div
      ref="markdownToolbarRef"
      class="editor-toolbar editor-toolbar--markdown"
      role="toolbar"
      :aria-label="t('markdown.toolbar')"
    >
      <template v-for="(group, groupIndex) in markdownGroups" :key="group.id">
        <span v-if="groupIndex > 0" class="editor-toolbar__divider" aria-hidden="true" />
        <div
          class="editor-toolbar__group"
          role="group"
          :aria-label="t(`markdown.groups.${group.id}`)"
        >
          <button
            v-for="action in group.actions"
            :key="action.id"
            class="editor-toolbar__button"
            type="button"
            :title="actionTitle(action)"
            :aria-label="action.label"
            :aria-keyshortcuts="toAriaKeyshortcuts(action.shortcut)"
            :disabled="!canUseDocument"
            @keydown="onToolbarKeydown"
            @click="activate(action.id)"
          >
            <AppIcon :name="action.icon" :size="14" />
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "../../styles/colors" as *;
@use "../../styles/controls" as *;
@use "../../styles/variables" as *;

.editor-toolbars {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: $surface;
  border-bottom: 1px solid $border-subtle;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  gap: $space-related;
  min-width: 0;
  min-height: $control-height;
  padding: 0 $space-compact;
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.editor-toolbars:has(.editor-toolbar:not(.editor-toolbar--markdown)) .editor-toolbar--markdown {
  border-top: 1px solid $border-subtle;
}

.editor-toolbar__group {
  display: flex;
  align-items: center;
  gap: 1px;
  flex: 0 0 auto;
}

.editor-toolbar__divider {
  width: 1px;
  height: $space-5;
  flex: 0 0 auto;
  background: $border-subtle;
}

.editor-toolbar__button {
  @include icon-action-button;
}

@media (forced-colors: active) {
  .editor-toolbar__button {
    &:focus-visible {
      outline: 2px solid Highlight;
    }

    &:disabled {
      opacity: 1;
    }
  }
}
</style>
