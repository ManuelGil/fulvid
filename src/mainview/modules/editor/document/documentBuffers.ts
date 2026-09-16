/**
 * Monaco text models for every open document tab.
 *
 * Attachment shapes:
 * - workspace file: `rootPath` + relative `path`
 * - granted standalone: `grantToken` + `absolutePath` from Open/Save As
 * - virtual untitled: no path until Save As
 *
 * `selectDocument` is the UI and buffer-lifecycle seam: it pairs `activeId`
 * with Focus. `activateDocument` only moves session selection.
 */
import { computed, ref, shallowRef, type Ref } from "vue";
import type * as monaco from "monaco-editor/editor";

import { initializeMonaco, languageForPath } from "../monaco/monacoSetup";
import {
  clearFocusState,
  clearFocusForDocument,
  focusDocument,
} from "../../workspace/focus/focusState";
import { i18n } from "../../../i18n";
import { settings } from "../../settings/settingsStore";
import {
  activateDocument,
  activeId,
  clearActiveDocument,
  clearSessionDocuments,
  nextUntitledId,
  pendingReveal,
  registerDocument,
  replaceDocumentId,
  unregisterDocument,
  type DocumentId,
  type DocumentKind,
  type DocumentRevealPosition,
} from "./documentSession";
import {
  grantDetachedWorkspaceDocument,
  pickAndSaveDocument,
  readDocument,
  writeDocument,
  writeGrantedDocument,
} from "../../workspace/filesystem/workspaceScanner";
import {
  LocalizedError,
  parseFilesystemErrorCode,
  SupersededOpenError,
} from "../../workspace/filesystem/workspaceErrors";
import type {
  DocumentWriteResult,
  GrantedDocumentSnapshot,
  GrantedDocumentWriteResult,
  SaveAsResult,
} from "../../workspace/filesystem/workspaceTypes";

type MonacoModel = monaco.editor.ITextModel;
type MonacoEndOfLineSequence = monaco.editor.EndOfLineSequence;

function contentHasLineBreak(content: string): boolean {
  return content.includes("\n") || content.includes("\r");
}

function configuredDefaultEol(api: typeof monaco): MonacoEndOfLineSequence {
  return settings.value.editor.defaultEol === "crlf"
    ? api.editor.EndOfLineSequence.CRLF
    : api.editor.EndOfLineSequence.LF;
}

/** Silent: does not dirty the buffer. Used when creating a model, not for user toggles. */
function setModelEol(model: MonacoModel, eol: MonacoEndOfLineSequence): void {
  if (model.getEndOfLineSequence() !== eol) {
    model.setEOL(eol);
  }
}

function applyConfiguredDefaultEol(model: MonacoModel): void {
  setModelEol(model, configuredDefaultEol(initializeMonaco()));
}

/** Keep the live model's EOL when recreating a model (Save As / rename). */
function preserveModelEol(model: MonacoModel, previous: MonacoEndOfLineSequence): void {
  setModelEol(model, previous);
}

/**
 * Toggle LF and CRLF on the live model. Undoable, marks dirty, writes only on Save.
 */
export function cycleDocumentEol(buffer: DocumentBuffer): void {
  const api = initializeMonaco();
  const next =
    buffer.model.getEndOfLineSequence() === api.editor.EndOfLineSequence.LF
      ? api.editor.EndOfLineSequence.CRLF
      : api.editor.EndOfLineSequence.LF;
  buffer.model.pushEOL(next);
}

/**
 * One open editor tab and its Monaco model.
 *
 * Persisted identity is `absolutePath` (`id` is `file:${absolutePath}`).
 * Virtual documents use `untitled:N` until Save As. The model is the text
 * source of truth. `savedVersionId` is the last written
 * `alternativeVersionId`, or `-1` to force dirty (seeded untitled, Save As
 * race, rename while dirty) until a successful write aligns the ids.
 * `rootPath`+`path` attach the buffer to a folder; `grantToken` on a
 * persisted buffer is orthogonal and means later saves use the standalone
 * grant instead of folder RPC.
 */
export interface DocumentBuffer {
  id: DocumentId;
  kind: DocumentKind;
  absolutePath: string | null;
  rootPath: string | null;
  path: string | null;
  grantToken: string | null;
  title: string;
  model: MonacoModel;
  savedVersionId: number;
  mtimeMs: number;
  /** Vue signal for consumers whose source of truth is the Monaco model. */
  changeVersion: Ref<number>;
  contentDisposable: monaco.IDisposable;
}

