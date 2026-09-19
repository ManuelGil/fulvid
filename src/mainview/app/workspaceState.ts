/**
 * Workspace state - the open Folder and recent-folder history. The single owner
 * of workspace loading, including whether a finished scan found documents
 * Fulvid can edit.
 */
import { computed, ref, watch } from "vue";

import {
  bindFocusToWorkspace,
  currentFocus,
  focusDocument,
  isFocusValidForWorkspace,
} from "../modules/workspace/focus/focusState";
import {
  attachDocumentBuffer,
  activeBuffer,
  detachDocumentBuffer,
  invalidatePendingWorkspaceOpens,
  openBuffers,
  openOrActivate,
} from "../modules/editor/document/documentBuffers";
import {
  copyPathToClipboard,
  authorizeWorkspacePath,
  describeFilesystemError,
  pickWorkspacePath,
  revealInExplorer,
  scanWorkspace,
} from "../modules/workspace/filesystem/workspaceScanner";
import { parseFilesystemErrorCode } from "../modules/workspace/filesystem/workspaceErrors";
import type {
  GrantedDocumentSnapshot,
  ScannedNote,
  WorkspaceScan,
} from "../modules/workspace/filesystem/workspaceTypes";
import { folderDocumentPreflight, shouldLoadFolderWorkspace } from "./folderPreflight";
import { settings } from "../modules/settings/settingsStore";
import { notify } from "./notify";
import { closeRightSidebar } from "./layoutStore";
import { i18n } from "../i18n";
import { confirmDialog } from "./dialogs";

/** Abandoned Context-root preference; Folder (workspace) is the only scope. */
try {
  localStorage.removeItem("fulvid.contextRoots");
} catch {
  // Ignore quota / private-mode failures; absence is the desired state.
}

export function workspaceName(path: string): string {
  const parts = path.replace(/[/\\]+$/, "").split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

/** Join a workspace-relative path into an absolute filesystem path. */
export function absolutePath(root: string, relative = ""): string {
  if (!relative) {
    return root;
  }

  const cleanedRoot = root.replace(/[/\\]+$/, "");
  return `${cleanedRoot}/${relative.replace(/\\/g, "/")}`;
}

// --- Recent workspaces (localStorage) ---

export interface RecentWorkspace {
  path: string;
  name: string;
  openedAt: string;
}

const RECENT_STORAGE_KEY = "fulvid.recentWorkspaces";
const MAX_RECENT = 10;

/** Recents are convenience data, never trusted paths to send back to the host. */
function isRecentWorkspace(value: unknown): value is RecentWorkspace {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.path === "string" &&
    candidate.path.length > 0 &&
    typeof candidate.name === "string" &&
    typeof candidate.openedAt === "string"
  );
}

function readRecent(): RecentWorkspace[] {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecentWorkspace).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function writeRecent(workspaces: RecentWorkspace[]): void {
  localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(workspaces));
}

function addRecentWorkspace(path: string): RecentWorkspace[] {
  const entry: RecentWorkspace = {
    path,
    name: workspaceName(path),
    openedAt: new Date().toISOString(),
  };

  const filtered = readRecent().filter((item) => item.path !== path);
  const updated = [entry, ...filtered].slice(0, MAX_RECENT);
  writeRecent(updated);
  return updated;
}

export function clearRecentWorkspaces(): void {
  writeRecent([]);
  recentWorkspaces.value = [];
}

// --- Workspace state ---

export const workspace = ref<WorkspaceScan | null>(null);
export const isLoading = ref(false);
/** Activity label while a load/refresh is in flight. */
export const loadingStatus = ref<string | null>(null);
export const errorMessage = ref<string | null>(null);
export const recentWorkspaces = ref<RecentWorkspace[]>(readRecent());
let workspaceRequestGeneration = 0;

function isStaleWorkspaceRequest(requestGeneration: number): boolean {
  return requestGeneration !== workspaceRequestGeneration;
}

