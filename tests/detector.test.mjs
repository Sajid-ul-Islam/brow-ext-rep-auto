import test from 'node:test';
import assert from 'node:assert/strict';
import { detectRepetitions, symbolKey } from '../extension/lib/detector.js';

function makeEvent(sequence, action, targetKey, fieldKind, segment = 1, sessionId = '00000000-0000-4000-8000-000000000001') {
  return {
    schemaVersion: 1,
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    sessionId,
    sequence,
    segment,
    recordedAt: '2026-09-23T08:00:00.000Z',
    action,
    targetKey,
    fieldKind,
  };
}

test('detectRepetitions finds exact 3 contiguous repeats', () => {
  const tA = 'a'.repeat(64);
  const tB = 'b'.repeat(64);
  const tC = 'c'.repeat(64);

  // Pattern: A, B, C repeated 3 times
  const events = [
    makeEvent(1, 'click', tA, 'none'),
    makeEvent(2, 'change', tB, 'select'),
    makeEvent(3, 'click', tC, 'checkbox'),

    makeEvent(4, 'click', tA, 'none'),
    makeEvent(5, 'change', tB, 'select'),
    makeEvent(6, 'click', tC, 'checkbox'),

    makeEvent(7, 'click', tA, 'none'),
    makeEvent(8, 'change', tB, 'select'),
    makeEvent(9, 'click', tC, 'checkbox'),
  ];

  const candidates = detectRepetitions(events);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].symbols.length, 3);
  assert.equal(candidates[0].occurrences.length, 3);
  assert.deepEqual(candidates[0].occurrences[0], { startSequence: 1, endSequence: 3 });
  assert.deepEqual(candidates[0].occurrences[1], { startSequence: 4, endSequence: 6 });
  assert.deepEqual(candidates[0].occurrences[2], { startSequence: 7, endSequence: 9 });
  assert.equal(candidates[0].state, 'suggested');
});

test('detectRepetitions rejects sequences with only 2 repeats (below threshold)', () => {
  const tA = 'a'.repeat(64);
  const tB = 'b'.repeat(64);
  const tC = 'c'.repeat(64);

  const events = [
    makeEvent(1, 'click', tA, 'none'),
    makeEvent(2, 'change', tB, 'select'),
    makeEvent(3, 'click', tC, 'checkbox'),

    makeEvent(4, 'click', tA, 'none'),
    makeEvent(5, 'change', tB, 'select'),
    makeEvent(6, 'click', tC, 'checkbox'),
  ];

  const candidates = detectRepetitions(events);
  assert.equal(candidates.length, 0);
});

test('detectRepetitions handles interleaved noise between occurrences', () => {
  const tA = 'a'.repeat(64);
  const tB = 'b'.repeat(64);
  const tC = 'c'.repeat(64);
  const tNoise = 'f'.repeat(64);

  const events = [
    makeEvent(1, 'click', tA, 'none'),
    makeEvent(2, 'change', tB, 'select'),
    makeEvent(3, 'click', tC, 'checkbox'),

    makeEvent(4, 'click', tNoise, 'none'), // Noise

    makeEvent(5, 'click', tA, 'none'),
    makeEvent(6, 'change', tB, 'select'),
    makeEvent(7, 'click', tC, 'checkbox'),

    makeEvent(8, 'click', tNoise, 'none'), // Noise

    makeEvent(9, 'click', tA, 'none'),
    makeEvent(10, 'change', tB, 'select'),
    makeEvent(11, 'click', tC, 'checkbox'),
  ];

  const candidates = detectRepetitions(events);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].occurrences.length, 3);
  assert.deepEqual(candidates[0].occurrences[0], { startSequence: 1, endSequence: 3 });
  assert.deepEqual(candidates[0].occurrences[1], { startSequence: 5, endSequence: 7 });
  assert.deepEqual(candidates[0].occurrences[2], { startSequence: 9, endSequence: 11 });
});

test('detectRepetitions suppresses redundant contained shorter candidates', () => {
  const tA = 'a'.repeat(64);
  const tB = 'b'.repeat(64);
  const tC = 'c'.repeat(64);
  const tD = 'd'.repeat(64);

  // ABCD repeated 3 times
  const events = [
    makeEvent(1, 'click', tA, 'none'),
    makeEvent(2, 'change', tB, 'select'),
    makeEvent(3, 'click', tC, 'checkbox'),
    makeEvent(4, 'click', tD, 'radio'),

    makeEvent(5, 'click', tA, 'none'),
    makeEvent(6, 'change', tB, 'select'),
    makeEvent(7, 'click', tC, 'checkbox'),
    makeEvent(8, 'click', tD, 'radio'),

    makeEvent(9, 'click', tA, 'none'),
    makeEvent(10, 'change', tB, 'select'),
    makeEvent(11, 'click', tC, 'checkbox'),
    makeEvent(12, 'click', tD, 'radio'),
  ];

  const candidates = detectRepetitions(events);
  // Should keep only the 4-step candidate ABCD and suppress ABC and BCD
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].symbols.length, 4);
});

test('detectRepetitions respects segment boundaries and does not bridge interrupted sequences', () => {
  const tA = 'a'.repeat(64);
  const tB = 'b'.repeat(64);
  const tC = 'c'.repeat(64);

  // Segment 1 has 2 events, Segment 2 has 1 event (an interruption occurred between B and C)
  const events = [
    makeEvent(1, 'click', tA, 'none', 1),
    makeEvent(2, 'change', tB, 'select', 1),
    makeEvent(3, 'click', tC, 'checkbox', 2), // Different segment

    makeEvent(4, 'click', tA, 'none', 2),
    makeEvent(5, 'change', tB, 'select', 2),
    makeEvent(6, 'click', tC, 'checkbox', 2),

    makeEvent(7, 'click', tA, 'none', 3),
    makeEvent(8, 'change', tB, 'select', 3),
    makeEvent(9, 'click', tC, 'checkbox', 3),
  ];

  const candidates = detectRepetitions(events);
  // Only segment 2 and 3 had full ABC, so occurrences = 2 < 3 -> no candidates
  assert.equal(candidates.length, 0);
});
