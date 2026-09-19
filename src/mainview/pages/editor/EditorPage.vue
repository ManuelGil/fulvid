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

import EditorTabs from "../../modules/editor/EditorTabs.vue";
import EditorToolbar from "../../modules/editor/EditorToolbar.vue";
import ContextMenu, { type ContextMenuAction } from "../../shell/ContextMenu.vue";
import EmptyState from "../../shell/EmptyState.vue";
import PageShell from "../../shell/PageShell.vue";
import { patchSettings } from "../../modules/settings/settingsStore";
import { registerEditorExtensionSeam } from "../../extensions/editorExtensionSeam";
import type { ExtensionDecorationRange } from "../../extensions/decorationCapability";
import {
  listDocumentActivationCommands,
  runExtensionCommand,
  discoveredExtensions,
} from "../../extensions/extensionRegistry";

import {
  applyScannedNote,
  clearRecentWorkspaces,
  copyPath,
  errorMessage,
  isLoading,
  loadingStatus,
  workspaceNotes,
  openWorkspace,
  recentWorkspaces,
  reopenLastWorkspace,
  revealPath,
  refreshWorkspace,
  relativeDocumentPath,
  selectRecentWorkspace,
  workspace,
  workspaceName,
} from "../../app/workspaceState";
import {
  describeFilesystemError,
  notifyFilesystemError,
  pickAndSaveHtmlExport,
} from "../../modules/workspace/filesystem/workspaceScanner";
import {
  findMarkdownHeading,
  parseMarkdownStructure,
} from "../../modules/editor/markdown/markdownStructure";
import {
  buildDocumentFromSelection,
  buildMarkdownTableOfContents,
  formatDocumentLink,
  relativeDocumentLinkPath,
} from "../../modules/editor/markdown/markdownAuthoring";
import { suggestUntitledSaveBasename } from "../../modules/editor/document/documentFileNames";
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
import {
  confirmDialog,
  promptFilename,
  promptPick,
  promptQuickOpen,
  promptText,
} from "../../app/dialogs";
import { isUsableFocusTarget } from "../../app/usableFocusTarget";
import { settings } from "../../modules/settings/settingsStore";
import {
  layout,
  closeRightSidebar,
  openRightSidebar,
  setPreviewRatio,
  PREVIEW_RATIO_LIMITS,
  NARROW_VIEWPORT_MEDIA_QUERY,
} from "../../app/layoutStore";
import { editorCommandState } from "../../modules/editor/editorCommandState";
import {
  writingFocusActive,
  writingFocusKeepsFocusTarget,
  writingFocusLeaveEditorTarget,
} from "../../modules/editor/writingFocus";
import { executeCommand, registerCommandHandler } from "../../shell/commands";
import {
  attachDocumentBuffer,
  activeBuffer,
  closeAllDocuments,
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
import {
  DOCUMENT_ANNOTATION_MAX,
  DOCUMENT_ANNOTATION_TEXT_MAX,
} from "../../modules/editor/document/documentAnnotations";
import {
  resolveSessionChangePreviewAtLine,
  syncSessionChangeMarkerPresentation,
  type SessionChangePreviewPayload,
} from "../../modules/editor/document/sessionChangeMarkers";
import SessionChangePreviewPanel from "../../modules/editor/sessionChangePreview/SessionChangePreviewPanel.vue";
import { trackPointerDrag } from "../../app/pointerDrag";
import {
  documentLocationFromBuffer,
  showsMainPanelDocumentLocation,
} from "../../modules/editor/document/documentLocation";

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
  insertTextAtCursor: (text: string) => void;
  getSelectedText: () => string;
  getExtensionApplyContext: () => {
    selection: string;
    alternativeVersionId: number;
    startOffset: number;
    endOffset: number;
  } | null;
  getExtensionDocumentContext: () => {
    text: string;
    alternativeVersionId: number;
    cursorLine: number;
    cursorColumn: number;
  } | null;
  replacePrimarySelection: (text: string) => boolean;
  setExtensionDecorations: (
    extensionId: string,
    ranges: readonly ExtensionDecorationRange[],
  ) => boolean;
  clearExtensionDecorations: (extensionId: string) => boolean;
  trimTrailingWhitespace: () => boolean;
  currentCursorPosition: () => { lineNumber: number; column: number };
  findAnnotationAtLine: (lineNumber: number) => {
    position: { lineNumber: number; column: number };
    text: string;
  } | null;
  upsertAnnotationAtLine: (
    lineNumber: number,
    column: number,
    text: string,
  ) => {
    action: "added" | "updated" | "capped";
    annotation?: { position: { lineNumber: number; column: number }; text: string };
    position?: { lineNumber: number; column: number };
    count: number;
  } | null;
  removeAnnotationAtLine: (lineNumber: number) => {
    position: { lineNumber: number; column: number };
    text: string;
  } | null;
  goToNextDocumentAnnotation: () => boolean;
  goToPreviousDocumentAnnotation: () => boolean;
  clearDocumentAnnotations: () => number;
};