function finishWorkspaceRequestIfCurrent(requestGeneration: number): void {
  if (isStaleWorkspaceRequest(requestGeneration)) {
    return;
  }
  loadingStatus.value = null;
  isLoading.value = false;
}

function absolutePathSegments(path: string): {
  absolute: boolean;
  segments: string[];
} {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  return {
    absolute: /^\//.test(normalized) || /^[A-Za-z]:\//.test(normalized),
    segments: normalized.split("/").filter(Boolean),
  };
}

export function relativeDocumentPath(rootPath: string, absolutePath: string | null): string | null {
  if (!absolutePath) {
    return null;
  }
  const root = absolutePathSegments(rootPath);
  const target = absolutePathSegments(absolutePath);
  if (root.absolute !== target.absolute || root.segments.length > target.segments.length) {
    return null;
  }
  if (root.segments.every((segment, index) => segment === target.segments[index])) {
    return target.segments.slice(root.segments.length).join("/");
  }
  return null;
}

/**
 * Open a document the host granted (Open dialog or external open). Inside the
 * open Folder it attaches there, so it behaves like any folder document.
 */
export async function openGrantedSnapshot(snapshot: GrantedDocumentSnapshot): Promise<void> {
  const rootPath = workspace.value?.path ?? null;
  const path = rootPath ? relativeDocumentPath(rootPath, snapshot.absolutePath) : null;
  await openOrActivate({
    kind: "granted",
    snapshot,
    ...(rootPath && path ? { attachment: { rootPath, path } } : {}),
  });
}

async function detachWorkspaceBuffers(rootPath: string): Promise<void> {
  for (const buffer of [...openBuffers.value]) {
    if (buffer.rootPath === rootPath) {
      await detachDocumentBuffer(buffer);
    }
  }
}

function attachBuffersToWorkspace(rootPath: string): void {
  for (const buffer of openBuffers.value) {
    if (buffer.rootPath || buffer.kind !== "persisted") {
      continue;
    }
    const relativePath = relativeDocumentPath(rootPath, buffer.absolutePath);
    if (relativePath) {
      attachDocumentBuffer(buffer, rootPath, relativePath);
    }
  }
}

async function readWorkspaceFromDisk(path: string): Promise<WorkspaceScan> {
  const includeHidden = settings.value.workspace.showHiddenFiles;

  loadingStatus.value = i18n.global.t("workspace.loadingDocuments");
  const scan = await scanWorkspace(path, includeHidden, settings.value.links.linkMode);
  if (scan.scannedNotes.length === 0) {
    // A partial walk cannot claim the folder has no documents.
    loadingStatus.value = i18n.global.t(
      scan.truncated || scan.skipped ? "workspace.looking" : "workspace.noDocuments",
    );
  } else {
    loadingStatus.value = i18n.global.t(
      scan.scannedNotes.length === 1 ? "workspace.openingOne" : "workspace.openingMany",
      {
        count: scan.scannedNotes.length.toLocaleString(i18n.global.locale.value),
      },
    );
  }
  return scan;
}

/**
 * A folder larger than one scan can load is shown as far as it went, and said
 * out loud: a partial folder that looks complete is how references and Search
 * quietly start lying.
 */
function notifyPartialScan(scan: WorkspaceScan): void {
  if (scan.truncated) {
    notify(
      i18n.global.t("workspace.partialScan", {
        count: scan.scannedNotes.length.toLocaleString(i18n.global.locale.value),
      }),
    );
  }
  if (scan.skipped) {
    // Unreadable or vanished entries no longer fail the whole folder, so the
    // count has to be said out loud instead.
    notify(
      i18n.global.t("workspace.skippedEntries", {
        count: scan.skipped.toLocaleString(i18n.global.locale.value),
      }),
    );
  }
}

export const workspaceNotes = computed(() => workspace.value?.scannedNotes ?? []);

export function applyScannedNote(note: ScannedNote): void {
  const scannedNotes = workspace.value?.scannedNotes;
  if (!scannedNotes) {
    return;
  }

  const index = scannedNotes.findIndex((existingNote) => existingNote.path === note.path);
  if (index === -1) {
    scannedNotes.push(note);
    return;
  }

  scannedNotes.splice(index, 1, note);
}

