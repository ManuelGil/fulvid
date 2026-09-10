<script setup lang="ts">
/**
 * Editor workbench: tabs, Monaco, preview, and page-owned File commands.
 * Document identity and I/O live in documentSession / documentBuffers;
 * this page only composes them.
 */
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";

import EditorTabs from "../../modules/editor/EditorTabs.vue";
import EditorToolbar from "../../modules/editor/EditorToolbar.vue";
import ContextMenu, { type ContextMenuAction } from "../../shell/ContextMenu.vue";
import EmptyState from "../../shell/EmptyState.vue";
import PageShell from "../../shell/PageShell.vue";
import { patchSettings } from "../../modules/settings/settingsStore";

import {
  applyScannedNote,
  clearRecentWorkspaces,
  closeWorkspace,
  copyPath,
  copyWorkspacePath,
  errorMessage,
  isLoading,
  loadingStatus,
  contextNotes,
  openWorkspace,
  recentWorkspaces,
  reopenLastWorkspace,
  revealPath,
  revealWorkspaceInExplorer,
  refreshWorkspace,
  relativeDocumentPath,
  selectRecentWorkspace,
  workspace,
  workspaceName,
} from "../../app/workspaceState";
import { APP_ROUTE_NAMES } from "../../app/router";
import {
  describeFilesystemError,
  notifyFilesystemError,
  pickAndSaveHtmlExport,
} from "../../modules/workspace/filesystem/workspaceScanner";
import { findMarkdownHeading } from "../../modules/editor/markdown/markdownStructure";
import {
  escapeHtml,
  exportMarkdownPreviewDocument,
  PREVIEW_INLINE_MARKUP_LIMIT,
} from "../../modules/editor/markdown/markdownPreview";
import {
  MARKDOWN_COMMANDS,
  type MarkdownFormatAction,
} from "../../modules/editor/markdown/markdownFormat";
import type { EditorCommandState } from "../../modules/editor/editorCommandState";
import { clearFocusState, focusDocument } from "../../modules/workspace/focus/focusState";
import {
  activeId,
  consumePendingReveal,
  pendingReveal,
} from "../../modules/editor/document/documentSession";
import { notify } from "../../app/notify";
import { confirmDialog, promptFilename } from "../../app/dialogs";
import { settings } from "../../modules/settings/settingsStore";
import {
  layout,
  openRightSidebar,
  setPreviewRatio,
  PREVIEW_RATIO_LIMITS,
} from "../../app/layoutStore";
import { editorCommandState } from "../../modules/editor/editorCommandState";
import { writingFocusActive } from "../../modules/editor/writingFocus";
import { registerCommandHandler } from "../../shell/commands";
import {
  attachDocumentBuffer,
  activeBuffer,
  closeAllDocuments,
  closeDocument,
  closeDocumentById,
  getDocumentBuffer,
  getDocumentBufferByAbsolutePath,
  getDocumentBufferById,
  isDocumentDirty,
  openBuffers,
  openOrActivate,
  saveAsDocument,
  saveDocument,
  selectDocument,
} from "../../modules/editor/document/documentBuffers";

const MonacoHost = defineAsyncComponent(() => import("../../modules/editor/monaco/MonacoHost.vue"));
const PreviewPane = defineAsyncComponent(
  () => import("../../modules/editor/preview/PreviewPane.vue"),
);

type MonacoHostHandle = {
  revealPosition: (lineNumber: number, column: number) => void;
  find: () => void;
  focus: () => void;
  replace: () => void;
  runEditorAction: (action: "undo" | "redo" | "fold" | "unfold") => Promise<void>;
  runMonacoAction: (actionId: string) => Promise<void>;
  runMarkdownAction: (action: MarkdownFormatAction) => void;
};

type PreviewPaneHandle = {
  setScrollRatio: (ratio: number) => void;
};

type MenuAction = ContextMenuAction & {
  run: () => void | Promise<void>;
};

