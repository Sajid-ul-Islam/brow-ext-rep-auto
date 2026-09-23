import { test, expect, chromium } from '@playwright/test';
import path from 'node:path';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

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