export function applyRenamedNote(previousPath: string, note: ScannedNote): void {
  const scannedNotes = workspace.value?.scannedNotes;
  if (!scannedNotes) {
    return;
  }

  const previousIndex = scannedNotes.findIndex(
    (existingNote) => existingNote.path === previousPath,
  );
  if (previousIndex === -1) {
    applyScannedNote(note);
    return;
  }

  scannedNotes.splice(previousIndex, 1, note);
}

/**
 * The current focus, valid only when it belongs to the open Folder.
 * Shared by every surface that renders the focus.
 */
export const validatedFocus = computed(() => {
  const workspacePath = workspace.value?.path ?? null;
  if (!isFocusValidForWorkspace(currentFocus.value, workspacePath)) {
    return null;
  }
  return currentFocus.value;
});

async function loadWorkspace(path: string): Promise<void> {
  const requestGeneration = ++workspaceRequestGeneration;
  invalidatePendingWorkspaceOpens();
  isLoading.value = true;
  errorMessage.value = null;
  loadingStatus.value = i18n.global.t("workspace.loadingDocuments");

  try {
    const scan = await readWorkspaceFromDisk(path);
    if (isStaleWorkspaceRequest(requestGeneration)) {
      return;
    }
    if (!shouldLoadFolderWorkspace(folderDocumentPreflight(scan))) {
      errorMessage.value = i18n.global.t("workspace.noCompatibleDocuments");
      return;
    }
    const previousWorkspacePath = workspace.value?.path ?? null;
    if (previousWorkspacePath && previousWorkspacePath !== path) {
      await detachWorkspaceBuffers(previousWorkspacePath);
    }
    if (isStaleWorkspaceRequest(requestGeneration)) {
      return;
    }
    workspace.value = scan;
    notifyPartialScan(scan);
    attachBuffersToWorkspace(path);
    recentWorkspaces.value = addRecentWorkspace(path);
    bindFocusToWorkspace(path);
    if (activeBuffer.value?.rootPath === path && activeBuffer.value.path) {
      focusDocument(activeBuffer.value.path);
    }
  } catch (error) {
    if (isStaleWorkspaceRequest(requestGeneration)) {
      return;
    }
    errorMessage.value = describeFilesystemError(error, "workspace.readWorkspaceError");
  } finally {
    finishWorkspaceRequestIfCurrent(requestGeneration);
  }
}

export async function openWorkspace(): Promise<void> {
  errorMessage.value = null;

  let path: string | null;
  try {
    path = await pickWorkspacePath();
  } catch (error) {
    errorMessage.value = describeFilesystemError(error, "workspace.openWorkspaceError");
    return;
  }

  if (!path) {
    return;
  }

  await loadWorkspace(path);
}

export async function selectRecentWorkspace(path: string): Promise<void> {
  try {
    const authorizedPath = await authorizeWorkspacePath(path);
    if (authorizedPath) {
      await loadWorkspace(authorizedPath);
    }
  } catch (error) {
    // Host refused a recent path that is not in approved-folders (renderer
    // recent is not authority). Say that plainly - the generic folderNotOpen
    // copy reads like a no-op when the person just clicked Reopen.
    errorMessage.value =
      parseFilesystemErrorCode(error) === "folderNotOpen"
        ? i18n.global.t("workspace.reopenUnauthorized")
        : describeFilesystemError(error, "workspace.openWorkspaceError");
  }
}

/**
 * Close the open workspace while leaving the document session intact.
 * Clears workspace context, focus, inspector, and Explorer selection state.
 */