type PreviewPaneHandle = {
  setScrollRatio: (ratio: number) => void;
};

type MenuAction = ContextMenuAction & {
  run: () => void | Promise<void>;
};

const { t } = useI18n();
const menuOpen = ref(false);
const menuX = ref(0);
const menuY = ref(0);
const menuActions = ref<MenuAction[]>([]);
const editorTabsRef = ref<InstanceType<typeof EditorTabs> | null>(null);
const monacoHostRef = ref<MonacoHostHandle | null>(null);
const previewPaneRef = ref<PreviewPaneHandle | null>(null);
const previewStacked = ref(false);
const sessionChangePreview = ref<SessionChangePreviewPayload | null>(null);
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

const pageLocation = computed(() => documentLocationFromBuffer(activeBuffer.value));

const showMainPanelLocation = computed(() =>
  showsMainPanelDocumentLocation(settings.value.editor.documentLocation),
);

const pageTitle = computed(() => {
  const location = pageLocation.value;
  const folderOrApp = workspace.value ? workspaceName(workspace.value.path) : t("workspace.title");

  if (!showMainPanelLocation.value || !location) {
    return folderOrApp;
  }

  // Writing Focus: quiet document location when the destination is main-panel.
  if (writingFocusActive.value) {
    return location.label;
  }

  // Normal: show relative path only when it adds hierarchy beyond the tab basename.
  if (location.kind === "workspace" && location.full.includes("/")) {
    return location.label;
  }

  return folderOrApp;
});

const pageTitleHint = computed(() => {
  if (!showMainPanelLocation.value) {
    return undefined;
  }
  const location = pageLocation.value;
  if (!location) {
    return undefined;
  }
  if (writingFocusActive.value) {
    return location.full;
  }
  if (location.kind === "workspace" && location.full.includes("/")) {
    return location.full;
  }
  return undefined;
});

const showWritingFocusLocationChrome = computed(
  () => writingFocusActive.value && showMainPanelLocation.value && Boolean(pageLocation.value),
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
  return buffer?.rootPath && buffer.rootPath === workspace.value?.path ? workspaceNotes.value : [];
});

