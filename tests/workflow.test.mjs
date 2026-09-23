import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateWorkflow,
  validateStep,
  validateParameter,
  validateLocator,
  createWorkflowFromCandidate,
  requiresConfirmation,
} from '../extension/lib/workflow.js';

test('validateWorkflow accepts valid declarative workflow', () => {
  const time = '2026-09-23T08:00:00.000Z';
  const workflow = {
    schemaVersion: 1,
    id: '00000000-0000-4000-8000-000000000001',
    revision: 1,
    name: 'Dashboard Filter Workflow',
    origin: 'https://example.test',
    reviewedPath: '/dashboard',
    steps: [
      {
        id: '00000000-0000-4000-8000-000000000011',
        type: 'click',
        effect: 'local',
        timeoutMs: 5000,
        label: 'Open filters',
        target: {
          reviewedAt: time,
          locators: [
            { type: 'testAttribute', value: 'filter-btn', attributeName: 'data-testid' },
            { type: 'css', value: '#filter-btn' },
          ],
        },
        postcondition: { condition: 'visible', expected: true },
      },
      {
        id: '00000000-0000-4000-8000-000000000012',
        type: 'fill',
        effect: 'local',
        timeoutMs: 5000,
        parameter: 'status_val',
        target: {
          reviewedAt: time,
          locators: [{ type: 'css', value: '#status-input' }],
        },
      },
    ],
    parameters: [
      {
        name: 'status_val',
        label: 'Status Value',
        type: 'text',
        required: true,
        defaultValue: 'Active',
      },
    ],
    createdAt: time,
    updatedAt: time,
    reviewedRevision: 1,
    reviewedAt: time,
  };

  const valid = validateWorkflow(workflow);
  assert.equal(valid.name, 'Dashboard Filter Workflow');
  assert.equal(valid.steps.length, 2);
});

test('validateWorkflow rejects invalid versions, missing fields, or bad parameters', () => {
  const time = '2026-09-23T08:00:00.000Z';
  const base = {
    schemaVersion: 1,
    id: '00000000-0000-4000-8000-000000000001',
    revision: 1,
    name: 'Invalid Workflow',
    origin: 'https://example.test',
    reviewedPath: null,
    steps: [],
    parameters: [],
    createdAt: time,
    updatedAt: time,
    reviewedRevision: null,
    reviewedAt: null,
  };

  // 0 steps -> invalid
  assert.throws(() => validateWorkflow(base));

  // Step with undefined parameter reference -> invalid
  assert.throws(() => validateWorkflow({
    ...base,
    steps: [
      {
        id: '00000000-0000-4000-8000-000000000011',
        type: 'fill',
        effect: 'local',
        timeoutMs: 5000,
        parameter: 'nonexistent_param',
        target: { reviewedAt: time, locators: [{ type: 'css', value: 'input' }] },
      },
    ],
  }));

  // ReviewedRevision mismatch -> invalid
  assert.throws(() => validateWorkflow({
    ...base,
    revision: 2,
    reviewedRevision: 1, // Must match revision
    reviewedAt: time,
    steps: [
      {
        id: '00000000-0000-4000-8000-000000000011',
        type: 'click',
        effect: 'local',
        timeoutMs: 5000,
        target: { reviewedAt: time, locators: [{ type: 'css', value: 'button' }] },
      },
    ],
  }));
});

test('createWorkflowFromCandidate produces valid draft workflow with unreviewed status', () => {
  const candidate = {
    id: '00000000-0000-4000-8000-000000000001',
    sessionId: '00000000-0000-4000-8000-000000000002',
    symbols: [
      { action: 'click', targetKey: 'a'.repeat(64), fieldKind: 'none' },
      { action: 'change', targetKey: 'b'.repeat(64), fieldKind: 'select' },
      { action: 'change', targetKey: 'c'.repeat(64), fieldKind: 'checkbox' },
    ],
    occurrences: [
      { startSequence: 1, endSequence: 3 },
      { startSequence: 4, endSequence: 6 },
      { startSequence: 7, endSequence: 9 },
    ],
    createdAt: '2026-09-23T08:00:00.000Z',
    state: 'suggested',
  };

  const draft = createWorkflowFromCandidate(candidate, { origin: 'https://example.test' });
  assert.equal(draft.steps.length, 3);
  assert.equal(draft.reviewedRevision, null);
  assert.equal(draft.reviewedAt, null);
  assert.equal(draft.steps[0].type, 'click');
  assert.equal(draft.steps[1].type, 'select');
  assert.equal(draft.steps[2].type, 'setChecked');

  // Validates cleanly as draft
  validateWorkflow(draft);
});

test('requiresConfirmation detects external and unknown effects', () => {
  assert.equal(requiresConfirmation({ effect: 'external' }), true);
  assert.equal(requiresConfirmation({ effect: 'unknown' }), true);
  assert.equal(requiresConfirmation({ effect: 'local' }), false);
});
