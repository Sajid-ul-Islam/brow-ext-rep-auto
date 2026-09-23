# RepeatFlow data model

Status: M1–M5 data contracts implemented and verified, 2026-09-23. The shell preference, observation sessions, events, candidates, declarative workflows, run checkpoints, run summaries, and messaging protocol are fully implemented. Related documents: [architecture](arc.md), [rules](rule.md), [roadmap](roadmap.md).

## 1. Implemented shell preference

`chrome.storage.local` key: `repeatflow.shell.settings`.

```json
{ "schemaVersion": 1, "showGuide": true }
```

`showGuide` is a boolean. Missing/invalid values display the guide by default without writing a default record. The user checkbox writes the preference. Observation records are separate from this preference. No workflow or run records exist yet.

## 2. Proposed shared rules

All persisted records have integer `schemaVersion: 1`. IDs are extension-generated UUIDs; dates are UTC ISO 8601 strings; counters are non-negative safe integers. Reject unknown fields at inbound trust boundaries so a payload cannot smuggle excluded page data into storage. Limit messages to 32 KiB, event batches to 50 events, workflows to 30 steps, strings to explicit per-field bounds, and imports to 1 MiB. Revisit limits only with measured need.

M1 persists `{ schemaVersion: 1, sessions: [], events: [] }` at key `m1` in object store `state`, IndexedDB database `repeatflow` version 1, in atomic read/write transactions. This bounded snapshot favors simple consistent deletion and validation; split stores may be introduced with a migration when measured scale requires it. The worker owns mutations. Use JSON-compatible values; never executable code, DOM nodes, functions, or arbitrary serialized browser objects. Browser-derived sender scope overrides payload claims. Origins must equal `new URL(value).origin` for an allowed HTTP(S) page; reject credentials, paths, queries, fragments, and opaque origins.

Observation data is intentionally insufficient for automatic locator reconstruction. Do not add a hidden “raw event” field. Even minimized structural metadata can be sensitive.

## 3. ObservationSession — M1

| Field | Type / constraints |
| --- | --- |
| `schemaVersion`, `id`, `revision` | Version `1`, UUID, monotonically increasing integer |
| `tabId`, `frameId`, `documentId` | Browser tab integer, exactly `0`, browser-provided document string |
| `origin` | Origin only; derived and validated by coordinator |
| `state` | `observing`, `paused`, `stopped` |
| `startedAt`, `updatedAt`, `endedAt` | UTC times; `endedAt` null until stopped |
| `lastSequence` | Highest accepted event sequence, initially `0` |
| `epoch`, `segment` | UUID refreshed on Resume; positive segment integer incremented at Resume or event gaps |
| `pauseReason` | Null or `user`, `tabInactive`, `connectionLost` |
| `stopReason` | Null or enum: `user`, `navigation`, `permissionLost`, `tabClosed`, `restart`, `storageError`, `overflow`, `contextLost` |

Create after explicit Start and successful injection. A session is tied to one document for its lifetime. Persist metadata for recovery, not permission to start a new observer automatically. After normal worker suspension, the same still-authorized observer may reconnect through a fresh handshake that validates session state, active tab, and document; extension/browser restart stops the session. The observer's session salt and transient target references stay in its memory and are discarded at Stop/document loss. If those transient values are lost, end the old session and require a fresh Start. Retain stopped session summaries, including empty sessions, up to seven days and 250 total summaries so the panel can explain termination. Eviction removes dependent events. Preserve the single active session as authorization bookkeeping.

## 4. ObservedEvent — M1

```json
{
  "schemaVersion": 1,
  "id": "8ee6e842-a6f4-46ed-8cd8-d1ddce31ded7",
  "sessionId": "cde3807b-a282-4471-a5d3-b3ae707d01c2",
  "sequence": 12,
  "segment": 1,
  "recordedAt": "2026-09-23T08:00:00.000Z",
  "action": "change",
  "targetKey": "session-scoped-opaque-digest",
  "fieldKind": "select"
}
```

