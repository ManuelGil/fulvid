<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";

import AppIcon from "../../../shell/AppIcon.vue";
import ContextMenu, { type ContextMenuAction } from "../../../shell/ContextMenu.vue";
import { notify } from "../../../app/notify";
import { confirmDialog, promptFilename } from "../../../app/dialogs";
import {
  closeDocument,
  getDocumentBuffer,
  isDocumentDirty,
  openOrActivate,
  renameDocumentBuffer,
} from "../../editor/document/documentBuffers";
import {
  activeContextLabel,
  copyWorkspacePath,
  clearContextRoot,
  contextRoot,
  hasCustomContext,
  refreshWorkspace,
  revealWorkspaceInExplorer,
  setContextRoot,
  workspace,
  applyRenamedNote,
  applyScannedNote,
} from "../../../app/workspaceState";
import { APP_ROUTE_NAMES } from "../../../app/router";
import { isMarkdownFile, type FileSystemEntry } from "../filesystem/workspaceTypes";
import {
  createDocument,
  deleteDocument,
  describeFilesystemError,
  listDirectory,
  notifyFilesystemError,
  renameDocument,
} from "../filesystem/workspaceScanner";
import { settings } from "../../settings/settingsStore";

type VisibleRow = {
  entry: FileSystemEntry;
  depth: number;
  position: number;
  siblingCount: number;
};

const { t } = useI18n();
const router = useRouter();

const entriesByDirectory = ref<Record<string, FileSystemEntry[]>>({});
const expandedDirectories = ref(new Set<string>());
const selectedPath = ref<string | null>(null);
const loadingDirectories = ref(new Set<string>());
const errorMessage = ref<string | null>(null);
const rowElements = new Map<string, HTMLButtonElement>();

const workspaceRoot = computed(() => workspace.value?.path ?? null);
const rootEntries = computed(() => entriesByDirectory.value[""] ?? []);
const selectedEntry = computed<FileSystemEntry | null>(() => {
  if (!selectedPath.value) {
    return null;
  }

  for (const entries of Object.values(entriesByDirectory.value)) {
    const entry = entries.find((candidate) => candidate.path === selectedPath.value);
    if (entry) {
      return entry;
    }
  }
  return null;
});

const visibleRows = computed<VisibleRow[]>(() => {
  const rows: VisibleRow[] = [];

  function append(directory: string, depth: number): void {
    const entries = entriesByDirectory.value[directory] ?? [];
    entries.forEach((entry, index) => {
      rows.push({
        entry,
        depth,
        position: index + 1,
        siblingCount: entries.length,
      });
      if (entry.kind === "directory" && expandedDirectories.value.has(entry.path)) {
        append(entry.path, depth + 1);
      }
    });
  }

  append("", 0);
  return rows;
});

const contextActions = computed<readonly ContextMenuAction[]>(() => {
  const entry = selectedEntry.value;
  if (!entry) {
    return [];
  }

  if (entry.kind === "file") {
    return [
      { id: "rename", label: t("files.rename") },
      { id: "reveal", label: t("actions.reveal") },
      { id: "copy", label: t("actions.copy") },
      { id: "delete", label: t("files.delete"), danger: true },
    ];
  }

  const contextIsAlreadySet = hasCustomContext.value && contextRoot.value === entry.path;
  return [
    {
      id: contextIsAlreadySet ? "clear-context" : "set-context",
      label: contextIsAlreadySet ? t("context.clearRoot") : t("context.setRoot"),
    },
    { id: "reveal", label: t("actions.reveal") },
    { id: "copy", label: t("actions.copy") },
  ];
});

const contextMenu = ref({
  open: false,
  x: 0,
  y: 0,
});

function parentPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  segments.pop();
  return segments.join("/");
}

function setRowRef(path: string, element: unknown): void {
  if (element instanceof HTMLButtonElement) {
    rowElements.set(path, element);
  } else {
    rowElements.delete(path);
  }
}

async function loadDirectory(relativePath: string): Promise<void> {
  const rootPath = workspaceRoot.value;
  if (!rootPath || loadingDirectories.value.has(relativePath)) {
    return;
  }

  loadingDirectories.value.add(relativePath);
  errorMessage.value = null;
  try {
    const result = await listDirectory(
      rootPath,
      relativePath,
      settings.value.workspace.showHiddenFiles,
    );
    if (workspaceRoot.value !== rootPath) {
      return;
    }
    entriesByDirectory.value = {
      ...entriesByDirectory.value,
      [relativePath]: result,
    };
  } catch (error) {
    errorMessage.value = describeFilesystemError(error, "files.readError");
  } finally {
    const next = new Set(loadingDirectories.value);
    next.delete(relativePath);
    loadingDirectories.value = next;
  }
}

