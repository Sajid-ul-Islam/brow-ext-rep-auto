import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
import {
  createRepository, emptyState, validateState, pruneState,
  RETENTION_MS, MAX_EVENTS, MAX_SESSIONS,
} from "../lib/repository.js";

const NOW = Date.parse("2026-09-23T10:00:00.000Z");
const iso = (time) => new Date(time).toISOString();

function session(overrides = {}) {
  return {
    schemaVersion: 1, id: randomUUID(), revision: 1,
    tabId: 7, frameId: 0, documentId: randomUUID(),
    origin: "https://example.com", epoch: randomUUID(),
    state: "observing", lastSequence: 0, segment: 1,
    startedAt: iso(NOW - 1000), updatedAt: iso(NOW), endedAt: null,
    stopReason: null, pauseReason: null, ...overrides,
  };
}

function stopped(overrides = {}) {
  return session({ state: "stopped", endedAt: iso(NOW), stopReason: "user", ...overrides });
}

function event(owner, sequence = 1, overrides = {}) {
  return {
    schemaVersion: 1, id: randomUUID(), sessionId: owner.id,
    sequence, segment: 1, recordedAt: iso(NOW), action: "click",
    targetKey: "a".repeat(64), fieldKind: "none", ...overrides,
  };
}

function snapshot(owner, events = []) {
  return { schemaVersion: 1, sessions: [owner], events };
}

async function rawPut(indexedDB, value) {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("repeatflow", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("state");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("state", "readwrite");
    transaction.objectStore("state").put(value, "m1");
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
  });
  database.close();
}

test("retention expires at seven days and keeps only the newest 10,000 events globally", () => {
  const owner = session({ lastSequence: MAX_EVENTS + 3, startedAt: iso(NOW - RETENTION_MS - 1) });
  const events = Array.from({ length: MAX_EVENTS + 3 }, (_, index) => event(owner, index + 1, {
    recordedAt: iso(NOW - 1_000_000 + index),
  }));
  events[0].recordedAt = iso(NOW - RETENTION_MS);
  const original = snapshot(owner, events);
  const result = pruneState(original, NOW);
  assert.equal(result.events.length, MAX_EVENTS);
  assert.equal(result.events[0].sequence, 4);
  assert.equal(original.events.length, MAX_EVENTS + 3);
  result.sessions[0].origin = "https://changed.example";
  assert.equal(original.sessions[0].origin, "https://example.com");
});

test("retention applies across sessions and retains bounded empty stopped summaries", () => {
  const old = stopped({
    lastSequence: 1, startedAt: iso(NOW - RETENTION_MS - 1000),
    updatedAt: iso(NOW - RETENTION_MS), endedAt: iso(NOW - RETENTION_MS),
  });
  const current = stopped();
  const active = session({ startedAt: iso(NOW - RETENTION_MS - 1000) });
  const state = { schemaVersion: 1, sessions: [old, current, active], events: [event(old, 1, { recordedAt: old.endedAt })] };
  const result = pruneState(state, NOW);
  assert.deepEqual(new Set(result.sessions.map((item) => item.id)), new Set([current.id, active.id]));
  assert.deepEqual(result.events, []);
});

test("session budget preserves the active session and removes evicted session dependencies", () => {
  const active = session({ startedAt: iso(NOW - RETENTION_MS - 1) });
  const stoppedSessions = Array.from({ length: MAX_SESSIONS }, (_, index) => stopped({
    lastSequence: 1, updatedAt: iso(NOW - 500 + index), endedAt: iso(NOW - 500 + index),
  }));
  const state = {
    schemaVersion: 1, sessions: [active, ...stoppedSessions],
    events: stoppedSessions.map((owner) => event(owner, 1, { recordedAt: owner.endedAt })),
  };
  const result = pruneState(state, NOW);
  assert.equal(result.sessions.length, MAX_SESSIONS);
  assert.equal(result.events.length, MAX_SESSIONS - 1);
  assert.ok(result.sessions.some((item) => item.id === active.id));
  assert.ok(!result.sessions.some((item) => item.id === stoppedSessions[0].id));
  assert.ok(!result.events.some((item) => item.sessionId === stoppedSessions[0].id));
});