`action` is `click` or `change`; `fieldKind` admitted by the M1 message boundary is `none`, `select`, `checkbox`, or `radio`; text/number fields are excluded. The repository validator reserves those two enums for a future reviewed expansion. Do not read values to create these fields. `targetKey` is a bounded opaque digest of a session-salted, sanitized structural tuple; the tuple excludes text and arbitrary attribute values and is never persisted. Use standard cryptographic primitives and collision-resistant encodings when implemented. Session context provides origin/tab/frame/document; do not duplicate complete URLs in each event.

Accept only events from the active authorized session, in sequence, from the expected browser sender. Ignore synthetic/replay events. Duplicate `(sessionId, sequence)` pairs are idempotently discarded; gaps are marked as segment boundaries so a detector cannot join events across missing evidence. Store no keystrokes, values, value lengths, labels, selectors, IDs, classes, coordinates, clipboard data, or page HTML. Excluded/sensitive controls produce no event.

Retention: expire events after seven days and keep no more than 10,000 total across all sessions, evicting oldest first. Apply expiry before access/export as well as on writes/startup.

## 5. Candidate — M2

| Field | Type / constraints |
| --- | --- |
| `schemaVersion`, `id`, `sessionId` | Version and extension-generated identity |
| `symbols` | 3–30 `{ action, targetKey, fieldKind }` tuples, exactly matching normalized events |
| `occurrences` | At least three `{ startSequence, endSequence }` ranges; contiguous, same length, sorted, non-overlapping |
| `createdAt` | UTC time |
| `state` | `suggested`, `dismissed`, `converted` |

Every occurrence must reference retained, uninterrupted evidence in the same session. Count is derived from validated ranges, not a separate mutable metric. Candidates do not carry input values, replayable selectors, confidence scores, or automation approval. Delete candidates if evidence expires/deletes or falls below threshold. A converted workflow is an independent reviewed record and can survive source-event deletion.

## 6. Workflow — M3

| Field | Type / constraints |
| --- | --- |
| `schemaVersion`, `id`, `revision` | Version, UUID, increment revision on every edit |
| `name` | User-written plain text, 1–120 characters; discourage private details |
| `origin` | One approved HTTP(S) origin |
| `reviewedPath` | Null by default; optional user-reviewed pathname only, no credentials/query/hash; never auto-captured |
| `steps` | 1–30 validated declarative steps |
| `parameters` | At most 30 non-secret definitions with unique names |
| `createdAt`, `updatedAt` | UTC times |
| `reviewedRevision`, `reviewedAt` | Null for draft; must match current revision before Run |

Path values may contain personal data despite removing query/fragment; show the exact value before save. Workflow names and locator literals are user-reviewed content, not observation data. Store workflows until user deletion.

A step has `id`, `type`, `target` when applicable, `parameter` when needed, `effect`, `timeoutMs`, and optional `postcondition`. Allowed types: `click`, `fill`, `select`, `setChecked`, `waitFor`. No navigation, script, fetch, or arbitrary expression step exists. `timeoutMs` is 100–30,000; wait conditions are allowlisted `visible`, `hidden`, `enabled`, or `checked` with explicit expected boolean where relevant. Conditions cannot contain functions.

`effect` is `local`, `external`, or `unknown`. Unknown defaults to a confirmation gate. Submitting, sending, deleting, publishing, and purchasing remain gated even if metadata claims `local`; auto-save fields require the same treatment. Execution policy can increase safeguards but a saved record cannot disable them.

`target` contains at most four ordered reviewed locator alternatives and `reviewedAt`. Alternatives are allowlisted `testAttribute`, `roleAndName`, `id`, or `css`; literal strings are bounded to 256 characters and shown during review. Test attributes must use an approved attribute name, such as `data-testid`, rather than arbitrary scraped attributes. CSS is selector data only, never script. Sensitive values are prohibited; automated heuristics supplement rather than replace explicit review. Save no raw observation fingerprint as a working locator. Alternatives that match must identify the same previewed target; zero matches may permit a later fallback, while ambiguity or conflicting matches stop the run.

Parameters have `name` (identifier up to 64 characters), `label` (up to 120 characters), `type` (`text`, `number`, `boolean`, or `option`), `required`, and optional explicitly reviewed non-secret `defaultValue`. No password/OTP/payment/secret type exists. Actual run-only inputs remain in side-panel memory and never enter events, checkpoints, summaries, exports, or console logs.

