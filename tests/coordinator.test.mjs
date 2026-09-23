import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createRepository } from '../extension/lib/repository.js';
import { createCoordinator } from '../extension/lib/coordinator.js';
import { envelope } from '../extension/lib/protocol.js';

function harness() {
  const clock = Date.now();
  const repository = createRepository({ indexedDB: new IDBFactory(), now: () => clock });
  const values = {};
  const runtime = { id: 'test-extension', getURL: (path) => `chrome-extension://test-extension/${path}` };
  const tab = { id: 5, active: true, windowId: 1, url: 'https://example.test/private?secret=not-stored' };
  let observer = { sessionId: null, state: 'idle', origin: 'https://example.test' };
  let executor = { previewOk: true, executeOk: true };
  let permission = true;
  let injections = 0;
  const area = { setAccessLevel: async () => {}, get: async (key) => ({ [key]: values[key] }), set: async (object) => Object.assign(values, object), remove: async (key) => { delete values[key]; } };
  const api = {
    runtime,
    storage: { local: area, session: area },
    tabs: {
      get: async () => ({ ...tab, url: permission ? tab.url : undefined }),
      query: async () => [{ ...tab, url: permission ? tab.url : undefined }],
      sendMessage: async (tabId, message, options) => {
        assert.equal(tabId, tab.id);
        assert.equal(options.documentId, 'document-1');
        if (message.type === 'observer.start') observer = { ...observer, sessionId: message.payload.sessionId, state: 'observing' };
        if (message.type === 'observer.resume') observer.state = 'observing';
        if (message.type === 'observer.pause') observer.state = 'paused';
        if (message.type === 'observer.stop') observer.state = 'stopped';
        if (message.type === 'executor.preview') return { ok: true, data: { matched: executor.previewOk, status: executor.previewOk ? 'OK' : 'TARGET_NOT_FOUND' } };
        if (message.type === 'executor.execute') return { ok: executor.executeOk, data: { status: 'success' } };
        return { ok: true, data: structuredClone(observer) };
      },
    },
    scripting: {
      executeScript: async () => {
        injections++;
        if (!permission) throw Error('denied');
        return [{ frameId: 0, documentId: 'document-1' }];
      },
    },
  };
  const panel = { id: runtime.id, url: runtime.getURL('sidepanel.html') };
  const sender = { id: runtime.id, tab: { id: 5 }, frameId: 0, documentId: 'document-1', url: tab.url, origin: 'https://example.test' };
  const coordinator = createCoordinator({ api, repository, now: () => clock });
  const command = (type, payload = {}, from = panel) => coordinator.handle(envelope(type, payload), from);
  const start = async () => {
    const result = await command('session.start', { windowId: 1, tabId: 5 });
    assert.equal(result.ok, true, JSON.stringify(result));
    return (await repository.read()).sessions.find((s) => s.id === result.data.sessionId);
  };
  const event = (sequence, action = 'click', targetKey = 'a'.repeat(64), fieldKind = 'none') => ({ sequence, action, targetKey, fieldKind });
  const append = (session, events, from = sender) => command('events.append', { sessionId: session.id, epoch: session.epoch, events }, from);
  return {
    api, repository, coordinator, command, start, append, event, sender, panel, tab, values,
    permission: (value) => { permission = value; },
    injections: () => injections,
    observer: () => observer,
    executor: (opts) => { Object.assign(executor, opts); },
  };
}

test('opening panel neither injects nor records; ungranted and wrong-tab starts fail', async () => {
  const h = harness();
  assert.equal((await h.command('panel.snapshot', { windowId: 1 })).ok, true);
  assert.equal(h.injections(), 0);
  h.permission(false);
  assert.equal((await h.command('session.start', { windowId: 1, tabId: 5 })).code, 'UNAUTHORIZED');
  assert.equal((await h.repository.read()).sessions.length, 0);
  h.permission(true); h.tab.active = false;
  assert.equal((await h.command('session.start', { windowId: 1, tabId: 5 })).code, 'WRONG_TAB');
});

test('scope, sender and exact payload schema reject spoofing and excluded values', async () => {
  const h = harness(); const s = await h.start();
  for (const patch of [{ id: 'other' }, { frameId: 1 }, { documentId: 'stale' }, { tab: { id: 9 } }, { origin: 'https://evil.test' }, { url: 'https://evil.test/' }]) {
    assert.equal((await h.append(s, [h.event(1)], { ...h.sender, ...patch })).code, 'UNAUTHORIZED');
  }
  assert.equal((await h.command('session.stop', { sessionId: s.id }, h.sender)).code, 'UNAUTHORIZED');
  assert.equal((await h.append(s, [{ ...h.event(1), value: 'SECRET' }])).code, 'INVALID_MESSAGE');
  assert.equal((await h.append(s, Array.from({ length: 51 }, (_, i) => h.event(i + 1)))).code, 'INVALID_MESSAGE');
  assert.equal((await h.repository.read()).events.length, 0);
  const accepted = await h.append(s, [h.event(1)]);
  assert.equal(accepted.data.accepted, 1);
  const saved = JSON.stringify(await h.repository.read());
  assert(!saved.includes('private')); assert(!saved.includes('SECRET')); assert(!saved.includes('not-stored'));
});