watch(
  [activeId, pendingReveal, monacoHostRef],
  async ([documentId, reveal]) => {
    if (!documentId || !reveal || reveal.documentId !== documentId) {
      return;
    }
    await nextTick();
    // Tab may have changed while we waited for layout.
    if (activeId.value !== documentId || !monacoHostRef.value) {
      return;
    }
    const position = consumePendingReveal(documentId);
    if (position) {
      monacoHostRef.value.revealPosition(position.lineNumber, position.column);
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

  // Virtual documents go through Save As (cancelable prompt owns trim timing).
  if (buffer.kind === "virtual") {
    await saveAsEditorDocument();
    return;
  }

  if (settings.value.editor.trimTrailingWhitespaceOnSave) {
    monacoHostRef.value?.trimTrailingWhitespace();
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
    closeSessionChangePreview();
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
    initialValue:
      buffer.kind === "virtual"
        ? suggestUntitledSaveBasename(buffer.model.getValue(), defaultExtension)
        : buffer.title,
  });
  if (requestedName === null) {
    return;
  }

  // Trim only after the user confirms a destination - cancel must not mutate.
  if (settings.value.editor.trimTrailingWhitespaceOnSave) {
    monacoHostRef.value?.trimTrailingWhitespace();
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
      closeSessionChangePreview();
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

function closeSessionChangePreview(): void {
  sessionChangePreview.value = null;
}

async function onSessionChangeMarkerClick(lineNumber: number): Promise<void> {
  if (!settings.value.editor.showSessionChanges) {
    return;
  }
  const buffer = activeBuffer.value;
  if (!buffer) {
    return;
  }
  const payload = await resolveSessionChangePreviewAtLine(buffer.model, lineNumber);
  if (!payload) {
    return;
  }
  if (sessionChangePreview.value?.hunkKey === payload.hunkKey) {
    closeSessionChangePreview();
    return;
  }
  sessionChangePreview.value = payload;
}

watch(
  () => settings.value.editor.showSessionChanges,
  (enabled) => {
    if (!enabled) {
      closeSessionChangePreview();
    }
    for (const buffer of openBuffers.value) {
      syncSessionChangeMarkerPresentation(buffer.model);
    }
  },
);

function onEditorContentChange(): void {
  closeSessionChangePreview();
  scheduleDocumentActivationRefresh();
}

/** Move keyboard focus out of Monaco to the editor chrome Writing Focus allows. */
function focusEditorChrome(): void {
  const target = writingFocusLeaveEditorTarget(openBuffers.value.length > 0);
  if (target === "monaco") {
    monacoHostRef.value?.focus();
    return;
  }
  if (target === "tabs") {
    editorTabsRef.value?.focusActiveTab();
    return;
  }
  const emptyAction = document.querySelector<HTMLElement>(".editor-empty-workspace button");
  if (isUsableFocusTarget(emptyAction)) {
    emptyAction.focus({ preventScroll: true });
    return;
  }
  const main = document.getElementById("main-content");
  if (isUsableFocusTarget(main)) {
    main.focus({ preventScroll: true });
  }
}

function leaveEditor(): void {
  if (sessionChangePreview.value) {
    closeSessionChangePreview();
    return;
  }
  focusEditorChrome();
}

function restoreEditorChromeFocus(): void {
  void nextTick(focusEditorChrome);
}

watch(writingFocusActive, (active) => {
  if (!active) {
    return;
  }
  const current = document.activeElement;
  if (writingFocusKeepsFocusTarget(current)) {
    return;
  }
  if (activeBuffer.value) {
    monacoHostRef.value?.focus();
    return;
  }
  restoreEditorChromeFocus();
});

function togglePreview(): void {
  patchSettings({
    preview: {
      ...settings.value.preview,
      enabled: !settings.value.preview.enabled,
    },
  });
}

function createNewDocument(): void {
  // Same command as File -> New -> New Document and Quick Actions.
  void executeCommand("newDocument");
}

function trimTrailingWhitespaceInEditor(): void {
  const changed = monacoHostRef.value?.trimTrailingWhitespace() ?? false;
  if (!changed) {
    notify(t("markdown.trimTrailingWhitespaceNone"));
  }
}

async function createDocumentFromSelection(): Promise<void> {
  const host = monacoHostRef.value;
  if (!host) {
    notify(t("markdown.selectionRequired"));
    return;
  }
  const selection = host.getSelectedText();
  if (!selection.trim()) {
    notify(t("markdown.selectionRequired"));
    return;
  }

  const buffer = activeBuffer.value;
  const sourcePath =
    buffer?.path && buffer.rootPath && buffer.rootPath === workspace.value?.path
      ? buffer.path
      : undefined;
  const sourceLabel = sourcePath
    ? workspaceNotes.value.find((note) => note.path === sourcePath)?.title || sourcePath
    : undefined;

  const content = buildDocumentFromSelection({
    selection,
    sourcePath,
    sourceLabel,
    linkMode: settings.value.links.linkMode,
  });

  try {
    closeRightSidebar();
    await openOrActivate({ kind: "virtual", content });
    await nextTick();
    monacoHostRef.value?.focus();
  } catch (error) {
    notifyFilesystemError(error, "workspace.openDocumentError", notify);
  }
}

function contentForWorkspaceDocument(path: string): string | null {
  const current = activeBuffer.value;
  if (current?.path === path) {
    return current.model.getValue();
  }
  const rootPath = workspace.value?.path;
  if (rootPath) {
    const live = getDocumentBuffer(rootPath, path);
    if (live) {
      return live.model.getValue();
    }
  }
  return workspaceNotes.value.find((note) => note.path === path)?.content ?? null;
}

async function insertDocumentLink(): Promise<void> {
  const host = monacoHostRef.value;
  if (!host) {
    return;
  }
  if (!workspace.value) {
    notify(t("markdown.insertLinkNeedsFolder"));
    return;
  }

  const path = await promptQuickOpen();
  if (!path) {
    return;
  }

  const note = workspaceNotes.value.find((candidate) => candidate.path === path);
  const content = contentForWorkspaceDocument(path);
  const headings = content ? parseMarkdownStructure(content).headings : [];
  let anchor: string | undefined;
  let label = note?.title || note?.name || path;

  if (headings.length > 0) {
    const picked = await promptPick({
      title: t("markdown.pickLinkTarget"),
      items: [
        { id: "", label: t("markdown.entireDocument"), detail: path },
        ...headings.map((heading) => ({
          id: heading.anchor,
          label: heading.text,
          detail: `#${heading.anchor}`,
        })),
      ],
    });
    if (picked === null) {
      return;
    }
    if (picked) {
      anchor = picked;
      const heading = headings.find((entry) => entry.anchor === picked);
      if (heading) {
        label = heading.text;
      }
    }
  }

  const sourcePath = activeBuffer.value?.path ?? "";
  const sameDocument = Boolean(sourcePath && sourcePath === path);
  const target =
    sameDocument && anchor ? "" : sourcePath ? relativeDocumentLinkPath(sourcePath, path) : path;

  const link = formatDocumentLink({
    label,
    target,
    anchor,
    linkMode: settings.value.links.linkMode,
  });
  host.insertTextAtCursor(link);
}

function insertTableOfContents(): void {
  const host = monacoHostRef.value;
  const buffer = activeBuffer.value;
  if (!host || !buffer) {
    return;
  }
  const headings = parseMarkdownStructure(buffer.model.getValue()).headings;
  const toc = buildMarkdownTableOfContents(headings, {
    linkMode: settings.value.links.linkMode,
  });
  if (!toc) {
    notify(t("markdown.tocEmpty"));
    return;
  }
  host.insertTextAtCursor(toc);
}

async function annotateAtLine(lineNumber: number, column: number): Promise<void> {
  const host = monacoHostRef.value;
  if (!host) {
    return;
  }
  const existing = host.findAnnotationAtLine(lineNumber);
  const entered = await promptText({
    title: existing ? t("documentAnnotations.editTitle") : t("documentAnnotations.addTitle"),
    label: t("documentAnnotations.textLabel"),
    initialValue: existing?.text ?? "",
    maxLength: DOCUMENT_ANNOTATION_TEXT_MAX,
  });
  if (!entered) {
    return;
  }
  const result = host.upsertAnnotationAtLine(
    lineNumber,
    existing?.position.column ?? column,
    entered,
  );
  if (!result) {
    return;
  }
  if (result.action === "capped") {
    notify(t("documentAnnotations.capped", { max: DOCUMENT_ANNOTATION_MAX }));
    return;
  }
  const line = result.annotation?.position.lineNumber ?? lineNumber;
  if (result.action === "updated") {
    notify(t("documentAnnotations.updated", { line }));
    return;
  }
  notify(t("documentAnnotations.added", { line }));
}

async function annotateAtCursor(): Promise<void> {
  const cursor = monacoHostRef.value?.currentCursorPosition() ?? { lineNumber: 1, column: 1 };
  await annotateAtLine(cursor.lineNumber, cursor.column);
}

function removeAnnotationAtCursor(): void {
  const host = monacoHostRef.value;
  if (!host) {
    return;
  }
  const cursor = host.currentCursorPosition();
  const removed = host.removeAnnotationAtLine(cursor.lineNumber);
  if (!removed) {
    notify(t("documentAnnotations.noneAtCursor"));
    return;
  }
  notify(t("documentAnnotations.removed", { line: removed.position.lineNumber }));
}

function goToNextDocumentAnnotation(): void {
  if (!(monacoHostRef.value?.goToNextDocumentAnnotation() ?? false)) {
    notify(t("documentAnnotations.none"));
  }
}

function goToPreviousDocumentAnnotation(): void {
  if (!(monacoHostRef.value?.goToPreviousDocumentAnnotation() ?? false)) {
    notify(t("documentAnnotations.none"));
  }
}

function clearDocumentAnnotationsInEditor(): void {
  const cleared = monacoHostRef.value?.clearDocumentAnnotations() ?? 0;
  if (cleared === 0) {
    notify(t("documentAnnotations.none"));
    return;
  }
  notify(t("documentAnnotations.cleared", { count: cleared }));
}

function runMonacoEditorAction(actionId: string): void {
  void monacoHostRef.value?.runMonacoAction(actionId);
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
  previewResizeCleanup = trackPointerDrag(
    previewStacked.value ? "row-resize" : "col-resize",
    (moveEvent) => {
      setPreviewRatio(
        vertical
          ? (bounds.bottom - moveEvent.clientY) / bounds.height
          : (bounds.right - moveEvent.clientX) / bounds.width,
      );
    },
  );
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

  if (!closeDocumentById(buffer.id, true)) {
    return;
  }

  if (wasActive) {
    const replacement = activeBuffer.value;
    if (replacement) {
      selectDocument(replacement.id);
    } else {
      clearFocusState();
    }
  }
  restoreEditorChromeFocus();
}

async function closeOtherDocuments(targetId?: string): Promise<void> {
  const target = targetId ? getDocumentBufferById(targetId) : activeBuffer.value;
  if (!target) {
    return;
  }
  const others = openBuffers.value.filter((buffer) => buffer.id !== target.id);
  if (others.length === 0) {
    return;
  }
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
  restoreEditorChromeFocus();
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
  restoreEditorChromeFocus();
}

const unregisterCommands = [
  registerCommandHandler("save", saveEditorDocument),
  registerCommandHandler("saveAs", saveAsEditorDocument),
  registerCommandHandler("exportHtml", exportEditorDocumentHtml),
  registerCommandHandler("closeDocument", () => void closeEditorDocument(activeId.value ?? "")),
  registerCommandHandler("closeOthers", () => void closeOtherDocuments()),
  registerCommandHandler("closeAll", () => void closeAllEditorDocuments()),
  registerCommandHandler("undo", () => monacoHostRef.value?.runEditorAction("undo")),
  registerCommandHandler("redo", () => monacoHostRef.value?.runEditorAction("redo")),
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
  registerCommandHandler("trimTrailingWhitespace", trimTrailingWhitespaceInEditor),
  registerCommandHandler("find", () => monacoHostRef.value?.find()),
  registerCommandHandler("replace", () => monacoHostRef.value?.replace()),
  registerCommandHandler("findReferences", () =>
    runMonacoEditorAction("editor.action.goToReferences"),
  ),
  registerCommandHandler("renameHeading", () => runMonacoEditorAction("editor.action.rename")),
  registerCommandHandler("insertDocumentLink", () => void insertDocumentLink()),
  registerCommandHandler("newDocumentFromSelection", () => void createDocumentFromSelection()),
  registerCommandHandler("insertTableOfContents", insertTableOfContents),
  registerCommandHandler("togglePreview", togglePreview),
  registerCommandHandler("annotateDocument", () => void annotateAtCursor()),
  registerCommandHandler("removeAnnotation", removeAnnotationAtCursor),
  registerCommandHandler("nextAnnotation", goToNextDocumentAnnotation),
  registerCommandHandler("previousAnnotation", goToPreviousDocumentAnnotation),
  registerCommandHandler("clearAnnotations", clearDocumentAnnotationsInEditor),
  ...MARKDOWN_COMMANDS.map((command) =>
    registerCommandHandler(command.id, () => {
      monacoHostRef.value?.runMarkdownAction(command.action);
    }),
  ),
];

onBeforeUnmount(() => {
  unregisterCommands.forEach((unregister) => unregister());
  editorCommandState.value = {
    canUndo: false,
    canRedo: false,
    hasAnnotationAtCursor: false,
  };
});

function closeMenu(): void {
  menuOpen.value = false;
  menuActions.value = [];
}

function openMenu(event: MouseEvent, actions: MenuAction[]): void {
  event.preventDefault();
  openMenuAt(event.clientX, event.clientY, actions);
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

function recentWorkspaceActions(path: string): MenuAction[] {
  return [
    {
      id: "open",
      label: t("actions.open"),
      run: () => selectRecentWorkspace(path),
    },
    {
      id: "reveal",
      label: t("menu.revealInFolder"),
      run: () => revealPath(path),
    },
    {
      id: "copy",
      label: t("menu.copyPath"),
      run: () => copyPath(path),
    },
  ];
}

function onRecentContextMenu(event: MouseEvent, path: string): void {
  (event.currentTarget as HTMLElement).focus();
  openMenu(event, recentWorkspaceActions(path));
}

function onRecentContextKeydown(event: KeyboardEvent, path: string): void {
  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) {
    return;
  }
  event.preventDefault();
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  openMenuAt(bounds.left, bounds.bottom, recentWorkspaceActions(path));
}

function onPreviewMediaChange(event: MediaQueryListEvent): void {
  previewStacked.value = event.matches;
}

/**
 * Always-on document packs: silent refresh when the active document identity
 * changes or the live Monaco model text changes.
 *
 * Monaco's alternativeVersionId is not Vue-reactive - do not watch it. Live
 * edits are observed via MonacoHost `contentChange` (onDidChangeModelContent).
 */
let documentActivationTimer: ReturnType<typeof setTimeout> | null = null;
let documentActivationGeneration = 0;

function scheduleDocumentActivationRefresh(): void {
  if (documentActivationTimer) {
    clearTimeout(documentActivationTimer);
  }
  const generation = ++documentActivationGeneration;
  documentActivationTimer = setTimeout(() => {
    documentActivationTimer = null;
    if (generation !== documentActivationGeneration) {
      return;
    }
    const commands = listDocumentActivationCommands();
    if (commands.length === 0 || !activeBuffer.value || !monacoHostRef.value) {
      return;
    }
    // Lua forbids reentrancy - run document packs strictly one at a time.
    void (async () => {
      for (const command of commands) {
        if (generation !== documentActivationGeneration) {
          return;
        }
        try {
          await runExtensionCommand(command.namespacedId, { silent: true });
        } catch (error: unknown) {
          // Isolation: one pack failure must not stop others or the editor.
          // A concurrent edit may reject as stale; the next contentChange
          // reschedules with a fresh live snapshot.
          const detail =
            error instanceof Error
              ? error.message
              : typeof error === "string"
                ? error
                : JSON.stringify(error);
          console.warn("Document activation failed:", command.namespacedId, detail);
        }
      }
    })();
  }, 180);
}

watch(
  () => activeBuffer.value?.id ?? null,
  () => {
    closeSessionChangePreview();
    scheduleDocumentActivationRefresh();
  },
  { flush: "post" },
);

// MonacoHost is async - ref is null until the chunk mounts. Discovery also
// arrives after App onMounted. Re-arm when either becomes ready.
watch(monacoHostRef, (host) => {
  if (host && activeBuffer.value) {
    scheduleDocumentActivationRefresh();
  }
});

watch(
  () => discoveredExtensions.value.loaded.length,
  () => {
    if (activeBuffer.value && monacoHostRef.value) {
      scheduleDocumentActivationRefresh();
    }
  },
);

onMounted(() => {
  registerEditorExtensionSeam({
    getApplyContext: () => {
      const host = monacoHostRef.value;
      const buffer = activeBuffer.value;
      if (!host || !buffer) {
        return null;
      }
      const context = host.getExtensionApplyContext();
      if (!context) {
        return null;
      }
      return {
        selection: context.selection,
        documentId: buffer.id,
        alternativeVersionId: context.alternativeVersionId,
        startOffset: context.startOffset,
        endOffset: context.endOffset,
      };
    },
    getDocumentContext: () => {
      const host = monacoHostRef.value;
      const buffer = activeBuffer.value;
      if (!host || !buffer) {
        return null;
      }
      const context = host.getExtensionDocumentContext();
      if (!context) {
        return null;
      }
      return {
        text: context.text,
        documentId: buffer.id,
        alternativeVersionId: context.alternativeVersionId,
        cursorLine: context.cursorLine,
        cursorColumn: context.cursorColumn,
      };
    },
    replaceSelection: (text) => monacoHostRef.value?.replacePrimarySelection(text) ?? false,
    reveal: (lineNumber, column) => {
      const host = monacoHostRef.value;
      if (!host) {
        return false;
      }
      host.revealPosition(lineNumber, column);
      return true;
    },
    setExtensionDecorations: (extensionId, ranges) =>
      monacoHostRef.value?.setExtensionDecorations(extensionId, ranges) ?? false,
    clearExtensionDecorations: (extensionId) =>
      monacoHostRef.value?.clearExtensionDecorations(extensionId) ?? false,
    hasActiveEditor: () => Boolean(monacoHostRef.value && activeBuffer.value),
  });
  previewMedia = window.matchMedia(NARROW_VIEWPORT_MEDIA_QUERY);
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
      scheduleDocumentActivationRefresh();
    });
  });
});

