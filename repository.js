/** Local observation persistence. Only the service worker owns this repository. */

export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_EVENTS = 10_000;
export const MAX_SESSIONS = 250;

const SESSION_FIELDS = [
  "schemaVersion", "id", "revision", "tabId", "frameId", "documentId", "origin",
  "epoch", "state", "lastSequence", "segment", "startedAt", "updatedAt", "endedAt",
  "stopReason", "pauseReason",
];
const EVENT_FIELDS = [
  "schemaVersion", "id", "sessionId", "sequence", "segment", "recordedAt",
  "action", "targetKey", "fieldKind",
];
const STOP_REASONS = new Set([
  "user", "navigation", "permissionLost", "tabClosed", "restart", "storageError",
  "overflow", "contextLost",
]);
const PAUSE_REASONS = new Set(["user", "tabInactive", "connectionLost"]);
const FIELD_KINDS = new Set(["none", "text", "number", "select", "checkbox", "radio"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalid() {
  throw new Error("INVALID_STORAGE");
}

function exactObject(value, required, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) invalid();
  const keys = Reflect.ownKeys(value);
  if (required.some((key) => !Object.hasOwn(value, key)) || keys.some((key) => !required.includes(key) && !optional.includes(key))) invalid();
  if (keys.some((key) => !Object.getOwnPropertyDescriptor(value, key)?.enumerable || !("value" in Object.getOwnPropertyDescriptor(value, key)))) invalid();
}

function array(value) {
  if (!Array.isArray(value) || Object.keys(value).length !== value.length) invalid();
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) invalid();
  }
}

function integer(value, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) invalid();
}

function uuid(value) {
  if (typeof value !== "string" || !UUID.test(value)) invalid();
}

function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) invalid();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) invalid();
  return parsed;
}

function origin(value) {
  if (typeof value !== "string" || value.length > 2048) invalid();
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || value !== url.origin) invalid();
  } catch {
    invalid();
  }
}

export function emptyState() {
  return { schemaVersion: 1, sessions: [], events: [] };
}

/** Reject invalid records before pruning, so expiry cannot conceal schema corruption. */
export function validateState(state) {
  exactObject(state, ["schemaVersion", "sessions", "events"]);
  if (state.schemaVersion !== 1) invalid();
  array(state.sessions);
  array(state.events);
  const sessions = new Map();
  let activeCount = 0;
  for (const session of state.sessions) {
    exactObject(session, SESSION_FIELDS.filter((key) => key !== "pauseReason"), ["pauseReason"]);
    if (session.schemaVersion !== 1) invalid();
    uuid(session.id);
    uuid(session.epoch);
    if (sessions.has(session.id)) invalid();
    integer(session.revision);
    integer(session.tabId);
    integer(session.lastSequence);
    integer(session.segment, 1);
    if (session.frameId !== 0 || typeof session.documentId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(session.documentId)) invalid();
    origin(session.origin);
    if (!["observing", "paused", "stopped"].includes(session.state)) invalid();
    const started = timestamp(session.startedAt);
    const updated = timestamp(session.updatedAt);
    if (updated < started) invalid();
    if (Object.hasOwn(session, "pauseReason") && session.pauseReason !== null && !PAUSE_REASONS.has(session.pauseReason)) invalid();
    if (session.state === "stopped") {
      const ended = timestamp(session.endedAt);
      if (ended < started || ended > updated || !STOP_REASONS.has(session.stopReason) || session.pauseReason != null) invalid();
    } else {
      activeCount += 1;
      if (session.endedAt !== null || session.stopReason !== null) invalid();
      if (session.state === "observing" && session.pauseReason != null) invalid();
    }
    sessions.set(session.id, session);
  }
  if (activeCount > 1) invalid();
  const ids = new Set();
  const sequences = new Set();
  for (const event of state.events) {
    exactObject(event, EVENT_FIELDS);
    if (event.schemaVersion !== 1) invalid();
    uuid(event.id);
    uuid(event.sessionId);
    integer(event.sequence, 1);
    integer(event.segment, 1);
    const session = sessions.get(event.sessionId);
    if (!session || event.sequence > session.lastSequence || event.segment > session.segment) invalid();
    const recorded = timestamp(event.recordedAt);
    if (recorded < Date.parse(session.startedAt) || recorded > Date.parse(session.updatedAt)) invalid();
    if (session.endedAt !== null && recorded > Date.parse(session.endedAt)) invalid();
    if (!["click", "change"].includes(event.action) || !FIELD_KINDS.has(event.fieldKind)) invalid();
    if (typeof event.targetKey !== "string" || !/^[a-f0-9]{64}$/.test(event.targetKey)) invalid();
    if (event.action === "change" && event.fieldKind === "none") invalid();
    const pair = `${event.sessionId}:${event.sequence}`;
    if (ids.has(event.id) || sequences.has(pair)) invalid();
    ids.add(event.id);
    sequences.add(pair);
  }
  return state;
}

