import { envelope, fail, isPanelSender, isSessionSender, originOf, PANEL_TYPES, validateMessage } from './protocol.js';
import { detectRepetitions } from './detector.js';
import { validateWorkflow, createWorkflowFromCandidate, requiresConfirmation } from './workflow.js';

const BOOT_KEY = 'repeatflow.m1.boot';
const KNOWN_ERRORS = new Set([
  'INVALID_MESSAGE', 'UNAUTHORIZED', 'UNSUPPORTED_PAGE', 'WRONG_TAB',
  'NO_SESSION', 'NO_WORKFLOW', 'NO_RUN', 'INVALID_STATE', 'SCOPE_CHANGED',
  'OBSERVER_MISSING', 'EXECUTOR_MISSING', 'STORAGE_ERROR', 'SESSION_ACTIVE',
  'RUN_ACTIVE', 'UNREVIEWED_WORKFLOW', 'INVALID_WORKFLOW', 'TARGET_NOT_FOUND',
  'TARGET_AMBIGUOUS', 'TARGET_DISABLED', 'TARGET_HIDDEN', 'CONFIRMATION_REQUIRED',
]);

const activeSession = (state) => state.sessions.find((s) => s.state !== 'stopped');
const activeRun = (state) => (state.runs || []).find((r) => !['completed', 'cancelled', 'failed'].includes(r.state));

