<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";

import AppIcon from "../../../shell/AppIcon.vue";
import ContextMenu, { type ContextMenuAction } from "../../../shell/ContextMenu.vue";
import { notify } from "../../../app/notify";
import { confirmDialog, promptFilename, promptPick } from "../../../app/dialogs";
import {
  closeDocument,
  getDocumentBuffer,
  isDocumentDirty,
  openBuffers,
  openOrActivate,
  awaitBufferWrites,
  renameDocumentBuffer,
} from "../../editor/document/documentBuffers";
import { applyDocumentPathRenamePlan } from "../../document/links/applyDocumentPathRename";
import { planDocumentPathRename } from "../../document/links/documentPathRename";
import {
  copyWorkspacePath,
  refreshWorkspace,
  revealWorkspaceInExplorer,
  workspace,
  workspaceName,
  workspaceNotes,
  applyRenamedNote,
  applyScannedNote,
} from "../../../app/workspaceState";
import { currentFocus, focusDocument, inspectionPath } from "../focus/focusState";
import {
  documentTemplateTitleFromParentPath,
  renderDocumentTemplate,
} from "../../editor/document/documentTemplates";
import { createAndOpenSeededWorkspaceDocument } from "../../editor/document/seededWorkspaceDocument";
import { resolveNewDocumentFileName } from "../../editor/document/documentFileNames";
import { APP_ROUTE_NAMES } from "../../../app/router";
import {
  isMarkdownFile,
  isSafeDocumentBasename,
  isSafeFolderBasename,
  type FileSystemEntry,
} from "../filesystem/workspaceTypes";
import {
  createDirectory,
  deleteDocument,
  describeFilesystemError,
  listDirectory,
  notifyFilesystemError,
  renameDocument,
} from "../filesystem/workspaceScanner";
import {
  explorerContextMenuLabelKey,
  explorerFileContextActionIds,
  explorerFileContextActionLabelKeys,
  explorerFolderContextActionIds,
  explorerPathActionLabelKeys,
} from "./explorerContextMenu";
import {
  explorerParentPath,
  isCurrentExplorerListSession,
  reconcileExplorerDirectoryState,
} from "./explorerListSession";
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
/** Frozen row for the open context menu; actions must not retarget live selection. */
const contextTarget = ref<FileSystemEntry | null>(null);
/** Bumped on reset/refresh so in-flight listDirectory results cannot mutate newer state. */
let explorerListSession = 0;
const pendingDirectoryLoads = new Map<string, Promise<boolean>>();

const workspaceRoot = computed(() => workspace.value?.path ?? null);

/** True when the open folder changed or closed while an async Explorer dialog ran. */
function workspaceChangedDuring(rootPath: string): boolean {
  return workspaceRoot.value !== rootPath;
}
const rootEntries = computed(() => entriesByDirectory.value[""] ?? []);

function findEntryByPath(path: string | null): FileSystemEntry | null {
  if (!path) {
    return null;
  }
  for (const entries of Object.values(entriesByDirectory.value)) {
    const entry = entries.find((candidate) => candidate.path === path);
    if (entry) {
      return entry;
    }
  }
  return null;
}

const selectedEntry = computed<FileSystemEntry | null>(() => findEntryByPath(selectedPath.value));

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
  const entry = contextTarget.value;
  if (!entry) {
    return [];
  }

  if (entry.kind === "file") {
    return explorerFileContextActionIds().map((id) => ({
      id,
      label: t(explorerFileContextActionLabelKeys[id]),
      danger: id === "delete",
    }));
  }

  return [
    {
      id: "new",
      label: t("menu.new"),
      children: [
        { id: "newDocument", label: t("files.newDocument") },
        { id: "newDocumentFromReadme", label: t("files.newDocumentFromReadme") },
        { id: "newFolder", label: t("files.newFolder") },
      ],
    },
    ...explorerFolderContextActionIds().map((id) => ({
      id,
      label: t(explorerPathActionLabelKeys[id]),
    })),
  ];
});