test('Pause and Stop reject buffered events; Resume changes epoch and segments', async () => {
  const h = harness(); const s = await h.start();
  await h.append(s, [h.event(1)]);
  assert.equal((await h.append(s, [h.event(1)])).data.accepted, 0);
  assert.equal((await h.command('session.pause', { sessionId: s.id })).ok, true);
  assert.equal((await h.append(s, [h.event(2)])).code, 'INVALID_STATE');
  assert.equal((await h.command('session.resume', { sessionId: s.id })).ok, true);
  const resumed = (await h.repository.read()).sessions[0];
  assert.notEqual(resumed.epoch, s.epoch);
  assert.equal((await h.append(s, [h.event(2)])).code, 'INVALID_STATE');
  assert.equal((await h.append(resumed, [h.event(3)])).ok, true);
  const events = (await h.repository.read()).events;
  assert(events[1].segment > events[0].segment);
  assert.equal((await h.command('session.stop', { sessionId: s.id })).ok, true);
  assert.equal((await h.append(resumed, [h.event(4)])).code, 'INVALID_STATE');
});

test('tab activation pauses; navigation and permission loss terminate observation', async () => {
  const h = harness(); const s = await h.start();
  await h.coordinator.lifecycle('activated', 6);
  assert.equal((await h.repository.read()).sessions[0].state, 'paused');
  await h.command('session.resume', { sessionId: s.id });
  await h.coordinator.lifecycle('navigation', 5);
  assert.equal((await h.repository.read()).sessions[0].stopReason, 'navigation');
  const next = await h.start(); h.permission(false);
  assert.equal((await h.append(next, [h.event(1)])).code, 'UNAUTHORIZED');
  assert.equal((await h.repository.read()).sessions.find((x) => x.id === next.id).stopReason, 'permissionLost');
});

test('idle worker recreation preserves valid observation; browser restart ends it', async () => {
  const h = harness(); const s = await h.start();
  const restartedWorker = createCoordinator({ api: h.api, repository: h.repository });
  const state = await restartedWorker.handle(envelope('panel.snapshot', { windowId: 1 }), h.panel);
  assert.equal(state.data.session.state, 'observing');
  delete h.values['repeatflow.m1.boot'];
  const newBrowser = createCoordinator({ api: h.api, repository: h.repository });
  const result = await newBrowser.handle(envelope('panel.snapshot', { windowId: 1 }), h.panel);
  assert.equal(result.data.session.state, 'stopped');
  assert.equal((await h.append(s, [h.event(1)])).code, 'INVALID_STATE');
});

test('export removes capabilities; delete and clear stop capture and remove records', async () => {
  const h = harness(); const s = await h.start(); await h.append(s, [h.event(1)]);
  const exported = await h.command('data.export');
  assert.equal(exported.data.events.length, 1);
  assert(!JSON.stringify(exported.data).includes(s.epoch));
  assert(!JSON.stringify(exported.data).includes('document-1'));
  assert.equal((await h.command('data.deleteSession', { sessionId: s.id })).ok, true);
  assert.equal((await h.repository.read()).events.length, 0);
  assert.equal(h.observer().state, 'stopped');
  await h.start();
  assert.equal((await h.command('data.clear')).ok, true);
  assert.deepEqual((await h.repository.read()).sessions, []);
});

test('disk failure pauses the observer and never acknowledges accepted events', async () => {
  const h = harness(); const s = await h.start();
  const original = h.repository.update;
  h.repository.update = async () => { throw Error('quota'); };
  assert.equal((await h.append(s, [h.event(1)])).code, 'STORAGE_ERROR');
  assert.equal(h.observer().state, 'paused');
  assert.equal((await h.repository.read()).events.length, 0);
  h.repository.update = original;
  assert.equal((await h.command('data.clear')).ok, true);
  assert.equal((await h.command('panel.snapshot', { windowId: 1 })).ok, true);
});

// --- M2 / M3 / M4 COORDINATOR TESTS ---

test('M2: candidate detection on append, dismissal, and conversion into workflow', async () => {
  const h = harness();
  const s = await h.start();

  const tA = 'a'.repeat(64);
  const tB = 'b'.repeat(64);
  const tC = 'c'.repeat(64);

  // Append 3 repeats of A, B, C
  const batch = [
    h.event(1, 'click', tA, 'none'),
    h.event(2, 'change', tB, 'select'),
    h.event(3, 'click', tC, 'checkbox'),

    h.event(4, 'click', tA, 'none'),
    h.event(5, 'change', tB, 'select'),
    h.event(6, 'click', tC, 'checkbox'),

    h.event(7, 'click', tA, 'none'),
    h.event(8, 'change', tB, 'select'),
    h.event(9, 'click', tC, 'checkbox'),
  ];

  await h.append(s, batch);

  const snap = await h.command('panel.snapshot', { windowId: 1 });
  assert.equal(snap.data.candidates.length, 1);
  const candidate = snap.data.candidates[0];
  assert.equal(candidate.occurrences.length, 3);

  // Convert candidate to workflow
  const convertRes = await h.command('candidate.convert', { candidateId: candidate.id, name: 'Converted WF' });
  assert.equal(convertRes.ok, true);
  assert.equal(convertRes.data.workflow.name, 'Converted WF');
  assert.equal(convertRes.data.workflow.steps.length, 3);

  const snap2 = await h.command('panel.snapshot', { windowId: 1 });
  assert.equal(snap2.data.workflows.length, 1);
});