const { t } = useI18n();
const router = useRouter();
const menuOpen = ref(false);
const menuX = ref(0);
const menuY = ref(0);
const menuActions = ref<MenuAction[]>([]);
const editorTabsRef = ref<InstanceType<typeof EditorTabs> | null>(null);
const monacoHostRef = ref<MonacoHostHandle | null>(null);
const previewPaneRef = ref<PreviewPaneHandle | null>(null);
const previewStacked = ref(false);
let previewMedia: MediaQueryList | null = null;
let previewResizeCleanup: (() => void) | null = null;

const lastFolderLabelId = useId();

const lastRecent = computed(() => recentWorkspaces.value[0] ?? null);

const canReopenLast = computed(() => !workspace.value && Boolean(lastRecent.value));

const otherRecents = computed(() =>
  recentWorkspaces.value.filter((item) => {
    if (item.path === workspace.value?.path) {
      return false;
    }
    return !canReopenLast.value || item.path !== lastRecent.value?.path;
  }),
);

const pageTitle = computed(
  () =>
    activeBuffer.value?.title ??
    (workspace.value ? workspaceName(workspace.value.path) : t("workspace.title")),
);

const activeBufferPath = computed(() => {
  const buffer = activeBuffer.value;
  if (!buffer) {
    return "";
  }
  return buffer.path ?? (buffer.kind === "virtual" ? "untitled.mdx" : buffer.title);
});

const activeDocumentContent = computed(() => {
  const buffer = activeBuffer.value;
  if (!buffer) {
    return "";
  }
  // Monaco owns the model; touching this ref lets Vue update Preview after edits.
  void buffer.changeVersion.value;
  return buffer.model.getValue();
});

const activeDocumentNotes = computed(() => {
  const buffer = activeBuffer.value;
  return buffer?.rootPath && buffer.rootPath === workspace.value?.path ? contextNotes.value : [];
});

watch(
  [activeId, pendingReveal, monacoHostRef],
  async ([documentId, reveal]) => {
    if (!documentId || !reveal || reveal.documentId !== documentId) {
      return;
    }
    await nextTick();
    if (!monacoHostRef.value) {
      return;
    }
    const position = consumePendingReveal(documentId);
    if (position) {
      monacoHostRef.value?.revealPosition(position.lineNumber, position.column);
    }
  },
  { deep: true },
);

const editorError = ref<string | null>(null);
async function saveEditorDocument(): Promise<void> {
  const buffer = activeBuffer.value;
  if (!buffer) {
    return;
  }

  if (buffer.kind === "virtual") {
    await saveAsEditorDocument();
    return;
  }

  try {
    const result = await saveDocument(buffer);
    const currentBuffer =
      buffer.rootPath && buffer.path
        ? getDocumentBuffer(buffer.rootPath, buffer.path)
        : getDocumentBufferById(buffer.id);
    if (currentBuffer !== buffer) {
      return;
    }

    if ("note" in result && buffer.model.getAlternativeVersionId() === buffer.savedVersionId) {
      applyScannedNote(result.note);
    }
    editorError.value = null;
    notify(t("workspace.saved"));
  } catch (error) {
    editorError.value = describeFilesystemError(error, "workspace.saveError");
    notify(editorError.value);
  }
}

async function saveAsEditorDocument(): Promise<void> {
  const buffer = activeBuffer.value;
  if (!buffer) {
    return;
  }

  const defaultExtension = settings.value.links.defaultExtension;
  const requestedName = await promptFilename({
    title: t("actions.saveAs"),
    label: t("workspace.saveAsName"),
    initialValue: buffer.kind === "virtual" ? `untitled.${defaultExtension}` : buffer.title,
  });
  if (requestedName === null) {
    return;
  }

  try {
    let result = await saveAsDocument(buffer, requestedName, defaultExtension);
    if (
      result.result.status === "exists" &&
      (await confirmDialog(t("workspace.overwriteConfirm", { name: result.result.absolutePath })))
    ) {
      const destination = getDocumentBufferByAbsolutePath(result.result.absolutePath);
      if (destination && destination !== buffer && isDocumentDirty(destination)) {
        editorError.value = t("workspace.saveConflict");
        notify(editorError.value);
        return;
      }
      result = await saveAsDocument(buffer, requestedName, defaultExtension, true);
    }
    if (result.result.status === "saved") {
      if (workspace.value) {
        const relativePath = relativeDocumentPath(workspace.value.path, result.result.absolutePath);
        if (relativePath) {
          attachDocumentBuffer(result.buffer, workspace.value.path, relativePath);
          focusDocument(relativePath);
          void refreshWorkspace({ silent: true });
        }
      }
      editorError.value = null;
      notify(t("workspace.saved"));
    }
  } catch (error) {
    editorError.value = describeFilesystemError(error, "workspace.saveError");
    notify(editorError.value);
  }
}