const contextMenuLabel = computed(() => {
  const entry = contextTarget.value;
  if (!entry) {
    return t("files.documentActions");
  }
  return t(explorerContextMenuLabelKey(entry.kind));
});

const contextMenu = ref({
  open: false,
  x: 0,
  y: 0,
});

function setRowRef(path: string, element: unknown): void {
  if (element instanceof HTMLButtonElement) {
    rowElements.set(path, element);
  } else {
    rowElements.delete(path);
  }
}

function markDirectoryLoading(relativePath: string, loading: boolean): void {
  const next = new Set(loadingDirectories.value);
  if (loading) {
    next.add(relativePath);
  } else {
    next.delete(relativePath);
  }
  loadingDirectories.value = next;
}

/**
 * List one directory against the authorized workspace root.
 * Returns false when the request is stale, the workspace closed, or listing failed.
 * Concurrent callers for the same path share one in-flight promise.
 */
async function loadDirectory(relativePath: string): Promise<boolean> {
  const rootPath = workspaceRoot.value;
  if (!rootPath) {
    return false;
  }

  const existing = pendingDirectoryLoads.get(relativePath);
  if (existing) {
    return existing;
  }

  const session = explorerListSession;
  const loadPromise = (async (): Promise<boolean> => {
    markDirectoryLoading(relativePath, true);
    if (isCurrentExplorerListSession(session, explorerListSession, rootPath, workspaceRoot.value)) {
      errorMessage.value = null;
    }
    try {
      const result = await listDirectory(
        rootPath,
        relativePath,
        settings.value.workspace.showHiddenFiles,
      );
      if (
        !isCurrentExplorerListSession(session, explorerListSession, rootPath, workspaceRoot.value)
      ) {
        return false;
      }
      const reconciled = reconcileExplorerDirectoryState(
        relativePath,
        result,
        entriesByDirectory.value,
        expandedDirectories.value,
      );
      entriesByDirectory.value = reconciled.entriesByDirectory;
      expandedDirectories.value = reconciled.expandedDirectories;
      return true;
    } catch (error) {
      if (
        isCurrentExplorerListSession(session, explorerListSession, rootPath, workspaceRoot.value)
      ) {
        errorMessage.value = describeFilesystemError(error, "files.readError");
      }
      return false;
    } finally {
      if (
        isCurrentExplorerListSession(session, explorerListSession, rootPath, workspaceRoot.value)
      ) {
        markDirectoryLoading(relativePath, false);
      }
    }
  })();

  pendingDirectoryLoads.set(relativePath, loadPromise);
  try {
    return await loadPromise;
  } finally {
    if (pendingDirectoryLoads.get(relativePath) === loadPromise) {
      pendingDirectoryLoads.delete(relativePath);
    }
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

  const loaded = await loadDirectory(entry.path);
  if (!loaded || !entriesByDirectory.value[entry.path]) {
    return;
  }
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

function targetDirectory(preferred?: FileSystemEntry | null): string {
  const entry = preferred ?? selectedEntry.value;
  if (entry?.kind === "directory") {
    return entry.path;
  }
  return entry ? explorerParentPath(entry.path) : "";
}

async function createExplorerDocument(
  seed: "blank" | "readme",
  preferredParent?: FileSystemEntry | null,
): Promise<void> {
  const rootPath = workspaceRoot.value;
  if (!rootPath) {
    return;
  }

  const promptTitle = seed === "readme" ? t("files.newDocumentFromReadme") : t("files.newDocument");
  const requestedName = await promptFilename({
    title: promptTitle,
    label: t("files.newDocumentName"),
    initialValue: seed === "readme" ? `README.${settings.value.links.defaultExtension}` : undefined,
  });
  if (!requestedName) {
    return;
  }
  const name = resolveNewDocumentFileName(requestedName, settings.value.links.defaultExtension);
  if (!name) {
    const withExtension = requestedName.includes(".")
      ? requestedName
      : `${requestedName}.${settings.value.links.defaultExtension}`;
    notify(
      isMarkdownFile(withExtension) ? t("filesystemErrors.unsafeName") : t("files.supportedOnly"),
    );
    return;
  }

  const parentDirectory = targetDirectory(preferredParent);
  const content =
    seed === "readme"
      ? renderDocumentTemplate("readme", {
          title: documentTemplateTitleFromParentPath(parentDirectory, workspaceName(rootPath)),
        })
      : "";
  try {
    await createAndOpenSeededWorkspaceDocument({
      rootPath,
      parentRelativePath: parentDirectory,
      fileName: name,
      content,
      linkMode: settings.value.links.linkMode,
    });
    await loadDirectory(parentDirectory);
    await router.push({ name: APP_ROUTE_NAMES.editor });
  } catch (error) {
    notifyFilesystemError(error, "workspace.openDocumentError", notify);
  }
}

function createNewDocument(preferredParent?: FileSystemEntry | null): Promise<void> {
  return createExplorerDocument("blank", preferredParent);
}

function createNewDocumentFromReadme(preferredParent?: FileSystemEntry | null): Promise<void> {
  return createExplorerDocument("readme", preferredParent);
}

async function createNewFolder(preferredParent?: FileSystemEntry | null): Promise<void> {
  const rootPath = workspaceRoot.value;
  if (!rootPath) {
    return;
  }

  const parentDirectory = targetDirectory(preferredParent);
  const name = await promptFilename({
    title: t("files.newFolder"),
    label: t("files.newFolderName"),
    initialValue: "",
  });
  if (!name) {
    return;
  }
  if (!isSafeFolderBasename(name)) {
    notify(t("filesystemErrors.unsafeName"));
    return;
  }
  if (workspaceChangedDuring(rootPath)) {
    return;
  }

  const relativePath = [parentDirectory, name].filter(Boolean).join("/");
  try {
    await createDirectory(rootPath, relativePath);
    if (workspaceChangedDuring(rootPath)) {
      return;
    }
    await loadDirectory(parentDirectory);
    if (parentDirectory) {
      expandedDirectories.value = new Set(expandedDirectories.value).add(parentDirectory);
    }
    selectedPath.value = relativePath;
  } catch (error) {
    notifyFilesystemError(error, "files.newFolderError", notify);
  }
}

async function listMoveDestinations(rootPath: string, sourcePath: string): Promise<string[]> {
  const currentParent = explorerParentPath(sourcePath);
  const destinations: string[] = [];
  const queue = [""];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const directory = queue.shift() ?? "";
    if (seen.has(directory)) {
      continue;
    }
    seen.add(directory);
    if (directory !== currentParent) {
      destinations.push(directory);
    }
    let entries: FileSystemEntry[];
    try {
      entries = await listDirectory(rootPath, directory, settings.value.workspace.showHiddenFiles);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.kind === "directory") {
        queue.push(entry.path);
      }
    }
  }

  return destinations.sort((left, right) => left.localeCompare(right));
}