const buffers = shallowRef<DocumentBuffer[]>([]);
const pendingOpens = new Map<string, Promise<DocumentBuffer>>();
const saveQueues = new WeakMap<DocumentBuffer, Promise<unknown>>();
/** Buffers closed while a write may still be queued - skip starting new disk writes. */
const abandonedWrites = new WeakSet<DocumentBuffer>();
let openGeneration = 0;
let activationGeneration = 0;

function isAbandonedBuffer(buffer: DocumentBuffer): boolean {
  return abandonedWrites.has(buffer) || !buffers.value.includes(buffer);
}

/**
 * Wait until every write already queued for this buffer has settled.
 *
 * In-flight RPCs still complete against the path/content they captured when
 * they started. Callers that rename, delete, detach, or quit must drain first
 * so a late write cannot recreate a path the filesystem no longer owns.
 */
export async function awaitBufferWrites(buffer: DocumentBuffer): Promise<void> {
  const pending = saveQueues.get(buffer);
  if (pending) {
    await pending;
  }
}

/** Drain every open buffer's save queue before quit or workspace teardown. */
export async function awaitAllBufferWrites(): Promise<void> {
  await Promise.all(buffers.value.map((buffer) => awaitBufferWrites(buffer)));
}

export const openBuffers = computed(() => buffers.value);

export const activeBuffer = computed(() => {
  if (!activeId.value) {
    return null;
  }

  return buffers.value.find((buffer) => buffer.id === activeId.value) ?? null;
});

function bufferKey(rootPath: string, path: string): string {
  return `${rootPath.replace(/\\/g, "/")}\0${path.replace(/\\/g, "/")}`;
}

function workspaceAbsolutePath(rootPath: string, path: string): string {
  return `${rootPath.replace(/[\\/]+$/, "")}/${path.replace(/\\/g, "/")}`;
}

function normalizeAbsolutePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function documentTitle(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

async function createBuffer(
  rootPath: string,
  path: string,
  generation: number,
): Promise<DocumentBuffer> {
  const snapshot = await readDocument(rootPath, path);
  if (generation !== openGeneration) {
    throw new SupersededOpenError();
  }
  const existing = getDocumentBufferByAbsolutePath(snapshot.absolutePath);
  if (existing) {
    return attachDocumentBuffer(existing, rootPath, path);
  }
  const buffer = createPersistedBuffer({
    absolutePath: snapshot.absolutePath ?? workspaceAbsolutePath(rootPath, path),
    content: snapshot.content,
    mtimeMs: snapshot.mtimeMs,
    rootPath,
    path,
    grantToken: null,
  });
  buffers.value = [...buffers.value, buffer];
  registerDocument(buffer.id);
  return buffer;
}

function createPersistedBuffer(options: {
  absolutePath: string;
  content: string;
  mtimeMs: number;
  rootPath: string | null;
  path: string | null;
  grantToken: string | null;
}): DocumentBuffer {
  const api = initializeMonaco();
  const modelPath = options.path ?? options.absolutePath;
  const model = api.editor.createModel(
    options.content,
    languageForPath(modelPath),
    api.Uri.file(options.absolutePath),
  );
  if (!contentHasLineBreak(options.content)) {
    applyConfiguredDefaultEol(model);
  }
  const changeVersion = ref(0);
  const buffer: DocumentBuffer = {
    id: `file:${options.absolutePath}`,
    kind: "persisted",
    absolutePath: options.absolutePath,
    rootPath: options.rootPath,
    path: options.path,
    grantToken: options.grantToken,
    title: documentTitle(options.path ?? options.absolutePath),
    model,
    savedVersionId: model.getAlternativeVersionId(),
    mtimeMs: options.mtimeMs,
    changeVersion,
    contentDisposable: model.onDidChangeContent(() => {
      changeVersion.value += 1;
    }),
  };

  return buffer;
}

/**
 * Create a virtual `untitled:N` buffer. It has no path until Save As; closing
 * it discards the text unless the caller saved first.
 */
export function createUntitledDocument(content = ""): DocumentBuffer {
  const api = initializeMonaco();
  const id = nextUntitledId();
  const model = api.editor.createModel(content, languageForPath("untitled.mdx"), api.Uri.parse(id));
  applyConfiguredDefaultEol(model);
  const changeVersion = ref(0);
  const buffer: DocumentBuffer = {
    id,
    kind: "virtual",
    absolutePath: null,
    rootPath: null,
    path: null,
    grantToken: null,
    title: i18n.global.t("tabs.untitled"),
    model,
    savedVersionId: content ? -1 : model.getAlternativeVersionId(),
    mtimeMs: 0,
    changeVersion,
    contentDisposable: model.onDidChangeContent(() => {
      changeVersion.value += 1;
    }),
  };
  buffers.value = [...buffers.value, buffer];
  registerDocument(buffer.id);
  selectDocument(buffer.id);
  return buffer;
}

export function ensureUntitledDocument(): DocumentBuffer | null {
  if (buffers.value.length > 0) {
    return activeBuffer.value;
  }
  return createUntitledDocument();
}

/**
 * User-facing tab selection: session `activeId` plus Focus for in-folder docs.
 *
 * Virtual and standalone tabs clear Focus so Graph and Context do not keep a
 * stale folder target. Tabs, Graph, Search, shortcuts, and buffer open/save
 * paths use this. `activateDocument` remains session-only.
 */
export function selectDocument(id: DocumentId): boolean {
  const buffer = getDocumentBufferById(id);
  if (!buffer) {
    return false;
  }
  activateDocument(buffer.id);
  if (buffer.rootPath && buffer.path) {
    focusDocument(buffer.path);
  } else {
    clearFocusState();
  }
  return true;
}

/**
 * How a surface asks the shared lifecycle to show a document.
 *
 * `virtual` is an untitled buffer (`untitled:N`) that does not exist on disk.
 * `workspace` is a folder-relative path whose identity becomes the absolute
 * file path after read. `granted` is a standalone Open/Save As snapshot whose
 * later writes use the grant token, not a folder-relative RPC.
 */
export type DocumentOpenRequest =
  | ({ kind: "virtual" } & { reveal?: DocumentRevealPosition; content?: string })
  | {
      kind: "workspace";
      rootPath: string;
      path: string;
      reveal?: DocumentRevealPosition;
    }
  | {
      kind: "granted";
      snapshot: GrantedDocumentSnapshot;
      attachment?: { rootPath: string; path: string };
      reveal?: DocumentRevealPosition;
    };

/**
 * Single entry for opening or focusing a document tab.
 *
 * Explorer, Search, links, Graph, and Document Context all converge here so
 * there is one buffer table and one `activeId`. Opening then calls
 * `selectDocument` so Focus stays paired. Lives with the buffers because it
 * dispatches to create/open; `documentSession` only tracks identity.
 */
export async function openOrActivate(request: DocumentOpenRequest): Promise<DocumentBuffer> {
  let buffer: DocumentBuffer;
  if (request.kind === "virtual") {
    buffer = createUntitledDocument(request.content);
  } else if (request.kind === "workspace") {
    buffer = await openDocument(request.rootPath, request.path);
  } else {
    buffer = openGrantedDocument(request.snapshot, request.attachment);
  }
  // Only queue a reveal when this buffer still owns the editor. A superseded
  // open must not overwrite a newer navigation's pendingReveal.
  if (request.reveal && activeId.value === buffer.id) {
    pendingReveal.value = {
      documentId: buffer.id,
      ...request.reveal,
    };
  }
  return buffer;
}

export function invalidatePendingWorkspaceOpens(): void {
  openGeneration += 1;
  activationGeneration += 1;
  pendingOpens.clear();
}

export function getDocumentBuffer(rootPath: string, path: string): DocumentBuffer | null {
  return (
    buffers.value.find(
      (buffer) =>
        buffer.rootPath === rootPath && buffer.path === path && buffer.kind === "persisted",
    ) ?? null
  );
}

export function getDocumentBufferById(id: DocumentId): DocumentBuffer | null {
  return buffers.value.find((buffer) => buffer.id === id) ?? null;
}

export function getDocumentBufferByAbsolutePath(absolutePath: string): DocumentBuffer | null {
  const normalizedPath = normalizeAbsolutePath(absolutePath);
  return (
    buffers.value.find(
      (buffer) =>
        buffer.kind === "persisted" &&
        buffer.absolutePath !== null &&
        normalizeAbsolutePath(buffer.absolutePath) === normalizedPath,
    ) ?? null
  );
}

/**
 * Open a dialog-granted snapshot, or attach it to a folder if the path is
 * already inside the current workspace. Reuses the existing buffer when the
 * absolute path is already open so Open File cannot duplicate a tab.
 */
export function openGrantedDocument(
  snapshot: GrantedDocumentSnapshot,
  attachment?: { rootPath: string; path: string },
): DocumentBuffer {
  const existing = getDocumentBufferByAbsolutePath(snapshot.absolutePath);
  if (existing) {
    const attached = attachment
      ? attachDocumentBuffer(existing, attachment.rootPath, attachment.path)
      : existing;
    if (!attachment) {
      existing.grantToken = snapshot.grantToken;
    }
    selectDocument(attached.id);
    return attached;
  }
  const buffer = createPersistedBuffer({
    absolutePath: snapshot.absolutePath,
    content: snapshot.content,
    mtimeMs: snapshot.mtimeMs,
    rootPath: attachment?.rootPath ?? null,
    path: attachment?.path ?? null,
    grantToken: attachment ? null : snapshot.grantToken,
  });
  buffers.value = [...buffers.value, buffer];
  registerDocument(buffer.id);
  selectDocument(buffer.id);
  return buffer;
}

/**
 * Open a folder document through the shared buffer table.
 *
 * Reuses an existing buffer for the same absolute path instead of creating a
 * second model. Concurrent opens of the same relative path share one in-flight
 * read so a fast double-click cannot duplicate the tab.
 */
export function openDocument(rootPath: string, path: string): Promise<DocumentBuffer> {
  const requestGeneration = ++activationGeneration;
  const activateIfCurrent = (buffer: DocumentBuffer): DocumentBuffer => {
    if (requestGeneration === activationGeneration) {
      selectDocument(buffer.id);
    }
    return buffer;
  };
  const existing = getDocumentBuffer(rootPath, path);
  if (existing) {
    return Promise.resolve(activateIfCurrent(existing));
  }
  const detached = getDocumentBufferByAbsolutePath(workspaceAbsolutePath(rootPath, path));
  if (detached) {
    const attached = attachDocumentBuffer(detached, rootPath, path);
    return Promise.resolve(activateIfCurrent(attached));
  }

  const key = bufferKey(rootPath, path);
  const pending = pendingOpens.get(key);
  if (pending) {
    return pending.then(activateIfCurrent);
  }

  const generation = openGeneration;
  const opening = createBuffer(rootPath, path, generation)
    .then(activateIfCurrent)
    .finally(() => {
      if (pendingOpens.get(key) === opening) {
        pendingOpens.delete(key);
      }
    });
  pendingOpens.set(key, opening);
  return opening;
}

/**
 * Dirty means the Monaco alternativeVersionId moved since the last successful
 * write. `changeVersion` is only a Vue invalidation signal; it is not the
 * dirty bit.
 */
export function isDocumentDirty(buffer: DocumentBuffer): boolean {
  void buffer.changeVersion.value;
  return buffer.model.getAlternativeVersionId() !== buffer.savedVersionId;
}

async function saveDocumentNow(
  buffer: DocumentBuffer,
): Promise<DocumentWriteResult | GrantedDocumentWriteResult> {
  if (isAbandonedBuffer(buffer)) {
    throw new LocalizedError(i18n.global.t("workspace.saveError"));
  }
  const versionWritten = buffer.model.getAlternativeVersionId();
  const contentToWrite = buffer.model.getValue();
  let writeOutcome: DocumentWriteResult | GrantedDocumentWriteResult;
  if (buffer.rootPath && buffer.path) {
    writeOutcome = await writeDocument(
      buffer.rootPath,
      buffer.path,
      contentToWrite,
      buffer.mtimeMs,
      settings.value.links.linkMode,
    );
  } else if (buffer.grantToken && buffer.absolutePath) {
    writeOutcome = await writeGrantedDocument(buffer.grantToken, contentToWrite, buffer.mtimeMs);
  } else {
    throw new LocalizedError(i18n.global.t("workspace.needsSaveAs"));
  }
  // Closed while the write was in flight: disk may already have the bytes;
  // do not touch a disposed buffer.
  if (isAbandonedBuffer(buffer)) {
    return writeOutcome;
  }
  // If the user typed while the write was in flight, the newer model version
  // remains dirty and will be saved by the next command.
  buffer.savedVersionId = versionWritten;
  buffer.mtimeMs = writeOutcome.mtimeMs;
  if ("absolutePath" in writeOutcome) {
    buffer.absolutePath = writeOutcome.absolutePath;
  }
  buffer.changeVersion.value += 1;
  return writeOutcome;
}

/**
 * Run a write against one buffer after every write already queued for it.
 *
 * Save and Save As both mutate the same identity (path, grant, saved version),
 * so they share a queue: two writes must never interleave and leave the buffer
 * describing a file it did not produce.
 */
function queueBufferWrite<Result>(
  buffer: DocumentBuffer,
  write: () => Promise<Result>,
): Promise<Result> {
  const previous = saveQueues.get(buffer) ?? Promise.resolve();
  const current = previous.then(() => {
    if (abandonedWrites.has(buffer)) {
      return Promise.reject(new LocalizedError(i18n.global.t("workspace.saveError")));
    }
    return write();
  });
  saveQueues.set(
    buffer,
    current.then(
      () => undefined,
      () => undefined,
    ),
  );
  return current;
}

/**
 * Write the buffer through the per-buffer save queue.
 *
 * Workspace documents use folder RPC; standalone granted documents use the
 * grant. Virtual documents cannot save here - they must Save As so they gain
 * an absolute path and identity.
 */
export function saveDocument(
  buffer: DocumentBuffer,
): Promise<DocumentWriteResult | GrantedDocumentWriteResult> {
  return queueBufferWrite(buffer, () => saveDocumentNow(buffer));
}

function reidentifyAsPersisted(
  buffer: DocumentBuffer,
  absolutePath: string,
  mtimeMs: number,
  grantToken: string,
  versionWritten: number | null,
): DocumentBuffer {
  const existing = getDocumentBufferByAbsolutePath(absolutePath);
  const isCurrentVersionSaved =
    versionWritten !== null && buffer.model.getAlternativeVersionId() === versionWritten;
  if (existing === buffer) {
    buffer.kind = "persisted";
    buffer.absolutePath = absolutePath;
    buffer.grantToken = buffer.rootPath && buffer.path ? null : grantToken;
    buffer.title = documentTitle(absolutePath);
    buffer.mtimeMs = mtimeMs;
    buffer.savedVersionId = isCurrentVersionSaved ? buffer.model.getAlternativeVersionId() : -1;
    return buffer;
  }
  if (existing && existing !== buffer) {
    if (isDocumentDirty(existing)) {
      throw new LocalizedError(i18n.global.t("workspace.saveConflict"));
    }
    existing.model.setValue(buffer.model.getValue());
    preserveModelEol(existing.model, buffer.model.getEndOfLineSequence());
    existing.savedVersionId = isCurrentVersionSaved ? existing.model.getAlternativeVersionId() : -1;
    existing.mtimeMs = mtimeMs;
    existing.grantToken = grantToken;
    buffer.contentDisposable.dispose();
    buffer.model.dispose();
    buffers.value = buffers.value.filter((candidate) => candidate !== buffer);
    unregisterDocument(buffer.id);
    selectDocument(existing.id);
    return existing;
  }

  const api = initializeMonaco();
  const previousEol = buffer.model.getEndOfLineSequence();
  const model = api.editor.createModel(
    buffer.model.getValue(),
    languageForPath(absolutePath),
    api.Uri.file(absolutePath),
  );
  preserveModelEol(model, previousEol);
  const changeVersion = buffer.changeVersion;
  const contentDisposable = model.onDidChangeContent(() => {
    changeVersion.value += 1;
  });
  const nextBuffer: DocumentBuffer = {
    ...buffer,
    id: `file:${absolutePath}`,
    kind: "persisted",
    absolutePath,
    rootPath: null,
    path: null,
    grantToken,
    title: documentTitle(absolutePath),
    model,
    savedVersionId: isCurrentVersionSaved ? model.getAlternativeVersionId() : -1,
    mtimeMs,
    changeVersion,
    contentDisposable,
  };
  buffer.contentDisposable.dispose();
  buffer.model.dispose();
  buffers.value = buffers.value.map((candidate) => (candidate === buffer ? nextBuffer : candidate));
  replaceDocumentId(buffer.id, nextBuffer.id);
  selectDocument(nextBuffer.id);
  return nextBuffer;
}

/**
 * Native Save As: pick a path, write once, then reidentify the same buffer.
 *
 * The tab stays the same object; only `id` / `absolutePath` change. A second
 * buffer for the chosen path must not be created.
 */
export function saveAsDocument(
  buffer: DocumentBuffer,
  basename: string,
  defaultExtension: "md" | "markdown" | "mdx" = "mdx",
  overwrite = false,
): Promise<{ result: SaveAsResult; buffer: DocumentBuffer }> {
  return queueBufferWrite(buffer, () =>
    saveAsDocumentNow(buffer, basename, defaultExtension, overwrite),
  );
}

async function saveAsDocumentNow(
  buffer: DocumentBuffer,
  basename: string,
  defaultExtension: "md" | "markdown" | "mdx",
  overwrite: boolean,
): Promise<{ result: SaveAsResult; buffer: DocumentBuffer }> {
  if (isAbandonedBuffer(buffer)) {
    throw new LocalizedError(i18n.global.t("workspace.saveError"));
  }
  const initialVersionId = buffer.model.getAlternativeVersionId();
  const saveAsOutcome = await pickAndSaveDocument(
    basename,
    buffer.model.getValue(),
    defaultExtension,
    overwrite,
  );
  if (saveAsOutcome.status !== "saved") {
    return { result: saveAsOutcome, buffer };
  }
  // Dialog can outlive the tab: bytes may already be on disk, but never
  // reidentify or rewrite a buffer the user already closed.
  if (isAbandonedBuffer(buffer)) {
    return { result: saveAsOutcome, buffer };
  }
  let savedMtimeMs = saveAsOutcome.mtimeMs;
  let versionWritten: number | null = initialVersionId;
  if (buffer.model.getAlternativeVersionId() !== initialVersionId) {
    const versionWrittenDuringRewrite = buffer.model.getAlternativeVersionId();
    const rewritten = await writeGrantedDocument(
      saveAsOutcome.grantToken,
      buffer.model.getValue(),
      saveAsOutcome.mtimeMs,
    );
    if (isAbandonedBuffer(buffer)) {
      return { result: saveAsOutcome, buffer };
    }
    savedMtimeMs = rewritten.mtimeMs;
    versionWritten =
      buffer.model.getAlternativeVersionId() === versionWrittenDuringRewrite
        ? versionWrittenDuringRewrite
        : null;
  }
  if (versionWritten !== null && buffer.model.getAlternativeVersionId() !== versionWritten) {
    versionWritten = null;
  }
  if (isAbandonedBuffer(buffer)) {
    return { result: saveAsOutcome, buffer };
  }
  const nextBuffer = reidentifyAsPersisted(
    buffer,
    saveAsOutcome.absolutePath,
    savedMtimeMs,
    saveAsOutcome.grantToken,
    versionWritten,
  );
  return { result: saveAsOutcome, buffer: nextBuffer };
}

/**
 * Drop folder attachment while keeping the text. Later writes need Save As
 * or a new grant; a vanished file still detaches.
 */
export async function detachDocumentBuffer(buffer: DocumentBuffer): Promise<DocumentBuffer> {
  if (!buffer.absolutePath || !buffer.rootPath || !buffer.path) {
    return buffer;
  }
  // Finish folder-relative writes while rootPath/path still describe the file.
  await awaitBufferWrites(buffer);
  let grantToken: string | null = null;
  try {
    const grant = await grantDetachedWorkspaceDocument(buffer.rootPath, buffer.path);
    grantToken = grant.grantToken;
  } catch (error) {
    // A document that vanished from disk still detaches: the buffer keeps the
    // text, it simply loses its write grant until the next Save As.
    if (parseFilesystemErrorCode(error) !== "documentMissing") {
      throw error;
    }
  }
  buffer.rootPath = null;
  buffer.path = null;
  buffer.grantToken = grantToken;
  buffers.value = [...buffers.value];
  return buffer;
}

/**
 * Bind a standalone or detached buffer to a folder-relative path. Clears the
 * grant: later saves go through workspace RPC, not the previous token.
 */
export function attachDocumentBuffer(
  buffer: DocumentBuffer,
  rootPath: string,
  path: string,
): DocumentBuffer {
  buffer.rootPath = rootPath;
  buffer.path = path;
  buffer.grantToken = null;
  buffer.title = documentTitle(path);
  buffers.value = [...buffers.value];
  return buffer;
}

/**
 * File rename of an open folder buffer. Changes document identity to
 * `file:${absolutePath}`. Not heading/fragment rename (`F2`).
 *
 * Dirty text stays dirty (`savedVersionId` `-1`); a clean buffer stays clean
 * against the new model's version id.
 */
export function renameDocumentBuffer(
  buffer: DocumentBuffer,
  nextPath: string,
  mtimeMs: number,
): void {
  if (!buffers.value.includes(buffer)) {
    return;
  }

  const api = initializeMonaco();
  if (!buffer.rootPath) {
    return;
  }
  const wasDirty = isDocumentDirty(buffer);
  const wasActive = activeId.value === buffer.id;
  const previousEol = buffer.model.getEndOfLineSequence();
  const absolutePath = `${buffer.rootPath.replace(/[\\/]+$/, "")}/${nextPath.replace(/\\/g, "/")}`;
  const model = api.editor.createModel(
    buffer.model.getValue(),
    languageForPath(nextPath),
    api.Uri.file(absolutePath),
  );
  preserveModelEol(model, previousEol);
  const changeVersion = buffer.changeVersion;
  const contentDisposable = model.onDidChangeContent(() => {
    changeVersion.value += 1;
  });

  // Old buffer object leaves the open set; abandon it so a queued save cannot
  // write the previous path after identity moves to renamedBuffer.
  abandonedWrites.add(buffer);
  buffer.contentDisposable.dispose();
  buffer.model.dispose();
  const renamedBuffer: DocumentBuffer = {
    ...buffer,
    id: `file:${absolutePath}`,
    absolutePath,
    path: nextPath,
    title: documentTitle(nextPath),
    model,
    savedVersionId: wasDirty ? -1 : model.getAlternativeVersionId(),
    mtimeMs,
    changeVersion,
    contentDisposable,
  };
  buffers.value = buffers.value.map((candidate) =>
    candidate === buffer ? renamedBuffer : candidate,
  );
  replaceDocumentId(buffer.id, renamedBuffer.id);
  // replaceDocumentId already preserves activeId for the active tab. Only
  // re-pair Focus when the renamed buffer was the editor selection.
  if (wasActive) {
    selectDocument(renamedBuffer.id);
  }
}

export function closeDocument(rootPath: string, path: string, force = false): boolean {
  const buffer = getDocumentBuffer(rootPath, path);
  return closeDocumentBuffer(buffer, force);
}

/**
 * Close by session id (virtual or persisted). Returns false when the buffer is
 * dirty and `force` is false, so the caller can confirm before discarding.
 */
export function closeDocumentById(id: DocumentId, force = false): boolean {
  return closeDocumentBuffer(getDocumentBufferById(id), force);
}

function closeDocumentBuffer(buffer: DocumentBuffer | null, force: boolean): boolean {
  if (!buffer) {
    return true;
  }
  if (!force && isDocumentDirty(buffer)) {
    return false;
  }

  // Stop queued saves that have not started; in-flight writes still finish but
  // must not mutate this disposed buffer afterward.
  abandonedWrites.add(buffer);
  buffer.contentDisposable.dispose();
  buffer.model.dispose();
  const currentIndex = buffers.value.indexOf(buffer);
  const replacement =
    (currentIndex >= 0
      ? (buffers.value[currentIndex + 1] ?? buffers.value[currentIndex - 1])
      : undefined
    )?.id ?? null;
  buffers.value = buffers.value.filter((candidate) => candidate !== buffer);
  unregisterDocument(buffer.id);
  clearActiveDocument(buffer.id, replacement);
  if (buffer.path) {
    clearFocusForDocument(buffer.path);
  }
  return true;
}

export function closeAllDocuments(force = false): boolean {
  if (!force && buffers.value.some(isDocumentDirty)) {
    return false;
  }

  invalidatePendingWorkspaceOpens();
  for (const buffer of buffers.value) {
    // Same as single close: stop queued saves and ignore in-flight buffer updates.
    abandonedWrites.add(buffer);
    buffer.contentDisposable.dispose();
    buffer.model.dispose();
    if (buffer.path) {
      clearFocusForDocument(buffer.path);
    }
  }
  buffers.value = [];
  clearSessionDocuments();
  return true;
}
