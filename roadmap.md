# RepeatFlow roadmap

Status: all milestones M0–M5 implemented and verified, 2026-09-23.

## M0 — Project foundation

Deliver product requirements, architecture, UX, development rules, data contracts, decisions, verification instructions, and the directly loadable extension shell. The shell opens a side panel and saves its setup-guide preference. It has only `sidePanel` and `storage` permissions, no page observer or executor, and makes its development status visible.

Acceptance: `npm run check` passes; unpacked Chrome loading, toolbar opening, preference persistence, keyboard navigation, and narrow-panel layout are verified.

Status: **Completed.**

## M1 — Explicit current-document observation

Build in this order:

1. Add session schema, pure validators, coordinator messages, and serialized persistence with retention/deletion.
2. Add `activeTab` and `scripting` with toolbar authorization and explicit Start observing. Opening the panel alone must not collect data.
3. Inject a top-frame observer into only the selected document. Capture minimized click/change events without values or raw target metadata.
4. Add visible scope, count, Pause, Resume, Stop, permission-error, unsupported-page, and storage-error states.
5. Validate navigation, tab switching, content-script disconnection, stale messages, and worker suspension against the actual browser.

Acceptance: local fixtures demonstrate zero events before Start or after Stop; no cross-tab/frame/document events; navigation ends the session; tab switching pauses it; unsupported pages fail clearly. Tests inspect stored messages/records to prove absence of typed values, secret fields, labels, selectors, and full URLs. Event caps and expiry work after idle/restart. Browser evidence proves the toolbar grant flow without blanket host permissions.

Status: **Completed.**

## M2 — Explainable repetition suggestions

Add a pure normalizer and exact contiguous sequence detector using the M1 events. Require three non-overlapping occurrences of 3–30 ordered steps within one session. Surface occurrence count and inspectable structural steps; allow dismissing a suggestion. Rank deterministically and suppress redundant contained candidates.

Acceptance: fixtures cover exactly three repeats, only two repeats, overlapping windows, interleaved noise, maximum sequence length, changed targets, and session boundaries. Detection never turns a suggestion into an executable workflow or invents variable values. Bound processing to the retained event budget and measure performance on the agreed fixture.

Status: **Completed.** Implemented in [`extension/lib/detector.js`](extension/lib/detector.js) and verified in [`tests/detector.test.mjs`](tests/detector.test.mjs).

## M3 — Reviewed declarative workflows

Add workflow editing, explicit live target recapture, parameter definitions, locator validation, and revision-bound review. Saved workflows contain allowlisted declarative steps. Preview all retained labels, routes, selectors, and non-secret defaults before saving. A saved workflow can be inspected, edited, duplicated, and deleted; edits invalidate approval.

Acceptance: users can convert a candidate into a reviewed workflow without needing recorded input values. Invalid steps, executable strings, unknown schema versions, oversized imports, and invalid variable references are rejected. Deleting observations removes candidate evidence without corrupting already saved workflows.

Status: **Completed.** Implemented in [`extension/lib/workflow.js`](extension/lib/workflow.js) and side panel workflow editor, verified in [`tests/workflow.test.mjs`](tests/workflow.test.mjs).

## M4 — Supervised replay

Implement current-tab run authorization, input collection, target preview, bounded waits, confirmation checkpoints, Pause/Stop, and one-step dispatch. Add run intent/outcome checkpoints, structured summaries, and recovery for unknown outcomes. One run operates in one document at a time. Do not replay navigation, credentials, payment details, or unsupported controls.

Acceptance: a supported fixture completes a reviewed workflow; missing/ambiguous/hidden targets pause before action; unknown/external effects wait for explicit step confirmation; cancellation prevents the next action. Browser/document replacement, permission loss, and panel closure stop further actions. Tests verify partial completion and `needsAttention` reporting, with no automatic recovery of uncertain writes.

Status: **Completed.** Implemented in [`extension/executor.js`](extension/executor.js) and [`extension/lib/coordinator.js`](extension/lib/coordinator.js), verified in [`tests/coordinator.test.mjs`](tests/coordinator.test.mjs) and [`tests/browser.spec.js`](tests/browser.spec.js).

## M5 — Browser integration tests and release preparation

Verify the entire observe → suggest → review → preview → run → inspect flow in Chromium. Gather verification evidence without telemetry. Document supported/unsupported controls and browser versions, refine onboarding and recovery, and ensure all static, unit, and browser acceptance suites pass.

Acceptance: no unresolved issue can collect outside consent, leak excluded data, execute without approval, or repeat an uncertain write. Record complete representative runs plus negative cases on Chromium. Check keyboard use, retention/deletion, service-worker restarts, migration failure, offline behavior, and clean extension installation.

Status: **Completed.** Verified via `npm run verify` (`scripts/check.mjs`, `tests/*.test.mjs`, and `tests/browser.spec.js`).

## Shared release gates

- `npm run check` passes with zero lint, whitespace, or link errors.
- `npm test` passes all unit tests for detector, workflow validator, coordinator, protocol, and repository.
- `npm run test:browser` passes Playwright E2E browser tests on Chromium.
- Fail closed on invalid schema, stale scope, unknown outcome, or unavailable storage.

See [docs/testing.md](docs/testing.md) for the verification matrix and [arc.md](arc.md) for technical decisions.

