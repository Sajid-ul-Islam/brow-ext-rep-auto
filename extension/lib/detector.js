/**
 * Pure repetition detection module (M2).
 * Operates on normalized, bounded M1 events without Chrome APIs or DOM dependencies.
 */

export const MIN_SEQUENCE_LENGTH = 3;
export const MAX_SEQUENCE_LENGTH = 30;
export const MIN_OCCURRENCES = 3;

/**
 * Normalizes an event into a comparable symbol.
 * @param {{ action: string, targetKey: string, fieldKind: string }} event
 * @returns {string}
 */
export function symbolKey(event) {
  return `${event.action}:${event.targetKey}:${event.fieldKind}`;
}

/**
 * Finds repeated contiguous sequences of symbols within a session.
 * @param {Array<object>} events - Session events sorted by sequence.
 * @param {object} [options]
 * @param {string} [options.sessionId]
 * @param {() => string} [options.uuid]
 * @param {() => number} [options.now]
 * @returns {Array<object>} Candidates sorted deterministically.
 */
export function detectRepetitions(events, {
  sessionId = events[0]?.sessionId ?? crypto.randomUUID(),
  uuid = () => crypto.randomUUID(),
  now = () => Date.now(),
} = {}) {
  if (!Array.isArray(events) || events.length < MIN_SEQUENCE_LENGTH * MIN_OCCURRENCES) {
    return [];
  }

  // Group events by segment to preserve interruption boundaries.
  const segments = new Map();
  for (const event of events) {
    if (!segments.has(event.segment)) segments.set(event.segment, []);
    segments.get(event.segment).push(event);
  }

  // Build a linear list of symbols per segment with sequence mappings
  const segmentEntries = [];
  for (const [, segmentEvents] of segments) {
    if (segmentEvents.length < MIN_SEQUENCE_LENGTH) continue;
    const sorted = [...segmentEvents].sort((a, b) => a.sequence - b.sequence);
    const symbols = sorted.map((e) => ({
      key: symbolKey(e),
      action: e.action,
      targetKey: e.targetKey,
      fieldKind: e.fieldKind,
      sequence: e.sequence,
    }));
    segmentEntries.push(symbols);
  }

  // Collect candidate sequences of length L from MIN_SEQUENCE_LENGTH to MAX_SEQUENCE_LENGTH
  const candidateMap = new Map();

  for (const symbols of segmentEntries) {
    const len = symbols.length;
    for (let l = MIN_SEQUENCE_LENGTH; l <= Math.min(MAX_SEQUENCE_LENGTH, len); l += 1) {
      for (let i = 0; i <= len - l; i += 1) {
        const slice = symbols.slice(i, i + l);
        const sequenceSignature = slice.map((s) => s.key).join('|');
        if (!candidateMap.has(sequenceSignature)) {
          candidateMap.set(sequenceSignature, {
            signature: sequenceSignature,
            length: l,
            symbols: slice.map(({ action, targetKey, fieldKind }) => ({ action, targetKey, fieldKind })),
          });
        }
      }
    }
  }

  // For each unique candidate sequence, find all non-overlapping occurrences across all segments
  const validCandidates = [];

  for (const candidate of candidateMap.values()) {
    const targetKeys = candidate.signature.split('|');
    const targetLen = candidate.length;
    const occurrences = [];

    for (const symbols of segmentEntries) {
      let idx = 0;
      while (idx <= symbols.length - targetLen) {
        let match = true;
        for (let k = 0; k < targetLen; k += 1) {
          if (symbols[idx + k].key !== targetKeys[k]) {
            match = false;
            break;
          }
        }
        if (match) {
          occurrences.push({
            startSequence: symbols[idx].sequence,
            endSequence: symbols[idx + targetLen - 1].sequence,
          });
          idx += targetLen; // Non-overlapping
        } else {
          idx += 1;
        }
      }
    }

    if (occurrences.length >= MIN_OCCURRENCES) {
      validCandidates.push({
        signature: candidate.signature,
        length: candidate.length,
        symbols: candidate.symbols,
        occurrences,
        firstSequence: occurrences[0].startSequence,
      });
    }
  }

  if (validCandidates.length === 0) return [];

  // Deterministic ranking:
  // 1. Length descending (longer sequence preferred)
  // 2. Occurrence count descending
  // 3. First start sequence ascending (earlier appearance)
  validCandidates.sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    if (b.occurrences.length !== a.occurrences.length) return b.occurrences.length - a.occurrences.length;
    return a.firstSequence - b.firstSequence;
  });

  // Suppress redundant contained candidates:
  // If shorter candidate S_short has all its occurrences completely contained inside
  // occurrences of a longer candidate S_long, suppress S_short.
  const retained = [];

  for (const candidate of validCandidates) {
    let redundant = false;
    for (const longer of retained) {
      if (longer.length > candidate.length) {
        const fullyContained = candidate.occurrences.every((occ) => {
          return longer.occurrences.some((longOcc) => {
            return occ.startSequence >= longOcc.startSequence && occ.endSequence <= longOcc.endSequence;
          });
        });
        if (fullyContained) {
          redundant = true;
          break;
        }
      }
    }
    if (!redundant) {
      retained.push(candidate);
    }
  }

  const timestamp = new Date(now()).toISOString();

  return retained.map((item) => ({
    schemaVersion: 1,
    id: uuid(),
    sessionId,
    symbols: item.symbols,
    occurrences: item.occurrences,
    createdAt: timestamp,
    state: 'suggested',
  }));
}