async function toggleDirectory(entry: FileSystemEntry): Promise<void> {
  if (entry.kind !== "directory") {
    return;
  }

  selectedPath.value = entry.path;
  if (expandedDirectories.value.has(entry.path)) {
    const next = new Set(expandedDirectories.value);
    next.delete(entry.path);
    expandedDirectories.value = next;
    return;
  }

  await loadDirectory(entry.path);
  expandedDirectories.value = new Set([...expandedDirectories.value, entry.path]);
}

async function openEntry(entry: FileSystemEntry): Promise<void> {
  selectedPath.value = entry.path;
  if (entry.kind === "directory") {
    await toggleDirectory(entry);
    return;
  }

  const rootPath = workspaceRoot.value;
  if (!rootPath) {
    return;
  }
  try {
    await openOrActivate({
      kind: "workspace",
      rootPath,
      path: entry.path,
    });
    await router.push({ name: APP_ROUTE_NAMES.editor });
  } catch (error) {
    notifyFilesystemError(error, "workspace.openDocumentError", notify);
  }
}

function targetDirectory(): string {
  const entry = selectedEntry.value;
  if (entry?.kind === "directory") {
    return entry.path;
  }
  return entry ? parentPath(entry.path) : "";
}

async function createNewDocument(): Promise<void> {
  const rootPath = workspaceRoot.value;
  if (!rootPath) {
    return;
  }

  const requestedName = await promptFilename({
    title: t("files.newDocument"),
    label: t("files.newDocumentName"),
  });
  if (!requestedName) {
    return;
  }
  const name = requestedName.includes(".")
    ? requestedName
    : `${requestedName}.${settings.value.links.defaultExtension}`;
  if (!isMarkdownFile(name)) {
    notify(t("files.supportedOnly"));
    return;
  }

  const relativePath = [targetDirectory(), name].filter(Boolean).join("/");
  try {
    const result = await createDocument(rootPath, relativePath, "", settings.value.links.linkMode);
    applyScannedNote(result.note);
    await loadDirectory(targetDirectory());
    await openOrActivate({ kind: "workspace", rootPath, path: relativePath });
    await router.push({ name: APP_ROUTE_NAMES.editor });
  } catch (error) {
    notifyFilesystemError(error, "workspace.openDocumentError", notify);
  }
}

async function renameSelectedDocument(): Promise<void> {
  const rootPath = workspaceRoot.value;
  const entry = selectedEntry.value;
  if (!rootPath || !entry || entry.kind !== "file") {
    return;
  }

  const nextName = await promptFilename({
    title: t("files.rename"),
    label: t("files.renameName"),
    initialValue: entry.name,
  });
  if (!nextName || nextName === entry.name || !isMarkdownFile(nextName)) {
    return;
  }

  const nextPath = [parentPath(entry.path), nextName].filter(Boolean).join("/");
  const buffer = getDocumentBuffer(rootPath, entry.path);
  try {
    const result = await renameDocument(
      rootPath,
      entry.path,
      nextPath,
      buffer?.mtimeMs,
      settings.value.links.linkMode,
    );
    if (buffer) {
      renameDocumentBuffer(buffer, nextPath, result.mtimeMs);
    }
    applyRenamedNote(entry.path, result.note);
    selectedPath.value = nextPath;
    await loadDirectory(parentPath(entry.path));
    await loadDirectory(parentPath(nextPath));
  } catch (error) {
    notifyFilesystemError(error, "files.renameError", notify);
  }
}

async function deleteSelectedDocument(): Promise<void> {
  const rootPath = workspaceRoot.value;
  const entry = selectedEntry.value;
  if (!rootPath || !entry || entry.kind !== "file") {
    return;
  }

  const buffer = getDocumentBuffer(rootPath, entry.path);
  if (
    !(await confirmDialog(
      t(buffer && isDocumentDirty(buffer) ? "files.deleteUnsaved" : "files.deleteConfirm", {
        name: entry.name,
      }),
    ))
  ) {
    return;
  }

  try {
    await deleteDocument(rootPath, entry.path, buffer?.mtimeMs);
    if (buffer) {
      closeDocument(rootPath, entry.path, true);
    }
    selectedPath.value = null;
    await loadDirectory(parentPath(entry.path));
    await refreshWorkspace({ silent: true });
  } catch (error) {
    notify(describeFilesystemError(error, "files.deleteError"));
  }
}