async function relocateDocumentEntry(entry: FileSystemEntry, nextPath: string): Promise<void> {
  const rootPath = workspaceRoot.value;
  if (!rootPath || entry.kind !== "file" || nextPath === entry.path) {
    return;
  }

  const sourcePath = entry.path;
  const buffer = getDocumentBuffer(rootPath, sourcePath);
  const linkMode = settings.value.links.linkMode;
  const contentByPath = new Map<string, string>();
  for (const note of workspaceNotes.value) {
    if (typeof note.content === "string") {
      contentByPath.set(note.path, note.content);
    }
  }
  for (const open of openBuffers.value) {
    if (open.rootPath === rootPath && open.path) {
      contentByPath.set(open.path, open.model.getValue());
    }
  }

  const plan = planDocumentPathRename({
    oldPath: sourcePath,
    newPath: nextPath,
    notes: workspaceNotes.value,
    linkMode,
    contentByPath,
  });

  try {
    // Drain in-flight saves first so a late write cannot recreate the old path
    // after the filesystem rename has already moved the file.
    if (buffer) {
      await awaitBufferWrites(buffer);
    }
    if (workspaceChangedDuring(rootPath)) {
      return;
    }
    const result = await renameDocument(rootPath, sourcePath, nextPath, buffer?.mtimeMs, linkMode);
    if (workspaceChangedDuring(rootPath)) {
      return;
    }
    if (buffer) {
      renameDocumentBuffer(buffer, nextPath, result.mtimeMs);
    }
    applyRenamedNote(sourcePath, result.note);
    // renameDocumentBuffer already re-pairs Focus for the active tab. Only
    // update Focus/inspection when this path was the Focus target without
    // stealing the editor selection for a background rename.
    if (currentFocus.value?.path === sourcePath) {
      focusDocument(nextPath);
    } else if (inspectionPath.value === sourcePath) {
      inspectionPath.value = nextPath;
    }
    if (selectedPath.value === sourcePath) {
      selectedPath.value = nextPath;
    }
    await loadDirectory(explorerParentPath(sourcePath));
    await loadDirectory(explorerParentPath(nextPath));

    if (plan.edits.length > 0) {
      const applied = await applyDocumentPathRenamePlan({
        rootPath,
        plan,
        linkMode,
      });
      for (const note of applied.notes) {
        applyScannedNote(note);
      }
      if (applied.failedPaths.length > 0) {
        notify(
          t("files.renameLinksPartial", {
            count: applied.failedPaths.length.toLocaleString(),
          }),
        );
      }
    }
  } catch (error) {
    notifyFilesystemError(error, "files.renameError", notify);
  }
}

