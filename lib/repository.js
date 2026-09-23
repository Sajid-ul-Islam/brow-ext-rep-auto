/** Local persistence for sessions, events, candidates, workflows, and runs. Only the service worker owns this repository. */

import { validateWorkflow } from './workflow.js';

export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const SUMMARY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_EVENTS = 10_000;
export const MAX_SESSIONS = 250;
export const MAX_SUMMARIES = 1_000;

const SESSION_FIELDS = [
  'schemaVersion', 'id', 'revision', 'tabId', 'frameId', 'documentId', 'origin',
  'epoch', 'state', 'lastSequence', 'segment', 'startedAt', 'updatedAt', 'endedAt',
  'stopReason', 'pauseReason',
];
const EVENT_FIELDS = [
  'schemaVersion', 'id', 'sessionId', 'sequence', 'segment', 'recordedAt',
  'action', 'targetKey', 'fieldKind',
];
const CANDIDATE_FIELDS = [
  'schemaVersion', 'id', 'sessionId', 'symbols', 'occurrences', 'createdAt', 'state',
];
const RUN_CHECKPOINT_FIELDS = [
  'schemaVersion', 'id', 'revision', 'workflowId', 'workflowRevision',
  'tabId', 'frameId', 'documentId', 'origin', 'state',
  'nextStepIndex', 'completedStepCount', 'pendingIntent', 'lastOutcome',
  'startedAt', 'updatedAt', 'endedAt',
];
const RUN_SUMMARY_FIELDS = [
  'schemaVersion', 'id', 'workflowId', 'workflowRevision', 'origin',
  'state', 'startedAt', 'endedAt', 'completedStepCount', 'failedStepId', 'errorCode',
];

const STOP_REASONS = new Set([
  'user', 'navigation', 'permissionLost', 'tabClosed', 'restart', 'storageError',
  'overflow', 'contextLost',
]);
const PAUSE_REASONS = new Set(['user', 'tabInactive', 'connectionLost']);
const FIELD_KINDS = new Set(['none', 'text', 'number', 'select', 'checkbox', 'radio']);
const CANDIDATE_STATES = new Set(['suggested', 'dismissed', 'converted']);
const RUN_STATES = new Set([
  'previewing', 'running', 'awaitingConfirmation', 'paused',
  'completed', 'cancelled', 'failed', 'needsAttention',
]);
const SUMMARY_STATES = new Set(['completed', 'cancelled', 'failed', 'needsAttention']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalid() {
  throw new Error('INVALID_STORAGE');
}

function exactObject(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) invalid();
  const keys = Reflect.ownKeys(value);
  if (required.some((key) => !Object.hasOwn(value, key)) || keys.some((key) => !required.includes(key) && !optional.includes(key))) invalid();
  if (keys.some((key) => !Object.getOwnPropertyDescriptor(value, key)?.enumerable || !('value' in Object.getOwnPropertyDescriptor(value, key)))) invalid();
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
  if (typeof value !== 'string' || !UUID.test(value)) invalid();
}

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) invalid();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) invalid();
  return parsed;
}

function origin(value) {
  if (typeof value !== 'string' || value.length > 2048) invalid();
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || value !== url.origin) invalid();
  } catch {
    invalid();
  }
}

export function emptyState() {
  return {
    schemaVersion: 1,
    sessions: [],
    events: [],
    candidates: [],
    workflows: [],
    runs: [],
    summaries: [],
  };
}