async function runContextAction(id: string): Promise<void> {
  contextMenu.value.open = false;
  const entry = selectedEntry.value;
  if (id === "rename") {
    await renameSelectedDocument();
  } else if (id === "delete") {
    await deleteSelectedDocument();
  } else if (id === "reveal" && entry) {
    await revealWorkspaceInExplorer(entry.path);
  } else if (id === "copy" && entry) {
    await copyWorkspacePath(entry.path);
  } else if (id === "set-context" && entry?.kind === "directory") {
    setContextRoot(entry.path);
  } else if (id === "clear-context") {
    clearContextRoot();
  }
}

function openContextMenu(event: MouseEvent, entry: FileSystemEntry): void {
  event.preventDefault();
  (event.currentTarget as HTMLElement).focus();
  openContextMenuAt(event.clientX, event.clientY, entry);
}

function openContextMenuAt(x: number, y: number, entry: FileSystemEntry): void {
  selectedPath.value = entry.path;
  contextMenu.value = {
    open: true,
    x,
    y,
  };
}

function focusRow(path: string): void {
  selectedPath.value = path;
  rowElements.get(path)?.focus();
}

function focusRelativeRow(path: string, delta: number): void {
  const index = visibleRows.value.findIndex((row) => row.entry.path === path);
  if (index < 0) {
    return;
  }
  const next = visibleRows.value[index + delta];
  if (next) {
    focusRow(next.entry.path);
  }
}

async function onRowKeydown(event: KeyboardEvent, row: VisibleRow): Promise<void> {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    focusRelativeRow(row.entry.path, event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (event.key === "Home") {
    event.preventDefault();
    const first = visibleRows.value[0];
    if (first) {
      focusRow(first.entry.path);
    }
    return;
  }
  if (event.key === "End") {
    event.preventDefault();
    const last = visibleRows.value[visibleRows.value.length - 1];
    if (last) {
      focusRow(last.entry.path);
    }
    return;
  }
  if (event.key === "ArrowRight" && row.entry.kind === "directory") {
    event.preventDefault();
    if (!expandedDirectories.value.has(row.entry.path)) {
      await toggleDirectory(row.entry);
    }
    return;
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    if (row.entry.kind === "directory" && expandedDirectories.value.has(row.entry.path)) {
      await toggleDirectory(row.entry);
    } else {
      const parent = parentPath(row.entry.path);
      if (parent) {
        focusRow(parent);
      }
    }
    return;
  }
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
    event.preventDefault();
    const element = event.currentTarget as HTMLElement;
    const bounds = element.getBoundingClientRect();
    openContextMenuAt(bounds.left, bounds.bottom, row.entry);
  }
}

function resetExplorer(): void {
  entriesByDirectory.value = {};
  expandedDirectories.value = new Set();
  loadingDirectories.value = new Set();
  selectedPath.value = null;
  errorMessage.value = null;
  if (workspaceRoot.value) {
    void loadDirectory("");
  }
}

watch(
  () => workspaceRoot.value,
  () => resetExplorer(),
  { immediate: true },
);

watch(
  () => settings.value.workspace.showHiddenFiles,
  () => resetExplorer(),
);

onBeforeUnmount(() => {
  rowElements.clear();
});
</script>