test("storage schema rejects excluded content, unknown versions, invalid scope, and broken dependencies", () => {
  const owner = session({ lastSequence: 1 });
  const valid = snapshot(owner, [event(owner)]);
  const mutations = [
    (state) => { state.schemaVersion = 2; },
    (state) => { state.rawEvents = []; },
    (state) => { state.sessions[0].schemaVersion = 2; },
    (state) => { state.sessions[0].fullUrl = "https://example.com/private"; },
    (state) => { state.sessions[0].origin = "https://example.com/private"; },
    (state) => { state.sessions[0].origin = "https://user:secret@example.com"; },
    (state) => { state.sessions[0].frameId = 3; },
    (state) => { state.sessions[0].epoch = "not-a-uuid"; },
    (state) => { state.sessions[0].segment = 0; },
    (state) => { state.sessions[0].pauseReason = "arbitrary page content"; },
    (state) => { state.sessions[0].pauseReason = undefined; },
    (state) => { state.sessions[0].updatedAt = "yesterday"; },
    (state) => { state.sessions.push(session()); },
    (state) => { state.events[0].text = "private label"; },
    (state) => { state.events[0].targetKey = "#private-selector"; },
    (state) => { state.events[0].fieldKind = "password"; },
    (state) => { state.events[0].action = "input"; },
    (state) => { state.events[0].sessionId = randomUUID(); },
    (state) => { state.events[0].sequence = 2; },
    (state) => { state.events[0].segment = 2; },
    (state) => { state.events.push({ ...state.events[0], id: randomUUID() }); },
    (state) => { state.events[0].recordedAt = iso(NOW + 1); },
    (state) => { state.events[0].action = "change"; },
  ];
  assert.equal(validateState(valid), valid);
  for (const mutate of mutations) {
    const state = structuredClone(valid);
    mutate(state);
    assert.throws(() => validateState(state), /INVALID_STORAGE/);
  }
});

test("reads and writes persist expiry, and returned snapshots do not alias stored state", async () => {
  const indexedDB = new IDBFactory();
  let currentTime = NOW;
  const repository = createRepository({ indexedDB, now: () => currentTime });
  assert.deepEqual(await repository.read(), emptyState());
  const owner = stopped({ lastSequence: 1 });
  const saved = await repository.update((state) => {
    state.sessions.push(owner);
    state.events.push(event(owner));
  });
  saved.sessions[0].origin = "https://changed.example";
  assert.equal((await repository.read()).sessions[0].origin, "https://example.com");
  currentTime += RETENTION_MS;
  assert.deepEqual(await repository.read(), emptyState());
  await repository.close();
  const reopened = createRepository({ indexedDB, now: () => NOW });
  assert.deepEqual(await reopened.read(), emptyState(), "expired records remain deleted even if the clock changes");
  await reopened.close();
});

test("atomic transactions preserve concurrent updates from independent repository instances", async () => {
  const indexedDB = new IDBFactory();
  const first = createRepository({ indexedDB, now: () => NOW });
  const second = createRepository({ indexedDB, now: () => NOW });
  await first.update((state) => { state.sessions.push(session()); });
  await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? first : second).update((state) => {
    state.sessions[0].revision += 1;
  })));
  assert.equal((await first.read()).sessions[0].revision, 21);
  await first.close();
  await second.close();
});

test("invalid or asynchronous mutations abort without changing committed data", async () => {
  const repository = createRepository({ indexedDB: new IDBFactory(), now: () => NOW });
  const before = await repository.update((state) => { state.sessions.push(session()); });
  await assert.rejects(repository.update((state) => {
    state.sessions[0].revision += 1;
    state.events.push({ privateValue: "must never commit" });
  }), /INVALID_STORAGE/);
  assert.deepEqual(await repository.read(), before);
  await assert.rejects(repository.update(async (state) => {
    state.sessions[0].revision += 1;
  }), /INVALID_MUTATOR/);
  assert.deepEqual(await repository.read(), before);
  await assert.rejects(repository.update(async () => {
    throw new Error("ASYNC_MUST_NOT_RUN");
  }), /INVALID_MUTATOR/);
  await assert.rejects(repository.update(() => { throw new Error("TEST_ABORT"); }), /TEST_ABORT/);
  assert.deepEqual(await repository.read(), before);
  await repository.close();
});

test("corrupted existing state fails closed; explicit clear is the only reset", async () => {
  const indexedDB = new IDBFactory();
  await rawPut(indexedDB, { schemaVersion: 99, sessions: [], events: [] });
  const repository = createRepository({ indexedDB, now: () => NOW });
  await assert.rejects(repository.read(), /INVALID_STORAGE/);
  await assert.rejects(repository.update((state) => { state.sessions = []; }), /INVALID_STORAGE/);
  assert.deepEqual(await repository.clear(), emptyState());
  assert.deepEqual(await repository.read(), emptyState());
  await repository.close();
});

test("unavailable IndexedDB and aborted writes reject without reporting success", async () => {
  await assert.rejects(createRepository({ indexedDB: null }).read(), /STORAGE_ERROR/);
  const indexedDB = new IDBFactory();
  const repository = createRepository({ indexedDB, now: () => NOW });
  const before = await repository.update((state) => { state.sessions.push(session()); });
  // Emulate a quota/disk failure at the write, after the mutator has completed.
  const request = indexedDB.open("repeatflow", 1);
  const database = await new Promise((resolve) => { request.onsuccess = () => resolve(request.result); });
  const store = database.transaction("state", "readwrite").objectStore("state");
  const prototype = Object.getPrototypeOf(store);
  const originalPut = prototype.put;
  prototype.put = function () { throw new DOMException("Disk unavailable", "QuotaExceededError"); };
  try {
    await assert.rejects(repository.update((state) => { state.sessions[0].revision += 1; }), { name: "QuotaExceededError" });
  } finally {
    prototype.put = originalPut;
    database.close();
  }
  assert.deepEqual(await repository.read(), before);
  await repository.close();
});