/** Reject invalid records before pruning, so expiry cannot conceal schema corruption. */
export function validateState(state) {
  exactObject(state, ['schemaVersion', 'sessions', 'events'], ['candidates', 'workflows', 'runs', 'summaries']);
  if (state.schemaVersion !== 1) invalid();
  array(state.sessions);
  array(state.events);
  if (state.candidates) array(state.candidates);
  if (state.workflows) array(state.workflows);
  if (state.runs) array(state.runs);
  if (state.summaries) array(state.summaries);

  const sessions = new Map();
  let activeCount = 0;
  for (const session of state.sessions) {
    exactObject(session, SESSION_FIELDS.filter((key) => key !== 'pauseReason'), ['pauseReason']);
    if (session.schemaVersion !== 1) invalid();
    uuid(session.id);
    uuid(session.epoch);
    if (sessions.has(session.id)) invalid();
    integer(session.revision);
    integer(session.tabId);
    integer(session.lastSequence);
    integer(session.segment, 1);
    if (session.frameId !== 0 || typeof session.documentId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(session.documentId)) invalid();
    origin(session.origin);
    if (!['observing', 'paused', 'stopped'].includes(session.state)) invalid();
    const started = timestamp(session.startedAt);
    const updated = timestamp(session.updatedAt);
    if (updated < started) invalid();
    if (Object.hasOwn(session, 'pauseReason') && session.pauseReason !== null && !PAUSE_REASONS.has(session.pauseReason)) invalid();
    if (session.state === 'stopped') {
      const ended = timestamp(session.endedAt);
      if (ended < started || ended > updated || !STOP_REASONS.has(session.stopReason) || session.pauseReason != null) invalid();
    } else {
      activeCount += 1;
      if (session.endedAt !== null || session.stopReason !== null) invalid();
      if (session.state === 'observing' && session.pauseReason != null) invalid();
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
    if (!['click', 'change'].includes(event.action) || !FIELD_KINDS.has(event.fieldKind)) invalid();
    if (typeof event.targetKey !== 'string' || !/^[a-f0-9]{64}$/.test(event.targetKey)) invalid();
    if (event.action === 'change' && event.fieldKind === 'none') invalid();
    const pair = `${event.sessionId}:${event.sequence}`;
    if (ids.has(event.id) || sequences.has(pair)) invalid();
    ids.add(event.id);
    sequences.add(pair);
  }

  // Validate candidates (M2)
  if (state.candidates) {
    const candidateIds = new Set();
    for (const candidate of state.candidates) {
      exactObject(candidate, CANDIDATE_FIELDS);
      if (candidate.schemaVersion !== 1) invalid();
      uuid(candidate.id);
      if (candidateIds.has(candidate.id)) invalid();
      candidateIds.add(candidate.id);
      uuid(candidate.sessionId);
      if (!sessions.has(candidate.sessionId)) invalid();
      if (!CANDIDATE_STATES.has(candidate.state)) invalid();
      timestamp(candidate.createdAt);
      if (!Array.isArray(candidate.symbols) || candidate.symbols.length < 3 || candidate.symbols.length > 30) invalid();
      for (const sym of candidate.symbols) {
        exactObject(sym, ['action', 'targetKey', 'fieldKind']);
        if (!['click', 'change'].includes(sym.action) || !FIELD_KINDS.has(sym.fieldKind)) invalid();
        if (typeof sym.targetKey !== 'string' || !/^[a-f0-9]{64}$/.test(sym.targetKey)) invalid();
      }
      if (!Array.isArray(candidate.occurrences) || candidate.occurrences.length < 3) invalid();
      let prevEnd = 0;
      for (const occ of candidate.occurrences) {
        exactObject(occ, ['startSequence', 'endSequence']);
        integer(occ.startSequence, 1);
        integer(occ.endSequence, occ.startSequence);
        if (occ.startSequence <= prevEnd) invalid();
        prevEnd = occ.endSequence;
      }
    }
  }

  // Validate workflows (M3)
  const workflows = new Map();
  if (state.workflows) {
    for (const workflow of state.workflows) {
      validateWorkflow(workflow);
      if (workflows.has(workflow.id)) invalid();
      workflows.set(workflow.id, workflow);
    }
  }

  // Validate active runs (M4)
  if (state.runs) {
    let activeRunCount = 0;
    const runIds = new Set();
    for (const run of state.runs) {
      exactObject(run, RUN_CHECKPOINT_FIELDS, ['confirmedStepId']);
      if (run.schemaVersion !== 1) invalid();
      uuid(run.id);
      if (runIds.has(run.id)) invalid();
      runIds.add(run.id);
      integer(run.revision, 1);
      uuid(run.workflowId);
      integer(run.workflowRevision, 1);
      integer(run.tabId);
      if (run.frameId !== 0 || typeof run.documentId !== 'string') invalid();
      origin(run.origin);
      if (!RUN_STATES.has(run.state)) invalid();
      integer(run.nextStepIndex);
      integer(run.completedStepCount);
      timestamp(run.startedAt);
      timestamp(run.updatedAt);
      if (run.endedAt !== null) timestamp(run.endedAt);
      if (run.pendingIntent !== null) {
        exactObject(run.pendingIntent, ['stepId', 'dispatchId', 'effect', 'recordedAt']);
        uuid(run.pendingIntent.stepId);
        uuid(run.pendingIntent.dispatchId);
        timestamp(run.pendingIntent.recordedAt);
      }
      if (run.lastOutcome !== null) {
        exactObject(run.lastOutcome, ['stepId', 'status', 'code', 'recordedAt']);
        uuid(run.lastOutcome.stepId);
        timestamp(run.lastOutcome.recordedAt);
      }
      if (!['completed', 'cancelled', 'failed'].includes(run.state)) {
        activeRunCount += 1;
      }
    }
    if (activeRunCount > 1) invalid();
  }

  // Validate run summaries (M4)
  if (state.summaries) {
    const summaryIds = new Set();
    for (const summary of state.summaries) {
      exactObject(summary, RUN_SUMMARY_FIELDS);
      if (summary.schemaVersion !== 1) invalid();
      uuid(summary.id);
      if (summaryIds.has(summary.id)) invalid();
      summaryIds.add(summary.id);
      uuid(summary.workflowId);
      integer(summary.workflowRevision, 1);
      origin(summary.origin);
      if (!SUMMARY_STATES.has(summary.state)) invalid();
      timestamp(summary.startedAt);
      timestamp(summary.endedAt);
      integer(summary.completedStepCount);
      if (summary.failedStepId !== null) uuid(summary.failedStepId);
    }
  }

  return state;
}

/** Returns a new snapshot; callers retain no mutable reference to committed state. */
export function pruneState(rawState, now) {
  validateState(rawState);
  if (!Number.isFinite(now)) throw new Error('INVALID_TIME');
  const cutoff = now - RETENTION_MS;
  const summaryCutoff = now - SUMMARY_RETENTION_MS;

  const retained = rawState.sessions.filter((session) => session.state !== 'stopped' || Date.parse(session.endedAt) > cutoff);
  const active = retained.filter((session) => session.state !== 'stopped');
  const stopped = retained.filter((session) => session.state === 'stopped')
    .sort((a, b) => Date.parse(a.endedAt) - Date.parse(b.endedAt) || a.id.localeCompare(b.id));
  const sessions = [...stopped.slice(-Math.max(0, MAX_SESSIONS - active.length)), ...active];
  const sessionIds = new Set(sessions.map((session) => session.id));

  const events = rawState.events.filter((event) => Date.parse(event.recordedAt) > cutoff && sessionIds.has(event.sessionId))
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt) || a.sessionId.localeCompare(b.sessionId) || a.sequence - b.sequence)
    .slice(-MAX_EVENTS);

  // Candidates: retain only those referencing valid retained sessions
  const candidates = (rawState.candidates || []).filter((candidate) => sessionIds.has(candidate.sessionId));

  // Workflows: retain all unless explicitly deleted
  const workflows = [...(rawState.workflows || [])];

  // Active runs: retain non-terminated runs
  const runs = (rawState.runs || []).filter((run) => !['completed', 'cancelled', 'failed'].includes(run.state));

  // Run summaries: bounded by summary retention time and MAX_SUMMARIES
  const summaries = (rawState.summaries || []).filter((summary) => Date.parse(summary.endedAt) > summaryCutoff)
    .sort((a, b) => Date.parse(a.endedAt) - Date.parse(b.endedAt) || a.id.localeCompare(b.id))
    .slice(-MAX_SUMMARIES);

  return structuredClone({
    schemaVersion: 1,
    sessions,
    events,
    candidates,
    workflows,
    runs,
    summaries,
  });
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
        reject(new Error('STORAGE_ERROR'));
        return;
      }
      let request;
      let blocked = false;
      try {
        request = indexedDB.open('repeatflow', 1);
      } catch {
        reject(new Error('STORAGE_ERROR'));
        return;
      }
      request.onupgradeneeded = () => {
        request.result.createObjectStore('state');
      };
      request.onerror = () => reject(new Error(request.error?.name === 'VersionError' ? 'INVALID_STORAGE' : 'STORAGE_ERROR'));
      request.onblocked = () => {
        blocked = true;
        reject(new Error('STORAGE_ERROR'));
      };
      request.onsuccess = () => {
        const database = request.result;
        if (blocked) {
          database.close();
          return;
        }
        if (database.objectStoreNames.length !== 1 || !database.objectStoreNames.contains('state')) {
          database.close();
          reject(new Error('INVALID_STORAGE'));
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
        transaction = database.transaction('state', 'readwrite');
        const store = transaction.objectStore('state');
        if (store.keyPath !== null || store.autoIncrement) invalid();
        const request = store.get('m1');
        request.onsuccess = () => {
          try {
            const currentTime = now();
            const state = reset ? emptyState() : pruneState(request.result === undefined ? emptyState() : request.result, currentTime);
            if (mutator) {
              const mutationResult = mutator(state);
              if (mutationResult !== undefined) {
                if (mutationResult && typeof mutationResult.then === 'function') Promise.resolve(mutationResult).catch(() => {});
                throw new Error('INVALID_MUTATOR');
              }
            }
            result = pruneState(state, currentTime);
            store.put(result, 'm1');
          } catch (error) {
            failure = error;
            transaction.abort();
          }
        };
        transaction.oncomplete = () => resolve(structuredClone(result));
        transaction.onabort = () => reject(failure ?? new Error('STORAGE_ERROR'));
        transaction.onerror = () => { failure ??= new Error('STORAGE_ERROR'); };
      } catch (error) {
        if (transaction) {
          try { transaction.abort(); } catch { /* It may already be inactive. */ }
        }
        reject(error.message === 'INVALID_STORAGE' ? error : new Error('STORAGE_ERROR'));
      }
    });
  }

  return {
    read: () => transact(),
    update: (mutator) => typeof mutator === 'function' ? transact(mutator) : Promise.reject(new Error('INVALID_MUTATOR')),
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