/** Returns a new snapshot; callers retain no mutable reference to committed state. */
export function pruneState(state, now) {
  validateState(state);
  if (!Number.isFinite(now)) throw new Error("INVALID_TIME");
  const cutoff = now - RETENTION_MS;
  const retained = state.sessions.filter((session) => session.state !== "stopped" || Date.parse(session.endedAt) > cutoff);
  // One active session is preserved even when it predates retention. An active
  // record is authorization bookkeeping, never permission to resume on restart.
  const active = retained.filter((session) => session.state !== "stopped");
  const stopped = retained.filter((session) => session.state === "stopped")
    .sort((a, b) => Date.parse(a.endedAt) - Date.parse(b.endedAt) || a.id.localeCompare(b.id));
  const sessions = [...stopped.slice(-Math.max(0, MAX_SESSIONS - active.length)), ...active];
  const sessionIds = new Set(sessions.map((session) => session.id));
  const events = state.events.filter((event) => Date.parse(event.recordedAt) > cutoff && sessionIds.has(event.sessionId))
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt) || a.sessionId.localeCompare(b.sessionId) || a.sequence - b.sequence)
    .slice(-MAX_EVENTS);
  // Stopped summaries, including empty ones, remain bounded so the panel can
  // explain why observation ended after a navigation or worker restart.
  return structuredClone({ schemaVersion: 1, sessions, events });
}

/**
 * Persist one versioned snapshot atomically. Mutators must be synchronous and
 * return undefined; async work inside an IDB transaction is deliberately denied.
 */
export function createRepository({ indexedDB = globalThis.indexedDB, now = () => Date.now() } = {}) {
  let databasePromise;

  function open() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      if (!indexedDB) {
        reject(new Error("STORAGE_ERROR"));
        return;
      }
      let request;
      let blocked = false;
      try {
        request = indexedDB.open("repeatflow", 1);
      } catch {
        reject(new Error("STORAGE_ERROR"));
        return;
      }
      request.onupgradeneeded = () => {
        request.result.createObjectStore("state");
      };
      request.onerror = () => reject(new Error(request.error?.name === "VersionError" ? "INVALID_STORAGE" : "STORAGE_ERROR"));
      request.onblocked = () => {
        blocked = true;
        reject(new Error("STORAGE_ERROR"));
      };
      request.onsuccess = () => {
        const database = request.result;
        if (blocked) {
          database.close();
          return;
        }
        if (database.objectStoreNames.length !== 1 || !database.objectStoreNames.contains("state")) {
          database.close();
          reject(new Error("INVALID_STORAGE"));
          return;
        }
        database.onversionchange = () => {
          database.close();
          databasePromise = undefined;
        };
        resolve(database);
      };
    }).catch((error) => {
      databasePromise = undefined;
      throw error;
    });
    return databasePromise;
  }

  async function transact(mutator, reset = false) {
    const database = await open();
    return new Promise((resolve, reject) => {
      let transaction;
      let result;
      let failure;
      try {
        transaction = database.transaction("state", "readwrite");
        const store = transaction.objectStore("state");
        if (store.keyPath !== null || store.autoIncrement) invalid();
        const request = store.get("m1");
        request.onsuccess = () => {
          try {
            const currentTime = now();
            const state = reset ? emptyState() : pruneState(request.result === undefined ? emptyState() : request.result, currentTime);
            if (mutator) {
              const mutationResult = mutator(state);
              if (mutationResult !== undefined) {
                // Avoid an unhandled rejection from an accidentally async
                // caller; its detached state can never be committed.
                if (mutationResult && typeof mutationResult.then === "function") Promise.resolve(mutationResult).catch(() => {});
                throw new Error("INVALID_MUTATOR");
              }
            }
            result = pruneState(state, currentTime);
            store.put(result, "m1");
          } catch (error) {
            failure = error;
            transaction.abort();
          }
        };
        transaction.oncomplete = () => resolve(structuredClone(result));
        transaction.onabort = () => reject(failure ?? new Error("STORAGE_ERROR"));
        transaction.onerror = () => { failure ??= new Error("STORAGE_ERROR"); };
      } catch (error) {
        if (transaction) {
          try { transaction.abort(); } catch { /* It may already be inactive. */ }
        }
        reject(error.message === "INVALID_STORAGE" ? error : new Error("STORAGE_ERROR"));
      }
    });
  }

  return {
    read: () => transact(),
    update: (mutator) => typeof mutator === "function" ? transact(mutator) : Promise.reject(new Error("INVALID_MUTATOR")),
    clear: () => transact(undefined, true),
    async close() {
      if (databasePromise) {
        const database = await databasePromise;
        database.close();
        databasePromise = undefined;
      }
    },
  };
}
