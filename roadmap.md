# RepeatFlow roadmap

Status: initial delivery plan, 2026-09-23. M0 supplies the foundation; M1–M5 are planned. Milestones have acceptance gates rather than promised dates. A passing static check does not establish browser behavior.

## M0 — Project foundation

Deliver product requirements, architecture, UX, development rules, data contracts, decisions, verification instructions, and the directly loadable extension shell. The shell opens a side panel and saves its setup-guide preference. It has only `sidePanel` and `storage` permissions, no page observer or executor, and makes its development status visible.

Acceptance: `npm run check` passes; unpacked Chrome loading, toolbar opening, preference persistence, keyboard navigation, and narrow-panel layout are checked according to [docs/testing.md](docs/testing.md). Record which browser checks actually ran. Layout preview alone does not verify Chrome APIs.

Current evidence: the repository check passes. The narrow localhost layout preview and isolated preference-state scenarios are recorded in [docs/testing.md](docs/testing.md). Actual unpacked-extension loading, toolbar behavior, and Chrome storage smoke checks have not run, so the foundation is created but M0 is not yet fully qualified in Chrome.

## M1 — Explicit current-document observation

Build in this order:

1. Add session schema, pure validators, coordinator messages, and serialized persistence with retention/deletion.
2. Add `activeTab` and `scripting` with toolbar authorization and explicit Start observing. Opening the panel alone must not collect data.
3. Inject a top-frame observer into only the selected document. Capture minimized click/change events without values or raw target metadata.
4. Add visible scope, count, Pause, Resume, Stop, permission-error, unsupported-page, and storage-error states.
5. Validate navigation, tab switching, content-script disconnection, stale messages, and worker suspension against the actual browser.

Acceptance: local fixtures demonstrate zero events before Start or after Stop; no cross-tab/frame/document events; navigation ends the session; tab switching pauses it; unsupported pages fail clearly. Tests inspect stored messages/records to prove absence of typed values, secret fields, labels, selectors, and full URLs. Event caps and expiry work after idle/restart. Browser evidence proves the toolbar grant flow without blanket host permissions.

## M2 — Explainable repetition suggestions

Add a pure normalizer and exact contiguous sequence detector using the M1 events. Require three non-overlapping occurrences of 3–30 ordered steps within one session. Surface occurrence count and inspectable structural steps; allow dismissing a suggestion. Rank deterministically and suppress redundant contained candidates.

Acceptance: fixtures cover exactly three repeats, only two repeats, overlapping windows, interleaved noise, maximum sequence length, changed targets, and session boundaries. Detection never turns a suggestion into an executable workflow or invents variable values. Bound processing to the retained event budget and measure performance on the agreed fixture; publish measurements only after running them.

## M3 — Reviewed declarative workflows

Add workflow editing, explicit live target recapture, parameter definitions, locator validation, and revision-bound review. Saved workflows contain allowlisted declarative steps. Preview all retained labels, routes, selectors, and non-secret defaults before saving. A saved workflow can be inspected, edited, duplicated, and deleted; edits invalidate approval. Export/import, if delivered here, must be versioned, bounded, previewed, and non-executing.

Acceptance: users can convert a candidate into a reviewed workflow without needing recorded input values. Missing original documents require target recapture. Invalid steps, executable strings, unknown schema versions, oversized imports, and invalid variable references are rejected. Deleting observations removes candidate evidence without corrupting already saved workflows. No Run control implies execution before M4 exists.

## M4 — Supervised replay

Implement current-tab run authorization, input collection, target preview, bounded waits, confirmation checkpoints, Pause/Stop, and one-step dispatch. Add run intent/outcome checkpoints, structured summaries, and recovery for unknown outcomes. One run operates in one document at a time. Do not replay navigation, credentials, payment details, or unsupported controls.

Acceptance: a supported fixture completes a reviewed workflow; missing/ambiguous/hidden targets pause before action; unknown/external effects wait for explicit step confirmation; cancellation prevents the next action. A local counted-submit fixture proves that a crash or lost acknowledgement never silently causes a duplicate submission. Browser/document replacement, permission loss, and panel closure stop further actions. Tests verify partial completion and `needsAttention` reporting, with no automatic recovery of uncertain writes.

## M5 — Limited pilot and release preparation

Select a small set of consenting users and supported ordinary DOM tasks. Verify the entire observe → suggest → review → preview → run → inspect flow. Gather feedback deliberately without adding automatic telemetry. Document supported/unsupported controls and browser versions, refine onboarding and recovery, and choose branding, license, and distribution approach.

Acceptance: no unresolved issue can collect outside consent, leak excluded data, execute without approval, or repeat an uncertain write. Record a complete representative run plus negative cases on current Chrome and the minimum supported version when available; if the minimum is unavailable, label compatibility unverified. Check keyboard use and zoom, retention/deletion, service-worker restarts, migration failure, offline behavior, and clean extension installation. Store publication and Edge support each need their own verified release decision.

## Shared release gates

- Keep `npm run check` passing and add focused `node:test` suites when real normalization, validation, or state logic exists.
- Use synthetic local fixtures and inspect actual stored data and messages, not just UI counters.
- Attach concrete evidence to acceptance: revision, browser/version, scenario, result, and limitations.
- Inspect manifest permission growth, storage schemas, dependencies, and documentation changes together.
- Fail closed on invalid schema, stale scope, unknown outcome, or unavailable storage; make recovery understandable.
- Keep the previous milestone usable and label future controls honestly.

See [docs/testing.md](docs/testing.md) for the verification matrix and [arc.md](arc.md) for technical decisions.

## Deferred decisions

Persistent per-site observation, cross-page/multi-tab workflows, iframe support, shadow DOM expansion, scheduled runs, cloud sync, collaboration, AI-assisted generalization, Firefox, and marketplace distribution are outside the initial MVP. Each needs a product decision and updated permission/data/execution contracts before implementation. The immediate next task is M1, not a broader autonomous browsing agent.