onBeforeUnmount(() => {
  if (documentActivationTimer) {
    clearTimeout(documentActivationTimer);
    documentActivationTimer = null;
  }
  documentActivationGeneration += 1;
  registerEditorExtensionSeam(null);
  previewResizeCleanup?.();
  previewResizeCleanup = null;
  previewMedia?.removeEventListener("change", onPreviewMediaChange);
  closeSessionChangePreview();
});
</script>

<template>
  <PageShell
    :title="
      writingFocusActive && !showWritingFocusLocationChrome
        ? (pageLocation?.full ?? pageTitle)
        : pageTitle
    "
    :title-hint="pageTitleHint"
    :embedded="writingFocusActive && !showWritingFocusLocationChrome"
    :writing-focus="writingFocusActive"
    :quiet-identity="showWritingFocusLocationChrome"
    fill
    rhythm="immediate"
  >
    <div class="editor-page" :class="{ 'editor-page--writing-focus': writingFocusActive }">
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

      <div v-else-if="!workspace && openBuffers.length === 0" class="editor-empty-workspace">
        <EmptyState
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
              <p class="editor-last-folder__path" :title="lastRecent.path">
                {{ lastRecent.path }}
              </p>
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

        <section
          v-if="otherRecents.length > 0"
          class="workspace-recents"
          :aria-label="t('workspace.recentWorkspaces')"
        >
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
                :title="item.path"
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
      </div>

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
          v-if="openBuffers.length > 0 && !writingFocusActive"
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
            :role="writingFocusActive ? undefined : 'tabpanel'"
            :aria-labelledby="writingFocusActive ? undefined : 'active-document-tab'"
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
              @quick-open="() => void executeCommand('openQuickOpen')"
              @escape="leaveEditor"
              @scroll="syncPreviewScroll"
              @command-state="onCommandState"
              @annotate-line="(lineNumber) => void annotateAtLine(lineNumber, 1)"
              @session-change-marker-click="
                (lineNumber) => void onSessionChangeMarkerClick(lineNumber)
              "
              @content-change="onEditorContentChange"
            />
            <SessionChangePreviewPanel
              v-if="sessionChangePreview"
              class="editor-page__session-change-preview"
              :payload="sessionChangePreview"
              @close="closeSessionChangePreview"
            />
            <p v-else-if="!activeBuffer" class="editor-page__empty-editor">
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

    <ContextMenu
      :open="menuOpen"
      :x="menuX"
      :y="menuY"
      :actions="menuActions"
      :label="t('workspace.recentFolderActions')"
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