function suggestedHtmlExportBasename(title: string, isVirtual: boolean): string {
  if (isVirtual) {
    return "untitled.html";
  }
  const stem = title.replace(/\.(mdx|markdown|md)$/i, "").trim() || "untitled";
  return /\.html$/i.test(stem) ? stem : `${stem}.html`;
}

async function exportEditorDocumentHtml(): Promise<void> {
  const buffer = activeBuffer.value;
  if (!buffer) {
    return;
  }

  const requestedName = await promptFilename({
    title: t("actions.exportHtml"),
    label: t("workspace.exportName"),
    initialValue: suggestedHtmlExportBasename(buffer.title, buffer.kind === "virtual"),
  });
  if (requestedName === null) {
    return;
  }

  const documentTitle = buffer.title.replace(/\.(mdx|markdown|md)$/i, "").trim() || buffer.title;
  const exported = exportMarkdownPreviewDocument(
    buffer.model.getValue(),
    activeDocumentNotes.value,
    settings.value.links.linkMode,
    {
      title: documentTitle,
      sourcePath: buffer.path ?? undefined,
      imageLabel: (alt) => escapeHtml(t("preview.imagePlaceholder", { alt })),
    },
  );

  try {
    let result = await pickAndSaveHtmlExport(requestedName, exported.html);
    if (
      result.status === "exists" &&
      (await confirmDialog(t("workspace.overwriteConfirm", { name: result.absolutePath })))
    ) {
      result = await pickAndSaveHtmlExport(requestedName, exported.html, true);
    }
    if (result.status === "saved") {
      editorError.value = null;
      // Say so when the export carries the inert source rather than rendered
      // HTML, so a degraded export is never a silent one.
      notify(
        exported.preview.dense
          ? t("preview.dense", { count: PREVIEW_INLINE_MARKUP_LIMIT.toLocaleString() })
          : t("workspace.exported"),
      );
    }
  } catch (error) {
    editorError.value = describeFilesystemError(error, "workspace.exportError");
    notify(editorError.value);
  }
}

function leaveEditor(): void {
  editorTabsRef.value?.focusActiveTab();
}

function togglePreview(): void {
  patchSettings({
    preview: {
      ...settings.value.preview,
      enabled: !settings.value.preview.enabled,
    },
  });
}

function createNewDocument(): void {
  void openOrActivate({ kind: "virtual" })
    .then(() => router.push({ name: APP_ROUTE_NAMES.editor, query: {} }))
    .catch((error) => {
      notifyFilesystemError(error, "workspace.openDocumentError", notify);
    });
}

function findInEditor(): void {
  monacoHostRef.value?.find();
}

function replaceInEditor(): void {
  monacoHostRef.value?.replace();
}

function runMonacoEditorAction(actionId: string): void {
  void monacoHostRef.value?.runMonacoAction(actionId);
}

async function undoInEditor(): Promise<void> {
  await monacoHostRef.value?.runEditorAction("undo");
}

async function redoInEditor(): Promise<void> {
  await monacoHostRef.value?.runEditorAction("redo");
}

function onCommandState(state: EditorCommandState): void {
  editorCommandState.value = state;
}

function onEditorToolbarAction(action: MarkdownFormatAction): void {
  monacoHostRef.value?.runMarkdownAction(action);
}

function openOutlinePanel(): void {
  openRightSidebar("outline");
}

function syncPreviewScroll(ratio: number): void {
  previewPaneRef.value?.setScrollRatio(ratio);
}

