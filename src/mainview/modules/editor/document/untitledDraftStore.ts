/**
 * Ephemeral IndexedDB recovery for Untitled drafts only.
 *
 * Not a document store. Real files stay on the filesystem. Failure to open,
 * read, or write here must never break the editor or touch workspace files.
 */
export type UntitledDraftRecord = {
  /** Opaque recovery key - not a presentation number and not a DocumentId. */
  recoveryId: string;
  content: string;
  updatedAt: number;
};

const DB_NAME = "fulvid-untitled-drafts";
const DB_VERSION = 1;
const STORE_NAME = "drafts";
/** Soft cap so a huge paste cannot pin IndexedDB; oversize drafts are skipped. */
export const MAX_UNTITLED_DRAFT_CHARS = 8_000_000;

type DraftBackend = {
  put(record: UntitledDraftRecord): Promise<void>;
  list(): Promise<UntitledDraftRecord[]>;
  remove(recoveryId: string): Promise<void>;
};

let backend: DraftBackend | null = null;
let backendPromise: Promise<DraftBackend> | null = null;

function isValidDraftRecord(value: unknown): value is UntitledDraftRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.recoveryId === "string" &&
    record.recoveryId.length > 0 &&
    record.recoveryId.length <= 128 &&
    typeof record.content === "string" &&
    record.content.length <= MAX_UNTITLED_DRAFT_CHARS &&
    typeof record.updatedAt === "number" &&
    Number.isFinite(record.updatedAt)
  );
}

function memoryBackend(): DraftBackend {
  const drafts = new Map<string, UntitledDraftRecord>();
  return {
    put(record) {
      drafts.set(record.recoveryId, record);
      return Promise.resolve();
    },
    list() {
      return Promise.resolve([...drafts.values()]);
    },
    remove(recoveryId) {
      drafts.delete(recoveryId);
      return Promise.resolve();
    },
  };
}

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

function openIndexedDbBackend(): Promise<DraftBackend> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => {
      reject(request.error ?? new Error("indexedDB open failed"));
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "recoveryId" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      resolve({
        put(record) {
          return new Promise((putResolve, putReject) => {
            try {
              const tx = db.transaction(STORE_NAME, "readwrite");
              tx.oncomplete = () => putResolve();
              tx.onerror = () => putReject(tx.error ?? new Error("indexedDB put failed"));
              tx.objectStore(STORE_NAME).put(record);
            } catch (error) {
              putReject(asError(error));
            }
          });
        },
        list() {
          return new Promise((listResolve, listReject) => {
            try {
              const tx = db.transaction(STORE_NAME, "readonly");
              const requestGet = tx.objectStore(STORE_NAME).getAll();
              requestGet.onsuccess = () => {
                const rows = Array.isArray(requestGet.result) ? requestGet.result : [];
                listResolve(rows.filter(isValidDraftRecord));
              };
              requestGet.onerror = () =>
                listReject(requestGet.error ?? new Error("indexedDB list failed"));
            } catch (error) {
              listReject(asError(error));
            }
          });
        },
        remove(recoveryId) {
          return new Promise((removeResolve, removeReject) => {
            try {
              const tx = db.transaction(STORE_NAME, "readwrite");
              tx.oncomplete = () => removeResolve();
              tx.onerror = () => removeReject(tx.error ?? new Error("indexedDB delete failed"));
              tx.objectStore(STORE_NAME).delete(recoveryId);
            } catch (error) {
              removeReject(asError(error));
            }
          });
        },
      });
    };
  });
}

async function resolveBackend(): Promise<DraftBackend> {
  if (backend) {
    return backend;
  }
  if (!backendPromise) {
    backendPromise = openIndexedDbBackend()
      .then((opened) => {
        backend = opened;
        return opened;
      })
      .catch(() => {
        backend = memoryBackend();
        return backend;
      });
  }
  return backendPromise;
}