async function renameDocumentEntry(entry: FileSystemEntry): Promise<void> {
  const rootPath = workspaceRoot.value;
  if (!rootPath || entry.kind !== "file") {
    return;
  }

  const sourcePath = entry.path;
  const nextName = await promptFilename({
    title: t("files.rename"),
    label: t("files.renameName"),
    initialValue: entry.name,
  });
  if (!nextName || nextName === entry.name || !isMarkdownFile(nextName)) {
    return;
  }
  if (!isSafeDocumentBasename(nextName)) {
    notify(t("filesystemErrors.unsafeName"));
    return;
  }

  // Workspace may have closed while the dialog was open.
  if (workspaceChangedDuring(rootPath)) {
    return;
  }

  const nextPath = [explorerParentPath(sourcePath), nextName].filter(Boolean).join("/");
  await relocateDocumentEntry(entry, nextPath);
}

async function moveDocumentEntry(entry: FileSystemEntry): Promise<void> {
  const rootPath = workspaceRoot.value;
  if (!rootPath || entry.kind !== "file") {
    return;
  }

  const destinations = await listMoveDestinations(rootPath, entry.path);
  if (destinations.length === 0) {
    notify(t("files.moveNoDestinations"));
    return;
  }
  if (workspaceChangedDuring(rootPath)) {
    return;
  }

  const picked = await promptPick({
    title: t("files.move"),
    items: destinations.map((path) => ({
      id: path,
      label: path || t("files.folderRoot"),
      detail: path || workspaceName(rootPath),
    })),
  });
  if (picked === null) {
    return;
  }
  if (workspaceChangedDuring(rootPath)) {
    return;
  }

  const nextPath = [picked, entry.name].filter(Boolean).join("/");
  await relocateDocumentEntry(entry, nextPath);
}

async function deleteDocumentEntry(entry: FileSystemEntry): Promise<void> {
  const rootPath = workspaceRoot.value;
  if (!rootPath || entry.kind !== "file") {
    return;
  }

  const sourcePath = entry.path;
  const buffer = getDocumentBuffer(rootPath, sourcePath);
  if (
    !(await confirmDialog(
      t(buffer && isDocumentDirty(buffer) ? "files.deleteUnsaved" : "files.deleteConfirm", {
        name: entry.name,
      }),
    ))
  ) {
    return;
  }

  if (workspaceChangedDuring(rootPath)) {
    return;
  }

  try {
    // Drain first: an in-flight save after unlink would recreate the deleted file.
    if (buffer) {
      await awaitBufferWrites(buffer);
    }
    if (workspaceChangedDuring(rootPath)) {
      return;
    }
    await deleteDocument(rootPath, sourcePath, buffer?.mtimeMs);
    if (workspaceChangedDuring(rootPath)) {
      return;
    }
    if (buffer) {
      closeDocument(rootPath, sourcePath, true);
    }
    if (selectedPath.value === sourcePath) {
      selectedPath.value = null;
    }
    await loadDirectory(explorerParentPath(sourcePath));
    await refreshWorkspace({ silent: true });
  } catch (error) {
    notify(describeFilesystemError(error, "files.deleteError"));
  }
}