function revealPreviewSource(lineNumber: number): void {
  monacoHostRef.value?.revealPosition(lineNumber, 1);
}

function revealForPreviewAnchor(
  path: string,
  anchor?: string,
): { lineNumber: number; column: number } | undefined {
  if (!anchor) {
    return undefined;
  }
  const current = activeBuffer.value;
  const note = activeDocumentNotes.value.find((candidate) => candidate.path === path);
  const liveBuffer = workspace.value ? getDocumentBuffer(workspace.value.path, path) : null;
  const content =
    current && (current.path === path || activeBufferPath.value === path)
      ? current.model.getValue()
      : (liveBuffer?.model.getValue() ?? note?.content);
  if (!content) {
    return undefined;
  }
  const heading = findMarkdownHeading(content, anchor);
  return heading ? { lineNumber: heading.lineNumber, column: 1 } : undefined;
}

function startPreviewResize(event: PointerEvent): void {
  event.preventDefault();
  previewResizeCleanup?.();
  const row = (event.currentTarget as HTMLElement).parentElement;
  if (!row) {
    return;
  }
  const bounds = row.getBoundingClientRect();
  const vertical = getComputedStyle(row).flexDirection === "column";
  let cleanup = (): void => {};
  const onMove = (moveEvent: PointerEvent): void => {
    const previewRatio = vertical
      ? (bounds.bottom - moveEvent.clientY) / bounds.height
      : (bounds.right - moveEvent.clientX) / bounds.width;
    setPreviewRatio(previewRatio);
  };
  const onUp = (): void => {
    cleanup();
    if (previewResizeCleanup === cleanup) {
      previewResizeCleanup = null;
    }
  };
  cleanup = (): void => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };
  document.body.style.cursor = previewStacked.value ? "row-resize" : "col-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  previewResizeCleanup = cleanup;
}

function onPreviewResizeKeydown(event: KeyboardEvent): void {
  const increaseKey = previewStacked.value ? "ArrowUp" : "ArrowLeft";
  const decreaseKey = previewStacked.value ? "ArrowDown" : "ArrowRight";
  if (event.key !== increaseKey && event.key !== decreaseKey) {
    return;
  }
  event.preventDefault();
  setPreviewRatio(layout.value.previewRatio + (event.key === increaseKey ? 0.03 : -0.03));
}

async function openPreviewDocument(path: string, anchor?: string): Promise<void> {
  const rootPath = workspace.value?.path;
  if (!rootPath) {
    return;
  }

  editorError.value = null;
  try {
    const reveal = revealForPreviewAnchor(path, anchor);
    await openOrActivate({
      kind: "workspace",
      rootPath,
      path,
      ...(reveal ? { reveal } : {}),
    });
  } catch (error) {
    notifyFilesystemError(error, "workspace.openDocumentError", (message) => {
      editorError.value = message;
      notify(message);
    });
  }
}

async function closeEditorDocument(id: string): Promise<void> {
  const buffer = getDocumentBufferById(id);
  if (!buffer) {
    return;
  }
  const wasActive = activeId.value === buffer.id;

  if (
    isDocumentDirty(buffer) &&
    settings.value.workspace.confirmClose &&
    !(await confirmDialog(t("workspace.closeUnsaved", { name: buffer.title })))
  ) {
    return;
  }

  const closed =
    buffer.rootPath && buffer.path
      ? closeDocument(buffer.rootPath, buffer.path, true)
      : closeDocumentById(buffer.id, true);
  if (!closed) {
    return;
  }

  if (wasActive) {
    const replacement = activeBuffer.value;
    if (replacement) {
      selectDocument(replacement.id);
      editorTabsRef.value?.focusActiveTab();
    } else {
      clearFocusState();
    }
  }
}

async function closeOtherDocuments(targetId?: string): Promise<void> {
  const target = targetId ? getDocumentBufferById(targetId) : activeBuffer.value;
  if (!target) {
    return;
  }
  const others = openBuffers.value.filter((buffer) => buffer.id !== target.id);
  if (
    others.some(isDocumentDirty) &&
    settings.value.workspace.confirmClose &&
    !(await confirmDialog(t("workspace.closeOthersUnsaved")))
  ) {
    return;
  }
  for (const buffer of others) {
    closeDocumentById(buffer.id, true);
  }
}

