/**
 * Closed declarative AppIcon vocabulary.
 *
 * Identifiers are data Fulvid owns - not component names, HTML, SVG, or paths.
 * Unknown strings must not become presentation; see `resolveAppIconName`.
 * `AppIcon.vue` only renders resolved names; do not rebuild this map there.
 */
import type { FunctionalComponent } from "vue";
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
  FileSearch,
  FileText,
  Folder,
  FolderOpen,
  Focus,
  FoldVertical,
  Heading,
  Highlighter,
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
  | "focus"
  | "annotations"
  | "file-search"
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

export const APP_ICONS: Record<IconName, FunctionalComponent> = {
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
  focus: Focus,
  // Margin markers on a line - not sticky-notes, comments, or bookmarks.
  annotations: Highlighter,
  // Folder-wide content search - distinct from local Monaco find (`search`).
  "file-search": FileSearch,
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

/**
 * Map a declared name to a known AppIcon id, or null.
 * Never treat an arbitrary string as a valid icon (no dynamic components / markup).
 */
export function resolveAppIconName(name: string): IconName | null {
  return Object.hasOwn(APP_ICONS, name) ? (name as IconName) : null;
}