.editor-page--writing-focus {
  gap: 0;
}

.editor-page__editor-shell {
  display: flex;
  flex-direction: column;
  gap: $space-related;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.editor-page--writing-focus .editor-page__editor-shell,
.editor-page--writing-focus .editor-page__document-split {
  gap: 0;
}

.editor-page--writing-focus .editor-page__editor {
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
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  gap: $space-related;
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

.editor-page__session-change-preview {
  flex: 0 0 auto;
}

.editor-page__empty-editor {
  margin: 0;
  color: $text-muted;
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

@media (max-width: $narrow-viewport-max) {
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

.editor-page :deep(.empty-state--reassure) {
  // Editor empty workspace is wider than the default EmptyState reassure column.
  max-width: none;
  padding-block: $space-compact 0;
}

.editor-page :deep(.empty-state--reassure .empty-state__detail),
.editor-page :deep(.empty-state--reassure .empty-state__action) {
  margin-top: $space-related;
}

.editor-empty-workspace {
  display: flex;
  flex-direction: column;
  gap: $space-section;
  max-width: 36rem;
  min-width: 0;
  min-height: 0;
  max-height: 100%;
  overflow: auto;
}

.editor-last-folder {
  display: flex;
  flex-direction: column;
  gap: $space-tight;
  min-width: 0;
}

.editor-last-folder__label {
  margin: 0;
  color: $text-muted;
  font-size: $font-caption;
  font-weight: 500;
}

.editor-last-folder__name {
  margin: 0;
  color: $text-primary;
  font-size: $font-lead;
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
  overflow-wrap: anywhere;
}

.workspace-recents {
  display: flex;
  flex-direction: column;
  gap: $space-related;
  padding-top: $space-compact;
  border-top: 1px solid $border-subtle;
  min-width: 0;
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
  overflow-wrap: anywhere;
}
</style>