/** Test hook: force an in-memory backend and clear it. */
export function resetUntitledDraftStoreForTests(options?: { memoryOnly?: boolean }): void {
  if (options?.memoryOnly === false) {
    backend = null;
    backendPromise = null;
  } else {
    backend = memoryBackend();
    backendPromise = Promise.resolve(backend);
  }
  pendingTimers.clear();
  writeGenerations.clear();
  inFlight.clear();
}

export async function putUntitledDraft(record: UntitledDraftRecord): Promise<void> {
  if (!isValidDraftRecord(record)) {
    return;
  }
  try {
    const store = await resolveBackend();
    await store.put(record);
  } catch {
    // Recovery is best-effort.
  }
}

export async function listUntitledDrafts(): Promise<UntitledDraftRecord[]> {
  try {
    const store = await resolveBackend();
    const drafts = await store.list();
    return drafts
      .filter(isValidDraftRecord)
      .sort((left, right) => left.updatedAt - right.updatedAt);
  } catch {
    return [];
  }
}

export async function deleteUntitledDraft(recoveryId: string): Promise<void> {
  if (typeof recoveryId !== "string" || recoveryId.length === 0) {
    return;
  }
  cancelPendingUntitledDraftWrite(recoveryId);
  try {
    const store = await resolveBackend();
    await store.remove(recoveryId);
  } catch {
    // Best-effort cleanup.
  }
}

type PendingWrite = {
  timer: ReturnType<typeof setTimeout>;
  content: string;
  generation: number;
};

const pendingTimers = new Map<string, PendingWrite>();
const writeGenerations = new Map<string, number>();
const inFlight = new Map<string, Promise<void>>();

const DRAFT_PERSIST_DEBOUNCE_MS = 400;

export function cancelPendingUntitledDraftWrite(recoveryId: string): void {
  const pending = pendingTimers.get(recoveryId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingTimers.delete(recoveryId);
  }
  writeGenerations.set(recoveryId, (writeGenerations.get(recoveryId) ?? 0) + 1);
}

function nextGeneration(recoveryId: string): number {
  const generation = (writeGenerations.get(recoveryId) ?? 0) + 1;
  writeGenerations.set(recoveryId, generation);
  return generation;
}

async function writeDraftNow(
  recoveryId: string,
  content: string,
  generation: number,
): Promise<void> {
  if (writeGenerations.get(recoveryId) !== generation) {
    return;
  }
  if (content.length > MAX_UNTITLED_DRAFT_CHARS) {
    return;
  }
  const work = putUntitledDraft({
    recoveryId,
    content,
    updatedAt: Date.now(),
  }).finally(() => {
    if (inFlight.get(recoveryId) === work) {
      inFlight.delete(recoveryId);
    }
  });
  inFlight.set(recoveryId, work);
  await work;
}

/**
 * Coalesce Untitled draft writes. Not a general autosave scheduler.
 * Crash mid-keystroke may lose the last few hundred ms of typing.
 */
export function scheduleUntitledDraftPersist(recoveryId: string, content: string): void {
  if (typeof recoveryId !== "string" || recoveryId.length === 0) {
    return;
  }
  if (content.length > MAX_UNTITLED_DRAFT_CHARS) {
    return;
  }
  const existing = pendingTimers.get(recoveryId);
  if (existing) {
    clearTimeout(existing.timer);
  }
  const generation = nextGeneration(recoveryId);
  const timer = setTimeout(() => {
    pendingTimers.delete(recoveryId);
    void writeDraftNow(recoveryId, content, generation);
  }, DRAFT_PERSIST_DEBOUNCE_MS);
  pendingTimers.set(recoveryId, { timer, content, generation });
}

/** Flush pending coalesced writes (quit / tests). */
export async function flushUntitledDraftWrites(): Promise<void> {
  const pending = [...pendingTimers.entries()];
  pendingTimers.clear();
  await Promise.all(
    pending.map(async ([recoveryId, entry]) => {
      clearTimeout(entry.timer);
      await writeDraftNow(recoveryId, entry.content, entry.generation);
    }),
  );
  await Promise.all([...inFlight.values()]);
}

export function createUntitledDraftRecoveryId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
