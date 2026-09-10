<script setup lang="ts">
/**
 * Fulvid icon layer. Chrome uses Lucide through this component with
 * named imports so the bundler can keep only the icons Fulvid uses.
 * Monaco Codicons are remapped in monacoLucideIcons.ts.
 */
import type { FunctionalComponent } from "vue";
import { computed } from "vue";
import {
  Bold,
  ChevronDown,
  ChevronRight,
  Circle,
  ClipboardPaste,
  Code,
  Copy,
  CopyX,
  Crosshair,
  EllipsisVertical,
  Eye,
  FileCode,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FoldVertical,
  Heading,
  House,
  Image,
  Italic,
  Link,
  List,
  ListChecks,
  ListIndentDecrease,
  ListIndentIncrease,
  ListOrdered,
  ListTree,
  Minus,
  Plus,
  Quote,
  Redo2,
  RefreshCw,
  Replace,
  Save,
  Scissors,
  Search,
  Settings,
  Share2,
  Strikethrough,
  Undo2,
  UnfoldVertical,
  X,
  ZoomIn,
  ZoomOut,
} from "@lucide/vue";

export type IconName =
  | "home"
  | "search"
  | "graph"
  | "settings"
  | "reset"
  | "undo"
  | "redo"
  | "replace"
  | "fold"
  | "unfold"
  | "zoom-in"
  | "zoom-out"
  | "center"
  | "close"
  | "add"
  | "folder"
  | "folder-open"
  | "document"
  | "outline"
  | "new-document"
  | "save"
  | "close-all"
  | "preview"
  | "dirty"
  | "chevron-down"
  | "chevron-right"
  | "bold"
  | "italic"
  | "strikethrough"
  | "inline-code"
  | "heading"
  | "blockquote"
  | "code-fence"
  | "horizontal-rule"
  | "bullet-list"
  | "numbered-list"
  | "checklist"
  | "indent"
  | "outdent"
  | "link"
  | "image"
  | "cut"
  | "copy"
  | "paste"
  | "more";

const icons: Record<IconName, FunctionalComponent> = {
  home: House,
  search: Search,
  graph: Share2,
  settings: Settings,
  reset: RefreshCw,
  undo: Undo2,
  redo: Redo2,
  replace: Replace,
  fold: FoldVertical,
  unfold: UnfoldVertical,
  "zoom-in": ZoomIn,
  "zoom-out": ZoomOut,
  center: Crosshair,
  close: X,
  add: Plus,
  folder: Folder,
  "folder-open": FolderOpen,
  document: FileText,
  outline: ListTree,
  "new-document": FilePlus,
  save: Save,
  "close-all": CopyX,
  preview: Eye,
  dirty: Circle,
  "chevron-down": ChevronDown,
  "chevron-right": ChevronRight,
  bold: Bold,
  italic: Italic,
  strikethrough: Strikethrough,
  "inline-code": Code,
  heading: Heading,
  blockquote: Quote,
  "code-fence": FileCode,
  "horizontal-rule": Minus,
  "bullet-list": List,
  "numbered-list": ListOrdered,
  checklist: ListChecks,
  indent: ListIndentIncrease,
  outdent: ListIndentDecrease,
  link: Link,
  image: Image,
  cut: Scissors,
  copy: Copy,
  paste: ClipboardPaste,
  more: EllipsisVertical,
};

const props = withDefaults(
  defineProps<{
    name: IconName;
    size?: number;
  }>(),
  { size: 16 },
);

const icon = computed(() => icons[props.name]);
const filled = computed(() => props.name === "dirty");
</script>

<template>
  <component
    :is="icon"
    class="app-icon"
    :size="size"
    :style="{ '--app-icon-base-size': `${size}px` }"
    :stroke-width="filled ? 0 : 1.75"
    :fill="filled ? 'currentColor' : 'none'"
    aria-hidden="true"
  />
</template>

<style scoped>
.app-icon {
  display: block;
  flex-shrink: 0;
  width: calc(var(--app-icon-base-size) * var(--ui-icon-scale, 1));
  height: calc(var(--app-icon-base-size) * var(--ui-icon-scale, 1));
}
</style>