## 7. RunCheckpoint and RunSummary — M4

| Field | Type / constraints |
| --- | --- |
| `schemaVersion`, `id`, `revision` | Version, run UUID, transaction revision |
| `workflowId`, `workflowRevision` | Exact reviewed workflow version |
| `tabId`, `frameId`, `documentId`, `origin` | Authorized browser scope; top frame only |
| `state` | `previewing`, `running`, `awaitingConfirmation`, `paused`, `completed`, `cancelled`, `failed`, `needsAttention` |
| `nextStepIndex`, `completedStepCount` | Bounded integers referencing the workflow |
| `pendingIntent` | Null or `{ stepId, dispatchId, effect, recordedAt }`; no input values |
| `lastOutcome` | Null or `{ stepId, status, code, recordedAt }`; bounded enums only |
| `startedAt`, `updatedAt`, `endedAt` | UTC times; nullable end |

Write `pendingIntent` before dispatch, then commit its acknowledgement and next index together. Reject repeated/stale dispatch identifiers. An unresolved intent after interruption means `needsAttention`; never infer failure and dispatch the step again. Confirmations are temporary capabilities bound to a run, step, workflow revision, scope, and target review, and are invalidated by interruption or change. They are not reusable workflow properties.

After a terminal outcome, compact the checkpoint into a summary: identity, workflow revision, origin, start/end, final status, completed count, failed step ID if present, and bounded error code. Keep origin for per-origin deletion even after its workflow is deleted; discard tab/frame/document scope and pending state that are no longer needed. Retain summaries for 30 days or 1,000 total, whichever removes data earlier. Do not save per-step page content, variable values, or free-form error stacks. Reconcile interrupted checkpoints before accepting another run; stale checkpoints are compacted as interrupted summaries without taking page actions and follow the same retention policy.

## 8. Message envelope and evolution

Proposed envelope: `{ protocolVersion: 1, type, requestId, payload }`. Observer batch payloads name the session; executor outcomes name the run and dispatch; panel commands name the relevant revision. Browser sender metadata is authoritative for scope. Use specific command types (`session.start`, `events.append`, `workflow.save`, `run.start`, `run.confirmStep`, `run.stop`), each with its own validator and allowed sender context. An observer cannot send a panel-only command. No generic “call Chrome API” operation exists.

Return a bounded result `{ ok: true, data }` or `{ ok: false, code }`; show a product message for known codes without echoing untrusted payloads. Reject unsupported protocol/schema versions explicitly. Migrate each store version transactionally, preserve records on failed migration, and disable affected writes/runs until resolved. Imports use a separate versioned envelope, omit runtime approvals, and create drafts requiring fresh review; they never restore active sessions or runs.

Deletion removes records and dependent evidence in a transaction after cancelling affected active work. Clear-all removes preferences and future product records; per-origin deletion removes its events, sessions, candidates, workflows, and summaries. Test deletion and expiry both while the worker is active and after an idle restart.

## M1 implemented protocol

Panel commands are `panel.snapshot {windowId}`, `session.start {windowId, tabId}`, `session.pause/resume/stop {sessionId}`, `data.deleteSession {sessionId}`, `data.clear {}`, and `data.export {}`. Only the packaged side-panel URL without a content-script tab sender may use these commands.

Observer batches are `events.append {sessionId, epoch, events}` with at most 50 strictly shaped `{sequence, action, targetKey, fieldKind}` records. The worker generates timestamps, IDs, and segments. Exact duplicate sequence numbers are discarded; gaps start a new segment. Observer lifecycle reports use `observer.end {sessionId, reason}`. The coordinator validates browser-derived extension identity, tab, top frame, document, origin, active state, and epoch.

The content observer accepts only extension-originated `observer.start/resume {sessionId, epoch}`, `observer.pause/stop {sessionId}`, and `observer.probe {}` commands. Capture queues are capped at 200 work items, batches flush on a 250ms heartbeat, and sensitive DOM metadata never enters the message. Exports omit browser scope and epoch; they include reviewed session origin/time/status summaries and retained minimized events.