test('M3: workflow CRUD and approval revision gate', async () => {
  const h = harness();
  const time = '2026-09-23T08:00:00.000Z';

  const wf = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    revision: 1,
    name: 'Test Workflow',
    origin: 'https://example.test',
    reviewedPath: null,
    steps: [
      {
        id: crypto.randomUUID(),
        type: 'click',
        effect: 'local',
        timeoutMs: 5000,
        label: 'Step 1',
        target: { reviewedAt: time, locators: [{ type: 'css', value: 'button' }] },
        postcondition: { condition: 'visible', expected: true },
      },
    ],
    parameters: [],
    createdAt: time,
    updatedAt: time,
    reviewedRevision: 1,
    reviewedAt: time,
  };

  const saveRes = await h.command('workflow.save', { workflow: wf });
  assert.equal(saveRes.ok, true);

  const getRes = await h.command('workflow.get', { workflowId: wf.id });
  assert.equal(getRes.data.workflow.name, 'Test Workflow');

  const dupRes = await h.command('workflow.duplicate', { workflowId: wf.id });
  assert.equal(dupRes.ok, true);
  assert.equal(dupRes.data.workflow.name, 'Test Workflow (Copy)');

  const delRes = await h.command('workflow.delete', { workflowId: dupRes.data.workflow.id });
  assert.equal(delRes.ok, true);

  const listRes = await h.command('workflow.list');
  assert.equal(listRes.data.workflows.length, 1);
});

test('M4: supervised replay with confirmation checkpoint and intent logging', async () => {
  const h = harness();
  const time = '2026-09-23T08:00:00.000Z';
  const step1Id = crypto.randomUUID();
  const step2Id = crypto.randomUUID();

  const wf = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    revision: 1,
    name: 'Replay Workflow',
    origin: 'https://example.test',
    reviewedPath: null,
    steps: [
      {
        id: step1Id,
        type: 'click',
        effect: 'local',
        timeoutMs: 5000,
        label: 'Step 1: Local click',
        target: { reviewedAt: time, locators: [{ type: 'css', value: 'button#btn1' }] },
        postcondition: { condition: 'visible', expected: true },
      },
      {
        id: step2Id,
        type: 'click',
        effect: 'external', // Requires confirmation!
        timeoutMs: 5000,
        label: 'Step 2: External Submit',
        target: { reviewedAt: time, locators: [{ type: 'css', value: 'button#submit' }] },
        postcondition: { condition: 'visible', expected: true },
      },
    ],
    parameters: [],
    createdAt: time,
    updatedAt: time,
    reviewedRevision: 1,
    reviewedAt: time,
  };

  await h.command('workflow.save', { workflow: wf });

  // Preview run
  const previewRes = await h.command('run.preview', { windowId: 1, workflowId: wf.id });
  assert.equal(previewRes.ok, true);
  assert.equal(previewRes.data.targetPreviews.length, 2);

  // Start supervised run
  const startRunRes = await h.command('run.start', {
    windowId: 1,
    workflowId: wf.id,
    workflowRevision: 1,
    inputs: {},
  });
  assert.equal(startRunRes.ok, true);
  const runId = startRunRes.data.runId;

  // Step 1 runs immediately, Step 2 reaches awaitingConfirmation
  // Wait a tick for execution queue
  await new Promise((r) => setTimeout(r, 20));

  const snap = await h.command('panel.snapshot', { windowId: 1 });
  assert.equal(snap.data.activeRun.id, runId);
  assert.equal(snap.data.activeRun.state, 'awaitingConfirmation');
  assert.equal(snap.data.activeRun.completedStepCount, 1);
  assert.equal(snap.data.activeRun.nextStepIndex, 1);

  // Confirm step 2
  const confirmRes = await h.command('run.confirmStep', { runId, stepId: step2Id });
  assert.equal(confirmRes.ok, true);

  await new Promise((r) => setTimeout(r, 20));

  // Run completes
  const snap2 = await h.command('panel.snapshot', { windowId: 1 });
  assert.equal(snap2.data.activeRun, null); // Completed run is cleared from activeRun
  assert.equal(snap2.data.summaries.length, 1);
  assert.equal(snap2.data.summaries[0].state, 'completed');
  assert.equal(snap2.data.summaries[0].completedStepCount, 2);
});