export async function closeWorkspace(): Promise<void> {
  if (!workspace.value) {
    if (isLoading.value) {
      workspaceRequestGeneration += 1;
      invalidatePendingWorkspaceOpens();
      isLoading.value = false;
      loadingStatus.value = null;
      errorMessage.value = null;
    }
    return;
  }

  if (settings.value.workspace.confirmClose) {
    if (!(await confirmDialog(i18n.global.t("workspace.closeWorkspaceConfirm")))) {
      return;
    }
  }

  const requestGeneration = ++workspaceRequestGeneration;
  invalidatePendingWorkspaceOpens();
  const closingPath = workspace.value.path;
  try {
    await detachWorkspaceBuffers(closingPath);
  } catch (error) {
    if (isStaleWorkspaceRequest(requestGeneration)) {
      return;
    }
    errorMessage.value = describeFilesystemError(error, "workspace.closeWorkspaceError");
    isLoading.value = false;
    loadingStatus.value = null;
    return;
  }
  if (isStaleWorkspaceRequest(requestGeneration)) {
    return;
  }
  workspace.value = null;
  errorMessage.value = null;
  isLoading.value = false;
  loadingStatus.value = null;
  bindFocusToWorkspace(null);
  closeRightSidebar();
  notify(i18n.global.t("workspace.closed"));
}

/** Re-scan the open workspace from disk (same path, current preferences). */
export async function refreshWorkspace(options: { silent?: boolean } = {}): Promise<void> {
  const path = workspace.value?.path;
  if (!path || isLoading.value) {
    return;
  }

  const requestGeneration = ++workspaceRequestGeneration;
  isLoading.value = true;
  errorMessage.value = null;
  loadingStatus.value = i18n.global.t("workspace.loadingDocuments");

  try {
    const scan = await readWorkspaceFromDisk(path);
    if (isStaleWorkspaceRequest(requestGeneration)) {
      return;
    }
    workspace.value = scan;
    notifyPartialScan(scan);
    attachBuffersToWorkspace(path);
    bindFocusToWorkspace(path);
    if (!options.silent) {
      notify(i18n.global.t("workspace.refreshed"));
    }
  } catch (error) {
    if (isStaleWorkspaceRequest(requestGeneration)) {
      return;
    }
    errorMessage.value = describeFilesystemError(error, "workspace.refreshWorkspaceError");
  } finally {
    finishWorkspaceRequestIfCurrent(requestGeneration);
  }
}

/** Reopen the most recent workspace path, if any. */
export async function reopenLastWorkspace(): Promise<void> {
  const last = recentWorkspaces.value[0];
  if (!last) {
    return;
  }

  await selectRecentWorkspace(last.path);
}

/** Called once at app start when the workspace startup mode is "last". */
export function bootstrapWorkspace(): void {
  if (settings.value.workspace.workspaceStartup !== "last") {
    return;
  }

  const last = recentWorkspaces.value[0];
  if (!last) {
    return;
  }

  void selectRecentWorkspace(last.path);
}

export async function revealWorkspaceInExplorer(relativePath = ""): Promise<void> {
  const root = workspace.value?.path;
  if (!root) {
    return;
  }

  await revealInExplorer(absolutePath(root, relativePath));
}

export async function copyWorkspacePath(relativePath = ""): Promise<void> {
  const root = workspace.value?.path;
  if (!root) {
    return;
  }

  await copyPathToClipboard(absolutePath(root, relativePath));
  notify(i18n.global.t("workspace.copied"));
}

export async function revealPath(path: string): Promise<void> {
  await revealInExplorer(path);
}

export async function copyPath(path: string): Promise<void> {
  await copyPathToClipboard(path);
  notify(i18n.global.t("workspace.copied"));
}

// Re-scan when the hidden-files preference changes while a workspace is open.
watch(
  () => settings.value.workspace.showHiddenFiles,
  (enabled, wasEnabled) => {
    if (wasEnabled === undefined) {
      return;
    }

    notify(i18n.global.t(enabled ? "workspace.hiddenEnabled" : "workspace.hiddenDisabled"));

    if (workspace.value) {
      void refreshWorkspace({ silent: true });
    }
  },
);

watch(
  () => settings.value.links.linkMode,
  (linkMode, previousLinkMode) => {
    if (linkMode === previousLinkMode || !workspace.value) {
      return;
    }
    void refreshWorkspace({ silent: true });
  },
);