async function closeAllEditorDocuments(): Promise<void> {
  const closing = openBuffers.value;
  if (closing.length === 0) {
    return;
  }
  if (
    closing.some(isDocumentDirty) &&
    settings.value.workspace.confirmClose &&
    !(await confirmDialog(t("workspace.closeAllUnsaved")))
  ) {
    return;
  }
  closeAllDocuments(true);
}

const unregisterCommands = [
  registerCommandHandler("save", saveEditorDocument),
  registerCommandHandler("saveAs", saveAsEditorDocument),
  registerCommandHandler("exportHtml", exportEditorDocumentHtml),
  registerCommandHandler("closeDocument", () => void closeEditorDocument(activeId.value ?? "")),
  registerCommandHandler("closeOthers", () => void closeOtherDocuments()),
  registerCommandHandler("closeAll", () => void closeAllEditorDocuments()),
  registerCommandHandler("undo", undoInEditor),
  registerCommandHandler("redo", redoInEditor),
  registerCommandHandler("cut", () => runMonacoEditorAction("editor.action.clipboardCutAction")),
  registerCommandHandler("copy", () => runMonacoEditorAction("editor.action.clipboardCopyAction")),
  registerCommandHandler("paste", () =>
    runMonacoEditorAction("editor.action.clipboardPasteAction"),
  ),
  registerCommandHandler("selectAll", () => runMonacoEditorAction("editor.action.selectAll")),
  registerCommandHandler("deleteSelection", () => runMonacoEditorAction("deleteRight")),
  registerCommandHandler("indentLines", () => runMonacoEditorAction("editor.action.indentLines")),
  registerCommandHandler("outdentLines", () => runMonacoEditorAction("editor.action.outdentLines")),
  registerCommandHandler("duplicateSelection", () =>
    runMonacoEditorAction("editor.action.copyLinesDownAction"),
  ),
  registerCommandHandler("find", findInEditor),
  registerCommandHandler("replace", replaceInEditor),
  registerCommandHandler("findReferences", () =>
    runMonacoEditorAction("editor.action.goToReferences"),
  ),
  registerCommandHandler("renameHeading", () => runMonacoEditorAction("editor.action.rename")),
  registerCommandHandler("togglePreview", togglePreview),
  ...MARKDOWN_COMMANDS.map((command) =>
    registerCommandHandler(command.id, () => {
      monacoHostRef.value?.runMarkdownAction(command.action);
    }),
  ),
];

onBeforeUnmount(() => {
  unregisterCommands.forEach((unregister) => unregister());
});

function closeMenu(): void {
  menuOpen.value = false;
  menuActions.value = [];
}

function openMenu(event: MouseEvent, actions: MenuAction[]): void {
  event.preventDefault();
  menuX.value = event.clientX;
  menuY.value = event.clientY;
  menuActions.value = actions;
  menuOpen.value = true;
}

function openMenuAt(x: number, y: number, actions: MenuAction[]): void {
  menuX.value = x;
  menuY.value = y;
  menuActions.value = actions;
  menuOpen.value = true;
}

async function runMenuAction(id: string): Promise<void> {
  const action = menuActions.value.find((candidate) => candidate.id === id);
  closeMenu();
  if (!action) {
    return;
  }
  await action.run();
}

function workspaceMenuActions(): MenuAction[] {
  return [
    {
      id: "reveal",
      label: t("actions.reveal"),
      run: () => revealWorkspaceInExplorer(),
    },
    {
      id: "copy",
      label: t("actions.copy"),
      run: () => copyWorkspacePath(),
    },
    {
      id: "open",
      label: t("actions.openEllipsis"),
      run: openWorkspace,
    },
    {
      id: "close",
      label: t("actions.close"),
      run: closeWorkspace,
      danger: true,
    },
  ];
}