async function runContextAction(id: string): Promise<void> {
  const entry = contextTarget.value;
  contextMenu.value.open = false;
  contextTarget.value = null;
  if (!entry) {
    return;
  }

  if (id === "newDocument") {
    await createNewDocument(entry);
  } else if (id === "newDocumentFromReadme") {
    await createNewDocumentFromReadme(entry);
  } else if (id === "newFolder") {
    await createNewFolder(entry);
  } else if (id === "rename") {
    await renameDocumentEntry(entry);
  } else if (id === "move") {
    await moveDocumentEntry(entry);
  } else if (id === "delete") {
    await deleteDocumentEntry(entry);
  } else if (id === "reveal") {
    await revealWorkspaceInExplorer(entry.path);
  } else if (id === "copy") {
    await copyWorkspacePath(entry.path);
  }
}

function closeContextMenu(): void {
  contextMenu.value.open = false;
  contextTarget.value = null;
}

function openContextMenu(event: MouseEvent, entry: FileSystemEntry): void {
  event.preventDefault();
  (event.currentTarget as HTMLElement).focus();
  openContextMenuAt(event.clientX, event.clientY, entry);
}

function openContextMenuAt(x: number, y: number, entry: FileSystemEntry): void {
  selectedPath.value = entry.path;
  contextTarget.value = entry;
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
    } else {
      // Already expanded: APG tree pattern moves into the first visible child.
      focusRelativeRow(row.entry.path, 1);
    }
    return;
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    if (row.entry.kind === "directory" && expandedDirectories.value.has(row.entry.path)) {
      await toggleDirectory(row.entry);
    } else {
      const parent = explorerParentPath(row.entry.path);
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
  explorerListSession += 1;
  pendingDirectoryLoads.clear();
  entriesByDirectory.value = {};
  expandedDirectories.value = new Set();
  loadingDirectories.value = new Set();
  selectedPath.value = null;
  errorMessage.value = null;
  closeContextMenu();
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
  explorerListSession += 1;
  pendingDirectoryLoads.clear();
  rowElements.clear();
});
</script>

<template>
  <section class="explorer-panel" :aria-label="t('files.title')">
    <header class="explorer-panel__toolbar">
      <span class="explorer-panel__root" :title="workspaceRoot ?? undefined">
        {{ workspaceRoot ? workspaceRoot.split(/[\\/]/).pop() : t("workspace.noWorkspace") }}
      </span>
      <div class="explorer-panel__actions">
        <button
          type="button"
          :title="t('files.newDocument')"
          :aria-label="t('files.newDocument')"
          :disabled="!workspaceRoot"
          @click="() => createNewDocument()"
        >
          <AppIcon name="new-document" :size="14" />
        </button>
        <button
          type="button"
          :title="t('files.newDocumentFromReadme')"
          :aria-label="t('files.newDocumentFromReadme')"
          :disabled="!workspaceRoot"
          @click="() => createNewDocumentFromReadme()"
        >
          <AppIcon name="document" :size="14" />
        </button>
        <button
          type="button"
          :title="t('files.newFolder')"
          :aria-label="t('files.newFolder')"
          :disabled="!workspaceRoot"
          @click="() => createNewFolder()"
        >
          <AppIcon name="folder" :size="14" />
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
        <span class="explorer-panel__name" :title="row.entry.name">{{ row.entry.name }}</span>
      </button>
    </div>

    <ContextMenu
      :open="contextMenu.open"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :actions="contextActions"
      :label="contextMenuLabel"
      @select="runContextAction"
      @close="closeContextMenu"
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
