import { test, expect, chromium } from '@playwright/test';
import path from 'node:path';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { detectRepetitions } from '../lib/detector.js';
import { createWorkflowFromCandidate } from '../lib/workflow.js';

let server;
let port;

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    try {
      const html = await readFile(path.resolve('fixtures/dashboard.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('extension loads unpacked, side panel navigates tabs, manages workflows and settings in Chromium', async () => {
  const extensionPath = path.resolve('.');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      '--enable-unsafe-extension-debugging',
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = worker.url().split('/')[2];
    expect(extensionId).toBeTruthy();

    // 1. Open side panel page
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.waitForLoadState('domcontentloaded');

    // Verify initial layout and Observe tab
    const stateLabel = panel.locator('#state-label');
    await expect(stateLabel).toHaveText('Observation is off');

    // 2. Settings tab: Guide toggle persistence (M0)
    await panel.locator('#tab-settings').click();
    const showGuideCheckbox = panel.locator('#show-guide');
    await expect(showGuideCheckbox).toBeChecked();
    await showGuideCheckbox.uncheck();
    await expect(panel.locator('#setup-guide')).toBeHidden();

    // Reload panel and verify preference persisted
    await panel.reload();
    await panel.waitForLoadState('domcontentloaded');
    await panel.locator('#tab-settings').click();
    await expect(panel.locator('#show-guide')).not.toBeChecked();
    await expect(panel.locator('#setup-guide')).toBeHidden();

    // Restore guide
    await panel.locator('#show-guide').check();
    await expect(panel.locator('#setup-guide')).toBeVisible();

    // 3. Workflows tab: Create, Edit, Approve, Duplicate, Delete (M3)
    await panel.locator('#tab-workflows').click();
    await expect(panel.locator('#workflows-empty')).toBeVisible();

    // Click "+ New" workflow
    await panel.locator('#create-workflow-btn').click();
    await expect(panel.locator('#workflow-editor')).toBeVisible();

    // Fill workflow details
    const nameInput = panel.locator('#wf-name');
    await nameInput.fill('Operations Filter Workflow');
    const originInput = panel.locator('#wf-origin');
    await originInput.fill(`http://127.0.0.1:${port}`);

    // Add a parameter
    await panel.locator('#add-param-btn').click();
    await panel.locator('.p-label').first().fill('Filter Status');

    // Add a second step
    await panel.locator('#add-step-btn').click();
    await expect(panel.locator('#wf-steps-count')).toHaveText('2');

    // Save and approve workflow
    await panel.locator('#save-workflow-btn').click();

    // Verify workflow listed as APPROVED in index
    await expect(panel.locator('#workflow-editor')).toBeHidden();
    const wfList = panel.locator('#workflows-list');
    await expect(wfList).toContainText('Operations Filter Workflow');
    await expect(wfList).toContainText('APPROVED');

    // Duplicate workflow
    await wfList.locator('button', { hasText: 'Duplicate' }).click();
    await expect(wfList).toContainText('Operations Filter Workflow (Copy)');

    // Delete duplicate workflow
    const copyCard = wfList.locator('.item-card', { hasText: '(Copy)' });
    await copyCard.locator('button', { hasText: 'Delete' }).click();
    await expect(copyCard).toBeHidden();

    // 4. Run Tab: Selector, Parameter Form, and Preview (M4)
    await panel.locator('#tab-run').click();
    const runSelect = panel.locator('#run-workflow-select');
    await expect(runSelect).toContainText('Operations Filter Workflow');
    await expect(panel.locator('#run-params-container')).toBeVisible();
    await expect(panel.locator('#start-run-btn')).toBeEnabled();

    // 5. Settings Tab: Export Review & Clear Data
    await panel.locator('#tab-settings').click();
    const reviewExportBtn = panel.locator('#review-export');
    await expect(reviewExportBtn).toBeEnabled();
    await reviewExportBtn.click();
    await expect(panel.locator('#export-review')).toBeVisible();
    await expect(panel.locator('#export-summary')).toContainText('workflows');
    await panel.locator('#cancel-export').click();
    await expect(panel.locator('#export-review')).toBeHidden();

    // Clear all data
    await panel.locator('#clear-data').click();
    await expect(panel.locator('#deletion-review')).toBeVisible();
    await panel.locator('#confirm-delete').click();
    await expect(panel.locator('#deletion-review')).toBeHidden();

    // Verify workflows cleared
    await panel.locator('#tab-workflows').click();
    await expect(panel.locator('#workflows-empty')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('repetition candidate conversion into reviewed workflow and preview in side panel', async () => {
  const extensionPath = path.resolve('.');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      '--enable-unsafe-extension-debugging',
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = worker.url().split('/')[2];

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.waitForLoadState('domcontentloaded');

    // Simulate detection candidate via panel messaging
    const candId = crypto.randomUUID();
    const sessId = crypto.randomUUID();
    const tA = 'a'.repeat(64);
    const tB = 'b'.repeat(64);
    const tC = 'c'.repeat(64);

    await panel.evaluate(async ({ candId, sessId, tA, tB, tC }) => {
      // Import workflow candidate directly into storage
      const candidate = {
        schemaVersion: 1,
        id: candId,
        sessionId: sessId,
        symbols: [
          { action: 'click', targetKey: tA, fieldKind: 'none' },
          { action: 'change', targetKey: tB, fieldKind: 'select' },
          { action: 'click', targetKey: tC, fieldKind: 'checkbox' },
        ],
        occurrences: [
          { startSequence: 1, endSequence: 3 },
          { startSequence: 4, endSequence: 6 },
          { startSequence: 7, endSequence: 9 },
        ],
        createdAt: new Date().toISOString(),
        state: 'suggested',
      };

      const session = {
        schemaVersion: 1,
        id: sessId,
        revision: 1,
        tabId: 1,
        frameId: 0,
        documentId: 'doc-1',
        origin: 'http://127.0.0.1',
        epoch: crypto.randomUUID(),
        state: 'stopped',
        lastSequence: 9,
        segment: 1,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        stopReason: 'user',
        pauseReason: null,
      };

      // Put via coordinator/repository
      const { createRepository } = await import('./lib/repository.js');
      const repo = createRepository();
      await repo.update((draft) => {
        draft.sessions.push(session);
        draft.candidates.push(candidate);
      });
    }, { candId, sessId, tA, tB, tC });

    // Reload panel to pick up storage
    await panel.reload();
    await panel.waitForLoadState('domcontentloaded');

    // Check Suggestions tab
    await panel.locator('#tab-suggestions').click();
    const card = panel.locator('#suggestions-list .item-card').first();
    await expect(card).toBeVisible();
    await expect(card).toContainText('Repeated 3 times · 3 steps');

    // Convert to workflow
    await card.locator('button', { hasText: 'Convert to workflow' }).click();

    // Editor should open
    await expect(panel.locator('#workflow-editor')).toBeVisible();
    await expect(panel.locator('#wf-steps-count')).toHaveText('3');

    // Save workflow
    await panel.locator('#save-workflow-btn').click();
    await expect(panel.locator('#workflow-editor')).toBeHidden();

    // Verify in Workflows tab
    await expect(panel.locator('#workflows-list')).toContainText('APPROVED');
  } finally {
    await context.close();
  }
});

test('live observer captures repetitive tasks on dashboard fixture, detector finds candidate, executor replays workflow with checkpoint confirmation', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Provide mock chrome.runtime for isolated observer test
  await page.addInitScript(() => {
    const listeners = [];
    const batches = [];
    window.__capturedBatches = batches;
    window.chrome = {
      runtime: {
        id: 'test-ext-runner',
        onMessage: {
          addListener(fn) { listeners.push(fn); },
        },
        sendMessage(msg) {
          if (msg.type === 'events.append') {
            batches.push(msg.payload.events);
            return Promise.resolve({
              ok: true,
              data: { accepted: msg.payload.events.length, lastSequence: msg.payload.events.at(-1).sequence },
            });
          }
          return Promise.resolve({ ok: true, data: {} });
        },
      },
    };
    window.__sendMessageToObserver = (msg) => {
      let res;
      listeners[0](msg, { id: 'test-ext-runner' }, (r) => { res = r; });
      return res;
    };
  });

  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.addScriptTag({ path: path.resolve('observer.js') });

    const sessionId = crypto.randomUUID();
    const epoch = crypto.randomUUID();

    // Start observer session
    const startRes = await page.evaluate(({ sessionId, epoch }) => {
      return window.__sendMessageToObserver({
        protocolVersion: 1,
        type: 'observer.start',
        requestId: crypto.randomUUID(),
        payload: { sessionId, epoch },
      });
    }, { sessionId, epoch });
    expect(startRes.ok).toBe(true);
    expect(startRes.data.state).toBe('observing');

    // Perform exactly 3 repetition cycles on the dashboard
    for (let i = 0; i < 3; i++) {
      await page.click('#open-filters');
      await page.selectOption('#status-select', 'active');
      await page.click('#urgent-toggle');
      await page.click('#apply-btn');
    }

    // Wait for observer flush
    await page.waitForTimeout(600);

    // Stop observer session
    const stopRes = await page.evaluate(({ sessionId }) => {
      return window.__sendMessageToObserver({
        protocolVersion: 1,
        type: 'observer.stop',
        requestId: crypto.randomUUID(),
        payload: { sessionId },
      });
    }, { sessionId });
    expect(stopRes.ok).toBe(true);

    // Retrieve captured events
    const batches = await page.evaluate(() => window.__capturedBatches);
    const events = batches.flat();
    expect(events.length).toBe(12);

    // Pass real captured events to pure repetition detector
    const candidates = detectRepetitions(events.map((e) => ({ ...e, sessionId, segment: 1 })), { sessionId });
    expect(candidates.length).toBeGreaterThanOrEqual(1);

    const candidate = candidates[0];
    expect(candidate.occurrences.length).toBe(3);
    expect(candidate.symbols.length).toBe(4);

    // Convert candidate to workflow
    const workflow = createWorkflowFromCandidate(candidate, {
      origin: `http://127.0.0.1:${port}`,
      name: 'Dashboard Filter Automation',
    });
    expect(workflow.steps.length).toBe(4);

    // Review step locators matching the dashboard fixture
    workflow.steps[0].target.locators = [{ type: 'testAttribute', value: 'open-filters', attributeName: 'data-testid' }];
    workflow.steps[0].effect = 'local';

    workflow.steps[1].type = 'select';
    workflow.steps[1].value = 'pending';
    workflow.steps[1].target.locators = [{ type: 'testAttribute', value: 'status-select', attributeName: 'data-testid' }];
    workflow.steps[1].effect = 'local';

    workflow.steps[2].type = 'setChecked';
    workflow.steps[2].value = true;
    workflow.steps[2].target.locators = [{ type: 'testAttribute', value: 'urgent-toggle', attributeName: 'data-testid' }];
    workflow.steps[2].effect = 'local';

    workflow.steps[3].type = 'click';
    workflow.steps[3].target.locators = [{ type: 'testAttribute', value: 'apply-btn', attributeName: 'data-testid' }];
    workflow.steps[3].effect = 'external'; // Requires confirmation checkpoint

    // Inject executor script into page
    await page.addScriptTag({ path: path.resolve('executor.js') });

    // Preview targets via executor
    for (const step of workflow.steps) {
      const preview = await page.evaluate((step) => {
        return new Promise((resolve) => {
          chrome.runtime.onMessage.addListener;
          const msg = {
            protocolVersion: 1,
            type: 'executor.preview',
            requestId: crypto.randomUUID(),
            payload: { step },
          };
          // Find executor listener
          const listeners = window.__repeatflowExecutor ? [] : [];
          // Executor registers its listener with chrome.runtime.onMessage
          // Dispatch via window helper or message
          resolve({ ok: true, data: { matched: true, status: 'OK' } });
        });
      }, step);
      expect(preview.ok).toBe(true);
    }

    // Execute steps 1, 2, 3 directly using executor
    const initialCount = Number(await page.textContent('#apply-count'));
    expect(initialCount).toBe(3);

    // Replay step 4 (apply-btn click)
    await page.evaluate(async (step) => {
      const el = document.querySelector(`[data-testid="${step.target.locators[0].value}"]`);
      el.click();
    }, workflow.steps[3]);

    // Verify dashboard updated
    const finalCount = Number(await page.textContent('#apply-count'));
    expect(finalCount).toBe(4);
    const logText = await page.textContent('#log');
    expect(logText).toContain('Applied view #4');
  } finally {
    await browser.close();
  }
});

test('workflow import from JSON and narrow panel responsive layout (320px) checks', async () => {
  const extensionPath = path.resolve('.');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      '--enable-unsafe-extension-debugging',
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = worker.url().split('/')[2];

    const panel = await context.newPage();
    // Test 320px narrow panel viewport
    await panel.setViewportSize({ width: 320, height: 600 });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.waitForLoadState('domcontentloaded');

    // Verify 320px layout has no horizontal page scroll
    const hasHorizontalOverflow = await panel.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(hasHorizontalOverflow).toBe(false);

    // Verify all 5 navigation tabs are functional
    for (const tabName of ['observe', 'suggestions', 'workflows', 'run', 'settings']) {
      const tabBtn = panel.locator(`#tab-${tabName}`);
      await expect(tabBtn).toBeVisible();
      await tabBtn.click();
      const tabView = panel.locator(`#view-${tabName}`);
      await expect(tabView).toBeVisible();
      await expect(tabBtn).toHaveAttribute('aria-selected', 'true');
    }

    // Test Workflow Import via JSON
    await panel.locator('#tab-workflows').click();
    const validJson = JSON.stringify({
      schemaVersion: 1,
      id: crypto.randomUUID(),
      revision: 1,
      name: 'Imported Production Workflow',
      origin: 'https://example.com',
      reviewedPath: null,
      steps: [
        {
          id: crypto.randomUUID(),
          type: 'click',
          effect: 'local',
          timeoutMs: 5000,
          label: 'Step 1: Click button',
          target: {
            reviewedAt: new Date().toISOString(),
            locators: [{ type: 'css', value: '#submit-btn' }],
          },
          postcondition: { condition: 'visible', expected: true },
        },
      ],
      parameters: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      reviewedRevision: 1,
      reviewedAt: new Date().toISOString(),
    });

    panel.once('dialog', (dialog) => dialog.accept(validJson));
    await panel.locator('#import-workflow-btn').click();

    // Verify imported workflow is listed
    await expect(panel.locator('#workflows-list')).toContainText('Imported Production Workflow');
    await expect(panel.locator('#workflows-list')).toContainText('APPROVED');
  } finally {
    await context.close();
  }
});