function onWorkspaceContextMenu(event: MouseEvent): void {
  if (!workspace.value) {
    return;
  }

  (event.currentTarget as HTMLElement).focus();
  openMenu(event, workspaceMenuActions());
}

function onWorkspaceContextKeydown(event: KeyboardEvent): void {
  if (
    !workspace.value ||
    !(["Enter", " ", "ContextMenu"].includes(event.key) || (event.shiftKey && event.key === "F10"))
  ) {
    return;
  }
  event.preventDefault();
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  openMenuAt(bounds.left, bounds.bottom, workspaceMenuActions());
}

function onRecentContextMenu(event: MouseEvent, path: string): void {
  (event.currentTarget as HTMLElement).focus();
  openMenu(event, [
    {
      id: "open",
      label: t("actions.open"),
      run: () => selectRecentWorkspace(path),
    },
    {
      id: "reveal",
      label: t("actions.reveal"),
      run: () => revealPath(path),
    },
    {
      id: "copy",
      label: t("actions.copy"),
      run: () => copyPath(path),
    },
  ]);
}

function onRecentContextKeydown(event: KeyboardEvent, path: string): void {
  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) {
    return;
  }
  event.preventDefault();
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  openMenuAt(bounds.left, bounds.bottom, [
    {
      id: "open",
      label: t("actions.open"),
      run: () => selectRecentWorkspace(path),
    },
    {
      id: "reveal",
      label: t("actions.reveal"),
      run: () => revealPath(path),
    },
    {
      id: "copy",
      label: t("actions.copy"),
      run: () => copyPath(path),
    },
  ]);
}

function onPreviewMediaChange(event: MediaQueryListEvent): void {
  previewStacked.value = event.matches;
}

onMounted(() => {
  previewMedia = window.matchMedia("(max-width: 900px)");
  previewStacked.value = previewMedia.matches;
  previewMedia.addEventListener("change", onPreviewMediaChange);
  void nextTick(() => {
    requestAnimationFrame(() => {
      if (
        activeBuffer.value &&
        !(
          document.activeElement instanceof Element &&
          document.activeElement.closest(".app-shell__panel")
        )
      ) {
        monacoHostRef.value?.focus();
      }
    });
  });
});

onBeforeUnmount(() => {
  previewResizeCleanup?.();
  previewResizeCleanup = null;
  previewMedia?.removeEventListener("change", onPreviewMediaChange);
});
</script>