<template>
  <section class="explorer-panel" :aria-label="t('files.title')">
    <header class="explorer-panel__toolbar">
      <span class="explorer-panel__root" :title="workspaceRoot ?? undefined">
        {{
          activeContextLabel ??
          (workspaceRoot ? workspaceRoot.split(/[\\/]/).pop() : t("workspace.noWorkspace"))
        }}
      </span>
      <div class="explorer-panel__actions">
        <button
          type="button"
          :title="t('files.newDocument')"
          :aria-label="t('files.newDocument')"
          :disabled="!workspaceRoot"
          @click="createNewDocument"
        >
          <AppIcon name="document" :size="14" />
        </button>
        <button
          type="button"
          :title="t('actions.refresh')"
          :aria-label="t('actions.refresh')"
          :disabled="!workspaceRoot"
          @click="resetExplorer"
        >
          <AppIcon name="reset" :size="14" />
        </button>
      </div>
    </header>

    <div v-if="!workspaceRoot" class="explorer-panel__empty">
      {{ t("files.openFirst") }}
    </div>
    <div
      v-else-if="loadingDirectories.has('')"
      class="explorer-panel__empty"
      role="status"
      aria-live="polite"
    >
      {{ t("workspace.loadingDocuments") }}
    </div>
    <div
      v-else-if="errorMessage"
      class="explorer-panel__empty explorer-panel__empty--error"
      role="alert"
    >
      {{ errorMessage }}
    </div>
    <div v-else-if="rootEntries.length === 0" class="explorer-panel__empty">
      {{ t("files.empty") }}
    </div>
    <div v-else class="explorer-panel__tree" role="tree" :aria-label="t('files.title')">
      <button
        v-for="(row, index) in visibleRows"
        :key="row.entry.path"
        :ref="(element) => setRowRef(row.entry.path, element)"
        class="explorer-panel__row"
        :class="{ 'explorer-panel__row--selected': selectedPath === row.entry.path }"
        type="button"
        role="treeitem"
        :tabindex="selectedPath === row.entry.path || (!selectedPath && index === 0) ? 0 : -1"
        :aria-selected="selectedPath === row.entry.path"
        :aria-level="row.depth + 1"
        :aria-posinset="row.position"
        :aria-setsize="row.siblingCount"
        aria-haspopup="menu"
        :aria-expanded="
          row.entry.kind === 'directory' ? expandedDirectories.has(row.entry.path) : undefined
        "
        :style="{ paddingLeft: `${10 + row.depth * 16}px` }"
        @click="openEntry(row.entry)"
        @contextmenu="openContextMenu($event, row.entry)"
        @keydown="onRowKeydown($event, row)"
      >
        <span class="explorer-panel__disclosure" aria-hidden="true">
          <AppIcon
            v-if="row.entry.kind === 'directory'"
            :name="expandedDirectories.has(row.entry.path) ? 'chevron-down' : 'chevron-right'"
            :size="12"
          />
        </span>
        <AppIcon :name="row.entry.kind === 'directory' ? 'folder' : 'document'" :size="14" />
        <span class="explorer-panel__name">{{ row.entry.name }}</span>
      </button>
    </div>

    <ContextMenu
      :open="contextMenu.open"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :actions="contextActions"
      :label="t('files.documentActions')"
      @select="runContextAction"
      @close="contextMenu.open = false"
    />
  </section>
</template>

<style scoped lang="scss">
@use "../../../styles/colors" as *;
@use "../../../styles/variables" as *;

.explorer-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  color: $text-primary;
}

.explorer-panel__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $space-related;
  flex-shrink: 0;
  min-height: $control-height;
  padding: $space-related $space-compact;
  border-bottom: 1px solid $border-subtle;
}

.explorer-panel__root {
  min-width: 0;
  overflow: hidden;
  color: $text-muted;
  font-size: $font-caption;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.explorer-panel__actions {
  display: inline-flex;
  gap: 2px;

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: $hit-min;
    height: $hit-min;
    border: 0;
    border-radius: $radius;
    background: transparent;
    color: $text-muted;
    cursor: pointer;

    &:hover:not(:disabled) {
      background: $surface-hover;
      color: $text-primary;
    }

    &:focus-visible {
      outline: 2px solid $focus-ring;
      outline-offset: -2px;
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }
  }
}

.explorer-panel__tree {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: $space-related $space-compact;
}

.explorer-panel__row {
  display: flex;
  align-items: center;
  gap: $space-tight;
  width: 100%;
  min-height: $control-height-small;
  padding-top: $space-tight;
  padding-right: $space-related;
  padding-bottom: $space-tight;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: $text-secondary;
  font: inherit;
  font-size: $font-label;
  text-align: left;
  cursor: pointer;

  &:hover,
  &--selected {
    background: $surface-hover;
    color: $text-primary;
  }

  &:focus-visible {
    background: $surface-hover;
    color: $text-primary;
    outline: 2px solid $focus-ring;
    outline-offset: -2px;
    box-shadow: inset 2px 0 $focus-ring;
  }
}

.explorer-panel__disclosure {
  width: 10px;
  color: $text-muted;
  font-size: $font-caption;
  text-align: center;
}

.explorer-panel__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.explorer-panel__empty {
  padding: $space-block $space-compact;
  color: $text-muted;
  font-size: $font-label;
  line-height: 1.55;
}

.explorer-panel__empty--error {
  color: $error-text;
}
</style>