/** One mutation queue, durable transactions, and adapters for boundary tests. */
export function createCoordinator({
  api,
  repository,
  now = () => Date.now(),
  uuid = () => crypto.randomUUID(),
}) {
  let queue = Promise.resolve();
  let initialized = false;
  let storageFailed = false;
  let currentSession = null;
  let currentRun = null;
  const blocked = new Set();
  const runInputs = new Map(); // In-memory only: runId -> inputs map

  const stamp = () => new Date(now()).toISOString();

  const enqueue = (task) => {
    const operation = queue.then(task);
    queue = operation.catch(() => {});
    return operation;
  };

  async function storage(operation) {
    try {
      const state = await operation();
      currentSession = activeSession(state) ?? null;
      currentRun = activeRun(state) ?? null;
      return state;
    } catch (error) {
      if (KNOWN_ERRORS.has(error.message) && error.message !== 'STORAGE_ERROR') throw error;
      storageFailed = true;
      if (currentSession) {
        blocked.add(currentSession.id);
        await quietSend(currentSession, 'observer.pause');
      }
      fail('STORAGE_ERROR');
    }
  }

  async function boot() {
    if (initialized) return;
    await api.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    await api.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    const marker = await api.storage.session.get(BOOT_KEY);
    if (!marker[BOOT_KEY]) {
      await storage(() => repository.update((state) => {
        for (const session of state.sessions) {
          if (session.state !== 'stopped') endRecord(session, 'restart');
        }
        for (const run of state.runs || []) {
          if (!['completed', 'cancelled', 'failed'].includes(run.state)) {
            run.state = run.pendingIntent ? 'needsAttention' : 'cancelled';
            run.endedAt = stamp();
            run.updatedAt = stamp();
            (state.summaries = state.summaries || []).push({
              schemaVersion: 1,
              id: uuid(),
              workflowId: run.workflowId,
              workflowRevision: run.workflowRevision,
              origin: run.origin,
              state: run.state,
              startedAt: run.startedAt,
              endedAt: run.endedAt,
              completedStepCount: run.completedStepCount,
              failedStepId: run.pendingIntent?.stepId ?? null,
              errorCode: 'RESTART',
            });
          }
        }
      }));
      await api.storage.session.set({ [BOOT_KEY]: uuid() });
    }
    initialized = true;
  }

  function endRecord(session, reason) {
    const time = stamp();
    Object.assign(session, {
      state: 'stopped',
      stopReason: reason,
      pauseReason: null,
      updatedAt: time,
      endedAt: time,
      revision: session.revision + 1,
    });
  }

  async function read() {
    return storage(() => repository.read());
  }

  async function send(session, type, payload = { sessionId: session.id }) {
    return api.tabs.sendMessage(session.tabId, envelope(type, payload), { documentId: session.documentId });
  }

  async function quietSend(session, type) {
    try { await send(session, type); } catch { /* Gone documents cannot collect. */ }
  }

  async function sendToRun(run, type, payload = {}) {
    return api.tabs.sendMessage(run.tabId, envelope(type, payload), { documentId: run.documentId });
  }

  async function stop(session, reason = 'user') {
    blocked.add(session.id);
    const result = await storage(() => repository.update((state) => {
      const current = state.sessions.find((item) => item.id === session.id);
      if (current && current.state !== 'stopped') endRecord(current, reason);
      // Run detection after session stops
      const sessionEvents = (state.events || []).filter((e) => e.sessionId === session.id);
      const newCandidates = detectRepetitions(sessionEvents, { sessionId: session.id, uuid, now });
      state.candidates = state.candidates || [];
      for (const cand of newCandidates) {
        if (!state.candidates.some((c) => c.sessionId === cand.sessionId && JSON.stringify(c.symbols) === JSON.stringify(cand.symbols))) {
          state.candidates.push(cand);
        }
      }
    }));
    await quietSend(session, 'observer.stop');
    return result;
  }

  async function pause(session, reason = 'user') {
    blocked.add(session.id);
    const result = await storage(() => repository.update((state) => {
      const current = state.sessions.find((item) => item.id === session.id);
      if (current?.state === 'observing') {
        Object.assign(current, {
          state: 'paused',
          pauseReason: reason,
          updatedAt: stamp(),
          revision: current.revision + 1,
        });
      }
    }));
    await quietSend(session, 'observer.pause');
    return result;
  }

  async function tabScope(tabId) {
    let tab;
    try { tab = await api.tabs.get(tabId); } catch { fail('SCOPE_CHANGED'); }
    if (!tab.active) fail('WRONG_TAB');
    const origin = originOf(tab.url);
    if (!origin) fail(tab.url ? 'UNSUPPORTED_PAGE' : 'UNAUTHORIZED');
    return { tab, origin };
  }

  async function verify(session) {
    const { origin } = await tabScope(session.tabId);
    if (origin !== session.origin) fail('SCOPE_CHANGED');
    let answer;
    try { answer = await send(session, 'observer.probe', {}); } catch { fail('OBSERVER_MISSING'); }
    if (!answer?.ok || answer.data?.sessionId !== session.id || answer.data.origin !== session.origin
      || !['observing', 'paused'].includes(answer.data.state)) fail('OBSERVER_MISSING');
    return answer.data;
  }

  async function reconcile() {
    const state = await read();
    const session = activeSession(state);
    if (!session) return state;
    try {
      const probe = await verify(session);
      if (session.state === 'observing' && probe.state === 'paused') return pause(session, 'connectionLost');
    } catch (error) {
      if (error.message === 'WRONG_TAB') return pause(session, 'tabInactive');
      return stop(session, error.message === 'UNAUTHORIZED' ? 'permissionLost' : 'contextLost');
    }
    return state;
  }

  async function snapshot(windowId) {
    const state = await reconcile();
    const [tab] = await api.tabs.query({ active: true, windowId });
    const origin = originOf(tab?.url);
    const counts = new Map();
    for (const event of state.events) counts.set(event.sessionId, (counts.get(event.sessionId) ?? 0) + 1);
    const sessions = state.sessions.map((session) => ({ ...session, eventCount: counts.get(session.id) ?? 0 }))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

    const candidates = (state.candidates || []).filter((c) => c.state !== 'dismissed');
    const workflows = state.workflows || [];
    const run = activeRun(state) ?? null;
    const summaries = state.summaries || [];

    return {
      activeTab: tab ? { id: tab.id, origin, authorized: Boolean(origin), supported: Boolean(origin) || !tab.url } : null,
      session: sessions.find((s) => s.state !== 'stopped') ?? sessions[0] ?? null,
      sessions,
      candidates,
      workflows,
      activeRun: run,
      summaries,
      eventCount: state.events.length,
      totalSessions: sessions.length,
      retention: { maxEvents: 10000, maxDays: 7 },
    };
  }

  async function start(payload) {
    if (activeSession(await reconcile())) fail('SESSION_ACTIVE');
    const { tab, origin } = await tabScope(payload.tabId);
    if (tab.windowId !== payload.windowId) fail('WRONG_TAB');
    let injected;
    try {
      injected = await api.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [0] },
        files: ['observer.js'],
        world: 'ISOLATED',
      });
    } catch {
      fail('UNAUTHORIZED');
    }
    const frame = injected.find((result) => result.frameId === 0);
    if (!frame?.documentId) fail('SCOPE_CHANGED');
    const time = stamp();
    const session = {
      schemaVersion: 1, id: uuid(), revision: 1, epoch: uuid(), segment: 1,
      tabId: tab.id, frameId: 0, documentId: frame.documentId, origin, state: 'observing',
      startedAt: time, updatedAt: time, endedAt: null, lastSequence: 0, stopReason: null, pauseReason: null,
    };
    await storage(() => repository.update((draft) => { draft.sessions.push(session); }));
    try {
      if ((await tabScope(tab.id)).origin !== origin || blocked.has(session.id)) fail('SCOPE_CHANGED');
      const answer = await send(session, 'observer.start', { sessionId: session.id, epoch: session.epoch });
      if (!answer?.ok || answer.data?.origin !== origin || answer.data?.sessionId !== session.id) fail('OBSERVER_MISSING');
    } catch (error) {
      await stop(session, 'contextLost');
      fail(KNOWN_ERRORS.has(error.message) ? error.message : 'OBSERVER_MISSING');
    }
    return { sessionId: session.id };
  }

  async function resume(session) {
    if (session.state !== 'paused') fail('INVALID_STATE');
    await verify(session);
    const epoch = uuid();
    blocked.delete(session.id);
    await storage(() => repository.update((state) => {
      const current = state.sessions.find((item) => item.id === session.id);
      Object.assign(current, {
        state: 'observing',
        pauseReason: null,
        epoch,
        segment: current.segment + 1,
        revision: current.revision + 1,
        updatedAt: stamp(),
      });
    }));
    try {
      if (blocked.has(session.id)) fail('INVALID_STATE');
      const answer = await send(session, 'observer.resume', { sessionId: session.id, epoch });
      if (!answer?.ok) fail('OBSERVER_MISSING');
    } catch {
      await pause(session, 'connectionLost');
      fail('OBSERVER_MISSING');
    }
    return {};
  }

  async function append(payload, sender) {
    const session = (await read()).sessions.find((item) => item.id === payload.sessionId);
    if (!session || !isSessionSender(sender, session, api.runtime)) fail('UNAUTHORIZED');
    if (session.state !== 'observing' || session.epoch !== payload.epoch || blocked.has(session.id)) fail('INVALID_STATE');
    try {
      if ((await tabScope(session.tabId)).origin !== session.origin) fail('SCOPE_CHANGED');
    } catch (error) {
      if (error.message === 'WRONG_TAB') await pause(session, 'tabInactive');
      else await stop(session, 'permissionLost');
      throw error;
    }
    let accepted = 0;
    let lastSequence = session.lastSequence;
    await storage(() => repository.update((draft) => {
      const current = draft.sessions.find((item) => item.id === session.id);
      if (blocked.has(session.id) || current.state !== 'observing' || current.epoch !== payload.epoch) fail('INVALID_STATE');
      const time = stamp();
      for (const event of payload.events) {
        if (event.sequence <= current.lastSequence) continue;
        if (event.sequence !== current.lastSequence + 1) current.segment += 1;
        draft.events.push({ schemaVersion: 1, id: uuid(), sessionId: session.id, recordedAt: time, ...event, segment: current.segment });
        current.lastSequence = event.sequence;
        accepted += 1;
      }
      current.updatedAt = time;
      current.revision += 1;
      lastSequence = current.lastSequence;

      // Detect repetitions after new events
      const sessionEvents = draft.events.filter((e) => e.sessionId === session.id);
      const newCandidates = detectRepetitions(sessionEvents, { sessionId: session.id, uuid, now });
      draft.candidates = draft.candidates || [];
      for (const cand of newCandidates) {
        if (!draft.candidates.some((c) => c.sessionId === cand.sessionId && JSON.stringify(c.symbols) === JSON.stringify(cand.symbols))) {
          draft.candidates.push(cand);
        }
      }
    }));
    return { accepted, lastSequence };
  }

  // --- M2 Candidates ---
  async function dismissCandidate(candidateId) {
    await storage(() => repository.update((draft) => {
      const cand = (draft.candidates || []).find((c) => c.id === candidateId);
      if (cand) cand.state = 'dismissed';
    }));
    return {};
  }

  async function convertCandidate(candidateId, customName) {
    let createdWorkflow = null;
    await storage(() => repository.update((draft) => {
      const cand = (draft.candidates || []).find((c) => c.id === candidateId);
      if (!cand) fail('INVALID_MESSAGE');
      const session = draft.sessions.find((s) => s.id === cand.sessionId);
      if (!session) fail('NO_SESSION');
      cand.state = 'converted';
      createdWorkflow = createWorkflowFromCandidate(cand, {
        origin: session.origin,
        name: customName || `Repeated task on ${session.origin}`,
        uuid,
        now,
      });
      draft.workflows = draft.workflows || [];
      draft.workflows.push(createdWorkflow);
    }));
    return { workflow: createdWorkflow };
  }

  // --- M3 Workflows ---
  async function saveWorkflow(workflow) {
    validateWorkflow(workflow);
    await storage(() => repository.update((draft) => {
      draft.workflows = draft.workflows || [];
      const idx = draft.workflows.findIndex((w) => w.id === workflow.id);
      if (idx >= 0) {
        draft.workflows[idx] = workflow;
      } else {
        draft.workflows.push(workflow);
      }
    }));
    return { workflow };
  }

  async function deleteWorkflow(workflowId) {
    await storage(() => repository.update((draft) => {
      draft.workflows = (draft.workflows || []).filter((w) => w.id !== workflowId);
    }));
    return {};
  }

  async function duplicateWorkflow(workflowId) {
    let duplicated = null;
    await storage(() => repository.update((draft) => {
      const original = (draft.workflows || []).find((w) => w.id === workflowId);
      if (!original) fail('NO_WORKFLOW');
      const time = stamp();
      duplicated = {
        ...structuredClone(original),
        id: uuid(),
        name: `${original.name} (Copy)`.slice(0, 120),
        revision: 1,
        createdAt: time,
        updatedAt: time,
        reviewedRevision: null,
        reviewedAt: null,
        steps: original.steps.map((s) => ({ ...s, id: uuid() })),
      };
      draft.workflows.push(duplicated);
    }));
    return { workflow: duplicated };
  }

  // --- M4 Supervised Replay ---
  async function ensureExecutor(tabId) {
    try {
      const injected = await api.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        files: ['executor.js'],
        world: 'ISOLATED',
      });
      const frame = injected.find((r) => r.frameId === 0);
      if (!frame?.documentId) fail('SCOPE_CHANGED');
      return frame.documentId;
    } catch {
      fail('UNAUTHORIZED');
    }
  }

  async function previewRun(windowId, workflowId) {
    const state = await read();
    const workflow = (state.workflows || []).find((w) => w.id === workflowId);
    if (!workflow) fail('NO_WORKFLOW');
    const [tab] = await api.tabs.query({ active: true, windowId });
    if (!tab) fail('WRONG_TAB');
    const origin = originOf(tab.url);
    if (origin !== workflow.origin) fail('SCOPE_CHANGED');

    const documentId = await ensureExecutor(tab.id);
    const previewResults = [];

    for (const step of workflow.steps) {
      if (step.type === 'waitFor') {
        previewResults.push({ stepId: step.id, status: 'OK', matched: true, interactable: true });
        continue;
      }
      try {
        const res = await api.tabs.sendMessage(
          tab.id,
          envelope('executor.preview', { step }),
          { documentId }
        );
        previewResults.push({ stepId: step.id, ...res.data });
      } catch {
        previewResults.push({ stepId: step.id, status: 'EXECUTOR_MISSING', matched: false });
      }
    }

    return { workflow, targetPreviews: previewResults };
  }

  async function startRun({ windowId, workflowId, workflowRevision, inputs }) {
    if (activeRun(await read())) fail('RUN_ACTIVE');
    const state = await read();
    const workflow = (state.workflows || []).find((w) => w.id === workflowId);
    if (!workflow) fail('NO_WORKFLOW');
    if (workflow.reviewedRevision !== workflowRevision || workflow.revision !== workflowRevision) {
      fail('UNREVIEWED_WORKFLOW');
    }

    const [tab] = await api.tabs.query({ active: true, windowId });
    if (!tab) fail('WRONG_TAB');
    const origin = originOf(tab.url);
    if (origin !== workflow.origin) fail('SCOPE_CHANGED');

    const documentId = await ensureExecutor(tab.id);
    const time = stamp();
    const runId = uuid();

    // Store inputs in memory
    runInputs.set(runId, inputs || {});

    const run = {
      schemaVersion: 1,
      id: runId,
      revision: 1,
      workflowId,
      workflowRevision,
      tabId: tab.id,
      frameId: 0,
      documentId,
      origin,
      state: 'running',
      nextStepIndex: 0,
      completedStepCount: 0,
      pendingIntent: null,
      lastOutcome: null,
      startedAt: time,
      updatedAt: time,
      endedAt: null,
    };

    await storage(() => repository.update((draft) => {
      draft.runs = draft.runs || [];
      draft.runs.push(run);
    }));

    // Trigger step execution
    void executeNextStep(runId);

    return { runId };
  }

  async function executeNextStep(runId) {
    return enqueue(async () => {
      const state = await read();
      const run = (state.runs || []).find((r) => r.id === runId);
      if (!run || run.state !== 'running') return;

      const workflow = (state.workflows || []).find((w) => w.id === run.workflowId);
      if (!workflow) {
        await finishRun(runId, 'failed', 'NO_WORKFLOW');
        return;
      }

      if (run.nextStepIndex >= workflow.steps.length) {
        await finishRun(runId, 'completed');
        return;
      }

      const step = workflow.steps[run.nextStepIndex];
      const inputs = runInputs.get(runId) || {};
      const stepInput = step.parameter ? inputs[step.parameter] : step.value;

      // Check if step requires confirmation
      if (requiresConfirmation(step) && run.confirmedStepId !== step.id) {
        await storage(() => repository.update((draft) => {
          const current = (draft.runs || []).find((r) => r.id === runId);
          if (current) {
            current.state = 'awaitingConfirmation';
            current.updatedAt = stamp();
            current.revision += 1;
          }
        }));
        return;
      }

      // Pre-commit pendingIntent before dispatch
      const dispatchId = uuid();
      const time = stamp();
      await storage(() => repository.update((draft) => {
        const current = (draft.runs || []).find((r) => r.id === runId);
        if (current) {
          current.pendingIntent = {
            stepId: step.id,
            dispatchId,
            effect: step.effect,
            recordedAt: time,
          };
          current.updatedAt = time;
          current.revision += 1;
        }
      }));

      // Dispatch to executor
      try {
        const res = await sendToRun(run, 'executor.execute', {
          step,
          input: stepInput,
          dispatchId,
        });

        if (res?.ok) {
          await storage(() => repository.update((draft) => {
            const current = (draft.runs || []).find((r) => r.id === runId);
            if (current && current.state === 'running') {
              current.lastOutcome = {
                stepId: step.id,
                status: 'success',
                code: 'OK',
                recordedAt: stamp(),
              };
              current.completedStepCount += 1;
              current.nextStepIndex += 1;
              current.pendingIntent = null;
              current.confirmedStepId = null;
              current.updatedAt = stamp();
              current.revision += 1;
            }
          }));

          // Continue to next step
          void executeNextStep(runId);
        } else {
          await finishRun(runId, 'failed', res?.code || 'EXECUTION_FAILED', step.id);
        }
      } catch (err) {
        await finishRun(runId, 'needsAttention', 'CONNECTION_LOST', step.id);
      }
    });
  }

  async function confirmStep(runId, stepId) {
    const state = await read();
    const run = (state.runs || []).find((r) => r.id === runId);
    if (!run || run.state !== 'awaitingConfirmation') fail('INVALID_STATE');

    const workflow = (state.workflows || []).find((w) => w.id === run.workflowId);
    const step = workflow?.steps[run.nextStepIndex];
    if (step?.id !== stepId) fail('INVALID_MESSAGE');

    await storage(() => repository.update((draft) => {
      const current = (draft.runs || []).find((r) => r.id === runId);
      if (current) {
        current.state = 'running';
        current.confirmedStepId = stepId;
        current.updatedAt = stamp();
        current.revision += 1;
      }
    }));

    void executeNextStep(runId);
    return {};
  }

  async function pauseRun(runId) {
    await storage(() => repository.update((draft) => {
      const current = (draft.runs || []).find((r) => r.id === runId);
      if (current && (current.state === 'running' || current.state === 'awaitingConfirmation')) {
        current.state = 'paused';
        current.updatedAt = stamp();
        current.revision += 1;
      }
    }));
    return {};
  }

  async function resumeRun(runId) {
    const state = await read();
    const run = (state.runs || []).find((r) => r.id === runId);
    if (!run || run.state !== 'paused') fail('INVALID_STATE');

    const { origin } = await tabScope(run.tabId);
    if (origin !== run.origin) fail('SCOPE_CHANGED');

    await storage(() => repository.update((draft) => {
      const current = (draft.runs || []).find((r) => r.id === runId);
      if (current) {
        current.state = 'running';
        current.updatedAt = stamp();
        current.revision += 1;
      }
    }));

    void executeNextStep(runId);
    return {};
  }

  async function stopRun(runId) {
    await finishRun(runId, 'cancelled');
    return {};
  }

  async function finishRun(runId, finalState, errorCode = null, failedStepId = null) {
    const time = stamp();
    await storage(() => repository.update((draft) => {
      const current = (draft.runs || []).find((r) => r.id === runId);
      if (current) {
        current.state = finalState;
        current.endedAt = time;
        current.updatedAt = time;
        current.pendingIntent = null;
        current.revision += 1;

        (draft.summaries = draft.summaries || []).push({
          schemaVersion: 1,
          id: uuid(),
          workflowId: current.workflowId,
          workflowRevision: current.workflowRevision,
          origin: current.origin,
          state: finalState,
          startedAt: current.startedAt,
          endedAt: time,
          completedStepCount: current.completedStepCount,
          failedStepId: failedStepId ?? (finalState === 'failed' ? current.lastOutcome?.stepId : null),
          errorCode,
        });
      }
    }));
    runInputs.delete(runId);
  }

  async function clear() {
    if (currentSession) { blocked.add(currentSession.id); await quietSend(currentSession, 'observer.stop'); }
    try {
      const state = await repository.read();
      for (const session of state.sessions) {
        if (session.state !== 'stopped') {
          blocked.add(session.id);
          await quietSend(session, 'observer.stop');
        }
      }
    } catch { /* Deliberate reset */ }
    await storage(() => repository.clear());
    await api.storage.local.remove('repeatflow.shell.settings');
    await api.storage.session.set({ [BOOT_KEY]: uuid() });
    initialized = true;
    storageFailed = false;
    runInputs.clear();
    return {};
  }

  async function dispatch(message, sender) {
    if (message.type === 'data.clear') return clear();
    await boot();
    if (storageFailed) fail('STORAGE_ERROR');
    const p = message.payload;

    if (message.type === 'panel.snapshot') return snapshot(p.windowId);
    if (message.type === 'session.start') return start(p);
    if (message.type === 'events.append') return append(p, sender);

    // M2
    if (message.type === 'candidate.dismiss') return dismissCandidate(p.candidateId);
    if (message.type === 'candidate.convert') return convertCandidate(p.candidateId, p.name);

    // M3
    if (message.type === 'workflow.list') return { workflows: (await read()).workflows || [] };
    if (message.type === 'workflow.get') {
      const wf = ((await read()).workflows || []).find((w) => w.id === p.workflowId);
      if (!wf) fail('NO_WORKFLOW');
      return { workflow: wf };
    }
    if (message.type === 'workflow.save') return saveWorkflow(p.workflow);
    if (message.type === 'workflow.delete') return deleteWorkflow(p.workflowId);
    if (message.type === 'workflow.duplicate') return duplicateWorkflow(p.workflowId);
    if (message.type === 'workflow.import') {
      const parsed = JSON.parse(p.json);
      return saveWorkflow(parsed);
    }

    // M4
    if (message.type === 'run.preview') return previewRun(p.windowId, p.workflowId);
    if (message.type === 'run.start') return startRun(p);
    if (message.type === 'run.confirmStep') return confirmStep(p.runId, p.stepId);
    if (message.type === 'run.pause') return pauseRun(p.runId);
    if (message.type === 'run.resume') return resumeRun(p.runId);
    if (message.type === 'run.stop') return stopRun(p.runId);

    if (message.type === 'data.export') {
      const state = await reconcile();
      return {
        schemaVersion: 1,
        exportedAt: stamp(),
        sessions: state.sessions.map(({ id, origin, state: s, startedAt, endedAt }) => ({ id, origin, state: s, startedAt, endedAt })),
        events: state.events,
        candidates: state.candidates || [],
        workflows: state.workflows || [],
        summaries: state.summaries || [],
      };
    }

    const session = (await read()).sessions.find((item) => item.id === p.sessionId);
    if (!session) fail('NO_SESSION');

    if (message.type === 'observer.end') {
      if (!isSessionSender(sender, session, api.runtime)) fail('UNAUTHORIZED');
      if (p.reason === 'tabHidden' || p.reason === 'contextLost') {
        await pause(session, p.reason === 'tabHidden' ? 'tabInactive' : 'connectionLost');
      } else {
        await stop(session, p.reason);
      }
    } else if (message.type === 'session.pause') {
      if (session.state !== 'observing') fail('INVALID_STATE');
      await pause(session);
    } else if (message.type === 'session.resume') {
      return resume(session);
    } else if (message.type === 'session.stop') {
      await stop(session);
    } else if (message.type === 'data.deleteSession') {
      if (session.state !== 'stopped') await stop(session);
      await storage(() => repository.update((draft) => {
        draft.sessions = draft.sessions.filter((item) => item.id !== session.id);
        draft.events = draft.events.filter((item) => item.sessionId !== session.id);
        draft.candidates = (draft.candidates || []).filter((item) => item.sessionId !== session.id);
      }));
    }
    return {};
  }

  async function handle(message, sender) {
    try {
      validateMessage(message);
      if (PANEL_TYPES.has(message.type)) {
        if (!isPanelSender(sender, api.runtime)) fail('UNAUTHORIZED');
      } else if (sender?.id !== api.runtime.id || !sender.tab || sender.frameId !== 0) {
        fail('UNAUTHORIZED');
      }
      if (['session.pause', 'session.stop', 'data.deleteSession'].includes(message.type)) {
        blocked.add(message.payload.sessionId);
      }
      if (message.type === 'data.clear' && currentSession) blocked.add(currentSession.id);
      return { ok: true, data: await enqueue(() => dispatch(message, sender)) };
    } catch (error) {
      return { ok: false, code: KNOWN_ERRORS.has(error.message) ? error.message : 'INTERNAL_ERROR' };
    }
  }

  function lifecycle(kind, tabId) {
    if (currentSession && (kind === 'restart' || (kind === 'activated' ? currentSession.tabId !== tabId : currentSession.tabId === tabId))) {
      blocked.add(currentSession.id);
    }
    return enqueue(async () => {
      await boot();
      const state = await read();
      const session = activeSession(state);
      if (session) {
        if (kind === 'activated') {
          if (session.tabId !== tabId) await pause(session, 'tabInactive');
        } else if (kind === 'restart' || session.tabId === tabId) {
          await stop(session, kind === 'removed' ? 'tabClosed' : kind === 'restart' ? 'restart' : 'navigation');
        }
      }

      // Check active run on tab changes
      const run = activeRun(state);
      if (run) {
        if (kind === 'activated' && run.tabId !== tabId) {
          await pauseRun(run.id);
        } else if (kind === 'restart' || run.tabId === tabId) {
          await finishRun(run.id, 'cancelled', kind === 'removed' ? 'TAB_CLOSED' : kind === 'restart' ? 'RESTART' : 'NAVIGATION');
        }
      }
    }).catch(() => { storageFailed = true; });
  }

  return { handle, lifecycle };
}