<template>
  <PageShell :title="pageTitle" fill rhythm="immediate">
    <template #header>
      <button
        v-if="workspace"
        class="editor-page__path"
        :title="t('workspace.rightClickActions')"
        :aria-label="t('workspace.rightClickActions')"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
        @contextmenu="onWorkspaceContextMenu"
        @keydown="onWorkspaceContextKeydown"
      >
        {{ workspace.path }}
      </button>
    </template>
    <div class="editor-page">
      <p v-if="errorMessage" class="editor-page__error" role="alert">
        {{ errorMessage }}
      </p>

      <p
        v-if="isLoading && openBuffers.length === 0"
        class="editor-page__loading"
        aria-live="polite"
        aria-busy="true"
      >
        {{ loadingStatus ?? t("workspace.looking") }}
      </p>

      <EmptyState
        v-else-if="!workspace && openBuffers.length === 0"
        pace="reassure"
        :title="t('workspace.noWorkspace')"
        :text="canReopenLast ? undefined : t('workspace.noWorkspaceText')"
      >
        <template v-if="canReopenLast && lastRecent" #detail>
          <div class="editor-last-folder" role="group" :aria-labelledby="lastFolderLabelId">
            <p :id="lastFolderLabelId" class="editor-last-folder__label">
              {{ t("workspace.lastOpenedFolder") }}
            </p>
            <p class="editor-last-folder__name">{{ lastRecent.name }}</p>
            <p class="editor-last-folder__path">{{ lastRecent.path }}</p>
          </div>
        </template>
        <template #action>
          <button v-if="canReopenLast" type="button" @click="reopenLastWorkspace">
            {{ t("actions.reopen", { name: lastRecent?.name ?? "" }) }}
          </button>
          <button :class="{ 'is-quiet': canReopenLast }" type="button" @click="openWorkspace">
            {{ t("actions.openWorkspace") }}
          </button>
        </template>
      </EmptyState>

      <div v-else class="editor-page__editor-shell">
        <p
          v-if="isLoading"
          class="editor-page__loading editor-page__loading--inline"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          {{ loadingStatus ?? t("workspace.looking") }}
        </p>
        <EditorTabs
          v-if="openBuffers.length > 0"
          ref="editorTabsRef"
          :buffers="openBuffers"
          :active-id="activeId"
          @activate="selectDocument"
          @close="closeEditorDocument"
          @new="createNewDocument"
          @close-others="closeOtherDocuments"
        />

        <EditorToolbar
          v-if="settings.editor.showMarkdownFormatBar && activeBuffer && !writingFocusActive"
          :can-use-document="Boolean(activeBuffer)"
          @action="onEditorToolbarAction"
          @leave="monacoHostRef?.focus()"
        />

        <div
          class="editor-page__document-split"
          :class="{ 'editor-page__document-split--preview': settings.preview.enabled }"
        >
          <section
            id="document-editor-panel"
            class="editor-page__editor-column"
            role="tabpanel"
            aria-labelledby="active-document-tab"
            :aria-label="t('workspace.editorArea')"
          >
            <MonacoHost
              v-if="activeBuffer"
              ref="monacoHostRef"
              class="editor-page__editor"
              :model="activeBuffer.model"
              :path="activeBufferPath"
              :root-path="activeBuffer.rootPath"
              :editor-settings="settings.editor"
              @save="saveEditorDocument"
              @save-as="saveAsEditorDocument"
              @outline="openOutlinePanel"
              @escape="leaveEditor"
              @scroll="syncPreviewScroll"
              @command-state="onCommandState"
            />
            <p v-else class="editor-page__empty-editor">
              {{ t("workspace.chooseDocument") }}
            </p>
          </section>
          <div
            v-if="activeBuffer && settings.preview.enabled"
            class="editor-page__preview-resize"
            role="slider"
            tabindex="0"
            :aria-orientation="previewStacked ? 'vertical' : 'horizontal'"
            :aria-label="t('preview.width')"
            :aria-valuenow="Math.round(layout.previewRatio * 100)"
            :aria-valuemin="Math.round(PREVIEW_RATIO_LIMITS.min * 100)"
            :aria-valuemax="Math.round(PREVIEW_RATIO_LIMITS.max * 100)"
            @pointerdown="startPreviewResize"
            @keydown="onPreviewResizeKeydown"
          />
          <PreviewPane
            v-if="activeBuffer && settings.preview.enabled"
            ref="previewPaneRef"
            :style="{ flex: `0 0 ${layout.previewRatio * 100}%` }"
            :content="activeDocumentContent"
            :path="activeBufferPath"
            :notes="activeDocumentNotes"
            :link-mode="settings.links.linkMode"
            @open-document="openPreviewDocument"
            @reveal-source="revealPreviewSource"
          />
        </div>

        <p v-if="editorError" class="editor-page__error" role="alert">
          {{ editorError }}
        </p>
      </div>
    </div>

    <template
      v-if="!workspace && !isLoading && openBuffers.length === 0 && otherRecents.length > 0"
      #continue
    >
      <section class="workspace-recents" :aria-label="t('workspace.recentWorkspaces')">
        <div class="workspace-recents__header">
          <h2 class="workspace-recents__title">{{ t("workspace.recent") }}</h2>
          <button class="workspace-recents__clear" type="button" @click="clearRecentWorkspaces">
            {{ t("actions.clear") }}
          </button>
        </div>
        <ul class="workspace-recents__list">
          <li v-for="item in otherRecents" :key="item.path">
            <button
              class="workspace-recents__item"
              type="button"
              aria-haspopup="menu"
              @click="selectRecentWorkspace(item.path)"
              @contextmenu="onRecentContextMenu($event, item.path)"
              @keydown="onRecentContextKeydown($event, item.path)"
            >
              <span class="workspace-recents__name">{{ item.name }}</span>
              <span class="workspace-recents__item-path">{{ item.path }}</span>
            </button>
          </li>
        </ul>
      </section>
    </template>

    <ContextMenu
      :open="menuOpen"
      :x="menuX"
      :y="menuY"
      :actions="menuActions"
      :label="t('workspace.actions')"
      @select="runMenuAction"
      @close="closeMenu"
    />
  </PageShell>
</template>

<style scoped lang="scss">
@use "../../styles/colors" as *;
@use "../../styles/controls" as *;
@use "../../styles/variables" as *;
@use "../../styles/object-layout" as *;
@use "../../styles/page-layout" as *;

.editor-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: $space-related;
  width: 100%;
}

.editor-page__editor-shell {
  display: flex;
  flex-direction: column;
  gap: $space-related;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.editor-page__document-split {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  gap: 0;
}

.editor-page__editor-column {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.editor-page__preview-resize {
  flex: 0 0 $resize-hit-width;
  min-height: 12rem;
  border-radius: $radius;
  @include resize-handle-interaction;
}

.editor-page__document-split--preview .editor-page__editor-column {
  min-width: min(22rem, 42%);
}

.editor-page__editor {
  flex: 1;
  width: 100%;
  min-width: 0;
  min-height: 12rem;
  background: $background;
}

.editor-page__empty-editor {
  margin: 0;
  color: $text-muted;
}

.editor-page__path {
  @include page-path;
  display: block;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: context-menu;
  max-width: 36rem;

  &:focus-visible {
    outline: 2px solid $focus-ring;
    outline-offset: 2px;
  }
}

.editor-page__loading {
  @include status-text;
  padding-block: $space-section;
  max-width: 24rem;
}

.editor-page__loading--inline {
  flex: 0 0 auto;
  padding-block: $space-tight;
  color: $text-muted;
  font-size: $font-caption;
}

.editor-page__error {
  @include error-text;
}

@media (max-width: 900px) {
  .editor-page__document-split--preview {
    flex-direction: column;
  }

  .editor-page__document-split--preview .editor-page__editor-column {
    min-height: 14rem;
  }

  .editor-page__preview-resize {
    flex-basis: 6px;
    min-height: 0;
    width: 100%;
    cursor: row-resize;
  }

  .editor-page__document-split--preview :deep(.preview-pane) {
    flex: 1 1 50% !important;
    width: 100%;
    min-height: 12rem;
  }
}

.editor-page :deep(.empty-state--reassure .empty-state__title) {
  color: $text-secondary;
  font-size: $font-body;
  font-weight: 600;
  letter-spacing: 0;
}

.editor-last-folder {
  display: flex;
  flex-direction: column;
  gap: $space-tight;
  max-width: 24rem;
}

.editor-last-folder__label {
  margin: 0;
  color: $text-muted;
  font-size: $font-micro;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.editor-last-folder__name {
  margin: 0;
  color: $text-primary;
  font-size: $font-section;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.25;
}

.editor-last-folder__path {
  margin: 0;
  color: $text-muted;
  font-family: $font-mono;
  font-size: $font-caption;
  line-height: 1.4;
  word-break: break-all;
}

.workspace-recents {
  display: flex;
  flex-direction: column;
  gap: $space-block;
  padding-top: $space-section;
  border-top: 1px solid $border-subtle;
  max-width: 28rem;
}

.workspace-recents__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $space-related;
}

.workspace-recents__title {
  @include object-section-title;
}

.workspace-recents__clear {
  @include object-inline-action;
}

.workspace-recents__list {
  @include object-row-list;
}

.workspace-recents__item {
  @include object-hover-row;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: $space-tight;
  font: inherit;
  text-align: left;
}

.workspace-recents__name {
  color: $text-primary;
  font-size: $font-control;
  font-weight: 600;
}

.workspace-recents__item-path {
  color: $text-muted;
  font-family: $font-mono;
  font-size: $font-caption;
  word-break: break-all;
}
</style>
